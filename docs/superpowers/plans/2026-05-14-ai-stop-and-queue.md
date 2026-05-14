# AI 任务"停止 / 中断 / 队列"治本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让通用问答 / 文书 / 合同 / 案件分析等所有 AI 入口的"停止"与"放弃中断"按钮真正生效，队列残留可控，中断态 UI 不再显示停止按钮。

**Architecture:** 后端新增 vertical 无关的通用任务控制接口 + 修复 cancelRunService 对 INTERRUPTED 状态的语义；前端 useStopActiveRun 切到通用接口、4 处空函数 `@cancel` 接住放弃路径、AiPromptInput 加防守性中断判定、新增 QueuePausedBanner 独立组件由 panel 渲染。

**Tech Stack:** Nuxt 4 + Vue 3 + Nitro / TypeScript + Prisma / Vitest + worker 级 DB 隔离 + LangGraph PostgresSaver / shadcn-vue + lucide-vue-next。

**Spec:** `docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md`

---

## File Structure

**新建文件**：
- `server/api/v1/agent/runs/current/[sessionId].get.ts` — 通用查询当前活跃 run
- `server/api/v1/agent/runs/cancel/[runId].post.ts` — 通用取消 run
- `tests/server/agent/agent-runs-current.api.test.ts` — 新接口端到端测试
- `tests/server/agent/agent-runs-cancel.api.test.ts` — 新接口端到端测试
- `app/components/ai/QueuePausedBanner.vue` — 队列残留提示条组件
- `tests/server/agent/cancelRunService.interrupted.test.ts` — 单独覆盖 INTERRUPTED 分支

**修改文件**：
- `server/services/agent/agentRun.service.ts:127-160` — 新增 INTERRUPTED 分支
- `app/composables/useStopActiveRun.ts:17-38` — 端点切到通用接口
- `app/components/ai/AiPromptInput.vue:151-190, 237-260` — 加 isInterrupted prop + 防守性 v-if
- `app/components/ai/AiChat.vue:204-210, 243-249` — 透传 isInterrupted 到 AiPromptInput
- `app/components/assistant/AssistantChatPanel.vue:184` — 接住 @cancel
- `app/components/caseDetail/CaseDetailXiaosuo.vue:289` — 接住 @cancel
- `app/components/case/AnalysisModuleChat.vue:238` — 接住 @cancel
- `app/pages/dashboard/document/drafts/[id].vue:803` — 接住 @cancel
- `app/components/assistant/contract/ContractReviewPanel.vue:578` — 对齐 handleCancel
- 5 个 panel — 渲染 `<QueuePausedBanner>` 在 AiChat 上方

---

## Task 1：后端 cancelRunService 修复 INTERRUPTED 状态

**Files:**
- Modify: `server/services/agent/agentRun.service.ts:127-160`
- Test: `tests/server/agent/cancelRunService.interrupted.test.ts`（新增）

**为什么先做这个**：spec §6.2 已确认根因。这一步独立可上线，是后续步骤的前置。后续测试会假设 INTERRUPTED 能被正常 cancel，先把这个修了再做其他改动。

- [ ] **Step 1：写失败测试 — 覆盖 INTERRUPTED 状态的 cancel**

创建 `tests/server/agent/cancelRunService.interrupted.test.ts`：

```typescript
/**
 * cancelRunService 对 INTERRUPTED 状态的处理
 *
 * **Feature: ai-stop-and-queue**
 * **Validates: spec §6.2**
 *
 * 治本前：cancelRunService 对 INTERRUPTED 返回幂等成功但不改 status,
 * 与 findActiveRunBySessionIdDAO 将 INTERRUPTED 视为活跃的判定矛盾,
 * 导致后续消息被拦截或卡死。
 *
 * 治本后：INTERRUPTED 走显式分支,改 status=CANCELLED + 调
 * repairOrphanToolUseCheckpoint 释放 orphan tool_use。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import '../case/test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from '../case/test-db-helper'
import { createAssistantSessionDAO } from '../../../server/services/assistant/assistantSession.dao'
import { cancelRunService } from '../../../server/services/agent/agentRun.service'
import { findActiveRunBySessionIdDAO } from '../../../server/services/agent/agentRun.dao'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

// repairOrphanToolUseCheckpoint mock — 只验证被调用 + 入参
const repairMock = vi.fn(async (_sessionId: string, _msg: string) => ({
    fixed: 0,
    parseFailures: 0,
}))
vi.mock('~~/server/services/workflow/repairOrphanToolUse', () => ({
    repairOrphanToolUseCheckpoint: repairMock,
}))

describe('cancelRunService — INTERRUPTED 分支', () => {
    let testIds: CaseTestIds
    const createdRunIds: string[] = []

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        repairMock.mockClear()
        if (createdRunIds.length > 0) {
            await getTestPrisma().agentRuns.deleteMany({
                where: { id: { in: createdRunIds } },
            })
            createdRunIds.length = 0
        }
        if (testIds.sessionIds.length > 0 || testIds.userIds.length > 0) {
            await cleanupTestData(testIds)
            testIds = createEmptyTestIds()
        }
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    it('对 INTERRUPTED 状态的 run，cancel 必须改 status 为 CANCELLED + 写 completedAt', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        // 直接 insert INTERRUPTED 状态的 run（模拟 worker 把 run 标为 INTERRUPTED 等用户回应）
        const run = await getTestPrisma().agentRuns.create({
            data: {
                sessionId: s.sessionId,
                threadId: s.sessionId,
                userId: user.id,
                caseId: null,
                input: { message: '测试' },
                status: AGENT_RUN_STATUS.INTERRUPTED,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        const result = await cancelRunService(run.id)
        expect(result.success).toBe(true)

        const after = await getTestPrisma().agentRuns.findUnique({
            where: { id: run.id },
        })
        expect(after?.status).toBe(AGENT_RUN_STATUS.CANCELLED)
        expect(after?.completedAt).toBeInstanceOf(Date)
    })

    it('对 INTERRUPTED 的 cancel 应调用 repairOrphanToolUseCheckpoint', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await getTestPrisma().agentRuns.create({
            data: {
                sessionId: s.sessionId,
                threadId: s.sessionId,
                userId: user.id,
                caseId: null,
                input: { message: '测试' },
                status: AGENT_RUN_STATUS.INTERRUPTED,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        await cancelRunService(run.id)

        expect(repairMock).toHaveBeenCalledTimes(1)
        expect(repairMock).toHaveBeenCalledWith(
            s.sessionId,
            expect.stringContaining('取消'),
        )
    })

    it('cancel 之后 findActiveRunBySessionIdDAO 应返回 null（活跃锁已释放）', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await getTestPrisma().agentRuns.create({
            data: {
                sessionId: s.sessionId,
                threadId: s.sessionId,
                userId: user.id,
                caseId: null,
                input: { message: '测试' },
                status: AGENT_RUN_STATUS.INTERRUPTED,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        await cancelRunService(run.id)

        const active = await findActiveRunBySessionIdDAO(s.sessionId)
        expect(active).toBeNull()
    })
})
```

