# 子代理工具 Chain of Thought 接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 把 `draft_document` / `review_contract` 子代理工具接入既有 `ask_*_expert` 用的 Chain of Thought 基建，让用户在子流跑中（30 秒黑盒）能看到 thinking + 工具调用进度，跑完自动折叠 + 历史恢复。

**Architecture：** 抽 `buildSubAgentCallbacks` helper（DRY 现有 `subAgentToolFactory` 内联 callbacks，并补 `handleChainError`），让 `runDocumentChat` / `runContractReviewChat` 接受 `callbacks` 选项透传给 `agent.stream`，工具内构造 callbacks 让子流 LangChain 事件旁路 publish 给主 SSE 流。前端 `AiToolRenderer` 新增 `SUB_AGENT_LIKE_TOOLS` 路由分支 + `shouldShowSubAgentCoT` 守卫，让 `<SubAgentChainOfThought>` + 既有结果卡（DraftDocumentCard / ReviewContractCard）双卡共存。`loadSubAgentThreads` 扩展从 ToolMessage JSON 顶层 `subSessionId` 字段反查子 thread。

**Tech Stack：** TypeScript / Vue 3 / Nuxt 4 / LangChain (`@langchain/core/callbacks/base`) / LangGraph (`@langchain/langgraph`) / Vitest / @vue/test-utils。

**spec：** `docs/superpowers/specs/2026-04-30-sub-agent-cot-for-draft-and-review-design.md`

---

## 文件结构

| 文件 | 改动类型 | 责任 |
|---|---|---|
| `server/services/agent-platform/subAgent/buildSubAgentCallbacks.ts` | **新建** | 构造 LangChain `CallbackHandlerMethods[]`，把子流 LLM token / tool start/end / chain end/error 旁路 publish 到主 SSE 流（带 `parentToolCallId` metadata）|
| `server/services/agent-platform/subAgent/subAgentToolFactory.ts` | 修改 | 把内联 callbacks（line 204-274）替换为调 `buildSubAgentCallbacks(...)`；行为变化：补齐 `handleChainError`（旧版漏） |
| `server/services/workflow/agents/documentMainAgent.ts` | 修改 | `DocumentAgentOptions` 加 `callbacks?: CallbackHandlerMethods[]`；`agent.stream` 调用合并 `options.callbacks` 与现有 `createErrorTraceHandler` 数组 |
| `server/services/workflow/agents/contractReviewMainAgent.ts` | 修改 | `ContractReviewAgentOptions` 加 `callbacks?`；`agent.stream` 透传（**仅首轮 stance interrupt 路径生效**——skipStanceInterrupt=true 时是 ReadableStream 自构造路径，callbacks 不会触发；plan 决策记录 explicit 说明） |
| `server/services/agent-platform/tools/draftDocument.tool.ts` | 修改 | 调 `buildSubAgentCallbacks` 构造 callbacks 传给 `runDocumentChat`；返回 JSON 加 `subSessionId` 字段（历史恢复用） |
| `server/services/agent-platform/tools/reviewContract.tool.ts` | 修改 | 同 `draftDocument.tool.ts`，agentName='contractReviewMain' |
| `server/services/workflow/agents/threadState.ts` | 修改 | `loadSubAgentThreads` 加 `draft_document` / `review_contract` 分支，从 ToolMessage JSON 顶层 `subSessionId` 字段反查子 thread；新增纯函数 `extractSubSessionIdFromToolResult` |
| `app/components/ai/AiToolRenderer.vue` | 修改 | 新增 `SUB_AGENT_LIKE_TOOLS` 集合 + `isSubAgentTool` 扩展 + `shouldShowSubAgentCoT` 守卫；新 v-else-if 双卡共存分支（CoT 在前，结果卡在后）；保留 `ask_*_expert` legacy 分支 |
| `tests/server/agent-platform/subAgent/buildSubAgentCallbacks.test.ts` | **新建** | helper 5 个 handler 单测（覆盖率铁律：agent-platform/** ≥90%，**保留独立测试文件**） |
| `tests/server/agent-platform/subAgent/subAgentToolFactory.test.ts` | 扩展 | 新增 1 case：mock chain 抛错 → 验证 publishStatusChange status='failed' 被调用 |
| `tests/server/agent-platform/tools/draftDocument.test.ts` | 扩展 | 新增 case：验证 callbacks 注入正确 + 返回 JSON 含 subSessionId |
| `tests/server/agent-platform/tools/reviewContract.test.ts` | 扩展 | 新增 case：验证 callbacks 注入正确 + 返回 JSON 含 subSessionId |
| `tests/server/workflow/agents/documentMainAgent.test.ts` | 扩展 | 新增 case：不传 callbacks（向后兼容）+ 传 callbacks（合并到 errorTraceHandler 数组） |
| `tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts` | 扩展 | 同 documentMainAgent |
| `tests/server/workflow/threadState.test.ts` | 扩展 | `loadSubAgentThreads` draft_document/review_contract 加载、跳过、混合规则；`extractSubSessionIdFromToolResult` 4 个边界 |
| `tests/app/components/ai/AiToolRenderer.test.ts` | 扩展 | 双卡共存 / 守卫 / legacy 回归 / interrupt 优先级 |

## 关键技术约束（必读）

1. **铁律：子代理 SSE 事件必须 `await`**（`.claude/rules/agent-platform.md`）
   - callback 内 `publishCustomEvent` / `publishStatusChange` 必须 `await ... .catch(...)`，不能 fire-and-forget
   - 历史教训 commit `2bb6a3fd`：fire-and-forget 偶发丢事件

2. **铁律：覆盖率 ≥90%**（`.claude/rules/agent-platform.md`）
   - `agent-platform/**` 至少 90%；helper 是核心新增代码 → **必须**有独立单测
   - **本 plan 与 spec v2 减项决策不同**：spec 减项删除 helper 独立测试文件，但铁律优先 → 恢复 `buildSubAgentCallbacks.test.ts`

3. **`agent.stream` 现有 callbacks 不能被覆盖**
   - `documentMainAgent.ts:317` 已有 `[createErrorTraceHandler(...)]`，新加的 `options.callbacks` 必须**合并**：`callbacks: [errorTraceHandler, ...(options.callbacks ?? [])]`
   - 同款规则适用于 `contractReviewMainAgent.ts`

4. **`review_contract` skipStanceInterrupt 路径限制**（spec 未深入，plan explicit 说明）
   - `reviewContract.tool` 调 `runContractReviewChat({ skipStanceInterrupt: true })` → 进入 `contractReviewMainAgent.ts:481` 的 ReadableStream 自构造分支
   - 这条分支**没有** `agent.stream` → callbacks 不会触发
   - 跑中 CoT 实际不会有 token / tool_calls 数据；前端 `shouldShowSubAgentCoT` 守卫保证空消息时不渲染（graceful degrade）
   - 跑中反馈仍由现有 `ReviewContractCard` 的 stage 事件提供（segment / detect / stance / analyze progress / summarize）
   - **plan 仍按 spec 接入 callbacks 选项 + 工具构造 callbacks**——首轮 stance interrupt 路径（合同 vertical 自身页面）能正确触发，向后兼容；法律助手场景 graceful no-op
   - 用户在 plan review 时若希望覆盖法律助手场景，需要单独 follow-up 改造 skipStanceInterrupt 路径（用 createAgent 包装 analyze loop / summarize；架构改动较大，本 plan 不含）

5. **AiToolRenderer interrupt 优先级**
   - `isInterruptToolCardCall` 优先级最高（最新已有 `_interruptId` 区分逻辑，参见 commit `00bc17b0`）
   - SUB_AGENT_LIKE 分支必须在 interrupt 分支之后

6. **跑中 CoT 显示限制（既有行为，本 plan 不修复）**
   - `useStreamChat.handleAgentEvent` 处理 `SUB_AGENT_TOKEN` 时把 delta 累加到 AIMessage（无 tool_calls 字段）；`SUB_AGENT_TOOL_END` 单独 push ToolMessage
   - `mapMessagesToSteps` 依赖 `AIMessage.tool_calls` 渲染 tool_call step → 跑中**不会**显示工具调用 step（仅 thinking + analysis）
   - 跑完后历史恢复路径走 PostgresSaver 真实 messages（含 tool_calls） → 完整 step 显示
   - 这是 `ask_*_expert` 既有行为；本 plan 沿用，不修复

7. **测试一律 `npx vitest run`**，禁用 `bun test`

8. **类型导入：`#shared` 别名**
   - `import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'`
   - `import { SSECustomEventType } from '#shared/types/agentEvent'`
   - `import { logger } from '#shared/utils/logger'`（虽然 server 端 `logger` 是白名单自动导入，但 helper 文件作为可独立测试单元保持显式 import 更稳定）

---

## 任务列表

### Task 1: `buildSubAgentCallbacks` helper（含独立单测）

**Files:**
- Create: `server/services/agent-platform/subAgent/buildSubAgentCallbacks.ts`
- Test: `tests/server/agent-platform/subAgent/buildSubAgentCallbacks.test.ts`

- [ ] **Step 1: 写 helper 测试 (TDD red)**

```typescript
// tests/server/agent-platform/subAgent/buildSubAgentCallbacks.test.ts
/**
 * buildSubAgentCallbacks 单测
 *
 * 验证 5 个 handler 行为：
 * - handleLLMNewToken → publishCustomEvent SUB_AGENT_TOKEN，metadata 含 messageId/delta
 * - handleToolStart → publishCustomEvent SUB_AGENT_TOOL_START，data 含 innerToolCallId/input/cbRunId
 * - handleToolEnd → publishCustomEvent SUB_AGENT_TOOL_END，data 含 cbRunId/output
 * - handleChainEnd（root：cbParentRunId=undefined）→ publishStatusChange status='completed'
 * - handleChainEnd（非 root：cbParentRunId 存在）→ 不发事件
 * - handleChainError（root）→ publishStatusChange status='failed' + error message
 * - publish 抛错时不向上传播（.catch 兜底）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { publishCustomEventMock, publishStatusChangeMock } = vi.hoisted(() => ({
    publishCustomEventMock: vi.fn().mockResolvedValue(undefined),
    publishStatusChangeMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: publishCustomEventMock,
    publishStatusChange: publishStatusChangeMock,
}))
vi.mock('#shared/utils/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { buildSubAgentCallbacks } from '~~/server/services/agent-platform/subAgent/buildSubAgentCallbacks'
import { SSECustomEventType } from '#shared/types/agentEvent'

const opts = {
    mainRunId: 'run-1',
    sessionId: 'sess-1',
    parentToolCallId: 'call-X',
    agentName: 'documentMain',
    subThreadId: 'sub-thread-1',
}
const expectedMeta = {
    agentName: 'documentMain',
    threadId: 'sub-thread-1',
    parentToolCallId: 'call-X',
}

describe('buildSubAgentCallbacks', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('返回单元素数组 + 含 5 个 handler', () => {
        const cbs = buildSubAgentCallbacks(opts)
        expect(cbs).toHaveLength(1)
        const h = cbs[0]!
        expect(typeof h.handleLLMNewToken).toBe('function')
        expect(typeof h.handleToolStart).toBe('function')
        expect(typeof h.handleToolEnd).toBe('function')
        expect(typeof h.handleChainEnd).toBe('function')
        expect(typeof h.handleChainError).toBe('function')
    })

    it('handleLLMNewToken → publishCustomEvent SUB_AGENT_TOKEN', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleLLMNewToken!('hello', undefined as any, 'cb-1')
        expect(publishCustomEventMock).toHaveBeenCalledWith({
            type: 'custom_event',
            runId: 'run-1',
            sessionId: 'sess-1',
            name: SSECustomEventType.SUB_AGENT_TOKEN,
            data: undefined,
            metadata: { ...expectedMeta, messageId: 'cb-1', delta: 'hello' },
        })
    })

    it('handleToolStart → publishCustomEvent SUB_AGENT_TOOL_START', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleToolStart!(
            { name: 't' } as any, 'in-data', 'cb-2',
            undefined, undefined, undefined, undefined, 'inner-tc-1',
        )
        expect(publishCustomEventMock).toHaveBeenCalledWith(expect.objectContaining({
            name: SSECustomEventType.SUB_AGENT_TOOL_START,
            data: { innerToolCallId: 'inner-tc-1', input: 'in-data', cbRunId: 'cb-2' },
            metadata: expectedMeta,
        }))
    })

    it('handleToolEnd → publishCustomEvent SUB_AGENT_TOOL_END', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleToolEnd!('out-data', 'cb-3')
        expect(publishCustomEventMock).toHaveBeenCalledWith(expect.objectContaining({
            name: SSECustomEventType.SUB_AGENT_TOOL_END,
            data: { cbRunId: 'cb-3', output: 'out-data' },
            metadata: expectedMeta,
        }))
    })

    it('handleChainEnd root（cbParentRunId=undefined）→ publishStatusChange completed', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleChainEnd!({}, 'cb-4', undefined)
        expect(publishStatusChangeMock).toHaveBeenCalledWith({
            type: 'status_change',
            runId: 'run-1',
            sessionId: 'sess-1',
            status: 'completed',
            metadata: expectedMeta,
        })
    })

    it('handleChainEnd 非 root（cbParentRunId 存在）→ 不发事件', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleChainEnd!({}, 'cb-5', 'parent-1')
        expect(publishStatusChangeMock).not.toHaveBeenCalled()
    })

    it('handleChainError root → publishStatusChange failed + error message', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleChainError!(new Error('boom'), 'cb-6', undefined)
        expect(publishStatusChangeMock).toHaveBeenCalledWith({
            type: 'status_change',
            runId: 'run-1',
            sessionId: 'sess-1',
            status: 'failed',
            error: 'boom',
            metadata: expectedMeta,
        })
    })

    it('handleChainError 非 root → 不发事件', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleChainError!(new Error('boom'), 'cb-7', 'parent-2')
        expect(publishStatusChangeMock).not.toHaveBeenCalled()
    })

    it('handleChainError 非 Error 实例（字符串）→ 用 String(error)', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleChainError!('string-error' as any, 'cb-8', undefined)
        expect(publishStatusChangeMock).toHaveBeenCalledWith(expect.objectContaining({
            error: 'string-error',
        }))
    })

    it('publishCustomEvent 抛错时不向上传播（.catch 兜底）', async () => {
        publishCustomEventMock.mockRejectedValueOnce(new Error('redis down'))
        const h = buildSubAgentCallbacks(opts)[0]!
        await expect(h.handleLLMNewToken!('x', undefined as any, 'cb')).resolves.toBeUndefined()
    })

    it('publishStatusChange 抛错时不向上传播', async () => {
        publishStatusChangeMock.mockRejectedValueOnce(new Error('redis down'))
        const h = buildSubAgentCallbacks(opts)[0]!
        await expect(h.handleChainEnd!({}, 'cb', undefined)).resolves.toBeUndefined()
    })
})
```

- [ ] **Step 2: 跑测试确认 fail（red）**

Run: `npx vitest run tests/server/agent-platform/subAgent/buildSubAgentCallbacks.test.ts --reporter=verbose`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 helper（green）**

```typescript
// server/services/agent-platform/subAgent/buildSubAgentCallbacks.ts
/**
 * 构造 LangChain Callbacks 旁路转发子 Agent 内部事件到主 SSE 流。
 *
 * 与 useStreamChat.subThreadsMap 协议对齐：metadata.parentToolCallId 是分桶 key，
 * 前端按此命中并累积 messages，让 SubAgentChainOfThought 自动渲染。
 *
 * 旧 subAgentToolFactory 内联实现漏了 handleChainError，本 helper 一并补齐：
 * 子代理 chain 抛错时主流也能收到 status='failed' 让 CoT 显示红徽章。
 */
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'
import { publishCustomEvent, publishStatusChange } from '~~/server/services/agent/agentEventBridge'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { logger } from '#shared/utils/logger'

