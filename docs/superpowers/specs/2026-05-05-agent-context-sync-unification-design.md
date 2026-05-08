# 三个 Agent 上下文同步机制统一（Spec）

- 日期：2026-05-05
- 状态：待 review
- 作者：戴鑫
- 涉及 vertical：`case-main`（小索） / `case-module`（模块对话） / `document`（文书生成）
- 不在范围：`legal-assistant`（法律助手）、子 Agent（`ask_*_expert`）、`contract`（合同审查）

---

## 1. 背景

LexSeek 当前三个 Agent 的"案件相关上下文"机制完全不同，给排查与维护带来负担：

| Agent | 上下文位置 | 注入时机 | 数据来源 |
|---|---|---|---|
| 小索（caseMain） | HumanMessage（紧跟 system 后） | **同 thread 只注入一次** | 实时查库 |
| 模块对话（caseModule） | SystemMessage 内（buildSystemPromptForAgent） | 每轮重拼 SystemMessage | 实时查库 |
| 文书生成（documentMain） | SystemMessage 内（含案件 4 段 + 草稿字段 + 模板占位符） | 每轮重拼 SystemMessage | 实时查库 |

带来的问题：
1. **小索同会话内对"案件后续变更"完全感知不到**——首句锁定后续靠工具按需召回，新材料/新模块结果不会自动进入上下文。
2. **模块对话 / 文书生成每轮重拼 SystemMessage** 让模型供应商的 prompt cache 难以稳定命中：caseProfile 改了、isActive 模块切了、用户编辑了草稿字段，整段 system prompt 都不一样，整轮 KV 缓存重算。
3. **三个 Agent 拼装机制不一致**，新功能（比如想"每轮自动补做未处理材料"）需要在三处分别实现。
4. **过滤注入消息的逻辑分散在四处**：`injectorDetection.ts`（中央判定）、`agentSseStream.ts`（SSE 出口过滤）、`threadState.ts`（hardcoded 过滤）、`useMessageParser.ts`（前端 hardcoded 兜底）。新增 tag 容易漏改。

## 2. 目标与非目标

### 2.1 目标

- 三个 Agent 的"每轮可能变的上下文"全部以**同一种形式**进入对话：一条注入的 HumanMessage，紧贴本轮用户消息之前。
- 所有注入消息打统一 metadata 标签（`injectedBy: 'CaseContextSyncMiddleware'`），前端不显示给用户。
- **不修改历史消息**，确保模型供应商的 prompt cache 能稳定命中。
- SystemMessage 退化为只含"角色定位 + 流程规范"（roleAndFlow），稳定不变；Anthropic 路径仍挂 1h cache_control（roleAndFlow 段稳定，缓存命中收益最大化）。
- 三个 Agent 都挂上"未处理材料自动补做（OCR/向量化）"钩子，行为对齐。
- 过滤逻辑收敛到中央判定函数 `isInjectedContextMessage`，前端兜底简化为只识别新 tag。

### 2.2 非目标

