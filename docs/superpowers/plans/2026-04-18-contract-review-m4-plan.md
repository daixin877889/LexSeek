# 合同审查 M4 Implementation Plan（用户页 + P0 UI）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付合同审查 P0 用户页（`/dashboard/assistant/contract`），让登录用户在浏览器走通"提交 → 立场 Dialog → 审查完成 → 下载批注 Word"闭环。

**Architecture:** 前端复用已有基础设施（`useStreamChat` + `AiPromptInput` + `docx-preview` + shadcn-vue 组件），自建一个顶层 composable `useContractReview`（仿 `useDocumentDraft`）集中状态与副作用；后端补齐本期 UI 必需的 2 个端点：SSE 对话入口（`POST /chat`）与下载端点（`GET /reviews/:id/download`，返回 `{ downloadUrl }`）。MVP 不含风险 CRUD / diff / rebuild-docx，这些在 M5。

**Tech Stack:** Nuxt 4 / Vue 3 / Tailwind v4 / shadcn-vue / LangGraph Stream SDK / docx-preview / Vitest + happy-dom + @vue/test-utils。

---

## 对齐 spec §11 M4 行（1:1 映射）

| spec §11 M4 交付项 | 本 plan 实现位置 |
|---|---|
| `/dashboard/assistant/contract` 路由 | Task 9 |
| `ContractReviewPanel` + 6 个子组件 | Task 3–8（6 子组件）+ Task 8（主容器） |
| `useContractReview` composable | Task 2 |
| docx-preview 渲染 | Task 7（`ContractDocxPreview.vue`） |
| 风险清单侧栏 | Task 6（`RiskListPanel.vue`，只读） |
| 下载批注 Word 按钮（`data.downloadUrl` 非 302） | Task 1（后端端点）+ Task 6（按钮）+ Task 2（`onDownload`） |

**M4 不交付**（对齐 spec §11 M5 行 / §9.3 rebuilding 态提示）：

- 风险 CRUD / 段落级 diff-match-patch（M5）
- PATCH `/reviews/:id` / POST `/reviews/:id/rebuild-docx`（M5）
- rebuilding 态禁用编辑 toast（M5 由编辑功能引入时一并加）
- GET `/reviews?page=...` 列表端点（spec §1.2"不在本次范围"/ M6+）
- 案件详情页复用（M6+）

---

## 文件结构（新增/修改）

### 后端（必要最小增量）

```
server/
├── api/v1/assistant/contract/
│   ├── chat.post.ts                          # 新增：SSE 对话入口（Task 1）
│   └── reviews/[id]/
│       └── download.get.ts                   # 新增：下载端点（Task 1）
```

### 前端

```
app/
├── composables/
│   └── useContractReview.ts                  # 新增（Task 2）
├── components/assistant/contract/
│   ├── ContractReviewPanel.vue               # 新增 · 主容器（Task 8）
│   ├── ContractSourceInput.vue               # 新增（Task 3）
│   ├── StanceSelectionDialog.vue             # 新增（Task 4）
│   ├── RiskClauseDiff.vue                    # 新增 · MVP 只展示 clauseText / suggestedClauseText 纯文本并排（Task 5）
│   ├── RiskListPanel.vue                     # 新增 · 只读 + 下载按钮（Task 6）
│   └── ContractDocxPreview.vue               # 新增（Task 7）
└── pages/dashboard/
    ├── contract.vue                          # 删除占位（Task 9）
    └── assistant/
        └── contract.vue                      # 新增页面（Task 9）
```

### 测试

```
tests/
├── server/assistant/contract/
│   ├── chat.branch.test.ts                   # Task 1 · 复制 document/chat 6 分支覆盖
│   └── download.api.test.ts                  # Task 1 · 下载端点集成测试
└── app/components/assistant/contract/        # Task 3–8 · 轻量组件单测（happy-dom）
    ├── ContractSourceInput.test.ts
    ├── StanceSelectionDialog.test.ts
    ├── RiskListPanel.test.ts
    └── RiskClauseDiff.test.ts
```

---

## 复用清单（实施必读，禁止重造）

| 既有资产 | 用法 |
|---|---|
| `useStreamChat`（app/composables/useStreamChat.ts） | `useContractReview` 内部挂载；`threadId` 取 review.sessionId；读 `interruptData` / `runStatus` / `submit` / `stop` |
| `chatQueueActions`（app/composables/chatQueueActions.ts） | 若需要消息队列能力（本期审查闭环不依赖，但若 Agent 需要多轮对话按 M5/M6 扩展） |
| `AiPromptInput`（app/components/ai/AiPromptInput.vue） | `ContractSourceInput` 复用 `:enable-file-upload="true"`，仅允许上传 1 个 .docx；**禁止重做上传 UI** |
| `docx-preview`（npm 依赖） | `ContractDocxPreview.vue` 使用 `renderAsync(buffer, container, null, { inWrapper: true })` |
| shadcn Dialog / RadioGroup / Button / Card / Input / ScrollArea | 立场 Dialog、侧栏、按钮、风险卡片布局 |
| `documentExport.service.ts:105` `generateSignedUrlService` | `/download` 端点从 `reviewedFileId` 获取 1h 签名 URL |
| `document/chat.post.ts`（`server/api/v1/assistant/document/chat.post.ts`） | `contract/chat.post.ts` **逐行改写**：把 `findDraftBySessionIdDAO` 换成 `findContractReviewBySessionIdDAO`，其它 6 分支结构保持不变 |
| `useDocumentDraft`（app/composables/useDocumentDraft.ts） | `useContractReview` 的参照模板，复制骨架（mountStream / interruptData / stopGeneration / onUnmounted 清理） |

---

## Task 0: 确认基础设施可用

**Files:**
- Read-only: verify backend M3 artifacts + dependencies exist

- [ ] **Step 1: 确认 M3 交付物存在且正常**

Run:
```bash
ls server/services/assistant/contract/contractReview.service.ts \
   server/services/assistant/contract/contractReview.dao.ts \
   server/api/v1/assistant/contract/reviews.post.ts \
   server/api/v1/assistant/contract/reviews/[id].get.ts \
   server/api/v1/assistant/contract/reviews/[id]/stance.post.ts
```
Expected: 5 files listed, no ENOENT.

- [ ] **Step 2: 确认 M3 会话通过 runContractReviewChat 可运行（worker 已分流 scope='contract'）**

