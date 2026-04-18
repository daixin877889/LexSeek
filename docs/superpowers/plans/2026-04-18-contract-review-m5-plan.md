# 合同审查 M5 Implementation Plan（diff + 编辑 + 重生 + E2E）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付合同审查 P0 增强：用户编辑 risks + 重生批注 Word + 条款级 diff 视觉 + 完整 E2E 覆盖。

**Architecture:** 后端补齐 2 个用户端端点（PATCH /:id 只收 risks + POST /:id/rebuild-docx 原子 rebuilding 占位）；前端升级 RiskClauseDiff（diff-match-patch 字符级着色）+ RiskListPanel（CRUD + 重生按钮 + rebuilding 禁用）；composable 新增 onEditRisks（debounce 500ms PATCH）/ onRebuildDocx；集成 + E2E 覆盖完整"提交→立场→审查→编辑→重生→下载"路径。

**Tech Stack:** Nuxt 4 / Vue 3 / diff-match-patch / docx-preview / Zod / Vitest + happy-dom + @vue/test-utils / Playwright（若 chrome-devtools MCP 不可用则走 Playwright spec）

---

## 对齐 spec §11 M5 行（1:1 映射）

| spec §11 M5 交付项 | 本 plan 实现位置 |
|---|---|
| 条款级 diff 展开（diff-match-patch 段落对照） | Task 4（`RiskClauseDiff.vue` 升级） |
| PATCH `/reviews/:id`（只收 risks，校验 RISK_SHAPE，拒绝 summary） | Task 2 |
| POST `/reviews/:id/rebuild-docx`（原子 `status='rebuilding'` 占位 + 覆盖 reviewedFileId） | Task 3 |
| 结果页编辑 UI（风险 CRUD + 新增/删除/编辑/重生按钮） | Task 5（`RiskListPanel.vue` 升级）+ Task 6（`RiskEditDialog.vue` 新增） |
| rebuilding 态禁用编辑 + toast | Task 5 + Task 7 |
| E2E 全路径 | Task 9 |
| `server/services/assistant/contract/` 覆盖率 ≥ 90% | Task 8 + Task 2/3 配套补测试 |

## 本 plan **不**交付（M6+）

- 案件详情页复用 `<ContractReviewPanel :case-id>`（spec §1.2 明确 M6+）
- GET /reviews 列表端点（分页 + caseId 过滤）
- 24h 超时 cron 扫 awaiting_stance
- 导出 PDF / Markdown 审查报告
- 多合同对比 / 合并审查
- 管理端接口 `/api/v1/admin/contract/**`（按新规则 `.claude/rules/api.md` 管理端与用户端 API 隔离，若未来需要管理端按需成对实现；本期**仅用户端**）

---

## 新规则接入：用户端 / 管理端 API 隔离

`.claude/rules/api.md` 新加"管理端与用户端 API 隔离（系统级规则）"：**禁止** 在同一接口中通过 `checkIsSuperAdmin` 为超管开旁路。

**对 M5 的影响**：
- PATCH `/api/v1/assistant/contract/reviews/:id` 必须严格 `review.userId === user.id` 校验（owner-only）
- POST `/api/v1/assistant/contract/reviews/:id/rebuild-docx` 同上
- **不**实现 `/api/v1/admin/contract/**` 端点（若未来管理端需要列表 / 强制重生 / 删除等能力，成对实现）
- 前端 `/dashboard/assistant/contract` 页面只调用用户端路径，不判断 role

---

## 文件结构（新增/修改）

### 后端

```
server/
├── api/v1/assistant/contract/reviews/[id]/
│   ├── index.patch.ts                                 # 新增（Task 2）
│   └── rebuild-docx.post.ts                           # 新增（Task 3）
└── services/assistant/contract/
    ├── contractReview.dao.ts                          # 修改：新增 atomicSetRebuildingDAO + setCompletedAfterRebuildDAO + patchReviewRisksDAO（Task 2/3）
    └── contractReviewRebuild.service.ts               # 新增：rebuildDocxService（Task 3）
```

### 前端

```
app/
├── composables/
│   └── useContractReview.ts                           # 修改：新增 onEditRisks / onRebuildDocx（Task 5）
└── components/assistant/contract/
    ├── RiskClauseDiff.vue                             # 修改：diff-match-patch 字符级着色（Task 4）
    ├── RiskListPanel.vue                              # 修改：编辑 UI + 重生按钮 + rebuilding 禁用（Task 5）
    ├── RiskEditDialog.vue                             # 新增：单条风险编辑 Dialog（Task 6）
    └── ContractReviewPanel.vue                        # 修改：透传 onEditRisks / onRebuildDocx + rebuilding toast（Task 7）
```

### 共享类型

```
shared/types/contract.ts                               # 修改（Task 1）
  - 新增 ReviewWithParsedRisks 类型（M4 Task 2 评审 I3 遗留）
  - 新增 REVIEW_EDITABLE_STATUSES 常量（只有 completed 能编辑）
```

### 测试

```
tests/
├── server/assistant/contract/
│   ├── patchReview.api.test.ts                        # Task 2
│   ├── rebuildDocx.api.test.ts                        # Task 3
│   ├── contractReviewRebuild.service.test.ts          # Task 3
│   └── m5Integration.test.ts                          # Task 8
├── app/components/assistant/contract/
│   ├── RiskClauseDiff.test.ts                         # Task 4 扩
│   ├── RiskListPanel.test.ts                          # Task 5 扩
│   ├── RiskEditDialog.test.ts                         # Task 6
│   └── ContractReviewPanel.test.ts                    # Task 7 扩
├── app/composables/
│   └── useContractReview.test.ts                      # Task 5 扩（onEditRisks / onRebuildDocx）
└── e2e/
    └── contract-review-full-path.spec.ts              # Task 9（Playwright）
```

