# Agent Platform 适配层

`server/services/agent-platform/` 是 LexSeek 自研的 LangGraph 适配层，承担"业务 vertical 声明配置 → 平台拼装中间件/工具/SSE → 调用 LangChain createAgent 或自定义 StateGraph"的职责。

它是 LexSeek 所有 AI 对话能力（案件分析、合同审查、文书起草、法律助手）共同的基座。

---

## 1. 架构概览

```
业务 vertical（server/agents/<vertical>/agent.config.ts）
  │ defineDomainAgent({ scope, type?, agentType, nodeName, ... })
  ▼
agent-platform/factory
  ├── defineDomainAgent  ─── 注册到 agentRegistry 并返回 runner
  └── runtime
      ├── runDomainAgent       ── createAgent 路径（ReAct 循环）
      └── runStateGraphAgent   ── 业务自定义 StateGraph 路径
            │
            ▼
agent-platform 平台职责
  ├── nodeConfig.loader       ── 按节点 name 加载 nodes 表 + 工具 + 模型
  ├── nodeConfig.promptRenderer── 渲染 system prompt（plain text，含变量替换）
  ├── modelFactory            ── chatModel 工厂（按 sdkType 路由 openai/anthropic/deepseek/gemini）
  ├── middleware（栈）        ── messageIntegrity / scopeGuard / pointConsumption /
  │                              summarization / safetyTrim / audit / toolCallLimit /
  │                              afterAgentMemory / skills（动态）
  ├── skills                  ── 文件系统扫描 + 节点关联 + deepagents skillsMiddleware
  ├── tools                   ── searchLaw / searchCaseMaterials / runSkillScript /
  │                              draftDocument / reviewContract / 积分预扣三件套 / 子流工具 ...
  ├── subAgent                ── subAgentToolFactory + 子流回调 + status 上报
  ├── sse                     ── customEventEmitter / eventBridge / streamBuilder
  ├── state                   ── LangGraph 状态存储
  ├── checkpointer.ts         ── checkpoint + store 单例（按 scope 隔离）
  ├── threadState.ts          ── thread_id ↔ session 双向映射
  ├── context                 ── 注入检测 / 消息压缩 / 工具结果截断 / 模块上下文构建
  └── diagnostics             ── 错误链路 trace（绑定 LangSmith / SSE 错误事件）
```

---

## 2. vertical 与 scope/type 路由

`agentRegistry` 用 `(scope, type?)` 元组作为 key。每个 vertical 在 `server/agents/<vertical>/agent.config.ts` 中注册。

| Vertical | scope | type | agentType | 静态 nodeName | 形态 |
|----------|-------|------|-----------|---------------|------|
| `legal-assistant` | `ASSISTANT` | — | createAgent | `assistantMain` | ReAct 循环（无 caseId） |
| `case-main` | `CASE` | `null` | createAgent | `caseMain` | CASE 域默认入口 |
| `case-module` | `CASE` | `MODULE` | stateGraph | 动态（按 `metadata.moduleName`） | 案件子模块（"小索"） |
| `case-analysis` | `CASE` | `ANALYSIS` | stateGraph | `caseInfoCheck`（占位） | 案件初分（7 个分析节点串行） |
| `contract` | `CONTRACT` | — | stateGraph | `contractReviewMain` | 合同审查（含 stance interrupt） |
| `document` | `DOCUMENT` | — | stateGraph | `documentMain` | 文书起草 |

> `case-analysis` 的 `nodeName` 是**占位值**——StateGraph 内部委托 `startCaseAnalysisV2` 自行加载 7 个 analysis 子节点配置，平台预加载只为初始化 nodeConfig 缓存。详见 `server/agents/case-analysis/agent.config.ts` 的注释。

入口路由由 `agentRegistry.dispatch(scope, type)` 完成；任意 (scope, type) 重复注册会立刻抛错。

---

## 3. 中间件栈

`server/services/agent-platform/middleware/` 提供平台通用中间件，业务 vertical 可声明私有中间件挂在 `_shared/` 下。

`runDomainAgent` 默认装配栈（`buildMiddlewareStack` 决定优先级）：