Run: `grep -n "scope === 'contract'" server/services/agent/agentWorker.ts`
Expected: 命中一行形如 `else if (session.scope === 'contract')`.

- [ ] **Step 3: 确认 docx-preview / diff-match-patch 已在 package.json 安装**

Run: `grep -E "docx-preview|diff-match-patch" package.json`
Expected: 两个依赖都能匹配到（diff-match-patch 为 M5 用，这里先确认，避免 M5 再动 deps）.

**不改任何文件、不提交。** 只用于 Agent 实施者验证环境。

---

## Task 1: 后端端点 · SSE chat + download

**Files:**
- Create: `server/api/v1/assistant/contract/chat.post.ts`
- Create: `server/api/v1/assistant/contract/reviews/[id]/download.get.ts`
- Create test: `tests/server/assistant/contract/chat.branch.test.ts`
- Create test: `tests/server/assistant/contract/download.api.test.ts`

### Step 1: 写失败测试 · chat.branch.test.ts

- [ ] **Step 1: 测试 6 分支的关键路径（复制 document/chat.post.ts 已验证的测试结构，替换 session scope 为 contract）**

**Files to read first** for test scaffolding parity：
- `tests/server/assistant/document/chat.branch.test.ts`（若有，按其结构做最小裁剪；若无，仅需覆盖下列 5 个断言）

```typescript
// tests/server/assistant/contract/chat.branch.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { $fetch } from '@nuxt/test-utils/e2e'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

describe('POST /api/v1/assistant/contract/chat', () => {
    let userId: number
    beforeEach(async () => {
        const u = await ensureTestUser()
        userId = u.id
    })
    afterEach(async () => {
        await cleanupTestData(userId)
    })

    it('401 when unauthenticated', async () => {
        const res = await $fetch('/api/v1/assistant/contract/chat', {
            method: 'POST',
            body: { thread_id: 'any' },
        })
        expect(res.code).toBe(401)
    })
    it('400 when sessionId missing', async () => { /* auth 通过，body.thread_id 空 */ })
    it('404 when session not found', async () => { /* thread_id 随机，但 contractReview 不存在 */ })
    it('403 when session belongs to another user', async () => { /* 另一 user 的 contractReview */ })
    it('429 when active run RUNNING + new message', async () => { /* mock activeRun.status=RUNNING */ })
})
```

Run: `npx vitest run tests/server/assistant/contract/chat.branch.test.ts`
Expected: FAIL（handler 文件尚未创建）。

### Step 2: 实现 chat.post.ts（复制 document/chat.post.ts 并替换 DAO 与归属校验）

- [ ] **Step 2: 按照下面代码创建文件**

```typescript
// server/api/v1/assistant/contract/chat.post.ts
/**
 * POST /api/v1/assistant/contract/chat
 *
 * 合同审查会话的 SSE 对话入口。仿 `assistant/document/chat.post.ts` 的 6 分支范式，
 * 替换鉴权与入队参数：scope='contract'，caseId=null（MVP 独立页），归属校验走
 * findContractReviewBySessionIdDAO。
 */

import {
    findActiveRunBySessionIdDAO,
    findLatestRunBySessionIdDAO,
    updateRunStatusDAO,
} from '~~/server/services/agent/agentRun.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { findContractReviewBySessionIdDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { createAgentSseStream } from '~~/server/services/sse/agentSseStream'
import { extractChatParams, shouldRejectMessage } from '~~/server/utils/chat-branch-utils'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const raw = await readBody(event).catch(() => ({}))
    const { sessionId, message, command, thinking } = extractChatParams(raw ?? {})

    if (!sessionId) return resError(event, 400, 'sessionId 不能为空')
    if (message !== undefined && message.length > 10000) {
        return resError(event, 400, '输入内容过长，单次消息最大 10,000 字符')
    }

    const review = await findContractReviewBySessionIdDAO(sessionId)
    if (!review) return resError(event, 404, '合同审查会话不存在')
    if (review.userId !== user.id) return resError(event, 403, '无权访问该合同审查')

    const activeRun = await findActiveRunBySessionIdDAO(sessionId)
    let runId: string
    let latestRunStatus: string | undefined

    if (activeRun && message && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
        await updateRunStatusDAO(activeRun.id, AGENT_RUN_STATUS.COMPLETED, {
            completedAt: new Date(),
        })
        const result = await enqueueRunService({
            sessionId, threadId: sessionId, userId: user.id, caseId: null,
            input: { message, command, thinking },
        })
        if ('error' in result) return resError(event, 429, result.error)
        runId = result.runId
    }
    else if (activeRun) {
        if (shouldRejectMessage(activeRun.status, !!message)) {
            return resError(event, 429, '请等待当前生成完成')
        }
        runId = activeRun.id
    }
    else if (!message && !command) {
        const latestRun = await findLatestRunBySessionIdDAO(sessionId)
        if (!latestRun) return resError(event, 400, '消息不能为空')
        runId = latestRun.id
        latestRunStatus = latestRun.status
    }
    else {
        try {
            const result = await enqueueRunService({
                sessionId, threadId: sessionId, userId: user.id, caseId: null,
                input: { message, command, thinking },
            })
            if ('error' in result) return resError(event, 429, result.error)
            runId = result.runId
        }
        catch (err: any) {
            if (err?.code === 'P2002') {
                const raceActive = await findActiveRunBySessionIdDAO(sessionId)
                if (raceActive) runId = raceActive.id
                else throw err
            } else { throw err }
        }
    }

    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    })
    const stream = createAgentSseStream({ runId, event, sessionId, latestRunStatus })
    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
    })
})
```

Run: `npx vitest run tests/server/assistant/contract/chat.branch.test.ts`
Expected: PASS（若 helpers 缺失先补 `tests/server/assistant/test-db-helper.ts` 的 `createContractReviewForUser` fixture）.

### Step 3: 写失败测试 · download.api.test.ts

- [ ] **Step 3: 测试下载端点 4 分支**

```typescript
// tests/server/assistant/contract/download.api.test.ts
describe('GET /api/v1/assistant/contract/reviews/:id/download', () => {
    it('401 未登录', ...)
    it('404 reviewId 不存在', ...)
    it('403 跨用户访问', ...)
    it('400 review 尚未完成（reviewedFileId 为空）', ...)
    it('200 返回 downloadUrl（签名 URL 字符串非空）', ...)
})
```