---

## 复用清单（严禁重造）

| 既有资产 | 用法 |
|---|---|
| `buildRiskSchema` / `RISK_SHAPE`（`server/services/assistant/contract/riskSchema.builder.ts`） | Task 2 PATCH 端点 Zod 校验直接用 `z.array(RISK_SHAPE)` |
| `injectComments`（`server/services/assistant/contract/docx/commentInjector.ts`） | Task 3 重生批注直接调 |
| `downloadFileService` / `uploadFileService` / `generateSignedUrlService` / `generateOssDownloadSignaturesService` | Task 3 OSS 操作 |
| `createOssFileDao` / `findOssFileByIdDao` | Task 3 写新 ossFile |
| `getContractReviewDAO` / `updateContractReviewDAO` | Task 2/3 复用 |
| `diff-match-patch` npm 依赖（M1 已装，`@types/diff-match-patch` 也已装） | Task 4 字符级 diff |
| `docx-preview`（M4 用过） | 无本期改动 |
| shadcn Dialog / Button / Input / Textarea / Select / ScrollArea / Card / RadioGroup / Label / Separator | Task 5/6 复用 |
| `vue-sonner` `toast.success` / `toast.error` / `toast.warning` / `toast.info` | Task 5/6/7 反馈 |
| `useDebounceFn`（`@vueuse/core`，M4 useDocumentDraft 用过） | Task 5 onEditRisks debounce 500ms |
| Playwright E2E（`tests/e2e/`，项目已有 document-draft-workflow.spec.ts 作参照） | Task 9 |

---

## Task 0: 环境验证 + M4 Followup 登记

**Files:** 仅读

- [ ] **Step 1: 确认 M4 合入 dev 且 16 commits 齐**

```bash
git log --oneline dev | head -20
# 应看到 024c763 Merge branch 'feature/contract-review-m4' into dev（或等价 merge 点）
```

- [ ] **Step 2: 确认 diff-match-patch 已装**

```bash
grep -E "diff-match-patch|@types/diff-match-patch" package.json
# 应看到两条
```

- [ ] **Step 3: 确认 Playwright 已装 / 可用**

```bash
grep "@playwright/test\|playwright" package.json
ls tests/e2e/ 2>/dev/null
# 若 e2e 目录不存在或 playwright 未装，Task 9 需要前置补依赖
```

- [ ] **Step 4: 登记 M4 评审遗留 Followup（**本 plan 在相应 Task 消化**）**

| 来源 | 内容 | 本 plan 归属 |
|---|---|---|
| M4 Task 2 评审 I3 | `review.risks` 类型扩 `ReviewWithParsedRisks` | Task 1 |
| M4 Final 评审 I1 | Dialog @cancel → cancelReview（**已在 M4 最终 fix commit 68c7a3d 修了**，无需再修） | 已完成 |
| M4 Final 评审 I2 | submit 错误 toast（**已在 68c7a3d 修了**） | 已完成 |
| M4 Task 1 评审 I3 | P2002 兜底 catch 测试 | **本 plan 不做**（document 域也没补，技术债） |

**不改任何文件、不提交。** 仅用于实施者对齐认知。

---

## Task 1: 共享类型扩展

**Files:**
- Modify: `shared/types/contract.ts`

### Step 1: 新增类型 + 常量

- [ ] **Step 1: 追加到 shared/types/contract.ts 底部**

```typescript
import type { contractReviews } from '~~/generated/prisma/client'

/**
 * 审查实体（已将 Prisma JsonValue risks 收敛到 Risk[] 类型）
 *
 * 用于前端与管理层拆包后传给组件：M4 Task 2 评审 I3 登记，M5 落地。
 * 后端 API 层统一在返回前做 `{ ...review, risks: review.risks as Risk[] }` 转换，
 * 前端即可免去 `as Risk[]` 散落。
 */
export type ReviewWithParsedRisks = Omit<contractReviews, 'risks'> & {
    risks: Risk[] | null
}

/**
 * 仅 completed 状态允许编辑 risks / 重生批注。
 * pending / reviewing / awaiting_stance / failed / rebuilding 均返回 409。
 */
export const REVIEW_EDITABLE_STATUSES: readonly ContractReviewStatus[] = ['completed'] as const
```

**不**改前端现有断言（Task 5/7 的组件升级时再一起切到 `ReviewWithParsedRisks`；避免本 Task 改动炸太多测试）。

### Step 2: 类型验证 + 提交

- [ ] **Step 2**

Run: `npx nuxi typecheck 2>&1 | grep -E "(contract\.ts|contract/)" | head -5`
Expected: 无新增错误（允许 M3 既有的 partyDetector.ts 预存错误）。

```bash
git add shared/types/contract.ts
git commit -m "feat(contract): 扩展 ReviewWithParsedRisks 类型 + REVIEW_EDITABLE_STATUSES 常量（M4 评审 I3）"
```

---

## Task 2: PATCH /reviews/:id（编辑 risks）

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/index.patch.ts`
- Modify: `server/services/assistant/contract/contractReview.dao.ts`（新增 `patchReviewRisksDAO`）
- Create: `tests/server/assistant/contract/patchReview.api.test.ts`

### 接口契约（spec §8.3）

- 请求：`PATCH /api/v1/assistant/contract/reviews/:id` body `{ risks: Risk[] }`
- 响应：`resSuccess(event, '保存成功', { reviewId })`
- 分支：
  1. 401 未登录
  2. 400 `id` 无效（非正整数）
  3. 400 body Zod 校验失败（不是数组 / Risk 字段缺失 / high/medium 缺 `suggestedClauseText`）
  4. 400 body 含 `summary` 字段（spec 明文禁止）
  5. 404 review 不存在
  6. 403 跨用户
  7. 409 status 不是 `completed`（pending/reviewing/awaiting_stance/failed/rebuilding 都返回）
  8. 200 全量替换 `risks` 并返回 reviewId

### Step 1: DAO 新增

- [ ] **Step 1: 在 contractReview.dao.ts 追加**

```typescript
/**
 * 全量替换 risks 字段（只在 PATCH /reviews/:id 端点中调用，status 校验在 handler 层）。
 */