- [ ] **Step 2：运行测试验证 fail**

```bash
npx vitest run tests/server/agent/cancelRunService.interrupted.test.ts --reporter=verbose
```

Expected: 3 个测试 FAIL，原因：当前 cancelRunService 对 INTERRUPTED 走"幂等成功不改 status"分支，status 仍为 INTERRUPTED，findActiveRunBySessionIdDAO 仍能查到。

- [ ] **Step 3：修改 cancelRunService 加 INTERRUPTED 分支**

编辑 `server/services/agent/agentRun.service.ts`，在 RUNNING 分支后插入 INTERRUPTED 分支。完整改后：

```typescript
// server/services/agent/agentRun.service.ts:127-...
import { repairOrphanToolUseCheckpoint } from '~~/server/services/workflow/repairOrphanToolUse'

export async function cancelRunService(
  runId: string
): Promise<{ success: boolean; error?: string }> {
  const run = await prisma.agentRuns.findUnique({ where: { id: runId } })
  if (!run) {
    return { success: false, error: 'Run 不存在' }
  }

  if (run.status === AGENT_RUN_STATUS.PENDING) {
    await updateRunStatusDAO(runId, AGENT_RUN_STATUS.CANCELLED, {
      completedAt: new Date(),
    })
    return { success: true }
  }

  if (run.status === AGENT_RUN_STATUS.RUNNING) {
    await updateRunStatusDAO(runId, AGENT_RUN_STATUS.CANCELLED, {
      completedAt: new Date(),
    })
    try {
      const redis = getRedisClient()
      await redis.publish(`run_cancel:${runId}`, runId)
    }
    catch {
      logger.warn(`发布取消信号失败: run=${runId}`)
    }
    return { success: true }
  }

  // INTERRUPTED：用户从暂停态主动取消
  //
  // 治本要点（spec §6.2）：
  // 1. 改 status=CANCELLED 释放 findActiveRunBySessionIdDAO 活跃锁,
  //    否则后续消息会被分支判定为"还有进行中的任务"卡死。
  // 2. 调 repairOrphanToolUseCheckpoint 释放 LangGraph 工具调用半成品,
  //    避免下一轮 invoke 时 Anthropic API 因 orphan tool_use 报 400。
  if (run.status === AGENT_RUN_STATUS.INTERRUPTED) {
    await updateRunStatusDAO(runId, AGENT_RUN_STATUS.CANCELLED, {
      completedAt: new Date(),
    })
    try {
      const repair = await repairOrphanToolUseCheckpoint(
        run.sessionId,
        '用户从暂停态取消',
      )
      if (repair.parseFailures > 0) {
        logger.error(
          `[cancel] session=${run.sessionId} 有 ${repair.parseFailures} 个 scope 的 checkpoint 解析失败`,
        )
      }
    }
    catch (err) {
      logger.warn(`[cancel] repairOrphanToolUseCheckpoint 失败 run=${runId}:`, err)
    }
    return { success: true }
  }

  // 已是 terminal 状态（COMPLETED / FAILED / CANCELLED）：幂等成功
  return { success: true }
}
```

- [ ] **Step 4：运行测试验证 pass**

```bash
npx vitest run tests/server/agent/cancelRunService.interrupted.test.ts --reporter=verbose
```

Expected: 3 个测试全部 PASS。

- [ ] **Step 5：跑现有 agentRun.service 测试确认未破坏其他分支**

```bash
npx vitest run tests/server/agent/agentRun.service.test.ts --reporter=verbose
```

Expected: 所有现有测试仍 PASS（PENDING / RUNNING / 不存在 / 已 terminal 各分支）。

- [ ] **Step 6：Commit**

```bash
git add server/services/agent/agentRun.service.ts tests/server/agent/cancelRunService.interrupted.test.ts
git commit -m "fix(api): cancelRunService 修复 INTERRUPTED 状态导致的卡死

INTERRUPTED 旧版走 \"幂等成功不改 status\" 分支,与活跃 run 判定矛盾,
用户取消暂停态后下次发消息会被拦截。新增 INTERRUPTED 显式分支:
改 status=CANCELLED + 调 repairOrphanToolUseCheckpoint 释放 orphan
tool_use,与 worker catch 块行为对齐。

spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §6.2"
```

---

## Task 2：后端通用查询接口 GET `/api/v1/agent/runs/current/:sessionId`

**Files:**
- Create: `server/api/v1/agent/runs/current/[sessionId].get.ts`
- Create: `tests/server/agent/agent-runs-current.api.test.ts`

- [ ] **Step 1：写失败测试**

创建 `tests/server/agent/agent-runs-current.api.test.ts`：

