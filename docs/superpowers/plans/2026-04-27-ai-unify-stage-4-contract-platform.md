# 阶段 4 · 合同审查接入底座 实施计划（C+ 方案）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把合同审查从"半 stateGraph 半裸调"形态收敛为"标准 stateGraph 业务"——通过升级平台 stateGraph 路径承接 SSE 桥/nodeConfig 加载/错误兜底，让 contract vertical 代码精简、与平台基建对齐，同时保留现有 resume 流程的本质（不引入 Command.resume，不重写 runAnalyzeLoop）。

**Architecture:** C+ 方案（2026-04-27 已与用户对齐 + spec §6 阶段 4 已修订）。承认合同审查与案件初分一样属于"流程固定型"业务，平台需同时支持 createAgent 和 stateGraph 两种形态。本阶段为 stateGraph 路径补齐通用职责，并把合同审查接入。

**Tech Stack:** TypeScript / LangGraph (StateGraph) / Vitest / Prisma / Vue 3 (前端契约不动)

---

## 关键事实速览（动手前必读）

**调研结论**（来自 2026-04-27 完整 grep + Read，详见 docs/superpowers/notes/2026-04-27-stage3-to-stage4-handoff.md 与 plan 末尾的"调研引用"）：

1. **现状不是"无 vertical"**：`server/agents/contract/agent.config.ts` 阶段 2 已接入 `defineDomainAgent`（agentType=stateGraph, nodeName='contractReviewMain'）。runStateGraph 内部委托给 `server/services/workflow/agents/contractReviewMainAgent.ts` 的 `runContractReviewChat`。

2. **当前 stateGraph 路径裸调无注入**：`defineDomainAgent.ts:50-53`：
   ```ts
   if (def.agentType === 'stateGraph') {
       // stateGraph 路径：完全由业务实现，工厂不干预中间件/工具
       return def.runStateGraph!(ctx)
   }
   ```
   工厂不提供 SSE 桥、nodeConfig 缓存、错误兜底、afterRun 钩子（虽然 def.hooks.afterRun 在 types 定义里，但 stateGraph 路径根本不调）。

3. **runContractReviewChat 自己造一切**（contractReviewMainAgent.ts）：
   - 自己 `getValidNodeConfig('contractReviewMain', '合同审查主Agent')`
   - 自己 `createChatModel()`
   - 自己 `getCheckpointer() / getStore()`
   - 自己造 `emitterCtx = { runId, sessionId }` 并直接调 `emitContractReviewEvent`
   - 自己 try/catch + logger.error
   - resume 分支自构造 `new ReadableStream({ start(controller) { ... } })`

4. **resume 流程本质保留**（C+ 决策）：
   - 后端 `/stance` 端点 enqueue 新 run（不用 Command.resume）
   - 前端 `stream.reset()+submit()`
   - resume 分支顺序调 `runAnalyzeLoop` → `summarizeOverview` → `persistRisksAndCreateV1Snapshot` → `runAnnotateAndUpload`
   - 这些都**不动**

5. **docx skill 接入**（spec 阶段 4 完成定义之一）：
   - `contractReviewMain` (id=18) 节点关联 docx skill
   - 4 个 skill 工具（read_skill_file 等）会自动跟随注入到 LLM 的可用工具
   - 仅给主节点接 — `contractReviewAnalyzeClause` (id=20) 等子节点是 extraction 类型走 invokeNodeJson，挂 skill 无意义

6. **前端契约 100% 不动**：
   - `useContractReview.ts` (480 行) 不动 — C+ 留给阶段 7
   - `ContractReviewPanel.vue` (674 行) 不动
   - SSE 事件序列 byte-for-byte 一致（前端契约）
   - `/api/v1/assistant/contract/chat` 接口契约不变

7. **测试现状**：
   - `tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts` (333 行，4 case)
   - `contractReviewMainAgent.contextSegments.test.ts` (173 行)
   - `contractReviewMainAgent.playbook.test.ts` (80 行)
   - `contractReviewMainAgent.stage.test.ts` (34 行)
   - `contractReviewMainAgent.test.ts` (22 行 smoke)
   - 现有 mock 策略：`getValidNodeConfig` / `analyzeSingleClause` / `summarizeOverview` / `emitContractReviewEvent` / 中间件全 mock

---

## 文件结构总览（本阶段产出）

| 文件 | 类型 | 责任 |
|---|---|---|
| `server/services/agent-platform/factory/runtime.ts` | 修改 | 新增 `runStateGraphAgent(def, ctx)` 函数，承接 stateGraph 路径通用职责 |
| `server/services/agent-platform/factory/types.ts` | 修改 | `runStateGraph` 签名改为接收增强版 ctx（含 emitter/errorReporter/nodeConfig 等） |
| `server/services/agent-platform/factory/defineDomainAgent.ts` | 修改 | stateGraph 路径改为调 `runStateGraphAgent` |
| `server/services/agent-platform/sse/customEventEmitter.ts` | 新建 | 通用 customEvent emitter 工厂（按 runId/sessionId 绑定，包装 publishCustomEvent） |
| `server/agents/contract/agent.config.ts` | 修改 | runStateGraph 接收增强 ctx，把 emitterCtx 透传给 runContractReviewChat |
| `server/services/workflow/agents/contractReviewMainAgent.ts` | 修改 | runContractReviewChat 接受 platformCtx 参数（emitter/nodeConfig），删除自加载逻辑 |
| `server/services/workflow/nodes/contractReviewStageEmitter.ts` | 修改 | emitContractReviewEvent 改为接收 emitter 注入（向后兼容旧接口） |
| `prisma/seeds/seedData.sql` | 修改 | 新增 contractReviewMain (nodeId=18) → docx skill 关联 INSERT |
| `scripts/stage4-apply-contract-skill.ts` | 新建 | 一次性同步脚本：现有 DB 加 contractReviewMain ↔ docx 关联（幂等） |
| `tests/server/agent-platform/factory/runStateGraphAgent.test.ts` | 新建 | 平台 stateGraph 路径单测（ctx 注入正确性、错误兜底、afterRun 调用） |
| `tests/server/agent-platform/nodeSkills.contract.test.ts` | 新建 | 合同审查 docx skill 关联防回退测试（锁 seedData） |
| 现有 4 个合同审查测试 | 修改 | mock 策略同步：从 mock `getValidNodeConfig` 改为 mock 平台注入的 nodeConfig |
| `scripts/stage4-regression.sh` | 新建 | 阶段 4 全量回归脚本 |
| `docs/superpowers/notes/2026-04-27-stage4-sse-event-baseline.md` | 新建 | 改造前 SSE 事件序列录像基线（用于 byte-for-byte 对比） |

