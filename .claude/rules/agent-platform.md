---
paths:
  - "server/services/agent-platform/**"
  - "server/agents/**"
  - "server/services/memory/**"
---

# Agent Platform 开发规范

> `server/services/agent-platform/` 是自研的 LangGraph 适配层；`server/agents/<vertical>/` 是各业务 vertical 的 Domain Agent 配置（通过 `defineDomainAgent` 注册到 platform）。本文记录这一层经过线上踩坑后形成的硬性约束。

## 子代理 SSE 事件必须 await（铁律）

子代理工具的 callback 内调用 `publishCustomEvent` / `publishStatusChange` 等 SSE emit 函数时，**必须 `await`**，不能 fire-and-forget（即不能只挂 `.catch` 不 await）。

```typescript
// ❌ 错误：fire-and-forget — 子代理 process 退出可能丢最后几条事件
emitter.publishCustomEvent({ type: 'SUB_AGENT_TOKEN', token })
  .catch(err => logger.warn('publish failed', err))

// ✅ 正确：async callback + await，保留 .catch 兜底
async (event) => {
  await emitter.publishCustomEvent({ type: 'SUB_AGENT_TOKEN', token })
    .catch(err => logger.warn('publish failed', err))
}
```

> 历史教训：fire-and-forget 模式下，前端工具卡片偶发显示不完整（`SUB_AGENT_TOKEN` / `TOOL_START` / `TOOL_END` / `STATUS` 任意一类被丢）。每 token 多等几毫秒（NOTIFY 是本地操作）的代价远低于消息丢失。详见 commit 2bb6a3fd。

## Skills 中间件 sources 必须取父目录

`createSkillsMiddleware`（来自 `deepagents`）的 `sources` 期望是 **包含多个 skill 子目录的父目录**，它会 `ls(source)` 列出子目录、再读每个子目录下的 `SKILL.md`。

数据库里 `skills.path` 存的是 skill 自身目录（形如 `.deepagents/skills/<name>`），传给 deepagents 前**必须 `dirname()` 取父目录的 unique 集合**：

```typescript
// ❌ 错误：传 skill 自身目录 → deepagents ls 进去只看到 references/，加载不到 SKILL.md
const sources = skills.map(s => s.path)

// ✅ 正确：取父目录去重
const sources = [...new Set(skills.map(s => dirname(s.path)))]
const backend = getFilesystemBackend(sources)
return createSkillsMiddleware({ backend, sources })
```

> 副作用（已知可接受）：节点会通过 skill 列表看到父目录下"全部" skill 的 metadata（不只是关联的）。LLM 通过 description 匹配挑选；context 多几条 metadata 影响可控，但 skill 现在能正确加载。详见 commit 306e9052 与 `server/services/agent-platform/middleware/skills.ts`。

## Domain Agent 注册（defineDomainAgent）

业务 vertical 的 `agent.config.ts` 调用 `defineDomainAgent` 在模块 import 阶段就会注册到 `agentRegistry`：

- 重复注册同一 `(scope, type)` 会立即抛错——每个 vertical 的 (scope, type) 必须唯一
- `agentType: 'createAgent'`：由 `runtime.runDomainAgent` 自动组装 middleware + tools 后调 LangChain `createAgent`
- `agentType: 'stateGraph'`：业务自定义图，必须自带 `runStateGraph` 函数（否则注册阶段抛错）

新增业务 vertical 时遵循：
1. 在 `server/agents/<vertical>/agent.config.ts` 调 `defineDomainAgent`
2. 在 `server/agents/<vertical>/index.ts`（或工厂注册入口）import 一次，触发副作用注册
3. 不要直接调 `agentRegistry.register`——一律走工厂

## afterAgentMemory 中间件挂载约定

`afterAgentMemoryMiddleware` 是案件记忆（`server/services/memory/`）的自动写入钩子，priority 必须用 `MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE`。

| Vertical | 是否挂 afterAgentMemory |
|---------|------------------------|
| `caseMain` / `caseModule` | **必挂**（`caseId` 一定有） |
| `caseAnalysis` 子代理 | **必挂** |
| `documentMain` / `contractReviewMain` | `caseId` 非空时挂，否则跳过 |
| `legalAssistant`（法律助手） | **永不挂**（`caseId` 永远 null） |

> 法律助手不挂的原因：法律助手是全局通用对话（跨案件），未来挂的是用户记忆/偏好/历史案件等不同维度，不是案件记忆。两套不能混用。详见项目记忆 `project_xiaosuo_vs_legal_assistant.md`。

挂载示例：

```typescript
{
  middleware: afterAgentMemoryMiddleware({
    caseId: ctx.caseId!,        // 必挂场景下加 ! 断言；可选场景需先判空跳过
    sessionId: ctx.sessionId,
    userId: ctx.userId,
  }),
  priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
  name: 'afterAgentMemory',
}
```

## 消息过滤 / 特殊渲染：metadata 优先

子代理 / 工具事件需要让前端做特殊渲染（如展开工具卡片、隐藏内部消息）时，**首选** `BaseMessage.additional_kwargs` / `response_metadata`，**禁用**字符串 sentinel（如往 content 里塞 `[[hidden]]`）。

> 注意：LangGraph SDK 的 plain object 序列化路径会丢 `additional_kwargs`，传输时用 LangChain 类实例（`new AIMessage`），或在前端做双轨兜底（先看 metadata，再看 class instance）。详见项目记忆 `feedback_message_metadata_first.md`。

## sub-agent 工具：stream 与 invoke 职责分离

子 Agent 工具的返回值给主 Agent 用 `invoke`（拿最终结果）；转发增量消息给前端用 `callbacks` 旁路（独立 emit）。**不要**让 stream 同时承担"返回值"与"消息转发"两个职责，否则要么消息错过、要么返回值被截断。详见项目记忆 `feedback_subagent_stream_pitfall.md`。

## 测试覆盖率约束

`server/services/agent-platform/**` 在 `vitest.config.ts` 里有分目录覆盖率阈值（≥90%）。新增模块时：

- DAO / Service / Middleware：补单测拉到 90%+ 才能合
- 子代理工具（`tools/*.tool.ts`）覆盖到 95%+
- 工厂层（`factory/runtime.ts` / `defineDomainAgent.ts`）覆盖到 98%+

> 历史教训：阶段 8 综合审查发现的 4 个真实问题（子代理事件 fire-and-forget、ContractReviewSavedPayload 类型对齐、意图缓存陈旧、覆盖率不足）大半通过补测试发现。新增 agent-platform 代码时**先 grep 同类已有测试**再补，禁止省测试。