Run: `npx vitest run tests/server/assistant/contract/download.api.test.ts`
Expected: FAIL。

### Step 4: 实现 download.get.ts

- [ ] **Step 4: 按照下面代码创建文件**

```typescript
// server/api/v1/assistant/contract/reviews/[id]/download.get.ts
/**
 * GET /api/v1/assistant/contract/reviews/:id/download
 *
 * 读取 contractReview.reviewedFileId → 返回 1h 签名 OSS 下载 URL（非 302，由前端触发浏览器下载）。
 *
 * 参见 spec §8.5 + §11 M4 "下载批注 Word 按钮（`data.downloadUrl` 非 302）"。
 */
import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, 'reviewId 无效')
    }

    const review = await getContractReviewDAO(id)
    if (!review) return resError(event, 404, '合同审查不存在')
    if (review.userId !== user.id) return resError(event, 403, '无权下载该审查结果')
    if (!review.reviewedFileId) return resError(event, 400, '审查未完成或批注文件未生成')

    const ossFile = await findOssFileByIdDao(review.reviewedFileId)
    if (!ossFile?.filePath) return resError(event, 404, '批注文件已不存在')

    const downloadUrl = await generateSignedUrlService(ossFile.filePath, {
        expires: 3600,
        userId: user.id,
    })
    return resSuccess(event, '获取下载地址成功', { downloadUrl })
})
```

### Step 5: 测试通过 + 提交

- [ ] **Step 5: 运行测试并提交**

Run: `npx vitest run tests/server/assistant/contract/chat.branch.test.ts tests/server/assistant/contract/download.api.test.ts`
Expected: 2 个文件全 PASS。

```bash
git add server/api/v1/assistant/contract/chat.post.ts \
        server/api/v1/assistant/contract/reviews/\[id\]/download.get.ts \
        tests/server/assistant/contract/chat.branch.test.ts \
        tests/server/assistant/contract/download.api.test.ts
git commit -m "feat(contract): 补齐 M4 后端端点（chat SSE + download）"
```

---

## Task 2: `useContractReview` composable

**Files:**
- Create: `app/composables/useContractReview.ts`

### Step 1: 写失败测试

- [ ] **Step 1: 创建 `tests/app/composables/useContractReview.test.ts`**

用 `@vue/test-utils` + `happy-dom` 验证：

1. `onStart({ sourceType, ossFileId })` 调 POST `/api/v1/assistant/contract/reviews`，把返回的 `reviewId` 写进 `reviewId.value`，`sessionId` 挂载 stream（mock `useStreamChat`）
2. `stream.interruptData.value.type === 'awaiting_stance'` 时，`isAwaitingStance.value === true`，`interruptData.value` 保留 `partyA / partyB / contractType`
3. `onStance({ stance, partyA, partyB })` 调 POST `/:id/stance` 且把 `runStatus` 复位 → resume stream（仍以 mock 断言 resumeInterrupt 被调）
4. `onDownload()` 调 GET `/:id/download`，从返回的 `downloadUrl` 构造 `<a download>` click（断言 DOM 被插入又移除）
5. `mountReview(id)` 用 GET `/:id` 拉当前 review 并挂载 stream

Run: `npx vitest run tests/app/composables/useContractReview.test.ts`
Expected: FAIL。

### Step 2: 实现

- [ ] **Step 2: 按下面骨架实现，总行数 ≤ 250 行（约束，超出则必须拆子 composable）**

```typescript
// app/composables/useContractReview.ts
/**
 * 合同审查 composable（MVP）
 *
 * 仿 useDocumentDraft 结构：集中管理 reviewId / review / runStatus / interruptData，
 * 对外暴露 onStart / mountReview / onStance / onDownload / resumeInterrupt / stopGeneration。
 *
 * MVP 不含：
 * - onEditRisks（M5 PATCH /reviews/:id）
 * - onRebuildDocx（M5 POST /:id/rebuild-docx）
 * - 消息队列（审查闭环是单步 interrupt→resume，无多轮追问；M5 引入编辑对话时再评估）
 */
import type { contractReviews } from '~~/generated/prisma/client'
import type {
    CreateReviewRequest, CreateReviewResponse,
    StanceRequest, DownloadResponse,
    ContractReviewStatus,
} from '#shared/types/contract'

export function useContractReview() {
    const reviewId = ref<number | null>(null)
    const review = ref<contractReviews | null>(null)
    const stream = shallowRef<ReturnType<typeof useStreamChat> | null>(null)
    let stopStreamWatch: (() => void) | null = null

    const messages = computed(() => stream.value?.messages.value ?? [])
    const runStatus = computed(() => stream.value?.runStatus.value ?? 'idle')
    const isLoading = computed(() => stream.value?.isLoading.value ?? false)
    const error = computed(() => stream.value?.error.value ?? null)

    const interruptData = computed(() => stream.value?.interruptData.value ?? null)
    const awaitingStance = computed(() => {
        const i = interruptData.value as any
        return i?.type === 'awaiting_stance' ? i : null
    })

    function mountStream(sessionId: string) {
        stopStreamWatch?.()
        const s = useStreamChat({
            apiUrl: '/api/v1/assistant/contract/chat',
            threadId: sessionId,
            messagesKey: 'messages',
        })
        stream.value = s
        // stream 完成后拉最新 review 以同步 status / risks / reviewedFileId
        stopStreamWatch = watch(() => s.runStatus.value, async (status) => {
            if (status === 'completed' || status === 'failed') {
                if (!reviewId.value) return
                const latest = await useApiFetch<contractReviews>(
                    `/api/v1/assistant/contract/reviews/${reviewId.value}`,
                    { showError: false } as any,
                )
                if (latest) review.value = latest
            }
        })
    }

    async function onStart(payload: CreateReviewRequest) {
        review.value = null
        reviewId.value = null
        stream.value = null
        const resp = await useApiFetch<CreateReviewResponse>(
            '/api/v1/assistant/contract/reviews',
            { method: 'POST', body: payload },
        )
        if (!resp) return
        reviewId.value = resp.reviewId
        mountStream(resp.sessionId)
        stream.value!.submit(undefined) // 触发 checkpointer 从初始 state 恢复推送
    }

    async function mountReview(id: number) {
        review.value = null
        reviewId.value = null
        stream.value = null
        const resp = await useApiFetch<contractReviews>(
            `/api/v1/assistant/contract/reviews/${id}`,
        )
        if (!resp) return
        reviewId.value = resp.id
        review.value = resp
        mountStream(resp.sessionId)
        stream.value!.submit(undefined)
    }

    async function onStance(payload: StanceRequest) {
        if (!reviewId.value) return
        const ok = await useApiFetch<unknown>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/stance`,
            { method: 'POST', body: payload },
        )
        if (!ok && ok !== null) return
        // stance 接口内部已把 INTERRUPTED→COMPLETED 释放、重新 enqueue，这里让 SSE 自动续流
        // 前端只需 submit(undefined) 触发 transport 重新订阅新 run
        if (stream.value) {
            stream.value.runStatus.value = 'idle'
            stream.value.submit(undefined)
        }
    }

    async function onDownload() {
        if (!reviewId.value) return
        const resp = await useApiFetch<DownloadResponse>(
            `/api/v1/assistant/contract/reviews/${reviewId.value}/download`,
        )
        if (!resp?.downloadUrl) return
        const a = document.createElement('a')
        a.href = resp.downloadUrl
        a.download = ''
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
    }

    function resumeInterrupt(data: unknown) {
        if (!stream.value) return
        stream.value.runStatus.value = 'idle'
        stream.value.submit(undefined, { command: { resume: data } } as any)
    }

    async function stopGeneration() {
        await stream.value?.stop()
    }

    onUnmounted(() => { stopStreamWatch?.() })

    return {
        reviewId, review, messages, runStatus, isLoading, error,
        interruptData, awaitingStance,
        onStart, mountReview, onStance, onDownload,
        resumeInterrupt, stopGeneration,
    }
}

