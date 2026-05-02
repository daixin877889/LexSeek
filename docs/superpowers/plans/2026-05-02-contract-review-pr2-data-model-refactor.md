# 合同审查 · PR 2 · 数据模型重构（双锚点）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `contract_risks` 表从单锚点（`anchor_*` 5 字段）重构为"完整条款 + 精确问题片段"双锚点（`clause_*` + `quote_*` 9 字段），同步刷新 shared types / server service / 前端字段读取。架构变更（schema）由 `prisma migrate dev` 自动生成迁移，**不手写迁移脚本**；老 review/risk/annotation 数据由开发者在自己的 dev 库 `TRUNCATE` 清场（**不进 migration、不进 seedData.sql**——合同审查未上线，生产无数据可清）。schema 落地后整个 server + app 必须 typecheck 通过、全量测试 PASS。

**Architecture:** 改动按"schema → 类型 → 后端 service → 后端测试 → 前端 surgical 改名 → 前端测试 → 收尾"线性推进，每步完成一个独立 commit。所有调用方改字段名时遵循"surgical 改动"原则——只改字段名映射，不调 UI 行为、不删未使用代码、不重构无关结构。`commentInjector.ts` 自身入参字段名（`anchorQuote` / `anchorParagraphIndex`）保留不动（docx 注入工具内部语义稳定），仅在调用点把 `risk.anchorQuote` → `risk.clauseText` 重映射。

**Tech Stack:** Prisma 7（`package.json` 锁 `prisma`/`@prisma/client` `^7.7.0`）+ PostgreSQL 14+（`prisma migrate dev` 自动生成迁移） / TypeScript / Vitest（worker 级 DB 隔离）

**Spec 参考：** `docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md` § 1、§ 4、§ 5.0、§ 11.2

**前置条件：**
- PR 1（partyDetector 短路修复）已合入 dev 分支（commits `bd72611e` / `b7a4a3e6`），本 PR 在 dev 之上推进
- 工作区基于 `dev` 分支起一个独立 worktree（superpowers:using-git-worktrees）
- 合同审查模块未对外上线，允许 truncate `contract_risks` / `contract_annotations` / `contract_review_legacy_risks_backup` / `contract_review_versions`

---

## 改动文件总图

### Prisma / 迁移
- 修改：`prisma/models/contractRiskAndAnnotation.prisma`
- 新建：`prisma/migrations/<ts>_refactor_contract_risks_dual_anchor/migration.sql`（由 `prisma migrate dev` 自动生成，不手工修订）

### shared types
- 修改：`shared/types/contract.ts`
- 修改：`shared/types/agentEvent.ts`

### server 端实现
- 修改：`server/agents/contract/contractRisk.dao.ts`
- 修改：`server/agents/contract/contractRisk.service.ts`
- 修改：`server/agents/contract/contractAnnotation.dao.ts`
- 修改：`server/agents/contract/contractReviewMigrate.service.ts`
- 修改：`server/agents/contract/contractReviewRebuild.service.ts`
- 修改：`server/agents/contract/contractReviewVersion.service.ts`
- 修改：`server/agents/contract/uploadClientVersion.service.ts`
- 修改：`server/agents/contract/middleware/reviewResultPersistence.middleware.ts`
- 修改：`server/services/workflow/agents/contractReviewMainAgent.ts`
- **不改**：`server/agents/contract/docx/commentInjector.ts`（保留入参字段名 `anchorQuote` / `anchorParagraphIndex`）
- **不改**：`server/agents/contract/docx/wordCommentParser.ts`（输出的 `anchorParagraphIndex` 是 docx 解析语义，与 DB 字段同名但抽象不同）
- **不改**：`server/agents/contract/utils/anchorMigrate.ts`（PR 7 才升级双锚点优先级）

### server 端测试
- 修改：`tests/server/assistant/contract/contractRisk.dao.test.ts`
- 修改：`tests/server/assistant/contract/contractRisk.service.test.ts`
- 修改：`tests/server/assistant/contract/contractAnnotation.dao.test.ts`
- 修改：`tests/server/assistant/contract/contractReview.dao.test.ts`
- 修改：`tests/server/assistant/contract/contractReviewMigrate.service.test.ts`
- 修改：`tests/server/assistant/contract/contractReviewRebuild.service.test.ts`
- 修改：`tests/server/assistant/contract/contractReviewVersion.service.test.ts`
- 修改：`tests/server/assistant/contract/uploadClientVersion.service.test.ts`
- 修改：`tests/server/assistant/contract/m3Integration.test.ts` / `m4Integration.test.ts` / `m5Integration.test.ts`（grep 全量替换）
- 修改：`tests/server/assistant/contract/reviewsUnsavedPersistence.test.ts`
- 修改：`tests/server/assistant/contract/reviews.uploadVersion.api.test.ts`
- 修改：`tests/server/assistant/contract/reviews.versions.api.test.ts`
- 修改：`tests/server/agents/contract/contractAnnotation.service.test.ts`
- 修改：`tests/server/agents/contract/contractReview.dao.test.ts`
- 修改：`tests/server/agents/contract/contractReviewVersion.service.test.ts`
- 修改：`tests/server/agents/contract/reviewResultPersistence.middleware.test.ts`
- 修改：`tests/server/agents/contract/uploadClientVersion.service.test.ts`
- 修改：`tests/server/agent-platform/tools/reviewContract.test.ts`
- 修改：`tests/server/workflow/middleware/reviewResultPersistence.test.ts`

### 前端
- 修改：`app/components/assistant/contract/ContractReviewPanel.vue`
- 修改：`app/components/assistant/contract/ContractDocxPreview.vue`
- 修改：`app/components/assistant/contract/RiskCard.vue`
- 修改：`app/components/assistant/contract/RiskListPanel.vue`
- 修改：`tests/app/components/assistant/contract/RiskListPanel.test.ts`
- 修改：`tests/app/components/assistant/contract/RiskListPanel.badge.test.ts`
- 修改：`tests/app/composables/useContractReviewVersion.test.ts`

### 注释 / 维护脚本
- 修改：`shared/utils/clauseLocator.ts`（注释里 `anchor_quote` → `clause_text`）
- 修改：`scripts/cleanup-review-863.sql`（文件头加废弃注释，不改业务逻辑）

---

## 字段重命名速查表

| 旧（`anchor_*` 单锚点） | 新（`clause_*` / `quote_*` 双锚点） | 行为 |
|---|---|---|
| `anchor_quote` (DB) / `anchorQuote` (TS) | `clause_text` (DB) / `clauseText` (TS) | NOT NULL `@default("")`（escape hatch，业务不依赖）；PR 2 service 始终显式写 `segment.text` 完整条款 |
| `anchor_paragraph_index` / `anchorParagraphIndex` | `clause_paragraph_index` / `clauseParagraphIndex` | NULLABLE；语义不变（commentInjector 期望"非空段落序号"空间） |
| `anchor_char_start` / `anchorCharStart` | `clause_char_start` / `clauseCharStart` | NULLABLE；语义为"在文档全文 normalizedText 内的 offset" |
| `anchor_char_end` / `anchorCharEnd` | `clause_char_end` / `clauseCharEnd` | NULLABLE |
| `original_anchor_quote` / `originalAnchorQuote` | `original_clause_text` / `originalClauseText` | NULLABLE；Phase B 锚点迁移痕迹 |
| —（新增） | `clause_index` / `clauseIndex` | NULLABLE；PR 3 才填值（segmentClauses 产出的条款序号），PR 2 落库时全为 null |
| —（新增） | `problematic_quote` / `problematicQuote` | NULLABLE；PR 3 主路径产物 |
| —（新增） | `quote_char_start` / `quoteCharStart` | NULLABLE；PR 3 才填，相对 clauseText offset |
| —（新增） | `quote_char_end` / `quoteCharEnd` | NULLABLE |
| —（新增） | `quote_match_source` / `quoteMatchSource` | NULLABLE varchar(20)；`'sentence_id'` / `'fuzzy'` / `'fallback'` |

`commentInjector.ts` 入参字段名（`ContractAnnotationForExport.anchorQuote` / `.anchorParagraphIndex`）**不改**——它接收的是"段落原文 + 段落序号"语义抽象，不是 DB 列。调用方组装时新写：

```typescript
{
    anchorQuote: a.risk.clauseText,         // ← 新字段名映射
    anchorParagraphIndex: a.risk.clauseParagraphIndex!,  // ← 新字段名映射
}
```

---

## Task 1：Prisma schema 修改与迁移