export interface BuildSubAgentCallbacksOptions {
    /** 主 Agent run id（agentRuns.id） */
    mainRunId: string
    /** 主 caseMain / assistantMain sessionId */
    sessionId: string
    /** 主 tool_call.id（前端按此分桶到 subThreadsMap） */
    parentToolCallId: string
    /** 子 Agent 显示名（如 'documentMain' / 'contractReviewMain' / 'evidence_expert'） */
    agentName: string
    /** 子 thread id */
    subThreadId: string
}

export function buildSubAgentCallbacks(opts: BuildSubAgentCallbacksOptions): CallbackHandlerMethods[] {
    const { mainRunId, sessionId, parentToolCallId, agentName, subThreadId } = opts
    const meta = { agentName, threadId: subThreadId, parentToolCallId }

    return [{
        async handleLLMNewToken(token, _idx, cbRunId) {
            await publishCustomEvent({
                type: 'custom_event',
                runId: mainRunId,
                sessionId,
                name: SSECustomEventType.SUB_AGENT_TOKEN,
                data: undefined,
                metadata: { ...meta, messageId: cbRunId, delta: token },
            }).catch((e: unknown) => logger.warn('publishCustomEvent(SUB_AGENT_TOKEN) failed', { e }))
        },
        async handleToolStart(_tool, input, cbRunId, _p, _t, _m, _n, innerToolCallId) {
            await publishCustomEvent({
                type: 'custom_event',
                runId: mainRunId,
                sessionId,
                name: SSECustomEventType.SUB_AGENT_TOOL_START,
                data: { innerToolCallId, input, cbRunId },
                metadata: meta,
            }).catch((e: unknown) => logger.warn('publishCustomEvent(SUB_AGENT_TOOL_START) failed', { e }))
        },
        async handleToolEnd(output, cbRunId) {
            await publishCustomEvent({
                type: 'custom_event',
                runId: mainRunId,
                sessionId,
                name: SSECustomEventType.SUB_AGENT_TOOL_END,
                data: { cbRunId, output },
                metadata: meta,
            }).catch((e: unknown) => logger.warn('publishCustomEvent(SUB_AGENT_TOOL_END) failed', { e }))
        },
        async handleChainEnd(_outputs, _cbRunId, cbParentRunId) {
            // 仅 root chain（无 parent）才视为整个子流结束
            if (cbParentRunId !== undefined) return
            await publishStatusChange({
                type: 'status_change',
                runId: mainRunId,
                sessionId,
                status: 'completed',
                metadata: meta,
            }).catch((e: unknown) => logger.warn('publishStatusChange(sub completed) failed', { e }))
        },
        async handleChainError(error, _cbRunId, cbParentRunId) {
            // 旧 subAgentToolFactory 漏了此 handler，本次 DRY 一并补
            if (cbParentRunId !== undefined) return
            const message = error instanceof Error ? error.message : String(error)
            await publishStatusChange({
                type: 'status_change',
                runId: mainRunId,
                sessionId,
                status: 'failed',
                error: message,
                metadata: meta,
            }).catch((e: unknown) => logger.warn('publishStatusChange(sub failed) failed', { e }))
        },
    }]
}
```

- [ ] **Step 4: 跑测试确认 pass（green）**

Run: `npx vitest run tests/server/agent-platform/subAgent/buildSubAgentCallbacks.test.ts --reporter=verbose`
Expected: PASS（10/10）

- [ ] **Step 5: 跑覆盖率确认 ≥90%**

Run: `npx vitest run tests/server/agent-platform/subAgent/buildSubAgentCallbacks.test.ts --coverage`
Expected: `buildSubAgentCallbacks.ts` 覆盖率 100%

- [ ] **Step 6: Commit**

```bash
git add server/services/agent-platform/subAgent/buildSubAgentCallbacks.ts \
        tests/server/agent-platform/subAgent/buildSubAgentCallbacks.test.ts