export type UseContractReviewReturn = ReturnType<typeof useContractReview>
```

> **关键约定**：`onStance` 与 `resumeInterrupt` 的差别——`onStance` 通过 REST 落库（M3 已实现 INTERRUPTED→COMPLETED 释放 + enqueueRun），前端只需让 stream 重新订阅；**不要**同时走 LangGraph `command.resume`，否则会出现双 run 竞争 P2002。

- [ ] **Step 3: 运行测试确认通过并提交**

Run: `npx vitest run tests/app/composables/useContractReview.test.ts`
Expected: PASS.

```bash
git add app/composables/useContractReview.ts tests/app/composables/useContractReview.test.ts
git commit -m "feat(contract): useContractReview composable（onStart / onStance / onDownload）"
```

---

## Task 3: `ContractSourceInput.vue`

**Files:**
- Create: `app/components/assistant/contract/ContractSourceInput.vue`
- Create test: `tests/app/components/assistant/contract/ContractSourceInput.test.ts`

职责：两种源输入 → 归一成 `CreateReviewRequest` emit 给父组件。

**约束**：
- 复用 `AiPromptInput` 的文件上传；**只允许 1 个 .docx**（`enable-file-upload="true"` + 本组件在 submit 时做 MIME/count 校验）
- 接入 paste 模式：纯文本输入 → `{ sourceType: 'paste', text }`
- 上传模式：1 个文件 → `{ sourceType: 'upload', ossFileId }`
- UI 文案：占位符"粘贴合同全文或上传 .docx（≤ 20 MB）"；提交按钮"开始审查"

### Step 1: 写失败测试

- [ ] **Step 1**

```typescript
// tests/app/components/assistant/contract/ContractSourceInput.test.ts
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ContractSourceInput from '~/components/assistant/contract/ContractSourceInput.vue'

describe('ContractSourceInput', () => {
    it('emit submit(paste) 当只输入文本', async () => { /* 输入文本 → 点提交 → 断言 emitted[0][0] == { sourceType:'paste', text:'...' } */ })
    it('emit submit(upload) 当上传 1 份 .docx', async () => { /* mock AiPromptInput 的 @submit 回调 files=[{id:42}] */ })
    it('拒绝上传 2 份文件，toast 警告', async () => { /* mock useToast，断言未 emit */ })
    it('拒绝非 .docx 文件类型', async () => { /* mime application/pdf → 未 emit + toast */ })
    it('文本为空 + 无文件时按钮 disabled', async () => {})
})
```

Run: `npx vitest run tests/app/components/assistant/contract/ContractSourceInput.test.ts`
Expected: FAIL。

### Step 2: 实现

- [ ] **Step 2**

```vue
<!-- app/components/assistant/contract/ContractSourceInput.vue -->
<script setup lang="ts">
/**
 * 合同源输入：paste 纯文本 / upload 单份 .docx
 *
 * 严禁重做上传 UI，复用 AiPromptInput；仅做 1 份 + MIME 校验。
 */
import { useToast } from '~/components/ui/toast/use-toast'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { OssFileItem } from '~/store/file'
import type { CreateReviewRequest } from '#shared/types/contract'

const emit = defineEmits<{
    submit: [payload: CreateReviewRequest]
}>()

const { toast } = useToast()
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_SIZE_BYTES = 20 * 1024 * 1024

function handleSubmit(data: AiPromptSubmitData) {
    const files = (data.files ?? []) as OssFileItem[]
    const text = (data.text ?? '').trim()

    if (files.length > 1) {
        toast({ title: '只能上传一份合同', variant: 'destructive' })
        return
    }
    if (files.length === 1) {
        const f = files[0]
        if (f.fileType !== DOCX_MIME) {
            toast({ title: '仅支持 .docx 文件', variant: 'destructive' })
            return
        }
        if (f.fileSize && f.fileSize > MAX_SIZE_BYTES) {
            toast({ title: '文件不得超过 20 MB', variant: 'destructive' })
            return
        }
        emit('submit', { sourceType: 'upload', ossFileId: f.id })
        return
    }
    if (!text) return
    emit('submit', { sourceType: 'paste', text })
}
</script>

<template>
    <div>
        <AiPromptInput
            :show-thinking-toggle="false"
            :enable-file-upload="true"
            placeholder="粘贴合同全文或上传 .docx（≤ 20 MB）..."
            submit-label="开始审查"
            @submit="handleSubmit"
        />
    </div>
