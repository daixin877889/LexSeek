# 合同审查 · 多版本协作 Phase A 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建合同审查多版本的数据地基，让律师能做 "首次上传 → AI 审查 → 处置/加批注 → 手动保存版本 → 切换查看历史版本（只读）" 的基础闭环。

**Architecture:** 对齐项目内已验证的文书生成版本模式——主表（`ContractReview`）承载工作区实时状态，新增 `ContractReviewVersion` 表保存不可变快照；原 `ContractReview.risks` JSON 拆分到 `ContractRisk` 表，新增 `ContractAnnotation` 表承载对话气泡。前端按 `useDocumentDraft` 模式实现 `useContractReviewVersion` composable，实时 debounce PATCH 工作区；新增时间线组件 + 只读横幅 + 保存版本对话框。

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
- `server/services/assistant/contract/contractRisk.service.ts` — Risk 业务层
- `server/services/assistant/contract/contractAnnotation.dao.ts` — Annotation CRUD
- `server/services/assistant/contract/contractAnnotation.service.ts` — Annotation 业务层
- `server/services/assistant/contract/contractReviewVersion.dao.ts` — Version CRUD
- `server/services/assistant/contract/contractReviewVersion.service.ts` — 快照产生/读取
- `server/services/assistant/contract/contractReviewMigrate.service.ts` — 存量 risks JSON 迁移工具

**后端 API**
- `server/api/v1/assistant/contract/reviews/[id]/versions/index.get.ts` — 版本列表
- `server/api/v1/assistant/contract/reviews/[id]/versions/index.post.ts` — 手动保存新版本
- `server/api/v1/assistant/contract/reviews/[id]/versions/[versionId].get.ts` — 版本快照
- `server/api/v1/assistant/contract/reviews/[id]/versions/[versionId].patch.ts` — 更新备注
- `server/api/v1/assistant/contract/reviews/[id]/risks/[riskId].patch.ts` — 处置风险
- `server/api/v1/assistant/contract/reviews/[id]/annotations/index.post.ts` — 新增批注
- `server/api/v1/assistant/contract/reviews/[id]/annotations/[annotationId].patch.ts` — 修改批注
- `server/api/v1/assistant/contract/reviews/[id]/annotations/[annotationId].delete.ts` — 删除批注

**前端 Composable**
- `app/composables/useContractReviewVersion.ts` — 版本与快照管理

**前端 UI**
- `app/components/assistant/contract/ContractVersionTimeline.vue` — 时间线（收缩/展开两态）
- `app/components/assistant/contract/ContractVersionNodeItem.vue` — 单节点
- `app/components/assistant/contract/ContractSaveVersionDialog.vue` — 保存对话框
- `app/components/assistant/contract/ContractReadOnlyBanner.vue` — 历史版本只读横幅

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
- `app/components/assistant/contract/ContractReviewPanel.vue` — 集成时间线、读写状态切换、保存按钮
- `app/components/assistant/contract/RiskListPanel.vue` — 支持展示 annotation 对话线（Phase A 只 AI 批注，Phase B/C 扩展外部）

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

- [ ] **Step 2: 新建 `contractReviewVersions` 模型**

创建 `prisma/models/contractReviewVersion.prisma`：

```prisma
/// 合同审查历史版本快照（不可变）
model contractReviewVersions {
  id            Int      @id @default(autoincrement())
  reviewId      Int      @map("review_id")
  versionNumber Int      @map("version_number")
  /// 系统标签：initial_upload / client_return / lawyer_save / auto_backup
  systemLabel   String   @map("system_label") @db.VarChar(20)
  /// 律师备注（可选）
  lawyerNote    String?  @map("lawyer_note") @db.Text
  /// 本版快照时的 docx OSS 文件（上传类版本必有；纯逻辑快照可空）
  docxFileId    Int?     @map("docx_file_id")
  /// 完整快照 { risks[], annotations[], docxText, paragraphs }
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

- [ ] **Step 3: 新建 `contractRisks` 与 `contractAnnotations` 模型**

创建 `prisma/models/contractRiskAndAnnotation.prisma`：

```prisma
/// 合同审查风险（工作区实时态）
model contractRisks {
  id         Int    @id @default(autoincrement())
  reviewId   Int    @map("review_id")
  /// 来源：ai / external_new / global_review
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

  /// 处置状态：handled / ignored / client_removed（null=未处置）
  archivedStatus String?   @map("archived_status") @db.VarChar(20)
  archivedAt     DateTime? @map("archived_at")

  /// 当前锚点原文（正文变化后会刷新）
  anchorQuote          String  @map("anchor_quote") @db.Text
  anchorParagraphIndex Int?    @map("anchor_paragraph_index")
  anchorCharStart      Int?    @map("anchor_char_start")
  anchorCharEnd        Int?    @map("anchor_char_end")

  /// 迁移过的话保留最初原文（UI "原文已修改" 提示用）
  originalAnchorQuote String? @map("original_anchor_quote") @db.Text
  /// 当前版本无法定位锚点（孤立批注区）
  orphaned            Boolean @default(false)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  review      contractReviews       @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  annotations contractAnnotations[]

  @@index([reviewId, source])
  @@index([reviewId, archivedStatus])
  @@map("contract_risks")
}