```typescript
/**
 * 通用 AI 任务查询接口（vertical 无关）
 *
 * **Feature: ai-stop-and-queue**
 * **Validates: spec §6.1**
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import '../case/test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from '../case/test-db-helper'
import { createAssistantSessionDAO } from '../../../server/services/assistant/assistantSession.dao'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

// 与现有 runs-cancel.api.test.ts 对齐：全局 stub 模拟 Nitro 自动导入
const resError = (_event: any, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})
const resSuccess = (_event: any, message: string, data: any) => ({
    code: 0,
    success: true,
    message,
    data,
})
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]

const { default: currentHandler } = await import(
    '../../../server/api/v1/agent/runs/current/[sessionId].get'
)

function makeEvent(opts: { userId?: number; params?: Record<string, string> }) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.params,
    }
}

describe('GET /api/v1/agent/runs/current/:sessionId', () => {
    let testIds: CaseTestIds
    const createdRunIds: string[] = []

    beforeAll(() => {
        testIds = createEmptyTestIds()
    })

    afterEach(async () => {
        if (createdRunIds.length > 0) {
            await getTestPrisma().agentRuns.deleteMany({
                where: { id: { in: createdRunIds } },
            })
            createdRunIds.length = 0
        }
        if (testIds.sessionIds.length > 0 || testIds.userIds.length > 0) {
            await cleanupTestData(testIds)
            testIds = createEmptyTestIds()
        }
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    it('未登录返回 401', async () => {
        const res: any = await currentHandler(
            makeEvent({ params: { sessionId: 'any' } }) as any,
        )
        expect(res.code).toBe(401)
    })

    it('sessionId 缺失返回 400', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const res: any = await currentHandler(makeEvent({ userId: user.id }) as any)
        expect(res.code).toBe(400)
    })

    it('归属正确且有活跃 run 返回 run 对象（assistant scope，caseId=null 也能查）', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await getTestPrisma().agentRuns.create({
            data: {
                sessionId: s.sessionId,
                threadId: s.sessionId,
                userId: user.id,
                caseId: null,
                input: { message: '测试' },
                status: AGENT_RUN_STATUS.RUNNING,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        const res: any = await currentHandler(
            makeEvent({
                userId: user.id,
                params: { sessionId: s.sessionId },
            }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data.run.id).toBe(run.id)
    })

    it('无活跃 run 返回 run=null', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const res: any = await currentHandler(
            makeEvent({
                userId: user.id,
                params: { sessionId: s.sessionId },
            }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data.run).toBeNull()
    })

    it('跨用户访问返回 403（归属校验）', async () => {
        const owner = await createTestUser()
        const intruder = await createTestUser()
        testIds.userIds.push(owner.id, intruder.id)

        const s = await createAssistantSessionDAO({ userId: owner.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await getTestPrisma().agentRuns.create({
            data: {
                sessionId: s.sessionId,
                threadId: s.sessionId,
                userId: owner.id,
                caseId: null,
                input: { message: '测试' },
                status: AGENT_RUN_STATUS.PENDING,
            },
            select: { id: true },
        })
        createdRunIds.push(run.id)

        const res: any = await currentHandler(
            makeEvent({
                userId: intruder.id,
                params: { sessionId: s.sessionId },
            }) as any,
        )
        expect(res.code).toBe(403)
    })
})
```

- [ ] **Step 2：运行测试验证 fail**

```bash
npx vitest run tests/server/agent/agent-runs-current.api.test.ts --reporter=verbose
```

Expected: 全部 FAIL（文件不存在，import 失败）。

- [ ] **Step 3：创建 handler 实现**

创建 `server/api/v1/agent/runs/current/[sessionId].get.ts`：

```typescript
/**
 * 通用查询当前活跃 run（vertical 无关）
 *
 * GET /api/v1/agent/runs/current/:sessionId
 *
 * 归属校验：只看 run.userId === auth.user.id，不读 cases 表。
 * 与 server/api/v1/cases/analysis/runs/current/[sessionId].get.ts 的区别：
 * 后者要求 session 必须挂在案件下（assistant / document / 独立 contract 都 404），
 * 本接口对所有 vertical 通用。
 *
 * spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §6.1
 */

import { prisma } from '~~/server/utils/db'
import { getActiveRunService } from '~~/server/services/agent/agentRun.service'

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) {
    return resError(event, 401, '请先登录')
  }

  const sessionId = getRouterParam(event, 'sessionId')
  if (!sessionId) {
    return resError(event, 400, 'sessionId 不能为空')
  }

  // 归属校验：通过 caseSessions.userId 验证（assistant / document / contract / case 都有 userId）
  const session = await prisma.caseSessions.findUnique({
    where: { sessionId },
    select: { userId: true },
  })
  if (!session) {
    return resError(event, 404, '会话不存在')
  }
  if (session.userId !== user.id) {
    return resError(event, 403, '无权访问')
  }

  const run = await getActiveRunService(sessionId)
  return resSuccess(event, '获取成功', { run })
})
```

- [ ] **Step 4：运行测试验证 pass**

```bash
npx vitest run tests/server/agent/agent-runs-current.api.test.ts --reporter=verbose
```

Expected: 5 个测试全部 PASS。

- [ ] **Step 5：Commit**

```bash
git add server/api/v1/agent/runs/current/[sessionId].get.ts tests/server/agent/agent-runs-current.api.test.ts
git commit -m "feat(api): 新增通用查询活跃 run 接口

GET /api/v1/agent/runs/current/:sessionId — vertical 无关的查询接口,
归属只看 caseSessions.userId,不要求 session 挂在案件下,assistant /
document / contract 等独立会话都能用。

spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §6.1"
```

---

## Task 3：后端通用取消接口 POST `/api/v1/agent/runs/cancel/:runId`

**Files:**
- Create: `server/api/v1/agent/runs/cancel/[runId].post.ts`
- Create: `tests/server/agent/agent-runs-cancel.api.test.ts`

- [ ] **Step 1：写失败测试**

创建 `tests/server/agent/agent-runs-cancel.api.test.ts`：