export async function patchReviewRisksDAO(
    id: number,
    risks: Risk[],
): Promise<contractReviews> {
    return prisma.contractReviews.update({
        where: { id, deletedAt: null },
        data: { risks: risks as unknown as Prisma.InputJsonValue, updatedAt: new Date() },
    })
}
```

记得在文件顶 `import type { Risk } from '#shared/types/contract'`。

### Step 2: 失败测试

- [ ] **Step 2: 创建 tests/server/assistant/contract/patchReview.api.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'
// 沿用 M4 chat.branch.test.ts 的 globalThis stub 模式；仅 DAO / storage 走真实 DB

describe('PATCH /api/v1/assistant/contract/reviews/:id', () => {
    it('401 未登录')
    it('400 id 非正整数')
    it('400 body 非对象')
    it('400 risks 缺失 / 非数组')
    it('400 RISK_SHAPE refine 失败（high 无 suggestedClauseText）')
    it('400 body 含 summary 字段（spec 明文禁止）')
    it('404 review 不存在')
    it('403 跨用户')
    it('409 status=pending')
    it('409 status=reviewing')
    it('409 status=awaiting_stance')
    it('409 status=failed')
    it('409 status=rebuilding')
    it('200 status=completed 时全量替换 risks 并返回 { reviewId }')
    it('200 后重新 GET /:id 能读到新 risks')
})
```

Run: `npx vitest run tests/server/assistant/contract/patchReview.api.test.ts`
Expected: FAIL。

### Step 3: 实现 handler

- [ ] **Step 3: 创建 server/api/v1/assistant/contract/reviews/[id]/index.patch.ts**

```typescript
/**
 * PATCH /api/v1/assistant/contract/reviews/:id
 *
 * 用户编辑风险清单（全量替换）。
 *
 * 约束（对齐 spec §8.3）：
 *   - 仅 status='completed' 可编辑，其它状态 409
 *   - body 只接受 risks；显式拒绝 summary（YAGNI，UI 无此编辑入口）
 *   - risks 经 z.array(RISK_SHAPE) 校验，high/medium 必含 suggestedClauseText
 *   - 不触发批注重生（需用户显式调 /rebuild-docx）
 *
 * 错误分支（7 条）+ 成功分支（1 条）：
 *   401 / 400(id) / 400(body) / 400(summary 禁字段) / 404 / 403 / 409 / 200
 */
import { z } from 'zod'
import {
    getContractReviewDAO,
    patchReviewRisksDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { RISK_SHAPE } from '~~/server/services/assistant/contract/riskSchema.builder'

const BodySchema = z.object({
    risks: z.array(RISK_SHAPE).min(0),
}).strict() // 显式拒绝 summary 等额外字段

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, 'reviewId 无效')
    }

    const raw = await readBody(event).catch(() => null)
    if (!raw || typeof raw !== 'object') return resError(event, 400, '请求体无效')

    const parsed = BodySchema.safeParse(raw)
    if (!parsed.success) {
        const first = parsed.error.issues[0]
        const path = first.path.join('.')
        return resError(event, 400, `${path || 'body'}: ${first.message}`)
    }

    const review = await getContractReviewDAO(id)
    if (!review) return resError(event, 404, '合同审查不存在')
    if (review.userId !== user.id) return resError(event, 403, '无权编辑该审查')
    if (review.status !== 'completed') {
        return resError(event, 409, `当前状态不允许编辑：${review.status}`)
    }

    await patchReviewRisksDAO(id, parsed.data.risks)
    return resSuccess(event, '保存成功', { reviewId: id })
})
```

- [ ] **Step 4: 测试通过 + 提交**

```bash
npx vitest run tests/server/assistant/contract/patchReview.api.test.ts
# 期望全 PASS
git add server/services/assistant/contract/contractReview.dao.ts \
        server/api/v1/assistant/contract/reviews/\[id\]/index.patch.ts \
        tests/server/assistant/contract/patchReview.api.test.ts
git commit -m "feat(contract): PATCH /reviews/:id 端点（编辑 risks + 拒绝 summary + 409 状态守门）"
```

---

## Task 3: POST /reviews/:id/rebuild-docx（重生批注 Word）

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/rebuild-docx.post.ts`
- Create: `server/services/assistant/contract/contractReviewRebuild.service.ts`
- Modify: `server/services/assistant/contract/contractReview.dao.ts`（新增 `atomicSetRebuildingDAO` + `setCompletedAfterRebuildDAO`）
- Create: `tests/server/assistant/contract/rebuildDocx.api.test.ts`
- Create: `tests/server/assistant/contract/contractReviewRebuild.service.test.ts`

### 接口契约（spec §8.4）

1. 401 / 400（id 无效）/ 404 / 403 —— 常规
2. 409（status 不是 completed）
3. **原子占位**：`UPDATE contract_reviews SET status='rebuilding' WHERE id=? AND status='completed' RETURNING id`
   - 影响行数 0 → 429 "批注正在重新生成中，请稍候"
4. 加载 review.risks（可能为 []）+ 下载 originalFileId → `injectComments` → 上传新 ossFile → `update reviewedFileId, status='completed'`
5. 任意一步失败：回滚 `status='completed'`（**保留旧 reviewedFileId**），返回 500
6. 成功：返回 `{ reviewedFileId: number, downloadUrl: string }`（1h 签名 URL）

### Step 1: DAO 新增（原子占位 + 回滚）

- [ ] **Step 1: contractReview.dao.ts 追加**

```typescript
/**
 * 原子把 status 从 completed 置为 rebuilding（拿占位锁）。
 * 失败场景：并发 rebuild 时另一个请求抢占，或 status 已非 completed。
 *
 * 返回 true 仅当本次调用成功占位。
 */