**Files:**
- Modify: `prisma/models/contractRiskAndAnnotation.prisma`
- Create: `prisma/migrations/<ts>_refactor_contract_risks_dual_anchor/migration.sql`

- [ ] **Step 1.1：修改 Prisma schema**

把 `prisma/models/contractRiskAndAnnotation.prisma:26-37` 那段锚点字段全部替换：

```prisma
  // ===== 双锚点：层 1 完整条款（粗）=====
  /// 条款序号（segmentClauses 产出，1-based）；source='global_review' 时为 null。
  /// PR 2 落库全为 null（行为兼容旧逻辑），PR 3 主路径开始填值。
  clauseIndex          Int?   @map("clause_index")
  /// 完整条款原文（NOT NULL）：
  /// - source='ai'（首次审查）→ segment.text
  /// - source='external_new'（Phase B 客户外部新增批注）→ 客户回传 docx 里批注所在段落原文
  /// - source='global_review'（全局复核）→ review.summary 摘录或 LLM representativeQuote
  ///
  /// `@default("")` 不是业务约束、只是给 prisma migrate dev 一个 escape hatch——dev
  /// 库里若开发者本地有遗留 review 行（未走 dev 库手工清场），prisma 自动 ADD COLUMN NOT NULL
  /// 默认填空串通过；service 层（contractRisk.service.ts persistAiRisksAsContractRows）
  /// 始终显式写 segment.text / clause.text 等真值，不依赖此 default。
  clauseText           String @default("") @map("clause_text") @db.Text
  /// 非空段落序号（commentInjector 期望空间）
  clauseParagraphIndex Int?   @map("clause_paragraph_index")
  /// clause 在文档全文 normalizedText 里的 offset（首次审查可空，Phase B 锚点迁移可填）
  clauseCharStart      Int?   @map("clause_char_start")
  clauseCharEnd        Int?   @map("clause_char_end")

  // ===== 双锚点：层 2 精确问题片段（细）=====
  /// 路线 2 产物；NULL = 解析全失败降级，UI 退回到 clauseText 显示。
  /// PR 2 全为 null，PR 3 主路径开始填值。
  problematicQuote     String?  @map("problematic_quote") @db.Text
  /// 在 clauseText 内的相对 offset（不是文档全文！）
  quoteCharStart       Int?     @map("quote_char_start")
  quoteCharEnd         Int?     @map("quote_char_end")
  /// 命中来源：sentence_id / fuzzy / fallback；运维监控匹配率
  quoteMatchSource     String?  @map("quote_match_source") @db.VarChar(20)

  // ===== Phase B 锚点迁移痕迹（旧 originalAnchorQuote 改名）=====
  originalClauseText String?  @map("original_clause_text") @db.Text
```

把原 `anchorQuote` / `anchorParagraphIndex` / `anchorCharStart` / `anchorCharEnd` / `originalAnchorQuote` 5 个字段全删除（保留 `orphaned` 字段不动）。`@@index` 与 `@@map` 不变。

- [ ] **Step 1.2：（开发者本地）dev 库手工清场**

> 用户原则：本次**不手写迁移脚本**——架构改 schema 由 prisma 自动生成迁移；数据动作（清空老 review/risk/annotation/version/legacy_backup）走 dev 库手工 SQL，**不进 migration.sql、不进 seedData.sql**。
>
> 合同审查模块未上线，dev 库里可能存有开发者本地测试遗留的 review/risks 行；老 `contract_review_versions.snapshotData` JSONB 还内嵌旧字段名（`anchorQuote` / `anchorParagraphIndex`），不清场的话前端切换到读 `clauseText` 后会炸。每个开发者在跑 prisma 自动迁移**之前**，先在自己的 dev 库执行：

```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d ls_new <<'SQL'
-- 合同审查双锚点重构 · dev 库清场（一次性手工执行，不进迁移）
BEGIN;

-- 1. 清空 contract_risks（CASCADE 自动带 contract_annotations 走 FK onDelete: Cascade）
TRUNCATE TABLE "contract_risks", "contract_annotations" RESTART IDENTITY CASCADE;

-- 2. 清空 versions / legacy backup（无 FK 关系，CASCADE 不会自动带；snapshotData/risks
--    JSONB 内嵌旧字段名，不清前端会炸）
TRUNCATE TABLE "contract_review_legacy_risks_backup" RESTART IDENTITY;
TRUNCATE TABLE "contract_review_versions" RESTART IDENTITY;

-- 3. 把存量 review 置 failed（让用户重传），重置版本指针
UPDATE "contract_reviews"
SET "status" = 'failed',
    "current_version_id" = NULL,
    "max_version_no" = 0,
    "has_unsaved_docx_changes" = false,
    "updated_at" = NOW()
WHERE "deleted_at" IS NULL AND "status" IS DISTINCT FROM 'failed';

COMMIT;
SQL
```

执行后用一行确认表已清空：

```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d ls_new -c \
  "SELECT 'contract_risks' AS t, COUNT(*) FROM contract_risks UNION ALL
   SELECT 'contract_annotations', COUNT(*) FROM contract_annotations UNION ALL
   SELECT 'contract_review_versions', COUNT(*) FROM contract_review_versions UNION ALL
   SELECT 'contract_review_legacy_risks_backup', COUNT(*) FROM contract_review_legacy_risks_backup;"
```

期望 4 行 `count` 全为 0。

> CI / 生产部署：合同审查未上线，生产没数据，**完全不需要**这步——`prisma migrate deploy` 直接 apply schema 变更即可。本步是 dev 环境个人操作，不进任何 commit。
>
> 如果 dev 库里上述四张表本身就是空的（grep 后 0 行），可以跳过本 step。

- [ ] **Step 1.3：让 prisma 自动生成迁移**

```bash
bun run prisma:migrate --name refactor_contract_risks_dual_anchor
```

`prisma migrate dev`（`bun run prisma:migrate`）会按 schema 差异自动生成 `prisma/migrations/<ts>_refactor_contract_risks_dual_anchor/migration.sql` 并立即 apply 到本地 DB。生成内容预期是 5 句 DROP COLUMN + 10 句 ADD COLUMN（`clause_text` 因 schema 加 `@default("")` 不会触发"NOT NULL on non-empty table"提示）。

期望终端输出：
```
✔ Generated migration `<ts>_refactor_contract_risks_dual_anchor`
✔ Database is in sync with your schema
✔ Generated Prisma Client (...) to ./generated/prisma/client
```

如果 prisma 仍然 prompt `data loss is possible`（drop columns 提示），按 `y` 确认即可——dev 库已在 step 1.2 清空，无数据可丢。

> **不要**手工修订生成的 migration.sql。如果生成内容意外缺字段，说明 schema 改动有误，回 step 1.1 重看。

- [ ] **Step 1.4：验证 schema 对齐**

```bash
# 1. Prisma 视角：schema 与 DB 是否一致
bunx prisma migrate status
```

期望输出：`Database schema is up to date!`

```bash
# 2. PostgreSQL 视角：实际列结构（确认旧列已清、新列就位）
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d ls_new -c "\d contract_risks" \
  | grep -E "clause|quote|anchor|original"
```

期望输出包含 `clause_text` / `clause_paragraph_index` / `quote_char_start` 等 10 个新列；**不包含任何 `anchor_*` 列**。如果 `docker ps -qf name=postgres` 返回空，先确认本地 docker compose 已启动 postgres 容器。

- [ ] **Step 1.5：同步测试模板库 schema**

LexSeek 测试基建（`tests/_infra/global-setup.ts`）每个 vitest worker 启动时从 `ls_new_testing` 模板库 CLONE 出 `ls_test_w<id>`。`prisma migrate dev` 默认只 apply 到 dev 库（`ls_new`），**不会**触达模板库——必须手工把新 schema push 到模板库，否则测试 worker DB schema 与 server 代码不一致，所有合同测试会炸（项目记忆 2026-04-01 已踩过这个坑）。

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&connection_limit=20' \
  bunx prisma db push --accept-data-loss --skip-generate
```

`--accept-data-loss` 显式接受 drop columns 的数据丢失；`--skip-generate` 避免重复跑 generate（dev 库迁移已生成过 client）。

期望输出：`The database is now in sync with your schema.`

验证模板库列结构：

```bash
docker exec -i $(docker ps -qf name=postgres) psql -U postgres -d ls_new_testing -c "\d contract_risks" \
  | grep -E "clause|quote|anchor|original"