```typescript
/**
 * 通用 AI 任务取消接口（vertical 无关）
 *
 * **Feature: ai-stop-and-queue**
 * **Validates: spec §6.1**
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import '../case/test-setup'
import {
    createTestUser,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from '../case/test-db-helper'
import { createAssistantSessionDAO } from '../../../server/services/assistant/assistantSession.dao'

const resError = (_event: any, code: number, message: string) => ({
    code, success: false, message, data: null,
})
const resSuccess = (_event: any, message: string, data: any) => ({
    code: 0, success: true, message, data,
})
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]

const cancelRunServiceMock = vi.fn(async (_runId: string) => ({ success: true }))
vi.mock('~~/server/services/agent/agentRun.service', () => ({
    cancelRunService: cancelRunServiceMock,
}))

const { default: cancelHandler } = await import(
    '../../../server/api/v1/agent/runs/cancel/[runId].post'
)

function makeEvent(opts: { userId?: number; params?: Record<string, string> }) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.params,
    }
}

async function insertTestRun(input: { userId: number; sessionId: string; status?: string }) {
    return getTestPrisma().agentRuns.create({
        data: {
            sessionId: input.sessionId,
            threadId: input.sessionId,
            userId: input.userId,
            caseId: null,
            input: { message: '测试' },
            status: input.status ?? 'pending',
        },
        select: { id: true },
    })
}

describe('POST /api/v1/agent/runs/cancel/:runId', () => {
    let testIds: CaseTestIds
    const createdRunIds: string[] = []

    beforeAll(() => { testIds = createEmptyTestIds() })

    afterEach(async () => {
        cancelRunServiceMock.mockClear()
        if (createdRunIds.length > 0) {
            await getTestPrisma().agentRuns.deleteMany({
                where: { id: { in: createdRunIds } },
            })
            createdRunIds.length = 0
        }
        if (testIds.sessionIds.length > 0 || testIds.userIds.length > 0) {
            await cleanupTestData(testIds)
            testIds = createEmptyTestIds()
        }
    })

    afterAll(async () => { await disconnectTestDb() })

    it('未登录返回 401', async () => {
        const res: any = await cancelHandler(makeEvent({ params: { runId: 'any' } }) as any)
        expect(res.code).toBe(401)
        expect(cancelRunServiceMock).not.toHaveBeenCalled()
    })

    it('runId 缺失返回 400', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const res: any = await cancelHandler(makeEvent({ userId: user.id }) as any)
        expect(res.code).toBe(400)
    })

    it('run 不存在返回 404', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const res: any = await cancelHandler(
            makeEvent({
                userId: user.id,
                params: { runId: '00000000-0000-0000-0000-000000000000' },
            }) as any,
        )
        expect(res.code).toBe(404)
    })

    it('跨用户访问返回 403', async () => {
        const owner = await createTestUser()
        const intruder = await createTestUser()
        testIds.userIds.push(owner.id, intruder.id)

        const s = await createAssistantSessionDAO({ userId: owner.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await insertTestRun({ userId: owner.id, sessionId: s.sessionId })
        createdRunIds.push(run.id)

        const res: any = await cancelHandler(
            makeEvent({ userId: intruder.id, params: { runId: run.id } }) as any,
        )
        expect(res.code).toBe(403)
        expect(cancelRunServiceMock).not.toHaveBeenCalled()
    })

    it('归属正确：vertical 无关地取消（assistant scope 也能用，不再 scope 校验）', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await insertTestRun({ userId: user.id, sessionId: s.sessionId })
        createdRunIds.push(run.id)

        const res: any = await cancelHandler(
            makeEvent({ userId: user.id, params: { runId: run.id } }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.data).toEqual({ cancelled: true })
        expect(cancelRunServiceMock).toHaveBeenCalledTimes(1)
        expect(cancelRunServiceMock).toHaveBeenCalledWith(run.id)
    })

    it('cancelRunService 返回失败时返回 400', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const s = await createAssistantSessionDAO({ userId: user.id })
        testIds.sessionIds.push(s.sessionId)

        const run = await insertTestRun({ userId: user.id, sessionId: s.sessionId })
        createdRunIds.push(run.id)

        cancelRunServiceMock.mockResolvedValueOnce({ success: false, error: '模拟失败' })

        const res: any = await cancelHandler(
            makeEvent({ userId: user.id, params: { runId: run.id } }) as any,
        )
        expect(res.code).toBe(400)
        expect(res.message).toContain('模拟失败')
    })
})
```

- [ ] **Step 2：运行测试验证 fail**

```bash
npx vitest run tests/server/agent/agent-runs-cancel.api.test.ts --reporter=verbose
```

Expected: 全部 FAIL（文件不存在）。

- [ ] **Step 3：创建 handler 实现**

创建 `server/api/v1/agent/runs/cancel/[runId].post.ts`：

```typescript
/**
 * 通用取消 AI 任务（vertical 无关）
 *
 * POST /api/v1/agent/runs/cancel/:runId
 *
 * 归属校验：只看 run.userId === auth.user.id,**不做 scope 校验**。
 * 与 server/api/v1/assistant/runs/cancel/[runId].post.ts 的区别:
 * 后者额外要求 session.scope='assistant',本接口对任意 vertical 通用。
 *
 * spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §6.1
 */

import { prisma } from '~~/server/utils/db'
import { cancelRunService } from '~~/server/services/agent/agentRun.service'

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) {
    return resError(event, 401, '请先登录')
  }

  const runId = getRouterParam(event, 'runId')
  if (!runId) {
    return resError(event, 400, 'runId 不能为空')
  }

  const run = await prisma.agentRuns.findUnique({ where: { id: runId } })
  if (!run) {
    return resError(event, 404, 'Run 不存在')
  }
  if (run.userId !== user.id) {
    return resError(event, 403, '无权操作')
  }

  const result = await cancelRunService(runId)
  if (!result.success) {
    return resError(event, 400, result.error ?? '取消失败')
  }

  return resSuccess(event, '取消成功', { cancelled: true })
})
```

- [ ] **Step 4：运行测试验证 pass**

```bash
npx vitest run tests/server/agent/agent-runs-cancel.api.test.ts --reporter=verbose
```

Expected: 6 个测试全部 PASS。

- [ ] **Step 5：Commit**

```bash
git add server/api/v1/agent/runs/cancel/[runId].post.ts tests/server/agent/agent-runs-cancel.api.test.ts
git commit -m "feat(api): 新增通用取消 AI 任务接口

POST /api/v1/agent/runs/cancel/:runId — vertical 无关,归属只看
run.userId。不做 scope 校验,所有 vertical 共用。

spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §6.1"
```

---

## Task 4：RBAC 权限登记（手工步骤 + 文档化）

**Files:**
- Modify: 无代码改动（通过管理后台 UI 完成）
- Doc: 在 spec §10 风险 1 下补充实施记录

按 `.claude/rules/api.md` 的"管理端 API 注册流程"，新接口（虽然是用户端）也走管理后台扫描，不写 seedData.sql。