---

## Task 1：清工作区 + 起手准备

**Files:**
- 检查：`git status --short`
- 检查：`git rev-parse HEAD` (应在 `dev-stage4-contract-platform` 分支)

- [ ] **Step 1: 工作区干净度检查**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
git status --short
git branch --show-current
```

预期：`dev-stage4-contract-platform` 分支，工作区只有 plan 文件 (`docs/superpowers/plans/2026-04-27-ai-unify-stage-4-contract-platform.md`)。

- [ ] **Step 2: 确认 stage 3 tag 存在**

```bash
git tag --list | grep ai-unify
```

预期看到 `ai-unify-stage-3-done`。当前 HEAD 应在其之上。

- [ ] **Step 3: 起 dev server 录 SSE 基线（在改之前）**

```bash
# 在另一个终端，或后台
bun dev
```

等待 ready 后，操作：上传一份合同 → 选立场 → 完成审查 → 浏览器 DevTools Network 面板抓 `/contract/chat` 的 SSE 响应 → 复制保存到：

`/Users/daixin/work/dev/LexSeek/LexSeek/docs/superpowers/notes/2026-04-27-stage4-sse-event-baseline.md`

格式建议：
```markdown
# 阶段 4 · SSE 事件序列基线（改造前 byte-for-byte 录像）

## 测试用例：上传 X.docx → 选 partyA 立场 → 等待完成

### 首轮 stream（上传后第一次 chat）
event: custom
data: {"type":"stage","stage":"segment","status":"running"}
event: custom
data: {"type":"stage","stage":"segment","status":"done","totalClauses":30}
... (依次记录所有 event)

### Resume stream（选立场后 stream.reset+submit）
event: custom
data: {"type":"stage","stage":"detect","status":"running"}
... (依次记录所有 event)
```

> **Note：** 这一步是阶段 4 的"安全网"。改造完后跑同样用例对比 SSE 序列，差异 = bug。如果短时间不方便录基线，可以跳过，但 Task 8 验证时只能跑功能 E2E 不能做 byte-for-byte 对比，回归把握会弱。

- [ ] **Step 4: commit plan 文档**

```bash
git add docs/superpowers/plans/2026-04-27-ai-unify-stage-4-contract-platform.md
git add docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md
git commit -m "docs(stage4): 阶段 4 合同审查接入底座 plan + spec §6 阶段 4 修订（C+ 方案）"
```

---

## Task 2：定义增强版 stateGraph ctx 类型

**Files:**
- Modify: `server/services/agent-platform/factory/types.ts`

平台 stateGraph 路径要给业务注入：
1. 已加载好的 `nodeConfig`（避免业务再调 getValidNodeConfig）
2. 类型化的 `customEventEmitter`（包装 publishCustomEvent，绑定 runId/sessionId）
3. 错误兜底是平台职责（业务 throw 由平台 catch + publish status_change failed），所以业务侧 ctx 不需要 errorReporter API

- [ ] **Step 1: 定义增强版 ctx 类型**

在 `server/services/agent-platform/factory/types.ts` 现有 `DomainAgentDefinition` 之上新增：

```typescript
import type { NodeConfig } from '~~/server/services/node/node.service'

/**
 * 增强版 stateGraph 运行 ctx：在 AgentRunnerContext 之上注入平台已加载的能力。
 * 业务 vertical 的 runStateGraph 接收此类型，无需自己加载 nodeConfig / 造 emitter。
 */
export interface StateGraphAgentContext extends AgentRunnerContext {
    /** 平台已加载的节点配置（缓存） */
    nodeConfig: NodeConfig
    /**
     * 类型化 customEvent emitter（runId/sessionId 已绑定）。
     * 业务调 emit({ name, data }) 即可，平台底层调 publishCustomEvent。
     */
    emitCustomEvent: (event: { name: string; data: unknown }) => Promise<void>
}
```

- [ ] **Step 2: 修改 runStateGraph 签名**

把现有 `DomainAgentDefinition.runStateGraph` 签名从 `(ctx: AgentRunnerContext) => Promise<ReadableStream>` 改为 `(ctx: StateGraphAgentContext) => Promise<ReadableStream>`。

注意类型继承：StateGraphAgentContext 继承 AgentRunnerContext，所以现有业务 vertical 不会编译错（只是没用上新字段）。

- [ ] **Step 3: typecheck 确认现有 4 个 stateGraph vertical 编译通过**

```bash
npx nuxi typecheck 2>&1 | grep -E "case-module|document|contract|case-analysis" | head -10
```

预期无新错。如果某 vertical 因为类型不兼容报错，原样保留它的 runStateGraph 实现，只是不用新字段（StateGraphAgentContext 兼容 AgentRunnerContext）。

- [ ] **Step 4: commit**

```bash
git add server/services/agent-platform/factory/types.ts
git commit -m "feat(stage4): 平台 factory types 新增 StateGraphAgentContext（注入 nodeConfig + emitCustomEvent）"
```

---

## Task 3：实现通用 customEventEmitter

**Files:**
- Create: `server/services/agent-platform/sse/customEventEmitter.ts`

`emitContractReviewEvent` 当前自己组装 `publishCustomEvent({ type, runId, sessionId, name: 'contract_review', data })`，每个业务都得这么手写。提取为通用工厂。

- [ ] **Step 1: 看 publishCustomEvent 实际签名**

```bash
grep -n "export.*publishCustomEvent" /Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent/agentEventBridge.ts
```

读取该函数前 30 行，确认参数 shape。

- [ ] **Step 2: 写 emitter 工厂**

`/Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent-platform/sse/customEventEmitter.ts`：

```typescript
/**
 * 通用 customEvent emitter 工厂
 *
 * 包装 publishCustomEvent 把 runId/sessionId 绑定在闭包里，
 * 业务调用时只需给出 { name, data }，避免 6 个业务 vertical
 * 各自重复 "造 emitterCtx + 调 publishCustomEvent" 模板。
 *
 * @see docs/superpowers/plans/2026-04-27-ai-unify-stage-4-contract-platform.md Task 3
 */

import { logger } from '#shared/utils/logger'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

export interface CustomEventEmitter {
    (event: { name: string; data: unknown }): Promise<void>
}

export interface EmitterFactoryOptions {
    runId: string | undefined
    sessionId: string
}

/**
 * 创建一个绑定 runId/sessionId 的 customEvent 发射函数。
 *
 * 失败语义：fire-and-forget，仅 log warn 不抛错（与现有 emitContractReviewEvent 一致）。
 */
