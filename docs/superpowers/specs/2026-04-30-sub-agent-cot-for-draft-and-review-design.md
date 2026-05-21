# 子代理工具 Chain of Thought 接入：draft_document / review_contract

**日期：** 2026-04-30
**作者：** AI 协作 + 戴鑫
**状态：** Approved（5 维度审查后修订）

## 修订记录

- v2（5check 后）：
  - 修硬伤：tool 返回 JSON 加 `subSessionId` 字段，extractor 从 JSON 顶层取，不再依赖 href（href 是用户跳转链接，里面的 sessionId 是主 caseMain sessionId，不是子流 sessionId）
  - 减项：删除 `buildSubAgentCallbacks.test.ts` 独立测试文件——helper 行为通过 `subAgentToolFactory.test.ts` 现有 case + `draftDocument.test.ts` / `reviewContract.test.ts` 新加 case 间接覆盖
  - 减项：3 项 E2E 合并为 1 项综合链路（跑中→折叠→历史恢复→错误反馈）
  - 用户决策：保留 `handleChainError` 补漏（"一并修不留问题到后面"）
  - 用户决策：保留 `buildSubAgentCallbacks` DRY helper

## 背景与问题

用户在小索点击「使用此模板」后，文书生成子流（documentMain）跑约 30 秒才返回结果。这 30 秒里 UI 只显示「思考中… 已思考 N 秒」计时，没有任何反馈：用户不知道在搜什么、调什么 tool、是不是卡死。

线上观察：

1. caseMain 调 `draft_document` 工具
2. 工具内部 `interrupt()` 让用户选模板
3. 用户点「使用此模板」→ resume
4. 工具内部同步调 `runDocumentChat`（启动 documentMain 子流跑 search_case_analysis / search_law / process_materials / 起草 JSON 等）
5. **30 秒黑盒**——主流前端只看到 isLoading=true
6. 子流跑完 → 返回 `success: true, summary, ...` → 主流 ToolMessage 到达 → DraftDocumentCard 显示「已完成起草《...》X/Y 字段」

`review_contract`（合同审查）走同款路径，同款问题。

## 既有基建摸底

`ask_*_expert`（caseAnalysis 7 个分析子代理）已经有完整的 Chain of Thought 可视化：