git commit -m "feat(agent-platform): 抽 buildSubAgentCallbacks helper + 补 handleChainError

- 把子代理 LangChain callbacks 抽到独立 helper（5 个 handler）
- 旧 subAgentToolFactory 内联实现漏的 handleChainError 一并补齐
- 单测覆盖 5 个 handler 的成功 + 异常 + .catch 兜底路径"
```

---

### Task 2: `subAgentToolFactory.ts` DRY 替换 + 现有测试回归 + handleChainError 新测

**Files:**
- Modify: `server/services/agent-platform/subAgent/subAgentToolFactory.ts:204-274`
- Test: `tests/server/agent-platform/subAgent/subAgentToolFactory.test.ts`（扩展）

- [ ] **Step 1: 扩展现有测试加 handleChainError 路径**

在 `subAgentToolFactory.test.ts` 现有 `describe('callbacks')` block 末尾追加：

```typescript
describe('handleChainError 新增覆盖', () => {
    it('子代理 chain 抛错触发 handleChainError → publishStatusChange failed', async () => {
        // mock createAgent 返回的 invoke 行为：在 invoke 时拿到 callbacks 数组，手工调 handleChainError
        let capturedCallbacks: any[] = []
        createAgentMock.mockReturnValueOnce({
            invoke: vi.fn(async (_input, opts) => {
                capturedCallbacks = opts.callbacks
                // 模拟 LangChain 在 chain 抛错时调 handleChainError(error, cbRunId, cbParentRunId)
                const h = capturedCallbacks[0]
                await h.handleChainError(new Error('chain failed'), 'cb-r', undefined)
                throw new Error('chain failed')
            }),
        })
        const tools = await createSubAgentTools(
            [makeNodeConfig({ name: 'risk_expert' })],
            { ...baseCtx },
        )
        const result = await tools[0]!.invoke({ question: 'q' }, { toolCall: { id: 'tc-X' } } as any)
        // tool catch 块也会 publishStatusChange failed（双发，但 metadata 一致；都为 best-effort）
        expect(publishStatusChangeMock).toHaveBeenCalledWith(expect.objectContaining({
            status: 'failed',
            error: 'chain failed',
            metadata: expect.objectContaining({
                agentName: 'risk_expert',
                parentToolCallId: 'tc-X',
            }),
        }))
        expect(typeof result).toBe('string')  // catch 块返回错误描述字符串
    })
})
```

- [ ] **Step 2: 跑现有 + 新测试确认现状（baseline）**

Run: `npx vitest run tests/server/agent-platform/subAgent/subAgentToolFactory.test.ts --reporter=verbose`
Expected: 既有测试 PASS；新加的 handleChainError case **fail（旧实现没有这个 handler）**

- [ ] **Step 3: 替换 subAgentToolFactory.ts 内联 callbacks 为 helper 调用**

修改 `server/services/agent-platform/subAgent/subAgentToolFactory.ts`：

第 30-34 行 import 加：
```typescript
import { buildSubAgentCallbacks } from './buildSubAgentCallbacks'
```

把第 197-276 行（含 `agent.invoke(...)` 的整个 callbacks 数组）替换为：

```typescript
                    // 执行子代理（callbacks 旁路转发事件到主 SSE 流，返回值仍走 invoke）
                    const result = await agent.invoke(
                        { messages: initialMessages },
                        {
                            configurable: {
                                thread_id: subThreadId,
                            },
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

删除原 line 30-34 的 `import { publishCustomEvent, publishStatusChange } ...` 和 `import { SSECustomEventType } ...` —— 这两个 import 现在仅在 catch 块的 publishStatusChange 用到，保留即可（grep 后再决定是否删）。

> 注意：catch 块（line 296-315）的 `publishStatusChange(failed)` 保留——这里跟 helper 的 handleChainError 双发是 best-effort 兜底，因为 catch 块覆盖的是 `agent.invoke` 自身抛出的同步错误（如 model API 抛错前置异常），handleChainError 覆盖的是 LangGraph chain 内部异步错误。两条路径在某些场景下不重叠，保留双发更鲁棒。

- [ ] **Step 4: 跑测试确认 pass（含新 case）**

Run: `npx vitest run tests/server/agent-platform/subAgent/subAgentToolFactory.test.ts --reporter=verbose`
Expected: PASS（含原有测试 + 新 handleChainError 测试）

- [ ] **Step 5: 跑 covered tests 确认无回归**

Run: `npx vitest run tests/server/agent-platform/subAgent/ --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/agent-platform/subAgent/subAgentToolFactory.ts \
        tests/server/agent-platform/subAgent/subAgentToolFactory.test.ts
git commit -m "refactor(agent-platform): subAgentToolFactory 用 buildSubAgentCallbacks DRY 内联 callbacks

- 80 行内联 callbacks 数组替换为 helper 调用（保留 catch 块的兜底 publishStatusChange）
- 测试新增 handleChainError 路径（旧实现漏，本次 DRY 一并补齐行为）"
```

---

### Task 3: `documentMainAgent.ts` 加 callbacks 选项 + 透传

**Files:**
- Modify: `server/services/workflow/agents/documentMainAgent.ts`
- Test: `tests/server/workflow/agents/documentMainAgent.test.ts`（扩展）

- [ ] **Step 1: 扩展测试覆盖新选项**

在 `documentMainAgent.test.ts` 末尾追加（注意：该文件已 mock `langchain.createAgent` 返回 `{ stream: mockStream }`，可直接断言 `mockStream.mock.calls[0][1].callbacks`）：

```typescript
describe('callbacks 选项透传', () => {
    beforeEach(() => {
        mockStream.mockClear()
        // mockFindDraft 和其他 setup 假设保留既有的 happy-path mock，
        // 详见现有 it('') 块的 setup 模式
    })

    it('不传 callbacks（向后兼容）→ stream 被调用，callbacks 含 errorTraceHandler', async () => {
        // 复用已有的 happy-path setup（draft + template + nodeConfig 在文件顶部已 mock）
        const { runDocumentChat } = await import('~~/server/services/workflow/agents/documentMainAgent')
        await runDocumentChat('sess-x', '问', { userId: 1 })
        const streamArgs = mockStream.mock.calls[0]?.[1] as any
        expect(streamArgs.callbacks).toBeDefined()
        expect(Array.isArray(streamArgs.callbacks)).toBe(true)
        expect(streamArgs.callbacks).toHaveLength(1)  // 仅 errorTraceHandler
    })

    it('传 callbacks → 与 errorTraceHandler 合并到 callbacks 数组', async () => {
        const userCallback = { handleLLMNewToken: vi.fn() }
        const { runDocumentChat } = await import('~~/server/services/workflow/agents/documentMainAgent')
        await runDocumentChat('sess-y', '问', {
            userId: 1,
            callbacks: [userCallback as any],
        })
        const streamArgs = mockStream.mock.calls[0]?.[1] as any
        expect(streamArgs.callbacks).toHaveLength(2)  // errorTraceHandler + userCallback
        // 顺序：errorTraceHandler 在前，用户 callbacks 在后
        expect(streamArgs.callbacks[1]).toBe(userCallback)
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/workflow/agents/documentMainAgent.test.ts --reporter=verbose`
Expected: 新加的 2 个测试 FAIL（callbacks 选项没声明，user callbacks 没被传入）

- [ ] **Step 3: 改 `documentMainAgent.ts` 加 callbacks 选项**

修改 `DocumentAgentOptions`（line 91-100）：

```typescript
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'

export interface DocumentAgentOptions {
    /** 用户 ID */
    userId: number
    /** 案件 ID（可选） */
    caseId?: number
    /** 来自 agentWorker.executeRun 的 AbortController，用户取消/超时时传入 */
    signal?: AbortSignal
    /** 中断恢复命令（若存在则走 resume 分支） */
    command?: unknown
    /**
     * 子流事件转发到主流的 callbacks。
     *
     * 由 draftDocument.tool 调用时构造（buildSubAgentCallbacks），
     * 让 documentMain 内部的 LLM/tool 事件旁路 publish 给前端 subThreadsMap
     * 渲染 SubAgentChainOfThought CoT。
     *
     * 与 errorTraceHandler 合并：errorTraceHandler 在前（保留诊断），用户 callbacks 在后。
     */
    callbacks?: CallbackHandlerMethods[]
}
```

修改 `agent.stream(...)` 调用（line 306-323）：

```typescript
    return agent.stream(
        input as any,
        {
            configurable: {
                thread_id: sessionId,
            },
            streamMode: ['values', 'messages', 'updates'],
            subgraphs: true,
            encoding: 'text/event-stream',
            recursionLimit: 1000,
            signal,
            // 合并：errorTraceHandler（诊断）+ 调用方传入的 callbacks（如 buildSubAgentCallbacks 的事件旁路）
            callbacks: [
                createErrorTraceHandler({
                    sessionId,
                    agentName: 'documentMain',
                    extra: { draftId: draft.id, templateId: template.id, caseId: resolvedCaseId },
                }),
                ...(options.callbacks ?? []),
            ],
        },
    )
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/server/workflow/agents/documentMainAgent.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 跑相关上游测试确认无回归**

Run: `npx vitest run tests/server/workflow/agents/ --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/workflow/agents/documentMainAgent.ts \
        tests/server/workflow/agents/documentMainAgent.test.ts
git commit -m "feat(workflow): documentMainAgent.runDocumentChat 加 callbacks 选项

- DocumentAgentOptions 加可选 callbacks: CallbackHandlerMethods[]
- agent.stream callbacks 数组合并：errorTraceHandler + 调用方 callbacks
- 测试覆盖向后兼容（不传）+ 合并（传入）两种场景"
```

---

### Task 4: `contractReviewMainAgent.ts` 加 callbacks 选项 + 透传

**Files:**
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`
- Test: `tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts`（扩展）

> **限制提醒（plan 决策记录）**：reviewContract.tool 走 `skipStanceInterrupt: true` 进入 ReadableStream 自构造分支（`contractReviewMainAgent.ts:482`），**不**调 `agent.stream` → 法律助手 review_contract 场景下 callbacks 实际不触发。本 Task 仍按 spec 加 callbacks 选项（首轮 stance interrupt 路径生效，向后兼容）。CoT 在法律助手场景的实际效果由 AiToolRenderer 守卫 graceful 处理（无消息时不渲染）。

- [ ] **Step 1: 扩展测试**

在 `contractReviewMainAgent.streaming.test.ts` 末尾加 callbacks 透传测试。需要先把 mockStream 提到 langchain mock 外层，方便后续断言（如已在文件 line 95-101 内定义 createAgent.mockReturnValue({ stream: vi.fn() })，把 `vi.fn()` 提取到顶层 const）。

```typescript
// 文件顶部 import 之前加一个共享 mockStream
const mockStream = vi.fn(async () => new ReadableStream<Uint8Array>({ start(c) { c.close() } }))

// 上面 line 95-101 的 langchain mock 改为：
vi.mock('langchain', async () => {
    const actual = await vi.importActual<any>('langchain')
    return {
        ...actual,
        createAgent: vi.fn().mockReturnValue({ stream: mockStream }),
        summarizationMiddleware: vi.fn(),
        // ...其余保留
    }
})

// 文件末尾追加：
describe('callbacks 选项透传', () => {
    beforeEach(() => {
        mockStream.mockClear()
        // 复用 segmentClauses / loadContractFullText 等 happy 默认 mock
        ;(segmentClauses as any).mockResolvedValue({ segments: [], normalizedText: '' })
        ;(findContractReviewBySessionIdDAO as any).mockResolvedValue({
            id: 1, originalFileId: 9, status: 'pending',
            stance: null, partyA: null, partyB: null, contractType: null,
            caseId: null, sessionId: 'sess-z',
        })
    })

    it('首轮（command=undefined + skipStanceInterrupt=false）+ 传 callbacks → agent.stream 收到', async () => {
        const userCallback = { handleLLMNewToken: vi.fn() }
        const { runContractReviewChat } = await import('~~/server/services/workflow/agents/contractReviewMainAgent')
        await runContractReviewChat('sess-z', {
            userId: 1,
            callbacks: [userCallback as any],
        })
        const streamArgs = mockStream.mock.calls.at(-1)?.[1] as any
        expect(streamArgs).toBeDefined()
        expect(streamArgs.callbacks).toBeDefined()
        expect(streamArgs.callbacks).toContain(userCallback)
    })

    it('首轮不传 callbacks → agent.stream callbacks 选项是 undefined（向后兼容）', async () => {
        const { runContractReviewChat } = await import('~~/server/services/workflow/agents/contractReviewMainAgent')
        await runContractReviewChat('sess-z2', { userId: 1 })
        const streamArgs = mockStream.mock.calls.at(-1)?.[1] as any
        expect(streamArgs.callbacks).toBeUndefined()
    })

    it('skipStanceInterrupt=true（review.stance 已落库）→ 不走 agent.stream（callbacks 不触发，设计意图）', async () => {
        // mock review.stance 已落库 → 触发 skip 分支
        ;(findContractReviewBySessionIdDAO as any).mockResolvedValue({
            id: 1, originalFileId: 9, status: 'awaiting_stance',
            stance: 'partyA', partyA: '甲', partyB: '乙', contractType: '采购',
            caseId: null, sessionId: 'sess-skip',
        })
        const userCallback = { handleLLMNewToken: vi.fn() }
        const { runContractReviewChat } = await import('~~/server/services/workflow/agents/contractReviewMainAgent')
        await runContractReviewChat('sess-skip', {
            userId: 1,
            skipStanceInterrupt: true,
            callbacks: [userCallback as any],
        })
        // skip 分支返回手工构造的 ReadableStream，不调用 agent.stream
        expect(mockStream).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: 改 `contractReviewMainAgent.ts` 加 callbacks 选项**

`ContractReviewAgentOptions`（line 167-191）加：

```typescript
import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base'

export interface ContractReviewAgentOptions {
    // ...既有字段
    /**
     * 子流事件转发到主流的 callbacks（首轮 agent.stream 路径生效）。
     *
     * 法律助手 reviewContract.tool 调用本函数时走 skipStanceInterrupt=true 路径，
     * 该路径不调 agent.stream → callbacks **不会触发**（设计上可接受）。
     * 跑中反馈通过现有 stage 事件（segment / detect / stance / analyze progress / summarize）
     * + 前端 ReviewContractCard 实现。
     *
     * 首轮 stance interrupt 路径（合同 vertical 自身 /stance 端点）能正确触发 callbacks。
     */
    callbacks?: CallbackHandlerMethods[]
}
```

`agent.stream(...)` 调用（line 663-670）改为：

```typescript
    return agent.stream(input, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 1000,
        signal,
        callbacks: options.callbacks,
    })
```

> 注意：contractReviewMainAgent 当前没有 errorTraceHandler，直接用 `options.callbacks` 即可。

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/agents/contractReviewMainAgent.ts \
        tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts
git commit -m "feat(workflow): contractReviewMainAgent 加 callbacks 选项（首轮路径）

- ContractReviewAgentOptions 加可选 callbacks
- 首轮 agent.stream 路径透传；skipStanceInterrupt 路径设计上不触发（已 explicit 文档）"
```

---

### Task 5: `draftDocument.tool.ts` 调 helper + 返回 JSON 加 subSessionId

**Files:**
- Modify: `server/services/agent-platform/tools/draftDocument.tool.ts`
- Test: `tests/server/agent-platform/tools/draftDocument.test.ts`（扩展）

- [ ] **Step 1: 扩展测试**

在 `draftDocument.test.ts` 已有 happy path 测试中追加断言（line 100 之后）：

```typescript
describe('callbacks 注入 + 返回 JSON 含 subSessionId', () => {
    it('runDocumentChat 接收带 buildSubAgentCallbacks 构造的 callbacks（含 5 个 handler）', async () => {
        // 用既有 happy path setup（line 68-95 同款）
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({ items: [{ templateId: 11 }], total: 12, usedKeywords: ['起诉状'], fallbackToRecency: false })
        ;(interrupt as any).mockReturnValueOnce({ templateId: 11 })
        ;(createDraftService as any).mockResolvedValue({ draftId: 101, sessionId: 'sub-sess-101' })
        ;(runDocumentChat as any).mockResolvedValue(new ReadableStream())
        ;(runAndDrainStream as any).mockResolvedValue({ success: true, finalState: {} })
        ;(getDocumentDraftDAO as any).mockResolvedValue({ id: 101, title: '起诉状', status: 'ready', values: {} })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({ id: 11, name: '起诉状', placeholders: [] })

        const tool = createTool({ ...ctx, runId: 'main-run-1' })
        await tool.invoke({ intent: 'x' }, { toolCall: { id: 'main-call-1' } } as any)

        // 验证 runDocumentChat 收到的 options.callbacks 是 buildSubAgentCallbacks 输出（数组、单元素、5 handler）
        const callArgs = (runDocumentChat as any).mock.calls.at(-1)
        expect(callArgs[0]).toBe('sub-sess-101')   // subSessionId
        expect(callArgs[1]).toBeUndefined()         // message
        const opts = callArgs[2]
        expect(Array.isArray(opts.callbacks)).toBe(true)
        expect(opts.callbacks).toHaveLength(1)
        const h = opts.callbacks[0]
        expect(typeof h.handleLLMNewToken).toBe('function')
        expect(typeof h.handleToolStart).toBe('function')
        expect(typeof h.handleToolEnd).toBe('function')
        expect(typeof h.handleChainEnd).toBe('function')
        expect(typeof h.handleChainError).toBe('function')
    })

    it('成功返回 JSON 含 subSessionId 字段（值 = createDraftService 的 sessionId）', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({ items: [{ templateId: 11 }], total: 1, usedKeywords: ['起诉状'], fallbackToRecency: false })
        ;(interrupt as any).mockReturnValueOnce({ templateId: 11 })
        ;(createDraftService as any).mockResolvedValue({ draftId: 101, sessionId: 'doc-sub-xyz' })
        ;(runDocumentChat as any).mockResolvedValue(new ReadableStream())
        ;(runAndDrainStream as any).mockResolvedValue({ success: true, finalState: {} })
        ;(getDocumentDraftDAO as any).mockResolvedValue({ id: 101, title: '起诉状', status: 'ready', values: {} })
        ;(getDocumentTemplateDAO as any).mockResolvedValue({ id: 11, name: '起诉状', placeholders: [] })

        const tool = createTool(ctx)
        const raw: any = await tool.invoke({ intent: 'x' }, cfg as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(result.success).toBe(true)
        expect(result.subSessionId).toBe('doc-sub-xyz')
        expect(result.draftId).toBe(101)
    })

    it('用户取消时返回 JSON 不含 subSessionId（cancelled 路径）', async () => {
        ;(recommendDocumentTemplatesService as any).mockResolvedValue({ items: [], total: 0, usedKeywords: [], fallbackToRecency: false })
        ;(interrupt as any).mockReturnValueOnce(null)
        const tool = createTool(ctx)
        const raw: any = await tool.invoke({ intent: 'x' }, cfg as any)
        const result = JSON.parse(typeof raw === 'string' ? raw : raw.content)
        expect(result.success).toBe(false)
        expect(result.cancelled).toBe(true)
        expect(result.subSessionId).toBeUndefined()  // 历史恢复正确跳过
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/agent-platform/tools/draftDocument.test.ts --reporter=verbose`
Expected: FAIL（callbacks 未传 + JSON 无 subSessionId）

- [ ] **Step 3: 改 `draftDocument.tool.ts`**

第 22-30 行 import 加：
```typescript
import { buildSubAgentCallbacks } from '~~/server/services/agent-platform/subAgent/buildSubAgentCallbacks'
```

修改第 145-153 行的 `runDocumentChat` 调用：

```typescript
            // 4. 同步执行 documentMain Agent + 消费流
            //    callbacks 旁路：把 documentMain 子流的 LLM token / tool start/end / chain end/error
            //    转发到主 SSE 流，让前端 SubAgentChainOfThought 渲染 CoT。
            const { runDocumentChat } = await import(
                '~~/server/services/workflow/agents/documentMainAgent'
            )
            const callbacks = buildSubAgentCallbacks({
                mainRunId: runId,
                sessionId,                     // 主 caseMain / assistantMain sessionId（CoT 在主流呈现）
                parentToolCallId: toolCallId,  // 主 tool_call.id（前端按此分桶）
                agentName: 'documentMain',
                subThreadId: subSessionId,     // documentMain 子 thread_id
            })
            const stream = await runDocumentChat(subSessionId, undefined, {
                userId,
                caseId: caseId ?? undefined,
                signal: undefined,
                callbacks,
            })
```

修改第 244-254 行返回 JSON，加 `subSessionId`：

```typescript
            // 7. 返回 LLM 一个紧凑 JSON
            return JSON.stringify({
                success: true,
                draftId,
                title,
                summary,
                href,
                subSessionId,                  // 新加：documentMain 子 thread_id（loadSubAgentThreads 历史恢复用）
                templateId,
                templateName: template?.name ?? null,
                filledFieldCount,
                totalFields,
            })
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/server/agent-platform/tools/draftDocument.test.ts --reporter=verbose`
Expected: PASS（含原有 + 新加 case）

- [ ] **Step 5: Commit**

```bash
git add server/services/agent-platform/tools/draftDocument.tool.ts \
        tests/server/agent-platform/tools/draftDocument.test.ts
git commit -m "feat(tools): draftDocument 调 buildSubAgentCallbacks + 返回 JSON 加 subSessionId

- 调 buildSubAgentCallbacks 把 documentMain 子流事件转发到主流（前端渲染 CoT）
- 返回 JSON 加 subSessionId 字段，给 loadSubAgentThreads 历史恢复用
- href 里的 sessionId 是主流跳转链接，不能用作子 thread_id（spec v2 修硬伤）"
```

---

### Task 6: `reviewContract.tool.ts` 同款（带限制说明）

**Files:**
- Modify: `server/services/agent-platform/tools/reviewContract.tool.ts`
- Test: `tests/server/agent-platform/tools/reviewContract.test.ts`（扩展）

> **限制提醒（同 Task 4）**：调用 `runContractReviewChat({ skipStanceInterrupt: true })` 进入 ReadableStream 自构造分支，callbacks 实际不会触发——但仍按 spec 注入，向后兼容。

- [ ] **Step 1: 扩展测试**

在 `reviewContract.test.ts` 末尾追加（复用文件顶部已 mock 的依赖：findOssFileByIdDao / createContractReviewDAO / loadContractFullText / detectParties / runContractReviewChat / runAndDrainStream / listContractRisksDAO / interrupt / prisma.caseSessions.create）：

```typescript
describe('callbacks 注入 + 返回 JSON 加 subSessionId', () => {
    /** 公共 happy-path setup（成功路径必备 mock 链） */
    function setupHappyPath() {
        ;(findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 7, fileName: '采购.docx', fileType: DOCX_MIME,
        })
        ;(createContractReviewDAO as any).mockResolvedValue({ id: 555, userId: 7, sessionId: 'sub' })
        ;(loadContractFullText as any).mockResolvedValue({ paragraphs: ['p1', 'p2'] })
        ;(detectParties as any).mockResolvedValue({
            partyA: '甲公司', partyB: '乙公司', contractType: '采购合同',
        })
        ;(interrupt as any).mockReturnValueOnce({ stance: 'partyA' })
        ;(updateContractReviewDAO as any).mockResolvedValue({})
        ;(runContractReviewChat as any).mockResolvedValue(new ReadableStream())
        ;(runAndDrainStream as any).mockResolvedValue({ success: true, finalState: {} })
        ;(listContractRisksDAO as any).mockResolvedValue([])
    }

    it('runContractReviewChat 接收带 buildSubAgentCallbacks 构造的 callbacks（含 5 个 handler）', async () => {
        setupHappyPath()
        const tool = createTool({ userId: 7, sessionId: 'main-sess', runId: 'main-run-1' })
        await tool.invoke({ ossFileId: 99 }, { toolCall: { id: 'main-call-2' } } as any)

        const callArgs = (runContractReviewChat as any).mock.calls.at(-1)
        expect(callArgs[0]).toBeTruthy()  // subSessionId 字符串（randomUUID）
        const opts = callArgs[1]
        expect(opts.skipStanceInterrupt).toBe(true)
        expect(Array.isArray(opts.callbacks)).toBe(true)
        expect(opts.callbacks).toHaveLength(1)
        const h = opts.callbacks[0]
        expect(typeof h.handleLLMNewToken).toBe('function')
        expect(typeof h.handleToolStart).toBe('function')
        expect(typeof h.handleToolEnd).toBe('function')
        expect(typeof h.handleChainEnd).toBe('function')
        expect(typeof h.handleChainError).toBe('function')
    })

    it('成功返回 JSON 含 subSessionId（值 = randomUUID 生成的 subSessionId）', async () => {
        setupHappyPath()
        const tool = createTool(ctx)
        const result = parseToolResult(await tool.invoke({ ossFileId: 99 }, cfg as any))
        expect(result.success).toBe(true)
        expect(typeof result.subSessionId).toBe('string')
        expect(result.subSessionId.length).toBeGreaterThan(0)
        // subSessionId 与 runContractReviewChat 第一个参数一致
        const passedSubSessionId = (runContractReviewChat as any).mock.calls.at(-1)[0]
        expect(result.subSessionId).toBe(passedSubSessionId)
    })

    it('用户取消（resume=null）时不含 subSessionId（cancelled 路径）', async () => {
        ;(findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 7, fileName: '采购.docx', fileType: DOCX_MIME,
        })
        ;(createContractReviewDAO as any).mockResolvedValue({ id: 555, userId: 7, sessionId: 'sub' })
        ;(loadContractFullText as any).mockResolvedValue({ paragraphs: ['p1'] })
        ;(detectParties as any).mockResolvedValue({ partyA: null, partyB: null, contractType: null })
        ;(interrupt as any).mockReturnValueOnce(null)
        ;(softDeleteContractReviewDAO as any).mockResolvedValue({})
        const tool = createTool(ctx)
        const result = parseToolResult(await tool.invoke({ ossFileId: 99 }, cfg as any))
        expect(result.cancelled).toBe(true)
        expect(result.subSessionId).toBeUndefined()
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/agent-platform/tools/reviewContract.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: 改 `reviewContract.tool.ts`**

第 29-37 行 import 加：
```typescript
import { buildSubAgentCallbacks } from '~~/server/services/agent-platform/subAgent/buildSubAgentCallbacks'
```

修改第 188-198 行 `runContractReviewChat` 调用：

```typescript
            // 6. 调 runContractReviewChat(skipStanceInterrupt: true)，直接走 resume 分支
            //    callbacks 旁路：首轮路径生效；skip 路径不触发（plan §限制 4 已 explicit 文档）
            const { runContractReviewChat } = await import(
                '~~/server/services/workflow/agents/contractReviewMainAgent'
            )
            const callbacks = buildSubAgentCallbacks({
                mainRunId: runId,
                sessionId,
                parentToolCallId: toolCallId,
                agentName: 'contractReviewMain',
                subThreadId: subSessionId,
            })
            const stream = await runContractReviewChat(subSessionId, {
                userId,
                runId,
                skipStanceInterrupt: true,
                callbacks,
            })
```

修改第 254-267 行返回 JSON，加 `subSessionId`：

```typescript
            // 9. 返回 LLM
            return JSON.stringify({
                success: true,
                reviewId: review.id,
                fileName: ossFile.fileName,
                stance,
                partyA: finalPartyA,
                partyB: finalPartyB,
                contractType: contractType ?? null,
                riskCount: risks.length,
                levelCount,
                topRisks,
                href,
                subSessionId,                  // 新加：contractReviewMain 子 thread_id
            })
```

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/server/agent-platform/tools/reviewContract.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/agent-platform/tools/reviewContract.tool.ts \
        tests/server/agent-platform/tools/reviewContract.test.ts
git commit -m "feat(tools): reviewContract 调 buildSubAgentCallbacks + 返回 JSON 加 subSessionId

- callbacks 旁路：首轮路径生效，skipStanceInterrupt 路径不触发（plan §限制 4）
- 返回 JSON 加 subSessionId 字段（loadSubAgentThreads 历史恢复用）"
```

---

### Task 7: `loadSubAgentThreads` 扩展 + `extractSubSessionIdFromToolResult`

**Files:**
- Modify: `server/services/workflow/agents/threadState.ts`
- Test: `tests/server/workflow/threadState.test.ts`（扩展）

- [ ] **Step 1: 扩展测试**

在 `tests/server/workflow/threadState.test.ts` 的 `describe('loadSubAgentThreads', ...)` block 内追加：

```typescript
describe('draft_document / review_contract 历史恢复', () => {
    it('draft_document tool_call + 配对 ToolMessage JSON 含 subSessionId → 加载子 thread', async () => {
        const subTuple = {
            checkpoint: {
                channel_values: {
                    messages: [
                        { type: 'human', content: '起草起诉状', id: 'sub-h1' },
                        { type: 'ai', content: '已起草', id: 'sub-a1', tool_calls: [] },
                    ],
                },
            },
        }
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue(subTuple),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            {
                type: 'ai',
                tool_calls: [{ id: 'tc-draft-1', name: 'draft_document', args: {} }],
            },
            {
                type: 'tool',
                tool_call_id: 'tc-draft-1',
                content: JSON.stringify({
                    success: true,
                    draftId: 101,
                    subSessionId: 'doc-sub-xyz',
                    href: '/dashboard/document/drafts/101?from=xiaosuo&sessionId=case-main-1',
                }),
            },
        ]
        const result = await loadSubAgentThreads('case-main-1', messages)
        expect(result).toHaveLength(1)
        expect(result[0]!.toolCallId).toBe('tc-draft-1')
        expect(result[0]!.agentName).toBe('documentMain')
        expect(result[0]!.threadId).toBe('doc-sub-xyz')
        expect(mockCheckpointer.getTuple).toHaveBeenCalledWith({
            configurable: { thread_id: 'doc-sub-xyz' },
        })
    })

    it('review_contract tool_call → agentName=contractReviewMain', async () => {
        const subTuple = { checkpoint: { channel_values: { messages: [{ type: 'ai', content: '审完', id: 's1' }] } } }
        const mockCheckpointer = { getTuple: vi.fn().mockResolvedValue(subTuple) }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            {
                type: 'ai',
                tool_calls: [{ id: 'tc-rev-1', name: 'review_contract', args: {} }],
            },
            {
                type: 'tool',
                tool_call_id: 'tc-rev-1',
                content: JSON.stringify({ success: true, reviewId: 5, subSessionId: 'rev-sub-abc' }),
            },
        ]
        const result = await loadSubAgentThreads('case-main-1', messages)
        expect(result).toHaveLength(1)
        expect(result[0]!.agentName).toBe('contractReviewMain')
    })

    it('draft_document + ToolMessage 无 subSessionId（cancelled）→ 跳过', async () => {
        const mockCheckpointer = { getTuple: vi.fn() }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            { type: 'ai', tool_calls: [{ id: 'tc-cancel', name: 'draft_document', args: {} }] },
            { type: 'tool', tool_call_id: 'tc-cancel', content: JSON.stringify({ success: false, cancelled: true }) },
        ]
        const result = await loadSubAgentThreads('s1', messages)
        expect(result).toEqual([])
        expect(mockCheckpointer.getTuple).not.toHaveBeenCalled()
    })

    it('draft_document tool_call 无配对 ToolMessage（interrupt 中）→ 跳过', async () => {
        const mockCheckpointer = { getTuple: vi.fn() }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            { type: 'ai', tool_calls: [{ id: 'tc-interrupt', name: 'draft_document', args: {} }] },
            // 无配对 ToolMessage
        ]
        const result = await loadSubAgentThreads('s1', messages)
        expect(result).toEqual([])
        expect(mockCheckpointer.getTuple).not.toHaveBeenCalled()
    })

    it('subSessionId 存在但 checkpointer.getTuple 返回 null → 不报错跳过', async () => {
        const mockCheckpointer = { getTuple: vi.fn().mockResolvedValue(null) }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            { type: 'ai', tool_calls: [{ id: 'tc-1', name: 'draft_document', args: {} }] },
            { type: 'tool', tool_call_id: 'tc-1', content: JSON.stringify({ success: true, subSessionId: 'gone' }) },
        ]
        const result = await loadSubAgentThreads('s1', messages)
        expect(result).toEqual([])
    })

    it('混合 ask_*_expert + draft_document → 两套规则并存', async () => {
        const subTuple = { checkpoint: { channel_values: { messages: [{ type: 'ai', content: 'x', id: 's' }] } } }
        const mockCheckpointer = { getTuple: vi.fn().mockResolvedValue(subTuple) }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            { type: 'ai', tool_calls: [
                { id: 'tc-A', name: 'ask_evidence_expert', args: {} },
                { id: 'tc-B', name: 'draft_document', args: {} },
            ]},
            { type: 'tool', tool_call_id: 'tc-B', content: JSON.stringify({ success: true, subSessionId: 'sub-B' }) },
        ]
        const result = await loadSubAgentThreads('case-1', messages)
        expect(result).toHaveLength(2)
        const A = result.find(r => r.toolCallId === 'tc-A')!
        const B = result.find(r => r.toolCallId === 'tc-B')!
        expect(A.threadId).toBe('case-1_sub_evidence')
        expect(A.agentName).toBe('evidence')
        expect(B.threadId).toBe('sub-B')
        expect(B.agentName).toBe('documentMain')
    })
})

describe('extractSubSessionIdFromToolResult（纯函数）', () => {
    // helper 不直接 export，通过文件级 import 间接验证 —— 改为 export 后 import 直接验证
    // ...或者通过 loadSubAgentThreads 的行为间接覆盖（已含上面的边界用例）
    // 本组测试如果选择直接验证函数，需要把 extractSubSessionIdFromToolResult export
    it('JSON 含 subSessionId 合法字符串 → 返回该 id', () => {
        // 调用方法依实现是否 export 决定；如未 export，本组 case 通过 loadSubAgentThreads 间接覆盖
    })
    // ...其他 4 个边界（无字段 / 非合法 JSON / 不存在 / 空字符串）通过上面 loadSubAgentThreads 的整合用例间接覆盖
})
```

> 决策：`extractSubSessionIdFromToolResult` 保持模块内私有（不 export），通过 `loadSubAgentThreads` 测试的 5 个 case 间接覆盖所有边界（合法 / 无字段 / cancelled / 无 ToolMessage / getTuple 返回 null）—— spec D 的 4 个纯函数 case 在间接路径里都能命中。

- [ ] **Step 2: 跑测试确认 fail**

Run: `npx vitest run tests/server/workflow/threadState.test.ts --reporter=verbose`
Expected: FAIL（draft_document/review_contract 分支不存在）

- [ ] **Step 3: 改 `threadState.ts`**

修改 `loadSubAgentThreads`（line 182-238）为统一处理 ask_*_expert + draft_document + review_contract：

```typescript
/**
 * 从主 thread 消息中提取子代理工具调用，加载对应的子代理 thread 消息。
 *
 * 支持的子代理工具：
 * - `ask_*_expert`：caseAnalysis 7 个分析子代理（按命名规则反推 thread_id）
 * - `draft_document`：documentMain（从配对 ToolMessage JSON 顶层 subSessionId 字段拿 thread_id）
 * - `review_contract`：contractReviewMain（同上）
 */
export async function loadSubAgentThreads(
    sessionId: string,
    messages: Record<string, unknown>[],
): Promise<SubAgentThread[]> {
    const checkpointer = await getCheckpointer()
    const subAgentThreads: SubAgentThread[] = []

    // 预建 tool_call_id → ToolMessage 索引（draft_document / review_contract 反查 subSessionId 用）
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
                // ask_*_expert：命名规则反推
                const safeName = toolName.slice(4, -7)
                subThreadId = `${sessionId}_sub_${safeName}`
                agentName = safeName
            }
            else if (toolName === 'draft_document' || toolName === 'review_contract') {
                // draft_document / review_contract：从 ToolMessage JSON 顶层 subSessionId 字段拿
                // ⚠️ href 里的 sessionId 是主 caseMain sessionId（用户跳转用），不是子流 thread_id
                const result = toolResultMap.get(toolCall.id as string)
                subThreadId = extractSubSessionIdFromToolResult(result)
                agentName = toolName === 'draft_document' ? 'documentMain' : 'contractReviewMain'
                if (!subThreadId) continue  // tool 取消 / interrupt 中刷新 / 失败 → 无 subSessionId
            }
            else {
                continue
            }

            try {
                const subTuple = await checkpointer.getTuple({
                    configurable: { thread_id: subThreadId },
                })
                if (!subTuple) continue

                const subChannelValues = subTuple.checkpoint.channel_values as Record<string, any>
                const subRawMessages = subChannelValues?.messages

                if (Array.isArray(subRawMessages) && subRawMessages.length > 0) {
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
 * draftDocument.tool / reviewContract.tool 在返回 JSON 时显式带：
 *   `{ success: true, draftId: ..., subSessionId: '<子 thread_id>' }`
 *
 * 不能用 href 里的 sessionId——那是主流跳转链接，跟子流 thread_id 是两回事。
 * tool 取消 / 失败时返回 JSON 不含 subSessionId → 返回 null（loadSubAgentThreads 跳过）。
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

- [ ] **Step 4: 跑测试确认 pass**

Run: `npx vitest run tests/server/workflow/threadState.test.ts --reporter=verbose`
Expected: PASS（含原有 + 新加 6 case）

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/agents/threadState.ts \
        tests/server/workflow/threadState.test.ts
git commit -m "feat(workflow): loadSubAgentThreads 支持 draft_document / review_contract 历史恢复

- 从 ToolMessage JSON 顶层 subSessionId 字段反查子 thread（spec v2 修硬伤）
- 新增 extractSubSessionIdFromToolResult 私有辅助函数
- 跳过场景：cancelled / interrupt 中刷新 / getTuple 返回 null 都不报错
- 兼容 ask_*_expert 命名规则反推（保持现有行为）"
```

---

### Task 8: `AiToolRenderer.vue` 路由扩展 + 守卫

**Files:**
- Modify: `app/components/ai/AiToolRenderer.vue`

> 测试在 Task 9 单独写（避免本 Task 的 commit 太大）。本 Task 仅改组件源码。

- [ ] **Step 1: 改 `AiToolRenderer.vue` 加 SUB_AGENT_LIKE_TOOLS 路由**

`<script setup lang="ts">` block 内：

```typescript
// 既有 import 保留
import SubAgentChainOfThought from './SubAgentChainOfThought.vue'

// 新加：SUB_AGENT_LIKE 工具集（用 CoT + 结果卡共存渲染）
const SUB_AGENT_LIKE_TOOLS = new Set(['draft_document', 'review_contract'])

function isLegacySubAgentTool(name: string): boolean {
    // ask_*_expert（caseAnalysis 7 个分析子代理）
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

// 守卫：仅在有数据 / 正在跑 / 失败时显示 CoT，避免 cancelled tool 显示空白卡
const shouldShowSubAgentCoT = computed(() => {
    if (!SUB_AGENT_LIKE_TOOLS.has(props.toolCall.name)) return false
    return subAgentMessages(props.toolCall.id).length > 0
        || subAgentIsRunning(props.toolCall.id)
        || subAgentIsFailed(props.toolCall.id)
})
```

`<template>` block 在 `isInterruptToolCardCall` 分支后、用户自定义工具分支前加新分支：

```vue
<template>
  <!-- 既有 interrupt 工具卡分支保留（优先级最高） -->
  <template v-if="isInterruptToolCardCall">
    <!-- ...保留现有内容 -->
  </template>

  <!-- 新加：SUB_AGENT_LIKE 工具双卡共存（CoT 在前，结果卡在后） -->
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
      @confirm="emit('confirm', $event)"
      @reject="emit('reject')"
    />
  </template>

  <!-- 用户自定义工具优先（draft_document / review_contract 在上面已命中，不会落到这里） -->
  <component
    v-else-if="toolMap?.[toolCall.name]"
    ...
  />

  <!-- 既有 ask_*_expert 子代理工具分支：用 isLegacySubAgentTool 收紧匹配避免抢渲染 -->
  <SubAgentChainOfThought
    v-else-if="isLegacySubAgentTool(toolCall.name)"
    :agent-title="subAgentTitleFromName(toolCall.name)"
    :sub-messages="subAgentMessages(toolCall.id)"
    :is-running="subAgentIsRunning(toolCall.id)"
    :is-failed="subAgentIsFailed(toolCall.id)"
    :failure-reason="subAgentError(toolCall.id)"
  />

  <!-- 其余 toolMap fallback 分支保持不变 -->
  <!-- ... -->
</template>
```

> ⚠️ 关键：把原来的 `v-else-if="isSubAgentTool(toolCall.name)"` 改成 `v-else-if="isLegacySubAgentTool(toolCall.name)"`，避免 SUB_AGENT_LIKE 工具落到 legacy 分支被双重渲染。

- [ ] **Step 2: 跑现有 AiToolRenderer 测试确认无回归**

Run: `npx vitest run tests/app/components/ai/AiToolRenderer.test.ts --reporter=verbose`
Expected: 现有 7 个 case 全 PASS（interrupt 优先级 / 普通工具 / messageStreamContext 缺失等场景）

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/AiToolRenderer.vue
git commit -m "feat(ui): AiToolRenderer 支持 draft_document / review_contract 双卡共存

- 新增 SUB_AGENT_LIKE_TOOLS 集合（draft_document / review_contract）
- shouldShowSubAgentCoT 守卫：cancelled tool 不显示空 CoT
- legacy ask_*_expert 分支收紧到 isLegacySubAgentTool（避免双重渲染）
- interrupt 优先级最高的现有逻辑保留不变"
```

---

### Task 9: `AiToolRenderer.test.ts` 单测扩展（双卡 / 守卫 / 回归 / interrupt 优先级）

**Files:**
- Test: `tests/app/components/ai/AiToolRenderer.test.ts`（扩展）

- [ ] **Step 1: 加双卡共存测试**

在 `tests/app/components/ai/AiToolRenderer.test.ts` 现有 `describe` 块末尾追加：

```typescript
describe('AiToolRenderer - SUB_AGENT_LIKE 双卡分支（draft_document / review_contract）', () => {
    function makeSubAccess(toolCallId: string, opts: {
        messages?: any[]
        status?: 'running' | 'completed' | 'failed'
        error?: string
    }) {
        return {
            subThreadsMap: {
                [toolCallId]: {
                    agentName: 'documentMain',
                    threadId: 'sub-x',
                    messages: opts.messages ?? [],
                    status: opts.status ?? 'completed',
                    error: opts.error,
                },
            },
        }
    }

    it('draft_document 跑中（state=input-available + isRunning） → 仅 SubAgentChainOfThought', () => {
        const subAccess = makeSubAccess('call-d1', { status: 'running' })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call-d1', name: 'draft_document', args: {}, state: 'input-available' },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        // CoT 在，结果卡不在（state !== output-available）
        // SubAgentChainOfThought 是真实组件，找它的根 div / 标志元素
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(true)
        expect(wrapper.find('.stub-result-card').exists()).toBe(false)
    })

    it('draft_document 跑完（state=output-available + 有 messages） → CoT + 结果卡都在', () => {
        const subAccess = makeSubAccess('call-d2', {
            messages: [{ type: 'ai', content: 'done' }],
            status: 'completed',
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call-d2',
                    name: 'draft_document',
                    args: {},
                    result: { ok: true },
                    state: 'output-available',
                },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(true)
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })

    it('draft_document cancelled（无 messages、未 running、未 failed） → 仅 结果卡，不显示空 CoT', () => {
        const subAccess = makeSubAccess('call-d3', { status: 'completed', messages: [] })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call-d3',
                    name: 'draft_document',
                    args: {},
                    result: { cancelled: true },
                    state: 'output-available',
                },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        // 守卫生效：CoT 不渲染
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(false)
        expect(wrapper.find('.stub-result-card').exists()).toBe(true)
    })

    it('draft_document 失败（isFailed=true）→ CoT 显示，failureReason 透传', () => {
        const subAccess = makeSubAccess('call-d4', { status: 'failed', error: '模型超时' })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call-d4',
                    name: 'draft_document',
                    args: {},
                    state: 'input-available',
                },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        const cot = wrapper.findComponent({ name: 'SubAgentChainOfThought' })
        expect(cot.exists()).toBe(true)
        expect(cot.props('isFailed')).toBe(true)
        expect(cot.props('failureReason')).toBe('模型超时')
    })

    it('review_contract → agentTitle="合同审查"', () => {
        const subAccess = makeSubAccess('call-r1', { status: 'running' })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call-r1', name: 'review_contract', args: {}, state: 'input-available' },
                toolMap: { review_contract: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        const cot = wrapper.findComponent({ name: 'SubAgentChainOfThought' })
        expect(cot.exists()).toBe(true)
        expect(cot.props('agentTitle')).toBe('合同审查')
    })

    it('legacy ask_*_expert 分支保持工作（回归保护）', () => {
        const subAccess = makeSubAccess('call-leg', {
            messages: [{ type: 'ai', content: '专家分析' }],
            status: 'completed',
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: {
                    id: 'call-leg',
                    name: 'ask_evidence_expert',
                    args: {},
                    state: 'output-available',
                    result: 'expert reply',
                },
                toolMap: {},  // 无映射 → 走 legacy 子代理分支
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: makeContext({}) } },
        })
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(true)
    })

    it('interrupt 优先级 > SUB_AGENT_LIKE：active interrupt 时 CoT 不抢渲染', () => {
        const subAccess = makeSubAccess('call-int', { status: 'running' })
        const ctx = makeContext({
            interruptData: { type: 'stub_tool_select', toolCallId: 'call-int' },
        })
        const wrapper = mount(AiToolRenderer, {
            props: {
                toolCall: { id: 'call-int', name: 'draft_document', args: {}, state: 'input-available' },
                toolMap: { draft_document: StubResultCard },
            },
            global: { provide: { subAgentAccess: subAccess, messageStreamContext: ctx } },
        })
        // 走 interrupt 分支：InterruptDispatcher 渲染 stub_tool_select；CoT 不出现
        expect(wrapper.find('.stub-tool-card').exists()).toBe(true)
        expect(wrapper.findComponent({ name: 'SubAgentChainOfThought' }).exists()).toBe(false)
    })
})
```

- [ ] **Step 2: 跑测试确认 pass**

Run: `npx vitest run tests/app/components/ai/AiToolRenderer.test.ts --reporter=verbose`
Expected: PASS（含原有 7 case + 新加 7 case = 14 case）

- [ ] **Step 3: Commit**

```bash
git add tests/app/components/ai/AiToolRenderer.test.ts
git commit -m "test(ui): AiToolRenderer 双卡共存 / 守卫 / interrupt 优先级测试

