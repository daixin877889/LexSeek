# 合同审查 · 多版本协作 Phase A 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建合同审查多版本的数据地基，让律师能做 "首次上传 → AI 审查 → 处置/加批注 → 手动保存版本 → 切换查看历史版本（只读）" 的基础闭环。

**Architecture:** 对齐项目内已验证的文书生成版本模式——主表（`ContractReview`）承载工作区实时状态，新增 `ContractReviewVersion` 表保存不可变快照；原 `ContractReview.risks` JSON 拆分到 `ContractRisk` 表，新增 `ContractAnnotation` 表承载对话气泡。前端按 `useDocumentDraft` 模式实现 `useContractReviewVersion` composable，批注文本编辑走 debounce PATCH，处置/新增/删除等离散动作直接 PATCH；新增时间线组件 + 保存版本对话框（只读横幅和时间线节点合并到主组件内联渲染）。

**Phase A 字段范围（渐进原则）：** 三张新表仅声明 Phase A 真正使用的字段；Phase B 特有字段（`wordCommentRef` / `removedByClient` / `suppressInExport` / `originalAnchorQuote` / `orphaned` / `docxFileId` / `paragraphs` 等）通过 Phase B 独立迁移 `ALTER TABLE ADD COLUMN` 追加，避免 Phase A 塞入永不写入的列。

**关键基建复用铁律：**
- 所有新增 API handler **必须**使用 `resSuccess(event, '操作成功', data)` / `resError(event, code, '错误')` 签名（api.md 硬性规则）
- 所有新增 API handler **必须**通过 `reviewGuard.ts` 的 guard 家族完成 owner 校验；不允许手写 `prisma.contractReviews.findUnique + userId !== user.id`
- 律师删自己批注 = **软删**（`deletedAt` 字段）；数据库层不出现物理 DELETE，满足"批注永不丢失"铁律
- 路由路径遵循 `.claude/rules/api.md`：**动态参数必须在文件名末尾，不能放目录中间**

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Prisma + PostgreSQL + shadcn-vue + Tailwind v4 + Vitest + Bun

**Spec:** `docs/superpowers/specs/2026-04-22-contract-review-versioning-design.md`

**Phase 边界：**
- Phase A（本 Plan）：数据地基 + 首次上传 → v1 initial_upload + 工作区实时编辑 + 手动保存 v2 lawyer_save + 切换历史版本只读查看
- Phase B（独立 Plan）：上传新版本 → 自动备份 + 客户批注识别 + AI 增量审查 + 锚点迁移 + 客户已移除
- Phase C（独立 Plan）：对比抽屉 + 外部新增分组 UI + 全局复核条目显示 + 细节打磨

**工期：** 5 天（子期 1-2 数据地基+DAO+API = 2 天 · 子期 3-4 前端 composable+UI = 2 天 · 子期 5 集成联调 = 1 天）

---

## 文件清单

### 新建

**数据与类型**
- `prisma/models/contractRiskAndAnnotation.prisma` — ContractRisk + ContractAnnotation 模型
- `prisma/models/contractReviewVersion.prisma` — ContractReviewVersion 模型
- `prisma/migrations/<ts>_contract_review_versioning/migration.sql` — 迁移（含 enum、外键、索引）

**后端 DAO/Service**
- `server/services/assistant/contract/contractRisk.dao.ts` — Risk CRUD
- `server/services/assistant/contract/contractRisk.service.ts` — Risk 业务层（接收 review 对象，不再依赖不存在的 `getContractReviewOwnerIdDAO`）
- `server/services/assistant/contract/contractAnnotation.dao.ts` — Annotation CRUD（含软删）
- `server/services/assistant/contract/contractAnnotation.service.ts` — Annotation 业务层
- `server/services/assistant/contract/contractReviewVersion.dao.ts` — Version CRUD
- `server/services/assistant/contract/contractReviewVersion.service.ts` — 快照产生/读取
- `server/services/assistant/contract/contractReviewMigrate.service.ts` — 存量 risks JSON 迁移工具

**后端 API**（路径参数都在文件末尾，合规 api.md）
- `server/api/v1/assistant/contract/reviews/[id]/versions.get.ts` — 版本列表（:id = reviewId）
- `server/api/v1/assistant/contract/reviews/[id]/versions.post.ts` — 手动保存新版本（:id = reviewId）
- `server/api/v1/assistant/contract/reviews/versions/[versionId].get.ts` — 版本快照
- `server/api/v1/assistant/contract/reviews/versions/[versionId].patch.ts` — 更新备注
- `server/api/v1/assistant/contract/reviews/risks/[riskId].patch.ts` — 处置风险
- `server/api/v1/assistant/contract/reviews/[id]/annotations.post.ts` — 新增批注（:id = reviewId）
- `server/api/v1/assistant/contract/reviews/annotations/[annotationId].patch.ts` — 修改批注
- `server/api/v1/assistant/contract/reviews/annotations/[annotationId].delete.ts` — 软删批注

> 注：`reviews/[id]/xxx.*.ts` 这种 [id] 在倒数第二层是项目已有模式（如 `reviews/[id]/rebuild-docx.post.ts`），合规；违规模式是"多层嵌套动态参数"（如 `reviews/[id]/versions/[versionId]/**`）。

**后端 Guard 扩展**
- 修改 `server/services/assistant/contract/reviewGuard.ts`：新增 `loadOwnedReviewByVersionId` / `loadOwnedReviewByRiskId` / `loadOwnedReviewByAnnotationId` 三个辅助，供单资源端点使用

**前端 Composable**
- `app/composables/useContractReviewVersion.ts` — 版本与快照管理（批注 content 编辑走 debounce，其他离散动作直连）

**前端 UI**
- `app/components/assistant/contract/ContractVersionTimeline.vue` — 时间线（收缩/展开两态 + 节点渲染内联，不再拆 NodeItem 组件）
- `app/components/assistant/contract/ContractSaveVersionDialog.vue` — 保存对话框
- 只读横幅直接内联到 `ContractReviewPanel.vue` 模板里（不单独拆文件）

**测试**
- `tests/server/assistant/contract/contractRisk.dao.test.ts`
- `tests/server/assistant/contract/contractAnnotation.dao.test.ts`
- `tests/server/assistant/contract/contractReviewVersion.service.test.ts`
- `tests/server/assistant/contract/contractReviewMigrate.service.test.ts`
- `tests/server/assistant/contract/reviews.versions.api.test.ts`
- `tests/app/composables/useContractReviewVersion.test.ts`

### 修改

- `prisma/models/contractReview.prisma` — 扩展字段（`currentVersionId`, `maxVersionNo`）
- `shared/types/contract.ts` — 新增 `ContractReviewVersion` / `ContractRisk` / `ContractAnnotation` / `RiskSource` / `AnnotationAuthorType` / `VersionSystemLabel` 等类型
- `server/services/assistant/contract/contractReview.dao.ts` — `getReviewByIdDAO` 联查新子表
- `server/api/v1/assistant/contract/reviews/[id].get.ts` — 返回结构接入新表数据
- `server/services/workflow/agents/contractReviewMainAgent.ts` — AI 审查完成后写入 `ContractRisk` + `ContractAnnotation` + 创建 v1 initial_upload 快照
- 现有导出 docx 的 handler（路径见 Task 4.3）— **文件名加版本号后缀**：`{合同名}_{v版本号 / '工作区'}_{日期}.docx`（Phase A 承诺，必须落地）
- `server/services/assistant/contract/reviewGuard.ts` — 新增 3 个子资源 guard（见 Task 2.0）
- `app/components/assistant/contract/ContractReviewPanel.vue` — 集成时间线、读写状态切换、保存按钮、只读横幅内联
- `app/components/assistant/contract/RiskListPanel.vue` — 展示 annotation 对话线 + 已处置风险降权样式（spec §7.4.1）

---

# 子期 1 · 数据地基（Day 1）

## Task 1.1: Prisma schema + 迁移

**Files:**
- Create: `prisma/models/contractReviewVersion.prisma`
- Create: `prisma/models/contractRiskAndAnnotation.prisma`
- Modify: `prisma/models/contractReview.prisma`
- Create: `prisma/migrations/<ts>_contract_review_versioning/migration.sql`

- [ ] **Step 1: 扩展 `contractReview` 模型**

在 `prisma/models/contractReview.prisma` 里追加两个字段（其余字段不动）：

```prisma
model contractReviews {
  // ... 现有字段 ...

  /// 当前工作区基于哪个快照版本
  currentVersionId Int? @map("current_version_id")
  /// 已产生的版本号上限（每次 snapshot 原子 +1）
  maxVersionNo     Int  @default(0) @map("max_version_no")

  /// 反向关系
  versions    contractReviewVersions[]
  risks2      contractRisks[]
  annotations contractAnnotations[]

  @@index([currentVersionId])
}
```

> 注：原 `risks Json` 字段暂时保留（迁移完成后由 Task 4.2 数据迁移脚本清空）；Phase A 末尾数据迁移完成后再在单独 PR 里 Drop 此字段。

- [ ] **Step 2: 新建 `contractReviewVersions` 模型（Phase A 字段）**

Phase B 新增的 `docxFileId`（`client_return` 版本绑定上传文件）在 Phase B 自己的迁移里追加。

创建 `prisma/models/contractReviewVersion.prisma`：

```prisma
/// 合同审查历史版本快照（不可变）
model contractReviewVersions {
  id            Int      @id @default(autoincrement())
  reviewId      Int      @map("review_id")
  versionNumber Int      @map("version_number")
  /// 系统标签：Phase A 仅 initial_upload / lawyer_save；Phase B 扩展 client_return / auto_backup
  systemLabel   String   @map("system_label") @db.VarChar(20)
  /// 律师备注（可选）
  lawyerNote    String?  @map("lawyer_note") @db.Text
  /// 完整快照 { risks[], annotations[], docxText }；Phase B 扩展 paragraphs
  snapshotData  Json     @map("snapshot_data")
  createdById   Int      @map("created_by_id")
  createdAt     DateTime @default(now()) @map("created_at")

  review    contractReviews @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  createdBy users           @relation(fields: [createdById], references: [id])

  @@unique([reviewId, versionNumber], map: "uk_contract_review_version_number")
  @@index([reviewId, createdAt(sort: Desc)])
  @@map("contract_review_versions")
}
```

- [ ] **Step 3: 新建 `contractRisks` 与 `contractAnnotations` 模型（Phase A 字段）**

**字段渐进原则**：Phase B 特有字段（`wordCommentRef` / `removedByClient` / `suppressInExport` / `originalAnchorQuote` / `orphaned`）**不在本 Phase A 迁移**里；Phase B 前单独写迁移 `ALTER TABLE ADD COLUMN`。

创建 `prisma/models/contractRiskAndAnnotation.prisma`：