- [ ] **Step 1：启动 dev server，确认 Nitro 已扫描到新文件**

```bash
bun dev
```

打开 http://localhost:3000，登录超级管理员账号。

- [ ] **Step 2：执行 API 权限扫描**

进管理后台 → 「权限管理」→「API 权限」页 → 点 **扫描** 按钮（页面操作；接口实现：`POST /api/v1/admin/api-permissions/scan`）。

扫描完成后，搜索路径 `agent/runs`，确认两条新记录已入库：

```
GET  /api/v1/agent/runs/current/:sessionId
POST /api/v1/agent/runs/cancel/:runId
```

注意：扫描接口会自动把 `[sessionId]` → `:sessionId`、`[runId]` → `:runId`。

- [ ] **Step 3：给"普通用户"角色授权（让任意登录用户可调用）**

进「角色」页 → 找到面向所有登录用户的基础角色（项目里的"用户"或等价角色，具体角色名按 seedData 实际存在的名字选）→「权限分配」→ 勾选上述两条 API 权限 → 保存。

> 如果项目里采用"所有登录用户共享一套 base 角色"的模式，给那个 base 角色加即可；如果采用"每个用户独立角色"，则需要扫描后批量授权所有用户角色。**具体在执行时查现场角色配置**。

- [ ] **Step 4：手工验证权限生效**

用一个普通用户账号登录，浏览器 console 执行：

```javascript
fetch('/api/v1/agent/runs/current/non-existent-session', {
  headers: { Accept: 'application/json' },
  credentials: 'include',
}).then(r => r.json()).then(console.log)
```

Expected：返回 `{ code: 404, message: '会话不存在', success: false }`（404 表示路由匹配到了 + 鉴权通过，只是 session 不存在，符合预期）。

如果返回 `{ code: 403, message: '无权限访问该接口' }`，说明 RBAC 没授权对，回 Step 3 检查。

- [ ] **Step 5：把实施记录追加到 spec**

在 spec §10 风险 1 末尾追加一行：

```
**已实施（2026-05-14）**：
- 扫描后 api_permissions 表新增两条匹配模式 `/api/v1/agent/runs/current/:sessionId` 和 `/api/v1/agent/runs/cancel/:runId`
- 已给 <实际操作的角色名> 角色授权
- 普通用户 fetch 验证返回 404（路由通），非 403（权限通）
```

- [ ] **Step 6：Commit spec 补丁**

```bash
git add docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md
git commit -m "docs(spec): 补 AI 任务通用接口 RBAC 注册实施记录"
```

---

## Task 5：前端 `useStopActiveRun` 切到通用接口

**Files:**
- Modify: `app/composables/useStopActiveRun.ts:17-38`
- Test: 该 composable 无现有单测；本次也不补单测（逻辑简单，由 Task 9 的 E2E 回归覆盖）

- [ ] **Step 1：手工验证当前 bug**

启动 dev：`bun dev`。打开通用问答页面（独立会话，无 caseId），发起一个对话让 AI 开始打字。**打开浏览器 DevTools → Network 面板** → 点"停止"按钮 → 观察请求：

Expected（治本前的 bug 现场）：
- `GET /api/v1/cases/analysis/runs/current/<sessionId>` → 404 "案件不存在"
- 没有后续的 `POST cancel` 请求被发出
- 后端 run 状态不变

记录这个现象作为对比基线。

- [ ] **Step 2：修改 useStopActiveRun 切端点**

编辑 `app/composables/useStopActiveRun.ts`，把 line 17-38 整体替换为：

```typescript
import { useApiFetch } from '~/composables/useApiFetch'
/**
 * 双重取消公共函数：SSE stop + 查询 runId + 调用 cancel API。
 *
 * 走通用 vertical 无关接口 /api/v1/agent/runs/*,归属只看 user.id,
 * 不再要求 session 挂在案件下。通用问答 / 独立合同 / 独立文书等
 * caseId=null 的会话都能正确停止。
 *
 * 返回 `{ ok, error? }`：
 * - ok=true：没有活跃 run 或 cancel API 成功（幂等：terminal run 也算成功）
 * - ok=false：任一 API 失败；error 含原因
 *
 * spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §7.1
 */
export async function stopActiveRun(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const runData = await useApiFetch<{ run: { id: string } | null }>(
            `/api/v1/agent/runs/current/${sessionId}`,
            { showError: false },
        )
        // 没有活跃 run 视为成功（无需取消）
        if (!runData?.run?.id) {
            return { ok: true }
        }
        await useApiFetch(
            `/api/v1/agent/runs/cancel/${runData.run.id}`,
            { method: 'POST', showError: false },
        )
        return { ok: true }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '取消失败'
        console.error('[stopActiveRun] 取消失败:', error)
        return { ok: false, error: msg }
    }
}
```

- [ ] **Step 3：手工验证切端点后行为正确**

`bun dev` 已经启动。通用问答页面，发起对话，AI 开始打字时点停止：

Expected：
- `GET /api/v1/agent/runs/current/<sessionId>` → 200，返回 `{ data: { run: { id: ... } } }`
- `POST /api/v1/agent/runs/cancel/<runId>` → 200
- 后端 run.status 变为 CANCELLED
- 输入框立刻可用，发新消息能正常收到回答

- [ ] **Step 4：类型检查**

```bash
bun run typecheck
```

Expected：无新增类型错误。

- [ ] **Step 5：Commit**

```bash
git add app/composables/useStopActiveRun.ts
git commit -m "fix(api): useStopActiveRun 切到通用 agent runs 接口

旧端点 /api/v1/cases/analysis/runs/* 对无 caseId 的会话直接 404,
通用问答 / 独立文书 / 独立合同的停止按钮根本没传到后端。改为新
通用接口 /api/v1/agent/runs/*,归属只看 user.id。

spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §7.1"
```

---

## Task 6：4 处空函数 `@cancel` 改为 `handleCancel`