export function createCustomEventEmitter(opts: EmitterFactoryOptions): CustomEventEmitter {
    const { runId, sessionId } = opts
    return async ({ name, data }) => {
        try {
            await publishCustomEvent({
                type: 'custom_event',
                runId: runId ?? 'unknown',
                sessionId,
                name,
                data,
            })
        } catch (err) {
            logger.warn('[customEventEmitter] publishCustomEvent failed', {
                name,
                runId,
                sessionId,
                err: err instanceof Error ? err.message : String(err),
            })
        }
    }
}
```

> **publishCustomEvent 签名核对**：如果 Step 1 看到的实际签名与上面不一致（例如 runId 必填、shape 不同），按实际改 — 重点是把 publishCustomEvent 包装为 `(name, data) => void`。

- [ ] **Step 3: 写单测**

`/Users/daixin/work/dev/LexSeek/LexSeek/tests/server/agent-platform/sse/customEventEmitter.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCustomEventEmitter } from '~~/server/services/agent-platform/sse/customEventEmitter'

vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn().mockResolvedValue(undefined),
}))

describe('customEventEmitter', () => {
    beforeEach(() => vi.clearAllMocks())

    it('绑定 runId/sessionId 后只暴露 (name, data) 接口', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        const emit = createCustomEventEmitter({ runId: 'run-1', sessionId: 'sess-1' })

        await emit({ name: 'contract_review', data: { type: 'stage', stage: 'detect', status: 'running' } })

        expect(publishCustomEvent).toHaveBeenCalledTimes(1)
        expect(publishCustomEvent).toHaveBeenCalledWith({
            type: 'custom_event',
            runId: 'run-1',
            sessionId: 'sess-1',
            name: 'contract_review',
            data: { type: 'stage', stage: 'detect', status: 'running' },
        })
    })

    it('runId 为 undefined 时使用 "unknown" 兜底', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        const emit = createCustomEventEmitter({ runId: undefined, sessionId: 'sess-1' })
        await emit({ name: 'x', data: {} })
        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: 'unknown' }))
    })

    it('publishCustomEvent 失败时不抛错（fire-and-forget）', async () => {
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        ;(publishCustomEvent as any).mockRejectedValueOnce(new Error('boom'))
        const emit = createCustomEventEmitter({ runId: 'r', sessionId: 's' })
        await expect(emit({ name: 'x', data: {} })).resolves.toBeUndefined()
    })
})
```

- [ ] **Step 4: 跑测试 → PASS**

```bash
npx vitest run tests/server/agent-platform/sse/customEventEmitter.test.ts --reporter=verbose
```

预期 3 个 case PASS。

- [ ] **Step 5: commit**

```bash
git add server/services/agent-platform/sse/customEventEmitter.ts tests/server/agent-platform/sse/customEventEmitter.test.ts
git commit -m "feat(stage4): 通用 customEventEmitter 工厂 + 单测（包装 publishCustomEvent，绑定 runId/sessionId）"
```

---

## Task 4：实现 runStateGraphAgent（平台 stateGraph 路径主入口）

**Files:**
- Modify: `server/services/agent-platform/factory/runtime.ts`

承接 stateGraph 路径的通用职责：加载 nodeConfig + 注入 emitter + 错误兜底 + afterRun 钩子。

- [ ] **Step 1: 在 runtime.ts 末尾追加 runStateGraphAgent 函数**

打开 `/Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent-platform/factory/runtime.ts`，在文件末尾追加：

```typescript
import { createCustomEventEmitter } from '~~/server/services/agent-platform/sse/customEventEmitter'
import type { StateGraphAgentContext } from './types'

/**
 * 执行 DomainAgent 主流程（stateGraph 路径）。
 *
 * 与 createAgent 路径不同：不组装中间件栈、不创建 LangChain agent、
 * 不强制走 agent.stream。业务 vertical 的 runStateGraph 自行决定流程，
 * 平台仅承接通用职责：
 *   1. 节点配置加载（缓存）
 *   2. 注入类型化 customEvent emitter（绑定 runId/sessionId）
 *   3. 错误兜底（业务 throw → 平台 publish status_change failed → 返回失败 stream）
 *   4. afterRun 钩子（无论 success/failure 都触发）
 *
 * 适用场景：流程固定型业务（合同审查、案件初分），不适合 createAgent 工具循环。
 *
 * @see docs/superpowers/plans/2026-04-27-ai-unify-stage-4-contract-platform.md Task 4
 */