```prisma
/// 合同审查风险（工作区实时态）
model contractRisks {
  id         Int    @id @default(autoincrement())
  reviewId   Int    @map("review_id")
  /// 来源：Phase A 仅 ai；Phase B 扩展 external_new；Phase C 扩展 global_review
  source     String @db.VarChar(20)
  /// playbook code（仅 source=ai 有值）
  code       String? @db.VarChar(30)
  category   String  @db.VarChar(50)
  /// 风险等级：high / medium / low
  level      String  @db.VarChar(10)
  /// 立场偏好：strict / balanced / lenient
  stance     String  @default("balanced") @db.VarChar(10)
  problem    String  @db.Text
  legalBasis String? @map("legal_basis") @db.Text
  analysis   String? @db.Text
  suggestion String? @db.Text

  /// 处置状态：Phase A 仅 handled / ignored；Phase B 扩展 client_removed
  archivedStatus String?   @map("archived_status") @db.VarChar(20)
  archivedAt     DateTime? @map("archived_at")

  /// 当前锚点原文
  anchorQuote          String  @map("anchor_quote") @db.Text
  anchorParagraphIndex Int?    @map("anchor_paragraph_index")
  anchorCharStart      Int?    @map("anchor_char_start")
  anchorCharEnd        Int?    @map("anchor_char_end")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  review      contractReviews       @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  annotations contractAnnotations[]

  @@index([reviewId, source])
  @@index([reviewId, archivedStatus])
  @@map("contract_risks")
}

/// 合同审查批注（对话气泡单元）
/// 决策 11 铁律：批注永不物理删除。律师删自己批注走软删（deletedAt）。
model contractAnnotations {
  id                 Int     @id @default(autoincrement())
  reviewId           Int     @map("review_id")
  riskId             Int     @map("risk_id")
  /// 承载对话线父子关系（Phase A 只在 AI→律师回复链使用；Phase B 对齐 Word reply）
  parentAnnotationId Int?    @map("parent_annotation_id")
  /// 作者类型：Phase A 仅 ai / lawyer；Phase B 扩展 external
  authorType         String  @map("author_type") @db.VarChar(10)
  /// 展示名（AI=固定 "AI" / lawyer=律师姓名）
  authorName         String  @map("author_name") @db.VarChar(100)
  /// 律师批注才有
  authorUserId       Int?    @map("author_user_id")
  content            String  @db.Text
  /// 软删时间（律师删自己批注时填）；不为 null 时在工作区与 snapshot 中均不显示
  deletedAt          DateTime? @map("deleted_at")

  createdAt DateTime @default(now()) @map("created_at")

  review           contractReviews       @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  risk             contractRisks         @relation(fields: [riskId], references: [id], onDelete: Cascade)
  parentAnnotation contractAnnotations?  @relation("AnnotationReply", fields: [parentAnnotationId], references: [id])
  replies          contractAnnotations[] @relation("AnnotationReply")
  authorUser       users?                @relation(fields: [authorUserId], references: [id])

  @@index([riskId, createdAt])
  @@map("contract_annotations")
}
```

- [ ] **Step 4: 生成并审阅迁移 SQL**

运行：

```bash
bun run prisma:migrate --name contract_review_versioning --create-only
```

打开 `prisma/migrations/<ts>_contract_review_versioning/migration.sql`，确认：
- `ALTER TABLE contract_reviews ADD COLUMN current_version_id INT NULL`
- `ALTER TABLE contract_reviews ADD COLUMN max_version_no INT NOT NULL DEFAULT 0`
- 三张新表的 `CREATE TABLE` 语句齐全
- 所有索引、外键正确

如 SQL 有破坏性操作（如误 DROP `risks` 字段），手工修订 —— Phase A 里原 `risks` JSON 字段**保留**，不允许 Prisma 自动 DROP。

- [ ] **Step 5: 应用迁移到本地 + 测试库**

测试库**不允许**使用 `prisma:push --accept-data-loss`（违反 `.claude/rules/database.md`）。通过 `prisma migrate deploy` 应用刚生成的迁移：

```bash
# 本地开发库（已在 Step 4 应用过；仅未 apply 时跑）
bun run prisma:migrate

# 测试库（应用当前仓库中的所有迁移）
DATABASE_URL='postgres://...ls_new_testing...' bun run prisma:deploy
```

> `prisma:deploy` 映射到 `prisma migrate deploy`，与生产部署同款，不会误触发 data loss 交互提示。

- [ ] **Step 6: 验证 `bun run prisma:generate` 后类型更新**

```bash
bun run prisma:generate
npx nuxi typecheck
```

应全绿。

- [ ] **Step 7: Commit**

```bash
git add prisma/models/contractReviewVersion.prisma prisma/models/contractRiskAndAnnotation.prisma prisma/models/contractReview.prisma prisma/migrations/<ts>_contract_review_versioning/
git commit -m "feat(contract): 新增多版本数据模型 — Version/Risk/Annotation 三表"
```

---

## Task 1.2: Shared 类型定义

**Files:**
- Modify: `shared/types/contract.ts`

- [ ] **Step 1: 在 `shared/types/contract.ts` 追加类型**

```ts
// ===== 多版本：枚举 =====
// Phase A 只声明当前用到的值；Phase B/C 扩展时再加
export const VERSION_SYSTEM_LABELS = ['initial_upload', 'lawyer_save'] as const
export type VersionSystemLabel = typeof VERSION_SYSTEM_LABELS[number]

export const VERSION_SYSTEM_LABEL_DISPLAY: Record<VersionSystemLabel, string> = {
  initial_upload: '初次上传',
  lawyer_save: '律师保存',
  // Phase B 加：client_return: '客户回传', auto_backup: '自动备份'
}

export const RISK_SOURCES = ['ai'] as const  // Phase B 加 'external_new'；Phase C 加 'global_review'
export type RiskSource = typeof RISK_SOURCES[number]

export const ANNOTATION_AUTHOR_TYPES = ['ai', 'lawyer'] as const  // Phase B 加 'external'
export type AnnotationAuthorType = typeof ANNOTATION_AUTHOR_TYPES[number]

export const RISK_ARCHIVED_STATUSES = ['handled', 'ignored'] as const  // Phase B 加 'client_removed'
export type RiskArchivedStatus = typeof RISK_ARCHIVED_STATUSES[number]

// ===== 多版本：实体 =====
export interface ContractRiskEntity {
  id: number
  reviewId: number
  source: RiskSource
  code: string | null
  category: string
  level: RiskLevel
  stance: StancePreference
  problem: string
  legalBasis: string | null
  analysis: string | null
  suggestion: string | null
  archivedStatus: RiskArchivedStatus | null
  archivedAt: string | null
  anchorQuote: string
  anchorParagraphIndex: number | null
  anchorCharStart: number | null
  anchorCharEnd: number | null
  createdAt: string
  updatedAt: string
}

export interface ContractAnnotationEntity {
  id: number
  reviewId: number
  riskId: number
  parentAnnotationId: number | null
  authorType: AnnotationAuthorType
  authorName: string
  authorUserId: number | null
  content: string
  createdAt: string
  // 软删的批注不出现在 API 响应中（service 层过滤 deletedAt IS NULL）
}

export interface ContractReviewVersionEntity {
  id: number
  reviewId: number
  versionNumber: number
  systemLabel: VersionSystemLabel
  lawyerNote: string | null
  createdById: number
  createdByName: string
  createdAt: string
  // Phase B 再加 stats（变更徽章用）
}

/** 版本列表响应（不含 snapshotData，只有元信息） */
export interface ContractReviewVersionListResponse {
  versions: ContractReviewVersionEntity[]
  currentVersionId: number | null
  maxVersionNo: number
}

/** 版本快照响应（包含完整 snapshot 内容用于只读渲染） */
export interface ContractReviewVersionSnapshotResponse extends ContractReviewVersionEntity {
  snapshot: {
    risks: ContractRiskEntity[]
    annotations: ContractAnnotationEntity[]
    docxText: string
    // Phase B 扩展 paragraphs
  }
}
```

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

应全绿（此时只是类型加了，无 runtime 代码）。

- [ ] **Step 3: Commit**

```bash
git add shared/types/contract.ts
git commit -m "feat(contract): 新增版本/风险/批注实体类型定义"
```

---

# 子期 2 · 后端 DAO/Service（Day 1-2）

## Task 2.0: reviewGuard 扩展（子资源 guard）

**Files:**
- Modify: `server/services/assistant/contract/reviewGuard.ts`

- [ ] **Step 1: 新增 3 个子资源 guard**

在现有 `loadOwnedReview` 旁边追加（复用现有 404/403 分支语义）：

```ts
import type { H3Event } from 'h3'

// 通用内部：从任意子资源 id 反查 review 并做 owner 校验
type ReviewLookup = (subId: number) => Promise<{ reviewId: number } | null>

async function loadOwnedReviewFromSubResource(
    event: H3Event,
    paramName: string,
    lookup: ReviewLookup,
    options: LoadOptions = {},
): Promise<ReviewGuardResult> {
    const user = event.context.auth?.user as AuthUser | undefined
    if (!user) return { ok: false, status: 401, message: '请先登录' }

    const subId = Number(getRouterParam(event, paramName))
    if (!Number.isInteger(subId) || subId <= 0) {
        return { ok: false, status: 400, message: `${paramName} 无效` }
    }

    const sub = await lookup(subId)
    if (!sub) return { ok: false, status: 404, message: '资源不存在' }

    const review = await getContractReviewDAO(sub.reviewId)
    if (!review) return { ok: false, status: 404, message: '合同审查不存在' }
    if (review.userId !== user.id) {
        return { ok: false, status: 403, message: `无权${options.actionLabel ?? '访问该合同审查'}` }
    }

    return { ok: true, user, review }
}

export async function loadOwnedReviewByVersionId(event: H3Event, options: LoadOptions = {}) {
    return loadOwnedReviewFromSubResource(event, 'versionId', async (id) => {
        const v = await prisma.contractReviewVersions.findUnique({
            where: { id },
            select: { reviewId: true },
        })
        return v
    }, options)
}

export async function loadOwnedReviewByRiskId(event: H3Event, options: LoadOptions = {}) {
    return loadOwnedReviewFromSubResource(event, 'riskId', async (id) => {
        const r = await prisma.contractRisks.findUnique({
            where: { id },
            select: { reviewId: true },
        })
        return r
    }, options)
}

export async function loadOwnedReviewByAnnotationId(event: H3Event, options: LoadOptions = {}) {
    return loadOwnedReviewFromSubResource(event, 'annotationId', async (id) => {
        const a = await prisma.contractAnnotations.findUnique({
            where: { id },
            select: { reviewId: true, authorUserId: true },
        })
        return a
    }, options)
}
```

> `loadOwnedReviewByAnnotationId` 的 lookup 多查一个 `authorUserId`，因为 PATCH/DELETE 批注时 handler 还需要校验"只能改自己的"。service 层基于 `review + annotation` 判断。

- [ ] **Step 2: Commit**

```bash
git add server/services/assistant/contract/reviewGuard.ts
git commit -m "feat(contract): reviewGuard 扩展 version/risk/annotation 子资源 guard"
```

---

## Task 2.1: ContractRisk DAO

**Files:**
- Create: `server/services/assistant/contract/contractRisk.dao.ts`
- Create: `tests/server/assistant/contract/contractRisk.dao.test.ts`

- [ ] **Step 1: 先写测试（TDD）**

`tests/server/assistant/contract/contractRisk.dao.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createContractRiskDAO,
  updateContractRiskDAO,
  listContractRisksDAO,
  getContractRiskByIdDAO,
} from '~/server/services/assistant/contract/contractRisk.dao'

describe('contractRisk.dao', () => {
  let reviewId: number

  beforeEach(async () => {
    // 创建测试用 review（用测试工具函数，或内联）
    const review = await prisma.contractReviews.create({
      data: { title: 'test', userId: 1, status: 'completed', risks: [] },
    })
    reviewId = review.id
  })

  afterEach(async () => {
    await prisma.contractReviews.delete({ where: { id: reviewId } })
  })

  it('create 能成功写入', async () => {
    const risk = await createContractRiskDAO({
      reviewId,
      source: 'ai',
      code: 'probation',
      category: '试用期',
      level: 'high',
      stance: 'balanced',
      problem: '超长试用期',
      anchorQuote: '试用期 6 个月',
    })
    expect(risk.id).toBeGreaterThan(0)
    expect(risk.source).toBe('ai')
  })

  it('update archivedStatus 生效', async () => {
    const risk = await createContractRiskDAO({ reviewId, source: 'ai', category: 'x', level: 'high', stance: 'balanced', problem: 'x', anchorQuote: 'x' })
    const updated = await updateContractRiskDAO(risk.id, { archivedStatus: 'handled' })
    expect(updated.archivedStatus).toBe('handled')
    expect(updated.archivedAt).not.toBeNull()
  })

  it('list 按 reviewId 查询', async () => {
    await createContractRiskDAO({ reviewId, source: 'ai', category: 'x', level: 'high', stance: 'balanced', problem: 'x', anchorQuote: 'x' })
    const list = await listContractRisksDAO(reviewId)
    expect(list.length).toBeGreaterThan(0)
  })
})
```