export async function atomicSetRebuildingDAO(id: number): Promise<boolean> {
    const result = await prisma.contractReviews.updateMany({
        where: { id, deletedAt: null, status: 'completed' },
        data: { status: 'rebuilding', updatedAt: new Date() },
    })
    return result.count === 1
}

/**
 * 重生完成：把 status 回到 completed 并覆盖 reviewedFileId。
 * 不校验入参 status（调用方负责只在 rebuilding 时调）。
 */
export async function setCompletedAfterRebuildDAO(
    id: number,
    reviewedFileId: number,
): Promise<contractReviews> {
    return prisma.contractReviews.update({
        where: { id },
        data: { status: 'completed', reviewedFileId, updatedAt: new Date() },
    })
}

/**
 * 重生失败回滚：把 status 从 rebuilding 回滚到 completed（保留旧 reviewedFileId）。
 */
export async function rollbackRebuildDAO(id: number): Promise<void> {
    await prisma.contractReviews.updateMany({
        where: { id, status: 'rebuilding' },
        data: { status: 'completed', updatedAt: new Date() },
    })
}
```

### Step 2: 实现 service

- [ ] **Step 2: 创建 server/services/assistant/contract/contractReviewRebuild.service.ts**

```typescript
/**
 * 重生批注 Word 服务（只在 POST /reviews/:id/rebuild-docx 端点中调用）。
 *
 * 责任：
 *   1. 调用方已占位 rebuilding —— 本函数专注"下载原件 → 注入 → 上传 → 更新"
 *   2. 任意步骤抛异常 → 调用方负责调用 rollbackRebuildDAO 回滚
 *   3. 成功时返回 { reviewedFileId, downloadUrl }（1h 签名）
 *
 * 注意：不处理并发，并发由 atomicSetRebuildingDAO 守门。
 */