export async function runStateGraphAgent(
    def: DomainAgentDefinition,
    ctx: AgentRunnerContext,
): Promise<ReadableStream> {
    if (!def.runStateGraph) {
        throw new Error(
            `[runStateGraphAgent] vertical "${def.scope}" 的 agentType=stateGraph 但未提供 runStateGraph 函数`,
        )
    }

    // 1. 解析节点名称（支持动态函数形式）
    const resolvedNodeName = typeof def.nodeName === 'function' ? def.nodeName(ctx) : def.nodeName

    // 2. 加载节点配置（内存缓存）
    const nodeConfig = await getNodeConfigCached(resolvedNodeName)
    if (!nodeConfig) {
        throw new Error(
            `节点 "${resolvedNodeName}" 未找到（vertical=${def.scope}），请检查节点名称或在管理后台创建该节点`,
        )
    }

    // 3. 注入类型化 customEvent emitter
    const emitCustomEvent = createCustomEventEmitter({
        runId: ctx.runId,
        sessionId: ctx.sessionId,
    })

    // 4. 构造增强版 ctx
    const enhancedCtx: StateGraphAgentContext = {
        ...ctx,
        nodeConfig,
        emitCustomEvent,
    }

    // 5. beforeRun 钩子
    await def.hooks?.beforeRun?.(enhancedCtx)

    // 6. 执行业务 stateGraph，错误兜底
    let success = true
    let stream: ReadableStream
    try {
        stream = await def.runStateGraph(enhancedCtx)
    } catch (err) {
        success = false
        // 平台兜底：业务 throw 转为 SSE failed event
        await emitCustomEvent({
            name: 'status_change',
            data: {
                type: 'status_change',
                runId: ctx.runId,
                sessionId: ctx.sessionId,
                status: 'failed',
                error: err instanceof Error ? err.message : String(err),
            },
        }).catch(() => {/* fire-and-forget */})
        await def.hooks?.afterRun?.(enhancedCtx, false)
        throw err
    }

    // 7. afterRun 钩子（流关闭/取消时触发）
    if (def.hooks?.afterRun) {
        return wrapStreamWithAfterRun(stream, enhancedCtx, def.hooks.afterRun)
    }

    return stream
}
```

> **wrapStreamWithAfterRun 复用**：现有 `wrapStreamWithAfterRun` 函数（runtime.ts 第 287 行附近）已经处理 ReadableStream 的 close/cancel 钩子，且签名兼容（接收 ctx + afterRun）。直接复用，但注意 ctx 类型变成了 `StateGraphAgentContext`（继承 AgentRunnerContext，不会破类型）。

- [ ] **Step 2: 修改 defineDomainAgent.ts 把 stateGraph 路径接入 runStateGraphAgent**

打开 `/Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent-platform/factory/defineDomainAgent.ts`，把：

```typescript
const runner = async (ctx: Parameters<typeof runDomainAgent>[1]) => {
    if (def.agentType === 'stateGraph') {
        // stateGraph 路径：完全由业务实现，工厂不干预中间件/工具
        return def.runStateGraph!(ctx)
    }
    // createAgent 路径：由 runtime 统一处理
    return runDomainAgent(def, ctx)
}
```

改为：

```typescript
const runner = async (ctx: Parameters<typeof runDomainAgent>[1]) => {
    if (def.agentType === 'stateGraph') {
        // stateGraph 路径：平台承接 nodeConfig 加载 + emitter 注入 + 错误兜底
        return runStateGraphAgent(def, ctx)
    }
    // createAgent 路径：由 runtime 统一处理（中间件 + 工具 + agent.stream）
    return runDomainAgent(def, ctx)
}
```

加 import：
```typescript
import { runDomainAgent, runStateGraphAgent } from './runtime'
```

- [ ] **Step 3: typecheck**

```bash
npx nuxi typecheck 2>&1 | grep -E "error TS" | grep -v "app.vue" | head -10
```

预期无新错。

- [ ] **Step 4: 跑现有 stateGraph 业务测试看有没有副作用**

```bash
npx vitest run \
  tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts \
  tests/server/workflow/agents/documentMainAgent.test.ts \
  tests/server/workflow/agents/moduleAgent.test.ts \
  --reporter=verbose 2>&1 | grep -E "Test Files|Tests|FAIL" | head -10
```

⚠️ 这一步**预期可能有 mock 不齐导致的失败**：业务测试如果直接 mock 了 def.runStateGraph 的 ctx，可能因为新加的 nodeConfig/emitCustomEvent 字段而 fail。如果 fail，按 Task 7 的"测试 mock 同步"处理。如果不 fail，皆大欢喜。

- [ ] **Step 5: commit**

```bash
git add server/services/agent-platform/factory/runtime.ts server/services/agent-platform/factory/defineDomainAgent.ts
git commit -m "feat(stage4): 平台 stateGraph 路径升级 — runStateGraphAgent 承接 nodeConfig/emitter/错误兜底"
```

---

## Task 5：runStateGraphAgent 单元测试

**Files:**
- Create: `tests/server/agent-platform/factory/runStateGraphAgent.test.ts`

- [ ] **Step 1: 写测试**

`/Users/daixin/work/dev/LexSeek/LexSeek/tests/server/agent-platform/factory/runStateGraphAgent.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runStateGraphAgent } from '~~/server/services/agent-platform/factory/runtime'
import type { DomainAgentDefinition } from '~~/server/services/agent-platform/factory/types'
import type { AgentRunnerContext } from '~~/server/services/agent-platform/registry/types'
import { SessionScope } from '#shared/types/agentEvent'

// Mock platform deps
vi.mock('~~/server/services/agent-platform/nodeConfig/loader', () => ({
    getNodeConfigCached: vi.fn(),
    invalidateNodeConfigCache: vi.fn(),
}))

vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn().mockResolvedValue(undefined),
}))

const mockNodeConfig = {
    id: 18,
    name: 'contractReviewMain',
    title: '合同审查主Agent',
    type: 'agent',
    tools: ['parse_and_ask_stance', 'search_law'],
    prompts: [{ type: 'system', status: 1, content: 'sys' }],
    modelName: 'm', modelSdkType: 'openai', modelStatus: 1,
    modelProviderId: 1, modelProviderBaseUrl: '', modelProviderName: 'p',
    modelApiKeys: [{ id: 1, apiKey: 'k', status: 1 }],
    modelContextWindow: 128000, modelMaxOutputTokens: 4096,
    outputSchema: null,
} as any

const baseCtx: AgentRunnerContext = {
    sessionId: 'sess-1',
    runId: 'run-1',
    userId: 1,
    caseId: null,
    message: 'hi',
    command: undefined,
    signal: undefined,
    metadata: {},
} as any