```

应与 dev 库 step 1.4 输出一致（10 个新列、无 `anchor_*`）。

- [ ] **Step 1.6：commit 1 — schema + 自动生成的迁移**

```bash
git add prisma/models/contractRiskAndAnnotation.prisma prisma/migrations/<ts>_refactor_contract_risks_dual_anchor
git commit -m "refactor(contract): contract_risks 双锚点 schema 重构

drop 5 个 anchor_* 字段，新增 9 个 clause_* / quote_* 字段（含
clauseText NOT NULL @default('') escape hatch，业务层不依赖该 default）。
迁移由 prisma migrate dev 自动生成，未手写。dev 库老数据由开发者
本地 truncate（不进 migration、不进 seedData.sql；合同审查未上线，
生产无数据可清）。PR 2-4 同窗口发布，单独发布 PR 2 会让前端 NPE。"
```

---

## Task 2：shared/types 同步

**Files:**
- Modify: `shared/types/contract.ts`
- Modify: `shared/types/agentEvent.ts`

- [ ] **Step 2.1：改 `ContractRiskEntity`（`shared/types/contract.ts:477-502`）**

替换原 `ContractRiskEntity` interface 为：

```typescript
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
    /** AI 生成的完整改写后条款（high/medium 必有；low 可空） */
    suggestedClauseText: string | null
    archivedStatus: RiskArchivedStatus | null
    archivedAt: string | null

    // 双锚点 · 层 1 完整条款
    /** 条款序号（segmentClauses 产出）；source='global_review' 时为 null。PR 2 全为 null，PR 3 起填值 */
    clauseIndex: number | null
    /** 完整条款原文（NOT NULL） */
    clauseText: string
    /** 非空段落序号（commentInjector 期望空间） */
    clauseParagraphIndex: number | null
    /** clause 在文档全文 normalizedText 里的 offset */
    clauseCharStart: number | null
    clauseCharEnd: number | null

    // 双锚点 · 层 2 精确问题片段（PR 2 全为 null，PR 3 主路径填值）
    problematicQuote: string | null
    quoteCharStart: number | null
    quoteCharEnd: number | null
    quoteMatchSource: 'sentence_id' | 'fuzzy' | 'fallback' | null

    // Phase B 锚点迁移痕迹
    originalClauseText: string | null
    orphaned: boolean

    createdAt: string
    updatedAt: string
}
```

- [ ] **Step 2.2：改 `Risk.anchorParagraphIndex`（`shared/types/contract.ts:148-168`）**

把 `Risk` interface 里的 `anchorParagraphIndex?: number | null` 改名为：

```typescript
    /**
     * "非空段落序号"（与后端 server/agents/contract/utils/clauseToParagraph.ts
     * 的 buildClauseToParagraphMap 输出同口径），仅在前端渲染时由 RiskDisplay
     * 透传，用于 clauseLocator 的优先级 0 直定位。后端落库不读不写此字段（DB
     * 用 contractRisks.clauseParagraphIndex 列）。
     */
    clauseParagraphIndex?: number | null
```

字段名从 `anchorParagraphIndex` → `clauseParagraphIndex`，注释里的 "anchor" → "clause"。

- [ ] **Step 2.3：改 `RiskDisplayPhaseB.originalAnchorQuote`（`shared/types/contract.ts:185-189`）**

```typescript
export type RiskDisplayPhaseB = RiskDisplay & {
    source?: RiskSource
    orphaned?: boolean
    originalClauseText?: string | null
}
```

字段名 `originalAnchorQuote` → `originalClauseText`。

- [ ] **Step 2.4：改 `ContractRiskPayload`（`shared/types/agentEvent.ts:184-190`）**

```typescript
export interface ContractRiskPayload {
    riskId: number
    code?: string
    level: RiskLevel
    source: string
    /** SSE 推送增量风险卡时携带的完整条款原文（前端展示用，等价于 contractRisks.clauseText） */
    clauseText?: string
}
```

字段 `anchorQuote` → `clauseText`。

- [ ] **Step 2.5：跑 typecheck（确认 shared types 局部 OK，剩余报错在后续 task 修复）**

Run:
```bash
bun run typecheck 2>&1 | grep -E "shared/types" | head -20
```

期望：`shared/types/` 内文件无报错。如果还有，回看 step 2.1-2.4 是否漏字段。

> Server / app 此时仍大量报错（仍引用 `anchorQuote` / `anchorParagraphIndex` / `originalAnchorQuote`），属于预期，后续 task 逐文件修。

- [ ] **Step 2.6：commit 2 — shared types 重命名**

```bash
git add shared/types/contract.ts shared/types/agentEvent.ts
git commit -m "refactor(contract): shared types 双锚点字段重命名

- ContractRiskEntity drop anchor_* 5 字段、加 clause_*/quote_* 9 字段
- Risk.anchorParagraphIndex → Risk.clauseParagraphIndex
- RiskDisplayPhaseB.originalAnchorQuote → originalClauseText
- ContractRiskPayload.anchorQuote → clauseText"
```

---

## Task 3：contractRisk DAO 改名 + 单测

**Files:**
- Modify: `server/agents/contract/contractRisk.dao.ts`
- Modify: `tests/server/assistant/contract/contractRisk.dao.test.ts`

- [ ] **Step 3.1：改 `CreateContractRiskInput` 与 `UpdateContractRiskInput`**

替换 `server/agents/contract/contractRisk.dao.ts:12-39` 的两个 interface 为：

```typescript
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
    /** 完整条款原文（NOT NULL） */
    clauseText: string
    /** 非空段落序号（commentInjector 期望空间） */
    clauseParagraphIndex?: number | null
    /** PR 2 不写，PR 3 主路径起填值 */
    clauseIndex?: number | null
    clauseCharStart?: number | null
    clauseCharEnd?: number | null
}

export async function createContractRiskDAO(input: CreateContractRiskInput): Promise<contractRisks> {
    return prisma.contractRisks.create({ data: input })
}

export interface UpdateContractRiskInput {
    level?: RiskLevel
    suggestion?: string | null
    archivedStatus?: RiskArchivedStatus | null
    /** 律师手工编辑业务文字时 clause_* / quote_* 字段视为只读，不在此 input 暴露（spec §5.0）*/
    clauseText?: string
    clauseParagraphIndex?: number | null
}
```

> 注意：`UpdateContractRiskInput` 仍开放 `clauseText` / `clauseParagraphIndex`（uploadClientVersion 锚点迁移路径要写），但**不暴露** `quote_*` / `clause_index` / `clause_char_*` —— 律师 PATCH risk 时这些字段保持只读（spec §5.0）。

- [ ] **Step 3.2：改测试 `tests/server/assistant/contract/contractRisk.dao.test.ts`**

把所有 `anchorQuote: 'xxx'` / `anchorParagraphIndex: N` 替换为 `clauseText: 'xxx'` / `clauseParagraphIndex: N`。

机械替换命令（逐文件 sed 不安全，改用编辑工具）：

```bash
grep -n "anchorQuote\|anchorParagraphIndex\|anchorCharStart\|anchorCharEnd\|originalAnchorQuote" tests/server/assistant/contract/contractRisk.dao.test.ts
```

按 grep 输出逐行用 Edit 工具替换：
- `anchorQuote` → `clauseText`
- `anchorParagraphIndex` → `clauseParagraphIndex`
- `anchorCharStart` → `clauseCharStart`
- `anchorCharEnd` → `clauseCharEnd`
- `originalAnchorQuote` → `originalClauseText`

- [ ] **Step 3.3：跑该测试**

Run:
```bash
npx vitest run tests/server/assistant/contract/contractRisk.dao.test.ts --reporter=verbose
```

期望：所有 case PASS。

如果失败，常见原因：
- 测试模板库 schema 没同步（回 Task 1 step 1.5 跑 `bunx prisma db push --accept-data-loss` 同步 ls_new_testing）
- dev 库 schema 没 apply 上（回 Task 1 step 1.3 重跑 prisma migrate dev）
- 测试里某行漏改（回 step 3.2 grep 检查）

- [ ] **Step 3.4：commit 3 — contractRisk DAO 改名**

```bash
git add server/agents/contract/contractRisk.dao.ts tests/server/assistant/contract/contractRisk.dao.test.ts
git commit -m "refactor(contract): contractRisk DAO 字段重命名 anchor_* → clause_*"
```

---

## Task 4：contractRisk service（PersistAiRiskRow + 落库映射）改名

**Files:**
- Modify: `server/agents/contract/contractRisk.service.ts`
- Modify: `tests/server/assistant/contract/contractRisk.service.test.ts`

- [ ] **Step 4.1：改 `PersistAiRiskRow` 与 `persistAiRisksAsContractRows`**

替换 `server/agents/contract/contractRisk.service.ts:32-111` 的整段：

```typescript
export interface PersistAiRiskRow {
    /** AI 产出的 Risk（来自 #shared/types/contract，注意 risk.id 是前端 string，不写 DB） */
    risk: Risk
    /** 默认 'ai'；调用方需要 'global_review' / 'external_new' 时显式传入 */
    source?: RiskSource
    /**
     * 显式覆盖 clauseText（NOT NULL，必有值）。
     * - 首次审查（contractReviewMainAgent）：不传，使用 risk.clauseText
     * - 增量审查（uploadClientVersion Step 4a）：传入新条款原文（clause.text），
     *   避免 LLM 自填的 clauseText 与新条款字面差异导致后续 diff/锚点匹配失真
     */
    clauseText?: string
    /** 已转换好的非空段落序号（commentInjector 期望空间）；null 表示无锚点 */
    clauseParagraphIndex?: number | null
    /** Phase B：锚点首次迁移前的原文 */
    originalClauseText?: string | null
    /** Phase B：当前版本无法定位锚点（孤立批注区） */
    orphaned?: boolean
}