import type { contractReviews } from '~~/generated/prisma/client'
import { findOssFileByIdDao, createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { setCompletedAfterRebuildDAO } from './contractReview.dao'
import { injectComments } from './docx'
import { downloadFileService, uploadFileService, generateSignedUrlService } from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfigs.dao'
import { StorageProviderType } from '#shared/types/oss'
import { FileSource, OssFileStatus } from '#shared/types/file'
import type { Risk } from '#shared/types/contract'

export interface RebuildDocxResult {
    reviewedFileId: number
    downloadUrl: string
}

export async function rebuildDocxService(
    review: contractReviews,
): Promise<RebuildDocxResult> {
    if (!review.originalFileId) {
        throw new Error('审查没有原始文件，无法重生批注')
    }
    const origOssFile = await findOssFileByIdDao(review.originalFileId)
    if (!origOssFile?.filePath) {
        throw new Error('原始文件已丢失，无法重生批注')
    }
    const origBuffer = await downloadFileService(origOssFile.filePath)
    const risks = (review.risks ?? []) as unknown as Risk[]
    const newDocxBuffer = await injectComments(origBuffer, risks)

    const uploadResult = await uploadFileService({
        buffer: Buffer.from(newDocxBuffer),
        filename: `${review.id}-reviewed-${Date.now()}.docx`,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const [storageConfig] = await Promise.all([
        getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, review.userId),
    ])
    const bucketName = storageConfig?.bucket ?? ''

    const newOssFile = await createOssFileDao({
        userId: review.userId,
        bucketName,
        fileName: `合同审查-${review.id}.docx`,
        filePath: uploadResult.name,
        fileSize: newDocxBuffer.byteLength,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        source: FileSource.CONTRACT_REVIEW_REBUILD,
        status: OssFileStatus.UPLOADED,
        encrypted: false,
    })

    await setCompletedAfterRebuildDAO(review.id, newOssFile.id)

    const downloadUrl = await generateSignedUrlService(uploadResult.name, {
        expires: 3600,
        userId: review.userId,
    })

    return { reviewedFileId: newOssFile.id, downloadUrl }
}
```

**注意**：

- `FileSource.CONTRACT_REVIEW_REBUILD` 可能不存在 —— 先 `grep "CONTRACT_REVIEW" shared/types/file.ts`；若缺则需要：
  - 在 `shared/types/file.ts` 新增 `CONTRACT_REVIEW_REBUILD = 'contract_review_rebuild'` 或复用已有 enum（如 `CONTRACT_REVIEW` 本身，若 M3 的 reviewResultPersistence 已用过 —— 看一眼那里的 `createOssFileDao({ source: ... })`）。**请以 grep 结果为准**。

### Step 3: 失败测试 + 实现 handler

- [ ] **Step 3: 创建 tests/server/assistant/contract/rebuildDocx.api.test.ts**

覆盖 8 个分支：401 / 400(id) / 404 / 403 / 409(status≠completed) / 429(并发占位失败) / 500(重生异常回滚 status) / 200(新 reviewedFileId + downloadUrl)

- [ ] **Step 4: 创建 server/api/v1/assistant/contract/reviews/[id]/rebuild-docx.post.ts**

```typescript
/**
 * POST /api/v1/assistant/contract/reviews/:id/rebuild-docx
 *
 * 根据最新 risks 重生批注 Word，覆盖 reviewedFileId。
 *
 * 流程（对齐 spec §8.4）：
 *   1. 校验 status=completed
 *   2. atomicSetRebuildingDAO 原子占位；失败 → 429
 *   3. rebuildDocxService（下载 → 注入 → 上传 → 更新 reviewedFileId + status=completed）
 *   4. 失败 → rollbackRebuildDAO + 500
 */
import { getContractReviewDAO, atomicSetRebuildingDAO, rollbackRebuildDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { rebuildDocxService } from '~~/server/services/assistant/contract/contractReviewRebuild.service'

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
    if (review.userId !== user.id) return resError(event, 403, '无权重生批注')
    if (review.status !== 'completed') {
        return resError(event, 409, `当前状态不允许重生：${review.status}`)
    }

    const occupied = await atomicSetRebuildingDAO(id)
    if (!occupied) return resError(event, 429, '批注正在重新生成中，请稍候')

    try {
        // 占位后重读（可能别的请求改了 risks）
        const fresh = await getContractReviewDAO(id)
        if (!fresh) throw new Error('review 在占位期间被删除')
        const result = await rebuildDocxService(fresh)
        return resSuccess(event, '重生成功', result)
    } catch (err) {
        logger.error('rebuild-docx 失败', err)
        await rollbackRebuildDAO(id)
        return resError(event, 500, '重生批注失败，请稍后重试')
    }
})
```

- [ ] **Step 5: 测试通过 + 提交**

```bash
npx vitest run tests/server/assistant/contract/rebuildDocx.api.test.ts \
               tests/server/assistant/contract/contractReviewRebuild.service.test.ts
# 全 PASS
git add server/services/assistant/contract/contractReview.dao.ts \
        server/services/assistant/contract/contractReviewRebuild.service.ts \
        server/api/v1/assistant/contract/reviews/\[id\]/rebuild-docx.post.ts \
        tests/server/assistant/contract/rebuildDocx.api.test.ts \
        tests/server/assistant/contract/contractReviewRebuild.service.test.ts
git commit -m "feat(contract): POST /reviews/:id/rebuild-docx 端点 + 原子占位 + 回滚"
```

---

## Task 4: RiskClauseDiff.vue 升级为 diff-match-patch 字符级对照

**Files:**
- Modify: `app/components/assistant/contract/RiskClauseDiff.vue`
- Modify: `tests/app/components/assistant/contract/RiskClauseDiff.test.ts`

### 交互目标（spec §11 M5）

在**原文**和**建议改写**两栏里，用 diff-match-patch 的 `diff_main` + `diff_cleanupSemantic` 计算字符级 diff，并着色：

- 删除（仅出现在原文）：`bg-red-100 line-through dark:bg-red-900/30`
- 新增（仅出现在建议）：`bg-emerald-100 dark:bg-emerald-900/30 font-medium`
- 相同：默认样式

### Step 1: 扩展测试

- [ ] **Step 1: 追加测试**

```typescript
describe('RiskClauseDiff (M5 diff-match-patch 升级)', () => {
    it('原文 / 建议完全相同 → 两栏纯文本（无 diff 标记）', ...)
    it('建议改写比原文多 "不少于 30 日" → 新增片段用 emerald 高亮', ...)
    it('原文有 "60 日" 建议改写为 "30 日" → 60 在原文红色删除线，30 在建议绿色', ...)
    it('suggestedClauseText 为空 → fallback 到 "无建议改写"（保留 M4 行为）', ...)
})
```

使用 `@vue/test-utils` 的 `wrapper.html()` 断言含 `bg-red-100` / `bg-emerald-100` 的片段。

### Step 2: 实现

- [ ] **Step 2: 重写组件**

```vue
<script setup lang="ts">
/**
 * 单条风险的条款对照（M5：字符级 diff 着色）
 *
 * 用 diff-match-patch 做字符级 diff，原文栏仅显示"相同 + 删除"，
 * 建议栏仅显示"相同 + 新增"。删除红底删除线，新增绿底加粗。
 */
import DiffMatchPatch from 'diff-match-patch'
import { computed } from 'vue'

const props = defineProps<{
    clauseText: string
    suggestedClauseText?: string
}>()

type DiffSegment = { kind: 'equal' | 'delete' | 'insert'; text: string }

const dmp = new DiffMatchPatch()

const diff = computed<{ original: DiffSegment[]; revised: DiffSegment[] } | null>(() => {
    if (!props.suggestedClauseText) return null
    const raw = dmp.diff_main(props.clauseText, props.suggestedClauseText)
    dmp.diff_cleanupSemantic(raw)
    const original: DiffSegment[] = []
    const revised: DiffSegment[] = []
    for (const [op, text] of raw) {
        if (op === 0) {
            original.push({ kind: 'equal', text })
            revised.push({ kind: 'equal', text })
        } else if (op === -1) {
            original.push({ kind: 'delete', text })
        } else if (op === 1) {
            revised.push({ kind: 'insert', text })
        }
    }
    return { original, revised }
})

const CLASS_MAP: Record<DiffSegment['kind'], string> = {
    equal: '',
    delete: 'bg-red-100 dark:bg-red-900/30 line-through',
    insert: 'bg-emerald-100 dark:bg-emerald-900/30 font-medium',
}
</script>

<template>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div class="space-y-1">
            <div class="text-xs text-muted-foreground">原文条款</div>
            <div v-if="diff" class="p-3 rounded-md bg-muted/40 whitespace-pre-wrap">
                <span v-for="(seg, i) in diff.original" :key="`o-${i}`" :class="CLASS_MAP[seg.kind]">{{ seg.text }}</span>
            </div>
            <div v-else class="p-3 rounded-md bg-muted/40 whitespace-pre-wrap">{{ clauseText }}</div>
        </div>
        <div class="space-y-1">
            <div class="text-xs text-muted-foreground">建议改写</div>
            <div v-if="diff" class="p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30 whitespace-pre-wrap">
                <span v-for="(seg, i) in diff.revised" :key="`r-${i}`" :class="CLASS_MAP[seg.kind]">{{ seg.text }}</span>
            </div>
            <div v-else class="p-3 rounded-md bg-muted/20 text-muted-foreground italic">无建议改写</div>
        </div>
    </div>
</template>
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
npx vitest run tests/app/components/assistant/contract/RiskClauseDiff.test.ts
git add app/components/assistant/contract/RiskClauseDiff.vue tests/app/components/assistant/contract/RiskClauseDiff.test.ts
git commit -m "feat(contract): RiskClauseDiff 升级字符级 diff 着色（diff-match-patch）"
```

---

## Task 5: useContractReview 扩展 onEditRisks / onRebuildDocx

**Files:**
- Modify: `app/composables/useContractReview.ts`
- Modify: `tests/app/composables/useContractReview.test.ts`

### 新增导出

- `onEditRisks(risks: Risk[])`: `useDebounceFn(async (risks) => { PATCH /:id with { risks } }, 500)` —— 500ms 节流；失败 toast.error
- `onRebuildDocx()`: POST /:id/rebuild-docx；成功后：
  - 刷 `review` 值（`refreshReview()`，复用内部已有 watcher 同名私有函数，若没有则 `GET /:id` 再写）
  - 触发 `onDownload(newDownloadUrl)` —— 自动打开新文件（spec §9.3 "重新生成批注 Word...调 /rebuild-docx 后自动打开新文件的 downloadUrl"）
  - toast.success '重生完成'
  - 失败：toast.error '重生失败'

- 返回值新增 `onEditRisks` / `onRebuildDocx` / `isRebuilding`（派生自 `review.value?.status === 'rebuilding'`）

### Step 1: 失败测试

- [ ] **Step 1**

```typescript
describe('useContractReview (M5 扩展)', () => {
    it('onEditRisks debounce 500ms：连续三次调用，只发一次 PATCH', ...)
    it('onEditRisks 成功后 review.value.risks 被更新', ...)
    it('onEditRisks PATCH 409 → toast.error 提示状态不允许编辑', ...)
    it('onRebuildDocx 成功 → review.reviewedFileId 更新 + 调 <a download>', ...)
    it('onRebuildDocx 429 → toast.warning 提示重生中', ...)
    it('onRebuildDocx 500 → toast.error', ...)
    it('isRebuilding 在 review.status===rebuilding 时为 true', ...)
})
```

### Step 2: 实现

- [ ] **Step 2: 在 useContractReview.ts 补**

```typescript
import { useDebounceFn } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { Risk } from '#shared/types/contract'

// ...existing useContractReview function body...

const onEditRisks = useDebounceFn(async (risks: Risk[]) => {
    if (!reviewId.value) return
    const resp = await useApiFetch<{ reviewId: number }>(
        `/api/v1/assistant/contract/reviews/${reviewId.value}`,
        { method: 'PATCH', body: { risks }, showError: false } as any,
    )
    if (!resp) {
        toast.error('保存风险清单失败')
        return
    }
    if (review.value) {
        review.value = { ...review.value, risks: risks as unknown as any }
    }
}, 500)

async function onRebuildDocx() {
    if (!reviewId.value) return
    const resp = await useApiFetch<{ reviewedFileId: number; downloadUrl: string }>(
        `/api/v1/assistant/contract/reviews/${reviewId.value}/rebuild-docx`,
        { method: 'POST', showError: false } as any,
    )
    if (!resp) {
        toast.error('重生批注失败，请稍后重试')
        return
    }
    // 刷 review（reviewedFileId 变了，docx-preview 需重新加载）
    const latest = await useApiFetch<contractReviews>(
        `/api/v1/assistant/contract/reviews/${reviewId.value}`,
        { showError: false } as any,
    )
    if (latest) review.value = latest
    toast.success('批注已重生')
    // 自动触发浏览器下载（spec §9.3）
    const a = document.createElement('a')
    a.href = resp.downloadUrl
    a.download = ''
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
}

const isRebuilding = computed(() => review.value?.status === 'rebuilding')

return {
    // ...既有导出...
    onEditRisks,
    onRebuildDocx,
    isRebuilding,
}
```

- [ ] **Step 3: 测试通过 + 提交**

```bash
npx vitest run tests/app/composables/useContractReview.test.ts
git add app/composables/useContractReview.ts tests/app/composables/useContractReview.test.ts
git commit -m "feat(contract): useContractReview 扩 onEditRisks / onRebuildDocx / isRebuilding"
```

---

## Task 6: RiskEditDialog.vue（单条风险编辑对话框）

**Files:**
- Create: `app/components/assistant/contract/RiskEditDialog.vue`
- Create: `tests/app/components/assistant/contract/RiskEditDialog.test.ts`

### 职责

- 编辑 / 新增单条 Risk
- 表单字段：clauseIndex（number）/ clauseText（textarea）/ level（select high/medium/low）/ category（input）/ problem（textarea）/ legalBasis（textarea, optional）/ analysis（textarea）/ risk（textarea）/ suggestion（textarea）/ suggestedClauseText（textarea，high/medium 必填）
- 校验（前端 Zod 与后端 RISK_SHAPE 一致）：
  - high/medium 时 suggestedClauseText 非空
  - clauseIndex >= 0 整数
  - 其它必填：clauseText / category / problem / analysis / risk / suggestion
- emit confirm(Risk) / cancel

### Props & Events

```typescript
defineProps<{
    open: boolean
    /** null = 新增；传入 Risk = 编辑 */
    risk: Risk | null
}>()
defineEmits<{
    'update:open': [value: boolean]
    confirm: [payload: Risk]
    cancel: []
}>()
```

### Step 1/2/3: 失败测试 → 实现 → 提交

- [ ] **Step 1: 失败测试**

```typescript
describe('RiskEditDialog', () => {
    it('新增模式（risk=null）默认空表单，level=medium 默认')
    it('编辑模式（risk 非空）预填 9 个字段')
    it('high 级别 + 空 suggestedClauseText 时"确认"按钮 disabled')
    it('low 级别 + 空 suggestedClauseText 时"确认"按钮 enable')
    it('clauseIndex 非正整数（负数/小数）→ "确认" disabled + 错误提示')
    it('取消按钮 emit cancel + update:open(false)')
    it('确认 emit confirm(Risk) + update:open(false)')
    it('open false→true 重置表单（关闭再打开不保留上次编辑）')
})
```

- [ ] **Step 2: 实现（≤180 行）**

结构参考 Task 4（StanceSelectionDialog）；用 shadcn Dialog + Label + Input + Textarea + Select。

关键片段：
```typescript
const form = ref<Partial<Risk>>({ level: 'medium', clauseIndex: 0, ... })
const canSubmit = computed(() => {
    if (!form.value.clauseText || !form.value.category || !form.value.problem || !form.value.analysis || !form.value.risk || !form.value.suggestion) return false
    if (!Number.isInteger(form.value.clauseIndex) || form.value.clauseIndex < 0) return false
    if ((form.value.level === 'high' || form.value.level === 'medium') && !form.value.suggestedClauseText) return false
    return true
})

function handleConfirm() {
    if (!canSubmit.value) return
    const payload: Risk = {
        id: props.risk?.id ?? crypto.randomUUID(),
        clauseIndex: form.value.clauseIndex!,
        clauseText: form.value.clauseText!,
        level: form.value.level!,
        category: form.value.category!,
        problem: form.value.problem!,
        legalBasis: form.value.legalBasis || undefined,
        analysis: form.value.analysis!,
        risk: form.value.risk!,
        suggestion: form.value.suggestion!,
        suggestedClauseText: form.value.suggestedClauseText || undefined,
    }
    emit('confirm', payload)
    emit('update:open', false)
}
```

- [ ] **Step 3: 提交**

```bash
git add app/components/assistant/contract/RiskEditDialog.vue tests/app/components/assistant/contract/RiskEditDialog.test.ts
git commit -m "feat(contract): RiskEditDialog（风险新增/编辑对话框）"
```

---

## Task 7: RiskListPanel.vue 升级（CRUD + 重生 + rebuilding 禁用）

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Modify: `tests/app/components/assistant/contract/RiskListPanel.test.ts`

### 新增功能

- 每条风险的 CardContent 底部新增：`[编辑]` / `[删除]` 两按钮（只在 `status === 'completed'` 时可点）
- 顶部或底部新增：`[+ 新增风险]` 按钮（spec §9.3 原文）
- 底部在"下载批注 Word"上方加：`[重新生成批注 Word]` 按钮
  - 只在 `edited === true`（用户本次会话内动过 risks）且 `!isRebuilding` 时 enable
  - rebuilding 态：全部编辑按钮 disable，CardContent 编辑区域显示 `<Loader2Icon class="animate-spin" /> 批注正在重新生成...`
- 交互：`[编辑]` → 打开 RiskEditDialog with 当前 risk；`[删除]` → 弹 shadcn AlertDialog 二次确认；`[+ 新增风险]` → 打开 RiskEditDialog with risk=null
- 用户确认编辑/新增/删除后：emit `editRisks(newRisks: Risk[])` 给父组件

### Props 扩展

```typescript
defineProps<{
    risks: Risk[]
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: string | null
    /** composable 的 isRebuilding；用于禁用编辑区域 */
    isRebuilding: boolean
}>()
defineEmits<{
    download: []
    rebuild: []
    editRisks: [risks: Risk[]]
}>()
```

### Step 1/2/3: 失败测试 → 实现 → 提交

- [ ] **Step 1**（增加 10+ 测试用例）
- [ ] **Step 2**（RiskListPanel 预计膨胀到 ~180 行；**若超过 200 行硬线，把 AlertDialog 二次确认 + RiskEditDialog 嵌入逻辑抽到子组件 `RiskCrudActions.vue`**）
- [ ] **Step 3**：commit `feat(contract): RiskListPanel CRUD + 重生按钮 + rebuilding 禁用`

---

## Task 8: ContractReviewPanel 整合 + 覆盖率验证

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`
- Modify: `tests/app/components/assistant/contract/ContractReviewPanel.test.ts`

### 补接线

- `RiskListPanel` 追加 `:is-rebuilding="isRebuilding"` / `@rebuild="onRebuildDocx"` / `@edit-risks="onEditRisks"`
- composable 解构增加：`onEditRisks, onRebuildDocx, isRebuilding`
- rebuilding 态 toast 提示（避免用户误操作），可用 watch `isRebuilding` 触发一次 `toast.info('批注正在重新生成...')`

### 覆盖率验证

- [ ] **Step 3: 生成覆盖率报告**

```bash
npx vitest run --coverage tests/server/assistant/contract --coverage.include='server/services/assistant/contract/**' --coverage.reporter=text
```

断言 `server/services/assistant/contract/` 行覆盖 ≥ 90%（spec §12.2）。若未达到，补测试直到过线。**必须补到过 90%**（spec 硬要求）。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue tests/app/components/assistant/contract/ContractReviewPanel.test.ts
# 可能还有 Task 2/3/4 新增的测试（为达 90% 覆盖）
git commit -m "feat(contract): Panel 串联编辑/重生事件 + 90% 覆盖率达标"
```

---

## Task 9: E2E 全路径（Playwright）

**Files:**
- Create: `tests/e2e/contract-review-full-path.spec.ts`

### 覆盖场景（spec §12.3）

1. **粘贴文本场景**：
   - 登录（复用 e2e 既有的 test-user fixture）
   - 访问 `/dashboard/assistant/contract`
   - 粘贴 1000 字借款合同样本（`prisma/seeds/contract-samples/sample-loan.docx` 的文本版本；若无文本版则硬编码在 spec 里）
   - 点"开始审查"
   - 等立场 Dialog 出现（超时 30s）
   - 填甲乙方（必要时）、选"出借人"（partyB 或 partyA 视样本而定）、点"确认"
   - 等待风险清单出现（超时 120s）
   - 点"下载批注 Word"→ 等 download event
   - 断言下载文件是有效 .docx（文件头 `PK\x03\x04`）

2. **编辑 + 重生场景**：
   - 在第 1 步结果页上，点某条 risk 的"编辑"
   - 修改 level 从 medium 到 high（suggestedClauseText 已填）
   - 确认保存
   - 点"重新生成批注 Word"→ 等 toast "批注已重生"
   - 断言又触发了一次 download event
   - 下载文件仍是有效 .docx

### 约束

- **不 mock LLM**，走完整真实 agent 路径（耗时 60–120s / 场景）
- 测试总时长 ≤ 5 min；用 `test.setTimeout(300_000)` 设置超时
- 使用 e2e 既有的 test-user / test-db 基础设施
- 若 CI 默认跳过 E2E：加 `test.describe.configure({ mode: 'serial' })` 防并发

### Step 1: 实现

- [ ] **Step 1: 参考 `tests/e2e/document-draft-workflow.spec.ts`**（M4 dev 合入时评审提到存在的 E2E spec）

### Step 2: 运行 + 提交

- [ ] **Step 2**

```bash
npx playwright test tests/e2e/contract-review-full-path.spec.ts --reporter=list
git add tests/e2e/contract-review-full-path.spec.ts
git commit -m "test(contract): M5 E2E 全路径（提交→立场→审查→编辑→重生→下载）"
```

### 退路方案（chrome-devtools MCP 已断）

原 spec §12.1 M5 行提 chrome-devtools MCP E2E，但目前该 MCP 不可用：
- 改为 Playwright E2E（本 Task 主方案）
- 若 Playwright 未装：降级为**手动验收脚本**写进 `docs/tech-docs/guides/contract-m5-manual-validation.md`，由用户本机验证，CI 用 `m5Integration.test.ts`（Task 10）兜底核心逻辑

---

## Task 10: 集成冒烟测试

**Files:**
- Create: `tests/server/assistant/contract/m5Integration.test.ts`

### 测试用例（3 条即可，方案 A：纯后端状态机驱动，仿 m4Integration）

```typescript
describe('M5 合同审查闭环', () => {
    it('PATCH risks + rebuild-docx 成功路径：状态 completed→rebuilding→completed + 新 reviewedFileId')
    it('并发 rebuild-docx：第一个请求占位后，第二个立即 429')
    it('rebuild-docx 失败（mock injectComments 抛异常）→ status 回滚 completed + 500')
})
```

- [ ] **Step 1/2: 实现 + 提交**

```bash
git add tests/server/assistant/contract/m5Integration.test.ts
git commit -m "test(contract): M5 闭环冒烟测试（PATCH + rebuild-docx 原子占位 + 回滚）"
```

---

## 全量自检清单（Plan 自我校验）

- [x] Spec §11 M5 每项（diff / PATCH / rebuild-docx / CRUD UI / E2E / 90% 覆盖率）在 Task 1-10 全归位
- [x] 未越界 M6+（列表端点 / 案件页复用 / 超时 cron / PDF 导出 / 管理端）
- [x] `.claude/rules/api.md` 新规则落地：仅用户端接口，严格 owner-only 校验
- [x] PATCH 显式拒绝 summary 字段（spec §8.3 明文）
- [x] rebuild-docx 原子占位 + 回滚成对（spec §8.4 / R5）
- [x] 90% 覆盖率验证节点（Task 8 Step 3）
- [x] 测试命令统一 `npx vitest run` + `npx playwright test`
- [x] 提交 scope 全部 `contract`（M1 已加入 `.claude/rules/git.md`）
- [x] M4 评审 I3 `ReviewWithParsedRisks` 类型在 Task 1 落地
- [x] chrome-devtools MCP 断开的退路方案（Task 9 降级）

## 实施顺序建议

0. Task 0：仅验证（不改代码）
1. Task 1：共享类型（独立，耗时短）
2. Task 2：PATCH 端点（解锁前端编辑）
3. Task 3：rebuild-docx 端点（解锁前端重生）
4. Task 4：RiskClauseDiff 字符级 diff（独立 UI 升级）
5. Task 5：composable 扩展（依赖 Task 2/3 的端点）
6. Task 6：RiskEditDialog（独立组件）
7. Task 7：RiskListPanel 升级（依赖 Task 6）
8. Task 8：Panel 接线 + 覆盖率验证
9. Task 9：E2E（依赖全部业务完成）
10. Task 10：集成冒烟

每个 Task 后运行 `npx nuxi typecheck`（允许预存的 `partyDetector.ts` 噪音）。整体完工后运行合同域 + tests/app 全量测试 + 90% 覆盖率断言通过方可合并 dev。