| 层 | 实现 | 文件 |
|---|---|---|
| 前端 ai-elements/chain-of-thought/* | 开源组件 | `app/components/ai-elements/chain-of-thought/*` |
| `SubAgentChainOfThought.vue` | 包装组件，含 auto-collapse / failed / duration | `app/components/ai/SubAgentChainOfThought.vue` |
| `mapMessagesToSteps` | 把 BaseMessage[] 拆成 Step（thinking / analysis / tool_call / conclusion） | `app/components/ai/composables/mapMessagesToSteps.ts` |
| `useStreamChat.subThreadsMap` | 按 `parentToolCallId` 分桶累积子流事件 | `app/composables/useStreamChat.ts` |
| `useStreamChat.handleAgentEvent` | 消费 SUB_AGENT_TOKEN/TOOL_START/TOOL_END/STATUS_CHANGE 协议 | 同上 |
| 后端 `subAgentToolFactory` | LangChain `agent.invoke({callbacks})` 旁路 publishCustomEvent | `server/services/agent-platform/subAgent/subAgentToolFactory.ts` |
| `loadSubAgentThreads` 历史恢复 | 通过命名规则 `${sessionId}_sub_${safeName}` 反查子 thread | `server/services/workflow/agents/threadState.ts` |
| `AiToolRenderer.isSubAgentTool` 路由 | **只匹配 `ask_*_expert`** | `app/components/ai/AiToolRenderer.vue` |

**根因**：CoT 设计可用，但 `draft_document` / `review_contract` 走的是 `runDocumentChat + runAndDrainStream` 路径，**完全没接入这套基建**——既没 callbacks 旁路，AiToolRenderer 也不识别这两个 tool name。

## 目标

把 `draft_document` 和 `review_contract` 接入既有 CoT 基建，让用户：

1. **跑中实时看到子流进度**：thinking 内容、调过的工具（search_case_analysis / search_law / process_materials / 起草 JSON）
2. **跑完自动折叠**：CoT 1 秒后折叠成一行（`已完成 N 步操作`），下方挂上原有 `DraftDocumentCard` / `ReviewContractCard`
3. **失败显式可见**：子流抛错时 CoT header 红徽章显示 failureReason，不自动折叠
4. **刷新历史恢复**：刷新后 CoT 重新展开历史 messages（含 thinking），跟现场跑过一样

## 非目标

- 不改 LangGraph callbacks 协议（`SUB_AGENT_TOKEN/TOOL_START/TOOL_END` 沿用）
- 不动 `SubAgentChainOfThought.vue` 组件实现（包括 auto-collapse / failed / duration 行为）
- 不改 `mapMessagesToSteps`（已支持 thinking）
- 不引入新的 DB 表（不 schema migration）
- 不解决"子流模型偶发 broken JSON"等业务侧问题（独立 commit）

## 架构

### 跑中实时反馈

```
draftDocument.tool（caseMain 主流上下文）
   │
   ├── 1. interrupt() → 用户选模板 → resume
   ├── 2. createDraftService → subSessionId（caseSessions 行 scope=document）
   ├── 3. runDocumentChat(subSessionId, undefined, { callbacks })  ← 新加 callbacks 选项
   │       └── agent.stream(input, { ..., callbacks })
   │             ↓ LangChain 自动调用
   │       handleLLMNewToken（含 thinking delta）
   │       handleToolStart   (search_case_analysis 等)
   │       handleToolEnd
   │       handleChainEnd
   │       handleChainError
   │             ↓ 旁路 publishCustomEvent
   │       SUB_AGENT_TOKEN / SUB_AGENT_TOOL_START / SUB_AGENT_TOOL_END
   │       publishStatusChange status='completed' / 'failed'
   │             metadata: { parentToolCallId, agentName, threadId: subSessionId }
   │
   └── 4. runAndDrainStream（drain 主流，跟旁路独立——两条路径互不阻塞）

      ↓ 主流 SSE 推到前端
useStreamChat.handleAgentEvent
   ├── 按 metadata.parentToolCallId 分桶
   └── subThreadsMap[parentToolCallId] = { agentName, threadId, messages, status }

      ↓ AiToolRenderer 识别 draft_document / review_contract
   <SubAgentChainOfThought :sub-messages :is-running :is-failed :failure-reason />  跑中
   <DraftDocumentCard ... />  state=output-available 后追加
```

### 历史恢复

```
GET /api/v1/case/analysis/thread/[sessionId]
   ↓
loadSubAgentThreads(sessionId, messages)
   ├── 旧规则：识别 ask_*_expert tool_call → ${sessionId}_sub_${safeName}
   └── 新规则：识别 draft_document / review_contract tool_call
        ├── 找配对 ToolMessage by tool_call.id
        ├── parse content JSON：从顶层拿 subSessionId（tool 返回时显式带）
        │     ⚠️ 不能从 href 抠：href 里 sessionId 是主 caseMain sessionId，
        │        给前端跳转用，跟子流 thread_id 是两回事
        ├── checkpointer.getTuple({ thread_id: subSessionId }) → channel_values.messages
        └── 加入 subAgentThreads 数组返回
   ↓
前端 useStreamChat 初始化时灌入 subThreadsMap
   ↓
AiToolRenderer 渲染 SubAgentChainOfThought（is-running=false → 自动折叠）
```

## 实施细节

### 1. 新建 `buildSubAgentCallbacks` helper

`server/services/agent-platform/subAgent/buildSubAgentCallbacks.ts`：

```typescript
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'
import { publishCustomEvent, publishStatusChange } from '~~/server/services/agent/agentEventBridge'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { logger } from '#shared/utils/logger'

export interface BuildSubAgentCallbacksOptions {
    /** 主 run id（caseMain ctx.runId） */
    mainRunId: string
    /** 主 session id（caseMain sessionId） */
    sessionId: string
    /** 主 tool_call.id（前端按此分桶） */
    parentToolCallId: string
    /** 子 Agent 显示名（如 'documentMain' / 'contractReviewMain'） */
    agentName: string
    /** 子 thread id */
    subThreadId: string
}

/**
 * 构造 LangChain Callbacks，旁路把子 Agent 内部事件转发到主 SSE 流。
 *
 * 对接 useStreamChat.subThreadsMap：metadata.parentToolCallId 是分桶 key，
 * 前端按 toolCall.id 命中并累积 messages，让 SubAgentChainOfThought 自动渲染。
 */
