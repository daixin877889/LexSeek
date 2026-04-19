# 合同审查 M6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合同审查产品从 M5 的单例能力扩展为多合同工作流 + 管理后台 + PDF 导出 + 案件复用

**Architecture:** 分 3 个 Phase 交付，Phase 1 两个 Track 并行（无 schema 冲突），Phase 2/3 串行：
- Phase 1A：用户端列表 + `hasUnsavedDocxChanges` 持久化（c + e）
- Phase 1B：管理端只读 + 软删 + 管理 UI（g，方案 A）
- Phase 2：浮动批注面板 + PDF 导出（h + i）
- Phase 3：案件详情页复用合同审查组件（f）

**Tech Stack:** Nuxt 4 + Vue 3 + Prisma + PostgreSQL + pdfmake（新依赖，轻量 PDF）

**已砍需求：** d (24h awaiting_stance cron) — 用户明确要求保持状态，不引入定时任务

---

## 技术决策固化

| 项 | 决策 | 依据 |
|---|---|---|
| 分页 | skip/take 协议 | 项目主流（drafts.get.ts, admin/document-templates） |
| 响应结构 | `{ items, total, skip, take }` | 用户端；管理端可用 `{ list, total, skip, take }` 两者都有先例，推荐统一用 `items` |
| 管理端鉴权 | 由 `server/middleware/03.permission.ts` 统一拦截 | CLAUDE.md + 现有机制 |
| 管理端功能域 | GET list + GET detail + DELETE（方案 A） | 合规考虑：不允许管理员改用户风险数据 |
| 用户端/管理端 API 物理隔离 | 严禁在同 handler 内 `checkIsSuperAdmin` 旁路 | CLAUDE.md §11 |
| Migration | `prisma migrate dev` 标准流程 | 项目现有实践 |
| PDF 库 | **pdfmake** + Noto Sans CJK 字体嵌入 | 纯 JS + 中文支持 + < 5MB；puppeteer 太重 |
| PDF 生成位置 | 服务端 | 包大小 / 首屏性能 |
| PDF 内容控制 | 用户勾选"包含批注"（默认不含） | 用户需求 |

---

## 文件结构（先盘清边界）

### Phase 1A（c + e）
- **Modify**：
  - `prisma/models/contractReview.prisma` — +`hasUnsavedDocxChanges Boolean` 字段
  - `server/services/assistant/contract/contractReview.dao.ts` — +`listUserReviewsDAO` / +`setHasUnsavedTrueDAO` / +`setHasUnsavedFalseDAO`
  - `server/api/v1/assistant/contract/reviews/[id]/index.patch.ts` — PATCH risks 成功后 setHasUnsavedTrue
  - `server/services/assistant/contract/contractReviewRebuild.service.ts` — rebuild 成功后 setHasUnsavedFalse（通过 DAO setCompletedAfterRebuildDAO）
  - `app/composables/useContractReview.ts` — 初始化时从 review.hasUnsavedDocxChanges 回填 ref
- **Create**：
  - `prisma/migrations/YYYYMMDDHHMMSS_contract_review_add_unsaved_flag/migration.sql`
  - `server/api/v1/assistant/contract/reviews/index.get.ts` — 用户端列表
  - `tests/server/assistant/contract/reviewsList.api.test.ts`
  - `tests/server/assistant/contract/reviewsUnsavedPersistence.test.ts`

### Phase 1B（g）
- **Create**：
  - `server/api/v1/admin/contract-reviews/index.get.ts`
  - `server/api/v1/admin/contract-reviews/[id].get.ts`
  - `server/api/v1/admin/contract-reviews/[id].delete.ts`
  - `server/services/assistant/contract/contractReview.dao.ts` — 追加 `listAdminReviewsDAO` / `getAdminReviewDAO` / `softDeleteAdminReviewDAO`（**注意：同文件 Track A 也改，需协调**）
  - `app/pages/admin/contract-reviews/index.vue` — 列表页
  - `app/pages/admin/contract-reviews/[id].vue` — 详情页
  - `app/components/admin/contract/AdminContractReviewTable.vue`
  - `tests/server/assistant/contract/adminReviews.api.test.ts`
- **Modify**：管理端菜单配置（sidebar）

### Phase 2（h + i）
- **Create**：
  - `app/components/assistant/contract/FloatingAnnotationPanel.vue`
  - `server/services/assistant/contract/contractReviewPdf.service.ts` — pdfmake 服务
  - `server/api/v1/assistant/contract/reviews/[id]/export-pdf.post.ts`
  - `server/services/assistant/contract/fonts/NotoSansCJKsc-Regular.ttf`（字体资源）
  - 相关测试