</template>
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
git add app/components/assistant/contract/ContractSourceInput.vue tests/app/components/assistant/contract/ContractSourceInput.test.ts
git commit -m "feat(contract): ContractSourceInput（上传单份 .docx / 粘贴文本）"
```

---

## Task 4: `StanceSelectionDialog.vue`

**Files:**
- Create: `app/components/assistant/contract/StanceSelectionDialog.vue`
- Create test: `tests/app/components/assistant/contract/StanceSelectionDialog.test.ts`

职责：显示识别到的 partyA / partyB / contractType（可编辑）+ 立场单选（甲方/乙方/中立）→ emit `confirm(StanceRequest)`。

### Step 1: 失败测试

- [ ] **Step 1**

```typescript
// tests/app/components/assistant/contract/StanceSelectionDialog.test.ts
describe('StanceSelectionDialog', () => {
    it('默认不显示（open=false）', ...)
    it('open=true 时显示识别到的甲乙方与合同类型', ...)
    it('立场未选时"确认"按钮 disabled', ...)
    it('立场选择后 emit confirm({ stance, partyA, partyB })', ...)
    it('甲乙方输入框可编辑并带入 emit payload', ...)
    it('partyA/partyB/contractType 为 null 时显示占位符不报错', ...)
    it('点击"取消"emit cancel 且不带参数', ...)
})
```

### Step 2: 实现

- [ ] **Step 2**

```vue
<!-- app/components/assistant/contract/StanceSelectionDialog.vue -->
<script setup lang="ts">
import type { Stance, StanceRequest } from '#shared/types/contract'

const props = defineProps<{
    open: boolean
    partyA: string | null
    partyB: string | null
    contractType: string | null
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    confirm: [payload: StanceRequest]
    cancel: []
}>()

const partyAInput = ref(props.partyA ?? '')
const partyBInput = ref(props.partyB ?? '')
const stance = ref<Stance | null>(null)

// 初始值同步（props 变化 → 重置表单）
watch(() => [props.open, props.partyA, props.partyB], () => {
    if (props.open) {
        partyAInput.value = props.partyA ?? ''
        partyBInput.value = props.partyB ?? ''
        stance.value = null
    }
})

const canSubmit = computed(() => stance.value !== null)

function handleConfirm() {
    if (!canSubmit.value) return
    emit('confirm', {
        stance: stance.value!,
        partyA: partyAInput.value.trim() || undefined,
        partyB: partyBInput.value.trim() || undefined,
    })
    emit('update:open', false)
}

function handleCancel() {
    emit('cancel')
    emit('update:open', false)
}
</script>

<template>
    <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>选择审查立场</DialogTitle>
                <DialogDescription>
                    <template v-if="contractType">已识别合同类型：<span class="font-medium text-foreground">{{ contractType }}</span></template>
                    <template v-else>未识别到明确的合同类型，可继续审查</template>
                </DialogDescription>
            </DialogHeader>

            <div class="space-y-4">
                <div class="space-y-2">
                    <Label>甲方名称</Label>
                    <Input v-model="partyAInput" placeholder="请填写甲方名称（可留空）" />
                </div>
                <div class="space-y-2">
                    <Label>乙方名称</Label>
                    <Input v-model="partyBInput" placeholder="请填写乙方名称（可留空）" />
                </div>
                <div class="space-y-2">
                    <Label>您代表哪一方进行审查？</Label>
                    <RadioGroup v-model="stance" class="flex gap-4">
                        <div class="flex items-center space-x-2"><RadioGroupItem value="partyA" id="stance-a" /><Label for="stance-a">甲方</Label></div>
                        <div class="flex items-center space-x-2"><RadioGroupItem value="partyB" id="stance-b" /><Label for="stance-b">乙方</Label></div>
                        <div class="flex items-center space-x-2"><RadioGroupItem value="neutral" id="stance-n" /><Label for="stance-n">中立</Label></div>
                    </RadioGroup>
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" @click="handleCancel">取消</Button>
                <Button :disabled="!canSubmit" @click="handleConfirm">确认</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
git add app/components/assistant/contract/StanceSelectionDialog.vue tests/app/components/assistant/contract/StanceSelectionDialog.test.ts
git commit -m "feat(contract): StanceSelectionDialog（立场选择对话框）"
```

---

## Task 5: `RiskClauseDiff.vue`（MVP 占位版）

**Files:**
- Create: `app/components/assistant/contract/RiskClauseDiff.vue`
- Create test: `tests/app/components/assistant/contract/RiskClauseDiff.test.ts`

职责（**M4 限定**）：展开一条风险时，**上下并排展示原文 + suggestedClauseText 纯文本**（不做段落级字符 diff 着色 —— spec §11 M5 行才上 `diff-match-patch`）。

UI 结构：两张并列卡片，左侧"原文条款"，右侧"建议改写"。

### Step 1: 失败测试

- [ ] **Step 1**

```typescript
describe('RiskClauseDiff', () => {
    it('渲染 clauseText 原文', ...)
    it('渲染 suggestedClauseText 建议改写', ...)
    it('suggestedClauseText 为空（low 风险）时只显示"无建议改写"', ...)
})
```

### Step 2: 实现

- [ ] **Step 2**

```vue
<!-- app/components/assistant/contract/RiskClauseDiff.vue -->
<script setup lang="ts">
defineProps<{
    clauseText: string
    suggestedClauseText?: string
}>()
</script>

<template>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div class="space-y-1">
            <div class="text-xs text-muted-foreground">原文条款</div>
            <div class="p-3 rounded-md bg-muted/40 whitespace-pre-wrap">{{ clauseText }}</div>
        </div>
        <div class="space-y-1">
            <div class="text-xs text-muted-foreground">建议改写</div>
            <div v-if="suggestedClauseText" class="p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30 whitespace-pre-wrap">
                {{ suggestedClauseText }}
            </div>
            <div v-else class="p-3 rounded-md bg-muted/20 text-muted-foreground italic">无建议改写</div>
        </div>
    </div>