运行：
```bash
npx vitest run tests/server/assistant/contract/contractRisk.dao.test.ts
```
预期：FAIL（函数未定义）。

- [ ] **Step 2: 实现 DAO**

```ts
// server/services/assistant/contract/contractRisk.dao.ts
import type { contractRisks } from '@prisma-app/client'
import type { RiskSource, RiskArchivedStatus, StancePreference, RiskLevel } from '#shared/types/contract'

export interface CreateContractRiskInput {
  reviewId: number
  source: RiskSource
  code?: string | null
  category: string
  level: RiskLevel
  stance: StancePreference
  problem: string
  legalBasis?: string | null
  analysis?: string | null
  suggestion?: string | null
  anchorQuote: string
  anchorParagraphIndex?: number | null
  anchorCharStart?: number | null
  anchorCharEnd?: number | null
}

export async function createContractRiskDAO(input: CreateContractRiskInput): Promise<contractRisks> {
  return prisma.contractRisks.create({ data: input })
}

export interface UpdateContractRiskInput {
  level?: RiskLevel
  suggestion?: string | null
  archivedStatus?: RiskArchivedStatus | null
  anchorQuote?: string
  anchorParagraphIndex?: number | null
}

export async function updateContractRiskDAO(id: number, input: UpdateContractRiskInput): Promise<contractRisks> {
  const data: Record<string, unknown> = { ...input }
  if (input.archivedStatus !== undefined) {
    data.archivedAt = input.archivedStatus ? new Date() : null
  }
  return prisma.contractRisks.update({ where: { id }, data })
}

export async function listContractRisksDAO(reviewId: number): Promise<contractRisks[]> {
  return prisma.contractRisks.findMany({
    where: { reviewId },
    orderBy: [{ source: 'asc' }, { createdAt: 'asc' }],
  })
}

export async function getContractRiskByIdDAO(id: number): Promise<contractRisks | null> {
  return prisma.contractRisks.findUnique({ where: { id } })
}

export async function deleteContractRiskDAO(id: number): Promise<void> {
  await prisma.contractRisks.delete({ where: { id } })
}
```

- [ ] **Step 3: 运行测试**

```bash
npx vitest run tests/server/assistant/contract/contractRisk.dao.test.ts
```
应全绿。

- [ ] **Step 4: Commit**

```bash
git add server/services/assistant/contract/contractRisk.dao.ts tests/server/assistant/contract/contractRisk.dao.test.ts
git commit -m "feat(contract): ContractRisk DAO + 测试"
```

---

## Task 2.2: ContractAnnotation DAO

**Files:**
- Create: `server/services/assistant/contract/contractAnnotation.dao.ts`
- Create: `tests/server/assistant/contract/contractAnnotation.dao.test.ts`

结构与 Task 2.1 对称。

- [ ] **Step 1: 测试 (TDD)**

关键测试用例：
- `create` 写入（含 `authorType`、`authorName`、`content`）
- `create` 含 `parentAnnotationId` 时成功建立父子关系
- `list` 按 riskId 返回按 `createdAt` 升序，**软删的 deletedAt!=null 不返回**
- `update content` 生效
- `softDelete` 只设 `deletedAt`，数据行仍在 DB
- `listContractAnnotationsByReviewDAO` 过滤 `deletedAt IS NULL`

- [ ] **Step 2: 实现 DAO**

```ts
// server/services/assistant/contract/contractAnnotation.dao.ts
import type { contractAnnotations } from '@prisma-app/client'
import type { AnnotationAuthorType } from '#shared/types/contract'

export interface CreateContractAnnotationInput {
  reviewId: number
  riskId: number
  parentAnnotationId?: number | null
  authorType: AnnotationAuthorType
  authorName: string
  authorUserId?: number | null
  content: string
}

export async function createContractAnnotationDAO(input: CreateContractAnnotationInput): Promise<contractAnnotations> {
  return prisma.contractAnnotations.create({ data: input })
}

export async function updateContractAnnotationDAO(
  id: number,
  input: Partial<Pick<contractAnnotations, 'content'>>,
): Promise<contractAnnotations> {
  return prisma.contractAnnotations.update({ where: { id }, data: input })
}

export async function listContractAnnotationsByRiskDAO(riskId: number): Promise<contractAnnotations[]> {
  return prisma.contractAnnotations.findMany({
    where: { riskId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
}

export async function listContractAnnotationsByReviewDAO(reviewId: number): Promise<contractAnnotations[]> {
  return prisma.contractAnnotations.findMany({
    where: { reviewId, deletedAt: null },
    orderBy: [{ riskId: 'asc' }, { createdAt: 'asc' }],
  })
}

/** 软删：批注永不物理删除（决策 11 铁律）。律师删自己批注走这个接口。 */
export async function softDeleteContractAnnotationDAO(id: number): Promise<void> {
  await prisma.contractAnnotations.update({
    where: { id },
    data: { deletedAt: new Date() },
  })
}

export async function getContractAnnotationByIdDAO(id: number): Promise<contractAnnotations | null> {
  return prisma.contractAnnotations.findUnique({ where: { id } })
}
```

- [ ] **Step 3: 测试通过 + Commit**

```bash
npx vitest run tests/server/assistant/contract/contractAnnotation.dao.test.ts
git add server/services/assistant/contract/contractAnnotation.dao.ts tests/server/assistant/contract/contractAnnotation.dao.test.ts
git commit -m "feat(contract): ContractAnnotation DAO + 测试"
```

---

## Task 2.3: ContractReviewVersion DAO

**Files:**
- Create: `server/services/assistant/contract/contractReviewVersion.dao.ts`

- [ ] **Step 1: 实现 DAO（无独立测试，service 层测试覆盖）**

```ts
// server/services/assistant/contract/contractReviewVersion.dao.ts
import type { contractReviewVersions, Prisma } from '@prisma-app/client'
import type { VersionSystemLabel } from '#shared/types/contract'

export interface CreateContractReviewVersionInput {
  reviewId: number
  versionNumber: number
  systemLabel: VersionSystemLabel
  lawyerNote?: string | null
  snapshotData: Prisma.InputJsonValue
  createdById: number
}

export async function createContractReviewVersionDAO(input: CreateContractReviewVersionInput): Promise<contractReviewVersions> {
  return prisma.contractReviewVersions.create({ data: input })
}

/** 列表（不含 snapshotData，节省流量） */
export async function listContractReviewVersionsDAO(reviewId: number) {
  return prisma.contractReviewVersions.findMany({
    where: { reviewId },
    orderBy: { versionNumber: 'desc' },
    select: {
      id: true,
      reviewId: true,
      versionNumber: true,
      systemLabel: true,
      lawyerNote: true,
      createdById: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  })
}

export async function getContractReviewVersionByIdDAO(id: number): Promise<contractReviewVersions | null> {
  return prisma.contractReviewVersions.findUnique({ where: { id } })
}

export async function updateContractReviewVersionNoteDAO(id: number, lawyerNote: string | null): Promise<contractReviewVersions> {
  return prisma.contractReviewVersions.update({ where: { id }, data: { lawyerNote } })
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/assistant/contract/contractReviewVersion.dao.ts
git commit -m "feat(contract): ContractReviewVersion DAO"
```

---

## Task 2.4: Version snapshot service（产生 / 读取 / 原子 versionNumber）

**Files:**
- Create: `server/services/assistant/contract/contractReviewVersion.service.ts`
- Create: `tests/server/assistant/contract/contractReviewVersion.service.test.ts`

- [ ] **Step 1: 先写测试**

```ts
// tests/server/assistant/contract/contractReviewVersion.service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { saveContractReviewVersionService, loadContractReviewVersionSnapshotService } from '~/server/services/assistant/contract/contractReviewVersion.service'
import { createContractRiskDAO } from '~/server/services/assistant/contract/contractRisk.dao'
import { createContractAnnotationDAO } from '~/server/services/assistant/contract/contractAnnotation.dao'

describe('contractReviewVersion.service', () => {
  let reviewId: number
  let userId: number

  beforeEach(async () => {
    const user = await prisma.users.findFirst()
    userId = user!.id
    const review = await prisma.contractReviews.create({
      data: { title: 'version test', userId, status: 'completed', risks: [], maxVersionNo: 0 },
    })
    reviewId = review.id
  })

  afterEach(async () => {
    await prisma.contractReviews.delete({ where: { id: reviewId } })
  })

  it('saveContractReviewVersionService 原子递增 versionNumber', async () => {
    const v1 = await saveContractReviewVersionService({
      reviewId,
      systemLabel: 'lawyer_save',
      createdById: userId,
    })
    const v2 = await saveContractReviewVersionService({
      reviewId,
      systemLabel: 'lawyer_save',
      createdById: userId,
    })
    expect(v1.versionNumber).toBe(1)
    expect(v2.versionNumber).toBe(2)

    const review = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
    expect(review?.maxVersionNo).toBe(2)
    expect(review?.currentVersionId).toBe(v2.id)
  })

  it('snapshotData 包含工作区 risks/annotations 的全量拷贝', async () => {
    const risk = await createContractRiskDAO({ reviewId, source: 'ai', category: 'x', level: 'high', stance: 'balanced', problem: 'x', anchorQuote: 'x' })
    await createContractAnnotationDAO({ reviewId, riskId: risk.id, authorType: 'ai', authorName: 'AI', content: '测试' })
    const v1 = await saveContractReviewVersionService({ reviewId, systemLabel: 'lawyer_save', createdById: userId })

    const loaded = await loadContractReviewVersionSnapshotService(v1.id)
    expect(loaded.snapshot.risks.length).toBe(1)
    expect(loaded.snapshot.annotations.length).toBe(1)
  })
})
```

运行：应 FAIL（函数未定义）。

- [ ] **Step 2: 实现 service**

**设计决策**：`contractReviews` 主表**不新增** `docxText` 字段。工作区的"正文"始终等同于 `currentVersionId` 所指向 snapshot 里的 docxText（Phase A 律师不改正文；Phase B 上传新 docx 时会产生新快照，currentVersionId 会指向新快照）。`saveContractReviewVersionService` 入参支持可选覆盖：首次快照（`initial_upload`）由调用方显式传入 docxText；`lawyer_save` 从 currentVersion 继承。paragraphs 字段 Phase B 才需要，本 Phase 不实现。