export async function persistAiRisksAsContractRows(input: {
    reviewId: number
    rows: PersistAiRiskRow[]
    stance?: StancePreference
    tx?: Prisma.TransactionClient
}): Promise<contractRisks[]> {
    const { reviewId, rows, tx } = input
    if (rows.length === 0) return []
    const stance = input.stance ?? DEFAULT_AI_RISK_STANCE
    const client: Prisma.TransactionClient | typeof prisma = tx ?? prisma

    const data: Prisma.contractRisksUncheckedCreateInput[] = rows.map((row) => {
        const r = row.risk
        const item: Prisma.contractRisksUncheckedCreateInput = {
            reviewId,
            source: row.source ?? 'ai',
            code: r.matchedPointCode ?? null,
            category: r.category,
            level: r.level as RiskLevel,
            stance,
            problem: r.problem,
            legalBasis: r.legalBasis ?? null,
            analysis: r.analysis ?? null,
            suggestion: r.suggestion ?? null,
            suggestedClauseText: r.suggestedClauseText ?? null,
            // 双锚点 · 层 1：clauseText 是 NOT NULL 列
            clauseText: row.clauseText ?? r.clauseText,
            clauseParagraphIndex: row.clauseParagraphIndex ?? null,
            // PR 2 全为 null；PR 3 主路径起填 clauseIndex / quote_*
            clauseIndex: null,
            // 双锚点 · 层 2：PR 2 全为 null
            problematicQuote: null,
            quoteCharStart: null,
            quoteCharEnd: null,
            quoteMatchSource: null,
        }
        if (row.originalClauseText !== undefined) item.originalClauseText = row.originalClauseText
        if (row.orphaned !== undefined) item.orphaned = row.orphaned
        return item
    })

    return client.contractRisks.createManyAndReturn({ data })
}
```

> 关键：`clauseText: row.clauseText ?? r.clauseText` 保留旧 fallback 语义（首次审查时 `risk.clauseText` 是完整条款）。`problematicQuote` / `quoteCharStart/End` / `quoteMatchSource` / `clauseIndex` 全显式置 null —— PR 3 才填值。

- [ ] **Step 4.2：改测试 `tests/server/assistant/contract/contractRisk.service.test.ts`**

逐行替换字段名（同 step 3.2 规则）。

`grep -n "anchorQuote\|anchorParagraphIndex\|originalAnchorQuote" tests/server/assistant/contract/contractRisk.service.test.ts` 拉出待改行后用 Edit 替换。

补一条新断言（PR 2 行为契约）：

```typescript
// 注意：本断言锁的是 "PR 2 阶段双锚点层 2 字段都是 null 占位" 的临时契约。
// PR 3 主路径接入 splitSentences + resolveQuoteAnchor 后，problematicQuote /
// quoteCharStart/End / quoteMatchSource / clauseIndex 会按真实路径填值，
// 该断言会被 PR 3 改写为 "sentence_id 主路径命中时 quoteMatchSource='sentence_id' 等"。
it('PR 2 落库时 quote_* / clauseIndex 全部为 null（PR 3 主路径前为 null 占位）', async () => {
    const rows: PersistAiRiskRow[] = [{
        risk: makeRisk({ clauseText: '第三条 工资支付。逾期支付的，每日按 0.05% 加收滞纳金。' }),
    }]
    const created = await persistAiRisksAsContractRows({ reviewId, rows })
    expect(created[0].clauseText).toBe('第三条 工资支付。逾期支付的，每日按 0.05% 加收滞纳金。')
    expect(created[0].clauseIndex).toBeNull()
    expect(created[0].problematicQuote).toBeNull()
    expect(created[0].quoteCharStart).toBeNull()
    expect(created[0].quoteCharEnd).toBeNull()
    expect(created[0].quoteMatchSource).toBeNull()
})
```

- [ ] **Step 4.3：跑该测试**

Run:
```bash
npx vitest run tests/server/assistant/contract/contractRisk.service.test.ts --reporter=verbose
```

期望：所有 case PASS（含新增断言）。

- [ ] **Step 4.4：commit 4 — contractRisk service 字段重命名**

```bash
git add server/agents/contract/contractRisk.service.ts tests/server/assistant/contract/contractRisk.service.test.ts
git commit -m "refactor(contract): persistAiRisksAsContractRows 双锚点字段映射

clauseText 替代 anchorQuote 写入；clauseIndex / problematicQuote /
quote_char_* / quoteMatchSource 全为 null 占位（PR 3 主路径起填值）。"
```

---

## Task 5：contractAnnotation DAO include 改名 + 单测

**Files:**
- Modify: `server/agents/contract/contractAnnotation.dao.ts`
- Modify: `tests/server/assistant/contract/contractAnnotation.dao.test.ts`

- [ ] **Step 5.1：改 `listAnnotationsForExportDAO` 的 include select**

替换 `server/agents/contract/contractAnnotation.dao.ts:81-100` 整个函数：

```typescript
/** 导出用：按 reviewId 查询需要写入 docx 的批注（未软删 + suppressInExport=false），关联 risk 取锚点信息 */
export async function listAnnotationsForExportDAO(
    reviewId: number,
): Promise<Prisma.contractAnnotationsGetPayload<{
    include: {
        risk: {
            select: {
                clauseText: true
                clauseParagraphIndex: true
                orphaned: true
            }
        }
    }
}>[]> {
    return prisma.contractAnnotations.findMany({
        where: { reviewId, deletedAt: null, suppressInExport: false },
        include: { risk: { select: { clauseText: true, clauseParagraphIndex: true, orphaned: true } } },
        orderBy: [{ riskId: 'asc' }, { createdAt: 'asc' }],
    })
}
```

- [ ] **Step 5.2：改测试 `tests/server/assistant/contract/contractAnnotation.dao.test.ts`**

按 grep 替换：

```bash
grep -n "anchorQuote\|anchorParagraphIndex\|originalAnchorQuote" tests/server/assistant/contract/contractAnnotation.dao.test.ts
```

- `anchorQuote` → `clauseText`
- `anchorParagraphIndex` → `clauseParagraphIndex`
- `originalAnchorQuote` → `originalClauseText`

- [ ] **Step 5.3：跑该测试**

Run:
```bash
npx vitest run tests/server/assistant/contract/contractAnnotation.dao.test.ts --reporter=verbose
```

期望：PASS。

- [ ] **Step 5.4：commit 5 — contractAnnotation DAO include**

```bash
git add server/agents/contract/contractAnnotation.dao.ts tests/server/assistant/contract/contractAnnotation.dao.test.ts
git commit -m "refactor(contract): contractAnnotation DAO include select 字段重命名"
```

---

## Task 6：contractReviewMigrate service 改名

**Files:**
- Modify: `server/agents/contract/contractReviewMigrate.service.ts`
- Modify: `tests/server/assistant/contract/contractReviewMigrate.service.test.ts`

> 背景：迁移老 review.risks JSON → contractRisks 表的工具。Task 1 truncate 已经把所有 review 置 failed + 清 backup 表 → 此 service 实际无数据可迁。但保留 service 让代码 typecheck 过；下次清理 PR 再考虑删除。

- [ ] **Step 6.1：改 `server/agents/contract/contractReviewMigrate.service.ts:46-71`**

```typescript
    let created = 0
    for (const lr of legacy) {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            code: (lr.matchedPointCode as string | undefined) ?? null,
            category: (lr.category as string | undefined) ?? '未分类',
            level: ((lr.level as string | undefined) ?? 'medium') as RiskLevel,
            stance: DEFAULT_AI_RISK_STANCE,
            problem: (lr.problem as string | undefined) ?? '',
            legalBasis: (lr.legalBasis as string | undefined) ?? null,
            analysis: ((lr.analysis ?? lr.risk) as string | undefined) ?? null,
            suggestion: (lr.suggestion as string | undefined) ?? null,
            // 存量 Risk 的完整条款原文：优先 clauseText，fallback risk 本身的 quote 字段
            clauseText: ((lr.clauseText ?? lr.quote) as string | undefined) ?? '',
            clauseParagraphIndex: (lr.clauseIndex as number | undefined) ?? null,
        })
        await createContractAnnotationDAO({
            reviewId,
            riskId: risk.id,
            authorType: 'ai',
            authorName: 'AI',
            content: renderRiskAsAnnotationText(lr),
        })
        created++
    }