export function buildSubAgentCallbacks(opts: BuildSubAgentCallbacksOptions): CallbackHandlerMethods[] {
    const { mainRunId, sessionId, parentToolCallId, agentName, subThreadId } = opts
    const meta = { agentName, threadId: subThreadId, parentToolCallId }

    return [{
        async handleLLMNewToken(token, _idx, cbRunId) {
            await publishCustomEvent({
                type: 'custom_event', runId: mainRunId, sessionId,
                name: SSECustomEventType.SUB_AGENT_TOKEN,
                data: undefined,
                metadata: { ...meta, messageId: cbRunId, delta: token },
            }).catch(e => logger.warn('publish SUB_AGENT_TOKEN failed', { e }))
        },
        async handleToolStart(_tool, input, cbRunId, _p, _t, _m, _n, innerToolCallId) {
            await publishCustomEvent({
                type: 'custom_event', runId: mainRunId, sessionId,
                name: SSECustomEventType.SUB_AGENT_TOOL_START,
                data: { innerToolCallId, input, cbRunId },
                metadata: meta,
            }).catch(e => logger.warn('publish SUB_AGENT_TOOL_START failed', { e }))
        },
        async handleToolEnd(output, cbRunId) {
            await publishCustomEvent({
                type: 'custom_event', runId: mainRunId, sessionId,
                name: SSECustomEventType.SUB_AGENT_TOOL_END,
                data: { cbRunId, output },
                metadata: meta,
            }).catch(e => logger.warn('publish SUB_AGENT_TOOL_END failed', { e }))
        },
        async handleChainEnd(_outputs, _cbRunId, cbParentRunId) {
            // 仅 root chain（无 parent）才视为整个子流结束
            if (cbParentRunId !== undefined) return
            await publishStatusChange({
                type: 'status_change', runId: mainRunId, sessionId,
                status: 'completed',
                metadata: meta,
            }).catch(e => logger.warn('publish sub_agent completed failed', { e }))
        },
        async handleChainError(error, _cbRunId, cbParentRunId) {
            // 旧 subAgentToolFactory 漏了此 handler，本次 DRY 时补齐
            if (cbParentRunId !== undefined) return
            const message = error instanceof Error ? error.message : String(error)
            await publishStatusChange({
                type: 'status_change', runId: mainRunId, sessionId,
                status: 'failed',
                error: message,
                metadata: meta,
            }).catch(e => logger.warn('publish sub_agent failed event failed', { e }))
        },
    }]
}
```

### 2. 改造 `subAgentToolFactory.ts` 调用 helper（DRY）

把第 200-280 行原地内联的 callbacks 数组替换为：

```typescript
const result = await agent.invoke(
    { messages: initialMessages },
    {
        configurable: { thread_id: subThreadId },
        recursionLimit: 1000,
        callbacks: buildSubAgentCallbacks({
            mainRunId,
            sessionId: context.sessionId,
            parentToolCallId,
            agentName: nodeConfig.name,
            subThreadId,
        }),
    },
)
```

> **行为变化**：原来漏的 `handleChainError` 现在会触发——以前 `ask_*_expert` 子代理抛错时主流可能没收到 sub_agent failed status_change，现在会收到。验证：检查 useStreamChat.handleAgentEvent 对 sub failed 事件的处理（应该只更新 subThreadsMap[id].status='failed' + .error，不影响主 runStatus）。

### 3. `runDocumentChat` 透传 callbacks

`server/services/workflow/agents/documentMainAgent.ts`：

```typescript
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'

export interface DocumentAgentOptions {
    userId: number
    caseId?: number
    signal?: AbortSignal
    command?: unknown
    /**
     * 子流事件 forward 到主流的 callbacks。draftDocument.tool 调用时传入
     * （buildSubAgentCallbacks 构造），让 documentMain 内部的 LLM/tool 事件
     * 旁路 publish 给前端 subThreadsMap 渲染 CoT。
     */
    callbacks?: CallbackHandlerMethods[]
}

export async function runDocumentChat(...): Promise<ReadableStream<Uint8Array>> {
    // ...
    return agent.stream(input, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 1000,
        signal,
        callbacks: options.callbacks,  // ← 新加
    })
}
```

`server/services/workflow/agents/contractReviewMainAgent.ts` 同款改造。

### 4. `draftDocument.tool.ts` 构造并注入 callbacks + 返回 JSON 加 subSessionId

```typescript
// 在 createDraftService 拿到 subSessionId 之后
import { buildSubAgentCallbacks } from '~~/server/services/agent-platform/subAgent/buildSubAgentCallbacks'