| 优先级（高 → 低） | 中间件 | 职责 |
|---|---|---|
| 100 | `createMessageIntegrityMiddleware` | 校验消息序列完整性、剔除空消息 / 异常 ToolMessage |
| 90 | `createScopeGuardMiddleware` | 检查 scope 与 ctx 是否匹配（防越界） |
| 80 | `pointConsumptionMiddleware` | 按 token 预扣积分（assistant_token / case_main 等品类） |
| 70 | `summarizationMiddleware`（LangChain 内置） | 长对话自动摘要（按 contextWindow 触发） |
| 60 | `safetyTrimMiddleware` | 摘要后兜底裁剪超长消息，保 LLM 不爆 token |
| 50 | `createToolCallLimitMiddlewares` | 限制单轮 / 单流工具调用次数防失控 |
| 45 | `userInjectionMiddleware` | 把节点关联的 `type=user_injection` 提示词在每轮 wrapModelCall 内作为隐藏 HumanMessage 注入到最新 HumanMessage 之前——不写回 state、不进 checkpoint。常用于反越狱守卫 / 实时案件上下文。stateGraph 路径需在 vertical 内显式挂载（`caseModule` / `contract` / `document` / `caseAnalysis` 4 个 vertical 已接入；createAgent 路径默认挂） |
| 40 | `skillsMiddleware`（动态） | 由 `buildSkillsMiddlewareForNode(nodeId)` 构造，无关联 skill 时返回 null 跳过 |
| 30 | `afterAgentMemory.middleware` | Agent 跑完后异步抽取记忆写入 `caseMemory` |
| 20 | `createAuditMiddleware` | 落 audit 日志（输入消息、输出消息、token 用量） |
| — | 业务私有中间件 | 由 vertical 注入，例如 `caseContext`、`caseProcessMaterial` |

> `skills.ts` 中的 `buildSkillsMiddlewareForNode` 返回 `null` 时工厂会**同时**跳过 `read/write/run skill_file` 三个工具的注入——避免 LLM 看到工具但底层 backend 不可用。

业务私有中间件示例：`server/agents/_shared/case-context/` 提供 `caseContextMiddleware`（注入案件元数据到 system prompt）。

---

## 4. SSE 事件桥接

```
LangGraph stream  ──> customEventEmitter ──> eventBridge ──> SSE Stream ──> 前端
                          ▲
                          │（业务 vertical 自行 emit 中间状态：tool_status / sub_agent_status / progress）
                          │
                     subAgent.publishSubAgentStatus / streamBuilder
```

- `customEventEmitter` 是 LangChain 事件流外的旁路通道，业务可主动 publish 中间事件
- `eventBridge` 把 LangChain 原生事件（`on_chat_model_stream` / `on_tool_start` / `on_tool_end`）转成项目统一事件协议
- `streamBuilder` 负责把多路事件合并为单条 SSE 流并处理心跳 / cancel / error

详见 `docs/tech-docs/patterns/sse-event-bridge.md`。

---

## 5. 工具体系

`server/services/agent-platform/tools/` 提供平台通用工具：

| 工具 | 用途 |
|------|------|
| `searchLaw` | 法律法规向量检索（pgvector + 重排） |
| `searchCaseMaterials` | 案件材料语义检索 |
| `search_case_analysis` | 跨会话查找之前的分析结果 |
| `search_case_memory` / `update_case_memory` / `write_case_memory` | 案件记忆读写（系统级 + 用户级） |
| `processMaterials` | 触发素材 OCR/ASR/MinerU 流水线 |
| `reservePoints` / `confirmPoints` / `rollbackPoints` | 工具调用前后积分预扣 / 确认 / 回滚 |
| `saveAnalysisResult` | 写回 `caseAnalyses` |
| `searchCaseMaterials` / `uploadWorkspaceFile` | 工作区文件操作（与 `workspace.ts` 配合） |
| ~~`draftDocument`~~ | ❌ 已删除(2026-05-05),反模式重构,被下面 3 个无会话工具取代 |
| `recommend_template` / `save_document_draft` / `update_document_draft` | 文书起草纯函数工具(无会话,平级 Agent 共用) |
| `reviewContract` | 子 Agent 工具(启动合同子流;文书侧已迁出该模式) |
| `readSkillFile` / `writeSkillFile` / `runSkillScript` / `runSkillCommand` | Skill 文件读 / 写 / 执行 |

工具按节点关联在 `nodes` 表 `tools` 字段配置（JSON 数组，`getToolInstancesService` 反射加载）。

