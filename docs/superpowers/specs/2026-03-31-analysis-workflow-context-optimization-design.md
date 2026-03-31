# 分析工作流上下文优化设计

## 概述

优化 `caseAnalysisV2.workflow.ts` 的上下文管理，解决三个核心问题：
1. 分析模块缺少案件基本信息、材料信息、历史分析结果等上下文
2. 跨模块消息累积导致后续模块 token 膨胀
3. 单个模块内工具多轮查询可能超出模型上下文限制

## 设计约束

- 前端必须展示完整的工具调用过程（律师需要看到分析过程和证据引用以建立信任）
- 页面刷新后用户看到原始完整消息（非压缩摘要）
- 不修改积分生命周期、interrupt/resume 机制、SSE 数据流
- 遵守 `docs/init-analysis-workflow-report.md` 中的踩坑规则

## 架构：两层防御

### 第一层：模块间完全隔离

每个分析模块独立从 DB 构建完整上下文，不依赖外层 `state.messages` 或前序模块的 state 传递。

**原理**：当前每个模块的 `innerGraph.invoke()` 已经接收独立构建的 `initialMessages`，不使用外层 `state.messages`。问题在于 `initialMessages` 只包含泛化的 `"现在请开始任务：${moduleTitle}"` 和 system prompt，没有注入案件上下文。

**改造方式**：

1. 新增 `buildModuleContext` 函数，从 DB 加载四类上下文：
   - 案件基本信息（cases 表：title、plaintiff、defendant、summary、extractedInfo）
   - 案件材料上下文（复用 `getMaterialContextService` + `buildMaterialContextMessage`，含 sourceId）
   - 已完成的分析结果（caseAnalyses 表，isActive=true, status=COMPLETED）
   - 案件长期记忆（PostgresStore）

2. 将上下文合并到 system prompt 中（被 Worker 层 `stripSystemMessages` 自动过滤，不到达前端）：
   ```typescript
   const moduleContext = await buildModuleContext(state, agentName)
   const enrichedSystemPrompt = [systemPrompt, moduleContext].filter(Boolean).join('\n\n')
   const initialMessages = [
     { role: 'system', content: enrichedSystemPrompt },
     new HumanMessage(`现在请开始"${moduleTitle}"分析。`),
   ]
   ```

3. 外层 `state.messages` 继续通过 `MessagesValue` reducer 累积所有模块的消息，仅服务于前端展示和 checkpoint 恢复。

**上下文格式**：

```
## 案件基本信息
- 标题：{title}
- 案件类型：{caseType}
- 原告：{plaintiff}
- 被告：{defendant}
- 案件概述：{summary}

## 案件材料
{buildMaterialContextMessage 输出，含 sourceId}

## 已完成的分析结果
### 案件概要（summary）
{result}
### 时间线（chronicle）
{result}
...

## 案件记忆
{memory}

## 当前任务
请执行"{moduleTitle}"分析。
```

**优势**：
- 每个模块的上下文大小可预测、可控
- 从 DB 读取 active 分析结果（权威来源），不依赖 workflow state 传递
- 模块重试时自动获取最新结果
- 与坑13 教训一致——"服务端 DB 是权威数据源"

### 第二层：模块内上下文压缩（三道防线）

当单个模块的 innerGraph 在多轮工具调用后上下文膨胀时，通过三道防线控制。

**所有压缩仅影响传给 LLM 的输入，不修改 state 中的消息。前端始终看到原始完整消息。**

#### 防线1：输入端预防控制

- **材料上下文**：保持现有 `getMaterialContextService` 的统一决策逻辑（token < 32000 全量，≥ 32000 摘要）。不修改。
- **工具返回结果截断**：新增 `truncateToolResult` 函数，对工具返回值做长度控制（默认 8000 tokens），超长时截断并提示模型使用更精确的查询条件。
- **循环次数限制**：`recursionLimit` 从 1000 降低到 50。

#### 防线2：动态摘要压缩

在 innerGraph 的 `callModel` 节点中，检测消息 token 量，超过阈值时用 LLM 压缩早期工具交互轮次：

```typescript
const callModel = async (innerState) => {
  let messagesToSend = innerState.messages
  const roughEstimate = estimateMessagesTokens(innerState.messages)
  if (roughEstimate > compressThreshold) {
    messagesToSend = await compressMessages(innerState.messages, contextBudget, model)
  }
  const response = await modelWithTools.invoke(messagesToSend)
  return { messages: [response] }  // state 保留完整历史
}
```