const callbacks = buildSubAgentCallbacks({
    mainRunId: runId,
    sessionId,                     // 主 caseMain sessionId
    parentToolCallId: toolCallId,  // 主 tool_call.id
    agentName: 'documentMain',
    subThreadId: subSessionId,     // documentMain 子 sessionId
})

const stream = await runDocumentChat(subSessionId, undefined, {
    userId,
    caseId: caseId ?? undefined,
    signal: undefined,
    callbacks,  // ← 新加
})

// ...drain + DRAFT_SAVED publish 等已有逻辑

// 返回 JSON 多加一个 subSessionId 字段（历史恢复时用）
return JSON.stringify({
    success: true,
    draftId,
    title,
    summary,
    href,                       // 用户跳转链接，里面 sessionId 是主流（不变）
    subSessionId: subSessionId, // ← 新加：documentMain 子 thread_id，给 loadSubAgentThreads 用
    templateId,
    templateName: template?.name ?? null,
    filledFieldCount,
    totalFields,
})
```

`reviewContract.tool.ts` 同款改造：agentName='contractReviewMain'，subThreadId 来自 createReviewService，**返回 JSON 也加 `subSessionId`**。

### 5. `loadSubAgentThreads` 扩展历史恢复

`server/services/workflow/agents/threadState.ts`：

```typescript
export async function loadSubAgentThreads(
    sessionId: string,
    messages: Record<string, unknown>[],
): Promise<SubAgentThread[]> {
    const checkpointer = await getCheckpointer()
    const subAgentThreads: SubAgentThread[] = []

    // 预建 tool_call_id → ToolMessage 索引（用于反查子 sessionId）
    const toolResultMap = new Map<string, Record<string, unknown>>()
    for (const m of messages) {
        if (m.type === 'tool' && typeof m.tool_call_id === 'string') {
            toolResultMap.set(m.tool_call_id, m)
        }
    }

    for (const msg of messages) {
        if (msg.type !== 'ai' || !Array.isArray(msg.tool_calls)) continue

        for (const toolCall of msg.tool_calls as any[]) {
            const toolName = toolCall.name as string
            let subThreadId: string | null = null
            let agentName: string

            if (toolName?.startsWith('ask_') && toolName?.endsWith('_expert')) {
                // 旧逻辑：命名规则反推
                const safeName = toolName.slice(4, -7)
                subThreadId = `${sessionId}_sub_${safeName}`
                agentName = safeName
            }
            else if (toolName === 'draft_document' || toolName === 'review_contract') {
                // 新逻辑：从配对 ToolMessage.content JSON 顶层 subSessionId 字段拿
                // （href 里的 sessionId 是主 caseMain sessionId 不能用）
                const result = toolResultMap.get(toolCall.id as string)
                subThreadId = extractSubSessionIdFromToolResult(result)
                agentName = toolName === 'draft_document' ? 'documentMain' : 'contractReviewMain'
                if (!subThreadId) continue  // tool 取消 / 失败时返回 JSON 不含 subSessionId，跳过
            }
            else {
                continue
            }

            try {
                const subTuple = await checkpointer.getTuple({
                    configurable: { thread_id: subThreadId },
                })
                if (!subTuple) continue
                const subRawMessages = (subTuple.checkpoint.channel_values as any)?.messages
                if (!Array.isArray(subRawMessages) || subRawMessages.length === 0) continue

                const filteredMessages = subRawMessages
                    .map(messageToFlatDict)
                    .filter(msg => {
                        if (msg.type === 'system') return false
                        const meta = msg.response_metadata as { injectedBy?: string } | undefined
                        if (meta?.injectedBy) return false
                        return true
                    })
                subAgentThreads.push({
                    toolCallId: toolCall.id as string,
                    agentName,
                    threadId: subThreadId,
                    messages: filteredMessages,
                })
            }
            catch (error) {
                logger.warn(`加载子代理 thread 失败: ${subThreadId}`, {
                    error: error instanceof Error ? error.message : '未知错误',
                })
            }
        }
    }
    return subAgentThreads
}