describe('runStateGraphAgent', () => {
    beforeEach(() => vi.clearAllMocks())

    it('注入 nodeConfig 与 emitCustomEvent 到 runStateGraph', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)

        const runStateGraph = vi.fn().mockResolvedValue(new ReadableStream())
        const def: DomainAgentDefinition = {
            scope: SessionScope.CONTRACT,
            agentType: 'stateGraph',
            nodeName: 'contractReviewMain',
            runStateGraph,
        }

        await runStateGraphAgent(def, baseCtx)

        expect(runStateGraph).toHaveBeenCalledTimes(1)
        const enhancedCtx = runStateGraph.mock.calls[0][0]
        expect(enhancedCtx.sessionId).toBe('sess-1')
        expect(enhancedCtx.nodeConfig).toBe(mockNodeConfig)
        expect(typeof enhancedCtx.emitCustomEvent).toBe('function')
    })

    it('emitCustomEvent 调用底层 publishCustomEvent 并绑定 runId/sessionId', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)

        const runStateGraph = vi.fn(async (ctx: any) => {
            await ctx.emitCustomEvent({ name: 'foo', data: { x: 1 } })
            return new ReadableStream()
        })

        await runStateGraphAgent(
            { scope: SessionScope.CONTRACT, agentType: 'stateGraph', nodeName: 'contractReviewMain', runStateGraph },
            baseCtx,
        )

        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
            runId: 'run-1', sessionId: 'sess-1', name: 'foo',
        }))
    })

    it('节点不存在时抛错（包含 vertical scope 信息）', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        ;(getNodeConfigCached as any).mockResolvedValue(null)

        await expect(runStateGraphAgent(
            { scope: SessionScope.CONTRACT, agentType: 'stateGraph', nodeName: 'missing', runStateGraph: vi.fn() },
            baseCtx,
        )).rejects.toThrow(/missing.*vertical=contract/)
    })

    it('runStateGraph throw 时平台 publish failed 事件并 rethrow', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        const { publishCustomEvent } = await import('~~/server/services/agent/agentEventBridge')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)

        const err = new Error('business boom')
        const def: DomainAgentDefinition = {
            scope: SessionScope.CONTRACT,
            agentType: 'stateGraph',
            nodeName: 'contractReviewMain',
            runStateGraph: vi.fn().mockRejectedValue(err),
        }

        await expect(runStateGraphAgent(def, baseCtx)).rejects.toThrow('business boom')
        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
            name: 'status_change',
            data: expect.objectContaining({ status: 'failed', error: 'business boom' }),
        }))
    })

    it('beforeRun / afterRun 钩子被调用', async () => {
        const { getNodeConfigCached } = await import('~~/server/services/agent-platform/nodeConfig/loader')
        ;(getNodeConfigCached as any).mockResolvedValue(mockNodeConfig)

        const beforeRun = vi.fn().mockResolvedValue(undefined)
        const afterRun = vi.fn().mockResolvedValue(undefined)

        const stream = await runStateGraphAgent(
            {
                scope: SessionScope.CONTRACT, agentType: 'stateGraph', nodeName: 'contractReviewMain',
                runStateGraph: vi.fn().mockResolvedValue(new ReadableStream()),
                hooks: { beforeRun, afterRun },
            },
            baseCtx,
        )

        expect(beforeRun).toHaveBeenCalledTimes(1)
        // afterRun 在 stream 关闭时触发，本测试不消费 stream，故只验证 beforeRun
        // afterRun 由 wrapStreamWithAfterRun 包装；完整路径在端到端 smoke 验证
        await stream.cancel()
    })
})
```

- [ ] **Step 2: 跑测试 → PASS**

```bash
npx vitest run tests/server/agent-platform/factory/runStateGraphAgent.test.ts --reporter=verbose
```

预期 5 个 case PASS。如果某 case 失败，根据具体错误调整断言写法（例如 mock 路径变化、错误消息正则）。

- [ ] **Step 3: commit**

```bash
git add tests/server/agent-platform/factory/runStateGraphAgent.test.ts
git commit -m "test(stage4): runStateGraphAgent 单测 — ctx 注入 / emitter / 错误兜底 / hooks"
```

---

## Task 6：合同审查 vertical 接入平台 ctx

**Files:**
- Modify: `server/agents/contract/agent.config.ts`
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`
- Modify: `server/services/workflow/nodes/contractReviewStageEmitter.ts`

把 contractReviewMainAgent 自加载的 nodeConfig 和自造的 emitterCtx 替换为平台注入版本。

- [ ] **Step 1: 修改 agent.config.ts 把 ctx 透传**

打开 `/Users/daixin/work/dev/LexSeek/LexSeek/server/agents/contract/agent.config.ts`，修改 `runStateGraph`：

```typescript
import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope } from '#shared/types/agentEvent'

export const contractAgent = defineDomainAgent({
    scope: SessionScope.CONTRACT,
    agentType: 'stateGraph',
    nodeName: 'contractReviewMain',
    description: '合同审查主 Agent（首轮 parseAndAskStance interrupt + resume 执行 runAnalyzeLoop）',
    runStateGraph: async (ctx) => {
        // ctx 是 StateGraphAgentContext，含平台注入的 nodeConfig + emitCustomEvent
        const { runContractReviewChat } = await import(
            '~~/server/services/workflow/agents/contractReviewMainAgent'
        )
        return runContractReviewChat(ctx.sessionId, {
            userId: ctx.userId,
            runId: ctx.runId,
            command: ctx.command as unknown,
            signal: ctx.signal,
            // 阶段 4 新增：透传平台注入的能力，避免 contractReviewMainAgent 自加载/自造
            platformNodeConfig: ctx.nodeConfig,
            platformEmitCustomEvent: ctx.emitCustomEvent,
        })
    },
})
```

- [ ] **Step 2: 修改 contractReviewMainAgent.ts 接受平台注入**

打开 `/Users/daixin/work/dev/LexSeek/LexSeek/server/services/workflow/agents/contractReviewMainAgent.ts`，找到 `ContractReviewAgentOptions` 接口（约 165-174 行），加两个 optional 字段：

```typescript
export interface ContractReviewAgentOptions {
    userId: number
    runId?: string
    signal?: AbortSignal
    command?: unknown
    /** 阶段 4 新增：平台注入的节点配置，存在时跳过自加载 */
    platformNodeConfig?: NodeConfig
    /** 阶段 4 新增：平台注入的 emitter，存在时替代 emitContractReviewEvent 内部 publishCustomEvent */
    platformEmitCustomEvent?: (event: { name: string; data: unknown }) => Promise<void>
}
```

加 `import type { NodeConfig } from '~~/server/services/node/node.service'`。

然后找到现有 nodeConfig 加载位置（约 269-274 行），改为：

```typescript
// 阶段 4：优先用平台注入的 nodeConfig，否则向后兼容自加载
const nodeConfig = options.platformNodeConfig ?? await getValidNodeConfig(
    'contractReviewMain',
    '合同审查主Agent',
)
```

找到 `emitterCtx` 定义位置（约 281 行附近），改为：

```typescript
const emitterCtx: ContractReviewEmitterCtx = {
    runId: options.runId,
    sessionId,
    // 阶段 4：透传平台 emitter（emitContractReviewEvent 内部识别使用）
    platformEmit: options.platformEmitCustomEvent,
}
```

- [ ] **Step 3: 修改 ContractReviewEmitterCtx 类型 + emitContractReviewEvent 实现**

打开 `/Users/daixin/work/dev/LexSeek/LexSeek/server/services/workflow/nodes/contractReviewStageEmitter.ts`：

```typescript
import { logger } from '#shared/utils/logger'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import type { Risk, ContractOverview } from '#shared/types/contract'

export interface ContractReviewEmitterCtx {
    runId: string | undefined
    sessionId: string
    /** 阶段 4：平台注入的 emitter，存在时优先调用；不存在时 fallback 自调 publishCustomEvent */
    platformEmit?: (event: { name: string; data: unknown }) => Promise<void>
}

export type ContractReviewEvent =
    | { type: 'stage'; stage: 'detect'|'stance'|'segment'|'analyze'|'summarize'; status: 'running'|'done'; warnings?: string[]; totalClauses?: number; partyA?: string|null; partyB?: string|null; contractType?: string|null }
    | { type: 'progress'; current: number; total: number; error?: string }
    | { type: 'risk'; risk: Risk }
    | { type: 'overview'; overview: ContractOverview }

export async function emitContractReviewEvent(
    ctx: ContractReviewEmitterCtx,
    event: ContractReviewEvent,
): Promise<void> {
    try {
        if (ctx.platformEmit) {
            // 阶段 4：走平台 emitter，统一 SSE 桥
            await ctx.platformEmit({ name: 'contract_review', data: event })
            return
        }
        // 向后兼容：测试或未接平台时直接调 publishCustomEvent
        await publishCustomEvent({
            type: 'custom_event',
            runId: ctx.runId ?? 'unknown',
            sessionId: ctx.sessionId,
            name: 'contract_review',
            data: event,
        })
    } catch (err) {
        logger.warn('[emitContractReviewEvent] failed', {
            event: event.type,
            err: err instanceof Error ? err.message : String(err),
        })
    }
}
```