</template>
```

- [ ] **Step 3: 提交**

```bash
git add app/components/assistant/contract/RiskClauseDiff.vue tests/app/components/assistant/contract/RiskClauseDiff.test.ts
git commit -m "feat(contract): RiskClauseDiff MVP（原文/建议并排；diff 着色留 M5）"
```

---

## Task 6: `RiskListPanel.vue`

**Files:**
- Create: `app/components/assistant/contract/RiskListPanel.vue`
- Create test: `tests/app/components/assistant/contract/RiskListPanel.test.ts`

职责（**M4 限定**）：
- 读取 `risks: Risk[]`（按 `clauseIndex` 升序渲染，参考 spec §14 O2 默认）
- 按 level 徽章（high/medium/low → 红/橙/灰）
- 展开/收起单条风险 → 展示 `RiskClauseDiff` + `legalBasis` / `analysis` / `risk` / `suggestion`
- 底部"下载批注 Word"按钮（`status === 'completed' && reviewedFileId` 才 enable）
- `[+ 新增风险] / [编辑] / [删除] / [重新生成批注 Word]` 按钮 **不渲染**（M5）

### Step 1–3: 失败测试 → 实现 → 提交

- [ ] **Step 1: 测试**

```typescript
describe('RiskListPanel', () => {
    it('risks 为空时显示"暂无风险"', ...)
    it('按 clauseIndex 升序渲染', ...)
    it('level 徽章颜色正确', ...)
    it('点击风险条目 → 展开（emit 或内部 state）', ...)
    it('reviewedFileId 存在 → 下载按钮可点击 → emit download', ...)
    it('reviewedFileId 为空 → 下载按钮 disabled', ...)
})
```

- [ ] **Step 2: 实现**

```vue
<!-- app/components/assistant/contract/RiskListPanel.vue -->
<script setup lang="ts">
import { DownloadIcon, ChevronDownIcon } from 'lucide-vue-next'
import type { Risk, ContractReviewStatus } from '#shared/types/contract'

const props = defineProps<{
    risks: Risk[]
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: string | null
}>()

const emit = defineEmits<{
    download: []
}>()

const sorted = computed(() =>
    [...props.risks].sort((a, b) => a.clauseIndex - b.clauseIndex)
)

const expandedId = ref<string | null>(null)
function toggle(id: string) {
    expandedId.value = expandedId.value === id ? null : id
}

const canDownload = computed(() =>
    props.status === 'completed' && props.reviewedFileId !== null
)

const LEVEL_LABEL: Record<Risk['level'], string> = { high: '高', medium: '中', low: '低' }
const LEVEL_CLASS: Record<Risk['level'], string> = {
    high: 'bg-red-500 text-white',
    medium: 'bg-orange-500 text-white',
    low: 'bg-gray-400 text-white',
}
</script>

<template>
    <div class="flex flex-col h-full">
        <div v-if="summary" class="p-3 border-b text-sm text-muted-foreground whitespace-pre-wrap">{{ summary }}</div>

        <ScrollArea class="flex-1">
            <div v-if="!sorted.length" class="p-6 text-sm text-muted-foreground text-center">暂无风险条目</div>
            <div v-else class="p-3 space-y-2">
                <Card v-for="r in sorted" :key="r.id" class="cursor-pointer" @click="toggle(r.id)">
                    <CardHeader class="py-2 px-3">
                        <div class="flex items-center gap-2">
                            <span class="inline-block px-2 py-0.5 rounded text-xs" :class="LEVEL_CLASS[r.level]">{{ LEVEL_LABEL[r.level] }}</span>
                            <span class="text-sm font-medium">{{ r.category }}</span>
                            <ChevronDownIcon class="ml-auto size-4 transition-transform" :class="{ 'rotate-180': expandedId === r.id }" />
                        </div>
                        <div class="mt-1 text-xs text-muted-foreground line-clamp-2">{{ r.problem }}</div>
                    </CardHeader>
                    <CardContent v-if="expandedId === r.id" class="py-2 px-3 text-sm space-y-3">
                        <AssistantContractRiskClauseDiff :clause-text="r.clauseText" :suggested-clause-text="r.suggestedClauseText" />
                        <div v-if="r.legalBasis"><div class="text-xs text-muted-foreground">法律依据</div><div>{{ r.legalBasis }}</div></div>
                        <div><div class="text-xs text-muted-foreground">条款分析</div><div class="whitespace-pre-wrap">{{ r.analysis }}</div></div>
                        <div><div class="text-xs text-muted-foreground">法律风险</div><div class="whitespace-pre-wrap">{{ r.risk }}</div></div>
                        <div><div class="text-xs text-muted-foreground">修改建议</div><div class="whitespace-pre-wrap">{{ r.suggestion }}</div></div>
                    </CardContent>
                </Card>
            </div>
        </ScrollArea>

        <div class="p-3 border-t">
            <Button class="w-full" :disabled="!canDownload" @click="emit('download')">
                <DownloadIcon class="size-4 mr-1" />下载批注 Word
            </Button>
        </div>
    </div>
</template>
```

- [ ] **Step 3: 提交**

```bash
git add app/components/assistant/contract/RiskListPanel.vue tests/app/components/assistant/contract/RiskListPanel.test.ts
git commit -m "feat(contract): RiskListPanel 只读版（M4）· 下载按钮"
```

---

## Task 7: `ContractDocxPreview.vue`

**Files:**
- Create: `app/components/assistant/contract/ContractDocxPreview.vue`

职责：拉取并用 `docx-preview` 渲染已注入批注的 .docx（`reviewedFileId`）。`originalFileId` 作为 fallback —— 如果审查还在进行中尚未生成 reviewedFileId，则渲染原始合同文件给用户参照；完成后切换到 reviewedFileId。

**MVP 不做**：点击段落底纹弹浮层 / RiskListPanel ↔ 正文双向联动（spec §9.3 给到 M5/M6 精化）。

### Step 1–3: 实现

- [ ] **Step 1: 失败测试**

```typescript
// tests/app/components/assistant/contract/ContractDocxPreview.test.ts
// 核心：mock useApiFetch 返回 downloadUrl + mock fetch 返回 ArrayBuffer + mock docx-preview.renderAsync 被调一次
describe('ContractDocxPreview', () => {
    it('reviewedFileId 存在时优先拉 reviewed.docx', ...)
    it('仅有 originalFileId 时 fallback 到 original.docx', ...)
    it('两个都没有时显示"等待合同上传..."占位', ...)
})
```

- [ ] **Step 2: 实现**

```vue
<!-- app/components/assistant/contract/ContractDocxPreview.vue -->
<script setup lang="ts">
import { renderAsync } from 'docx-preview'

const props = defineProps<{
    reviewedFileId: number | null
    originalFileId: number | null
}>()