/// 合同审查批注（对话气泡单元）
model contractAnnotations {
  id                 Int     @id @default(autoincrement())
  reviewId           Int     @map("review_id")
  riskId             Int     @map("risk_id")
  /// Word answer reply 父子关系
  parentAnnotationId Int?    @map("parent_annotation_id")
  /// 作者类型：ai / lawyer / external
  authorType         String  @map("author_type") @db.VarChar(10)
  /// 展示名（AI=固定 "AI" / lawyer=律师姓名 / external=Word author 原值）
  authorName         String  @map("author_name") @db.VarChar(100)
  /// 律师批注才有
  authorUserId       Int?    @map("author_user_id")
  content            String  @db.Text
  /// 系统给批注的稳定身份证（下次导出塞入 Word，回传时匹配）
  wordCommentRef     String? @map("word_comment_ref") @db.VarChar(50)
  /// 客户在 Word 里删了该批注（Phase B 开始用）
  removedByClient    Boolean @default(false) @map("removed_by_client")
  /// 下次导出跳过
  suppressInExport   Boolean @default(false) @map("suppress_in_export")

  createdAt DateTime @default(now()) @map("created_at")

  review           contractReviews       @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  risk             contractRisks         @relation(fields: [riskId], references: [id], onDelete: Cascade)
  parentAnnotation contractAnnotations?  @relation("AnnotationReply", fields: [parentAnnotationId], references: [id])
  replies          contractAnnotations[] @relation("AnnotationReply")
  authorUser       users?                @relation(fields: [authorUserId], references: [id])

  @@index([riskId, createdAt])
  @@index([wordCommentRef])
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

```bash
bun run prisma:migrate
DATABASE_URL='postgres://...ls_new_testing...' bun run prisma:push --accept-data-loss
```

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
export const VERSION_SYSTEM_LABELS = [
  'initial_upload',
  'client_return',
  'lawyer_save',
  'auto_backup',
] as const
export type VersionSystemLabel = typeof VERSION_SYSTEM_LABELS[number]

export const VERSION_SYSTEM_LABEL_DISPLAY: Record<VersionSystemLabel, string> = {
  initial_upload: '初次上传',
  client_return: '客户回传',
  lawyer_save: '律师保存',
  auto_backup: '自动备份',
}

export const RISK_SOURCES = ['ai', 'external_new', 'global_review'] as const
export type RiskSource = typeof RISK_SOURCES[number]

export const ANNOTATION_AUTHOR_TYPES = ['ai', 'lawyer', 'external'] as const
export type AnnotationAuthorType = typeof ANNOTATION_AUTHOR_TYPES[number]

export const RISK_ARCHIVED_STATUSES = ['handled', 'ignored', 'client_removed'] as const
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
  originalAnchorQuote: string | null
  orphaned: boolean
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
  wordCommentRef: string | null
  removedByClient: boolean
  suppressInExport: boolean
  createdAt: string
}

export interface ContractReviewVersionEntity {
  id: number
  reviewId: number
  versionNumber: number
  systemLabel: VersionSystemLabel
  lawyerNote: string | null
  docxFileId: number | null
  createdById: number
  createdByName: string
  createdAt: string
  // 变更徽章用（列表接口计算派生）
  stats?: {
    aiRiskCount: number
    externalNewCount: number
    docxChangedParagraphs: number
  }
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
    paragraphs: Array<{ index: number; text: string; offsetStart: number; offsetEnd: number }>
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
  originalAnchorQuote?: string | null
  orphaned?: boolean
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
- `create` 写入（含 `authorType`、`authorName`、`wordCommentRef`）
- `create` 含 `parentAnnotationId` 时成功建立父子关系
- `list` 按 riskId 返回按 `createdAt` 升序
- `update content` / `update suppressInExport` 生效
- `delete` 成功（前置 riskId 存在）

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
  wordCommentRef?: string | null
}

export async function createContractAnnotationDAO(input: CreateContractAnnotationInput): Promise<contractAnnotations> {
  return prisma.contractAnnotations.create({ data: input })
}

export async function updateContractAnnotationDAO(
  id: number,
  input: Partial<Pick<contractAnnotations, 'content' | 'suppressInExport'>>,
): Promise<contractAnnotations> {
  return prisma.contractAnnotations.update({ where: { id }, data: input })
}

export async function listContractAnnotationsByRiskDAO(riskId: number): Promise<contractAnnotations[]> {
  return prisma.contractAnnotations.findMany({
    where: { riskId },
    orderBy: { createdAt: 'asc' },
  })
}

export async function listContractAnnotationsByReviewDAO(reviewId: number): Promise<contractAnnotations[]> {
  return prisma.contractAnnotations.findMany({
    where: { reviewId },
    orderBy: [{ riskId: 'asc' }, { createdAt: 'asc' }],
  })
}