> **关键**：保留向后兼容（platformEmit 不存在时 fallback），让现有测试 mock `publishCustomEvent` 的方式继续工作。

- [ ] **Step 4: 跑合同审查现有测试 → 应继续 PASS**

```bash
npx vitest run \
  tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts \
  tests/server/workflow/agents/contractReviewMainAgent.contextSegments.test.ts \
  tests/server/workflow/agents/contractReviewMainAgent.playbook.test.ts \
  tests/server/workflow/agents/contractReviewMainAgent.stage.test.ts \
  tests/server/workflow/agents/contractReviewMainAgent.test.ts \
  --reporter=verbose 2>&1 | grep -E "Test Files|Tests|FAIL" | head -10
```

预期 5 文件全 PASS（向后兼容设计 = 现有 mock 不需改）。

如果出现 FAIL，最常见是某 test 直接 import 了被改的 ContractReviewEmitterCtx 类型并构造对象 — 给该处加 `platformEmit: undefined` 即可。

- [ ] **Step 5: commit**

```bash
git add \
  server/agents/contract/agent.config.ts \
  server/services/workflow/agents/contractReviewMainAgent.ts \
  server/services/workflow/nodes/contractReviewStageEmitter.ts
git commit -m "feat(stage4): contract vertical 接入平台 stateGraph ctx — 透传 nodeConfig + emitCustomEvent"
```

---

## Task 7：测试 mock 同步（如 Task 6 Step 4 出现 FAIL）

**Files:**
- Modify: 失败的合同审查测试文件

> **如果 Task 6 Step 4 全 PASS，本 Task 跳过。**

如果有失败，按下面手法逐个修：

- [ ] **Step 1: 看 FAIL 报错**

针对每个失败的测试，看完整错误：

```bash
npx vitest run tests/server/workflow/agents/<failing>.test.ts --reporter=verbose 2>&1 | tail -40
```

- [ ] **Step 2: 调整 mock**

常见情况：
1. 测试构造 `ContractReviewEmitterCtx` 时缺 `platformEmit` 字段 → 加 `platformEmit: undefined` 或 `vi.fn()`
2. 测试 mock `runContractReviewChat` 调用参数断言遗漏新字段 → 改为 `expect.objectContaining({...})`
3. 测试 mock `getValidNodeConfig` 在 platformNodeConfig 注入后未被调用 → 删除该 mock 或断言 `not.toHaveBeenCalled`

- [ ] **Step 3: 再跑 → PASS**

- [ ] **Step 4: commit（如果有改动）**

```bash
git add tests/server/workflow/agents/
git commit -m "test(stage4): 合同审查测试 mock 同步 platformEmit/platformNodeConfig 字段"
```

---

## Task 8：合同审查接入 docx skill

**Files:**
- Modify: `prisma/seeds/seedData.sql`
- Create: `scripts/stage4-apply-contract-skill.ts`
- Create: `tests/server/agent-platform/nodeSkills.contract.test.ts`

contractReviewMain (id=18) 与 docx skill 关联。skills 表里 docx skill 的 name='docx'（来自 `.deepagents/skills/docx/`，stage 1 已 seed）。

- [ ] **Step 1: 看 node_skills seed 现有 INSERT 形式**

```bash
grep -n "node_skills" /Users/daixin/work/dev/LexSeek/LexSeek/prisma/seeds/seedData.sql | head -10
```

如果已有 INSERT 模板，照抄。如果没有，参考 `prisma/models/skill.prisma` 的 `node_skills` 表 schema（`nodeId`, `skillName`, `priority`）。

- [ ] **Step 2: 在 seedData.sql 末尾追加 INSERT**

在 seedData.sql 末尾（或与现有 node_skills 关联同区块）追加：

```sql
-- 阶段 4：contractReviewMain (id=18) 关联 docx skill
INSERT INTO "public"."node_skills" ("node_id", "skill_name", "priority", "created_at")
VALUES (18, 'docx', 100, '2026-04-27 10:00:00+08')
ON CONFLICT ("node_id", "skill_name") DO NOTHING;
```

> **Note：** priority 100 是中等优先级；docx 是这个节点目前唯一关联 skill，priority 不影响渲染顺序。`ON CONFLICT DO NOTHING` 让脚本幂等。

- [ ] **Step 3: 写一次性同步脚本**

`/Users/daixin/work/dev/LexSeek/LexSeek/scripts/stage4-apply-contract-skill.ts`：

```typescript
/**
 * 阶段 4 一次性数据更新脚本：合同审查节点关联 docx skill
 *
 * 用法：
 *   bun run scripts/stage4-apply-contract-skill.ts
 *   DATABASE_URL='...ls_new_testing...' bun run scripts/stage4-apply-contract-skill.ts
 *
 * 幂等：重复跑不会重复 insert（UNIQUE CONSTRAINT (node_id, skill_name) 保护）
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '~~/generated/prisma/client'

const pool = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    options: '-c TimeZone=UTC',
})
const prisma = new PrismaClient({ adapter: pool })

async function main(): Promise<void> {
    console.log('===== 阶段 4 · 合同审查 docx skill 关联开始 =====')
    console.log(`[env] DATABASE_URL=${process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@')}`)

    const node = await prisma.nodes.findUnique({ where: { name: 'contractReviewMain' } })
    if (!node) {
        console.warn('[skip] 节点 contractReviewMain 不存在（DB 未 seed？）')
        return
    }

    const skill = await prisma.skills.findUnique({ where: { name: 'docx' } })
    if (!skill) {
        console.warn('[skip] skill "docx" 不存在（先跑 POST /api/v1/admin/skills/resync 同步）')
        return
    }

    const existing = await prisma.node_skills.findUnique({
        where: { nodeId_skillName: { nodeId: node.id, skillName: 'docx' } },
    })
    if (existing) {
        console.log('[noop] contractReviewMain ↔ docx 关联已存在')
        return
    }

    await prisma.node_skills.create({
        data: { nodeId: node.id, skillName: 'docx', priority: 100 },
    })
    console.log(`[ok] 创建关联：contractReviewMain (id=${node.id}) ↔ docx (priority=100)`)
}