**Files:**
- Modify: `app/components/assistant/AssistantChatPanel.vue:184`
- Modify: `app/components/caseDetail/CaseDetailXiaosuo.vue:289`
- Modify: `app/components/case/AnalysisModuleChat.vue:238`
- Modify: `app/pages/dashboard/document/drafts/[id].vue:803`
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue:578`（对齐 handleCancel 形式）

这 5 处改动模式完全相同：在 `<script setup>` 加一个 `handleCancel` 函数，模板 `@cancel="handleCancel"`。

- [ ] **Step 1：改 AssistantChatPanel.vue**

读 line 138-150 确认 `resolveInterrupt` 已从 `usePanelMessageStreamContext` 取到，然后在 `<script setup>` 末尾（onMounted 前）插入：

```typescript
async function handleCancel() {
  try {
    await resolveInterrupt(null)
  } catch (err) {
    console.error('[assistant-chat] interrupt cancel failed', err)
  }
}
```

把模板 line 184 的 `@cancel="() => { }"` 改为 `@cancel="handleCancel"`。

- [ ] **Step 2：改 CaseDetailXiaosuo.vue**

同样模式，加 `handleCancel`：

```typescript
async function handleCancel() {
  try {
    await resolveInterrupt(null)
  } catch (err) {
    console.error('[xiaosuo] interrupt cancel failed', err)
  }
}
```

模板 line 289 `@cancel="() => {}"` 改为 `@cancel="handleCancel"`。

- [ ] **Step 3：改 AnalysisModuleChat.vue**

`<script setup>` 里 line 151 已有 `resumeInterrupt`，但需要从该 panel 自己暴露 `resolveInterrupt` —— 先读 `usePanelMessageStreamContext` 是否在该文件已经使用。

执行：

```bash
grep -n "usePanelMessageStreamContext\|resolveInterrupt" app/components/case/AnalysisModuleChat.vue
```

如果**有** `resolveInterrupt`：直接加 handleCancel 同上模式。
如果**没有** `resolveInterrupt`（仅有 resumeInterrupt）：照 AssistantChatPanel 的方式接入 `usePanelMessageStreamContext`（参考 line 138-141 of AssistantChatPanel.vue），然后再加 handleCancel。

模板 line 238 `@cancel="() => {}"` 改为 `@cancel="handleCancel"`。

- [ ] **Step 4：改 document/drafts/[id].vue**

读该文件 line 130-150 看 resolveInterrupt 来源：

```bash
grep -n "usePanelMessageStreamContext\|resolveInterrupt\|handleResumeInterrupt" app/pages/dashboard/document/drafts/\[id\].vue
```

按 AnalysisModuleChat 同样的两种情况处理：有 resolveInterrupt 就直接加 handleCancel；没有就先接入 usePanelMessageStreamContext。

模板 line 803 `@cancel="() => { }"` 改为 `@cancel="handleCancel"`。

- [ ] **Step 5：改 ContractReviewPanel.vue 对齐**

读 line 575-580 的现状：

```vue
<InterruptDispatcher
    :interrupt="interruptData as any"
    @submit="resolveInterrupt"
    @cancel="() => resolveInterrupt(null)"
/>
```

`() => resolveInterrupt(null)` 是裸 Promise（resolveInterrupt 返回 Promise<void>），未 await 会丢异常。改为 handleCancel 形式：

```typescript
// script setup 末尾加（与上面 4 处对齐）
async function handleCancel() {
  try {
    await resolveInterrupt(null)
  } catch (err) {
    console.error('[contract-review] interrupt cancel failed', err)
  }
}
```

模板 line 578 `@cancel="() => resolveInterrupt(null)"` 改为 `@cancel="handleCancel"`。

- [ ] **Step 6：类型检查**

```bash
bun run typecheck
```

Expected：无新增类型错误。

- [ ] **Step 7：手工验证 — 通用问答放弃中断**

`bun dev`。通用问答页发"帮我起草一份租赁合同"让 AI 弹出模板选择卡片 → 关闭/放弃这张卡 → 期望：

- 卡片消失
- 后端 run.status 从 INTERRUPTED 变为 CANCELLED
- 输入框立即可用
- 发新消息能正常收到回答（这一步依赖 Task 1 修好的 cancelRunService INTERRUPTED 分支）

- [ ] **Step 8：Commit**

```bash
git add app/components/assistant/AssistantChatPanel.vue \
        app/components/caseDetail/CaseDetailXiaosuo.vue \
        app/components/case/AnalysisModuleChat.vue \
        app/pages/dashboard/document/drafts/[id].vue \
        app/components/assistant/contract/ContractReviewPanel.vue
git commit -m "fix(ui): 5 个 panel 接住中断卡片的 @cancel 事件

中断卡片 emit('cancel') 后,5 处面板里 4 处是空函数,合同审查那处是
裸 Promise() => resolveInterrupt(null) 会丢异常。统一改为 setup
顶层声明 async handleCancel(),内部 try/catch + await resolveInterrupt(null),
模板 @cancel=\"handleCancel\"。

spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §7.2"
```

---

## Task 7：AiPromptInput 加 `isInterrupted` prop + 中断态禁用

**Files:**
- Modify: `app/components/ai/AiPromptInput.vue`
- Modify: `app/components/ai/AiChat.vue:204-210, 243-249`

- [ ] **Step 1：AiPromptInput 加 prop 与渲染逻辑**

编辑 `app/components/ai/AiPromptInput.vue`，先看 line 237-260 的 props 定义找到合适插入位置：

在 props interface 中加：

```typescript
/** 中断态（AI 在等用户回应中断卡片）。true 时:
 *  - 输入框 disabled
 *  - 不显示停止按钮 + 加入队列按钮
 *  - placeholder 切换为 "请先回应上方的请求"
 * spec §5.3 / §7.3
 */
isInterrupted?: boolean
```

withDefaults 的默认值列表加：`isInterrupted: false,`

读 line 64-70 找到 textarea，把 `disabled` 与 `placeholder` 改为依赖 isInterrupted：

```vue
<PromptInputTextarea
  :placeholder="props.isInterrupted ? '请先回应上方的请求' : props.placeholder"
  :disabled="props.disabled || props.isInterrupted"
  ...