- 跑中 / 跑完 / cancelled / failed 4 个状态分支
- review_contract agentTitle 中文化
- legacy ask_*_expert 分支回归保护
- interrupt > SUB_AGENT_LIKE 优先级回归"
```

---

### Task 10: 整合测试 + E2E 综合链路验收

**Files:**
- 无新建文件

- [ ] **Step 1: 跑全量后端测试**

Run: `bun run test:server --reporter=default`
Expected: 全部 PASS（重点关注 agent-platform / workflow / tools 三个目录）

- [ ] **Step 2: 跑全量前端测试**

Run: `bun run test:client`
Expected: 全部 PASS

- [ ] **Step 3: 类型检查**

Run: `bun run typecheck`
Expected: 0 errors（重点关注 `CallbackHandlerMethods` 的 import 路径在 TS 严格模式下生效）

- [ ] **Step 4: 启动 dev server**

Run: `bun dev`
Expected: 编译成功，端口 3000 可访问

- [ ] **Step 5: E2E 综合链路验收（chrome-devtools）**

打开浏览器至 `http://localhost:3000/dashboard/cases/<某测试案件 id>?focus=xiaosuo`，登录测试账号 `13064768490`/`daixin88`。

**子任务 5.1 — 跑中实时反馈**：
1. 在小索发"起草起诉状" → 模板候选弹出
2. 选模板 → 点「使用此模板」
3. **观察**：30 秒内 UI 应出现 `<SubAgentChainOfThought>`，header 显示「文书生成 思考中...」+ Loader2 转圈
4. 步骤列表应渐进显示「思考」（thinking 内容）+「分析」（content 累积）
5. 跑完后 1 秒，CoT 折叠成一行「思考 N s」+ 「文书生成」标题
6. 下方 `DraftDocumentCard` 显示「已完成起草《...》X/Y 字段」+ 跳转链接