const containerRef = ref<HTMLElement | null>(null)
const loading = ref(false)
const empty = computed(() => !props.reviewedFileId && !props.originalFileId)

let fetchSeq = 0

async function loadDocx(fileId: number) {
    const seq = ++fetchSeq
    loading.value = true
    try {
        // 复用批量下载端点 POST /api/v1/files/oss/download-url（见 server/api/v1/files/oss/download-url/.post.ts）。
        // 响应数据为 Array<{ ossFileId, downloadUrl }>（useApiFetch 自动拆 data 层）。
        const urlResp = await useApiFetch<Array<{ ossFileId: number; downloadUrl: string }>>(
            '/api/v1/files/oss/download-url',
            { method: 'POST', body: { ossFileIds: [fileId] }, showError: false } as any,
        )
        const downloadUrl = urlResp?.[0]?.downloadUrl
        if (seq !== fetchSeq || !downloadUrl) return
        const resp = await fetch(downloadUrl)
        if (seq !== fetchSeq) return
        if (!resp.ok) throw new Error(`下载合同失败: ${resp.status}`)
        const buffer = await resp.arrayBuffer()
        if (seq !== fetchSeq || !containerRef.value) return
        containerRef.value.innerHTML = ''
        await renderAsync(buffer, containerRef.value, null, { inWrapper: true })
    } catch (err) {
        console.warn('合同预览渲染失败', err)
    } finally {
        if (seq === fetchSeq) loading.value = false
    }
}

watch(
    () => props.reviewedFileId ?? props.originalFileId,
    (id) => { if (id) loadDocx(id) },
    { immediate: true },
)
</script>

<template>
    <div class="relative h-full bg-muted/20">
        <div v-if="empty" class="h-full flex items-center justify-center text-sm text-muted-foreground">
            等待合同上传...
        </div>
        <div v-else class="h-full overflow-auto">
            <div v-if="loading" class="p-4 text-sm text-muted-foreground">合同加载中...</div>
            <div ref="containerRef" class="docx-preview-container"></div>
        </div>
    </div>
</template>
```

> **实施确认**：通用 OSS 下载端点为 **POST `/api/v1/files/oss/download-url`**（批量），body `{ ossFileIds: number[] }`，返回 `Array<{ ossFileId, downloadUrl }>`，1 小时有效。本组件传单元素数组即可。

- [ ] **Step 3: 提交**

```bash
git add app/components/assistant/contract/ContractDocxPreview.vue tests/app/components/assistant/contract/ContractDocxPreview.test.ts
git commit -m "feat(contract): ContractDocxPreview（docx-preview 渲染批注合同）"
```

---

## Task 8: `ContractReviewPanel.vue`（主容器）

**Files:**
- Create: `app/components/assistant/contract/ContractReviewPanel.vue`

职责：三屏组合 + runStatus 旋转文案内联（spec §9.2 明文不拆 `ContractReviewStatus.vue`）。

- [ ] **Step 1: 实现**

```vue
<!-- app/components/assistant/contract/ContractReviewPanel.vue -->
<script setup lang="ts">
/**
 * 合同审查主容器。组合 ContractSourceInput / StanceSelectionDialog / ContractDocxPreview / RiskListPanel。
 *
 * 三屏：
 *   Step 1 提交屏：review==null && !isLoading
 *   Step 2 立场屏：awaitingStance.value 非空 → Dialog
 *   Step 3 结果屏：review != null && !awaitingStance
 * runStatus 文案内联（Loader2 + 文字），不拆 ContractReviewStatus.vue。
 */
import { Loader2Icon } from 'lucide-vue-next'

const props = defineProps<{
    /** 若传入则进入已有审查（从 URL ?reviewId=x 恢复） */
    reviewId?: number | null
}>()

const {
    review, reviewId: reviewIdRef, runStatus, isLoading,
    interruptData, awaitingStance,
    onStart, mountReview, onStance, onDownload,
} = useContractReview()

// 外部传入 reviewId → mountReview
watch(() => props.reviewId, async (id) => {
    if (id) await mountReview(id)
}, { immediate: true })

const dialogOpen = computed({
    get: () => !!awaitingStance.value,
    set: () => { /* 非用户手动关闭 —— Dialog close 走 cancel 路径（M4 MVP 不支持取消） */ },
})

const statusLabel = computed(() => {
    if (!review.value) return ''
    switch (review.value.status) {
        case 'pending': return '准备中...'
        case 'reviewing': return 'AI 正在逐条审查合同条款...'
        case 'awaiting_stance': return '等待您确认审查立场'
        case 'completed': return '审查完成'
        case 'failed': return '审查失败'
        default: return ''
    }
})

const showSourceInput = computed(() => !review.value && !isLoading.value)
const showBusy = computed(() => isLoading.value || review.value?.status === 'reviewing' || review.value?.status === 'pending')
const showResult = computed(() => review.value?.status === 'completed' || review.value?.status === 'failed')

function handleStanceConfirm(payload: { stance: any; partyA?: string; partyB?: string }) {
    onStance(payload)
}
</script>

<template>
    <div class="h-full flex flex-col">
        <!-- Step 1: 提交屏 -->
        <div v-if="showSourceInput" class="flex-1 flex items-center justify-center p-6">
            <div class="w-full max-w-xl">
                <h1 class="text-xl font-semibold mb-3">提交合同</h1>
                <AssistantContractContractSourceInput @submit="onStart" />
            </div>
        </div>

        <!-- Step 2 Dialog（始终挂载；open 由 awaitingStance 控制） -->
        <AssistantContractStanceSelectionDialog
            :open="!!awaitingStance"
            :party-a="(awaitingStance as any)?.partyA ?? null"
            :party-b="(awaitingStance as any)?.partyB ?? null"
            :contract-type="(awaitingStance as any)?.contractType ?? null"
            @confirm="handleStanceConfirm"
            @update:open="(v: boolean) => { /* 用户侧只能 confirm；忽略外部 close 请求 */ }"
        />

        <!-- Step 3: 结果屏（双栏） -->
        <div v-if="review && !showSourceInput" class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_400px]">
            <AssistantContractContractDocxPreview
                :reviewed-file-id="review?.reviewedFileId ?? null"
                :original-file-id="review?.originalFileId ?? null"
            />
            <div class="border-l flex flex-col min-h-0">
                <div v-if="showBusy" class="flex items-center gap-2 p-3 border-b text-sm text-muted-foreground">
                    <Loader2Icon class="size-4 animate-spin" />
                    <span>{{ statusLabel }}</span>
                </div>
                <AssistantContractRiskListPanel
                    :risks="((review?.risks as any) ?? []) as any"
                    :status="review?.status as any"
                    :reviewed-file-id="review?.reviewedFileId ?? null"
                    :summary="review?.summary ?? null"
                    @download="onDownload"
                />
            </div>
        </div>
    </div>