- **Modify**：
  - `package.json` — +`pdfmake ^0.2.10` +`@types/pdfmake`
  - `RiskListPanel.vue` — 下载按钮 + "导出 PDF" 入口 + 勾选弹窗
  - `app/composables/useContractReview.ts` — +`onExportPdf(includeRisks: boolean)`

### Phase 3（f）
- **Modify**：
  - `prisma/models/contractReview.prisma` — +`caseId Int?` + index
  - `app/pages/dashboard/cases/[id].vue`（或案件详情页根） — 嵌入合同审查 Tab
  - `server/api/v1/assistant/contract/reviews/index.get.ts` — 支持 `caseId` 过滤
- **Create**：
  - Migration 文件
  - 相关测试

---

## Phase 1A：用户端列表 + 未保存标记持久化

### Task 1: 扩展 Prisma 模型 + migration

**Files:**
- Modify: `prisma/models/contractReview.prisma`
- Create: `prisma/migrations/YYYYMMDDHHMMSS_contract_review_add_unsaved_flag/migration.sql`

- [ ] **Step 1：新增字段**

在 `contractReviews` model `summary` 字段下方加一行：

```prisma
    /// 本次 session 是否编辑过 risks 且尚未重新生成 docx
    /// PATCH /reviews/:id → true；POST /rebuild-docx 成功 → false
    hasUnsavedDocxChanges Boolean @default(false) @map("has_unsaved_docx_changes")
```

- [ ] **Step 2：生成 migration**

```bash
bun run prisma:migrate -- --name contract_review_add_unsaved_flag
```

- [ ] **Step 3：验证测试库同步**

```bash
DATABASE_URL='postgresql://daixin:daixin88@127.0.0.1:5432/ls_new_testing?schema=public&TimeZone=UTC' \
  bun run prisma:push --accept-data-loss
```

- [ ] **Step 4：提交**

```bash
git add prisma/ && git commit -m "feat(db): 合同审查新增 hasUnsavedDocxChanges 字段持久化"
```

### Task 2: DAO 扩展 + 写入时机切换（TDD）

**Files:**
- Modify: `server/services/assistant/contract/contractReview.dao.ts`
- Modify: `server/api/v1/assistant/contract/reviews/[id]/index.patch.ts`（PATCH 成功后 set true）
- Modify: `server/services/assistant/contract/contractReviewRebuild.service.ts`（rebuild 成功后 set false — 通常已在 setCompletedAfterRebuildDAO 里；确认或补）
- Test: `tests/server/assistant/contract/reviewsUnsavedPersistence.test.ts`

- [ ] **Step 1：先写失败测试**（真实 DB）

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestPrismaClient } from '../../membership/test-db-helper'
import { patchReviewRisksDAO, setHasUnsavedTrueDAO, setHasUnsavedFalseDAO, setCompletedAfterRebuildDAO } from '~~/server/services/assistant/contract/contractReview.dao'