```

字段名 `anchorQuote` → `clauseText`、`anchorParagraphIndex` → `clauseParagraphIndex`。

- [ ] **Step 6.2：改测试**

按 grep 改字段名（机械替换）。

- [ ] **Step 6.3：跑测试**

```bash
npx vitest run tests/server/assistant/contract/contractReviewMigrate.service.test.ts --reporter=verbose
```

- [ ] **Step 6.4：commit 6**

```bash
git add server/agents/contract/contractReviewMigrate.service.ts tests/server/assistant/contract/contractReviewMigrate.service.test.ts
git commit -m "refactor(contract): contractReviewMigrate service 字段重命名"
```

---

## Task 7：contractReviewMainAgent（首次审查落库）改名

**Files:**
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`

- [ ] **Step 7.1：改首次审查落库字段**

`server/services/workflow/agents/contractReviewMainAgent.ts:114-125` 一段：

```typescript
    // Bug 修复：clauseIndex（segmentClauses 产出的"条款序号"）≠ clauseParagraphIndex
    // （commentInjector 期望的"非空段落序号"）...
    rowsForPersist.push({
        risk: aiRisk,
        clauseParagraphIndex: clauseIndexToParagraphIndex.get(aiRisk.clauseIndex) ?? null,
    })
```

字段 `anchorParagraphIndex` → `clauseParagraphIndex`。注释里 "anchorParagraphIndex" → "clauseParagraphIndex"。

> `Risk.anchorParagraphIndex` 已在 Task 2 step 2.2 改名为 `Risk.clauseParagraphIndex`，所以读侧 `aiRisk.clauseIndex` 不变（仍是 segmentClauses 给出的"条款序号"，不是段落序号）；`PersistAiRiskRow.clauseParagraphIndex` 接收"非空段落序号"映射结果，由 `clauseIndexToParagraphIndex.get` 转换好。

- [ ] **Step 7.2：跑相关集成测试**

```bash
npx vitest run tests/server/assistant/contract/m4Integration.test.ts tests/server/assistant/contract/m5Integration.test.ts --reporter=verbose
```

如果测试里直接用 `anchorParagraphIndex` 字段（grep 出来），按 step 3.2 同规则替换后再跑。

- [ ] **Step 7.3：commit 7**

```bash
git add server/services/workflow/agents/contractReviewMainAgent.ts tests/server/assistant/contract/m*Integration.test.ts
git commit -m "refactor(contract): contractReviewMainAgent 首次审查落库字段重命名"
```

---

## Task 8：contractReviewRebuild + reviewResultPersistence middleware

**Files:**
- Modify: `server/agents/contract/contractReviewRebuild.service.ts`
- Modify: `server/agents/contract/middleware/reviewResultPersistence.middleware.ts`
- Modify: `tests/server/assistant/contract/contractReviewRebuild.service.test.ts`
- Modify: `tests/server/agents/contract/reviewResultPersistence.middleware.test.ts`
- Modify: `tests/server/workflow/middleware/reviewResultPersistence.test.ts`

> 这两个文件都是把 contractAnnotations + 关联 risk 组装成 commentInjector 入参 `ContractAnnotationForExport`。**commentInjector 入参字段名 `anchorQuote` / `anchorParagraphIndex` 不改**（见"字段重命名速查表"末尾说明），仅改右值映射。

- [ ] **Step 8.1：改 `contractReviewRebuild.service.ts:65-66`**

```typescript
    const annotations: ContractAnnotationForExport[] = exportable.map(a => ({
        id: a.id,
        riskId: a.riskId,
        authorType: a.authorType as ContractAnnotationForExport['authorType'],
        authorName: a.authorName,
        content: a.content,
        parentAnnotationId: a.parentAnnotationId,
        anchorQuote: a.risk.clauseText,                 // ← 右值映射换字段
        anchorParagraphIndex: a.risk.clauseParagraphIndex!,  // ← 右值映射换字段
        wordCommentRef: a.wordCommentRef,
        createdAt: a.createdAt,
    }))
```

- [ ] **Step 8.2：改 `middleware/reviewResultPersistence.middleware.ts:90-91`**

同 8.1 同样的右值改名。

- [ ] **Step 8.3：批量改三份测试**

按 grep 在每份 .test.ts 文件内替换：

```bash
for f in tests/server/assistant/contract/contractReviewRebuild.service.test.ts \
         tests/server/agents/contract/reviewResultPersistence.middleware.test.ts \
         tests/server/workflow/middleware/reviewResultPersistence.test.ts; do
    grep -n "anchorQuote\|anchorParagraphIndex" "$f"
done
```

注意：测试里 mock 的 `risk: { anchorQuote: 'q', anchorParagraphIndex: 0 }` —— 这是 mock contractRisks 表行（不是 commentInjector 入参），改成 `risk: { clauseText: 'q', clauseParagraphIndex: 0 }`。

- [ ] **Step 8.4：跑测试**

```bash
npx vitest run \
  tests/server/assistant/contract/contractReviewRebuild.service.test.ts \
  tests/server/agents/contract/reviewResultPersistence.middleware.test.ts \
  tests/server/workflow/middleware/reviewResultPersistence.test.ts \
  --reporter=verbose
```

期望：PASS。

- [ ] **Step 8.5：commit 8**

```bash
git add server/agents/contract/contractReviewRebuild.service.ts \
        server/agents/contract/middleware/reviewResultPersistence.middleware.ts \
        tests/server/assistant/contract/contractReviewRebuild.service.test.ts \
        tests/server/agents/contract/reviewResultPersistence.middleware.test.ts \
        tests/server/workflow/middleware/reviewResultPersistence.test.ts
git commit -m "refactor(contract): rebuild service / persistence middleware 字段重命名

commentInjector 入参字段名（anchorQuote / anchorParagraphIndex）保留不动；
仅调用方从 risk 取字段时由 clauseText / clauseParagraphIndex 映射进去。"
```

---

## Task 9：uploadClientVersion service（>30 处）

**Files:**
- Modify: `server/agents/contract/uploadClientVersion.service.ts`
- Modify: `tests/server/assistant/contract/uploadClientVersion.service.test.ts`
- Modify: `tests/server/agents/contract/uploadClientVersion.service.test.ts`

> 这个 file 是 >30 处 anchor* 引用的重灾区。spec §11.2 PR 7 才升级双锚点优先级，PR 2 仅做"字段重命名 + 旧逻辑挪到新字段名空间"，行为不变。

- [ ] **Step 9.1：fast-path 写入路径（~line 471、530-575）**

按 grep 替换以下表达式：

| 旧 | 新 |
|---|---|
| `r.anchorQuote` | `r.clauseText` |
| `r.anchorParagraphIndex` | `r.clauseParagraphIndex` |
| `existing.anchorQuote` | `existing.clauseText` |
| `existing.originalAnchorQuote` | `existing.originalClauseText` |
| `r.originalAnchorQuote` | `r.originalClauseText` |
| `anchorQuote: clause.text` | `clauseText: clause.text` |
| `anchorParagraphIndex: newParaIdx` | `clauseParagraphIndex: newParaIdx` |
| `anchorParagraphIndex: null` | `clauseParagraphIndex: null` |
| `originalAnchorQuote: existing.anchorQuote` | `originalClauseText: existing.clauseText` |
| `originalAnchorQuote: r.anchorQuote` | `originalClauseText: r.clauseText` |
| `anchorCharStart: result.newCharStart` | `clauseCharStart: result.newCharStart` |
| `anchorCharEnd: result.newCharEnd` | `clauseCharEnd: result.newCharEnd` |