**子任务 5.2 — 历史恢复**：
1. 跑完后 **F5 刷新页面**
2. **观察**：`<SubAgentChainOfThought>` 自动出现（默认折叠态），点击 header 展开看完整 step 列表（含 thinking / 工具调用 / 分析 / 结论）
3. `DraftDocumentCard` 同时存在
4. 主流可继续对话

**子任务 5.3 — 错误反馈**（可选 / 高风险路径）：
1. 临时 mock documentMain 节点的 modelApiKey.status=0（模拟无 API key）
2. 重新触发 draft_document → 应抛 `documentMain 节点没有可用的 API 密钥`
3. **观察**：CoT header 红徽章「失败：documentMain 节点没有可用的 API 密钥」+ 不自动折叠
4. 主流仍能继续对话（caseMain 不被影响）
5. 测完恢复 modelApiKey

- [ ] **Step 6: 杀 dev server（铁律）**

Run: `lsof -ti:3000 | xargs kill -9 2>/dev/null || true`

- [ ] **Step 7: 最终 commit（如有未 commit 的改动）**

```bash
git status
# 应该是 clean（前面任务都各自 commit 了）
```

---

## 决策记录

### D1：buildSubAgentCallbacks 单测保留（违反 spec v2 减项）

**spec v2 减项**：删除 `buildSubAgentCallbacks.test.ts` 独立测试文件，通过 caller（subAgentToolFactory + draftDocument + reviewContract）测试间接覆盖。