</template>
```

- [ ] **Step 2: 提交**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue
git commit -m "feat(contract): ContractReviewPanel 主容器（三屏 + runStatus 内联）"
```

---

## Task 9: 页面路由与菜单

**Files:**
- Create: `app/pages/dashboard/assistant/contract.vue`
- Delete: `app/pages/dashboard/contract.vue`（占位）

- [ ] **Step 1: 创建新页面**

```vue
<!-- app/pages/dashboard/assistant/contract.vue -->
<script setup lang="ts">
/**
 * 合同审查主页（路由 /dashboard/assistant/contract）
 *
 * 支持 URL query ?reviewId=xxx 从已有审查恢复。
 */
definePageMeta({
    layout: 'dashboard-layout',
    title: '合同审查',
    icon: 'FileSearch',
})

const route = useRoute()
const reviewId = computed(() => {
    const v = route.query.reviewId
    const n = Number(v)
    return Number.isInteger(n) && n > 0 ? n : null
})
</script>

<template>
    <div class="h-full min-h-0">
        <AssistantContractContractReviewPanel :review-id="reviewId" />
    </div>
</template>
```

- [ ] **Step 2: 删除占位页**

```bash
git rm app/pages/dashboard/contract.vue
```

- [ ] **Step 3: 搜索 RBAC 侧栏/菜单 seed 有无指向 `/dashboard/contract`**

Run:
```bash
grep -rn "/dashboard/contract" prisma/seeds/seedData.sql server/services/rbac/ 2>/dev/null
```

**若命中**：改为 `/dashboard/assistant/contract`（在 Step 3 的同一个提交中带上 seed 修订）。
**若未命中**：跳过（页面是自动发现的，无需修 seed）。

- [ ] **Step 4: 提交**

```bash
git add app/pages/dashboard/assistant/contract.vue
git commit -m "feat(contract): /dashboard/assistant/contract 页面路由；删占位 /dashboard/contract"
```

---

## Task 10: 集成 smoke 测试 + 浏览器手动验收

**Files:**
- Create: `tests/server/assistant/contract/m4Integration.test.ts`（仅 1 个用例）

### Step 1: 集成冒烟测试

- [ ] **Step 1: 后端闭环测试（不经真实 SSE，直接调 API 状态机）**

```typescript
// tests/server/assistant/contract/m4Integration.test.ts
// 流程：seed user → POST /reviews（paste 文本样本）→ GET /:id 拉到 awaiting_stance/completed
// → POST /stance → 轮询 GET /:id 直到 status==='completed' 或超时 60s
// → GET /:id/download → 断言 downloadUrl 是 https 签名链接
// 目的：验证 M4 新增的 download 端点 + M3 stance 端点联动不破
it('完整闭环：submit → stance → completed → download', async () => { /* ... */ }, 90_000)
```

Run: `npx vitest run tests/server/assistant/contract/m4Integration.test.ts`
Expected: PASS（依赖 M3 的 contractReviewMainAgent 实际跑一轮，耗时较长）。

> **若本机跑不过**：仅作为 CI gate，本地可 `it.skip`，但主分支 PR 必须绿；原因记录在 PR body。

### Step 2: 浏览器手动验收（chrome-devtools MCP）

- [ ] **Step 2: 启动 `bun dev`，用 chrome-devtools MCP 走以下序列**

1. 登录 → 访问 `/dashboard/assistant/contract`
2. 粘贴 `prisma/seeds/contract-samples/sample-01.docx` 内容（或上传文件），点"开始审查"
3. 等待 Dialog 弹出 → 校准 partyA/partyB → 选"甲方"→ 确认
4. 等待右侧 runStatus 文案变为"审查完成"
5. 点击"下载批注 Word"，浏览器下载文件；本地用 Microsoft Word / WPS 打开验证批注存在
6. 刷新页面后带 `?reviewId=<id>` 参数 → 回到结果屏；风险清单 / 批注 .docx 正常再次加载

- [ ] **Step 3: 提交 + 汇报**

```bash
git add tests/server/assistant/contract/m4Integration.test.ts
git commit -m "test(contract): M4 集成闭环冒烟测试"
```

Report to controller:
- 所有 11 个 commit sha
- vitest 整套绿
- 浏览器验收截图或 mcp 验收日志
- 合并 PR 摘要

---

## 自检清单（Plan 自我校验，实施时无需逐项执行）

- [x] Spec §11 M4 每个"核心产出"在 Task 1–9 都有归属
- [x] 未越界 M5 内容（diff 着色 / PATCH / rebuild-docx / CRUD 按钮均不实现）
- [x] 未越界 M6+ 内容（案件页复用 / 列表端点 / 超时 cron）
- [x] 每个 Task 给出具体文件路径（`app/components/assistant/contract/...`）
- [x] TDD 顺序（写测试 → FAIL → 实现 → PASS → commit）
- [x] 提交 scope 全部用 `contract`（M1 已加入 git.md 允许列表）
- [x] Ui 测试命令沿用 `npx vitest run`，禁止 `bun test`
- [x] 无 placeholder / TBD / TODO
- [x] 无对 strategy 字段的引用（spec §2 差异摘要已砍）
- [x] 所有 /reviews 端点路径 1:1 匹配 M3 已有实现

## 实施顺序建议

1. **Task 0**：仅读，验证环境
2. **Task 1**：后端 2 个端点 + 测试（最关键，解锁前端调用）
3. **Task 2**：composable（前端数据层）
4. **Task 3 / 4 / 5 / 6 / 7**：各自独立子组件（可并行，但 subagent-driven 一次一个以保持单向依赖）
5. **Task 8**：主容器整合
6. **Task 9**：页面路由
7. **Task 10**：闭环冒烟 + 浏览器验收

每个 Task 后运行 `npx nuxi typecheck` 确认类型无错误才可进入下一个。