注释里 "anchorQuote" → "clauseText"、"anchorParagraphIndex" → "clauseParagraphIndex"。

> 注意 `anchorMigrate.ts` 的 `MigrateAnchorParams.oldAnchorQuote` 字段名**保留不动**（utils 内部参数名，PR 7 会重写）；调用点仍传 `oldAnchorQuote: r.clauseText`（左值老名 + 右值新字段）。

- [ ] **Step 9.2：global_review 路径（~line 660-665）**

```typescript
    rows.push({
        risk: r,
        source: 'global_review',
        clauseText: r.problem ?? '（全局复核）',
        clauseParagraphIndex: null,
    })
```

> spec §4.1.1 表格规定 `global_review` source 的 `clauseText` 应填 `representativeQuote ?? review.summary 摘录`。但本 PR 阶段 globalReview 节点尚未输出 `representativeQuote`（该 prompt 字段属 PR 3 范围）；spec 兜底"review.summary 摘录"是合同总览总评（120 字），对所有 global_review 风险都一样、信息粒度过粗。**PR 2 surgical 保留现有 `r.problem ?? '（全局复核）'`** —— `r.problem` 是单条风险描述，每条 risk 独立、信息量更高；与改名前 line 662 行为一致，不引入业务变更。PR 3 改 globalReview prompt 加 `representativeQuote` 时再统一升级到 spec §4.1.1 完整规则。

- [ ] **Step 9.3：external_new 路径（~line 748-770）**

```typescript
                const paraIdx = c.anchorParagraphIndex
                ...
                const clauseParagraphIndex = validPara ? paraIdx : null
                const clauseText = validPara
                    ? ...
                ...
                rows.push({
                    risk: ...,
                    source: 'external_new',
                    clauseText,
                    clauseParagraphIndex,
                })
```

> **保留** `c.anchorParagraphIndex`（局部变量名），因为 `c` 来自 `wordCommentParser.ts` 的 `parseWordComments` 输出，那个字段是 docx 解析语义（不在 PR 2 改名范围内，见 spec §4.4 注释）。

- [ ] **Step 9.4：anchor 漂移迁移路径（~line 810-870）**

```typescript
                if (r.clauseParagraphIndex == null) continue
                const oldArrayIdx = findOldClauseArrayIdxByAnchor(r.clauseText ?? '')
                ...
                migrateAnchor({
                    oldAnchorQuote: r.clauseText ?? '',  // ← MigrateAnchorParams 的字段名 PR 7 才改
                    ...
                })
                ...
                {
                    clauseParagraphIndex: newParaIdx,
                    clauseCharStart: result.newCharStart,
                    clauseCharEnd: result.newCharEnd,
                    clauseText: newClauses[result.newClauseIndex]!.text.slice(...),
                    ...(r.originalClauseText ? {} : { originalClauseText: r.clauseText }),
                }
```

unchanged clause 路径同样把 `anchorParagraphIndex` → `clauseParagraphIndex`。

- [ ] **Step 9.5：`syncReviewRisksJsonb`（~line 953-979）**

```typescript
    const rows = await tx.contractRisks.findMany({
        where: { reviewId },
        orderBy: [{ clauseParagraphIndex: 'asc' }, { id: 'asc' }],
    })
    const risksJson: Risk[] = rows.map((r) => ({
        id: String(r.id),
        clauseIndex: r.clauseParagraphIndex ?? 0,  // 注意：Risk.clauseIndex 是前端语义"按非空段落序号兜底"
        clauseText: r.clauseText ?? '',
        ...
    }))
```

- [ ] **Step 9.6：批量改两个测试文件**

```bash
grep -n "anchorQuote\|anchorParagraphIndex\|originalAnchorQuote\|anchorCharStart\|anchorCharEnd" \
  tests/server/assistant/contract/uploadClientVersion.service.test.ts \
  tests/server/agents/contract/uploadClientVersion.service.test.ts
```

按速查表替换。

- [ ] **Step 9.7：跑两个测试**

```bash
npx vitest run \
  tests/server/assistant/contract/uploadClientVersion.service.test.ts \
  tests/server/agents/contract/uploadClientVersion.service.test.ts \
  --reporter=verbose
```

期望：PASS。如果有 case 因为锚点漂移迁移路径行为变化失败，回 step 9.4 检查是否漏改字段名（PR 2 只改字段名，不改行为）。

- [ ] **Step 9.8：commit 9**

```bash
git add server/agents/contract/uploadClientVersion.service.ts \
        tests/server/assistant/contract/uploadClientVersion.service.test.ts \
        tests/server/agents/contract/uploadClientVersion.service.test.ts
git commit -m "refactor(contract): uploadClientVersion 字段重命名（>30 处）

仅字段名替换，锚点迁移行为不变；MigrateAnchorParams.oldAnchorQuote
和 wordCommentParser 输出的 anchorParagraphIndex 是 utils/docx 内部
语义，PR 2 不动，PR 7 双锚点路由升级时再统一。"
```

---

## Task 10：contractReviewVersion service（snapshot 字段读写）

**Files:**
- Modify: `server/agents/contract/contractReviewVersion.service.ts`
- Modify: `tests/server/assistant/contract/contractReviewVersion.service.test.ts`
- Modify: `tests/server/agents/contract/contractReviewVersion.service.test.ts`

> Task 1 truncate 已经清空 `contract_review_versions` 表，新写入的 snapshotData JSON 用新字段名；不需要兼容旧 snapshot JSON。

- [ ] **Step 10.1：改 `saveContractReviewVersionService`（~line 95-140）**

snapshot 写入风险快照时，确保从 contractRisks 表查出来的 row 对象用的是新字段名（Prisma 查询返回值由 generated client 自动同步，不需要手改类型）。

如果 service 内部有 mapping 步骤把 risk row 转成 snapshot.risks 元素，并用了旧字段名，按速查表替换。

- [ ] **Step 10.2：改 `downloadContractReviewVersionService`（~line 217-310）**

替换 `risk.anchorQuote` → `risk.clauseText`、`risk.anchorParagraphIndex` → `risk.clauseParagraphIndex`、注释 "anchorParagraphIndex" → "clauseParagraphIndex"：

```typescript
        // VER-R3：共享 isAnnotationExportable 谓词（含 deletedAt / suppressInExport /
        // clauseParagraphIndex / orphaned 四条规则），与 rebuild service / middleware 同口径。
        if (!isAnnotationExportable(a, risk)) continue
        if (!risk) continue
        exportable.push({
            id: a.id,
            riskId: a.riskId,
            authorType: a.authorType,
            authorName: a.authorName,
            content: a.content,
            parentAnnotationId: a.parentAnnotationId,
            anchorQuote: risk.clauseText,                       // commentInjector 入参字段名保留
            anchorParagraphIndex: risk.clauseParagraphIndex!,   // commentInjector 入参字段名保留
            wordCommentRef: a.wordCommentRef ?? dbRefByAnnId.get(a.id) ?? null,
            createdAt: typeof a.createdAt === 'string' ? new Date(a.createdAt) : (a.createdAt ?? null),
        })
```

如果文件内还有 `isAnnotationExportable` 的 import / 使用，注意 `contractAnnotation.service.ts` 内部那个 helper 也要改字段名（见 Task 11 兜底处理）。

- [ ] **Step 10.3：改测试**

```bash
grep -n "anchorQuote\|anchorParagraphIndex" \
  tests/server/assistant/contract/contractReviewVersion.service.test.ts \
  tests/server/agents/contract/contractReviewVersion.service.test.ts
```

按速查表批量替换。注意 mock snapshot data 时把 `risks: [{ id, anchorQuote, anchorParagraphIndex, ... }]` 改成 `risks: [{ id, clauseText, clauseParagraphIndex, ... }]`。

- [ ] **Step 10.4：跑测试**

```bash
npx vitest run \
  tests/server/assistant/contract/contractReviewVersion.service.test.ts \
  tests/server/agents/contract/contractReviewVersion.service.test.ts \
  --reporter=verbose
```

期望：PASS。

- [ ] **Step 10.5：commit 10**

```bash
git add server/agents/contract/contractReviewVersion.service.ts \
        tests/server/assistant/contract/contractReviewVersion.service.test.ts \
        tests/server/agents/contract/contractReviewVersion.service.test.ts
git commit -m "refactor(contract): version service snapshot 读写字段重命名"
```

---

## Task 11：剩余后端测试与 helper 兜底