```ts
// server/services/assistant/contract/contractReviewVersion.service.ts
import type { VersionSystemLabel, ContractReviewVersionSnapshotResponse, ContractRiskEntity, ContractAnnotationEntity } from '#shared/types/contract'
import { createContractReviewVersionDAO, getContractReviewVersionByIdDAO } from './contractReviewVersion.dao'
import { listContractRisksDAO } from './contractRisk.dao'
import { listContractAnnotationsByReviewDAO } from './contractAnnotation.dao'

export interface SaveVersionInput {
  reviewId: number
  systemLabel: VersionSystemLabel
  lawyerNote?: string | null
  createdById: number
  /**
   * 正文内容。Phase A 首次快照（initial_upload）由调用方显式传入；
   * lawyer_save 传 undefined → 从 currentVersion snapshot 继承。
   */
  docxText?: string
}

/**
 * 原子操作：递增 maxVersionNo → 创建快照记录 → 更新 currentVersionId
 * 整个过程在 prisma transaction 内完成，避免并发冲突
 */
export async function saveContractReviewVersionService(input: SaveVersionInput) {
  const { reviewId, systemLabel, lawyerNote, createdById } = input

  return prisma.$transaction(async (tx) => {
    // 1. 原子递增 + 读当前 currentVersionId 用于继承 docxText
    const review = await tx.contractReviews.update({
      where: { id: reviewId },
      data: { maxVersionNo: { increment: 1 } },
      select: { maxVersionNo: true, currentVersionId: true },
    })
    const versionNumber = review.maxVersionNo

    // 2. 从入参或当前版本继承 docxText
    let docxText = input.docxText ?? ''
    if (!input.docxText && review.currentVersionId) {
      const prev = await tx.contractReviewVersions.findUnique({
        where: { id: review.currentVersionId },
        select: { snapshotData: true },
      })
      const prevSnap = prev?.snapshotData as { docxText?: string } | undefined
      docxText = prevSnap?.docxText ?? ''
    }

    // 3. 拿当前工作区 risks + annotations（软删的不进 snapshot）
    const [risks, annotations] = await Promise.all([
      tx.contractRisks.findMany({ where: { reviewId }, orderBy: { createdAt: 'asc' } }),
      tx.contractAnnotations.findMany({
        where: { reviewId, deletedAt: null },
        orderBy: [{ riskId: 'asc' }, { createdAt: 'asc' }],
      }),
    ])

    const snapshotData = { risks, annotations, docxText }

    // 4. 创建版本
    const version = await tx.contractReviewVersions.create({
      data: {
        reviewId,
        versionNumber,
        systemLabel,
        lawyerNote: lawyerNote ?? null,
        snapshotData,
        createdById,
      },
    })

    // 5. 更新 currentVersionId
    await tx.contractReviews.update({
      where: { id: reviewId },
      data: { currentVersionId: version.id },
    })

    return version
  })
}

/** 读取版本完整快照（含 snapshotData 反序列化） */
export async function loadContractReviewVersionSnapshotService(versionId: number): Promise<ContractReviewVersionSnapshotResponse> {
  const version = await getContractReviewVersionByIdDAO(versionId)
  if (!version) throw new Error(`Version ${versionId} not found`)

  const snapshot = version.snapshotData as unknown as {
    risks: ContractRiskEntity[]
    annotations: ContractAnnotationEntity[]
    docxText: string
  }

  return {
    id: version.id,
    reviewId: version.reviewId,
    versionNumber: version.versionNumber,
    systemLabel: version.systemLabel as VersionSystemLabel,
    lawyerNote: version.lawyerNote,
    createdById: version.createdById,
    createdByName: '', // 需 JOIN users
    createdAt: version.createdAt.toISOString(),
    snapshot,
  }
}
```

> Phase B 再补 `hasWorkspaceDifferenceAgainstCurrentVersionService`（auto_backup 幂等规则）和 paragraphs 支持。本 Phase A 不做。


- [ ] **Step 3: 测试全绿**

```bash
npx vitest run tests/server/assistant/contract/contractReviewVersion.service.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add server/services/assistant/contract/contractReviewVersion.service.ts tests/server/assistant/contract/contractReviewVersion.service.test.ts
git commit -m "feat(contract): 版本快照 service（原子 versionNumber + snapshot dump + 差异判定）"
```

---

## Task 2.5: Risk / Annotation Service（薄业务封装 + 归属校验）

**Files:**
- Create: `server/services/assistant/contract/contractRisk.service.ts`
- Create: `server/services/assistant/contract/contractAnnotation.service.ts`

**设计决策**：owner 校验统一由 `reviewGuard.ts` 的 guard 家族完成（见 Task 2.0），service 层**不**再做归属校验（不存在的 `getContractReviewOwnerIdDAO` 不要引用）。service 只负责"拿到 review + 子资源 id 后做业务动作"。

- [ ] **Step 1: contractRisk.service.ts**

```ts
// server/services/assistant/contract/contractRisk.service.ts
import type { RiskArchivedStatus } from '#shared/types/contract'
import { updateContractRiskDAO } from './contractRisk.dao'

/**
 * 更新风险处置状态。归属校验由 handler 层通过 loadOwnedReviewByRiskId 完成，
 * service 只接收经过校验的 riskId 做业务动作。
 */
export async function archiveContractRiskService(params: {
  riskId: number
  archivedStatus: RiskArchivedStatus | null
}) {
  return updateContractRiskDAO(params.riskId, { archivedStatus: params.archivedStatus })
}
```

- [ ] **Step 2: contractAnnotation.service.ts**

```ts
// server/services/assistant/contract/contractAnnotation.service.ts
import type { AnnotationAuthorType } from '#shared/types/contract'
import {
  createContractAnnotationDAO,
  updateContractAnnotationDAO,
  softDeleteContractAnnotationDAO,
  getContractAnnotationByIdDAO,
} from './contractAnnotation.dao'
import { getContractRiskByIdDAO } from './contractRisk.dao'

/**
 * 业务规则：
 * - 创建：任何律师对自己名下的 review 都可以在任意 risk 下新增 lawyer 批注（归属校验由 handler 完成）
 * - 修改/软删：只能修改/软删自己创建的 lawyer 批注（此业务规则在 service 层强制）
 */

export async function createLawyerAnnotationService(params: {
  reviewId: number
  riskId: number
  content: string
  parentAnnotationId?: number | null
  user: { id: number; name: string }
}) {
  // risk 归属校验：确保 risk 属于 review（handler 已校验 review 归属，这里只做 risk-review 关联校验）
  const risk = await getContractRiskByIdDAO(params.riskId)
  if (!risk || risk.reviewId !== params.reviewId) {
    return { error: 'risk_not_found' as const }
  }

  const ann = await createContractAnnotationDAO({
    reviewId: params.reviewId,
    riskId: params.riskId,
    parentAnnotationId: params.parentAnnotationId ?? null,
    authorType: 'lawyer' as AnnotationAuthorType,
    authorName: params.user.name,
    authorUserId: params.user.id,
    content: params.content,
  })
  return { annotation: ann }
}

export async function updateAnnotationContentService(params: {
  annotationId: number
  ownerUserId: number
  content: string
}) {
  const ann = await getContractAnnotationByIdDAO(params.annotationId)
  if (!ann || ann.deletedAt) return { error: 'not_found' as const }
  if (ann.authorType !== 'lawyer' || ann.authorUserId !== params.ownerUserId) {
    return { error: 'not_own' as const }
  }
  const updated = await updateContractAnnotationDAO(params.annotationId, { content: params.content })
  return { annotation: updated }
}

/**
 * 软删（决策 11：批注永不物理删除）
 * 律师只能软删自己的 lawyer 批注；AI 批注不可删。
 */
export async function softDeleteAnnotationService(params: {
  annotationId: number
  ownerUserId: number
}): Promise<{ ok: true } | { error: 'not_found' | 'not_own' }> {
  const ann = await getContractAnnotationByIdDAO(params.annotationId)
  if (!ann || ann.deletedAt) return { error: 'not_found' }
  if (ann.authorType !== 'lawyer' || ann.authorUserId !== params.ownerUserId) {
    return { error: 'not_own' }
  }
  await softDeleteContractAnnotationDAO(params.annotationId)
  return { ok: true }
}
```

> 关键改动：
> - 抛 `createError` 的模式改成 `return { error: ... }` / `return { ok: true }`，由 handler 层转 `resError`，符合项目"service 抛业务错误、handler 转响应"的分层惯例
> - 删除调用变成软删（`softDeleteAnnotationService`）
> - 所有 service 函数不再依赖虚构的 `getContractReviewOwnerIdDAO`

- [ ] **Step 3: Commit**

```bash
git add server/services/assistant/contract/contractRisk.service.ts server/services/assistant/contract/contractAnnotation.service.ts
git commit -m "feat(contract): Risk/Annotation 业务 service（含归属校验）"
```

---

# 子期 3 · 后端 API（Day 2）

**铁律（回顾）**：
- 响应签名：`resSuccess(event, '操作成功', data)` / `resError(event, code, '错误')`
- owner 校验：必须通过 `loadOwnedReview*` guard 家族，不允许手写
- 路径：动态参数在文件末尾，不嵌套中间层

## Task 3.1: GET 版本列表

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/versions.get.ts`

- [ ] **Step 1: 实现**

```ts
// GET /api/v1/assistant/contract/reviews/:id/versions
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { listContractReviewVersionsDAO } from '~~/server/services/assistant/contract/contractReviewVersion.dao'

export default defineEventHandler(async (event) => {
  const guard = await loadOwnedReview(event, { actionLabel: '查看版本列表' })
  if (!guard.ok) return resError(event, guard.status, guard.message)

  const { review } = guard
  const versions = await listContractReviewVersionsDAO(review.id)
  return resSuccess(event, '获取成功', {
    versions: versions.map(v => ({
      id: v.id,
      reviewId: v.reviewId,
      versionNumber: v.versionNumber,
      systemLabel: v.systemLabel,
      lawyerNote: v.lawyerNote,
      createdById: v.createdById,
      createdByName: v.createdBy?.name ?? '',
      createdAt: v.createdAt.toISOString(),
    })),
    currentVersionId: review.currentVersionId,
    maxVersionNo: review.maxVersionNo,
  })
})
```

- [ ] **Step 2: Commit**

---

## Task 3.2: POST 手动保存新版本

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/versions.post.ts`

- [ ] **Step 1: 实现**

```ts
// POST /api/v1/assistant/contract/reviews/:id/versions
// body: { lawyerNote?: string }
import { z } from 'zod'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { saveContractReviewVersionService } from '~~/server/services/assistant/contract/contractReviewVersion.service'

const bodySchema = z.object({
  lawyerNote: z.string().max(200).nullish(),
})

export default defineEventHandler(async (event) => {
  const guard = await loadOwnedReview(event, { actionLabel: '保存新版本' })
  if (!guard.ok) return resError(event, guard.status, guard.message)

  const { user, review } = guard
  const raw = await readBody(event)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

  // 决策 4：律师随时可点保存，不加状态门禁（即便审查中也允许"定格当前状态"）

  try {
    const version = await saveContractReviewVersionService({
      reviewId: review.id,
      systemLabel: 'lawyer_save',
      lawyerNote: parsed.data.lawyerNote ?? null,
      createdById: user.id,
    })
    return resSuccess(event, '已保存版本', {
      id: version.id,
      versionNumber: version.versionNumber,
      systemLabel: version.systemLabel,
      lawyerNote: version.lawyerNote,
      createdAt: version.createdAt.toISOString(),
    })
  } catch (err: any) {
    // P2002 = unique 约束冲突（并发 saveVersion）；让前端重试
    if (err?.code === 'P2002') return resError(event, 409, '版本号冲突，请重试')
    throw err
  }
})
```

- [ ] **Step 2: Commit**

---

## Task 3.3: GET 版本快照详情（含 snapshotData）

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/versions/[versionId].get.ts`

```ts
// GET /api/v1/assistant/contract/reviews/versions/:versionId
import { loadOwnedReviewByVersionId } from '~~/server/services/assistant/contract/reviewGuard'
import { loadContractReviewVersionSnapshotService } from '~~/server/services/assistant/contract/contractReviewVersion.service'

export default defineEventHandler(async (event) => {
  const guard = await loadOwnedReviewByVersionId(event, { actionLabel: '查看版本快照' })
  if (!guard.ok) return resError(event, guard.status, guard.message)

  const versionId = Number(getRouterParam(event, 'versionId'))
  const snapshot = await loadContractReviewVersionSnapshotService(versionId)
  return resSuccess(event, '获取成功', snapshot)
})
```

- [ ] Commit

---

## Task 3.4: PATCH 版本备注

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/versions/[versionId].patch.ts`