/**
 * 从 ToolMessage.content（JSON 字符串）顶层 subSessionId 字段读子 thread id。
 *
 * draftDocument.tool / reviewContract.tool 在返回 JSON 时显式带这个字段：
 *   { success: true, draftId, ..., subSessionId: '<documentMain thread_id>' }
 *
 * 不能用 href 里的 sessionId——那是 UI 跳转链接里用户回到主对话的 sessionId（caseMain），
 * 跟子流 thread_id 是两回事。tool 取消 / 失败时返回 JSON 不含 subSessionId，返回 null 跳过。
 */
function extractSubSessionIdFromToolResult(toolMsg: Record<string, unknown> | undefined): string | null {
    if (!toolMsg) return null
    const content = toolMsg.content
    if (typeof content !== 'string') return null
    try {
        const parsed = JSON.parse(content) as { subSessionId?: unknown }
        return typeof parsed.subSessionId === 'string' && parsed.subSessionId.length > 0
            ? parsed.subSessionId
            : null
    }
    catch {
        return null
    }
}
```

### 6. `AiToolRenderer.vue` 路由扩展

```vue
<script setup lang="ts">
const SUB_AGENT_LIKE_TOOLS = new Set(['draft_document', 'review_contract'])

function isLegacySubAgentTool(name: string): boolean {
    return name.startsWith('ask_') && name.endsWith('_expert')
}
function isSubAgentTool(name: string): boolean {
    return isLegacySubAgentTool(name) || SUB_AGENT_LIKE_TOOLS.has(name)
}
function subAgentTitleFromName(name: string): string {
    if (isLegacySubAgentTool(name)) {
        return name.replace(/^ask_/, '').replace(/_expert$/, '').replace(/_/g, ' ')
    }
    if (name === 'draft_document') return '文书生成'
    if (name === 'review_contract') return '合同审查'
    return name
}

// 守卫：仅在有数据或正在跑时显示 CoT，避免 cancelled tool 显示空 CoT
const shouldShowSubAgentCoT = computed(() => {
    if (!SUB_AGENT_LIKE_TOOLS.has(props.toolCall.name)) return false
    return subAgentMessages(props.toolCall.id).length > 0
        || subAgentIsRunning(props.toolCall.id)
})
</script>

<template>
  <template v-if="isInterruptToolCardCall">
    <!-- 既有 interrupt 工具卡分支不变 -->
  </template>

  <!-- 新加：sub-agent-like 工具双卡共存（CoT 在前，DraftDocumentCard / ReviewContractCard 在后） -->
  <template v-else-if="shouldShowSubAgentCoT">
    <SubAgentChainOfThought
      :agent-title="subAgentTitleFromName(toolCall.name)"
      :sub-messages="subAgentMessages(toolCall.id)"
      :is-running="subAgentIsRunning(toolCall.id)"
      :is-failed="subAgentIsFailed(toolCall.id)"
      :failure-reason="subAgentError(toolCall.id)"
    />
    <component
      v-if="toolCall.state === 'output-available' && toolMap?.[toolCall.name]"
      :is="toolMap[toolCall.name]"
      :tool-name="toolCall.name"
      :input="toolCall.args"
      :output="toolCall.result"
      :state="toolCall.state"
    />
  </template>

  <!-- 既有 toolMap 优先分支：draft_document / review_contract 上面已命中 -->
  <component v-else-if="toolMap?.[toolCall.name]" ... />

  <!-- 既有 ask_*_expert 分支保持不变 -->
  <SubAgentChainOfThought v-else-if="isLegacySubAgentTool(toolCall.name)" ... />

  <!-- 其余 toolMap fallback 不变 -->
</template>
```

## 错误处理与边界

### 子流抛错传播链

```
documentMain graph 抛错 → handleChainError → publishStatusChange status='failed', error=msg
  → useStreamChat.handleAgentEvent 收到带 metadata.parentToolCallId 的 status_change
  → subThreadsMap[id].status = 'failed', .error = errorMessage
  → AiToolRenderer 把 isFailed / failureReason 透传给 SubAgentChainOfThought
  → 卡片：禁用 auto-collapse，header 红徽章 + failureReason 文字