export async function deleteContractAnnotationDAO(id: number): Promise<void> {
  await prisma.contractAnnotations.delete({ where: { id } })
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
  docxFileId?: number | null
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
      docxFileId: true,
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

**设计决策**：`contractReviews` 主表**不新增** `docxText` / `paragraphs` 字段。工作区的"正文和段落结构"始终等同于 `currentVersionId` 所指向 snapshot 里的 docxText/paragraphs（Phase A 律师不改正文；Phase B 上传新 docx 时会产生新快照，currentVersionId 会指向新快照）。`saveContractReviewVersionService` 入参支持可选覆盖：首次快照（`initial_upload` / `client_return`）由调用方显式传入 docxText/paragraphs；`lawyer_save` / `auto_backup` 从 currentVersion 继承。

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
  docxFileId?: number | null
  createdById: number
  /**
   * 正文 + 段落结构。首次快照（initial_upload / client_return）由调用方显式传入；
   * 其它场景（lawyer_save / auto_backup）传 undefined → 自动从 currentVersion snapshot 继承。
   */
  docxText?: string
  paragraphs?: Array<{ index: number; text: string; offsetStart: number; offsetEnd: number }>
}

/**
 * 原子操作：递增 maxVersionNo → 创建快照记录 → 更新 currentVersionId
 * 整个过程在 prisma transaction 内完成，避免并发冲突
 */