/>
```

(具体属性名按现有 PromptInputTextarea 接口适配；可能 textarea 直接是 HTML `<textarea>`，则属性是 `disabled` `placeholder`。)

读 line 149-190 的"loading 态：独立的停止 + 加入队列双按钮"分支，把外层 `v-else` 改为：

```vue
<!-- loading && !isInterrupted：停止 + 加入队列双按钮 -->
<div v-else-if="!props.isInterrupted" class="flex items-center gap-1.5 @max-[500px]:gap-1">
  <!-- 现有停止按钮 ... -->
  <!-- 现有加入队列按钮 ... -->
</div>
<!-- loading && isInterrupted：不显示任何按钮（中断态由卡片自带操作） -->
```

> 注意：`v-if (!loading)` 显示发送按钮的分支保持不变。

- [ ] **Step 2：AiChat 透传 isInterrupted**

读 `app/components/ai/AiChat.vue` line 200-250 找到两处 `<AiPromptInput>` 调用，给两处都加 prop：

```vue
<AiPromptInput
  ref="aiChatRef"
  :messages="messages"
  :loading="isLoading"
  :is-interrupted="isInterrupted"
  ...
/>
```

(AiChat 本身 line 29 已有 `isInterrupted` prop。)

- [ ] **Step 3：类型检查**

```bash
bun run typecheck
```

Expected：无新增类型错误。

- [ ] **Step 4：手工验证 — 中断态 UI 表现**

`bun dev`。通用问答发"帮我起草一份租赁合同"让 AI 弹出模板选择卡片：

Expected：
- 主输入框灰掉、disabled
- placeholder 显示"请先回应上方的请求"
- 底部**没有**停止按钮、**没有**加入队列按钮
- 中断卡片自身的 [确认]/[放弃] 按钮可点

- [ ] **Step 5：Commit**

```bash
git add app/components/ai/AiPromptInput.vue app/components/ai/AiChat.vue
git commit -m "fix(ui): 中断态隐藏停止按钮 + 禁用输入框

AiPromptInput 新增 isInterrupted prop,中断态下:
- 输入框 disabled,placeholder 切换为\"请先回应上方的请求\"
- 不显示停止按钮 + 加入队列按钮
判断依据用 interruptData!=null,不依赖 isLoading(中断态 isLoading
仍为 true,无法区分输出态与中断态)。AiChat 透传 isInterrupted 到
两处 AiPromptInput 实例。

spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §5.3 §7.3"
```

---

## Task 8：新增 `QueuePausedBanner.vue` + 5 个 panel 渲染

**Files:**
- Create: `app/components/ai/QueuePausedBanner.vue`
- Modify: 5 个 panel 文件（在 AiChat 上方插入）

- [ ] **Step 1：创建 QueuePausedBanner.vue**

```bash
ls app/components/ui/alert/
```

确认 `Alert.vue` / `AlertDescription.vue` / `AlertTitle.vue` 存在（shadcn-vue 默认已加）。

创建 `app/components/ai/QueuePausedBanner.vue`：

```vue
<script setup lang="ts">
/**
 * 队列残留提示条
 *
 * 在 AI 任务停止 / 放弃中断后,如果输入队列里还有未发送的消息,
 * 在 AiChat 上方显示本条:左侧提示文案 + 右侧 [清空] [继续] 双按钮。
 *
 * 显示条件由调用方控制（v-if="queueLength > 0 && isQueuePaused"）。
 *
 * spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §5.4 §7.5
 */
import { AlertCircle } from 'lucide-vue-next'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'

defineProps<{
  queueLength: number
}>()

const emit = defineEmits<{
  resume: []
  clear: []
}>()
</script>

<template>
  <Alert class="rounded-none border-x-0 border-t-0">
    <AlertCircle class="size-4" />
    <AlertDescription class="flex items-center justify-between gap-3">
      <span>队列中还有 {{ queueLength }} 条消息未发送</span>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" @click="emit('clear')">
          清空队列
        </Button>
        <Button variant="default" size="sm" @click="emit('resume')">
          继续发送
        </Button>
      </div>
    </AlertDescription>
  </Alert>
</template>
```

- [ ] **Step 2：AssistantChatPanel 引入**

读 line 30-50 找到 `useLegalAssistantAgent` 解构。在解构里加 4 个字段（确认这些字段已存在于 `useDomainAgentSession` 的返回，由 line 794-799）：

```typescript
const {
  messages,
  isLoading,
  interruptData,
  runStatus,
  runError,
  sendMessage,
  resumeInterrupt,
  stopGeneration,
  init,
  // 队列残留 ui 用
  currentQueueLen,
  isQueuePaused,
  resumeQueue,
  clearQueue,
} = useLegalAssistantAgent(sessionIdRef)
```

读 line 155-170 模板，在 `<AiChat ...>` 上方插入：

```vue
<QueuePausedBanner
  v-if="currentQueueLen > 0 && isQueuePaused"
  :queue-length="currentQueueLen"
  @resume="resumeQueue"
  @clear="clearQueue"
/>
```

并在 `<script setup>` 顶部 import：

```typescript
import QueuePausedBanner from '~/components/ai/QueuePausedBanner.vue'
```

- [ ] **Step 3：CaseDetailXiaosuo 同样改动**

参考 Step 2 模式，注入 4 个字段 + 模板上方插入 banner。

- [ ] **Step 4：AnalysisModuleChat 同样改动**

参考 Step 2 模式。注意该面板可能不是用 `useDomainAgentSession` 直接，而是从 props 拿 chatInstance；具体看 line 30-60。如果 chatInstance 没暴露这 4 个字段，需要先在 useCaseModuleAgent 包装上把它们透传出来。

- [ ] **Step 5：document/drafts/[id].vue 同样改动**

参考 Step 2 模式。

- [ ] **Step 6：ContractReviewPanel.vue 同样改动**

参考 Step 2 模式。

- [ ] **Step 7：类型检查**

```bash
bun run typecheck
```

Expected：无新增类型错误。

- [ ] **Step 8：手工验证 — 通用问答停止 + 队列残留**

`bun dev`。通用问答：
1. 发"什么是劳动合同？"等 AI 开始打字
2. 在 AI 打字过程中再输入"举几个例子"+ 点"加入队列"，重复一次（队列 +2）
3. 点停止按钮

Expected：
- AI 真停下，输入框立即可用
- 输入框上方出现 banner："队列中还有 2 条消息未发送" + [清空队列] [继续发送]
- 点 [继续发送] → banner 消失，AI 依次回答队列中的 2 条问题
- (重新构造一次场景) 点 [清空队列] → banner 消失，队列清空

- [ ] **Step 9：Commit**

```bash
git add app/components/ai/QueuePausedBanner.vue \
        app/components/assistant/AssistantChatPanel.vue \
        app/components/caseDetail/CaseDetailXiaosuo.vue \
        app/components/case/AnalysisModuleChat.vue \
        app/pages/dashboard/document/drafts/[id].vue \
        app/components/assistant/contract/ContractReviewPanel.vue