**plan 决策**：恢复独立测试文件。

**理由**：
- `.claude/rules/agent-platform.md` 铁律：`agent-platform/**` 覆盖率 ≥90%
- helper 是核心新增模块，5 个 handler 各有 happy path + 异常路径 + .catch 兜底，间接覆盖难以保证全部命中
- 直接单测成本极低（mock publish 函数 + 调 handler 断言参数），收益高（精确覆盖每个 handler）
- 新增 helper 偏离了 spec 减项的"可读性优于覆盖率"考量；铁律应优先

### D2：review_contract skipStanceInterrupt 路径限制

**事实**：`reviewContract.tool` 走 `skipStanceInterrupt: true` → `contractReviewMainAgent.runContractReviewChat` 进入 ReadableStream 自构造分支（line 482-655）。该分支**不**调用 `agent.stream`，因此本 plan 注入的 callbacks 在该路径**不会触发**。

**实际表现**：
- 跑中：subThreadsMap 收不到任何 SUB_AGENT_TOKEN / SUB_AGENT_TOOL_START / SUB_AGENT_TOOL_END 事件 → CoT 没消息
- AiToolRenderer 守卫 `shouldShowSubAgentCoT` 在无消息且未 running 时**不渲染** CoT 卡 → graceful no-op
- 现有 `ReviewContractCard` 仍正常显示 stage 进度（segment / detect / stance / analyze N/M / summarize）