**Files:**
- Modify: `server/agents/contract/contractAnnotation.service.ts`（如果 `isAnnotationExportable` 内部读 `risk.anchorParagraphIndex` / `.orphaned`）
- Modify: `tests/server/agents/contract/contractAnnotation.service.test.ts`
- Modify: `tests/server/agents/contract/contractReview.dao.test.ts`
- Modify: `tests/server/assistant/contract/contractReview.dao.test.ts`
- Modify: `tests/server/agent-platform/tools/reviewContract.test.ts`
- Modify: `tests/server/assistant/contract/m3Integration.test.ts`（如果还有）
- Modify: `tests/server/assistant/contract/reviewsUnsavedPersistence.test.ts`
- Modify: `tests/server/assistant/contract/reviews.uploadVersion.api.test.ts`
- Modify: `tests/server/assistant/contract/reviews.versions.api.test.ts`
- Modify: `tests/server/assistant/contract/reviews.get.test.ts` / `reviews.post.test.ts` / `patchReview.api.test.ts`（grep 命中再改）

- [ ] **Step 11.1：改 `contractAnnotation.service.ts` 的 `isAnnotationExportable`**

```bash
grep -n "anchorParagraphIndex\|anchorQuote" server/agents/contract/contractAnnotation.service.ts
```

按速查表替换字段读取。

- [ ] **Step 11.2：grep 全量未改测试 + 批量替换**

grep 范围**限定 `tests/server/` 和 `tests/shared/`**（`tests/app/` 由 Task 12 独占，不要在本步双重处理）；并在管道里**显式排除**几个 PR 2 范围外的文件，避免误改：

```bash
grep -rln "anchorQuote\|anchorParagraphIndex\|anchorCharStart\|anchorCharEnd\|originalAnchorQuote" \
  tests/server/ tests/shared/ \
  | grep -Ev "wordCommentParser\.test\.ts|anchorMigrate\.test\.ts|textSimilarity\.test\.ts|clauseLocator\.test\.ts"
```

排除清单解释：
- `wordCommentParser.test.ts`：`wordCommentParser` 输出的 `anchorParagraphIndex` 是 docx 解析语义（spec §4.4 注释明确不在 PR 2 范围）
- `anchorMigrate.test.ts`：`MigrateAnchorParams.oldAnchorQuote` 是 utils 内部参数名，PR 7 才改
- `textSimilarity.test.ts`：fuzzy 工具内部命名，PR 2 不动
- `clauseLocator.test.ts`：注释里的 `anchor_*` 是历史描述，对应 utility 入参 `paragraphIndex` 与字段名无冲突；只改源码注释（Task 13）

按 grep 结果逐文件 Edit 替换。**严禁 sed 批量**（CLAUDE.md main.md "不要使用 sed 进行批量文件迁移..."）。每个文件用 Edit 工具的 `replace_all` 参数：

```
Edit(file_path=<file>, old_string="anchorQuote", new_string="clauseText", replace_all=true)
Edit(file_path=<file>, old_string="anchorParagraphIndex", new_string="clauseParagraphIndex", replace_all=true)
Edit(file_path=<file>, old_string="originalAnchorQuote", new_string="originalClauseText", replace_all=true)
Edit(file_path=<file>, old_string="anchorCharStart", new_string="clauseCharStart", replace_all=true)
Edit(file_path=<file>, old_string="anchorCharEnd", new_string="clauseCharEnd", replace_all=true)
```

每个文件 5 次 Edit 完成后 `git diff <file>` 看一眼，确认没有把"注释里 `anchor_quote`（带下划线）误命中"的情况。

- [ ] **Step 11.3：跑剩余后端测试**

```bash
npx vitest run \
  tests/server/agents/contract/ \
  tests/server/assistant/contract/ \
  tests/server/workflow/middleware/ \
  tests/server/agent-platform/tools/reviewContract.test.ts \
  --reporter=verbose 2>&1 | tail -60
```

期望：所有 contract 域测试 PASS。如果 fail，按行号回看遗漏的字段名。

- [ ] **Step 11.4：commit 11**

```bash
git add server/agents/contract/contractAnnotation.service.ts \
        tests/server/agents/contract/ \
        tests/server/assistant/contract/ \
        tests/server/agent-platform/tools/reviewContract.test.ts \
        tests/server/workflow/middleware/reviewResultPersistence.test.ts
git commit -m "refactor(contract): 后端测试 + isAnnotationExportable 字段重命名"
```

---

## Task 12：前端字段重命名（4 .vue + 3 .test.ts）

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`
- Modify: `app/components/assistant/contract/ContractDocxPreview.vue`
- Modify: `app/components/assistant/contract/RiskCard.vue`
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Modify: `tests/app/components/assistant/contract/RiskListPanel.test.ts`
- Modify: `tests/app/components/assistant/contract/RiskListPanel.badge.test.ts`
- Modify: `tests/app/composables/useContractReviewVersion.test.ts`

> Surgical 改动：仅字段名映射，UI 行为不变。新 layout / 字符级高亮在 PR 4-5 才做。

- [ ] **Step 12.1：改 `ContractReviewPanel.vue` 的 mapEntityToDisplay（~line 271-292）**

```typescript
    function mapEntityToDisplay(e: any): RiskDisplay {
        return {
            id: String(e.id),
            entityId: typeof e.id === 'number' ? e.id : undefined,
            clauseIndex: e.clauseParagraphIndex ?? 0,         // 旧 e.anchorParagraphIndex
            clauseText: e.clauseText,                          // 旧 e.anchorQuote
            clauseParagraphIndex: e.clauseParagraphIndex,      // 旧 e.anchorParagraphIndex
            level: e.level,
            category: e.category,
            problem: e.problem,
            legalBasis: e.legalBasis ?? undefined,
            analysis: e.analysis ?? '',
            risk: e.problem,
            suggestion: e.suggestion ?? '',
            suggestedClauseText: e.suggestedClauseText ?? undefined,
            archivedStatus: e.archivedStatus,
        }
    }
```

注释里 "字段名（anchorQuote / problem / id:number）" 改为 "字段名（clauseText / problem / id:number）"。

- [ ] **Step 12.2：改 `ContractDocxPreview.vue:62`**

```typescript
        const el = locateClauseElement(containerRef.value, risk.clauseText, risk.clauseParagraphIndex)
```

注释里 "anchorParagraphIndex 直定位" → "clauseParagraphIndex 直定位"、"原 anchor_quote" → "原 clause_text"。

- [ ] **Step 12.3：改 `RiskCard.vue:120,125,189`**

```vue
<div v-if="risk.originalClauseText" class="rounded-md bg-muted p-2 text-xs text-muted-foreground space-y-1">
    ...
    <div class="italic line-clamp-3">{{ risk.originalClauseText }}</div>
    ...
</div>
...
v-if="risk.originalClauseText"
```

注释里 "originalAnchorQuote 提示" → "originalClauseText 提示"。

- [ ] **Step 12.4：改 `RiskListPanel.vue:364`**

```vue
v-if="r.originalClauseText"
```

- [ ] **Step 12.5：改前端测试**

```bash
grep -rn "anchorQuote\|anchorParagraphIndex\|originalAnchorQuote" tests/app/
```

按速查表 `Edit(replace_all=true)` 替换。

- [ ] **Step 12.6：跑前端测试**

```bash
npx vitest run tests/app/components/assistant/contract/ tests/app/composables/useContractReviewVersion.test.ts --reporter=verbose
```

期望：PASS。

- [ ] **Step 12.7：commit 12**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue \
        app/components/assistant/contract/ContractDocxPreview.vue \
        app/components/assistant/contract/RiskCard.vue \
        app/components/assistant/contract/RiskListPanel.vue \
        tests/app/components/assistant/contract/RiskListPanel.test.ts \
        tests/app/components/assistant/contract/RiskListPanel.badge.test.ts \
        tests/app/composables/useContractReviewVersion.test.ts
git commit -m "refactor(contract): 前端组件字段重命名 anchor* → clause*

surgical 改名，UI 行为不变；新 layout 与字符级高亮在 PR 4 / PR 5 实现。"
```

---

## Task 13：注释 + 废弃脚本 + 全量验证

**Files:**
- Modify: `shared/utils/clauseLocator.ts`（仅注释）
- Modify: `scripts/cleanup-review-863.sql`（文件头加废弃注释）

> 用户原则提示：本 task 不动 `seedData.sql`（合同审查无需补基础数据）；scripts/cleanup-review-863.sql 是 review 863 的一次性清理脚本，本 PR 走 dev 库 truncate 后该 review 数据已清空，脚本失去意义但保留作为历史现场参考（按 CLAUDE.md "手术性修改" — 发现废弃代码不擅删，加废弃注释）。