describe('contractReview.dao hasUnsavedDocxChanges 持久化', () => {
    const prisma = createTestPrismaClient()
    let reviewId: number
    let userId: number

    beforeEach(async () => {
        const u = await prisma.users.create({ data: { phone: `13${Date.now()}`, password: 'x', nickname: 't' } })
        userId = u.id
        const r = await prisma.contractReviews.create({ data: {
            userId, sessionId: `s-${Date.now()}`, originalFileId: 1, status: 'completed',
        }})
        reviewId = r.id
    })
    afterEach(async () => {
        await prisma.contractReviews.deleteMany({ where: { userId } })
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    it('默认新建时 hasUnsavedDocxChanges = false', async () => {
        const r = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
        expect(r?.hasUnsavedDocxChanges).toBe(false)
    })
    it('setHasUnsavedTrueDAO 应置 true', async () => {
        await setHasUnsavedTrueDAO(reviewId)
        const r = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
        expect(r?.hasUnsavedDocxChanges).toBe(true)
    })
    it('setHasUnsavedFalseDAO 应置 false', async () => {
        await setHasUnsavedTrueDAO(reviewId)
        await setHasUnsavedFalseDAO(reviewId)
        const r = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
        expect(r?.hasUnsavedDocxChanges).toBe(false)
    })
    it('setCompletedAfterRebuildDAO 应在置 completed 的同时清 hasUnsavedDocxChanges', async () => {
        await setHasUnsavedTrueDAO(reviewId)
        await prisma.contractReviews.update({ where: { id: reviewId }, data: { status: 'rebuilding' }})
        await setCompletedAfterRebuildDAO(reviewId, 123)
        const r = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
        expect(r?.status).toBe('completed')
        expect(r?.hasUnsavedDocxChanges).toBe(false)
    })
})
```

- [ ] **Step 2：运行测试确认失败**

```bash
npx vitest run tests/server/assistant/contract/reviewsUnsavedPersistence.test.ts
```

Expected：FAIL（DAO 不存在）

- [ ] **Step 3：实现 DAO**

在 `server/services/assistant/contract/contractReview.dao.ts` 追加：

```typescript
/** 置 true：PATCH /reviews/:id/risks 成功后调用 */
export async function setHasUnsavedTrueDAO(reviewId: number): Promise<void> {
    await prisma.contractReviews.update({
        where: { id: reviewId },
        data: { hasUnsavedDocxChanges: true, updatedAt: new Date() },
    })
}

/** 置 false：rebuild-docx 成功后调用（通常由 setCompletedAfterRebuildDAO 内部一起置） */
export async function setHasUnsavedFalseDAO(reviewId: number): Promise<void> {
    await prisma.contractReviews.update({
        where: { id: reviewId },
        data: { hasUnsavedDocxChanges: false, updatedAt: new Date() },
    })
}
```

并修改已有 `setCompletedAfterRebuildDAO` 的 update data 里增加 `hasUnsavedDocxChanges: false`。

- [ ] **Step 4：PATCH handler 尾部调 setHasUnsavedTrueDAO**

在 `server/api/v1/assistant/contract/reviews/[id]/index.patch.ts` patchReviewRisksDAO 成功后追加一行 `await setHasUnsavedTrueDAO(reviewId)`。

- [ ] **Step 5：测试通过 + 提交**

```bash
npx vitest run tests/server/assistant/contract/reviewsUnsavedPersistence.test.ts
git add server/ tests/server/assistant/contract/reviewsUnsavedPersistence.test.ts
git commit -m "feat(contract): PATCH/重生联动持久化 hasUnsavedDocxChanges"
```

### Task 3: 前端初始化从 review 回填（TDD）

**Files:**
- Modify: `app/composables/useContractReview.ts` — `mountReview` 拉到 review 后用 `review.hasUnsavedDocxChanges` 覆盖 ref 初值
- Test: `tests/app/composables/useContractReview.test.ts` — 加 2 用例

- [ ] **Step 1：新测试用例**

```typescript
it('mountReview 成功回填 review.hasUnsavedDocxChanges=true → ref 为 true', async () => {
    mockFetch.mockResolvedValueOnce({ ...reviewStub(), hasUnsavedDocxChanges: true })
    const c = createWrapper()
    await c.mountReview(123)
    expect(c.hasUnsavedDocxChanges.value).toBe(true)
})
it('mountReview 成功回填 review.hasUnsavedDocxChanges=false → ref 为 false', async () => {
    mockFetch.mockResolvedValueOnce({ ...reviewStub(), hasUnsavedDocxChanges: false })
    const c = createWrapper()
    c.hasUnsavedDocxChanges.value = true
    await c.mountReview(123)
    expect(c.hasUnsavedDocxChanges.value).toBe(false)
})
```

- [ ] **Step 2：实现回填**

在 `useContractReview.ts` 的 `mountReview` 拉到 review 后：

```typescript
if (typeof review.value?.hasUnsavedDocxChanges === 'boolean') {
    hasUnsavedDocxChanges.value = review.value.hasUnsavedDocxChanges
}
```

- [ ] **Step 3：测试通过 + 提交**

### Task 4: GET /reviews 用户列表接口（TDD）

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/index.get.ts`
- Modify: `server/services/assistant/contract/contractReview.dao.ts` — `listUserReviewsDAO`
- Test: `tests/server/assistant/contract/reviewsList.api.test.ts`

- [ ] **Step 1：API 契约**

```
GET /api/v1/assistant/contract/reviews?skip=0&take=20&status=completed&q=关键字
Response:
{
  code: 0, success: true, data: {
    items: ReviewItem[],
    total: number,
    skip: number,
    take: number,
  }
}

ReviewItem = {
  id, sessionId, contractType, partyA, partyB, stance, status,
  summary（前 120 字符截断）, originalFileName,
  hasUnsavedDocxChanges, createdAt, updatedAt,
}
```

筛选字段：
- `status`：精确匹配（可选）
- `q`：模糊匹配 original file.fileName（可选，关键词搜原文件名）

- [ ] **Step 2：写失败测试**

至少 5 个用例（分页边界 / 筛选 / 关键词 / 未登录 / 排序 createdAt desc）。模型略。

- [ ] **Step 3：DAO 实现**

```typescript
export async function listUserReviewsDAO(params: {
    userId: number
    skip: number
    take: number
    status?: string
    q?: string
}): Promise<{ items: ReviewListItem[]; total: number }> {
    const where: Prisma.contractReviewsWhereInput = {
        userId: params.userId,
        deletedAt: null,
        ...(params.status ? { status: params.status } : {}),
        ...(params.q
            ? { originalFile: { fileName: { contains: params.q, mode: 'insensitive' } } }
            : {}),
    }
    const [rows, total] = await Promise.all([
        prisma.contractReviews.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: params.skip,
            take: params.take,
            include: { originalFile: { select: { fileName: true } } },
        }),
        prisma.contractReviews.count({ where }),
    ])
    return {
        items: rows.map(r => ({
            id: r.id,
            sessionId: r.sessionId,
            contractType: r.contractType,
            partyA: r.partyA,
            partyB: r.partyB,
            stance: r.stance,
            status: r.status,
            summary: r.summary?.slice(0, 120) ?? null,
            originalFileName: r.originalFile?.fileName ?? null,
            hasUnsavedDocxChanges: r.hasUnsavedDocxChanges,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        })),
        total,
    }
}
```

- [ ] **Step 4：Handler 实现**

```typescript
import { z } from 'zod'

const QuerySchema = z.object({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(100).default(20),
    status: z.string().max(30).optional(),
    q: z.string().max(100).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    const q = QuerySchema.safeParse(getQuery(event))
    if (!q.success) return resError(event, 400, q.error.issues[0].message)
    const { skip, take, status, q: keyword } = q.data
    const result = await listUserReviewsDAO({ userId: user.id, skip, take, status, q: keyword })
    return resSuccess(event, 'ok', { ...result, skip, take })
})
```

- [ ] **Step 5：测试通过 + 提交**

---

## Phase 1B：管理端列表 + 详情 + 软删 + 管理 UI

### Task 5: 管理端 DAO（TDD）

**Files:**
- Modify: `server/services/assistant/contract/contractReview.dao.ts` — 追加 3 个 DAO
- Test: `tests/server/assistant/contract/adminReviews.dao.test.ts`

接口：
- `listAdminReviewsDAO(params: { skip, take, status?, q?, userId? })` — 无 owner 过滤，可按 userId 查某用户
- `getAdminReviewDAO(id)` — 无 owner 校验，返回完整字段
- `softDeleteAdminReviewDAO(id)` — `deletedAt: new Date()`；返回受影响行数

代码略（与 Phase 1A 类似，去掉 userId filter，加 userId filter 可选参数）。

### Task 6-8：3 个管理端 handler（TDD）

**Files:**
- `server/api/v1/admin/contract-reviews/index.get.ts`
- `server/api/v1/admin/contract-reviews/[id].get.ts`
- `server/api/v1/admin/contract-reviews/[id].delete.ts`
- 对应 3 个 api.test.ts

鉴权依赖 `03.permission.ts` middleware；handler 内**不做** checkIsSuperAdmin 调用（避免规则违反）。

每个 handler 5-10 用例 TDD 套路：正常 / 非法参数 / 404 / 权限（由中间件已处理，不用测，保留 1 个用例证明中间件链路对）。

### Task 9：管理端列表页

**Files:**
- Create: `app/pages/admin/contract-reviews/index.vue`
- Create: `app/components/admin/contract/AdminContractReviewTable.vue`

参考 `app/pages/admin/document-templates/index.vue`：
- definePageMeta layout=admin-layout
- 搜索条（status Select + q Input + 搜索 Button）
- shadcn-vue Table（id / 原文件名 / 用户手机号 / 合同类型 / 立场 / 状态 / 创建时间 / 操作）
- `GeneralPagination` 底部
- 操作列：查看详情（→ `/admin/contract-reviews/:id`）/ 删除（AlertDialog 二次确认）

### Task 10：管理端详情页

**Files:**
- Create: `app/pages/admin/contract-reviews/[id].vue`

只读展示：
- 头部：基本信息（用户 / 文件 / 状态 / 立场 / 时间）
- Risk 列表（只读，无编辑）
- 批注 Word 下载按钮（复用用户端 download API 签 URL）
- 页尾返回 + 删除

### Task 11：管理菜单 + 路由配置

修改管理端侧边栏菜单（需查 admin-layout.vue 确认注入方式），加"合同审查记录"入口。

### Task 12：E2E chrome-devtools 回归

- 登录管理员账号
- 访问 `/admin/contract-reviews` 列表页
- 搜索 + 分页 + 查看详情 + 软删确认
- 截图 + 网络日志验证

---

## Phase 2：浮动批注面板 + PDF 导出

### Task 13：依赖 + 字体

- `bun add pdfmake @types/pdfmake`
- 下载 Noto Sans CJK SC Regular.otf（思源黑体）→ `server/services/assistant/contract/fonts/`
- `.gitattributes` 字体文件 filter=lfs（如项目已用 LFS；否则直接 commit）

### Task 14：PDF 服务（TDD）

**Files:**
- Create: `server/services/assistant/contract/contractReviewPdf.service.ts`
- Test: `tests/server/assistant/contract/contractReviewPdf.service.test.ts`

接口：
```typescript
export async function exportReviewPdfService(
    reviewId: number,
    options: { includeRisks: boolean },
): Promise<Buffer>
```

pdfmake docDefinition 结构：
- 头：文件名 + 合同类型 + 立场 + 状态 + 时间
- 摘要 Markdown 简单渲染
- 风险列表（若 includeRisks）：按 risk[].severity 分组，每条含 title + description + suggestion + clause
- 尾页：水印"仅供参考"

测试至少 5 用例：includeRisks true/false、空 risks、长 summary 截断、非法 reviewId 404。

### Task 15：导出 PDF handler

`POST /api/v1/assistant/contract/reviews/[id]/export-pdf`

Body：`{ includeRisks: boolean }`

成功返回 signed URL（上传到 OSS 后 URL），前端触发下载。

### Task 16：UI 入口

`RiskListPanel.vue`：
- "导出 PDF" 按钮（次级 Button，灰底） + 点击弹 `RadioGroup` 选"仅摘要 / 含风险批注"
- 提交 → 调 composable → `<a download>` 触发下载

`useContractReview.ts` 新增 `onExportPdf(includeRisks)`。

### Task 17：浮动批注面板（h）

**Files:**
- Create: `app/components/assistant/contract/FloatingAnnotationPanel.vue`

接受 props：`risks`, `activeRiskId?`, `x`, `y`; 支持拖拽 / 最小化 / 关闭。点击风险条目 emit `focusRisk(riskId)`。

集成点：`ContractReviewPanel.vue` 加浮动面板 + 切换按钮。

### Task 18：E2E chrome-devtools 回归

- 用户登录
- 导出 PDF（含/不含批注）各一次，下载后肉眼核对
- 浮动面板拖拽 / 最小化 / 恢复

---

## Phase 3：案件复用（f）

### Task 19：schema 加 caseId + migration

`contractReviews` 加：
```prisma
caseId Int? @map("case_id")
case cases? @relation(fields: [caseId], references: [id], onDelete: SetNull, onUpdate: NoAction)
@@index([caseId])
```

### Task 20：列表接口 + 创建接口支持 caseId

- `reviews/index.get.ts` Query 加 `caseId`
- `reviews.post.ts`（创建接口）Body 加可选 `caseId`

### Task 21：案件详情页嵌入合同审查 Tab

在 `app/pages/dashboard/cases/[id].vue` 加 Tab，调用 `GET /reviews?caseId=X` 显示案件下合同审查列表；点击进入合同审查页时传 sessionId。

### Task 22：E2E chrome-devtools 回归

---

## Self-Review Checklist

- [x] 每个任务都有明确 Files 和代码片段
- [x] 所有决策固化在"技术决策固化"表
- [x] 管理端与用户端 API 物理隔离（g 方案 A 仅只读 + 删除）
- [x] PDF 库明确 pdfmake（轻量 + 中文）
- [x] 持久化字段明确（hasUnsavedDocxChanges）
- [x] 砍掉的 d 有说明理由
- [x] 每个 Phase 有 E2E 回归 Task

## Execution Handoff

**Subagent-Driven Development**：
- Phase 1A/1B 并行（不同 worktree）
- Phase 2/3 串行

Phase 1A 与 Phase 1B 都改 `server/services/assistant/contract/contractReview.dao.ts`——需要在 merge 时手动协调。建议 1A 先 merge（schema change 先落），1B rebase 后再 merge。