**决策**：本 plan **仍**注入 callbacks（向后兼容首轮 stance interrupt 路径），不改造 skipStanceInterrupt 路径。

**理由**：
- spec 主目标是 draft_document（用户痛点真实场景）；review_contract 已有 ReviewContractCard stage 反馈，"30 秒黑盒"不严重
- 改造 skipStanceInterrupt 路径用 createAgent 包装 analyze loop / summarize 是较大架构改动，应单独 design + 单独 plan
- graceful no-op 是合理降级；用户后续 review 阶段如要求覆盖法律助手场景再做后续 follow-up plan

### D3：mapMessagesToSteps 跑中不显示 tool_call step（沿用既有行为）

**事实**：`useStreamChat.handleAgentEvent` 处理 SUB_AGENT_TOOL_END 时只 push `ToolMessage`（无对应 AIMessage with `tool_calls`），导致 `mapMessagesToSteps` 不能识别 tool_call → 跑中 CoT 仅显示 thinking + analysis（无工具调用步骤）。

**决策**：本 plan 不修复（沿用 ask_*_expert 既有行为）。

**理由**：
- 历史恢复路径走 PostgresSaver 真实 messages（含 tool_calls），完整 step 显示
- 跑中无 tool_call step 是 ask_*_expert 现有行为，未引发线上问题
- 修复需要扩展 SUB_AGENT_TOOL_START 协议（加 toolName + push 到对应 AIMessage.tool_calls）+ 同步前端 useStreamChat 处理逻辑——属于跨工具改造，应独立 plan