export async function saveContractReviewVersionService(input: SaveVersionInput) {
  const { reviewId, systemLabel, lawyerNote, docxFileId, createdById } = input

  return prisma.$transaction(async (tx) => {
    // 1. 原子递增 + 读当前 currentVersionId 用于继承 docxText/paragraphs
    const review = await tx.contractReviews.update({
      where: { id: reviewId },
      data: { maxVersionNo: { increment: 1 } },
      select: { maxVersionNo: true, currentVersionId: true },
    })
    const versionNumber = review.maxVersionNo

    // 2. 从入参或当前版本继承 docxText / paragraphs
    let docxText = input.docxText ?? ''
    let paragraphs = input.paragraphs ?? []
    if (!input.docxText && review.currentVersionId) {
      const prev = await tx.contractReviewVersions.findUnique({
        where: { id: review.currentVersionId },
        select: { snapshotData: true },
      })
      const prevSnap = prev?.snapshotData as { docxText?: string; paragraphs?: typeof paragraphs } | undefined
      docxText = prevSnap?.docxText ?? ''
      paragraphs = prevSnap?.paragraphs ?? []
    }

    // 3. 拿当前工作区 risks + annotations
    const [risks, annotations] = await Promise.all([
      tx.contractRisks.findMany({ where: { reviewId }, orderBy: { createdAt: 'asc' } }),
      tx.contractAnnotations.findMany({ where: { reviewId }, orderBy: [{ riskId: 'asc' }, { createdAt: 'asc' }] }),
    ])

    const snapshotData = { risks, annotations, docxText, paragraphs }

    // 4. 创建版本
    const version = await tx.contractReviewVersions.create({
      data: {
        reviewId,
        versionNumber,
        systemLabel,
        lawyerNote: lawyerNote ?? null,
        docxFileId: docxFileId ?? null,
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
    paragraphs: Array<{ index: number; text: string; offsetStart: number; offsetEnd: number }>
  }

  return {
    id: version.id,
    reviewId: version.reviewId,
    versionNumber: version.versionNumber,
    systemLabel: version.systemLabel as VersionSystemLabel,
    lawyerNote: version.lawyerNote,
    docxFileId: version.docxFileId,
    createdById: version.createdById,
    createdByName: '', // 需 JOIN users
    createdAt: version.createdAt.toISOString(),
    snapshot,
  }
}

/**
 * 判断工作区相对 currentVersionId 是否有编辑差异
 * 用于 auto_backup 幂等规则（spec §4.3.1）
 */
export async function hasWorkspaceDifferenceAgainstCurrentVersionService(reviewId: number): Promise<boolean> {
  const review = await prisma.contractReviews.findUnique({
    where: { id: reviewId },
    select: { currentVersionId: true, updatedAt: true },
  })
  if (!review?.currentVersionId) return true // 没有基准版本，视为有差异

  const current = await getContractReviewVersionByIdDAO(review.currentVersionId)
  if (!current) return true

  // 比较最新子表 updatedAt 与 version.createdAt
  const [latestRisk, latestAnnotation] = await Promise.all([
    prisma.contractRisks.findFirst({ where: { reviewId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.contractAnnotations.findFirst({ where: { reviewId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ])

  const latestEditAt = Math.max(latestRisk?.updatedAt?.getTime() ?? 0, latestAnnotation?.createdAt.getTime() ?? 0)
  return latestEditAt > current.createdAt.getTime()
}
```


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

- [ ] **Step 1: contractRisk.service.ts**

```ts
// server/services/assistant/contract/contractRisk.service.ts
import type { RiskArchivedStatus } from '#shared/types/contract'
import { getContractRiskByIdDAO, updateContractRiskDAO } from './contractRisk.dao'
import { getContractReviewOwnerIdDAO } from './contractReview.dao' // 现有

/**
 * 更新风险处置状态：必须是该 review 的 owner
 * @returns updated risk，权限不足抛 403
 */
export async function updateContractRiskStatusService(params: {
  riskId: number
  ownerUserId: number
  archivedStatus: RiskArchivedStatus | null
}) {
  const risk = await getContractRiskByIdDAO(params.riskId)
  if (!risk) throw createError({ statusCode: 404, statusMessage: 'Risk not found' })

  const ownerId = await getContractReviewOwnerIdDAO(risk.reviewId)
  if (ownerId !== params.ownerUserId) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  return updateContractRiskDAO(params.riskId, { archivedStatus: params.archivedStatus })
}
```

- [ ] **Step 2: contractAnnotation.service.ts**

```ts
// server/services/assistant/contract/contractAnnotation.service.ts
import type { AnnotationAuthorType } from '#shared/types/contract'
import { createContractAnnotationDAO, updateContractAnnotationDAO, deleteContractAnnotationDAO, getContractAnnotationByIdDAO } from './contractAnnotation.dao'
import { getContractRiskByIdDAO } from './contractRisk.dao'
import { getContractReviewOwnerIdDAO } from './contractReview.dao'

export async function createLawyerAnnotationService(params: {
  reviewId: number
  riskId: number
  content: string
  parentAnnotationId?: number | null
  user: { id: number; name: string }
}) {
  // 归属校验
  const risk = await getContractRiskByIdDAO(params.riskId)
  if (!risk || risk.reviewId !== params.reviewId) {
    throw createError({ statusCode: 404, statusMessage: 'Risk not found' })
  }
  const ownerId = await getContractReviewOwnerIdDAO(params.reviewId)
  if (ownerId !== params.user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  return createContractAnnotationDAO({
    reviewId: params.reviewId,
    riskId: params.riskId,
    parentAnnotationId: params.parentAnnotationId ?? null,
    authorType: 'lawyer' as AnnotationAuthorType,
    authorName: params.user.name,
    authorUserId: params.user.id,
    content: params.content,
  })
}

export async function updateAnnotationContentService(params: {
  annotationId: number
  ownerUserId: number
  content: string
}) {
  const ann = await getContractAnnotationByIdDAO(params.annotationId)
  if (!ann) throw createError({ statusCode: 404 })
  if (ann.authorUserId !== params.ownerUserId) {
    // 只能改自己的
    throw createError({ statusCode: 403, statusMessage: '只能修改自己的批注' })
  }
  return updateContractAnnotationDAO(params.annotationId, { content: params.content })
}

export async function deleteAnnotationService(params: {
  annotationId: number
  ownerUserId: number
}) {
  const ann = await getContractAnnotationByIdDAO(params.annotationId)
  if (!ann) return
  if (ann.authorUserId !== params.ownerUserId) {
    throw createError({ statusCode: 403, statusMessage: '只能删除自己的批注' })
  }
  await deleteContractAnnotationDAO(params.annotationId)
}
```

- [ ] **Step 3: Commit**

```bash
git add server/services/assistant/contract/contractRisk.service.ts server/services/assistant/contract/contractAnnotation.service.ts
git commit -m "feat(contract): Risk/Annotation 业务 service（含归属校验）"
```

---

# 子期 3 · 后端 API（Day 2）

所有 API 路径都在 `/api/v1/assistant/contract/reviews/:id/**`，沿用现有 owner-only 校验（参考 `server/api/v1/assistant/contract/reviews/[id].get.ts`）。

## Task 3.1: GET 版本列表

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/versions/index.get.ts`

- [ ] **Step 1: 实现**

```ts
// GET /api/v1/assistant/contract/reviews/:id/versions
export default defineEventHandler(async (event) => {
  const reviewId = Number(event.context.params?.id)
  const userId = event.context.auth?.user?.id
  if (!userId) return resError('未登录', 401)
  if (!reviewId) return resError('参数错误', 400)

  const review = await prisma.contractReviews.findUnique({
    where: { id: reviewId },
    select: { id: true, userId: true, currentVersionId: true, maxVersionNo: true },
  })
  if (!review) return resError('审查不存在', 404)
  if (review.userId !== userId) return resError('无权访问', 403)

  const versions = await listContractReviewVersionsDAO(reviewId)
  return resSuccess({
    versions: versions.map(v => ({
      id: v.id,
      reviewId: v.reviewId,
      versionNumber: v.versionNumber,
      systemLabel: v.systemLabel,
      lawyerNote: v.lawyerNote,
      docxFileId: v.docxFileId,
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
- Create: `server/api/v1/assistant/contract/reviews/[id]/versions/index.post.ts`

- [ ] **Step 1: 实现**

```ts
// POST /api/v1/assistant/contract/reviews/:id/versions
// body: { lawyerNote?: string }
// 返回新创建的版本元信息
export default defineEventHandler(async (event) => {
  const reviewId = Number(event.context.params?.id)
  const user = event.context.auth?.user
  if (!user) return resError('未登录', 401)
  if (!reviewId) return resError('参数错误', 400)

  const body = await readBody<{ lawyerNote?: string }>(event)

  const review = await prisma.contractReviews.findUnique({
    where: { id: reviewId },
    select: { userId: true, status: true },
  })
  if (!review) return resError('审查不存在', 404)
  if (review.userId !== user.id) return resError('无权操作', 403)

  // 只有 completed/awaiting_stance 之外的"稳定"状态才能保存版本
  if (['pending', 'reviewing', 'awaiting_stance', 'rebuilding'].includes(review.status)) {
    return resError('审查进行中，请等待完成再保存版本', 409)
  }

  const version = await saveContractReviewVersionService({
    reviewId,
    systemLabel: 'lawyer_save',
    lawyerNote: body?.lawyerNote ?? null,
    createdById: user.id,
  })

  return resSuccess({
    id: version.id,
    versionNumber: version.versionNumber,
    systemLabel: version.systemLabel,
    lawyerNote: version.lawyerNote,
    createdAt: version.createdAt.toISOString(),
  })
})
```

- [ ] **Step 2: Commit**

---

## Task 3.3: GET 版本快照详情（含 snapshotData）

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/versions/[versionId].get.ts`

```ts
// GET /api/v1/assistant/contract/reviews/:id/versions/:versionId
export default defineEventHandler(async (event) => {
  const reviewId = Number(event.context.params?.id)
  const versionId = Number(event.context.params?.versionId)
  const userId = event.context.auth?.user?.id
  if (!userId) return resError('未登录', 401)

  // 归属校验
  const review = await prisma.contractReviews.findUnique({ where: { id: reviewId }, select: { userId: true } })
  if (!review || review.userId !== userId) return resError('无权访问', 403)

  const snapshot = await loadContractReviewVersionSnapshotService(versionId)
  if (snapshot.reviewId !== reviewId) return resError('版本不属于该审查', 403)

  return resSuccess(snapshot)
})
```

- [ ] Commit

---

## Task 3.4: PATCH 版本备注

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/versions/[versionId].patch.ts`

```ts
// PATCH body: { lawyerNote: string | null }
export default defineEventHandler(async (event) => {
  const reviewId = Number(event.context.params?.id)
  const versionId = Number(event.context.params?.versionId)
  const userId = event.context.auth?.user?.id
  if (!userId) return resError('未登录', 401)

  const body = await readBody<{ lawyerNote: string | null }>(event)
  if (body?.lawyerNote && body.lawyerNote.length > 200) return resError('备注过长（最多 200 字）', 400)

  const review = await prisma.contractReviews.findUnique({ where: { id: reviewId }, select: { userId: true } })
  if (!review || review.userId !== userId) return resError('无权操作', 403)

  const updated = await updateContractReviewVersionNoteDAO(versionId, body.lawyerNote ?? null)
  return resSuccess({ id: updated.id, lawyerNote: updated.lawyerNote })
})
```

- [ ] Commit

---

## Task 3.5: PATCH 处置风险

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/risks/[riskId].patch.ts`

```ts
// PATCH body: { archivedStatus: 'handled' | 'ignored' | null }
export default defineEventHandler(async (event) => {
  const reviewId = Number(event.context.params?.id)
  const riskId = Number(event.context.params?.riskId)
  const user = event.context.auth?.user
  if (!user) return resError('未登录', 401)

  const body = await readBody<{ archivedStatus: 'handled' | 'ignored' | null }>(event)
  if (body.archivedStatus !== null && !['handled', 'ignored'].includes(body.archivedStatus)) {
    return resError('非法状态', 400)
  }

  // 通过 service 做归属校验
  const updated = await updateContractRiskStatusService({
    riskId,
    ownerUserId: user.id,
    archivedStatus: body.archivedStatus,
  })

  // 额外校验 review id 一致
  if (updated.reviewId !== reviewId) return resError('Risk 不属于该审查', 403)

  return resSuccess({
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
- Create: `server/api/v1/assistant/contract/reviews/[id]/annotations/index.post.ts`

```ts
// POST body: { riskId: number; content: string; parentAnnotationId?: number }
export default defineEventHandler(async (event) => {
  const reviewId = Number(event.context.params?.id)
  const user = event.context.auth?.user
  if (!user) return resError('未登录', 401)

  const body = await readBody<{ riskId: number; content: string; parentAnnotationId?: number | null }>(event)
  if (!body?.riskId || !body?.content?.trim()) return resError('参数错误', 400)
  if (body.content.length > 2000) return resError('批注内容过长（最多 2000 字）', 400)

  const annotation = await createLawyerAnnotationService({
    reviewId,
    riskId: body.riskId,
    content: body.content.trim(),
    parentAnnotationId: body.parentAnnotationId ?? null,
    user: { id: user.id, name: user.name ?? '律师' },
  })

  return resSuccess({
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
- Create: `server/api/v1/assistant/contract/reviews/[id]/annotations/[annotationId].patch.ts`

```ts
// PATCH body: { content: string }
export default defineEventHandler(async (event) => {
  const reviewId = Number(event.context.params?.id)
  const annotationId = Number(event.context.params?.annotationId)
  const user = event.context.auth?.user
  if (!user) return resError('未登录', 401)

  const body = await readBody<{ content: string }>(event)
  if (!body?.content?.trim()) return resError('参数错误', 400)
  if (body.content.length > 2000) return resError('批注内容过长', 400)

  const updated = await updateAnnotationContentService({
    annotationId,
    ownerUserId: user.id,
    content: body.content.trim(),
  })

  if (updated.reviewId !== reviewId) return resError('批注不属于该审查', 403)
  return resSuccess({ id: updated.id, content: updated.content })
})
```

- [ ] Commit

---

## Task 3.8: DELETE 删除批注

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/annotations/[annotationId].delete.ts`

```ts
export default defineEventHandler(async (event) => {
  const annotationId = Number(event.context.params?.annotationId)
  const user = event.context.auth?.user
  if (!user) return resError('未登录', 401)

  await deleteAnnotationService({ annotationId, ownerUserId: user.id })
  return resSuccess({ deleted: true })
})
```

- [ ] Commit

---

## Task 3.9: 改造 GET /reviews/:id 返回工作区结构化数据

**Files:**
- Modify: `server/api/v1/assistant/contract/reviews/[id].get.ts`

- [ ] **Step 1: 调整返回结构**

现有接口返回 `{ ...review, risks: [] }`（风险从 JSON 读）。改造成从 `ContractRisk` + `ContractAnnotation` 表读，保持返回 shape 向下兼容：

```ts
// 伪代码：在 handler 内拼接工作区视图
const [risks, annotations] = await Promise.all([
  listContractRisksDAO(reviewId),
  listContractAnnotationsByReviewDAO(reviewId),
])

// 按 riskId 把 annotations 挂到对应 risk 下，保留原有前端 shape 需要的字段
const risksWithAnnotations = risks.map(r => ({
  ...r,
  annotations: annotations.filter(a => a.riskId === r.id),
}))

return resSuccess({
  ...reviewMeta,
  risks: risksWithAnnotations,   // 现有前端兼容
  playbookSnapshot: reviewMeta.playbookSnapshot,
  currentVersionId: reviewMeta.currentVersionId,
  maxVersionNo: reviewMeta.maxVersionNo,
})
```

> 注意：Phase A 末尾存量数据未迁移时，若 `ContractRisk` 表为空，**fallback 回读 `review.risks` JSON** 保证旧审查不崩。Phase A 完成后 Task 4.2 数据迁移完成，所有记录都有行了，可删除 fallback 分支（本 PR 保留 fallback）。

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
3. 在调 `saveContractReviewVersionService` 时**显式传入** `docxText` 和 `paragraphs`（从合同解析阶段拿到），这两份内容会存进 snapshot；后续版本（lawyer_save / auto_backup）通过 currentVersionId 自动继承这两份内容
4. 调 `saveContractReviewVersionService` 创建 v1 快照（`systemLabel=initial_upload`, `docxFileId=合同文件id`, `createdById=user.id`, `docxText`, `paragraphs`）

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
    wordCommentRef: `LEXSEEK-${risk.id}-${randomId(8)}`,
  })
}

// 显式传入 docxText 和 paragraphs，存进 v1 snapshot
await saveContractReviewVersionService({
  reviewId,
  systemLabel: 'initial_upload',
  docxFileId: review.reviewedFileId ?? review.originalFileId,
  createdById: userId,
  docxText: parsedDocxText,       // 从解析步骤拿到
  paragraphs: parsedParagraphs,   // 从解析步骤拿到
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
      wordCommentRef: `LEXSEEK-${risk.id}-${randomId(8)}`,
    })
    created++
  }

  await saveContractReviewVersionService({
    reviewId,
    systemLabel: 'initial_upload',
    docxFileId: review.reviewedFileId ?? review.originalFileId,
    createdById: review.userId,
    docxText: '',         // 存量迁移不强制回填正文（Phase A 只读历史版本时显示空正文可接受）
    paragraphs: [],       // Phase B 上传新版本需要正文 diff 时，再单独写回填脚本
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

- [ ] **Step 4: 备份原 risks 字段到 legacy 备份表**

在 migration.sql 的最后追加（或新开一个迁移）：

```sql
CREATE TABLE IF NOT EXISTS contract_review_legacy_risks_backup (
  review_id INT PRIMARY KEY,
  risks JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO contract_review_legacy_risks_backup (review_id, risks)
SELECT id, risks FROM contract_reviews WHERE risks IS NOT NULL AND jsonb_array_length(risks) > 0
ON CONFLICT (review_id) DO NOTHING;
```

- [ ] **Step 5: Commit**

---

# 子期 5 · 前端 Composable（Day 3）

## Task 5.1: useContractReviewVersion composable

**Files:**
- Create: `app/composables/useContractReviewVersion.ts`
- Create: `tests/app/composables/useContractReviewVersion.test.ts`

- [ ] **Step 1: 实现（参考 `app/composables/useDocumentDraft.ts` 模式）**

```ts
// app/composables/useContractReviewVersion.ts
import { ref, computed, watch } from 'vue'
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
      `/api/v1/assistant/contract/reviews/${reviewId.value}/versions/${versionId}`,
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

  /** 处置风险（debounce 不必要，单次操作直接 PATCH） */
  async function updateRiskArchivedStatus(riskId: number, archivedStatus: RiskArchivedStatus | null) {
    if (isReadOnly.value) return
    const resp = await useApiFetch(
      `/api/v1/assistant/contract/reviews/${reviewId.value}/risks/${riskId}`,
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

  async function updateAnnotation(annotationId: number, content: string) {
    if (isReadOnly.value) return
    const resp = await useApiFetch(
      `/api/v1/assistant/contract/reviews/${reviewId.value}/annotations/${annotationId}`,
      { method: 'PATCH', body: { content } },
    )
    if (resp) {
      const ann = workspace.value.annotations.find(a => a.id === annotationId)
      if (ann) ann.content = content
    }
  }

  async function deleteAnnotation(annotationId: number) {
    if (isReadOnly.value) return
    const resp = await useApiFetch(
      `/api/v1/assistant/contract/reviews/${reviewId.value}/annotations/${annotationId}`,
      { method: 'DELETE' },
    )
    if (resp) {
      workspace.value.annotations = workspace.value.annotations.filter(a => a.id !== annotationId)
    }
  }

  async function updateVersionNote(versionId: number, lawyerNote: string | null) {
    const resp = await useApiFetch(
      `/api/v1/assistant/contract/reviews/${reviewId.value}/versions/${versionId}`,
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

## Task 6.1: ContractVersionTimeline 时间线组件

**Files:**
- Create: `app/components/assistant/contract/ContractVersionTimeline.vue`
- Create: `app/components/assistant/contract/ContractVersionNodeItem.vue`

- [ ] **Step 1: ContractVersionTimeline 骨架**

```vue
<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import type { ContractReviewVersionEntity } from '#shared/types/contract'

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
function toggle() { collapsed.value = !collapsed.value }

function isActive(versionId: number) {
  return props.previewVersionId === versionId
}
function isCurrent(versionId: number) {
  return props.currentVersionId === versionId
}
</script>

<template>
  <aside
    :class="[
      'border-r bg-slate-50 transition-all duration-200 flex flex-col',
      collapsed ? 'w-[48px] py-3 items-center' : 'w-[220px] p-3',
    ]"
  >
    <!-- 折叠切换按钮 -->
    <button
      class="size-6 rounded border bg-white hover:border-primary flex items-center justify-center"
      :title="collapsed ? '展开时间线' : '收起时间线'"
      @click="toggle"
    >
      <ChevronRight v-if="collapsed" class="size-3" />
      <ChevronLeft v-else class="size-3" />
    </button>

    <!-- 标题（展开态） -->
    <div v-if="!collapsed" class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide my-2">
      版本时间线
    </div>

    <!-- 节点列表 -->
    <div class="flex-1 overflow-y-auto mt-2 flex flex-col" :class="collapsed ? 'items-center gap-3' : 'gap-0'">
      <ContractVersionNodeItem
        v-for="(v, idx) in versions"
        :key="v.id"
        :version="v"
        :collapsed="collapsed"
        :active="isActive(v.id)"
        :is-current="isCurrent(v.id)"
        :is-last="idx === versions.length - 1"
        @click="$emit('select-version', v.id)"
        @update-note="(note) => $emit('update-note', v.id, note)"
      />
    </div>

    <!-- 工作区节点（最顶） -->
    <button
      v-if="!collapsed && previewVersionId !== null"
      class="mt-3 text-xs text-primary underline"
      @click="$emit('exit-preview')"
    >
      ← 返回工作区
    </button>
  </aside>
</template>
```

- [ ] **Step 2: ContractVersionNodeItem 骨架**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { Pencil, Check, X } from 'lucide-vue-next'
import type { ContractReviewVersionEntity } from '#shared/types/contract'
import { VERSION_SYSTEM_LABEL_DISPLAY } from '#shared/types/contract'

const props = defineProps<{
  version: ContractReviewVersionEntity
  collapsed: boolean
  active: boolean
  isCurrent: boolean
  isLast: boolean
}>()
const emit = defineEmits<{
  click: []
  'update-note': [note: string | null]
}>()

const editingNote = ref(false)
const noteBuffer = ref(props.version.lawyerNote ?? '')

function beginEdit() {
  noteBuffer.value = props.version.lawyerNote ?? ''
  editingNote.value = true
}
function saveNote() {
  emit('update-note', noteBuffer.value.trim() || null)
  editingNote.value = false
}
function cancelEdit() {
  editingNote.value = false
}

const labelText = computed(() => VERSION_SYSTEM_LABEL_DISPLAY[props.version.systemLabel])
const formattedDate = computed(() => {
  const d = new Date(props.version.createdAt)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
</script>

<template>
  <!-- 收缩态 -->
  <button
    v-if="collapsed"
    class="flex flex-col items-center relative"
    :title="`v${version.versionNumber} · ${labelText} · ${formattedDate}`"
    @click="emit('click')"
  >
    <div class="size-3 rounded-full" :class="active ? 'bg-primary ring-4 ring-primary-100' : 'bg-slate-300'" />
    <span class="text-[10px] mt-0.5" :class="active ? 'font-semibold' : ''">v{{ version.versionNumber }}</span>
    <div v-if="!isLast" class="w-px h-4 bg-slate-300 mt-1" />
  </button>

  <!-- 展开态 -->
  <div
    v-else
    class="relative pl-5 pb-3"
    :class="active ? 'border-l-2 border-primary' : 'border-l-2 border-slate-300'"
  >
    <div
      class="absolute -left-[9px] top-0.5 size-4 rounded-full"
      :class="active ? 'bg-primary ring-4 ring-primary-100' : 'bg-slate-300'"
    />
    <div
      class="rounded p-2 cursor-pointer"
      :class="active ? 'bg-primary-50 border border-primary-200' : 'hover:bg-slate-100'"
      @click="emit('click')"
    >
      <div class="text-xs font-medium" :class="active ? 'text-primary-700' : ''">
        v{{ version.versionNumber }} · {{ labelText }}
      </div>
      <div class="text-[11px] text-muted-foreground">{{ formattedDate }}</div>

      <!-- 律师备注 -->
      <div v-if="!editingNote" class="mt-1 text-[11px] text-slate-600">
        <template v-if="version.lawyerNote">
          <span class="italic">{{ version.lawyerNote }}</span>
          <button class="ml-1 text-primary" @click.stop="beginEdit"><Pencil class="inline size-3" /></button>
        </template>
        <button v-else class="text-primary underline text-[10px]" @click.stop="beginEdit">+ 加备注</button>
      </div>
      <div v-else class="mt-1" @click.stop>
        <textarea v-model="noteBuffer" class="w-full text-[11px] border rounded p-1" rows="2" maxlength="200" />
        <div class="flex gap-1 mt-1">
          <button class="text-[10px] px-1.5 py-0.5 bg-primary text-white rounded" @click="saveNote"><Check class="inline size-3" /></button>
          <button class="text-[10px] px-1.5 py-0.5 border rounded" @click="cancelEdit"><X class="inline size-3" /></button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Commit**

---

## Task 6.2: ContractSaveVersionDialog

**Files:**
- Create: `app/components/assistant/contract/ContractSaveVersionDialog.vue`

- [ ] **Step 1: 实现**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
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

## Task 6.3: ContractReadOnlyBanner

**Files:**
- Create: `app/components/assistant/contract/ContractReadOnlyBanner.vue`

- [ ] **Step 1: 实现**

```vue
<script setup lang="ts">
import { ArrowLeft, Info } from 'lucide-vue-next'
import type { ContractReviewVersionEntity } from '#shared/types/contract'
import { VERSION_SYSTEM_LABEL_DISPLAY } from '#shared/types/contract'

const props = defineProps<{ version: ContractReviewVersionEntity }>()
const emit = defineEmits<{ 'exit': [] }>()

const formattedDate = computed(() => new Date(props.version.createdAt).toLocaleString('zh-CN', { hour12: false }))
const labelText = computed(() => VERSION_SYSTEM_LABEL_DISPLAY[props.version.systemLabel])
</script>

<template>
  <div class="bg-slate-200 border-b border-slate-300 px-4 py-2 flex items-center justify-between text-sm">
    <div class="flex items-center gap-2 text-slate-700">
      <Info class="size-4" />
      <span class="font-semibold">历史版本 · v{{ version.versionNumber }} · {{ labelText }} · {{ formattedDate }} · 只读模式</span>
      <span class="text-xs text-slate-500">· 此版本不可编辑</span>
    </div>
    <Button size="sm" @click="emit('exit')">
      <ArrowLeft class="size-3 mr-1" />
      返回工作区
    </Button>
  </div>
</template>
```

- [ ] **Step 2: Commit**

---

# 子期 7 · 集成联调（Day 5）

## Task 7.1: ContractReviewPanel 集成时间线 + 读写切换

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`

- [ ] **Step 1: 在 Panel 里接入 useContractReviewVersion**

```vue
<script setup lang="ts">
// 现有 import ...
import { useContractReviewVersion } from '~/composables/useContractReviewVersion'

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
      <!-- 只读横幅 -->
      <ContractReadOnlyBanner
        v-if="versioning.previewSnapshot.value"
        :version="versioning.previewSnapshot.value as any"
        @exit="versioning.exitPreview"
      />

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

- [ ] **Step 3: Commit**

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
git commit -m "chore(contract): Phase A 子期 7 · 端到端联调与存量迁移验证"
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