`compressMessages` 逻辑：
1. 始终保留：system message（第一条）+ 最近 3 轮消息
2. 中间的工具调用轮次 → 用快速模型（Haiku）生成结构化摘要
3. 摘要格式：`"[工具调用摘要] 查询了案件材料《xxx》，发现：（1）...（2）..."`
4. 构建：`[system, summary_message, recent_messages...]`
5. **关键**：只影响传给模型的输入，innerState.messages 不变

#### 防线3：trimMessages 兜底

```typescript
import { trimMessages } from "@langchain/core/messages"
messagesToSend = trimMessages(messagesToSend, {
  strategy: "last",
  maxTokens: contextBudget,
  startOn: "human",
  endOn: ["human", "tool"],
  tokenCounter: model,
})
```

#### Token 计数策略

**分层计数**：
- 粗判（是否需要压缩）：字符估算（快速，复用 `estimateTokens`）
- 精确控制（实际裁剪）：`trimMessages` 的 `tokenCounter: model` 参数（使用模型 tokenizer）

#### 上下文预算

从 DB model 表的 `context_window` 字段动态获取：
- `NodeConfig` 接口新增 `modelContextWindow` 字段
- `getValidNodeConfig` / `getNodeConfigsByTypes` 补充读取 `model.contextWindow`
- 预算 = `contextWindow * 0.8`（预留 20% 给输出）
- 压缩触发阈值 = 预算 * 0.6
- 无 `context_window` 配置时默认 100K tokens

## 文件清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/services/workflow/context/moduleContextBuilder.ts` | `buildModuleContext` — 从 DB 加载案件信息/材料/分析结果/记忆，拼装为结构化上下文 |
| `server/services/workflow/context/messageCompressor.ts` | `compressMessages` — 动态摘要压缩 + trimMessages 兜底 + token 估算 |
| `server/services/workflow/context/toolResultTruncator.ts` | `truncateToolResult` — 工具返回结果截断 |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `server/services/workflow/caseAnalysisV2.workflow.ts` | `createAnalysisNode`：(1) 调用 `buildModuleContext` (2) 合并到 system prompt (3) callModel 加压缩逻辑 (4) recursionLimit 降到 50 |
| `server/services/node/node.service.ts` | `NodeConfig` 新增 `modelContextWindow`；构建逻辑补充读取 `model.contextWindow` |
| `server/services/workflow/tools/searchCaseMaterials.tool.ts` | 工具返回结果调用 `truncateToolResult` 截断 |

### 不修改的文件

| 文件 | 原因 |
|------|------|
| `server/services/material/materialPipeline.service.ts` | 直接复用 `getMaterialContextService` / `buildMaterialContextMessage` / `estimateTokens` |
| `server/services/case/initAnalysis.service.ts` | 直接复用 `loadCompletedResultsService` |
| `server/services/agent/agentWorker.ts` | `stripSystemMessages` 已有，自动过滤 enriched system prompt |
| `app/composables/useInitAnalysis.ts` | 前端无需改动 |
| `server/api/v1/case/init-analysis.post.ts` | SSE 端点无需改动 |

## 数据流

```
每个模块执行时：

1. buildModuleContext(state, moduleName)
   ├─ getCaseBasicInfo(caseId)             → DB cases 表
   ├─ getMaterialContextService(materials)  → 材料 full/summary（含 sourceId）
   ├─ loadCompletedResultsService(caseId)   → DB caseAnalyses 表
   └─ getCaseMemory(caseId)                → PostgresStore

2. enrichedSystemPrompt = systemPrompt + moduleContext
   └─ Worker stripSystemMessages 自动过滤，不到达前端

3. innerGraph 执行
   ├─ initialMessages: [system(enriched), human(short task)]
   ├─ callModel: 粗判 token → 超阈值时 compressMessages → trimMessages 兜底
   ├─ tools: truncateToolResult 截断超长返回
   └─ 循环直到完成（recursionLimit=50）

4. return { messages: responseMessages, result: {...} }
   └─ 外层 state 累积完整原始消息（前端展示 + checkpoint 恢复）
```

## 踩坑合规检查

| 坑 | 设计合规性 |
|----|-----------|
| 坑1（interrupt 不能被 catch） | `buildModuleContext` / `compressMessages` 不含 interrupt 调用，无影响 |
| 坑2（values 流不含 __interrupt__） | 不涉及 interrupt 数据传递 |
| 坑6（先持久化再扣积分） | 积分生命周期不变 |
| 坑7（selectedModules 丢失） | 不涉及 selectedModules 恢复 |
| 坑8（SSE replay 性能） | 外层消息量不变（仍累积），但 SSE replay 只发 values 快照，已有优化 |
| 坑13（刷新后模块状态消失） | session.metadata 权威来源不变 |
| 坑14（系统消息泄露） | moduleContext 合并到 system prompt，被 stripSystemMessages 过滤 |