- 不改法律助手（`assistantMain`）。它没有案件维度上下文，本次不纳入；后续单独立项做"读文件"能力。
- 不改子 Agent（`ask_*_expert`）。每次工具调用启动独立 thread 单次执行，从数据库实时拉 4 段，无累积问题，改造收益小。
- 不改合同审查 vertical。
- 不引入新的 schema 字段或表。
- 不引入新的"运行时旁路"机制（注入消息进入 checkpoint，是 A 模式的固有行为）。

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│ 三个 Agent（小索 / 模块对话 / 文书生成）共用统一管线        │
│                                                           │
│ SystemMessage（稳定，命中长缓存）                           │
│   └─ roleAndFlow（来自 nodeConfig prompt 模板）            │
│      Anthropic 路径：包成 content block + 1h cache_control │
│      其他 SDK：plain text（OpenAI/Gemini 自动前缀缓存）     │
│                                                           │
│ ↓ beforeAgent 钩子链（每轮发消息时跑一次）                  │
│                                                           │
│ ① caseProcessMaterialMiddleware                           │
│    扫案件下未处理材料 → OCR/ASR/向量化补做                  │
│    （caseId 非空时挂；文书生成 caseId 可空）                │
│                                                           │
│ ② caseContextSyncMiddleware（新）                         │
│    实时查库 → 拼一条上下文 HumanMessage                    │
│    → splice 原地插入到本轮 user message 之前              │
│    → 标记 injectedBy='CaseContextSyncMiddleware'          │
│                                                           │
│ ↓ LLM 看到的 messages                                     │
│ [SystemMessage(roleAndFlow + Anthropic cache_control),    │
│  ...历史(含旧 context+ai+tool)...,                        │
│  ContextHumanMessage(本轮 4+2 段),                        │
│  HumanMessage(本轮用户问题)]                               │
└─────────────────────────────────────────────────────────┘
```

### 3.1 设计决策摘要

| 决策点 | 选择 | 备选方案及拒绝理由 |
|---|---|---|
| 注入消息是否进入 checkpoint | **A：进入** | B（运行时旁路）实现复杂、易踩 LangGraph reducer 隐藏行为 |
| 文书的"草稿字段+占位符"放哪里 | **A：合并到同一条上下文 HumanMessage** | B（拆两条）增加历史累积；C（保留 SystemMessage 内）违背"不破缓存"目标 |
| 法律助手是否纳入 | **A：本次不动** | 法律助手的"读文件"是独立产品能力，不属于"上下文统一"范畴 |
| 子 Agent 是否纳入 | **A：本次不动** | 子 Agent 单次 thread 无累积，改造收益小 |
| Anthropic 路径的 cache_control | **保留 SystemMessage 顶层 1h cache** | Anthropic 没有前缀自动缓存（官方文档：No default caching），完全砍 cache_control 会导致每轮全量计费；保留稳定的 roleAndFlow 段单挂 cache_control，命中收益最大 |
| 4+2 段动态内容 cache_control | **不挂** | 内容每轮变，cache_control 命中不了 |
| 注入消息位置实现 | **splice 原地修改 state.messages**（沿用现有 caseContextMiddleware 模式） | LangGraph add_messages reducer 不会按 return 顺序重排（同 id 原位替换 / 新 id 追加末尾），return 数组方案不可行；wrapModelCall 钩子项目无现成实践、风险高 |
| 前端兜底过滤 | **B：精简版只识别新 tag** | 后端 SSE 已过滤老 tag，前端兜底不必再覆盖 |
| 多轮注入累积如何回收 | 靠现有 `summarizationMiddleware` | 不新增删除/标记 stale 的逻辑（违反"不修改历史"） |
| metadata 字段 | **仅 `injectedBy`**（双轨写 `additional_kwargs.injectedBy` + `response_metadata.injectedBy` 兜底 SDK 序列化丢字段；依据项目记忆 `feedback_message_metadata_first.md`，非新决策） | injectedAt/segments 调试字段是过度设计；checkpoint 自带时间，content 标题肉眼可识 |

## 4. 详细设计

### 4.1 新中间件：`caseContextSyncMiddleware`

**位置**：`server/agents/_shared/case-context/caseContextSync.middleware.ts`（替换现有 `caseContext.middleware.ts`，旧文件删除）

**输入参数**：

```ts
caseContextSyncMiddleware({
  caseId: number | null,        // null 时跳过案件 4 段；目前小索/模块对话必填
  agentName: string,             // 用于排除自身模块结果（'caseMain' / moduleName / 'documentMain'）
  draftLoader?: () => Promise<{
    placeholdersWithHints: string,  // 模板待填占位符清单（已渲染好的文本，闭包外捕获不变）
    draftValuesJSON: () => Promise<string>,  // 实时拉 draft.values 的查询函数
  } | null>,                        // 仅文书 Agent 传；返回 null 时跳过文书段
})
```

**钩子选择**：`beforeAgent`。每轮 Agent 启动时跑一次，**ReAct 循环内多次 model call 之间不重跑**。

**注入位置**：本轮新增 user message 之前。

**实现策略**（采用 splice 原地修改，沿用现有 caseContextMiddleware 模式）：
1. 读 `state.messages`，找到末尾的 HumanMessage（本轮用户输入）
2. 实时拉数据：
   - 调 `buildContextSegments({ caseId, agentName, userQuery })` 拿案件 4 段
   - 调 `draftLoader()`（如有）拿文书 2 段：placeholders 用闭包外捕获的字符串（不变），draftValues 调 `draftValuesJSON()` 实时查库（每轮可变）
3. 拼成单一字符串内容
4. 构造 `new HumanMessage({ content, response_metadata, additional_kwargs })`，**双轨**打标志：
   ```ts
   new HumanMessage({
     content: <拼好的字符串>,
     response_metadata: { injectedBy: 'CaseContextSyncMiddleware' },
     additional_kwargs: { injectedBy: 'CaseContextSyncMiddleware' },
   })
   ```
5. **直接 mutate** `state.messages`：用 `splice(insertIdx, 0, contextMsg)` 把 contextMsg 插到本轮 user message 之前
6. hook 不返回 messages（让 splice mutation 在 LangGraph 内部 state 上生效；同款写法已在现有 caseContextMiddleware 用于生产 1 年）

> ⚠️ 双轨打标志原因：项目记忆 `feedback_message_metadata_first.md` 指出 LangGraph SDK 的 plain object 序列化路径会丢 `additional_kwargs`。本场景中间件构造的是 LangChain 类实例，理论上 response_metadata 与 additional_kwargs 都会保留——但为防 checkpoint 反序列化时只有一个字段还原成功，下游 `isInjectedContextMessage` 任一字段命中即识别。

> ⚠️ splice mutation 依赖 LangGraph 不深拷贝 state.messages 数组——这是现有 caseContextMiddleware 已经依赖的隐式契约，本 spec 沿用同款机制（已在生产环境跑过 1 年）。Plan 阶段无需 spike，直接照搬现有实现风格即可。

**不声明 `stateSchema`**：现有 `caseContext.middleware.ts` 的 `stateSchema: { _caseContextInjected: boolean }` 仅用于"只注入一次"锁。新中间件去锁后无 state 字段需求，纯 beforeAgent 注入逻辑无需 stateSchema 声明。

**异常兜底**：
- `buildContextSegments` 抛错 → 沿用现有容错风格，写 error 日志，return 不修改 messages，**不阻塞** Agent 启动
- `draftLoader` 抛错 → try/catch 后跳过文书段，仅注入案件 4 段，写 warn 日志带 draftId/sessionId
- `recallMemoryService` / `getMaterialListWithSummariesService` 已有 `.catch(() => [])`，不变
- `prisma.cases.findUnique` 返回 null（案件软删/不存在）→ `buildContextSegments` 已处理，4 段返回空字符串

**多轮累积的回收路径**：靠现有 `summarizationMiddleware` 在 token 累积过阈时把历史摘进对话摘要。注入的 context 消息天然会被一起摘进去。

### 4.2 三个 Agent 改造点

#### 4.2.1 小索（caseMain）

**当前**：走 `runtime.ts` 的 createAgent 路径，`renderSystemPrompt(nodeConfig)` 已经只返 plain text roleAndFlow，4 段是 `caseContextMiddleware` 通过 HumanMessage 注入但有"只注入一次"锁。

**改造**（最小）：
- 删除旧 `caseContextMiddleware`，新建 `caseContextSyncMiddleware`：
  - 去掉 `_caseContextInjected` 锁，每轮都注入
  - tag 从 `'CaseContextMiddleware'` 改为 `'CaseContextSyncMiddleware'`
- `server/agents/case-main/agent.config.ts` 里 `customMiddlewares` 数组里把 `caseContextMiddleware` 替换为 `caseContextSyncMiddleware`
- `caseProcessMaterialMiddleware` 不动（已经挂着）
- Anthropic 缓存：`runtime.ts:160` 当前直接传 plain text 给 `createAgent({ systemPrompt })`。本次改造**升级**为：Anthropic 路径用 `cachedPromptToAnthropicContent` 把 roleAndFlow 包成单 block + 1h cache_control 构造 SystemMessage 实例传入；其他 SDK 仍用 plain text。

#### 4.2.2 模块对话（caseModule，runModuleChat）

**当前**（`server/services/workflow/agents/moduleAgent.ts`）：
- SystemMessage 由 `buildSystemPromptForAgent()` 拼装，含 4 段
- 中间件栈无 `caseProcessMaterialMiddleware`、无 `caseContextMiddleware`
- safetyTrim 的 `systemPrompt` 参数传完整 4 段拼装的 plain text

**改造**：
- SystemMessage 改造为：
  - Anthropic SDK：用 `cachedPromptToAnthropicContent` 包装 `[{text: roleAndFlow, cache: {ttl: '1h'}}]` 单段 → 构造 SystemMessage 实例
  - 其他 SDK：直接用 `renderSystemPrompt(nodeConfig, {...})` 返 plain text 字符串
- 不再调用 `buildSystemPromptForAgent`（4 段交给中间件）
- middleware 数组新增：
  - `caseProcessMaterialMiddleware(userId, caseId)`，priority `PROCESS_MATERIAL=10`
  - `caseContextSyncMiddleware({ caseId, agentName: moduleName })`，priority `MODULE_CONTEXT=30`
- `safetyTrim.middleware` 的 `systemPrompt` 改为只算 roleAndFlow plain text

#### 4.2.3 文书生成（documentMain，runDocumentChat）

**当前**（`server/services/workflow/agents/documentMainAgent.ts:96-121`）：
- `roleAndFlowTemplate = renderSystemPrompt(nodeConfig, { caseId, templateName, draftId, status, currentValuesJSON, placeholdersWithHints })`，把"草稿字段+占位符"硬塞进 SystemMessage
- 再调 `buildSystemPromptForAgent` 在它后面拼 4 段
- 中间件栈无 `caseProcessMaterialMiddleware`、无 `caseContextMiddleware`

**改造**：
- `renderSystemPrompt` 调用收窄：去掉 `currentValuesJSON` / `placeholdersWithHints` 参数，只保留 `caseId / templateName / templateCategory / draftId / status`
- 节点提示词模板（`documentMain_system`）的 content 字段同步改：删除 `- 当前已填字段:{{currentValuesJSON}}` 和 `{{placeholdersWithHints}}` 两行；新增一句静态指引"你的工作上下文（草稿当前已填字段、模板待填占位符、案件档案、材料清单）会在每轮对话中以补充消息的形式提供给你，请基于其中的最新内容回答用户。"
- SystemMessage 构造方式同 4.2.2（Anthropic 路径加 1h cache_control，其他 plain text）
- 不再调用 `buildSystemPromptForAgent`
- 实现 `draftLoader` 闭包：
  - **闭包外**捕获：调一次 `getDocumentTemplateDAO(draft.templateId)` 拿 placeholders → 用现有"`- ${name}${firstContext ? ' (参考上下文:...)' : ''}`"格式（同 documentMainAgent.ts:97-101 的现有渲染逻辑）渲染成 `placeholdersWithHints` 字符串。该字符串在整个 session 生命周期不变（template 不变）。
  - **闭包内**：每次调用时 `findDraftBySessionIdDAO(sessionId)` 实时查最新 `draft.values`，序列化为 `currentValuesJSON`。这样用户在 UI 上编辑草稿后，下一轮 Agent 启动能看到最新值。
  - **代码迁移**：documentMainAgent.ts 第 97-101 行原本在函数顶部一次性渲染 placeholders 的 5 行代码，整体迁移到 draftLoader 闭包外（runDocumentChat 函数顶部）；`currentValuesJSON` 的拼装从函数顶部（第 101 行）迁移到 draftLoader 闭包内（每轮实时查）。**不保留两份**——原位置的 placeholders/currentValues 渲染代码必须删除。
- middleware 数组新增：
  - `caseProcessMaterialMiddleware(userId, caseId)`：仅 `caseId` 非空时挂；caseId 为 null 时跳过
  - `caseContextSyncMiddleware({ caseId, agentName: 'documentMain', draftLoader })`：**总是挂**（draftLoader 一直有）
- `safetyTrim.middleware` 的 `systemPrompt` 改为只算 roleAndFlow plain text

### 4.3 过滤逻辑收敛

**`server/services/agent-platform/context/injectorDetection.ts`**：
- `INJECTOR_EXACT` 集合新增 `'CaseContextSyncMiddleware'`
- 旧 tag 保留（`'CaseContextMiddleware'` / `'ModuleContext*'` / `'CaseMaterial*'` / `'SubAgentContext*'`）兼容历史 checkpoint
- `getMessageInjector` 同时读 `response_metadata.injectedBy` 和 `additional_kwargs.injectedBy`（双轨兜底）
- `isInjectedContextMessage(msg)` 函数自动覆盖新 tag，无需改后端 SSE 过滤层、threadState.ts 等下游

**`server/services/workflow/agents/threadState.ts`**：
- 第 90-100 行（`getThreadValuesService`）和 266-267 行（`loadSubAgentThreads`）的 hardcoded 过滤改为调 `isInjectedContextMessage(msg)`
- 行为不变（覆盖范围一致），消除 hardcoded 重复

**`app/components/ai/composables/useMessageParser.ts`**：
- 第 255-261 行 hardcoded 过滤简化：只识别 `'CaseContextSyncMiddleware'`
- 旧 tag 老数据由后端 SSE 过滤掉，前端不兜底
- 前端兜底定位为"防御性最后一道关，识别新机制注入消息"，不再追求与后端等价

## 5. 缓存与异常

### 5.1 缓存策略

| 部分 | Anthropic 路径 | OpenAI / Gemini 路径 |
|---|---|---|
| SystemMessage（roleAndFlow，稳定） | content block + 顶层 `cache_control: {ttl:'1h'}` | plain text，靠自动前缀缓存 |
| 历史消息（含旧 context + ai + tool） | 自动前缀缓存（已挂的 cache_control 会延伸覆盖） | 自动前缀缓存 |
| 注入的上下文 HumanMessage（动态 4+2 段） | 不挂 cache_control（动态命中不了） | 不参与显式缓存 |

**为什么 Anthropic 必须保留 cache_control**：Anthropic 官方文档明确 "No default caching: Without `cache_control`, content is processed fresh every time"。完全砍 cache_control 会导致 Anthropic 路径每轮全量计费 SystemMessage + 历史前缀，token 成本可能翻倍。本 spec 在稳定的 roleAndFlow 段保留 1h cache_control，命中收益最大化（roleAndFlow 永不变 → 1h cache 接近 100% 命中）。

**实现复用**：项目已有 `cachedPromptToAnthropicContent`（`server/services/node/chatModelFactory.ts:274`）专门处理 content blocks + cache_control。`buildSystemPromptForAgent` 也已在 Anthropic 路径下走这条路。改造后只是简化用法：仅 roleAndFlow 一段需要包装，不再处理 4 段。

### 5.2 异常兜底全集

| 异常点 | 行为 |
|---|---|
| `buildContextSegments` 抛错 | 写 error 日志，中间件 splice 不执行，不阻塞 Agent |
| `draftLoader` 抛错 | 跳过文书段，仅注入 4 段；写 warn 日志带 draftId/sessionId |
| `draftLoader.draftValuesJSON()` 抛错 | 文书段中 currentValues 部分置空，placeholders 仍展示 |
| `recallMemoryService` 失败 | 已有 `.catch(() => [])`，回退空数组 |
| `getMaterialListWithSummariesService` 失败 | 已有 `.catch(() => [])`，回退空数组 |
| 案件软删 / 不存在 | 4 段返回空字符串 |
| `caseProcessMaterialMiddleware` 抛错 | 已有逻辑：写 error 日志后继续，不阻塞 Agent |

设计原则：上下文构建失败**绝不阻塞** Agent 启动。最坏情况是没有 context 消息被注入（前端不显示，LLM 也基本无影响）。

## 6. 改动落地清单

### 6.1 新增文件

| 文件 | 作用 |
|---|---|
| `server/agents/_shared/case-context/caseContextSync.middleware.ts` | 新中间件实现 |

### 6.2 修改文件

| 文件 | 改动内容 |
|---|---|
| `server/agents/_shared/case-context/caseContext.middleware.ts` | **删除** |
| `server/agents/case-main/agent.config.ts` | import 替换：caseContextMiddleware → caseContextSyncMiddleware |
| `server/services/agent-platform/factory/runtime.ts` | SystemMessage 构造逻辑：Anthropic SDK 用 `cachedPromptToAnthropicContent` 包 roleAndFlow + 1h cache_control 构造 SystemMessage 实例传给 createAgent；其他 SDK 仍传 plain text 字符串 |
| `server/services/workflow/agents/moduleAgent.ts` | 删 `buildSystemPromptForAgent`；按 SDK 分流构造 SystemMessage（Anthropic 单段 + cache_control / 其他 plain text）；新增 caseProcessMaterial + caseContextSync 中间件；safetyTrim 的 systemPrompt 改算 roleAndFlow |
| `server/services/workflow/agents/documentMainAgent.ts` | 同上；renderSystemPrompt 收窄；实现 draftLoader 闭包（placeholders 闭包外渲染 + values 闭包内实时查）；原 97-101 行 placeholders / values 渲染代码整体迁移；caseProcessMaterial 仅 caseId 非空时挂 |
| `server/services/agent-platform/context/injectorDetection.ts` | `INJECTOR_EXACT` 新增 `'CaseContextSyncMiddleware'`；旧 tag 保留；`getMessageInjector` 同时读 response_metadata 和 additional_kwargs |
| `server/services/agent-platform/nodeConfig/promptRenderer.ts` | `PromptRenderContext` 接口删除 `currentValuesJSON?` / `placeholdersWithHints?` 两个 dead 字段；删除 `renderSystemPrompt` 函数内对应分支（line 94-99） |
| `server/services/workflow/middleware/index.ts` | 第 9 行注释更新（"documentMainAgent 已直接调 buildSystemPromptForAgent 注入 5 段式 SystemMessage"该说法过时） |
| `server/services/workflow/agents/threadState.ts` | hardcoded 过滤改调 `isInjectedContextMessage` |
| `app/components/ai/composables/useMessageParser.ts` | hardcoded 过滤简化为只识别 `'CaseContextSyncMiddleware'` |
| `prisma/seeds/seedData.sql` | `documentMain_system` prompt content 字段：删两行占位符 + 加一句静态指引 |

### 6.3 数据级变更（dev 库）

按项目规范"直接改 dev 库 + 同步改 seedData.sql"：
- 改 dev 库 `prompts` 表 `documentMain_system` 行 `content` 字段（同 seedData.sql 改动）
- 不写 migration、不写独立 SQL 脚本

### 6.4 保持不变

| 文件 | 说明 |
|---|---|
| `server/agents/_shared/case-context/caseProcessMaterial.middleware.ts` | 三个 Agent 复用 |
| `server/services/agent-platform/context/moduleContextBuilder.ts` | `buildContextSegments` 保留供新中间件复用；`buildSystemPromptForAgent` 保留供子 Agent 用（在文件顶部加注释"⚠️ 仅供 subAgentToolFactory 使用，主 Agent 路径已迁移到 plain text + caseContextSyncMiddleware 模式"） |
| `server/services/agent-platform/subAgent/subAgentToolFactory.ts` | 子 Agent 不在改造范围 |
| `server/agents/case-module/agent.config.ts` / `server/agents/document/agent.config.ts` | 仅声明 stateGraph runner 委托，实际改造在 runModuleChat / runDocumentChat |

### 6.5 边界划分

`buildContextSegments` 维持单一职责（"按 caseId 查案件维度数据"），不加 draftSegments 参数。文书的 2 段查询通过 `draftLoader` 闭包在 `runDocumentChat` 内实现，传给 `caseContextSyncMiddleware`。

## 7. 测试策略

### 7.1 单元测试

`tests/server/agents/_shared/case-context/caseContextSync.middleware.test.ts`：
- caseId=null + draftLoader 非空 → 仅注入文书段
- caseId 非空 + draftLoader=null → 仅注入 4 段
- caseId 非空 + draftLoader 非空 → 注入 4+2 段
- draftLoader 抛错 → 仅丢失文书段，4 段照常注入
- buildContextSegments 抛错 → 中间件不阻塞 Agent，state.messages 不变
- 多轮调用 → 应每轮都新增一条注入消息（不复用历史）
- agentName='caseMain' → 注入消息含全部 7 个分析模块摘要
- agentName=moduleName → 排除该模块自身的旧版本结果
- 双轨写 metadata：response_metadata + additional_kwargs 都含 `injectedBy='CaseContextSyncMiddleware'`
- splice 在 user message 之前插入：注入消息位于 messages 数组中末尾 user 之前

### 7.2 集成测试

`tests/server/agent-platform/`：
- 三个 Agent 跑端到端，断言：
  - SystemMessage 在 Anthropic 路径下含 cache_control，其他 SDK 是 plain text
  - SystemMessage 多轮内字符串内容稳定（前缀缓存命中验证）
  - 注入的 ContextHumanMessage 出现在 checkpoint
  - SSE 流读取时被 `agentSseStream` 过滤
  - 多轮对话后 checkpoint 累积多条注入消息
- 三个 Agent 在 caseProcessMaterialMiddleware 钩子里成功扫描材料
- 文书 Agent：用户编辑 draft.values 后下轮 draftLoader 能看到最新值

### 7.3 旧测试改造

- `caseContext.middleware.test.ts`（如有）→ 改名/迁移到 caseContextSync 测试
- 模块对话/文书生成 buildSystemPromptForAgent 相关 system prompt 断言 → 改为 renderSystemPrompt + Anthropic content block 断言

### 7.4 覆盖率约束

- `caseContextSync.middleware.ts` ≥ 90%
- 其他中间件改动只新增挂载点，不改逻辑，不需要补测试

### 7.5 不需要测试的部分

- `caseProcessMaterialMiddleware` 已有测试（仅新增挂载点）
- `buildContextSegments` 已有测试（不改逻辑，仅新增调用方）
- `injectorDetection.ts` 改 INJECTOR_EXACT 集合 + 双轨字段读取 → 现有 isInjectorFromContextMiddleware 测试覆盖到（如有缺补）

## 8. 影响面与兼容性

### 8.1 向前兼容

- 历史 checkpoint 里的旧 tag 注入消息（'CaseContextMiddleware' / 'ModuleContext*' / 'CaseMaterial*'）继续被 `injectorDetection.ts` 识别和过滤
- 用户重新进入老会话不会看到注入消息
- 双轨 metadata（response_metadata + additional_kwargs）让新消息即使被 SDK 序列化丢字段也仍可被识别

### 8.2 用户体验影响

- 小索：从"首句锁定上下文"变为"每句重拉最新上下文"——用户在同会话内新加材料/重跑模块的内容会自动进入小索视野（解决了之前的痛点）
- 模块对话/文书生成：用户体验无差别（本来就是每句重拼）
- 文书生成：用户编辑草稿字段后，下一句对话仍能看到最新字段值；模型 system prompt 不再随用户编辑而变化（性能优化）

### 8.3 性能影响

- 每轮发消息增加 ~10ms 的 4 路并发查库（buildContextSegments 已有性能基准）
- Anthropic 路径：保留 SystemMessage 顶层 1h cache_control，roleAndFlow 段缓存命中接近 100% → token 成本基本不变（甚至比改造前略低，因为 4 段不再每轮重传）
- OpenAI / Gemini 路径：自动前缀缓存命中，token 成本基本不变
- 多轮对话历史会累积 N 条注入消息，每条几百到几千 token，靠 `summarizationMiddleware` 在阈值内回收
- 三个 Agent 都挂材料预处理钩子，每轮发消息会扫一次 caseMaterials 表查未处理材料；幂等跳过已处理材料，开销极小

### 8.4 监控关注点

上线后观察：
- caseAnalyses / caseMaterials 上轮变更的"立即可见性"是否符合预期
- 三个 Agent 平均 token 消耗变化（预期：Anthropic 持平、OpenAI 持平/略降）
- caseContextSyncMiddleware 异常率（应接近 0）
- Anthropic cache 命中率（应在 SystemMessage 段接近 100%）

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| splice mutation 依赖 LangGraph 不深拷贝 state | 现有 caseContextMiddleware 同款机制已生产 1 年；新中间件照搬现有模式，无新增风险点 |
| 历史 checkpoint 里的旧 tag 注入消息漏过滤 | injectorDetection.ts 保留旧 tag 兼容；agentSseStream / threadState 全部走中央判定 |
| 文书 prompt 模板修改后 LLM 行为变化 | A 方案是"挪位置不删内容"，LLM 仍能在 HumanMessage 里看到草稿字段；新增静态指引让模型知道去哪找 |
| 多轮注入累积导致 token 爆炸 | summarizationMiddleware 在阈值内自动摘要回收 |
| 双轨 metadata 仍丢字段（极端 SDK 序列化场景） | 项目记忆 `feedback_message_metadata_first.md` 提到的双轨方案对齐；如仍丢，现有 `injectorDetection.ts` 也兼容旧 tag prefix 匹配作为兜底 |

## 10. 验收标准

- [ ] 三个 Agent 跑端到端测试通过
- [ ] 小索同会话内新增材料、重跑模块结果，能立即在下一轮对话看到（用户验证）
- [ ] 模块对话/文书生成 SystemMessage 在多轮内字符串/内容稳定（前缀缓存命中验证）
- [ ] 用户编辑文书草稿字段后，文书 Agent 下一轮看到最新值
- [ ] SSE 流前端收到的消息列表不含 injectedBy='CaseContextSyncMiddleware' 的消息
- [ ] checkpoint 里能看到注入的上下文消息（用于后续审计/调试）
- [ ] 三个 Agent 启动前自动补做未处理材料；文书 Agent 仅在 caseId 非空时触发（caseId=null 时无案件材料，跳过合理）
- [ ] caseContextSyncMiddleware 单元测试覆盖率 ≥ 90%
- [ ] Anthropic 模型路径 SystemMessage 含 1h cache_control，OpenAI / Gemini 路径走 plain text 自动缓存