```

`useStreamChat.handleAgentEvent` 已按 `metadata.parentToolCallId` 分流（带 parent 的 status_change 只进 sub bucket，不影响主 runStatus）。

### callbacks 旁路失败 vs drain 主路径

子流事件 `publishCustomEvent` 是 fire-and-forget 加 `.catch` 兜底，即使 publish 全失败，`runAndDrainStream` 仍正确拿到 finalState 和 ToolMessage。callback 旁路死掉只是 UI 看不到 CoT，不影响业务返回值——这是 `agent-platform.md` 铁律「stream 与 invoke 职责分离」的精神。

### 历史恢复边界

| 场景 | tool_call | ToolMessage | 行为 |
|---|---|---|---|
| 正常完成 | draft_document tool_call | content JSON 含 `success:true, href: ...?sessionId=X` | 抠 sessionId → 加载子 thread → CoT 恢复 |
| 用户取消 | draft_document tool_call | content `{success:false, cancelled:true}`，无 href | `extractSubSessionIdFromHref` 返回 null → 跳过加载，仅 toolCard 显示取消态 |
| interrupt 中刷新 | draft_document tool_call | **无** ToolMessage（graph 暂停） | toolResultMap 命中 false → 跳过加载 + interrupt 卡片走原路径 |
| graph 抛错 | draft_document tool_call | content 是 error string / 解析 JSON 失败 / 无 href | 跳过；或解析成功但子 thread checkpoint 没消息 → 跳过 |
| 子 sessionId 在 checkpointer 找不到 | 任意 | href 有 sessionId 但 getTuple 返回 null | catch 块吞错 + logger.warn → 跳过 |

任何一步失败都不阻塞主 thread 加载（已 try/catch 包裹）。

### cancelled tool 不显示 CoT

`shouldShowSubAgentCoT` 守卫：subMessages 为空且 isRunning=false 时不渲染 CoT 卡——避免 cancelled tool 显示空白卡。

## 测试策略

### 后端

**A. `buildSubAgentCallbacks` 通过既有调用方间接覆盖**（不为 helper 单独建测试文件）

- 既有 `tests/server/agent-platform/subAgent/subAgentToolFactory.test.ts` 跑通 = DRY 替换等价（含 handleLLMNewToken / handleToolStart/End / handleChainEnd 路径）
- 新加调用方 `tests/server/agent-platform/tools/draftDocument.test.ts` / `reviewContract.test.ts` 加 case 验证 callbacks 注入正确 + handleChainError 路径（用 mock LangChain handler 触发 chain error → 验证 publishStatusChange status='failed'）

**B. `loadSubAgentThreads` 扩展单测**（扩展 `tests/server/workflow/threadState.test.ts`）

- draft_document tool_call + 配对 ToolMessage JSON 含 subSessionId → 加载子 thread
- draft_document tool_call + ToolMessage JSON 无 subSessionId（cancelled）→ 跳过
- draft_document tool_call **无**配对 ToolMessage（interrupt 状态）→ 跳过
- ToolMessage 含 subSessionId 但 checkpointer.getTuple 返回 null → catch 跳过，不影响其他 toolCall
- 混合 ask_*_expert + draft_document → 两套规则并存，结果都返回

**C. `runDocumentChat` 透传 callbacks 单测**（扩展 `tests/server/workflow/agents/documentMainAgent.test.ts`）

- 不传 callbacks（向后兼容）→ stream 正常
- 传 callbacks → mock LangChain agent.stream 验证选项含 callbacks

**D. `extractSubSessionIdFromToolResult` 纯函数单测**（含在 threadState.test.ts）

- ToolMessage JSON 含 subSessionId（合法字符串）→ 返回该 id
- ToolMessage JSON 无 subSessionId 字段 → null
- ToolMessage.content 不是合法 JSON → null（catch JSON.parse）
- ToolMessage 不存在（toolResultMap 没命中）→ null

### 前端

**E. `AiToolRenderer` 双卡渲染单测**（扩展 `tests/app/components/ai/AiToolRenderer.test.ts`）

- toolCall.name='draft_document' + state='input-available' + subThread isRunning → 仅 SubAgentChainOfThought
- toolCall.name='draft_document' + state='output-available' + subThread 有 messages → CoT + DraftDocumentCard，CoT 在前
- toolCall.name='draft_document' + state='output-available' + subThread 空（cancelled）→ 仅 DraftDocumentCard（CoT 不显示）
- toolCall.name='ask_caseInfoCheck_expert' → 走 legacy 分支（回归保护）
- isInterruptToolCardCall 优先级最高：active 状态下不被 SUB_AGENT_LIKE 抢渲染

**F. `subAgentToolFactory` DRY 后等价回归 + handleChainError 新增**

- 现有 `subAgentToolFactory.test.ts` 跑通（不改测试，验证替换 callbacks 实现等价）
- 加 1 case：mock 子代理 chain 抛错 → 验证 publishStatusChange status='failed' 被调用（handleChainError 旧版漏的，本次 DRY 时补上）

### E2E（chrome-devtools，1 项综合链路）

**G. 综合链路验收**：在小索发"起草起诉状" → 选模板 →
1. 跑中：CoT 卡片显示 thinking + search/检索 tool 调用
2. 跑完 1 秒：CoT 折叠成一行，下方 DraftDocumentCard 显示"已完成起草《...》X/Y 字段"
3. **F5 刷新**：CoT 历史回放（含 thinking）+ 自动折叠 + DraftDocumentCard 同时存在
4. 触发错误（手动 kill documentMain 的 API key 临时模拟）：CoT 红徽章 + failureReason，不折叠；上方主流不被影响（caseMain 仍能继续对话）

## 改动总览

| 文件 | 改动 | 行数 |
|---|---|---|
| `server/services/agent-platform/subAgent/buildSubAgentCallbacks.ts` | 新建 | +80 |
| `server/services/agent-platform/subAgent/subAgentToolFactory.ts` | 替换原地 callbacks 调用 helper（DRY） | -50 / +5 |
| `server/services/workflow/agents/documentMainAgent.ts` | 加 callbacks 选项透传 | +3 |
| `server/services/workflow/agents/contractReviewMainAgent.ts` | 同上 | +3 |
| `server/services/agent-platform/tools/draftDocument.tool.ts` | 调 buildSubAgentCallbacks 传给 runDocumentChat | +10 |
| `server/services/agent-platform/tools/reviewContract.tool.ts` | 同上 | +10 |
| `server/services/workflow/agents/threadState.ts` | loadSubAgentThreads 扩展 + extractSubSessionIdFromHref | +60 |
| `app/components/ai/AiToolRenderer.vue` | 扩展 isSubAgentTool / 新 v-else-if 分支 / 守卫 | +30 |
| 测试文件（新建 + 扩展） | 见测试策略 | +200 |

**净改动**：~350 行代码 + ~200 行测试，无 schema migration。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| `subAgentToolFactory` DRY 后行为变化（新 handleChainError 触发） | 跑现有 `subAgentToolFactory.test.ts` 回归 + e2e 触发一次 ask_*_expert 失败手测 |
| `runDocumentChat` 加 callbacks 选项影响既有调用（dashboard 文书生成路径调用） | callbacks 是可选参数，旧调用方不传保持原行为；加单测覆盖 |
| LangGraph callbacks 在 stream 模式行为可能与 invoke 模式不同 | 验证：`agent.stream(input, { callbacks })` 是否触发 handleLLMNewToken/ToolStart/ToolEnd（实施 Task 1 第一步先做 spike） |
| `extractSubSessionIdFromHref` 路径脆弱（依赖 href 格式不变） | 加单测覆盖各种格式；href 由项目自己控制（draftDocument.tool.ts:204 / reviewContract.tool.ts），变动需要同步改 extractor |
| 历史回放 CoT 时可能与"interrupt 卡片恢复"路径冲突 | shouldShowSubAgentCoT 守卫 + isInterruptToolCardCall 优先级最高，已经在 v-if 链最前 |

## 后续工作（不在本 spec 范围）

- 子流 token-level 流式渲染优化（当前 thinking delta 累积到完整 chunk 后才出现于 messages 帧；如需 token-by-token 滚动需要前端额外处理 SUB_AGENT_TOKEN delta）
- 子流嵌套（documentMain 内部又调子代理工具）的多级 CoT 展示
- 跨 panel 通用化：通用问答（assistantChat）走 draft_document / review_contract 时的 CoT 接入（路径相似，本次先聚焦小索）

## 决策记录

- **Q：cancelled tool 显示空白卡 vs 不显示？** A：不显示（`shouldShowSubAgentCoT` 守卫），更干净，工具卡自身已能传达 cancelled 语义。
- **Q：`handleChainError` 是否补漏？** A：补，DRY 抽出来时一并补上，行为变化通过测试 + e2e 验证。
- **Q：历史恢复是否本次包含？** A：包含。改动中等（loadSubAgentThreads + extractor + 测试），跟"跑中反馈"共享同一套基建，分两次做反而有 churn。
- **Q：是否引入新表 `agent_sub_threads` 显式索引？** A：不引入。tool_call → ToolMessage.href 反查路径足够鲁棒（href 由项目自己控制）；新表带 schema migration，性价比低。