git commit -m "feat(ui): 新增 QueuePausedBanner 队列残留提示条

5 个 AI 入口在停止 / 放弃中断后显示提示条:左侧 AlertCircle +
\"队列中还有 N 条消息未发送\",右侧 [清空] [继续] 双按钮。
点 [继续] 调 resumeQueue() 立即派发队首;点 [清空] 调 clearQueue()
直接清空。

spec: docs/superpowers/specs/2026-05-14-ai-stop-and-queue-design.md §5.4 §7.5"
```

---

## Task 9：回归验证

**Files:** 仅运行命令，无代码改动

- [ ] **Step 1：跑后端全量单测**

```bash
bun run test:server
```

Expected：所有测试 PASS（含本次新增 3 个测试文件）。如有 FAIL，检查是不是本次治本破坏了现有 case 域端点 / 其他测试预期。

- [ ] **Step 2：跑前端单测**

```bash
bun run test:client
```

Expected：所有测试 PASS（本次未新增前端单测，仅验证未破坏现有）。

- [ ] **Step 3：跑全量 typecheck**

```bash
bun run typecheck
```

Expected：无新增类型错误。

- [ ] **Step 4：手工跑 spec §9 的核心验收用例（4 vertical × 4 场景）**

按 spec §9 清单逐项跑：

| Vertical | 场景 | 期望结果 |
|---|---|---|
| 通用问答 | 1 打字时停止 | 输入框立刻可用，发新消息正常回答 |
| 通用问答 | 2 中断卡放弃 | 中断态无停止按钮，输入框禁用；放弃后立刻可用 |
| 通用问答 | 3 入队+停止+继续 | 队列残留 banner 显示，[继续] 后依次派发 |
| 通用问答 | 4 入队+停止+清空 | banner 显示，[清空] 后队列空 |
| 独立文书 | 1-4 | 同上 |
| 独立合同 | 1-4 | 同上 |
| 案件分析 | 1-4 | 同上 |

跑通后填一个简短表格记入工作日志。

- [ ] **Step 5：跨标签同步用例**

打开 2 个浏览器标签都进同一个通用问答会话：
1. 标签 A 发"什么是劳动合同"等 AI 打字
2. 标签 A 入队 1 条"举几个例子"
3. 标签 A 点停止
4. 切到标签 B：看 banner 是否同步显示"队列中还有 1 条"
5. 标签 B 点 [继续发送]：标签 A 应同步看到队列发出

Expected：B 标签 banner 与 A 同步出现/消失（验证 useQueueDispatcher.broadcastState + useCrossTabListener('chat-queue:sync') 现有基建按预期）。

- [ ] **Step 6：离开页面继续运行用例（产品原则）**

1. 通用问答发一个会让 AI 思考较长（≥10 秒）的复杂问题
2. AI 开始打字后立即用左侧菜单切换到其他业务页（如"文书"或"合同"）
3. 等 15-20 秒
4. 回到刚才的通用问答会话

Expected：看到 AI 已经完整回答完，未被打断（验证路由切换不触发 stop）。

- [ ] **Step 7：连点两次停止幂等**

通用问答 AI 打字中，连续快速点停止按钮 2 次。

Expected：第二次点击不报错，UI 表现一致。

- [ ] **Step 8：删除会话用例**

通用问答会话 AI 正在打字时，从侧栏点删除该会话。

Expected：会话立即从侧栏消失，后端 agentRuns 表对应记录 status=CANCELLED（不是 RUNNING 残留）。可用 psql 验证：

```bash
docker exec -i $(docker ps -qf "name=postgres") psql -U daixin -d ls_new -c "SELECT id, status FROM agent_runs WHERE session_id = '<刚删的 sessionId>';"
```

- [ ] **Step 9：Commit 回归记录**

如果上面 §9 验收清单跑通且无破坏，把验收结果作为 commit message 一部分。如果有破坏需要回退或修补：把发现的问题打回前面对应 Task。

```bash
git log --oneline -10
# 应该看到 7-8 个本次治本的 commits 已经在分支上
```

回归完成后通知 reviewer / 用户。

---

## Self-Review Checklist（写完计划自审）

- [x] **Spec 覆盖**：spec §1-§11 的每个条目都映射到某个 Task：
  - §1 (B1) → Task 5
  - §1 (B2) → Task 1
  - §1 (B3) → Task 6
  - §1 (B4) → Task 7
  - §5 UI 规范 → Task 7、Task 8
  - §6 后端能力 → Task 1、Task 2、Task 3
  - §7 前端清单 → Task 5、Task 6、Task 7、Task 8
  - §9 验收清单 → Task 9
  - §10 风险 RBAC → Task 4
  - §11 实施顺序 → Task 1-9 按编号

- [x] **Placeholder 扫描**：无 TBD / TODO / "implement later"。每个 step 有实际代码或命令。

- [x] **Type 一致性**：
  - `handleCancel` 在 Task 6 5 个文件统一命名（async function 形式）
  - `isInterrupted` prop 在 Task 7 AiPromptInput + AiChat + 各 panel 命名一致
  - `currentQueueLen / isQueuePaused / resumeQueue / clearQueue` 在 Task 8 5 个 panel 名字与 useDomainAgentSession.ts:794-799 一致
  - `QueuePausedBanner` 组件接口（props: queueLength / emits: resume, clear）在 Task 8 各 panel 使用处一致

- [x] **依赖顺序**：Task 1 必先于 Task 6（INTERRUPTED 状态被正确取消是放弃中断生效的前置）；Task 2-3 必先于 Task 5；Task 4 必先于 Task 9 手工验证（否则用户登录后调 API 会 403）。

无问题，可执行。