```ts
// PATCH /api/v1/assistant/contract/reviews/versions/:versionId
// body: { lawyerNote: string | null }
import { z } from 'zod'
import { loadOwnedReviewByVersionId } from '~~/server/services/assistant/contract/reviewGuard'
import { updateContractReviewVersionNoteDAO } from '~~/server/services/assistant/contract/contractReviewVersion.dao'

const bodySchema = z.object({ lawyerNote: z.string().max(200).nullable() })

export default defineEventHandler(async (event) => {
  const guard = await loadOwnedReviewByVersionId(event, { actionLabel: '修改版本备注' })
  if (!guard.ok) return resError(event, guard.status, guard.message)

  const raw = await readBody(event)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

  const versionId = Number(getRouterParam(event, 'versionId'))
  const updated = await updateContractReviewVersionNoteDAO(versionId, parsed.data.lawyerNote)
  return resSuccess(event, '已更新备注', { id: updated.id, lawyerNote: updated.lawyerNote })
})
```

- [ ] Commit

---

## Task 3.5: PATCH 处置风险

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/risks/[riskId].patch.ts`

```ts
// PATCH /api/v1/assistant/contract/reviews/risks/:riskId
// body: { archivedStatus: 'handled' | 'ignored' | null }
import { z } from 'zod'
import { loadOwnedReviewByRiskId } from '~~/server/services/assistant/contract/reviewGuard'
import { archiveContractRiskService } from '~~/server/services/assistant/contract/contractRisk.service'

const bodySchema = z.object({
  archivedStatus: z.enum(['handled', 'ignored']).nullable(),
})

export default defineEventHandler(async (event) => {
  const guard = await loadOwnedReviewByRiskId(event, { actionLabel: '处置风险' })
  if (!guard.ok) return resError(event, guard.status, guard.message)

  const raw = await readBody(event)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

  const riskId = Number(getRouterParam(event, 'riskId'))
  const updated = await archiveContractRiskService({ riskId, archivedStatus: parsed.data.archivedStatus })
  return resSuccess(event, '已更新', {
    id: updated.id,
    archivedStatus: updated.archivedStatus,
    archivedAt: updated.archivedAt?.toISOString() ?? null,
  })
})
```

- [ ] Commit

---

## Task 3.6: POST 新增批注（律师）

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/annotations.post.ts`

```ts
// POST /api/v1/assistant/contract/reviews/:id/annotations
// body: { riskId: number; content: string; parentAnnotationId?: number | null }
import { z } from 'zod'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { createLawyerAnnotationService } from '~~/server/services/assistant/contract/contractAnnotation.service'

const bodySchema = z.object({
  riskId: z.number().int().positive(),
  content: z.string().trim().min(1).max(2000),
  parentAnnotationId: z.number().int().positive().nullish(),
})

export default defineEventHandler(async (event) => {
  const guard = await loadOwnedReview(event, { actionLabel: '新增批注' })
  if (!guard.ok) return resError(event, guard.status, guard.message)
  const { user, review } = guard

  const raw = await readBody(event)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

  const result = await createLawyerAnnotationService({
    reviewId: review.id,
    riskId: parsed.data.riskId,
    content: parsed.data.content,
    parentAnnotationId: parsed.data.parentAnnotationId ?? null,
    user: { id: user.id, name: (user as any).name ?? '律师' },
  })

  if ('error' in result) return resError(event, 404, '风险不存在或不属于该审查')
  const { annotation } = result
  return resSuccess(event, '已发送', {
    id: annotation.id,
    riskId: annotation.riskId,
    parentAnnotationId: annotation.parentAnnotationId,
    authorType: annotation.authorType,
    authorName: annotation.authorName,
    authorUserId: annotation.authorUserId,
    content: annotation.content,
    createdAt: annotation.createdAt.toISOString(),
  })
})
```

- [ ] Commit

---

## Task 3.7: PATCH 修改批注

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/annotations/[annotationId].patch.ts`

```ts
// PATCH /api/v1/assistant/contract/reviews/annotations/:annotationId
// body: { content: string }
import { z } from 'zod'
import { loadOwnedReviewByAnnotationId } from '~~/server/services/assistant/contract/reviewGuard'
import { updateAnnotationContentService } from '~~/server/services/assistant/contract/contractAnnotation.service'

const bodySchema = z.object({ content: z.string().trim().min(1).max(2000) })

export default defineEventHandler(async (event) => {
  const guard = await loadOwnedReviewByAnnotationId(event, { actionLabel: '修改批注' })
  if (!guard.ok) return resError(event, guard.status, guard.message)
  const { user } = guard

  const raw = await readBody(event)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

  const annotationId = Number(getRouterParam(event, 'annotationId'))
  const result = await updateAnnotationContentService({
    annotationId,
    ownerUserId: user.id,
    content: parsed.data.content,
  })
  if ('error' in result) {
    if (result.error === 'not_own') return resError(event, 403, '只能修改自己的批注')
    return resError(event, 404, '批注不存在')
  }
  return resSuccess(event, '已更新', { id: result.annotation.id, content: result.annotation.content })
})
```

- [ ] Commit

---

## Task 3.8: DELETE 软删批注（决策 11 铁律）

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/annotations/[annotationId].delete.ts`

```ts
// DELETE /api/v1/assistant/contract/reviews/annotations/:annotationId
// 软删（deletedAt），不物理删；AI 批注不可删；只能删自己的 lawyer 批注
import { loadOwnedReviewByAnnotationId } from '~~/server/services/assistant/contract/reviewGuard'
import { softDeleteAnnotationService } from '~~/server/services/assistant/contract/contractAnnotation.service'

export default defineEventHandler(async (event) => {
  const guard = await loadOwnedReviewByAnnotationId(event, { actionLabel: '删除批注' })
  if (!guard.ok) return resError(event, guard.status, guard.message)
  const { user } = guard

  const annotationId = Number(getRouterParam(event, 'annotationId'))
  const result = await softDeleteAnnotationService({ annotationId, ownerUserId: user.id })
  if ('error' in result) {
    if (result.error === 'not_own') return resError(event, 403, '只能删除自己的批注')
    return resError(event, 404, '批注不存在')
  }
  return resSuccess(event, '已删除', { deleted: true })
})
```

- [ ] Commit

---

## Task 3.9: 改造 GET /reviews/:id 返回工作区结构化数据

**Files:**
- Modify: `server/api/v1/assistant/contract/reviews/[id].get.ts`

- [ ] **Step 1: 调整返回结构**

现有接口返回 `{ ...review, risks: [] }`（风险从 JSON 读）。改造成从 `ContractRisk` + `ContractAnnotation` 表读，保持返回 shape 向下兼容。

**fallback 判定条件**：用 `review.currentVersionId === null` 判断"是否已迁移"，而不是用子表行数（子表行数 0 可能是 1. 未迁移，也可能是 2. 已迁移但该审查本来 0 风险，必须用 `currentVersionId` 区分）。

```ts
// handler 内拼接工作区视图
const guard = await loadOwnedReview(event)  // 现有
if (!guard.ok) return resError(event, guard.status, guard.message)
const { review } = guard

let risksWithAnnotations
if (review.currentVersionId === null) {
  // 未迁移存量数据：回读 legacy risks JSON，保证旧审查详情页不崩
  const legacy = (review.risks as any[]) ?? []
  risksWithAnnotations = legacy
} else {
  const [risks, annotations] = await Promise.all([
    listContractRisksDAO(review.id),
    listContractAnnotationsByReviewDAO(review.id),  // 已过滤 deletedAt
  ])
  risksWithAnnotations = risks.map(r => ({
    ...r,
    annotations: annotations.filter(a => a.riskId === r.id),
  }))
}

return resSuccess(event, '获取成功', {
  // ... 现有字段 ...
  risks: risksWithAnnotations,
  playbookSnapshot: review.playbookSnapshot,
  currentVersionId: review.currentVersionId,
  maxVersionNo: review.maxVersionNo,
})
```

> Task 7.4 完成数据迁移后，`currentVersionId === null` 的分支代码可以在单独 PR 里删除。

- [ ] **Step 2: 给整个子期 3 的 API 写集成测试**

`tests/server/assistant/contract/reviews.versions.api.test.ts`：覆盖所有 8 个新接口的 happy path + 主要错误分支（未登录、非 owner、参数错）。

- [ ] **Step 3: 测试全绿 + Commit**

```bash
npx vitest run tests/server/assistant/contract/reviews.versions.api.test.ts
git add server/api/v1/assistant/contract/reviews/ tests/server/assistant/contract/reviews.versions.api.test.ts
git commit -m "feat(contract): 版本/风险/批注 REST API + 集成测试"
```

---

# 子期 4 · 首次上传集成 + 数据迁移（Day 3）

## Task 4.1: AI 审查完成后自动创建 v1 initial_upload 快照

**Files:**
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`（或首次上传落盘的关键服务文件）

- [ ] **Step 1: 在 AI 审查落盘路径里插入快照生成逻辑**

定位现有代码：AI 审查跑完、把结果写回 `contractReviews.risks` JSON 的那一步。改造成：
1. 依然保留写 `risks` JSON（过渡期兼容）
2. **同时**把每条风险拆成 `ContractRisk` 行，每条 AI 风险生成一条 `authorType=ai` 的 annotation（内容 = 风险的五段式拼接文本）
3. 在调 `saveContractReviewVersionService` 时**显式传入** `docxText`（从合同解析阶段拿到），会存进 snapshot；后续版本（lawyer_save）通过 currentVersionId 自动继承。`paragraphs` 是 Phase B 字段，本 Phase 不传。
4. 调 `saveContractReviewVersionService` 创建 v1 快照（`systemLabel=initial_upload`, `createdById=user.id`, `docxText`）

代码片段：

```ts
// 在原 AI 审查完成处（示意）
for (const aiRisk of aiRisks) {
  const risk = await createContractRiskDAO({
    reviewId,
    source: 'ai',
    code: aiRisk.matchedPointCode ?? null,
    category: aiRisk.category,
    level: aiRisk.level,
    stance: aiRisk.stance ?? 'balanced',
    problem: aiRisk.problem,
    legalBasis: aiRisk.legalBasis,
    analysis: aiRisk.analysis,
    suggestion: aiRisk.suggestion,
    anchorQuote: aiRisk.quote,
    anchorParagraphIndex: aiRisk.paragraphIndex,
  })
  await createContractAnnotationDAO({
    reviewId,
    riskId: risk.id,
    authorType: 'ai',
    authorName: 'AI',
    content: renderRiskAsAnnotationText(aiRisk), // 五段式渲染
    // wordCommentRef 属于 Phase B 字段，Phase A 不生成
  })
}

// 显式传入 docxText，存进 v1 snapshot
await saveContractReviewVersionService({
  reviewId,
  systemLabel: 'initial_upload',
  createdById: userId,
  docxText: parsedDocxText,       // 从解析步骤拿到
})
```

- [ ] **Step 2: 完整跑一次首次上传的集成 E2E（手动/测试）**

用 chrome-devtools 或 curl 跑：上传一份合同 → 等 AI 审查完成 → 查 DB：
- `contract_risks` 表有记录
- `contract_annotations` 表每条 risk 有一条 `authorType=ai` annotation
- `contract_review_versions` 有一条 `versionNumber=1, systemLabel=initial_upload` 记录
- `contract_reviews.currentVersionId` 指向 v1
- `contract_reviews.maxVersionNo = 1`

- [ ] **Step 3: Commit**

---

## Task 4.2: 存量 ContractReview.risks JSON 迁移脚本

**Files:**
- Create: `server/services/assistant/contract/contractReviewMigrate.service.ts`
- Create: `tests/server/assistant/contract/contractReviewMigrate.service.test.ts`
- Create: `scripts/migrate-contract-risks.ts`（一次性运行脚本）

- [ ] **Step 1: Service 实现（可测试）**

```ts
// server/services/assistant/contract/contractReviewMigrate.service.ts
/**
 * 把一个 review 的 legacy risks JSON 迁移到 ContractRisk/Annotation 表 + 生成 v1 快照
 * 幂等：若该 review 已有 currentVersionId，则跳过
 */