---

## documentMain 是平级 Agent(2026-05-05 修正)

**重要架构变化**:documentMain 不再是"被 draft_document 工具嵌套调用的子 Agent",而是跟 caseMain / assistantMain 同构的平级主 Agent。三个 Agent 都挂 `legal-document-writer` skill,通过 `recommend_template` / `save_document_draft` / `update_document_draft` 三个无会话纯函数工具协作起草文书,工具不嵌套调用任何 Agent,不依赖 `toolStrategy / responseFormat / draftResultPersistence` 中间件。

详见 `docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md` 和 `docs/superpowers/plans/2026-05-05-document-agent-tool-refactor.md`。

---

## 6. 子 Agent 工具

业务可通过 `subAgent/subAgentToolFactory` 把"启动一个独立 thread 的子 Agent"包装成工具:

- `runAndDrain` 把 LangGraph stream 完整跑完并 invoke 拿最终值
- `buildSubAgentCallbacks` 构造一组旁路回调（向父流转发关键事件）
- `publishSubAgentStatus` 在父流上报子流 `started / running / completed / failed`

> 重要约束（项目记忆 `feedback_subagent_stream_pitfall.md`）：子 Agent 工具的**返回值**必须用 `agent.invoke(...)` 拿；事件转发走 `callbacks` 旁路，绝不用同一个 `agent.stream(...)` 同时承担"取最终值"和"转发事件"两件事——会导致流被消费完但 Promise 不解析。

---

## 7. 节点配置加载

`nodeConfig/loader.ts` 按 `nodeName` 从 `nodes` 表加载完整配置（含 `prompts` 当前版本、`tools` 数组、关联的 `models` 与会员等级），结果带 in-memory 缓存。

修改节点 / 提示词 / 工具关联后必须 `invalidateNodeConfigCache(nodeName)` 让下次调用重读。skills 启停接口已通过 `skillSync.service` 自动调用此函数。

`nodeConfig/promptRenderer.ts` 按 prompt 模板的 `variables` 字段填值（来自 ctx + 业务私有 metadata）。

---

## 8. 上下文管理

`context/` 子目录处理 LangGraph 长对话的几个共性问题：

- `messageCompressor.ts` — 接管 `summarizationMiddleware` 的 `contextWindow` 解析（按 model 动态）
- `toolResultTruncator.ts` — 工具返回过长内容截断（保留头尾 + 中间省略号）
- `injectorDetection.ts` — 识别 prompt injection 痕迹（关键词 + 模式匹配）
- `moduleContextBuilder.ts` — 案件子模块（小索）按 `moduleName` 拼装专属上下文
- `contextErrorLogger.ts` — 上下文构建异常落审计日志

---

## 9. 引用关系

| 文档 | 关系 |
|------|------|
| [agent.md](./agent.md) | Agent Worker（任务队列 + Redis SSE）调用 agent-platform 执行图 |
| [workflow.md](./workflow.md) | LangGraph 工作流详解（含 caseAnalysisV2） |
| [node.md](./node.md) | `nodes` 表 / 提示词版本 / 工具关联 |
| [skills.md](./skills.md) | Skill 注册表与 skillsMiddleware |
| [patterns/workflow-middleware.md](../patterns/workflow-middleware.md) | 中间件设计原则 |
| [patterns/sse-event-bridge.md](../patterns/sse-event-bridge.md) | SSE 桥接细节 |
| [patterns/adapter-factory.md](../patterns/adapter-factory.md) | modelFactory / chatModelFactory 适配器模式 |

---

## 10. 新增 vertical 速查清单

1. 在 `server/agents/<新 vertical>/` 新建目录
2. 写 `agent.config.ts`，调用 `defineDomainAgent`，确定 `(scope, type?)` 路由唯一
3. 在 `nodes` 表插入对应静态 nodeName（含模型、工具、prompts）
4. 若需私有中间件 / 工具，放在该 vertical 目录下，agent.config 中通过 `customMiddlewares` / `customTools` 传入
5. 在 `server/plugins/agents-load.ts` 中加一行命名 import（必须命名 import 引用 export 变量，纯 `import './...'` 会被 esbuild tree-shake 移除）→ 启动时自动注册到 `agentRegistry`
6. 前端按 scope/type 创建会话即可走到新 vertical