### D4：测试 D（extractSubSessionIdFromToolResult 纯函数）通过 loadSubAgentThreads 间接覆盖

**spec D 计划**：`extractSubSessionIdFromToolResult` 单独写 4 个边界测试（合法 / 无字段 / 非合法 JSON / 不存在）。

**plan 决策**：函数保持模块内私有，通过 `loadSubAgentThreads` 的 5 个整合测试间接覆盖所有边界。

**理由**：
- 函数仅有 ~10 行逻辑，4 个边界已通过 `loadSubAgentThreads` 测试集合中的 cancelled / interrupt 中刷新 / getTuple null / 混合 ask+draft 用例覆盖到位
- 直接 export 私有函数仅为测试是反模式（污染模块 API）

---

## 风险

| 风险 | 缓解 |
|---|---|
| `subAgentToolFactory` DRY 后行为变化（新 handleChainError 触发）影响线上 ask_*_expert 失败路径 | 跑现有 `subAgentToolFactory.test.ts` 回归 + Task 2 Step 1 加专项 chain error case；E2E 时手测一次 ask_*_expert 失败场景 |
| `runDocumentChat` 加 callbacks 选项后 `errorTraceHandler` 与用户 callbacks 顺序错误，导致 errorTraceHandler 之前的诊断丢失 | Task 3 测试明确断言 `callbacks[0] === errorTraceHandler && callbacks[1] === userCallback`（顺序硬编） |
| LangGraph callbacks 在 `stream` 模式下行为可能与 `invoke` 模式不同（subAgentToolFactory 用 invoke，runDocumentChat 用 stream） | E2E 验收（Task 10 Step 5）观察 CoT 是否实际收到 token / tool 事件；如不工作回退到 spike：先在 dev server 加 console.log 确认 handleLLMNewToken 被调 |
| review_contract callbacks no-op 让用户疑惑「为什么合同审查没 CoT」 | shouldShowSubAgentCoT 守卫保证不显示空白卡；ReviewContractCard 现有 stage 反馈仍在，体验不差。本 plan 决策记录 D2 已 explicit 文档 |
| 历史回放 CoT 时与 interrupt 卡片恢复路径冲突 | `isInterruptToolCardCall` 优先级最高已在 v-if 链最前；Task 9 测试明确覆盖此场景 |

## 后续工作（不在本 plan 范围）

- review_contract skipStanceInterrupt 路径 CoT 改造（D2）：用 createAgent 包装 analyze loop / summarize，让 callbacks 生效
- 跑中 CoT 显示 tool_call step（D3）：扩展 SUB_AGENT_TOOL_START/END 协议 + useStreamChat 同步
- 法律助手 vertical（assistantChat）走 draft_document / review_contract 时的 CoT 接入
- 子流嵌套（documentMain 内部又调子代理工具）的多级 CoT 展示