export async function migrateLegacyRisksService(reviewId: number): Promise<{ migrated: boolean; risksCreated: number }> {
  const review = await prisma.contractReviews.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true, risks: true, currentVersionId: true, reviewedFileId: true, originalFileId: true },
  })
  if (!review) return { migrated: false, risksCreated: 0 }
  if (review.currentVersionId) return { migrated: false, risksCreated: 0 } // 已迁移

  const legacy = (review.risks as Array<Record<string, unknown>>) ?? []
  // 守卫：跳过"存量异常行"（currentVersionId=null 但 risks JSON 也空的 review，
  // 比如审查失败/状态异常的。防止给它们也硬生成 v1 initial_upload 快照）
  if (legacy.length === 0) return { migrated: false, risksCreated: 0 }

  let created = 0
  for (const lr of legacy) {
    const risk = await createContractRiskDAO({
      reviewId,
      source: 'ai',
      code: (lr.matchedPointCode as string) ?? null,
      category: (lr.category as string) ?? '未分类',
      level: (lr.level as RiskLevel) ?? 'medium',
      stance: (lr.stance as StancePreference) ?? 'balanced',
      problem: (lr.problem as string) ?? '',
      legalBasis: (lr.legalBasis as string) ?? null,
      analysis: (lr.analysis as string) ?? null,
      suggestion: (lr.suggestion as string) ?? null,
      anchorQuote: (lr.quote as string) ?? '',
      anchorParagraphIndex: (lr.paragraphIndex as number) ?? null,
    })
    await createContractAnnotationDAO({
      reviewId,
      riskId: risk.id,
      authorType: 'ai',
      authorName: 'AI',
      content: renderRiskAsAnnotationText(lr),
      // wordCommentRef 属于 Phase B 字段
    })
    created++
  }

  await saveContractReviewVersionService({
    reviewId,
    systemLabel: 'initial_upload',
    createdById: review.userId,
    docxText: '',         // 存量迁移不强制回填正文（Phase A 只读历史版本时显示空正文可接受，Phase B 加回填脚本）
  })

  return { migrated: true, risksCreated: created }
}

export async function migrateAllLegacyRisksService(): Promise<{ processed: number; migrated: number }> {
  const reviews = await prisma.contractReviews.findMany({
    where: { currentVersionId: null },
    select: { id: true },
  })
  let migrated = 0
  for (const r of reviews) {
    const res = await migrateLegacyRisksService(r.id)
    if (res.migrated) migrated++
  }
  return { processed: reviews.length, migrated }
}
```

- [ ] **Step 2: 测试**

`tests/server/assistant/contract/contractReviewMigrate.service.test.ts`：
- 造一个 review 带 3 条 legacy risks JSON
- 调用 `migrateLegacyRisksService`
- 断言：3 条 ContractRisk 行，3 条 ContractAnnotation 行，1 条 Version
- 再次调用，断言：不重复迁移（幂等）

- [ ] **Step 3: 一次性运行脚本**

```ts
// scripts/migrate-contract-risks.ts
import { migrateAllLegacyRisksService } from '~/server/services/assistant/contract/contractReviewMigrate.service'

async function main() {
  const result = await migrateAllLegacyRisksService()
  console.log('Migration result:', result)
}
main().catch(e => { console.error(e); process.exit(1) })
```

运行：

```bash
bun run scripts/migrate-contract-risks.ts
```

- [ ] **Step 4: 备份原 risks 字段到 legacy 备份表（独立迁移）**

**禁止**在已生成的 `<ts>_contract_review_versioning/migration.sql` 文件尾部手工追加建表 SQL（违反 `.claude/rules/database.md` §3）。正确做法：单独生成一份迁移。

在 `prisma/models/` 新增一个 `contractReviewLegacyBackup.prisma` 模型：

```prisma
/// 合同审查存量 risks JSON 一次性备份（Phase A 数据迁移回滚兜底）
model contractReviewLegacyRisksBackup {
  reviewId    Int      @id @map("review_id")
  risks       Json
  backedUpAt  DateTime @default(now()) @map("backed_up_at")

  @@map("contract_review_legacy_risks_backup")
}
```

然后生成独立迁移：

```bash
bun run prisma:migrate --name contract_review_legacy_risks_backup --create-only
```

打开 `prisma/migrations/<ts>_contract_review_legacy_risks_backup/migration.sql`，在 Prisma 自动生成的 `CREATE TABLE` 之后**手工追加**一条 `INSERT ... SELECT` 把现有 `contract_reviews.risks` 拷贝进备份表：

```sql
-- CreateTable (Prisma 自动生成)
CREATE TABLE "contract_review_legacy_risks_backup" (...);

-- 手工追加：一次性拷贝存量数据
INSERT INTO contract_review_legacy_risks_backup (review_id, risks)
SELECT id, risks FROM contract_reviews
WHERE risks IS NOT NULL AND jsonb_array_length(risks) > 0;
```

手工编辑的理由在 commit message 里声明："Prisma 自动生成的 migration SQL 只建表；手工追加 `INSERT ... SELECT` 一次性拷贝存量 JSON 数据为数据保全"（database.md §3 例外流程）。

然后 apply：

```bash
bun run prisma:migrate
# 测试库
DATABASE_URL='postgres://...ls_new_testing' bun run prisma:deploy
```

- [ ] **Step 5: Commit**

---

## Task 4.3: 导出 docx 文件名带版本号（Phase A 承诺落地）

**Files:**
- Modify: `server/api/v1/assistant/contract/reviews/[id]/download.get.ts`
- Possibly Modify: `server/services/storage/storage.service.ts` 的 `generateSignedUrlService`（若需支持自定义 `response-content-disposition`）

**背景**：决策 7 + spec §2.3 承诺"下载文件名带版本号"。现有 `download.get.ts` 返回签名 URL，浏览器下载文件名由 OSS 对象元数据或 URL 的 `response-content-disposition` 参数决定。

- [ ] **Step 1: 读现有 `generateSignedUrlService` 签名，看是否已支持 `responseContentDisposition` 参数**

```bash
grep -n "responseContentDisposition\|Content-Disposition" server/services/storage/
```

如已支持 → 跳 Step 3；若不支持 → Step 2 扩展一下。

- [ ] **Step 2（条件）: 扩展 `generateSignedUrlService` 支持自定义 filename**

大致扩展（具体参照现有 service 实现）：

```ts
export interface GenerateSignedUrlOptions {
  expires?: number
  userId?: number
  /** 设置下载时浏览器显示的文件名（RFC 5987 编码） */
  filename?: string
}
```

内部把 `filename` 拼成 OSS 的 `response-content-disposition=attachment; filename*=UTF-8''<encoded>` 参数。

- [ ] **Step 3: download handler 拼装文件名**

```ts
import { listContractReviewVersionsDAO } from '~~/server/services/assistant/contract/contractReviewVersion.dao'

// ... 原有 guard 校验 ...

// 根据工作区是否有未保存编辑决定文件名里的版本标识
// 简化版：直接用 maxVersionNo 对应的最新版本作为标签；或显示为"工作区"
const filenameLabel = review.currentVersionId
  ? `v${review.maxVersionNo}`
  : '工作区'

const dateStr = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
const baseOriginalName = ossFile.originalFileName?.replace(/\.docx$/i, '') ?? '合同审查'
const filename = `${baseOriginalName}_${filenameLabel}_${dateStr}.docx`

const downloadUrl = await generateSignedUrlService(ossFile.filePath, {
  expires: DOWNLOAD_URL_EXPIRES_SECONDS,
  userId: user.id,
  filename,
})

return resSuccess(event, '获取下载地址成功', { downloadUrl, filename })
```

> 注：Phase A 场景下"工作区是否有未保存编辑"的精确判定由前端 `hasUnsavedEdits` 计算属性负责。这里的 `filenameLabel` 使用简化规则：永远取 `v${maxVersionNo}`（当前总是指向最新快照）。Phase B 引入 `auto_backup` 之后再精细化"未保存编辑 → 显示'工作区'后缀"的逻辑。

- [ ] **Step 4: 集成测试**

在 `tests/server/assistant/contract/download.test.ts`（新增或扩展）里断言：
- 返回的 `filename` 格式：`<原名>_v<N>_<YYYY-MM-DD>.docx`
- 签名 URL 包含 `response-content-disposition` 参数（或 service 有调用）

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(contract): 合同审查导出文件名带版本号后缀"
```

---

# 子期 5 · 前端 Composable（Day 3）

## Task 5.1: useContractReviewVersion composable

**Files:**
- Create: `app/composables/useContractReviewVersion.ts`
- Create: `tests/app/composables/useContractReviewVersion.test.ts`

- [ ] **Step 1: 实现（参考 `app/composables/useDocumentDraft.ts` 模式）**