- [ ] **Step 13.1：改 `clauseLocator.ts` 注释**

`shared/utils/clauseLocator.ts:10` 注释里：
```
//   —— 解决 reviewed docx 注入批注后段落 textContent 与原 anchor_quote 因
```
改为：
```
//   —— 解决 reviewed docx 注入批注后段落 textContent 与原 clause_text 因
```

> 函数入参名 `paragraphIndex` 不动（utility 内部命名，不与 DB 字段冲突）。

- [ ] **Step 13.2：给 `scripts/cleanup-review-863.sql` 加废弃注释**

在文件第 1 行之前插入：

```sql
-- =========================================================================
-- 已废弃（2026-05-02）：合同审查双锚点重构（PR 2，migration
-- refactor_contract_risks_dual_anchor）已要求各开发者在 dev 库 truncate
-- contract_risks / contract_annotations / contract_review_legacy_risks_backup /
-- contract_review_versions 全表；review 863 的脏数据随之清空，本脚本不再
-- 有数据可清。脚本保留作为历史现场参考，不要再执行。
-- =========================================================================

```

- [ ] **Step 13.3：跑全量 typecheck**

```bash
bun run typecheck 2>&1 | tail -40
```

期望：0 个 error。如果有报错：
- 报错点是 `anchorQuote` / `anchorParagraphIndex` 残留 → grep 找到漏改的文件回前面 task 补
- 报错点是 ContractRiskEntity 缺字段 → Task 2 检查

- [ ] **Step 13.4：跑全量测试**

```bash
bun run test 2>&1 | tail -30
```

期望：所有 worker PASS（合同审查域测试 + 旁路无关测试都过）。

如果某测试 fail 在 contract 域之外（比如 case / payment），先看是不是 fixtures 共用了 contractRisks 字段（罕见）；否则与 PR 2 无关，跳过。

- [ ] **Step 13.5：跑 lint（如有）**

```bash
bun run lint 2>&1 | tail -20 || true
```

> LexSeek 当前无强制 lint 命令，跳过即 OK。

- [ ] **Step 13.6：commit 13 — 收尾**

```bash
git add shared/utils/clauseLocator.ts scripts/cleanup-review-863.sql
git commit -m "refactor(contract): clauseLocator 注释 + cleanup-review-863 废弃标注"
```

- [ ] **Step 13.7：开 PR**

```bash
git push -u origin <branch>
gh pr create --base dev --title "refactor(contract): contract_risks 双锚点 schema 重构（PR 2/7）" --body "$(cat <<'EOF'
## Summary

合同审查精准锚点 + Track Changes 路线图 PR 2 — 把 `contract_risks` 表从单锚点（`anchor_*` 5 字段）重构为"完整条款 + 精确问题片段"双锚点（`clause_*` + `quote_*` 9 字段），刷新 shared types / server service / 前端字段读取。

新 schema 落地后整个 server + app 字段名同步迁移为 `clauseText` / `clauseParagraphIndex` / `originalClauseText`；UI 行为不变（新 layout / 字符级高亮在 PR 4 / PR 5 实现）。`commentInjector` 入参字段名（`anchorQuote` / `anchorParagraphIndex`）保留不动（docx 注入工具内部语义稳定）。

**迁移策略（按用户原则）**：架构改 schema → `prisma migrate dev` 自动生成迁移文件，**不手写**；老 review/risk/annotation/version/legacy_backup 数据由开发者在 dev 库手工 `TRUNCATE` 清场（不进 migration、不进 seedData.sql）。`clauseText NOT NULL` 在 schema 加 `@default('')` escape hatch 让 prisma 自动 ADD COLUMN 不阻塞，业务层始终显式写 `segment.text` 真值不依赖 default。**生产部署影响**：合同审查未上线，生产 `contract_risks` 表为空，`prisma migrate deploy` 直接 apply schema 变更即可，**无需任何数据动作**。

**发布顺序约束**：PR 2 / PR 3 / PR 4 必须捆绑在同一 release window 上线 — PR 2 落地后 anchor_* 字段被 drop，老前端代码（仍读 anchorQuote / anchorParagraphIndex）会立刻 NPE。

## Test plan

- [ ] `bun run prisma:migrate` apply 成功，`prisma migrate status` 报 up to date
- [ ] `npx vitest run tests/server/agents/contract/ tests/server/assistant/contract/` 全 PASS
- [ ] `npx vitest run tests/server/workflow/middleware/ tests/server/agent-platform/tools/reviewContract.test.ts` PASS
- [ ] `npx vitest run tests/app/components/assistant/contract/` PASS
- [ ] `bun run typecheck` 0 error
- [ ] dev server 拉起后手动跑一次"上传合同 → AI 审查 → 风险卡显示完整原文"，UI 表现与重构前一致

## Spec / Plan

- Spec: `docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md`
- Plan: `docs/superpowers/plans/2026-05-02-contract-review-pr2-data-model-refactor.md`
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- spec §3 PR 1 partyDetector → 已在 commits `bd72611e` / `b7a4a3e6` 合入（不在 PR 2 范围）✓
- spec §4.1 字段变更全貌（drop 5 + 加 9）→ Task 1 ✓
- spec §4.1.1 各 source 的 clauseText 填充规则 → Task 4（`clauseText: row.clauseText ?? r.clauseText`）+ Task 9（external_new / global_review 路径，PR 2 surgical 保留 `r.problem` fallback，PR 3 改 globalReview prompt 后升级到 spec 完整规则）✓
- spec §4.2 Prisma schema → Task 1 step 1.1 ✓
- spec §4.3 迁移策略 → **plan 偏离 spec**：spec 是"`--create-only` 生成 + 手工修订迁移 SQL"；plan 改为按用户原则 "schema 改 + prisma 自动生成迁移 + dev 库手工清场"。功能上等价（最终 schema 状态相同、老数据均被清空），但**迁移文件由 prisma 自动生成不再手工修订**，老数据动作脱钩到开发者 dev 库手工 SQL（不进 commit）。
- spec §4.4 类型同步 → Task 2 ✓
- spec §5.0 风险编辑 PATCH 时锚点字段只读 → Task 3 step 3.1（`UpdateContractRiskInput` 不暴露 quote_* / clause_index）✓
- spec §11.2 PR 2-4 同窗口 → PR 描述明确 ✓
- spec §11.3 truncate 执行确认 → 偏离同 §4.3：清场动作改在 dev 库手工执行，不需要"PR 描述同意人"留痕（不再走 database.md "唯一例外"章节）

**基建复用确认：**
- 已确认 contract 域无共享 risk fixture（`grep "makeRisk\|riskFactory" tests/server/agents/contract/ tests/server/assistant/contract/` 无公共 fixture 文件）；本 plan 字段重命名沿用各 .test.ts 现有 inline mock 风格，不引入公共 fixture（属 PR 2 范围外重构）。
- 未引入新 fuzzy match / dmp 工具（`server/agents/contract/utils/textSimilarity.ts` PR 2 不动；PR 3 才扩展该模块）。
- 未误碰 `anchorMigrate.ts` / `wordCommentParser.ts` / `commentInjector.ts`（PR 2 范围外的 utils 内部命名 / docx 解析 / docx 注入语义，均显式标注保留）。

**未覆盖项（spec 留作后续 PR）：**
- PR 3 路线 2 sentence_id 解析、splitSentences、resolveQuoteAnchor
- PR 4 风险卡 Layout A + C
- PR 5 DocxPreview 字符级高亮
- PR 6 redlineInjector
- PR 7 Phase B 双锚点优先级

**Placeholder scan:**
- 没有 "TBD" / "TODO" / "稍后实现" / "类似 Task N"
- 所有 step 给具体代码 diff、grep 命令或 Edit 指令
- 所有命令给期望输出

**Type consistency:**
- `clauseText` / `clauseParagraphIndex` / `originalClauseText` 字段名贯穿全 plan
- `commentInjector.ts` 入参字段名保留 `anchorQuote` / `anchorParagraphIndex`，调用点显式映射
- `MigrateAnchorParams.oldAnchorQuote` / `wordCommentParser.anchorParagraphIndex` 明确标注 PR 2 不动

---

## 执行入口

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-contract-review-pr2-data-model-refactor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 每个 Task 派发新鲜 subagent，主 agent 在 task 间审阅；适合 13 task 这种长 plan 防止上下文爆炸

**2. Inline Execution** - 主 agent 在当前 session 顺序执行，每 commit 后 checkpoint；适合 plan 短或对当前上下文有强依赖

哪种方式？