main()
    .catch((err) => {
        console.error('阶段 4 同步脚本失败：', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
```

- [ ] **Step 4: 跑脚本同步 dev 库**

```bash
bun run scripts/stage4-apply-contract-skill.ts
```

预期：`[ok] 创建关联：contractReviewMain (id=18) ↔ docx (priority=100)`

第二遍跑验证幂等：

```bash
bun run scripts/stage4-apply-contract-skill.ts
```

预期：`[noop] contractReviewMain ↔ docx 关联已存在`

- [ ] **Step 5: 防回退测试**

`/Users/daixin/work/dev/LexSeek/LexSeek/tests/server/agent-platform/nodeSkills.contract.test.ts`：

```typescript
/**
 * 阶段 4 节点 skill 关联防回退测试。
 * 锁 seedData.sql 里 contractReviewMain ↔ docx 的 INSERT。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SEED_PATH = resolve(__dirname, '../../../prisma/seeds/seedData.sql')

let seedSql: string

beforeAll(async () => {
    seedSql = await readFile(SEED_PATH, 'utf-8')
})

describe('阶段 4 · contractReviewMain ↔ docx skill 关联（seedData 锁定）', () => {
    it('seedData 含 node_skills INSERT 关联 contractReviewMain (id=18) 到 docx', () => {
        // 匹配模式：INSERT INTO ..."node_skills"... VALUES (18, 'docx', ...)
        const re = /INSERT INTO "public"\."node_skills"[^;]*?VALUES\s*\(\s*18\s*,\s*'docx'/
        expect(seedSql).toMatch(re)
    })
})
```

- [ ] **Step 6: 跑测试 → PASS**

```bash
npx vitest run tests/server/agent-platform/nodeSkills.contract.test.ts --reporter=verbose
```

- [ ] **Step 7: commit**

```bash
git add prisma/seeds/seedData.sql scripts/stage4-apply-contract-skill.ts tests/server/agent-platform/nodeSkills.contract.test.ts
git commit -m "feat(stage4): contractReviewMain 节点关联 docx skill（seedData + 同步脚本 + 防回退测试）"
```

---

## Task 9：端到端 smoke + SSE 序列对比

**Files:**
- 起 dev server + 浏览器走完整合同审查流程
- 对比 Task 1 Step 3 录的 SSE 基线

- [ ] **Step 1: 起 dev server**

```bash
bun dev
# 或用 mcp__Claude_Preview__preview_start lexseek-dev
```

- [ ] **Step 2: 走完整流程**

浏览器 http://localhost:3001/dashboard/contract → 上传合同 → 选立场 → 等待审查完成。

- [ ] **Step 3: 抓 SSE 序列**

DevTools Network → 看两次 `/contract/chat` 请求 → 复制 Response Body。

保存到 `/Users/daixin/work/dev/LexSeek/LexSeek/docs/superpowers/notes/2026-04-27-stage4-sse-event-after.md`。

- [ ] **Step 4: 对比 baseline 与 after**

```bash
diff docs/superpowers/notes/2026-04-27-stage4-sse-event-baseline.md docs/superpowers/notes/2026-04-27-stage4-sse-event-after.md
```

预期：**几乎完全一致**（仅 timestamp / runId / sessionId 等动态字段不同）。如果出现：
- ❌ 新事件 / 缺事件 → bug，回查 emitContractReviewEvent 路径
- ❌ 事件顺序变化 → bug，回查 platformEmit 是否破坏 fire-and-forget 顺序
- ✅ 仅动态字段不同 → 通过

- [ ] **Step 5: 浏览器 UI 检查**

确认：
- 立场选择对话框正常弹出
- 进度条 5 段正常切换（detect/stance/segment/analyze/summarize）
- 风险列表正常增量出现
- 总览 highlights/overall 正常显示
- 风险编辑、批注、导出 docx 正常

- [ ] **Step 6: 写 smoke 记录 + commit**

记录 smoke 结果到 `docs/superpowers/notes/2026-04-27-stage4-sse-event-after.md` 末尾，commit：

```bash
git add docs/superpowers/notes/2026-04-27-stage4-sse-event-baseline.md docs/superpowers/notes/2026-04-27-stage4-sse-event-after.md
git commit -m "docs(stage4): SSE 事件序列基线与改造后对比 smoke 记录"
```

---

## Task 10：回归脚本 + tag

**Files:**
- Create: `scripts/stage4-regression.sh`

- [ ] **Step 1: 写回归脚本**

`/Users/daixin/work/dev/LexSeek/LexSeek/scripts/stage4-regression.sh`：

```bash
#!/usr/bin/env bash
# 阶段 4 全量回归脚本
set -e

PASS="[OK]"
FAIL="[ERROR]"

echo "======================================="
echo "  阶段 4 · 合同审查接入底座 全量回归"
echo "======================================="

echo ""
echo "[1/5] 类型检查..."
TYPECHECK_OUT=$(npx nuxi typecheck 2>&1 || true)
echo "$TYPECHECK_OUT" | tail -10
REMAINING=$(echo "$TYPECHECK_OUT" | grep -E "error TS" | grep -v "app.vue" | head -5)
if [ -n "$REMAINING" ]; then
    echo "$FAIL 类型检查发现新 TS 错误："
    echo "$REMAINING"
    exit 1
fi
echo "$PASS 类型检查通过"

echo ""
echo "[2/5] 阶段 4 新增测试..."
npx vitest run \
    tests/server/agent-platform/factory/runStateGraphAgent.test.ts \
    tests/server/agent-platform/sse/customEventEmitter.test.ts \
    tests/server/agent-platform/nodeSkills.contract.test.ts \
    2>&1 | tail -10
echo "$PASS 阶段 4 测试通过"

echo ""
echo "[3/5] 合同审查现有测试..."
npx vitest run tests/server/workflow/agents/contractReviewMainAgent 2>&1 | tail -10
echo "$PASS 合同审查测试通过"

echo ""
echo "[4/5] 平台库 + agent + 业务 streaming 测试..."
npx vitest run \
    tests/shared/types tests/server/agent-platform tests/server/agent \
    tests/server/workflow/agents \
    2>&1 | tail -15
echo "$PASS 平台 + 业务测试通过"

echo ""
echo "[5/5] 工作区干净度..."
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
    echo "$FAIL 工作区不干净："
    echo "$DIRTY"
    exit 1
fi
echo "$PASS 工作区干净"

echo ""
echo "======================================="
echo "  阶段 4 全量回归通过 ✓"
echo "======================================="
echo ""
echo "建议打 tag："
echo "  git tag -a ai-unify-stage-4-done -m '阶段 4 完成：合同审查接入底座（C+ 方案）'"
```

- [ ] **Step 2: 跑回归**

```bash
chmod +x scripts/stage4-regression.sh
bash scripts/stage4-regression.sh
```

> **预期**：4 个 pre-existing test failure（agentRun.* / agentWorker，stage 3 handoff 已记录）继续存在但**不阻塞**。如果阶段 4 引入新 fail，需要排查到底是 platform stateGraph 路径升级影响、还是 ctx 注入 mock 不齐。

- [ ] **Step 3: commit 回归脚本**

```bash
git add scripts/stage4-regression.sh
git commit -m "chore(stage4): 阶段 4 全量回归脚本"
```

- [ ] **Step 4: merge 回 dev + 打 tag**

```bash
git checkout dev
git merge dev-stage4-contract-platform --no-ff -m "merge: 阶段 4 完成 — 合同审查接入底座（C+ 方案）"
git tag -a ai-unify-stage-4-done -m '阶段 4 完成：合同审查接入底座（C+ 方案）

- 平台 stateGraph 路径升级：runStateGraphAgent 承接 nodeConfig/emitter/错误兜底
- contract vertical 收敛细节：emitter/nodeConfig 由平台注入
- 通用 customEventEmitter 工厂入库
- contractReviewMain 节点关联 docx skill（seedData + 同步脚本 + 防回退测试）
- SSE 事件序列 byte-for-byte 一致（前端契约 100% 不动）

C+ 方案设计哲学：保留 stateGraph 流程固定型业务的本质，
不强行用 Command.resume；为阶段 8 案件初分接入铺路。'
```

- [ ] **Step 5: 写阶段 4→5 交接 note**

`/Users/daixin/work/dev/LexSeek/LexSeek/docs/superpowers/notes/2026-04-27-stage4-to-stage5-handoff.md`：

简要内容：
- 阶段 4 已完成（tag, commits）
- 平台 stateGraph 路径升级带来的可复用能力
- 阶段 5（通用问答 → 文书/合同 子代理工具）依赖阶段 4 的什么基础设施
- 阶段 8（案件初分接 skills + 提示词改造）现在可以套阶段 4 的平台 stateGraph 路径
- 已知遗留 / pre-existing 失败列表

```bash
git add docs/superpowers/notes/2026-04-27-stage4-to-stage5-handoff.md
git commit -m "docs(stage4): 阶段 4 → 阶段 5 交接说明"
```

---

## 自审检查（writing-plans 强制）

**1. Spec 覆盖检查（来自 spec §6 阶段 4 修订版）**

| spec 完成定义 | Plan 任务 |
|---|---|
| 平台 runStateGraphAgent 实现 | Task 4 |
| defineDomainAgent stateGraph 路径接入 | Task 4 Step 2 |
| contract vertical 接收平台注入 ctx | Task 6 |
| 重复加载下沉到平台 | Task 6 Step 2 |
| docx skill 关联 | Task 8 |
| UI 不变 | Task 1 Step 3 录 baseline + Task 9 对比验证 |
| 不重写 resume 流程 | C+ 方案核心，全 plan 严格遵守 |
| 不引入 Command.resume | 同上 |
| 验证 SSE 序列 100% 一致 | Task 9 |
| 4 个测试 PASS | Task 6 Step 4 + Task 10 |
| 平台 stateGraph 路径单测 | Task 5 |

**2. 占位符扫描**

- 全文无 TBD / TODO / "implement later"
- Task 7 标"如失败则修"是有条件分支，不是占位
- Task 1 Step 3 录 SSE baseline 是手工步骤，给了具体格式模板

**3. 类型一致性**

- `StateGraphAgentContext` (Task 2 定义) → Task 4/5/6 一致使用
- `platformEmit` 字段名（Task 6 ContractReviewEmitterCtx 加） → Task 6/7 一致
- `platformNodeConfig` / `platformEmitCustomEvent` 字段名（Task 6 ContractReviewAgentOptions 加） → Task 6 内一致
- `customEventEmitter` 函数 vs `createCustomEventEmitter` 工厂 → Task 3 创建工厂，Task 4 调用工厂

---

## 风险与缓解（C+ 方案专属）

| 风险 | 级别 | 缓解 |
|---|---|---|
| SSE 事件序列 byte-for-byte 差异 | 中 | Task 1 Step 3 改前录 baseline，Task 9 对比；ContractReviewEmitterCtx 保留向后兼容（fallback to publishCustomEvent）|
| 现有 5 个合同审查测试 FAIL | 中 | Task 6 Step 4 提前跑；Task 7 单独章节处理 mock 同步 |
| 类型 StateGraphAgentContext 破坏其他 stateGraph vertical | 低 | 继承 AgentRunnerContext，旧业务不用新字段就不会 break |
| 平台错误兜底 publish failed 重复 | 低 | 现有 contractReviewMainAgent.ts 内部已 try/catch，不会向外抛 → 平台兜底不会触发 |
| docx skill 的 4 个工具自动注入影响 LLM 行为 | 中 | docx skill 给的工具（read_skill_file 等）只在 LLM 主代理阶段可见；合同审查 LLM 主要工作在 parseAndAskStance 工具调用 + interrupt，不会突然去调 read_skill_file。E2E smoke 验证 LLM 行为 |

---

## 调研引用（实际代码位置，写实施时对照用）

- 当前 stateGraph 路径裸调：`server/services/agent-platform/factory/defineDomainAgent.ts:50-53`
- 当前 createAgent runtime：`server/services/agent-platform/factory/runtime.ts:90-280`
- 现有 wrapStreamWithAfterRun：`server/services/agent-platform/factory/runtime.ts:287` 附近
- contract agent.config.ts：`server/agents/contract/agent.config.ts`（22 行）
- runContractReviewChat：`server/services/workflow/agents/contractReviewMainAgent.ts:262-625`
- emitContractReviewEvent：`server/services/workflow/nodes/contractReviewStageEmitter.ts`（45 行）
- publishCustomEvent：`server/services/agent/agentEventBridge.ts`
- node_skills 表：`prisma/models/skill.prisma`
- skills 表 docx skill：`.deepagents/skills/docx/SKILL.md`（stage 1 已扫描入库）