```ts
// app/composables/useContractReviewVersion.ts
// Vue 响应式 API（ref/computed/watch）由 Nuxt 自动导入，不要手动 import
import { useDebounceFn } from '@vueuse/core'
import type {
  ContractRiskEntity,
  ContractAnnotationEntity,
  ContractReviewVersionEntity,
  ContractReviewVersionSnapshotResponse,
  RiskArchivedStatus,
} from '#shared/types/contract'

export interface WorkspaceState {
  risks: ContractRiskEntity[]
  annotations: ContractAnnotationEntity[]
  currentVersionId: number | null
  maxVersionNo: number
}

export function useContractReviewVersion(reviewId: Ref<number>) {
  const workspace = ref<WorkspaceState>({
    risks: [],
    annotations: [],
    currentVersionId: null,
    maxVersionNo: 0,
  })
  const versions = ref<ContractReviewVersionEntity[]>([])
  /** 当前正在查看的版本 ID（null = 工作区；number = 只读历史版本）*/
  const previewVersionId = ref<number | null>(null)
  const previewSnapshot = ref<ContractReviewVersionSnapshotResponse | null>(null)
  const isReadOnly = computed(() => previewVersionId.value !== null)

  /** 当前渲染的数据：工作区 or 历史快照 */
  const currentView = computed(() => {
    if (previewSnapshot.value) {
      return {
        risks: previewSnapshot.value.snapshot.risks,
        annotations: previewSnapshot.value.snapshot.annotations,
        docxText: previewSnapshot.value.snapshot.docxText,
      }
    }
    return {
      risks: workspace.value.risks,
      annotations: workspace.value.annotations,
      docxText: '',
    }
  })

  async function refreshWorkspace() {
    const resp = await useApiFetch<any>(`/api/v1/assistant/contract/reviews/${reviewId.value}`)
    if (!resp) return
    const risksWithAnnotations = (resp.risks ?? []) as Array<ContractRiskEntity & { annotations?: ContractAnnotationEntity[] }>
    workspace.value.risks = risksWithAnnotations.map(r => {
      const { annotations, ...rest } = r
      return rest
    })
    workspace.value.annotations = risksWithAnnotations.flatMap(r => r.annotations ?? [])
    workspace.value.currentVersionId = resp.currentVersionId ?? null
    workspace.value.maxVersionNo = resp.maxVersionNo ?? 0
  }

  async function refreshVersions() {
    const resp = await useApiFetch<{ versions: ContractReviewVersionEntity[]; currentVersionId: number | null; maxVersionNo: number }>(
      `/api/v1/assistant/contract/reviews/${reviewId.value}/versions`,
    )
    if (!resp) return
    versions.value = resp.versions
  }

  async function enterPreview(versionId: number) {
    const snap = await useApiFetch<ContractReviewVersionSnapshotResponse>(
      `/api/v1/assistant/contract/reviews/versions/${versionId}`,
    )
    if (!snap) return
    previewVersionId.value = versionId
    previewSnapshot.value = snap
  }

  function exitPreview() {
    previewVersionId.value = null
    previewSnapshot.value = null
  }

  /** 保存新版本（lawyer_save 类型） */
  async function saveNewVersion(lawyerNote?: string | null): Promise<boolean> {
    if (isReadOnly.value) return false
    const resp = await useApiFetch(
      `/api/v1/assistant/contract/reviews/${reviewId.value}/versions`,
      { method: 'POST', body: { lawyerNote: lawyerNote ?? null } },
    )
    if (!resp) return false
    await Promise.all([refreshWorkspace(), refreshVersions()])
    return true
  }

  /** 处置风险（离散动作直接 PATCH，不 debounce） */
  async function updateRiskArchivedStatus(riskId: number, archivedStatus: RiskArchivedStatus | null) {
    if (isReadOnly.value) return
    const resp = await useApiFetch(
      `/api/v1/assistant/contract/reviews/risks/${riskId}`,
      { method: 'PATCH', body: { archivedStatus } },
    )
    if (resp) {
      // 本地乐观更新
      const risk = workspace.value.risks.find(r => r.id === riskId)
      if (risk) {
        risk.archivedStatus = archivedStatus
        risk.archivedAt = archivedStatus ? new Date().toISOString() : null
      }
    }
  }

  async function addLawyerAnnotation(riskId: number, content: string, parentAnnotationId?: number) {
    if (isReadOnly.value) return null
    const resp = await useApiFetch<ContractAnnotationEntity>(
      `/api/v1/assistant/contract/reviews/${reviewId.value}/annotations`,
      { method: 'POST', body: { riskId, content, parentAnnotationId: parentAnnotationId ?? null } },
    )
    if (resp) workspace.value.annotations.push(resp)
    return resp
  }

  // 批注内容编辑累积 pending map（参考 useDocumentDraft 的 pendingFieldValues 模式）
  // 多次击键只会 debounce 500ms 后合并成一次 PATCH；避免每击键一次网络 round-trip
  const pendingAnnotationContent = new Map<number, string>()

  const flushAnnotationContent = useDebounceFn(async () => {
    if (pendingAnnotationContent.size === 0) return
    const entries = Array.from(pendingAnnotationContent.entries())
    pendingAnnotationContent.clear()
    await Promise.all(entries.map(async ([annotationId, content]) => {
      const resp = await useApiFetch(
        `/api/v1/assistant/contract/reviews/annotations/${annotationId}`,
        { method: 'PATCH', body: { content } },
      )
      if (resp) {
        const ann = workspace.value.annotations.find(a => a.id === annotationId)
        if (ann) ann.content = content
      }
    }))
  }, 500)

  async function updateAnnotation(annotationId: number, content: string) {
    if (isReadOnly.value) return
    // 本地乐观更新（UI 即时响应）
    const ann = workspace.value.annotations.find(a => a.id === annotationId)
    if (ann) ann.content = content
    // 写入 pending，500ms 防抖后统一 PATCH
    pendingAnnotationContent.set(annotationId, content)
    flushAnnotationContent()
  }

  /** 软删（服务端走 deletedAt；UI 层移除列表）*/
  async function deleteAnnotation(annotationId: number) {
    if (isReadOnly.value) return
    const resp = await useApiFetch(
      `/api/v1/assistant/contract/reviews/annotations/${annotationId}`,
      { method: 'DELETE' },
    )
    if (resp) {
      workspace.value.annotations = workspace.value.annotations.filter(a => a.id !== annotationId)
    }
  }

  async function updateVersionNote(versionId: number, lawyerNote: string | null) {
    const resp = await useApiFetch(
      `/api/v1/assistant/contract/reviews/versions/${versionId}`,
      { method: 'PATCH', body: { lawyerNote } },
    )
    if (resp) {
      const v = versions.value.find(x => x.id === versionId)
      if (v) v.lawyerNote = lawyerNote
    }
  }

  /** 工作区相对 currentVersion 是否有未快照的编辑（UI "N 处未保存编辑" 徽章用） */
  const hasUnsavedEdits = computed(() => {
    if (isReadOnly.value) return false
    if (!workspace.value.currentVersionId) return false
    // 简化实现：通过比较本地 workspace 与最近载入的 version snapshot 差异
    // 但因 workspace 是服务端权威数据源，前端难精确判定；最简单做法：每次刷新 workspace 时由后端返回 hasDifference 标志
    // Phase A 先用"风险表最新 updatedAt > 最新 version createdAt" 的启发式近似
    const latestRisk = workspace.value.risks.reduce((acc, r) => {
      const t = new Date(r.updatedAt).getTime()
      return t > acc ? t : acc
    }, 0)
    const latestAnn = workspace.value.annotations.reduce((acc, a) => {
      const t = new Date(a.createdAt).getTime()
      return t > acc ? t : acc
    }, 0)
    const currentVer = versions.value.find(v => v.id === workspace.value.currentVersionId)
    if (!currentVer) return false
    const verTime = new Date(currentVer.createdAt).getTime()
    return Math.max(latestRisk, latestAnn) > verTime
  })

  return {
    workspace,
    versions,
    previewVersionId,
    previewSnapshot,
    isReadOnly,
    currentView,
    hasUnsavedEdits,
    refreshWorkspace,
    refreshVersions,
    enterPreview,
    exitPreview,
    saveNewVersion,
    updateRiskArchivedStatus,
    addLawyerAnnotation,
    updateAnnotation,
    deleteAnnotation,
    updateVersionNote,
  }
}
```

- [ ] **Step 2: 测试**

`tests/app/composables/useContractReviewVersion.test.ts`：用 mock fetch 测
- 加载 workspace + versions 正确
- enterPreview / exitPreview 切换 isReadOnly 正确
- updateRiskArchivedStatus 在 isReadOnly=true 时静默不调用 API
- saveNewVersion 成功后 refresh 两个列表

- [ ] **Step 3: Commit**

---

# 子期 6 · 前端 UI 组件（Day 4）

## Task 6.1: ContractVersionTimeline 时间线组件（节点内联，不单独拆 NodeItem）

**Files:**
- Create: `app/components/assistant/contract/ContractVersionTimeline.vue`

- [ ] **Step 1: ContractVersionTimeline 骨架**

```vue
<script setup lang="ts">
// 自动导入：ref/computed/watch 不要显式 import
import { useLocalStorage } from '@vueuse/core'
import { ChevronLeft, ChevronRight, Pencil, Check, X } from 'lucide-vue-next'
import type { ContractReviewVersionEntity } from '#shared/types/contract'
import { VERSION_SYSTEM_LABEL_DISPLAY } from '#shared/types/contract'

const props = defineProps<{
  versions: ContractReviewVersionEntity[]
  currentVersionId: number | null
  previewVersionId: number | null  // null = 工作区
}>()
const emit = defineEmits<{
  'select-version': [versionId: number]
  'exit-preview': []
  'update-note': [versionId: number, note: string | null]
}>()

const collapsed = useLocalStorage('contract-timeline-collapsed', false)

// 每个节点的备注编辑态（key=versionId）
const editingNoteId = ref<number | null>(null)
const noteBuffer = ref('')

function beginEditNote(v: ContractReviewVersionEntity) {
  editingNoteId.value = v.id
  noteBuffer.value = v.lawyerNote ?? ''
}
function saveEditNote(v: ContractReviewVersionEntity) {
  emit('update-note', v.id, noteBuffer.value.trim() || null)
  editingNoteId.value = null
}
function cancelEditNote() {
  editingNoteId.value = null
}

function formatDate(s: string) {
  const d = new Date(s)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <aside
    :class="[
      'border-r bg-muted/30 transition-all duration-200 flex flex-col',
      collapsed ? 'w-[48px] py-3 items-center' : 'w-[220px] p-3',
    ]"
  >
    <!-- 折叠切换按钮 -->
    <button
      class="size-6 rounded border bg-background hover:border-primary flex items-center justify-center"
      :title="collapsed ? '展开时间线' : '收起时间线'"
      @click="collapsed = !collapsed"
    >
      <ChevronRight v-if="collapsed" class="size-3" />
      <ChevronLeft v-else class="size-3" />
    </button>

    <!-- 标题（展开态） -->
    <div v-if="!collapsed" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide my-2">
      版本时间线
    </div>

    <!-- 节点列表（节点结构内联，不再拆 NodeItem 组件）-->
    <div
      class="flex-1 overflow-y-auto mt-2 flex flex-col"
      :class="collapsed ? 'items-center gap-3' : 'gap-0'"
    >
      <template v-for="(v, idx) in versions" :key="v.id">
        <!-- 收缩态节点 -->
        <button
          v-if="collapsed"
          class="flex flex-col items-center relative"
          :title="`v${v.versionNumber} · ${VERSION_SYSTEM_LABEL_DISPLAY[v.systemLabel]} · ${formatDate(v.createdAt)}`"
          @click="emit('select-version', v.id)"
        >
          <div
            class="size-3 rounded-full"
            :class="previewVersionId === v.id ? 'bg-primary ring-4 ring-primary/20' : 'bg-muted-foreground/40'"
          />
          <span class="text-[10px] mt-0.5" :class="previewVersionId === v.id ? 'font-semibold' : ''">
            v{{ v.versionNumber }}
          </span>
          <div v-if="idx !== versions.length - 1" class="w-px h-4 bg-muted-foreground/30 mt-1" />
        </button>

        <!-- 展开态节点 -->
        <div
          v-else
          class="relative pl-5 pb-3"
          :class="previewVersionId === v.id ? 'border-l-2 border-primary' : 'border-l-2 border-muted-foreground/30'"
        >
          <div
            class="absolute -left-[9px] top-0.5 size-4 rounded-full"
            :class="previewVersionId === v.id ? 'bg-primary ring-4 ring-primary/20' : 'bg-muted-foreground/40'"
          />
          <div
            class="rounded p-2 cursor-pointer"
            :class="previewVersionId === v.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted'"
            @click="emit('select-version', v.id)"
          >
            <div class="text-xs font-medium" :class="previewVersionId === v.id ? 'text-primary' : ''">
              v{{ v.versionNumber }} · {{ VERSION_SYSTEM_LABEL_DISPLAY[v.systemLabel] }}
            </div>
            <div class="text-[11px] text-muted-foreground">{{ formatDate(v.createdAt) }}</div>

            <!-- 律师备注 -->
            <div v-if="editingNoteId !== v.id" class="mt-1 text-[11px] text-muted-foreground">
              <template v-if="v.lawyerNote">
                <span class="italic">{{ v.lawyerNote }}</span>
                <button class="ml-1 text-primary" @click.stop="beginEditNote(v)">
                  <Pencil class="inline size-3" />
                </button>
              </template>
              <button v-else class="text-primary underline text-[10px]" @click.stop="beginEditNote(v)">
                + 加备注
              </button>
            </div>
            <div v-else class="mt-1" @click.stop>
              <Textarea v-model="noteBuffer" :rows="2" :maxlength="200" class="text-[11px]" />
              <div class="flex gap-1 mt-1">
                <Button size="icon" class="size-6" @click="saveEditNote(v)">
                  <Check class="size-3" />
                </Button>
                <Button variant="outline" size="icon" class="size-6" @click="cancelEditNote">
                  <X class="size-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 返回工作区按钮（历史版本态时可见）-->
    <button
      v-if="!collapsed && previewVersionId !== null"
      class="mt-3 text-xs text-primary underline"
      @click="emit('exit-preview')"
    >
      ← 返回工作区
    </button>
  </aside>
</template>
```

- [ ] **Step 2: Commit**

---

## Task 6.2: ContractSaveVersionDialog

**Files:**
- Create: `app/components/assistant/contract/ContractSaveVersionDialog.vue`

- [ ] **Step 1: 实现**

```vue
<script setup lang="ts">
// 自动导入：ref/watch 不要显式 import
import { Loader2Icon } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': [lawyerNote: string | null]
}>()

const lawyerNote = ref('')
const submitting = ref(false)

watch(() => props.open, (v) => {
  if (!v) { lawyerNote.value = ''; submitting.value = false }
})

async function handleConfirm() {
  submitting.value = true
  try {
    emit('confirm', lawyerNote.value.trim() || null)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>保存新版本</DialogTitle>
      </DialogHeader>
      <div class="space-y-3 py-2">
        <p class="text-sm text-muted-foreground">
          把当前工作区状态定格为一个不可修改的版本快照。
        </p>
        <div>
          <Label class="text-xs">版本备注（可选）</Label>
          <Textarea
            v-model="lawyerNote"
            placeholder="例如：发张三法务审阅"
            :rows="3"
            :maxlength="200"
            class="mt-1"
          />
          <div class="text-[11px] text-muted-foreground text-right mt-1">{{ lawyerNote.length }} / 200</div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button :disabled="submitting" @click="handleConfirm">
          <Loader2Icon v-if="submitting" class="size-4 mr-1 animate-spin" />
          保存版本
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 2: Commit**

---

## Task 6.3: 只读横幅（不单独拆组件，直接内联到 ContractReviewPanel）

**设计决策**：只读横幅就是一个 div + 按钮，拆独立组件增加契约噪音，直接在 `ContractReviewPanel.vue` 模板里内联。Task 7.1 会包含这段模板。使用项目主题 token（`bg-muted` / `text-muted-foreground`）而非硬编码色值。

---

# 子期 7 · 集成联调（Day 5）

## Task 7.1: ContractReviewPanel 集成时间线 + 读写切换

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`

- [ ] **Step 1: 在 Panel 里接入 useContractReviewVersion**

```vue
<script setup lang="ts">
// 现有 import 保留
import { Info, ArrowLeft } from 'lucide-vue-next'
import { VERSION_SYSTEM_LABEL_DISPLAY } from '#shared/types/contract'
// useContractReviewVersion 是 composable，自动导入无需显式 import

// 在 setup 里
const reviewIdRef = computed(() => props.reviewId ?? 0)
const versioning = useContractReviewVersion(reviewIdRef)

onMounted(async () => {
  if (reviewIdRef.value) {
    await Promise.all([versioning.refreshWorkspace(), versioning.refreshVersions()])
  }
})

// 保存版本对话框状态
const saveDialogOpen = ref(false)
async function handleSaveVersion(note: string | null) {
  const ok = await versioning.saveNewVersion(note)
  if (ok) {
    toast.success('版本已保存')
    saveDialogOpen.value = false
  } else {
    toast.error('保存失败')
  }
}
</script>

<template>
  <div class="h-full flex">
    <!-- 时间线 -->
    <ContractVersionTimeline
      v-if="review"
      :versions="versioning.versions.value"
      :current-version-id="versioning.workspace.value.currentVersionId"
      :preview-version-id="versioning.previewVersionId.value"
      @select-version="versioning.enterPreview"
      @exit-preview="versioning.exitPreview"
      @update-note="(id, note) => versioning.updateVersionNote(id, note)"
    />

    <!-- 主内容区 -->
    <div class="flex-1 flex flex-col min-h-0">
      <!-- 只读横幅（内联，不拆组件）-->
      <div
        v-if="versioning.previewSnapshot.value"
        class="bg-muted border-b px-4 py-2 flex items-center justify-between text-sm"
      >
        <div class="flex items-center gap-2 text-muted-foreground">
          <Info class="size-4" />
          <span class="font-semibold">
            历史版本 · v{{ versioning.previewSnapshot.value.versionNumber }} ·
            {{ VERSION_SYSTEM_LABEL_DISPLAY[versioning.previewSnapshot.value.systemLabel] }} ·
            只读模式
          </span>
          <span class="text-xs">· 此版本不可编辑</span>
        </div>
        <Button size="sm" @click="versioning.exitPreview">
          <ArrowLeft class="size-3 mr-1" />
          返回工作区
        </Button>
      </div>

      <!-- 工具栏（非只读态才显示保存按钮） -->
      <div v-else class="border-b px-4 py-2 flex items-center justify-end gap-2">
        <span v-if="versioning.hasUnsavedEdits.value" class="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200">
          自 v{{ versioning.workspace.value.maxVersionNo }} 以来有编辑
        </span>
        <Button
          size="sm"
          :disabled="!versioning.hasUnsavedEdits.value"
          @click="saveDialogOpen = true"
        >
          保存新版本
        </Button>
      </div>

      <!-- 下方：docx 预览 + 风险清单（沿用现有组件，只 pass read-only 状态）-->
      <!-- ... 现有布局，加 :read-only="versioning.isReadOnly.value" ... -->
    </div>

    <!-- 保存对话框 -->
    <ContractSaveVersionDialog
      v-model:open="saveDialogOpen"
      @confirm="handleSaveVersion"
    />
  </div>
</template>
```

- [ ] **Step 2: Commit**

---

## Task 7.2: RiskListPanel 支持对话气泡 + 只读状态

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`

- [ ] **Step 1: 接入 annotations + readOnly 参数**

给 RiskListPanel 增加 prop `:read-only?: boolean`（默认 false）和 `:annotations`（或复用 risks[].annotations）。在每条风险卡片展开区域，渲染 annotation 列表：

```vue
<!-- 每条 risk 卡片内展开区域 -->
<div class="space-y-1.5 pl-2 border-l-2 border-slate-200">
  <div v-for="a in risk.annotations" :key="a.id" class="flex gap-1.5 items-start text-xs">
    <span :class="chipClass(a.authorType)" class="px-1 py-0 rounded text-[10px] h-fit shrink-0">
      {{ a.authorName }}
    </span>
    <div class="text-slate-700 leading-relaxed flex-1">{{ a.content }}</div>
    <button
      v-if="!readOnly && a.authorType === 'lawyer' && a.authorUserId === currentUserId"
      class="text-slate-400 hover:text-destructive"
      @click="deleteMyAnnotation(a.id)"
    >
      <Trash2Icon class="size-3" />
    </button>
  </div>
</div>

<!-- 回复框 -->
<div v-if="!readOnly" class="mt-2 pt-2 border-t border-dashed space-y-1">
  <textarea v-model="replyBuffers[risk.id]" class="w-full text-xs border rounded px-2 py-1" rows="2" placeholder="回复..." />
  <div class="flex items-center justify-between">
    <span class="text-[10px] text-muted-foreground">回复会在下次导出时合并进 Word 文件</span>
    <Button size="sm" @click="submitReply(risk.id)">发送</Button>
  </div>
</div>
<div v-else class="mt-2 pt-2 border-t border-dashed text-[10px] text-muted-foreground">
  只读模式，回复框已禁用
</div>
```

`chipClass` 辅助函数按 authorType 返回 `chip-ai` / `chip-me` / `chip-ext`。

- [ ] **Step 2: 处置风险按钮在只读态禁用**

```vue
<Button :disabled="readOnly" @click="$emit('archive', risk.id, 'handled')">标记处理</Button>
```

- [ ] **Step 3: 已处置风险降权样式（spec §7.4.1）**

对 `archivedStatus != null` 的风险：
- 卡片整体 `opacity-60 grayscale-[0.2]`
- 右侧徽章显示处置标签（已处理 / 已忽略），颜色柔和（`bg-muted text-muted-foreground`）
- 加一个顶部开关（RiskListPanel 头部）"隐藏已处置"（`useLocalStorage('contract-hide-archived-risks', false)`）
  - 开启后：`archivedStatus != null` 的风险折叠到底部一个 "已处置（N）· 点击展开" 区块
  - 默认关闭：已处置风险仍在清单内，只是视觉权重降低

代码片段：

```vue
<!-- 每条风险卡片 -->
<div
  :class="[
    'rounded-lg border border-l-4 bg-card p-2.5 text-xs',
    risk.level === 'high' ? 'border-l-rose-500' : risk.level === 'medium' ? 'border-l-amber-500' : 'border-l-emerald-500',
    risk.archivedStatus !== null ? 'opacity-60 grayscale-[0.2]' : '',
  ]"
>
  <div class="flex items-center justify-between">
    <span class="font-semibold">{{ risk.category }}</span>
    <span v-if="risk.archivedStatus" class="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
      {{ risk.archivedStatus === 'handled' ? '已处理' : '已忽略' }}
    </span>
  </div>
  <!-- 气泡对话线 + 回复框 -->
</div>

<!-- 头部开关 -->
<div class="flex items-center justify-between border-b p-2">
  <span>风险清单（{{ visibleRisks.length }}）</span>
  <label class="flex items-center gap-1 text-xs text-muted-foreground">
    <Switch v-model="hideArchived" />
    隐藏已处置
  </label>
</div>
```

- [ ] **Step 4: Commit**

---

## Task 7.3: 端到端手测

- [ ] **Step 1: 首次上传链路**
1. 上传合同 → AI 审查完成
2. 打开详情页，确认：
   - 时间线显示 "v1 · 初次上传"
   - 风险清单正常（从 `ContractRisk` 表来）
   - 每条风险有 AI annotation（展开后可见）

- [ ] **Step 2: 工作区编辑**
1. 处置一条风险为"已处理" → 刷新页面状态保留
2. 添加一条律师批注 → 刷新可见
3. "保存新版本"按钮变亮
4. 点击保存 → 输入备注 → 确认 → 时间线多一个 v2 节点

- [ ] **Step 3: 切换历史版本**
1. 点时间线 v1 节点 → 页面切只读模式，灰色横幅出现，按钮禁用
2. 风险清单显示 v1 状态（不含 v2 里加的律师批注）
3. 点"返回工作区"回到最新

- [ ] **Step 4: 编辑备注**
1. 时间线展开态点"+ 加备注" → 输入"发张三法务"→ 保存
2. 刷新页面，备注保留

- [ ] **Step 5: Commit**

---

## Task 7.4: 存量数据迁移执行 + 线上验证

- [ ] **Step 1: 在测试库跑一次迁移脚本，确认所有旧审查都生成了 v1 快照**

```bash
DATABASE_URL='postgres://...ls_new_testing' bun run scripts/migrate-contract-risks.ts
```

- [ ] **Step 2: 抽查 3 条旧审查**
- 查 DB：有 ContractRisk / ContractAnnotation / ContractReviewVersion 行
- 打开前端详情页确认展示正常
- 切到 v1 历史版本查看（只有 v1 的旧审查应只有 1 个时间线节点）

- [ ] **Step 3: 类型检查 + 测试总跑**

```bash
npx nuxi typecheck
npx vitest run
```

- [ ] **Step 4: Final Commit**

```bash
git commit -m "chore(contract): 合同审查多版本 Phase A 端到端联调与存量迁移验证"
```

---

## 完成标准（Phase A Done Definition）

- [ ] 所有子期（1-7）测试全绿
- [ ] `npx nuxi typecheck` 全绿
- [ ] 首次上传合同 → 自动生成 v1 initial_upload 快照
- [ ] 律师可在工作区处置风险、加/改/删律师批注，所有修改实时落库
- [ ] 律师可点"保存新版本"生成 lawyer_save 快照，时间线反映
- [ ] 律师可切换到历史版本查看只读快照
- [ ] 律师可点击时间线节点编辑备注
- [ ] 存量历史审查通过迁移脚本生成了 v1 快照
- [ ] 前端未保存编辑徽章表现符合预期

Phase A 完成后，本 Plan 的工作收敛。紧接进入 Phase B（上传新版本 + 客户批注识别）的 writing-plans。

---

## 风险点与回滚

- **迁移脚本失败**：已有 `contract_review_legacy_risks_backup` 表可回滚原始 JSON；在单独脚本里支持反向恢复（Phase A 不强制开发，但需要文档注明恢复方法）
- **AI 审查并发产生同 review 的多个 v1 快照**：`saveContractReviewVersionService` 已用 transaction + unique 约束保障；如遇并发实际失败，handler 返回 409 让前端重试
- **前端大规模 annotations 渲染性能**：单 review annotations > 500 条时虑加虚拟滚动 —— Phase A 不处理，Phase C 再评估
