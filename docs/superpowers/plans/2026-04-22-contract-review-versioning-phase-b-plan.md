# 合同审查 · 多版本协作 Phase B 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地合同审查"客户回传处理"完整链路：律师点"上传新版本"选择客户回传的 docx → 系统自动做 6 步（自动备份 → 解析 → 识别差异 → AI 增量审查 → 锚点迁移 → 客户端快照）→ 律师看到本轮变化横幅 + 外部新增/客户已移除/孤立批注三种分组 + AI 重审徽章。

**Architecture:** 基于 Phase A 的多版本地基扩展。数据层新增 6 字段 + 3 枚举扩（`ContractReviewVersion.docxFileId` + `ContractRisk.originalAnchorQuote/orphaned` + `ContractAnnotation.wordCommentRef/removedByClient/suppressInExport` + `VersionSystemLabel`/`RiskSource`/`AnnotationAuthorType` 枚举扩）。服务层重写 `commentInjector` 为按 annotation 注入（`w:author='LS:...'` + `w:initials='LEXSEEK-{id}-{rand}'`）；新增 `uploadClientVersion.service.ts` 编排 6 步链路；utils 层加 `wordCommentRef`/`clauseDiff`/`anchorMigrate` 三个纯函数模块。上传端点走 h3 `createEventStream` 返回 SSE 流（不复用 Phase A 的 contract review stream，因后者绑定 LangGraph agent run）；前端用 `fetch + reader` 消费。AI 增量审查复用 M4 `analyzeSingleClause`；全局复核通过 `createChatModel(getValidNodeConfig('contractReviewGlobalReview'))` 走项目 node 配置。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Prisma + PostgreSQL + LangChain + shadcn-vue + Tailwind v4 + Vitest + Bun + `diff-match-patch@^1.0.5`

**Spec:** `docs/superpowers/specs/2026-04-22-contract-review-versioning-phase-b-design.md`（598 行，经两轮 /4check 定稿）

**Phase 边界：**
- 本 Plan：客户回传的完整 6 步处理链路 + 三种分组 UI
- Phase C（独立 Plan）：对比抽屉 / 锚点关键词兜底 / 客户改 AI 批注文本识别 / 重叠风险语义合并

**工期：** 5 天（B1 数据层+上传骨架 = 1.5 天 · B2 批注识别+锚点迁移 = 2 天 · B3 AI 增量审查+联调 = 1.5 天）

---

## 文件清单

### 新建

**数据与类型**
- `prisma/migrations/<ts>_add_contract_review_phase_b_fields/migration.sql` — Phase B 字段迁移

**后端 utils（纯函数，无 DB）**
- `server/services/assistant/contract/utils/wordCommentRef.ts` — 生成/解析/校验稳定身份证
- `server/services/assistant/contract/utils/clauseDiff.ts` — 条款 LCS diff（diff-match-patch 封装）
- `server/services/assistant/contract/utils/anchorMigrate.ts` — 字符级 Levenshtein 锚点匹配

**后端 service**
- `server/services/assistant/contract/uploadClientVersion.service.ts` — 6 步编排
- `server/services/assistant/contract/docx/wordCommentParser.ts` — 解析回传 docx 的 comments.xml

**后端 API**
- `server/api/v1/assistant/contract/reviews/[id]/upload-version.post.ts` — 上传端点（SSE 响应）

**前端**
- `app/components/assistant/contract/ContractUploadNewVersionDialog.vue` — 上传对话框（分步进度）
- `app/components/assistant/contract/ContractRiskMigrationTooltip.vue` — "原文已修改" Tooltip

**数据库 Seed**
- `prisma/seeds/seedData.sql` 追加：`contractReviewGlobalReview` node + prompt

**测试**
- `tests/server/assistant/contract/utils/wordCommentRef.test.ts`
- `tests/server/assistant/contract/utils/clauseDiff.test.ts`
- `tests/server/assistant/contract/utils/anchorMigrate.test.ts`
- `tests/server/assistant/contract/docx/wordCommentParser.test.ts`
- `tests/server/assistant/contract/uploadClientVersion.service.test.ts`
- `tests/server/assistant/contract/reviews.uploadVersion.api.test.ts`
- `tests/app/components/assistant/contract/ContractUploadNewVersionDialog.test.ts`

### 修改

**数据层**
- `prisma/models/contractReviewVersion.prisma` — 加 `docxFileId Int?`
- `prisma/models/contractRiskAndAnnotation.prisma` — risk 加 2 字段 / annotation 加 3 字段 + 索引
- `shared/types/contract.ts` — 枚举扩展（`VersionSystemLabel` / `RiskSource` / `AnnotationAuthorType`）+ SSE 事件类型 + 实体字段

**后端服务**
- `server/services/assistant/contract/docx/commentInjector.ts` — 重写：新增 `injectAnnotations(buf, annotations[])` 入口
- `server/services/assistant/contract/contractReviewVersion.service.ts` — `saveContractReviewVersionService` 扩 `clauses` 字段
- `server/services/workflow/agents/contractReviewMainAgent.ts` — `persistRisksAndCreateV1Snapshot` 写 clauses；M5 导出链路切到 `injectAnnotations`
- `server/api/v1/assistant/contract/reviews/[id]/download.get.ts`（或现有导出 handler）— 切到 `injectAnnotations`

**前端**
- `app/composables/useContractReviewVersion.ts` — 加 `uploadNewVersion(ossFileId)` 方法（消费 SSE 流）
- `app/components/assistant/contract/ContractReviewPanel.vue` — 加"上传新版本"按钮 + 对话框挂载 + 本轮变化横幅
- `app/components/assistant/contract/RiskListPanel.vue` — 外部新增分组（顶置）/ 客户已移除分组（折叠在底）/ 孤立批注区 / AI 已重审徽章 / 风险升降级徽章

---

# 子期 B1 · 数据层 + 上传骨架（Day 1 + 半天）

## Task 1.1: Phase B Prisma 迁移 + shared types 扩展

**Files:**
- Modify: `prisma/models/contractReviewVersion.prisma`
- Modify: `prisma/models/contractRiskAndAnnotation.prisma`
- Create: `prisma/migrations/<ts>_add_contract_review_phase_b_fields/migration.sql`
- Modify: `shared/types/contract.ts`

- [ ] **Step 1: 扩展 `contractReviewVersion.prisma`**

```prisma
model contractReviewVersions {
  // 现有字段保留
  // ...
  /// Phase B：client_return 版本绑定的客户上传 docx 文件（initial_upload/lawyer_save/auto_backup 为 null）
  docxFileId    Int?     @map("docx_file_id")
  // ...
}
```

- [ ] **Step 2: 扩展 `contractRiskAndAnnotation.prisma`**

```prisma
model contractRisks {
  // 现有字段保留
  // ...
  /// Phase B：锚点首次迁移前的原文（UI "原文已修改" Tooltip 展示）
  originalAnchorQuote String?  @map("original_anchor_quote") @db.Text
  /// Phase B：当前版本无法定位锚点（孤立批注区）
  orphaned            Boolean  @default(false)
  // ...
}

model contractAnnotations {
  // 现有字段保留
  // ...
  /// Phase B：Word 批注稳定身份证（格式 LEXSEEK-{annotationId}-{random8}）
  wordCommentRef   String?  @map("word_comment_ref") @db.VarChar(60)
  /// Phase B：客户在 Word 里删了该批注
  removedByClient  Boolean  @default(false) @map("removed_by_client")
  /// Phase B：下次导出 docx 时跳过（removedByClient=true 时默认 true；律师"恢复推送"可将此置 false）
  suppressInExport Boolean  @default(false) @map("suppress_in_export")
  // ...
  @@index([wordCommentRef])
}
```

- [ ] **Step 3: 生成迁移 SQL**

```bash
bun run prisma:migrate --name add_contract_review_phase_b_fields --create-only
```

**人工审阅** `prisma/migrations/<ts>_add_contract_review_phase_b_fields/migration.sql`：
- 确认**仅** `ALTER TABLE ADD COLUMN` 和 `CREATE INDEX` 语句
- **不允许**出现 `DROP` 或改已有 risks JSON 字段
- 不允许 `checkpoint`/`store` 等 LangGraph 非管辖表的 DDL

- [ ] **Step 4: 应用到本地 + 测试库**

```bash
bun run prisma:migrate
DATABASE_URL='postgresql://daixin:daixin88@127.0.0.1:5432/ls_new_testing?schema=public&TimeZone=UTC' bun run prisma:deploy
```

- [ ] **Step 5: Prisma generate + typecheck**

```bash
bun run prisma:generate
npx nuxi typecheck
```

- [ ] **Step 6: 扩展 `shared/types/contract.ts` 枚举**

```ts
// ===== VersionSystemLabel 扩展 =====
export const VERSION_SYSTEM_LABELS = [
  'initial_upload',
  'lawyer_save',
  'client_return',  // Phase B 新增
  'auto_backup',    // Phase B 新增
] as const

export const VERSION_SYSTEM_LABEL_DISPLAY: Record<VersionSystemLabel, string> = {
  initial_upload: '初次上传',
  lawyer_save: '律师保存',
  client_return: '客户回传',   // Phase B 新增
  auto_backup: '自动备份',     // Phase B 新增
}

// ===== RiskSource 扩展 =====
export const RISK_SOURCES = ['ai', 'external_new', 'global_review'] as const

// ===== AnnotationAuthorType 扩展 =====
export const ANNOTATION_AUTHOR_TYPES = ['ai', 'lawyer', 'external'] as const
```

- [ ] **Step 7: 新增 Phase B 实体字段**

```ts
// ContractRiskEntity 加 2 字段
export interface ContractRiskEntity {
  // 现有字段保留
  originalAnchorQuote: string | null
  orphaned: boolean
}

// ContractAnnotationEntity 加 3 字段
export interface ContractAnnotationEntity {
  // 现有字段保留
  wordCommentRef: string | null
  removedByClient: boolean
  suppressInExport: boolean
}

// ContractReviewVersionEntity 加 1 字段
export interface ContractReviewVersionEntity {
  // 现有字段保留
  docxFileId: number | null
}
```

- [ ] **Step 8: SSE 事件类型**

```ts
export const CONTRACT_UPLOAD_VERSION_SSE_EVENT = {
  PROGRESS: 'upload-version-progress',
  COMPLETE: 'upload-version-complete',
  ERROR: 'upload-version-error',
} as const

export type UploadVersionStep = 'backup' | 'parse' | 'diff' | 'ai' | 'merge'
export type UploadVersionStatus = 'done' | 'progress'

export interface UploadVersionProgressData {
  step: UploadVersionStep
  status: UploadVersionStatus
  // diff 步骤特有
  externalChangeCount?: number
  clauseModifiedCount?: number
  // ai 步骤 progress 特有
  total?: number
  current?: number
  // merge 步骤特有
  newVersionId?: number
}

export interface UploadVersionCompleteData {
  newVersionId: number
  summary: string   // 如 "4 处外部变更 · 1 条正文修改 · AI 已重审"
}

export interface UploadVersionErrorData {
  step: UploadVersionStep
  code: string      // 如 'PARSE_FAILED' / 'DIFF_FAILED'
  message: string
}
```

- [ ] **Step 9: typecheck 验证**

```bash
npx nuxi typecheck
```

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(contract): Phase B 数据模型扩展（6 字段 + 3 枚举扩）"
```

---

## Task 1.2: wordCommentRef 纯函数 utils

**Files:**
- Create: `server/services/assistant/contract/utils/wordCommentRef.ts`
- Create: `tests/server/assistant/contract/utils/wordCommentRef.test.ts`

- [ ] **Step 1: 先写测试（TDD）**

```ts
// tests/server/assistant/contract/utils/wordCommentRef.test.ts
import { describe, it, expect } from 'vitest'
import {
  generateWordCommentRef,
  parseWordCommentRef,
  isWordCommentRef,
} from '~/server/services/assistant/contract/utils/wordCommentRef'

describe('wordCommentRef utils', () => {
  it('generateWordCommentRef 返回 LEXSEEK-{id}-{random8} 格式', () => {
    const ref = generateWordCommentRef(42)
    expect(ref).toMatch(/^LEXSEEK-42-[a-zA-Z0-9]{8}$/)
  })

  it('parseWordCommentRef 解析出 annotationId', () => {
    expect(parseWordCommentRef('LEXSEEK-42-abc12345')).toEqual({ annotationId: 42 })
    expect(parseWordCommentRef('invalid')).toBeNull()
    expect(parseWordCommentRef('')).toBeNull()
    expect(parseWordCommentRef(null)).toBeNull()
  })

  it('isWordCommentRef 判断是否为系统格式', () => {
    expect(isWordCommentRef('LEXSEEK-42-abc12345')).toBe(true)
    expect(isWordCommentRef('张三')).toBe(false)
    expect(isWordCommentRef('')).toBe(false)
  })

  it('同一 annotationId 每次生成 random 段不同', () => {
    const a = generateWordCommentRef(1)
    const b = generateWordCommentRef(1)
    expect(a).not.toBe(b)
  })
})
```

运行：
```bash
npx vitest run tests/server/assistant/contract/utils/wordCommentRef.test.ts
```
预期 FAIL（函数未实现）。

- [ ] **Step 2: 实现**

```ts
// server/services/assistant/contract/utils/wordCommentRef.ts
/**
 * Word 批注稳定身份证工具。
 *
 * 格式：LEXSEEK-{annotationId}-{random8}
 * - 写入 Word 的 w:initials 字段（不加 LS: 前缀）
 * - 客户端 Word 编辑不破坏此字段，回传时按格式正则匹配识别
 * - w:author 另写 'LS:<authorName>' 供客户主视图可见（见 commentInjector）
 */

const WORD_COMMENT_REF_PATTERN = /^LEXSEEK-(\d+)-[a-zA-Z0-9]{8}$/

/** 生成 8 位随机段 */
function random8(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let s = ''
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
    return s
}

/** 生成新的 wordCommentRef。同一 annotationId 多次调用产生不同 random 段 */
export function generateWordCommentRef(annotationId: number): string {
    return `LEXSEEK-${annotationId}-${random8()}`
}

/** 判断字符串是否为合法 wordCommentRef */
export function isWordCommentRef(value: string | null | undefined): boolean {
    if (!value) return false
    return WORD_COMMENT_REF_PATTERN.test(value)
}

/** 解析 wordCommentRef 获取 annotationId；格式不匹配返回 null */
export function parseWordCommentRef(value: string | null | undefined): { annotationId: number } | null {
    if (!value) return null
    const m = value.match(WORD_COMMENT_REF_PATTERN)
    if (!m) return null
    return { annotationId: Number(m[1]) }
}
```

- [ ] **Step 3: 测试通过**

```bash
npx vitest run tests/server/assistant/contract/utils/wordCommentRef.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): wordCommentRef 纯函数 utils + 测试"
```

---

## Task 1.3: commentInjector 重写（新增 injectAnnotations 入口）

**Files:**
- Modify: `server/services/assistant/contract/docx/commentInjector.ts`
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`（M5 导出调用点切换）

- [ ] **Step 1: 分析现有 commentInjector**

```bash
grep -n "injectComments\|buildCommentsXml\|w:author\|w:initials" server/services/assistant/contract/docx/commentInjector.ts | head -20
```

理解现有 `injectComments(buf, risks)` 的内部函数组织，识别哪些 helper 可复用（XML 构建、zip 打包等）。

- [ ] **Step 2: 新增 `injectAnnotations` 入口**

在文件末尾（或独立 section）追加：

```ts
import { generateWordCommentRef } from '../utils/wordCommentRef'
import type { AnnotationAuthorType } from '#shared/types/contract'

export interface ContractAnnotationForExport {
    id: number
    riskId: number
    authorType: AnnotationAuthorType
    authorName: string              // AI=固定 "AI"；lawyer=律师姓名；external=Word author 原值
    content: string
    parentAnnotationId: number | null
    anchorQuote: string             // 锚点原文
    anchorParagraphIndex: number    // 条款索引
    wordCommentRef: string | null   // 已存在则沿用；为 null 内部生成
}

export interface InjectAnnotationsResult {
    buffer: Buffer
    /** 每条 annotation 最终使用的 wordCommentRef（供调用方回写 DB）*/
    refsByAnnotationId: Map<number, string>
}

/**
 * 按 annotation 注入 Word 批注。Phase B 新入口。
 *
 * 规则：
 * - 每条 annotation 组装成 <w:comment>，w:id 按 annotations 数组顺序 0,1,2...
 * - w:author = 'LS:' + annotation.authorName（客户主视图可见 LS 标识）
 * - w:initials = wordCommentRef（格式 LEXSEEK-{id}-{rand8}，不加 LS 前缀；解析时按格式正则识别）
 * - parentAnnotationId 非空 → 输出 Word "答复批注" XML 引用父 w:id
 */
export function injectAnnotations(
    docxBuffer: Buffer,
    annotations: ContractAnnotationForExport[],
): InjectAnnotationsResult {
    const refsByAnnotationId = new Map<number, string>()

    // 1. 为每条 annotation 确定 wordCommentRef
    for (const a of annotations) {
        const ref = a.wordCommentRef ?? generateWordCommentRef(a.id)
        refsByAnnotationId.set(a.id, ref)
    }

    // 2. 按原顺序分配 Word 本地 w:id（0,1,2...）
    const wordIdByAnnotationId = new Map<number, number>()
    annotations.forEach((a, idx) => wordIdByAnnotationId.set(a.id, idx))

    // 3. 组装 comments.xml
    const commentsXml = buildCommentsXmlFromAnnotations(annotations, refsByAnnotationId, wordIdByAnnotationId)

    // 4. 在 docxBuffer 的 document.xml 对应段落处插入 commentRangeStart/End/Reference 标记
    //    （复用现有 injectComments 的锚点查找逻辑，但按 anchorParagraphIndex + anchorQuote 定位）
    const outputBuffer = mergeCommentsIntoDocx(docxBuffer, commentsXml, annotations, wordIdByAnnotationId)

    return { buffer: outputBuffer, refsByAnnotationId }
}

function buildCommentsXmlFromAnnotations(
    annotations: ContractAnnotationForExport[],
    refs: Map<number, string>,
    wordIds: Map<number, number>,
): string {
    const items = annotations.map(a => {
        const wId = wordIds.get(a.id)!
        const initials = refs.get(a.id)!
        const author = `LS:${a.authorName}`
        // 答复批注的 parentId 引用父 w:id
        const parentAttr = a.parentAnnotationId !== null && wordIds.has(a.parentAnnotationId)
            ? ` w:parentId="${wordIds.get(a.parentAnnotationId)}"`
            : ''
        return `<w:comment w:id="${wId}" w:author="${escapeXml(author)}" w:initials="${escapeXml(initials)}" w:date="${new Date().toISOString()}"${parentAttr}>
            <w:p><w:r><w:t xml:space="preserve">${escapeXml(a.content)}</w:t></w:r></w:p>
        </w:comment>`
    }).join('\n')

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
${items}
</w:comments>`
}

// mergeCommentsIntoDocx / escapeXml 复用现有 commentInjector 里的同名 helper（或重命名抽取）
```

**关键**：`mergeCommentsIntoDocx` 需要从现有 `injectComments` 里抽取或复用。如果抽取工作量过大，可以在新入口内重建一个简化版只处理 annotation 的锚点插入；测试验证输出 docx 在 Word 里能正常打开。

- [ ] **Step 3: 写集成测试 —— 验证 Word 打开可读**

```ts
// tests/server/assistant/contract/docx/commentInjector.annotations.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { injectAnnotations, ContractAnnotationForExport } from '~/server/services/assistant/contract/docx/commentInjector'
import { parseWordCommentRef } from '~/server/services/assistant/contract/utils/wordCommentRef'

describe('commentInjector.injectAnnotations', () => {
    const fixture = readFileSync(path.resolve('tests/server/assistant/contract/docx/fixtures/sample.docx'))

    it('注入 3 条 annotation 后 w:initials 全部符合 LEXSEEK 格式', async () => {
        const annotations: ContractAnnotationForExport[] = [
            { id: 1, riskId: 10, authorType: 'ai', authorName: 'AI', content: 'AI 审查意见', parentAnnotationId: null, anchorQuote: '违约金 20%', anchorParagraphIndex: 0, wordCommentRef: null },
            { id: 2, riskId: 10, authorType: 'lawyer', authorName: '张律师', content: '下调到 10%', parentAnnotationId: 1, anchorQuote: '违约金 20%', anchorParagraphIndex: 0, wordCommentRef: null },
            { id: 3, riskId: 20, authorType: 'external', authorName: '客户甲', content: '管辖法院改深圳', parentAnnotationId: null, anchorQuote: '北京', anchorParagraphIndex: 1, wordCommentRef: null },
        ]

        const { buffer, refsByAnnotationId } = injectAnnotations(fixture, annotations)

        // 验证返回 refs
        expect(refsByAnnotationId.size).toBe(3)
        for (const [id, ref] of refsByAnnotationId) {
            expect(parseWordCommentRef(ref)?.annotationId).toBe(id)
        }

        // 验证 docx 可解压
        expect(buffer.length).toBeGreaterThan(fixture.length)

        // 可选：用 JSZip 解包 buffer，检查 word/comments.xml 是否包含 LS:AI / LS:张律师 / LS:客户甲
    })
})
```

> 注：如果项目还没有 `sample.docx` fixture，复用 Phase A/M4 测试用的现成 fixture（搜 `tests/**/*.docx`）。

- [ ] **Step 4: 切换 M5 导出链路**

定位现有调用 `injectComments` 的地方：

```bash
grep -rn "injectComments(" server/ | grep -v ".test.ts"
```

把每个调用点改为 `injectAnnotations`，把 risks[] 转换成 annotations[]（按 risk.id 把对应 annotations 从 DB 查出来组装 `ContractAnnotationForExport`），并把返回的 `refsByAnnotationId` 批量写回 DB：

```ts
// 调用方伪代码
const annotations = await loadAnnotationsForExport(reviewId)  // 过滤 deletedAt=null + suppressInExport=false
const { buffer, refsByAnnotationId } = injectAnnotations(docxBuffer, annotations)
await prisma.$transaction(
    Array.from(refsByAnnotationId.entries()).map(([annotationId, ref]) =>
        prisma.contractAnnotations.update({ where: { id: annotationId }, data: { wordCommentRef: ref } })
    )
)
```

- [ ] **Step 5: 测试通过**

```bash
npx vitest run tests/server/assistant/contract/docx/
npx vitest run tests/server/assistant/contract/ -t "M5 导出"   # 回归现有 M5 测试
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(contract): commentInjector 新增 injectAnnotations 入口 + M5 导出切换"
```

---

## Task 1.4: saveContractReviewVersionService 扩展 clauses 写入

**Files:**
- Modify: `server/services/assistant/contract/contractReviewVersion.service.ts`
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts` 的 `persistRisksAndCreateV1Snapshot`

- [ ] **Step 1: 扩展 `SaveVersionInput`**

```ts
// contractReviewVersion.service.ts
export interface SaveVersionInput {
    reviewId: number
    systemLabel: VersionSystemLabel
    lawyerNote?: string | null
    docxFileId?: number | null          // Phase B 新增：client_return 版本绑定
    createdById: number
    docxText?: string
    clauses?: Array<{ index: number; text: string; offsetStart: number; offsetEnd: number }>  // Phase B 新增
}
```

- [ ] **Step 2: 修改 `saveContractReviewVersionService` transaction 内的 snapshot 组装**

```ts
// 2. 从入参或当前版本继承 docxText + clauses
let docxText = input.docxText ?? ''
let clauses = input.clauses ?? []
if (!input.docxText && review.currentVersionId) {
    const prev = await tx.contractReviewVersions.findUnique({
        where: { id: review.currentVersionId },
        select: { snapshotData: true },
    })
    const prevSnap = prev?.snapshotData as { docxText?: string; clauses?: typeof clauses } | undefined
    docxText = prevSnap?.docxText ?? ''
    clauses = prevSnap?.clauses ?? []   // Phase B 新增继承
}

// 3. 查 risks + annotations 不变

// 4. 组装 snapshot 加 clauses
const snapshotData = { risks, annotations, docxText, clauses }

// 5. 创建版本带 docxFileId
const version = await tx.contractReviewVersions.create({
    data: {
        reviewId,
        versionNumber,
        systemLabel,
        lawyerNote: lawyerNote ?? null,
        docxFileId: input.docxFileId ?? null,   // Phase B 新增
        snapshotData,
        createdById,
    },
})
```

- [ ] **Step 3: 扩展 `persistRisksAndCreateV1Snapshot`**

定位现有 M4 persist 路径（子期 1 Task 4.1 里实施过），加上 clauses 参数：

```ts
// contractReviewMainAgent.ts 的 persistRisksAndCreateV1Snapshot 新签名
async function persistRisksAndCreateV1Snapshot(
    reviewId: number,
    userId: number,
    risks: Risk[],
    docxText: string,
    clauses: Array<{ index: number; text: string; offsetStart: number; offsetEnd: number }>,  // Phase B 新增
): Promise<void> {
    // ... 现有逻辑
    await saveContractReviewVersionService({
        reviewId,
        systemLabel: 'initial_upload',
        createdById: userId,
        docxText,
        clauses,   // Phase B 新增
    })
}
```

调用方把 segment 阶段产出的 `ClauseSegment[]` 映射成 `{ index, text, offsetStart, offsetEnd }[]` 传入。

- [ ] **Step 4: 更新相关测试**

`tests/server/assistant/contract/contractReviewVersion.service.test.ts` 加新用例：

```ts
it('传入 clauses 时写入 snapshotData', async () => {
    const v1 = await saveContractReviewVersionService({
        reviewId, systemLabel: 'initial_upload', createdById: userId,
        docxText: '合同正文',
        clauses: [{ index: 0, text: '第一条', offsetStart: 0, offsetEnd: 10 }],
    })
    const loaded = await loadContractReviewVersionSnapshotService(v1.id)
    if ('error' in loaded) throw new Error('snapshot 应返回 data')
    expect(loaded.data.snapshot.clauses).toHaveLength(1)
})

it('不传 clauses 时从 currentVersion 继承', async () => {
    const v1 = await saveContractReviewVersionService({
        reviewId, systemLabel: 'initial_upload', createdById: userId,
        docxText: 'x', clauses: [{ index: 0, text: 'A', offsetStart: 0, offsetEnd: 1 }],
    })
    const v2 = await saveContractReviewVersionService({
        reviewId, systemLabel: 'lawyer_save', createdById: userId,
    })
    const loaded = await loadContractReviewVersionSnapshotService(v2.id)
    if ('error' in loaded) throw new Error()
    expect(loaded.data.snapshot.clauses).toHaveLength(1)
    expect(loaded.data.snapshot.clauses[0].text).toBe('A')
})
```

- [ ] **Step 5: 测试通过**

```bash
npx vitest run tests/server/assistant/contract/contractReviewVersion.service.test.ts
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(contract): saveContractReviewVersionService 扩 clauses + docxFileId 字段"
```

---

## Task 1.5: uploadClientVersion.service 骨架（backup + parse + 占位 merge）

**Files:**
- Create: `server/services/assistant/contract/uploadClientVersion.service.ts`
- Create: `tests/server/assistant/contract/uploadClientVersion.service.test.ts`

- [ ] **Step 1: 先实现骨架**

```ts
// server/services/assistant/contract/uploadClientVersion.service.ts
/**
 * 客户回传 docx 上传处理链路（6 步）。
 *
 * B1 阶段实现：Step 1 备份 + Step 2 解析 + Step 6 合并快照（diff 和 AI 步骤占位）。
 * B2 阶段填充：Step 3 diff + Step 5 锚点迁移。
 * B3 阶段填充：Step 4 AI 增量审查 + 全局复核。
 *
 * 编排函数通过 AsyncGenerator 吐出进度事件，调用方（handler）逐个 yield 成 SSE 响应。
 */

import type { contractReviews } from '@prisma-app/client'
import type { UploadVersionProgressData, UploadVersionCompleteData, UploadVersionErrorData } from '#shared/types/contract'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { loadContractFullText } from '~~/server/services/assistant/contract/docx/fullTextLoader'  // 假设现有
import { segmentClauses } from '~~/server/services/assistant/contract/docx/clauseSegmenter'
import { saveContractReviewVersionService } from './contractReviewVersion.service'

type UploadEvent =
    | { type: 'progress'; data: UploadVersionProgressData }
    | { type: 'complete'; data: UploadVersionCompleteData }
    | { type: 'error'; data: UploadVersionErrorData }

export async function* uploadClientVersionService(params: {
    review: contractReviews
    ossFileId: number
    userId: number
}): AsyncGenerator<UploadEvent> {
    const { review, ossFileId, userId } = params

    // ============ Step 1: 自动备份当前工作区 ============
    try {
        const hasUnsavedEdits = await detectUnsavedEdits(review.id, review.currentVersionId)
        if (hasUnsavedEdits) {
            await saveContractReviewVersionService({
                reviewId: review.id,
                systemLabel: 'auto_backup',
                createdById: userId,
            })
        }
        yield { type: 'progress', data: { step: 'backup', status: 'done' } }
    } catch (e: any) {
        yield { type: 'error', data: { step: 'backup', code: 'BACKUP_FAILED', message: e?.message ?? '备份失败' } }
        return
    }

    // ============ Step 2: 解析新上传 docx ============
    let newDocxText: string
    let newClauses: Array<{ index: number; text: string; offsetStart: number; offsetEnd: number }>
    let newRawComments: any[]    // B2 填充类型，这里先 any
    try {
        const ossFile = await findOssFileByIdDao(ossFileId)
        if (!ossFile) throw new Error('OSS 文件不存在')

        newDocxText = await loadContractFullText(ossFileId)
        const segments = await segmentClauses(newDocxText, { maxLength: 2000 })  // segment 选项用项目默认
        newClauses = segments.map((s, i) => ({
            index: i,
            text: s.text,
            offsetStart: s.offsetStart ?? 0,
            offsetEnd: s.offsetEnd ?? 0,
        }))
        newRawComments = []   // B2 填充：解析 comments.xml

        yield { type: 'progress', data: { step: 'parse', status: 'done' } }
    } catch (e: any) {
        yield { type: 'error', data: { step: 'parse', code: 'PARSE_FAILED', message: e?.message ?? '解析失败' } }
        return
    }

    // ============ Step 3: 识别差异（B2 填充）============
    // 占位：B1 阶段假装没有差异
    yield { type: 'progress', data: { step: 'diff', status: 'done', externalChangeCount: 0, clauseModifiedCount: 0 } }

    // ============ Step 4: AI 增量审查（B3 填充）============
    yield { type: 'progress', data: { step: 'ai', status: 'done' } }

    // ============ Step 5: 锚点迁移（B2 填充）============
    // 无独立事件，归入 merge 前的数据处理

    // ============ Step 6: 写工作区 + 新版本快照 ============
    try {
        const newVersion = await saveContractReviewVersionService({
            reviewId: review.id,
            systemLabel: 'client_return',
            docxFileId: ossFileId,
            createdById: userId,
            docxText: newDocxText,
            clauses: newClauses,
        })

        const summary = '新版本已就绪'  // B2/B3 填充具体统计
        yield { type: 'progress', data: { step: 'merge', status: 'done', newVersionId: newVersion.id } }
        yield { type: 'complete', data: { newVersionId: newVersion.id, summary } }
    } catch (e: any) {
        yield { type: 'error', data: { step: 'merge', code: 'MERGE_FAILED', message: e?.message ?? '合并失败' } }
    }
}

/**
 * 判断工作区相对 currentVersion 是否有未保存编辑。
 * Phase A spec §4.3.1 自动备份幂等规则的实现。
 */
async function detectUnsavedEdits(reviewId: number, currentVersionId: number | null): Promise<boolean> {
    if (currentVersionId == null) return false
    const [latestRisk, latestAnn, currentVer] = await Promise.all([
        prisma.contractRisks.findFirst({ where: { reviewId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
        prisma.contractAnnotations.findFirst({ where: { reviewId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
        prisma.contractReviewVersions.findUnique({ where: { id: currentVersionId }, select: { createdAt: true } }),
    ])
    if (!currentVer) return false
    const latestEdit = Math.max(
        latestRisk?.updatedAt?.getTime() ?? 0,
        latestAnn?.createdAt?.getTime() ?? 0,
    )
    return latestEdit > currentVer.createdAt.getTime()
}
```

- [ ] **Step 2: 写 B1 骨架测试**

```ts
// tests/server/assistant/contract/uploadClientVersion.service.test.ts
describe('uploadClientVersionService', () => {
    let reviewId: number
    let ossFileId: number
    let userId: number

    beforeEach(async () => {
        // setup fixture review + ossFile
        // ...
    })

    afterEach(async () => {
        // cleanup
    })

    it('B1 骨架：从开始到完成产出 5 个 progress + 1 个 complete 事件', async () => {
        const review = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
        const events = []
        for await (const evt of uploadClientVersionService({ review: review!, ossFileId, userId })) {
            events.push(evt)
        }

        expect(events.filter(e => e.type === 'progress')).toHaveLength(5)
        expect(events.filter(e => e.type === 'complete')).toHaveLength(1)

        const complete = events.find(e => e.type === 'complete')
        expect(complete?.data.newVersionId).toBeGreaterThan(0)
    })

    it('无未保存编辑时跳过 auto_backup（不产新版本）', async () => {
        // 设置 review.currentVersionId 对应的 version 的 createdAt = 当前
        // 执行 upload
        // 断言 versions 表只多了 client_return 一条，没 auto_backup
    })

    it('OSS 文件不存在时发 error 事件', async () => {
        const review = await prisma.contractReviews.findUnique({ where: { id: reviewId } })
        const events = []
        for await (const evt of uploadClientVersionService({ review: review!, ossFileId: 999999, userId })) {
            events.push(evt)
            if (evt.type === 'error') break
        }
        const err = events.find(e => e.type === 'error')
        expect(err?.data.code).toBe('PARSE_FAILED')
    })
})
```

- [ ] **Step 3: 测试通过**

```bash
npx vitest run tests/server/assistant/contract/uploadClientVersion.service.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): uploadClientVersion service 骨架（B1 backup+parse+merge）"
```

---

## Task 1.6: upload-version.post handler（SSE 响应）

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/upload-version.post.ts`
- Create: `tests/server/assistant/contract/reviews.uploadVersion.api.test.ts`

- [ ] **Step 1: 实现 handler**

```ts
// server/api/v1/assistant/contract/reviews/[id]/upload-version.post.ts
/**
 * POST /api/v1/assistant/contract/reviews/:id/upload-version
 *
 * 客户回传 docx 上传处理入口。返回 SSE 流（text/event-stream）。
 * Body: { ossFileId: number }
 *
 * 错误分支：
 * - 401/400/403/404: 校验失败，返回 resError（流未打开）
 * - 流打开后失败：发 upload-version-error 事件再关流
 */

import { z } from 'zod'
import { createEventStream } from 'h3'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { uploadClientVersionService } from '~~/server/services/assistant/contract/uploadClientVersion.service'

const bodySchema = z.object({
    ossFileId: z.number().int().positive(),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '上传新版本' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { user, review } = guard

    // busy 状态拦截（审查进行中不允许上传新版本，避免工作流冲突）
    if (['pending', 'reviewing', 'awaiting_stance', 'rebuilding'].includes(review.status)) {
        return resError(event, 409, '审查进行中，请等待完成再上传新版本')
    }

    const raw = await readBody(event)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    // 打开 SSE 流（h3 createEventStream）
    const eventStream = createEventStream(event)

    // 异步消费 async generator，推送到 SSE
    ;(async () => {
        try {
            for await (const evt of uploadClientVersionService({
                review,
                ossFileId: parsed.data.ossFileId,
                userId: user.id,
            })) {
                let eventName: string
                if (evt.type === 'progress') eventName = 'upload-version-progress'
                else if (evt.type === 'complete') eventName = 'upload-version-complete'
                else eventName = 'upload-version-error'

                await eventStream.push({
                    event: eventName,
                    data: JSON.stringify(evt.data),
                })

                if (evt.type === 'error' || evt.type === 'complete') break
            }
        } catch (e: any) {
            logger.error('upload-version handler 异常', { error: e })
            await eventStream.push({
                event: 'upload-version-error',
                data: JSON.stringify({ step: 'merge', code: 'INTERNAL', message: '服务器内部错误' }),
            })
        } finally {
            await eventStream.close()
        }
    })()

    return eventStream.send()
})
```

- [ ] **Step 2: 集成测试（mock 服务层）**

```ts
// tests/server/assistant/contract/reviews.uploadVersion.api.test.ts
// 参照项目现有 *.api.test.ts 的 mock 风格
import { describe, it, expect, vi, beforeEach } from 'vitest'

;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).readBody = async (event: any) => event.__body
// createEventStream / h3 SSE mock

vi.mock('~~/server/services/assistant/contract/reviewGuard', () => ({
    loadOwnedReview: vi.fn(),
}))

vi.mock('~~/server/services/assistant/contract/uploadClientVersion.service', () => ({
    uploadClientVersionService: vi.fn(),
}))

// ... handler 测试：
// - 401 未登录 / 400 非法 body / 403 越权 / 404 review 不存在 / 409 busy 状态
// - happy path: mock service 产出 5 progress + complete，handler 正确写出 SSE 事件
```

- [ ] **Step 3: 测试通过**

```bash
npx vitest run tests/server/assistant/contract/reviews.uploadVersion.api.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): POST /reviews/:id/upload-version handler (SSE 响应)"
```

---

## Task 1.7: 前端 composable + 上传 Dialog

**Files:**
- Modify: `app/composables/useContractReviewVersion.ts`
- Create: `app/components/assistant/contract/ContractUploadNewVersionDialog.vue`
- Create: `tests/app/components/assistant/contract/ContractUploadNewVersionDialog.test.ts`

- [ ] **Step 1: composable 加 uploadNewVersion 方法**

在 `useContractReviewVersion.ts` 里追加：

```ts
import type {
    UploadVersionProgressData,
    UploadVersionCompleteData,
    UploadVersionErrorData,
    UploadVersionStep,
} from '#shared/types/contract'

export interface UploadProgress {
    step: UploadVersionStep | null
    status: 'running' | 'done' | 'error'
    current?: number
    total?: number
    errorMessage?: string
}

async function uploadNewVersion(
    ossFileId: number,
    onProgress?: (p: UploadProgress) => void,
): Promise<{ success: boolean; newVersionId?: number; summary?: string }> {
    if (isReadOnly.value) return { success: false }

    const response = await $fetch.raw<ReadableStream>(
        `/api/v1/assistant/contract/reviews/${reviewId.value}/upload-version`,
        {
            method: 'POST',
            body: { ossFileId },
            responseType: 'stream',
            credentials: 'include',
        },
    )

    const reader = response.body?.getReader()
    if (!reader) return { success: false }

    const decoder = new TextDecoder()
    let buffer = ''
    let result: { success: boolean; newVersionId?: number; summary?: string } = { success: false }

    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // 按 \n\n 分隔 SSE 帧
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
            const evtMatch = frame.match(/^event:\s*(.+)$/m)
            const dataMatch = frame.match(/^data:\s*(.+)$/m)
            if (!evtMatch || !dataMatch) continue
            const evtName = evtMatch[1].trim()
            const data = JSON.parse(dataMatch[1])

            if (evtName === 'upload-version-progress') {
                onProgress?.({
                    step: (data as UploadVersionProgressData).step,
                    status: 'done',
                    current: data.current,
                    total: data.total,
                })
            } else if (evtName === 'upload-version-complete') {
                const d = data as UploadVersionCompleteData
                result = { success: true, newVersionId: d.newVersionId, summary: d.summary }
            } else if (evtName === 'upload-version-error') {
                const d = data as UploadVersionErrorData
                onProgress?.({ step: d.step, status: 'error', errorMessage: d.message })
                result = { success: false }
            }
        }
    }

    if (result.success) {
        await Promise.all([refreshWorkspace(), refreshVersions()])
    }
    return result
}

// 在 return 加 uploadNewVersion
return {
    // ... 现有导出
    uploadNewVersion,
}
```

- [ ] **Step 2: 实现 ContractUploadNewVersionDialog.vue**

```vue
<script setup lang="ts">
import { UploadIcon, Loader2, Check, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { DOCX_MIME } from '#shared/utils/mime'
import { FileSource } from '#shared/types/file'
import type { UploadVersionStep } from '#shared/types/contract'
import { useBatchUpload } from '~/composables/useBatchUpload'

const props = defineProps<{
    open: boolean
    reviewId: number
}>()
const emit = defineEmits<{
    'update:open': [value: boolean]
    'completed': [newVersionId: number, summary: string]
}>()

const fileStore = useFileStore()
const { uploadToOSS } = useBatchUpload()
const versioning = useContractReviewVersion(computed(() => props.reviewId))

const MAX_SIZE = 20 * 1024 * 1024
const selectedFile = ref<File | null>(null)
const isDragOver = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

/** 5 步进度状态 */
interface StepState {
    key: UploadVersionStep
    label: string
    status: 'pending' | 'running' | 'done' | 'error'
    errorMessage?: string
}
const steps = ref<StepState[]>([
    { key: 'backup', label: '备份当前工作区', status: 'pending' },
    { key: 'parse', label: '解析新文件', status: 'pending' },
    { key: 'diff', label: '识别客户变更', status: 'pending' },
    { key: 'ai', label: 'AI 重审改动条款', status: 'pending' },
    { key: 'merge', label: '合并结果', status: 'pending' },
])
const isRunning = ref(false)

watch(() => props.open, (v) => {
    if (!v) {
        selectedFile.value = null
        isRunning.value = false
        steps.value.forEach(s => { s.status = 'pending'; s.errorMessage = undefined })
    }
})

function applyFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.docx')) return toast.warning('仅支持 .docx')
    if (file.size > MAX_SIZE) return toast.warning('文件不得超过 20 MB')
    selectedFile.value = file
}
function handleFileSelect(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) applyFile(file)
    if (fileInputRef.value) fileInputRef.value.value = ''
}
function handleDrop(e: DragEvent) {
    isDragOver.value = false
    const file = e.dataTransfer?.files?.[0]
    if (file) applyFile(file)
}

async function startUpload() {
    if (!selectedFile.value || isRunning.value) return
    isRunning.value = true

    // 标记 backup 为 running
    const setStep = (key: UploadVersionStep, status: StepState['status'], errorMessage?: string) => {
        const s = steps.value.find(x => x.key === key)
        if (s) { s.status = status; s.errorMessage = errorMessage }
    }
    setStep('backup', 'running')

    try {
        // 1. OSS 预签名上传
        const signatures = await fileStore.getBatchPresignedUrls({
            source: FileSource.CASE_ANALYSIS,  // 复用 Phase A 同款枚举
            files: [{
                originalFileName: selectedFile.value.name,
                fileSize: selectedFile.value.size,
                mimeType: DOCX_MIME,
            }],
            encrypted: false,
        })
        const sig = signatures?.[0]
        if (!sig) { toast.error('获取上传签名失败'); isRunning.value = false; return }

        const ossResult = await uploadToOSS(selectedFile.value, sig, () => {})
        const ossFileId = (ossResult?.fileId ?? ossResult?.id) as number | undefined
        if (!ossFileId) { toast.error('上传 OSS 失败'); isRunning.value = false; return }

        // 2. 调用 composable 消费 SSE 流
        const result = await versioning.uploadNewVersion(ossFileId, (p) => {
            if (p.status === 'done') setStep(p.step!, 'done')
            else if (p.status === 'error') setStep(p.step!, 'error', p.errorMessage)
            // 标记下一步为 running
            const currentIdx = steps.value.findIndex(s => s.key === p.step)
            if (p.status === 'done' && currentIdx >= 0 && currentIdx + 1 < steps.value.length) {
                steps.value[currentIdx + 1].status = 'running'
            }
        })

        if (result.success && result.newVersionId) {
            emit('completed', result.newVersionId, result.summary ?? '')
            emit('update:open', false)
            toast.success(`新版本已就绪 · ${result.summary ?? ''}`)
        } else {
            toast.error('上传失败，请重试')
        }
    } catch (err: any) {
        toast.error(err?.message ?? '上传失败')
    } finally {
        isRunning.value = false
    }
}
</script>

<template>
    <Dialog :open="open" @update:open="emit('update:open', $event)">
        <DialogContent class="sm:max-w-[560px]">
            <DialogHeader>
                <DialogTitle>上传新版本 — 客户回传的 docx</DialogTitle>
            </DialogHeader>

            <div v-if="!isRunning" class="rounded-md bg-primary/5 border border-primary/20 p-2.5 text-xs text-primary flex items-start gap-2 mb-3">
                <svg class="size-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                <span>上传后系统会自动备份你当前的编辑，防止工作内容丢失。</span>
            </div>

            <!-- 未开始：选文件 -->
            <div v-if="!isRunning">
                <div
                    v-if="!selectedFile"
                    class="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors"
                    :class="isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'"
                    @click="fileInputRef?.click()"
                    @dragover.prevent="isDragOver = true"
                    @dragleave.prevent="isDragOver = false"
                    @drop.prevent="handleDrop"
                >
                    <input ref="fileInputRef" type="file" accept=".docx" class="hidden" @change="handleFileSelect" />
                    <UploadIcon class="size-8 mx-auto mb-3 text-muted-foreground" />
                    <p class="text-sm font-medium">点击选择文件 或 拖拽到此处</p>
                    <p class="text-xs text-muted-foreground mt-1">仅支持 .docx 格式，≤ 20 MB</p>
                </div>
                <div v-else class="border rounded-lg p-3 flex items-center justify-between">
                    <span class="text-sm truncate">{{ selectedFile.name }}</span>
                    <Button variant="ghost" size="icon" class="size-7" @click="selectedFile = null"><X class="size-4" /></Button>
                </div>
            </div>

            <!-- 进行中：分步进度 -->
            <div v-else class="space-y-2 py-2">
                <div v-for="s in steps" :key="s.key" class="flex items-center gap-3 text-sm">
                    <div class="size-5 rounded-full flex items-center justify-center shrink-0"
                        :class="{
                            'border-2 border-muted-foreground/30': s.status === 'pending',
                            'bg-primary animate-pulse': s.status === 'running',
                            'bg-emerald-500': s.status === 'done',
                            'bg-rose-500': s.status === 'error',
                        }"
                    >
                        <Loader2 v-if="s.status === 'running'" class="size-3 text-white animate-spin" />
                        <Check v-else-if="s.status === 'done'" class="size-3 text-white" />
                        <X v-else-if="s.status === 'error'" class="size-3 text-white" />
                    </div>
                    <span :class="{
                        'text-muted-foreground': s.status === 'pending',
                        'text-foreground': s.status === 'running' || s.status === 'done',
                        'text-rose-600': s.status === 'error',
                    }">{{ s.label }}</span>
                    <span v-if="s.errorMessage" class="text-xs text-rose-600">{{ s.errorMessage }}</span>
                </div>
            </div>

            <DialogFooter v-if="!isRunning">
                <Button variant="outline" @click="emit('update:open', false)">取消</Button>
                <Button :disabled="!selectedFile" @click="startUpload">开始上传</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
```

- [ ] **Step 3: 组件测试**

```ts
// tests/app/components/assistant/contract/ContractUploadNewVersionDialog.test.ts
// 参照 Phase A NewReviewDialog 测试风格，mock uploadToOSS + useContractReviewVersion.uploadNewVersion
// 覆盖：未选文件时按钮 disabled / 选文件后可上传 / SSE 进度驱动 step 切换 / 错误态显示
```

- [ ] **Step 4: typecheck + 测试**

```bash
npx nuxi typecheck
npx vitest run tests/app/composables/useContractReviewVersion.test.ts tests/app/components/assistant/contract/
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(contract): 上传新版本前端 composable + Dialog (分步进度 + OSS 预签名)"
```

---

## Task 1.8: ContractReviewPanel 加"上传新版本"按钮

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`

- [ ] **Step 1: 加按钮 + Dialog 挂载**

在 Panel 顶部工具栏（"保存新版本"按钮旁边）加：

```vue
<Button
    size="sm"
    variant="outline"
    class="h-7 text-xs"
    :disabled="versioning.isReadOnly.value"
    @click="uploadVersionDialogOpen = true"
>
    <UploadIcon class="size-3 mr-1" />
    上传新版本
</Button>

<!-- Dialog 挂载 -->
<AssistantContractUploadNewVersionDialog
    v-if="review"
    v-model:open="uploadVersionDialogOpen"
    :review-id="review.id"
    @completed="handleUploadCompleted"
/>
```

script：

```ts
import { UploadIcon } from 'lucide-vue-next'

const uploadVersionDialogOpen = ref(false)

function handleUploadCompleted(newVersionId: number, summary: string) {
    // Dialog 自己已经 toast；刷新在 composable 里做了
    // 这里可以：展示本轮变化横幅（B3 实现）
}
```

- [ ] **Step 2: typecheck + 现有 Panel 测试回归**

```bash
npx nuxi typecheck
npx vitest run tests/app/components/assistant/contract/ContractReviewPanel.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(contract): ContractReviewPanel 集成上传新版本按钮 + Dialog"
```

---

# 子期 B2 · 批注识别 + 条款 diff + 锚点迁移（Day 2-3）

## Task 2.1: clauseDiff 纯函数 utils

**Files:**
- Create: `server/services/assistant/contract/utils/clauseDiff.ts`
- Create: `tests/server/assistant/contract/utils/clauseDiff.test.ts`

- [ ] **Step 1: 先写测试**

```ts
// tests/server/assistant/contract/utils/clauseDiff.test.ts
import { describe, it, expect } from 'vitest'
import { diffClauses } from '~/server/services/assistant/contract/utils/clauseDiff'

describe('clauseDiff', () => {
    it('完全相同 → 全部 kept', () => {
        const a = [{ index: 0, text: '第一条' }, { index: 1, text: '第二条' }]
        const b = [{ index: 0, text: '第一条' }, { index: 1, text: '第二条' }]
        const r = diffClauses(a, b)
        expect(r.kept).toHaveLength(2)
        expect(r.added).toHaveLength(0)
        expect(r.removed).toHaveLength(0)
        expect(r.modified).toHaveLength(0)
    })

    it('客户改了第一条 → modified', () => {
        const a = [{ index: 0, text: '违约金 20%' }, { index: 1, text: '交付时间' }]
        const b = [{ index: 0, text: '违约金 15%' }, { index: 1, text: '交付时间' }]
        const r = diffClauses(a, b)
        expect(r.modified).toHaveLength(1)
        expect(r.modified[0].oldClause.text).toBe('违约金 20%')
        expect(r.modified[0].newClause.text).toBe('违约金 15%')
        expect(r.kept).toHaveLength(1)
    })

    it('客户新增一条 → added', () => {
        const a = [{ index: 0, text: '第一条' }]
        const b = [{ index: 0, text: '第一条' }, { index: 1, text: '第二条' }]
        const r = diffClauses(a, b)
        expect(r.added).toHaveLength(1)
        expect(r.added[0].text).toBe('第二条')
    })

    it('客户删了一条 → removed', () => {
        const a = [{ index: 0, text: '第一条' }, { index: 1, text: '第二条' }]
        const b = [{ index: 0, text: '第一条' }]
        const r = diffClauses(a, b)
        expect(r.removed).toHaveLength(1)
        expect(r.removed[0].text).toBe('第二条')
    })

    it('客户只改了空格 → kept（相似度 > 0.95）', () => {
        const a = [{ index: 0, text: '违约金 20%\n\n' }]
        const b = [{ index: 0, text: '违约金 20%' }]
        const r = diffClauses(a, b)
        expect(r.kept).toHaveLength(1)
        expect(r.modified).toHaveLength(0)
    })

    it('oldClauses 为空 → 全部 added', () => {
        const a: any[] = []
        const b = [{ index: 0, text: '第一条' }, { index: 1, text: '第二条' }]
        const r = diffClauses(a, b)
        expect(r.added).toHaveLength(2)
    })
})
```

- [ ] **Step 2: 实现**

```ts
// server/services/assistant/contract/utils/clauseDiff.ts
import DiffMatchPatch from 'diff-match-patch'

export interface DiffClause {
    index: number
    text: string
}

export interface ClauseDiffResult {
    kept: DiffClause[]
    added: DiffClause[]
    removed: DiffClause[]
    modified: Array<{ oldClause: DiffClause; newClause: DiffClause }>
}

const dmp = new DiffMatchPatch()
const HIGH_SIMILARITY_THRESHOLD = 0.95   // ≥ 0.95 归为 kept（只改空白/标点）

/** 计算两段文本的归一化相似度 [0,1] */
function similarity(a: string, b: string): number {
    if (a === b) return 1
    if (!a || !b) return 0
    const diffs = dmp.diff_main(a, b)
    dmp.diff_cleanupSemantic(diffs)
    const distance = dmp.diff_levenshtein(diffs)
    const maxLen = Math.max(a.length, b.length)
    return 1 - distance / maxLen
}

/**
 * 条款 LCS 对齐 + 修改识别。
 *
 * 策略：
 * 1. 把条款 text 序列拼成一个大字符串（条款间用独特分隔符），用 diff_linesToChars 做 LCS
 * 2. 对齐出 kept / added / removed
 * 3. 候选 modified（同位置但文本不同）直接归入 modified；相似度 ≥ 0.95 归 kept
 *
 * Phase B 简化：不做"相似度 < 0.5 拆删+增"分支（spec §7.2）
 */
export function diffClauses(oldClauses: DiffClause[], newClauses: DiffClause[]): ClauseDiffResult {
    const result: ClauseDiffResult = { kept: [], added: [], removed: [], modified: [] }

    // 简化版：用内容相等做对齐的朴素算法（LCS 的等价效果）
    // 为了保持和 LCS 语义一致，这里用 diff-match-patch 的 diff_main 做行级对比
    const oldText = oldClauses.map(c => c.text).join('\n\x00\n')
    const newText = newClauses.map(c => c.text).join('\n\x00\n')
    const a = dmp.diff_linesToChars_(oldText, newText)
    const diffs = dmp.diff_main(a.chars1, a.chars2, false)
    dmp.diff_charsToLines_(diffs, a.lineArray)

    // 简化实现：逐段对齐（对于大多数合同场景，位置相似度高）
    // 若需要更健壮的 LCS，进一步处理 diffs 数组
    const oldUsed = new Set<number>()
    const newUsed = new Set<number>()

    // 第 1 步：精确匹配 (文本完全相同)
    oldClauses.forEach((oc, i) => {
        const j = newClauses.findIndex((nc, idx) => !newUsed.has(idx) && nc.text === oc.text)
        if (j >= 0) {
            result.kept.push(oc)
            oldUsed.add(i)
            newUsed.add(j)
        }
    })

    // 第 2 步：高相似度匹配（≥ 0.95 视为 kept）
    oldClauses.forEach((oc, i) => {
        if (oldUsed.has(i)) return
        for (let j = 0; j < newClauses.length; j++) {
            if (newUsed.has(j)) continue
            if (similarity(oc.text, newClauses[j].text) >= HIGH_SIMILARITY_THRESHOLD) {
                result.kept.push(oc)
                oldUsed.add(i)
                newUsed.add(j)
                break
            }
        }
    })

    // 第 3 步：同位置对齐（作为 modified 候选）
    oldClauses.forEach((oc, i) => {
        if (oldUsed.has(i)) return
        // 找 new 中"最接近"且未使用的条款
        let bestJ = -1
        let bestSim = -1
        for (let j = 0; j < newClauses.length; j++) {
            if (newUsed.has(j)) continue
            const sim = similarity(oc.text, newClauses[j].text)
            if (sim > bestSim) { bestSim = sim; bestJ = j }
        }
        if (bestJ >= 0) {
            result.modified.push({ oldClause: oc, newClause: newClauses[bestJ] })
            oldUsed.add(i)
            newUsed.add(bestJ)
        }
    })

    // 第 4 步：未匹配的归 removed / added
    oldClauses.forEach((oc, i) => { if (!oldUsed.has(i)) result.removed.push(oc) })
    newClauses.forEach((nc, j) => { if (!newUsed.has(j)) result.added.push(nc) })

    return result
}
```

- [ ] **Step 3: 测试通过**

```bash
npx vitest run tests/server/assistant/contract/utils/clauseDiff.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): clauseDiff LCS 算法 utils + 测试"
```

---

## Task 2.2: anchorMigrate 纯函数 utils

**Files:**
- Create: `server/services/assistant/contract/utils/anchorMigrate.ts`
- Create: `tests/server/assistant/contract/utils/anchorMigrate.test.ts`

- [ ] **Step 1: 先写测试**

```ts
describe('anchorMigrate', () => {
    it('新文本包含原锚点 → 精确匹配', () => {
        const r = migrateAnchor('违约金 20%', '根据本合同，违约金 20% 为上限')
        expect(r.matched).toBe(true)
        expect(r.newQuote).toBe('违约金 20%')
    })

    it('新文本小改动（数字） → 相似度 ≥ 0.6 仍命中', () => {
        const r = migrateAnchor('违约金 20%', '违约金 15%，合同金额的百分比')
        expect(r.matched).toBe(true)
    })

    it('新文本完全不同 → orphaned', () => {
        const r = migrateAnchor('违约金 20%', '合同签署地点位于北京')
        expect(r.matched).toBe(false)
    })

    it('空输入 → orphaned', () => {
        const r = migrateAnchor('', 'xxx')
        expect(r.matched).toBe(false)
    })
})
```

- [ ] **Step 2: 实现**

```ts
// server/services/assistant/contract/utils/anchorMigrate.ts
import DiffMatchPatch from 'diff-match-patch'

const dmp = new DiffMatchPatch()
const ANCHOR_SIMILARITY_THRESHOLD = 0.6   // Phase B 阈值（可调参）

export interface AnchorMigrateResult {
    matched: boolean
    newQuote?: string
    newCharStart?: number
    newCharEnd?: number
    similarity?: number
}

/**
 * 字符级 Levenshtein 滑动窗口匹配。
 *
 * Phase B 算法（只有字符级匹配，关键词兜底推迟 Phase C）：
 * - 滑动窗口在 newClauseText 上取与 anchorQuote 等长的子串
 * - 计算 Levenshtein 相似度，取最高的子串
 * - 若最高 ≥ 0.6 → 命中；否则 orphaned
 */
export function migrateAnchor(anchorQuote: string, newClauseText: string): AnchorMigrateResult {
    if (!anchorQuote || !newClauseText) return { matched: false }

    const qLen = anchorQuote.length
    if (newClauseText.length < qLen) {
        // 新文本比原锚点短；整段做一次相似度
        const diffs = dmp.diff_main(anchorQuote, newClauseText)
        const dist = dmp.diff_levenshtein(diffs)
        const sim = 1 - dist / Math.max(qLen, newClauseText.length)
        if (sim >= ANCHOR_SIMILARITY_THRESHOLD) {
            return { matched: true, newQuote: newClauseText, newCharStart: 0, newCharEnd: newClauseText.length, similarity: sim }
        }
        return { matched: false, similarity: sim }
    }

    // 滑动窗口
    let bestSim = 0
    let bestStart = -1
    const step = Math.max(1, Math.floor(qLen / 20))   // 步长 = qLen / 20 避免每字符都算（优化）
    for (let i = 0; i <= newClauseText.length - qLen; i += step) {
        const window = newClauseText.substring(i, i + qLen)
        const diffs = dmp.diff_main(anchorQuote, window)
        const dist = dmp.diff_levenshtein(diffs)
        const sim = 1 - dist / qLen
        if (sim > bestSim) {
            bestSim = sim
            bestStart = i
            if (sim === 1) break   // 精确匹配提前退出
        }
    }

    if (bestSim >= ANCHOR_SIMILARITY_THRESHOLD && bestStart >= 0) {
        // 以 bestStart 为中心再做一次精细扫描（step 1）提升精度
        const refineFrom = Math.max(0, bestStart - step)
        const refineTo = Math.min(newClauseText.length - qLen, bestStart + step)
        for (let i = refineFrom; i <= refineTo; i++) {
            const window = newClauseText.substring(i, i + qLen)
            const diffs = dmp.diff_main(anchorQuote, window)
            const dist = dmp.diff_levenshtein(diffs)
            const sim = 1 - dist / qLen
            if (sim > bestSim) { bestSim = sim; bestStart = i }
        }
        return {
            matched: true,
            newQuote: newClauseText.substring(bestStart, bestStart + qLen),
            newCharStart: bestStart,
            newCharEnd: bestStart + qLen,
            similarity: bestSim,
        }
    }

    return { matched: false, similarity: bestSim }
}
```

- [ ] **Step 3: 测试 + Commit**

```bash
npx vitest run tests/server/assistant/contract/utils/anchorMigrate.test.ts
git commit -m "feat(contract): anchorMigrate 字符级相似度匹配 utils + 测试"
```

---

## Task 2.3: wordCommentParser — 解析回传 docx 的 comments.xml

**Files:**
- Create: `server/services/assistant/contract/docx/wordCommentParser.ts`
- Create: `tests/server/assistant/contract/docx/wordCommentParser.test.ts`

- [ ] **Step 1: 实现解析器**

```ts
// server/services/assistant/contract/docx/wordCommentParser.ts
import JSZip from 'jszip'   // 复用现有依赖
import { parseWordCommentRef } from '../utils/wordCommentRef'

export interface RawWordComment {
    wordId: number          // docx 内的 w:id
    author: string          // w:author 原值（可能带 LS: 前缀）
    initials: string        // w:initials 原值（可能含 LEXSEEK-...）
    content: string
    parentWordId: number | null  // 答复批注的 w:parentId
    /** 解析出的系统 annotationId（initials 命中 LEXSEEK 格式时）*/
    systemAnnotationId: number | null
}

export async function parseCommentsXml(docxBuffer: Buffer): Promise<RawWordComment[]> {
    const zip = await JSZip.loadAsync(docxBuffer)
    const commentsFile = zip.file('word/comments.xml')
    if (!commentsFile) return []

    const xmlText = await commentsFile.async('text')

    // 用简单正则解析（不引新 XML 库；合同 comments 结构稳定）
    const comments: RawWordComment[] = []
    const commentRegex = /<w:comment\s+([^>]+)>([\s\S]*?)<\/w:comment>/g
    let match: RegExpExecArray | null
    while ((match = commentRegex.exec(xmlText)) !== null) {
        const attrs = match[1]
        const inner = match[2]

        const wordId = Number(attrs.match(/w:id="(\d+)"/)?.[1] ?? '-1')
        const author = decodeXml(attrs.match(/w:author="([^"]*)"/)?.[1] ?? '')
        const initials = decodeXml(attrs.match(/w:initials="([^"]*)"/)?.[1] ?? '')
        const parentIdStr = attrs.match(/w:parentId="(\d+)"/)?.[1]
        const parentWordId = parentIdStr ? Number(parentIdStr) : null

        const contentMatch = inner.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)
        const content = contentMatch
            ? contentMatch.map(m => decodeXml(m.replace(/<[^>]+>/g, ''))).join('')
            : ''

        const parsed = parseWordCommentRef(initials)
        comments.push({
            wordId,
            author,
            initials,
            content,
            parentWordId,
            systemAnnotationId: parsed?.annotationId ?? null,
        })
    }

    return comments
}

function decodeXml(s: string): string {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}
```

- [ ] **Step 2: 测试 + Commit**

```ts
// tests/server/assistant/contract/docx/wordCommentParser.test.ts
// 构造一个包含 2 条 AI 批注（initials 是 LEXSEEK-{id}-{rand}）+ 1 条客户新增（initials 空）+ 1 条客户回复（parentId=0）的 docx fixture
// 或用已有 fixture + 手工注入 comments.xml
// 断言 parseCommentsXml 返回数组正确识别 systemAnnotationId / parentWordId
```

```bash
npx vitest run tests/server/assistant/contract/docx/wordCommentParser.test.ts
git commit -m "feat(contract): wordCommentParser 解析 comments.xml"
```

---

## Task 2.4: uploadClientVersion service 填充 diff/annotation 处理

**Files:**
- Modify: `server/services/assistant/contract/uploadClientVersion.service.ts`
- Modify: 相关测试

- [ ] **Step 1: Step 2 解析补充 comments**

把 `newRawComments = []` 占位改为：

```ts
// Step 2 里追加
const fileBuffer = await downloadOssFileAsBuffer(ossFileId)  // 调用现有 OSS 下载 helper
newRawComments = await parseCommentsXml(fileBuffer)
```

- [ ] **Step 2: Step 3 填充 diff 逻辑**

```ts
// 替换"占位：B1 阶段假装没有差异"的 Step 3 块
try {
    // 读 oldClauses（当前版本 + Phase A 存量补算）
    let oldClauses = []
    if (review.currentVersionId) {
        const prev = await prisma.contractReviewVersions.findUnique({
            where: { id: review.currentVersionId },
            select: { snapshotData: true, docxText: true /* 若有 */ }
        })
        const prevSnap = prev?.snapshotData as any
        oldClauses = prevSnap?.clauses ?? []

        // Phase A 存量补算：clauses 为空但 docxText 有 → 调 segmentClauses 补
        if (oldClauses.length === 0 && prevSnap?.docxText) {
            const segs = await segmentClauses(prevSnap.docxText, { maxLength: 2000 })
            oldClauses = segs.map((s, i) => ({
                index: i, text: s.text, offsetStart: s.offsetStart ?? 0, offsetEnd: s.offsetEnd ?? 0,
            }))
        }
    }

    // 条款 diff
    const clauseDiffResult = diffClauses(oldClauses, newClauses)

    // 批注识别
    const dbAnnotations = await prisma.contractAnnotations.findMany({
        where: { reviewId: review.id, deletedAt: null },
    })
    const annotationDiff = matchComments(dbAnnotations, newRawComments)
    // annotationDiff = { kept: [], removed: [], newByClient: [] }

    const externalChangeCount = annotationDiff.newByClient.length +
        annotationDiff.removed.length +
        newRawComments.filter(c => c.systemAnnotationId !== null).filter(c =>
            dbAnnotations.some(a => a.id === c.systemAnnotationId)
        ).length  // replies count 简化
    const clauseModifiedCount = clauseDiffResult.modified.length

    yield { type: 'progress', data: { step: 'diff', status: 'done', externalChangeCount, clauseModifiedCount } }

    // 挂成 state 供 Step 5 / 6 用
    diffState = { clauseDiffResult, annotationDiff }
} catch (e: any) {
    yield { type: 'error', data: { step: 'diff', code: 'DIFF_FAILED', message: e?.message ?? 'diff 失败' } }
    return
}
```

- [ ] **Step 3: 实现 matchComments**

```ts
function matchComments(dbAnnotations: any[], rawComments: RawWordComment[]) {
    const kept: { dbAnnotation: any }[] = []
    const removed: { dbAnnotation: any }[] = []
    const newByClient: { rawComment: RawWordComment; parentAnnotationId: number | null }[] = []

    const dbById = new Map<number, any>()
    dbAnnotations.forEach(a => dbById.set(a.id, a))
    const matchedDbIds = new Set<number>()

    for (const rc of rawComments) {
        if (rc.systemAnnotationId !== null && dbById.has(rc.systemAnnotationId)) {
            kept.push({ dbAnnotation: dbById.get(rc.systemAnnotationId) })
            matchedDbIds.add(rc.systemAnnotationId)
        } else {
            // 新增：若有 parentWordId，查父 raw comment 是否命中系统 annotation
            let parentAnnotationId: number | null = null
            if (rc.parentWordId !== null) {
                const parentRaw = rawComments.find(r => r.wordId === rc.parentWordId)
                if (parentRaw?.systemAnnotationId && dbById.has(parentRaw.systemAnnotationId)) {
                    parentAnnotationId = parentRaw.systemAnnotationId
                }
            }
            newByClient.push({ rawComment: rc, parentAnnotationId })
        }
    }

    // removed = DB 有但 raw 里没命中的
    for (const a of dbAnnotations) {
        if (!matchedDbIds.has(a.id)) removed.push({ dbAnnotation: a })
    }

    return { kept, removed, newByClient }
}
```

- [ ] **Step 4: Step 5 锚点迁移（B2 填充）+ Step 6 写入工作区**

```ts
// Step 5/6 合并：把 diffState 应用到 DB
try {
    await prisma.$transaction(async (tx) => {
        // 1. 客户已删除的 DB annotation 标记
        for (const { dbAnnotation } of diffState.annotationDiff.removed) {
            await tx.contractAnnotations.update({
                where: { id: dbAnnotation.id },
                data: { removedByClient: true, suppressInExport: true },
            })
        }

        // 2. 客户新增独立批注 → 升格为 ContractRisk(source=external_new)
        for (const { rawComment, parentAnnotationId } of diffState.annotationDiff.newByClient) {
            if (parentAnnotationId !== null) {
                // 作为回复挂到父 annotation 的同一 risk 下
                const parent = await tx.contractAnnotations.findUnique({ where: { id: parentAnnotationId } })
                if (!parent) continue
                await tx.contractAnnotations.create({
                    data: {
                        reviewId: review.id,
                        riskId: parent.riskId,
                        parentAnnotationId,
                        authorType: 'external',
                        authorName: rawComment.author.replace(/^LS:/, '') || '客户',
                        content: rawComment.content,
                    },
                })
            } else {
                // 独立批注 → 新建 risk
                const newRisk = await tx.contractRisks.create({
                    data: {
                        reviewId: review.id,
                        source: 'external_new',
                        category: '客户新增',
                        level: 'medium',
                        stance: 'balanced',
                        problem: rawComment.content.substring(0, 100),
                        anchorQuote: rawComment.content.substring(0, 80),  // 简化：用批注内容头做锚点
                        anchorParagraphIndex: 0,  // Phase B 简化：统一定位到条款 0；精确锚点定位（解析 commentRangeStart/End 在 document.xml 位置）放 Phase C
                    },
                })
                await tx.contractAnnotations.create({
                    data: {
                        reviewId: review.id,
                        riskId: newRisk.id,
                        authorType: 'external',
                        authorName: rawComment.author.replace(/^LS:/, '') || '客户',
                        content: rawComment.content,
                    },
                })
            }
        }

        // 3. 锚点迁移（改动条款上挂的 risks）
        for (const { oldClause, newClause } of diffState.clauseDiffResult.modified) {
            const risksOnOldClause = await tx.contractRisks.findMany({
                where: { reviewId: review.id, anchorParagraphIndex: oldClause.index, orphaned: false },
            })
            for (const risk of risksOnOldClause) {
                const migrated = migrateAnchor(risk.anchorQuote, newClause.text)
                if (migrated.matched) {
                    await tx.contractRisks.update({
                        where: { id: risk.id },
                        data: {
                            anchorQuote: migrated.newQuote ?? risk.anchorQuote,
                            anchorParagraphIndex: newClause.index,
                            anchorCharStart: migrated.newCharStart ?? null,
                            anchorCharEnd: migrated.newCharEnd ?? null,
                            originalAnchorQuote: risk.originalAnchorQuote ?? risk.anchorQuote,
                        },
                    })
                } else {
                    await tx.contractRisks.update({
                        where: { id: risk.id },
                        data: {
                            orphaned: true,
                            originalAnchorQuote: risk.originalAnchorQuote ?? risk.anchorQuote,
                        },
                    })
                }
            }
        }
    })
} catch (e: any) {
    yield { type: 'error', data: { step: 'merge', code: 'MERGE_FAILED', message: e?.message ?? '合并失败' } }
    return
}
```

- [ ] **Step 5: 扩展 summary 统计**

把"summary = '新版本已就绪'" 替换为：

```ts
const parts: string[] = []
if (diffState.externalChangeCount > 0) parts.push(`${diffState.externalChangeCount} 处外部变更`)
if (diffState.clauseModifiedCount > 0) parts.push(`${diffState.clauseModifiedCount} 条正文修改`)
// B3 之后还会加 AI 重审计数
const summary = parts.length > 0 ? parts.join(' · ') : '无变更'
```

- [ ] **Step 6: 扩展测试覆盖**

- 客户删 AI 批注 → DB annotation.removedByClient=true
- 客户新增独立批注 → DB 产生 source=external_new risk
- 客户回复 AI 批注 → child annotation 入库，parentAnnotationId 指向正确
- 条款 modified → 锚点迁移到新条款（精确匹配场景）
- 条款完全重写 → risks 标 orphaned

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(contract): uploadClientVersion B2 填充（diff + 批注识别 + 锚点迁移）"
```

---

## Task 2.5: RiskListPanel 新增 3 个分组 UI

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Create: `app/components/assistant/contract/ContractRiskMigrationTooltip.vue`

- [ ] **Step 1: 风险分类 computed**

在 RiskListPanel script 里追加：

```ts
/** 外部新增风险（source=external_new）*/
const externalNewRisks = computed(() =>
    unarchivedRisks.value.filter(r => (r as any).source === 'external_new')
)

/** 客户已移除批注对应的风险（通过 annotation.removedByClient=true 反查）*/
const clientRemovedAnnotations = computed(() =>
    (props.annotations ?? []).filter(a => a.removedByClient)
)

/** 孤立批注 risks（orphaned=true）*/
const orphanedRisks = computed(() =>
    props.risks.filter(r => (r as any).orphaned === true)
)

/** 主清单 risks（排除 external_new / orphaned）*/
const mainRisks = computed(() =>
    unarchivedRisks.value.filter(r =>
        (r as any).source !== 'external_new' && !(r as any).orphaned
    )
)
```

- [ ] **Step 2: 模板加 3 个分组**

```vue
<!-- 外部新增分组（顶置）-->
<div v-if="externalNewRisks.length > 0" class="rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 mb-3">
    <div class="px-3 py-1.5 border-b border-amber-200 dark:border-amber-900/40 flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
        <PlusIcon class="size-3.5" />
        外部新增（{{ externalNewRisks.length }}）
    </div>
    <div class="p-2 space-y-1.5">
        <div v-for="r in externalNewRisks" :key="r.id" class="rounded-md border border-l-4 border-l-amber-500 bg-card p-2 text-xs cursor-pointer"
             @click="emit('focusRisk', r.id)">
            <div class="flex items-center justify-between">
                <span class="font-semibold">{{ r.category }}</span>
                <span class="chip-ext px-1 py-0 rounded text-[10px]">{{ annotationsForRisk(r.id)[0]?.authorName ?? '客户' }}</span>
            </div>
            <div class="text-muted-foreground line-clamp-2">{{ r.problem }}</div>
        </div>
    </div>
</div>

<!-- 主清单 risks（替换原 filteredSorted 渲染）-->
<!-- ...现有 Card v-for 改用 mainRisks... -->

<!-- 孤立批注区（主清单下方）-->
<div v-if="orphanedRisks.length > 0" class="mt-3 rounded-lg border border-dashed bg-amber-50/30 dark:bg-amber-950/10 p-2">
    <div class="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300 text-xs mb-1.5">
        <InfoIcon class="size-3" />
        原文已修改 · 无法定位（{{ orphanedRisks.length }}）
    </div>
    <div class="space-y-1.5">
        <div v-for="r in orphanedRisks" :key="r.id" class="rounded-md border bg-card p-2 text-xs">
            <div class="font-semibold">{{ r.category }}</div>
            <div class="text-muted-foreground line-clamp-2">{{ r.problem }}</div>
            <div v-if="(r as any).originalAnchorQuote" class="mt-1 italic text-[11px] text-muted-foreground">
                原文："{{ (r as any).originalAnchorQuote }}"
            </div>
        </div>
    </div>
</div>

<!-- 客户已移除分组（最底部折叠）-->
<div v-if="clientRemovedAnnotations.length > 0" class="mt-3 rounded-lg border">
    <button
        type="button"
        class="w-full px-3 py-2 text-xs flex items-center justify-between hover:bg-muted/60 transition-colors"
        @click="showRemovedByClient = !showRemovedByClient"
    >
        <span class="font-medium text-muted-foreground">客户已移除（{{ clientRemovedAnnotations.length }}）</span>
        <ChevronDownIcon class="size-3 transition-transform" :class="{ 'rotate-180': showRemovedByClient }" />
    </button>
    <div v-if="showRemovedByClient" class="p-2 space-y-1.5 border-t">
        <!-- 每条展开时显示完整对话链（Phase B 铁律承诺）-->
        <div v-for="a in clientRemovedAnnotations" :key="a.id" class="rounded-md border bg-muted/30 p-2 text-xs">
            <div class="flex items-center justify-between mb-1">
                <span class="chip-ai px-1 py-0 rounded text-[10px]">{{ a.authorName }}</span>
                <Button size="sm" variant="outline" class="h-6 text-[10px]" @click="confirmRestorePush(a)">
                    恢复推送
                </Button>
            </div>
            <div class="text-slate-700 dark:text-slate-300">{{ a.content }}</div>
        </div>
    </div>
</div>
```

- [ ] **Step 3: "恢复推送"确认 Dialog**

用项目 `useAlertDialogStore`：

```ts
async function confirmRestorePush(annotation: ContractAnnotationEntity) {
    const alertDialogStore = useAlertDialogStore()
    alertDialogStore.showErrorDialog({
        title: '确认恢复推送？',
        message: `该批注已被客户在历史版本里明确删除。再次推送到下次导出的 Word 文件中，可能引起客户反感。确认继续吗？`,
        confirmText: '确认恢复',
        cancelText: '取消',
        onConfirm: async () => {
            await useApiFetch(
                `/api/v1/assistant/contract/reviews/annotations/${annotation.id}/restore-push`,
                { method: 'POST' },
            )
            toast.success('已恢复推送')
            // 父组件会刷新
            emit('restoreAnnotationPushed', annotation.id)
        },
    })
}
```

- [ ] **Step 4: 补后端 restore-push 端点**

```ts
// server/api/v1/assistant/contract/reviews/annotations/[annotationId]/restore-push.post.ts
import { loadOwnedReviewByAnnotationId } from '~~/server/services/assistant/contract/reviewGuard'

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByAnnotationId(event, { actionLabel: '恢复推送批注' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const annotationId = Number(getRouterParam(event, 'annotationId'))
    await prisma.contractAnnotations.update({
        where: { id: annotationId },
        data: { suppressInExport: false },   // removedByClient 保留作为历史信号
    })
    return resSuccess(event, '已恢复推送', { annotationId })
})
```

注意：**路径 `reviews/annotations/[annotationId]/restore-push.post.ts`** — annotationId 在 annotations 之后，restore-push 是动作后缀。由 api.md 规则"动态参数在文件末尾"实际允许"参数末尾 + 动作文件名"两种模式，这里用第二种（符合现有 `reviews/[id]/rebuild-docx.post.ts` 模式，但这里 [annotationId] 嵌在中间不合规）。**改为**：

`reviews/annotations-restore-push/[annotationId].post.ts` — annotationId 在末尾

- [ ] **Step 5: 测试 + Commit**

```bash
npx nuxi typecheck
npx vitest run tests/app/components/assistant/contract/RiskListPanel.test.ts
git commit -m "feat(contract): RiskListPanel 三分组 UI（外部新增/客户已移除/孤立批注）+ 恢复推送端点"
```

---

# 子期 B3 · AI 增量审查 + 全局复核 + 联调（Day 4-5）

## Task 3.1: seedData.sql 新增全局复核 node + prompt

**Files:**
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: 参考现有 contract review node 模式追加**

```sql
-- ====== Phase B: 合同审查全局复核节点 ======
INSERT INTO "public"."nodes" (id, name, ...) VALUES
  (<新 id>, 'contractReviewGlobalReview', ...)
ON CONFLICT (name) DO NOTHING;

INSERT INTO "public"."prompts" (id, node_id, ...) VALUES
  (<新 id>, <上面的 node id>, '你是合同审查专家。

  原合同摘要：{{overview.summary}}
  改动条款列表：{{modifiedClauses}}
  已有未处置风险摘要：{{existingRisks}}

  请判断：本轮改动是否引入新的条款平衡性问题或连锁风险？
  - 若有，输出 JSON：{"category":"...","level":"high|medium|low","problem":"...","analysis":"...","suggestion":"..."}
  - 若无，输出：{"noIssue":true}')
ON CONFLICT (node_id) DO NOTHING;
```

(具体字段按现有 contract review node 18/19/20 的模式填)

- [ ] **Step 2: 本地 seed + 测试库 deploy**

```bash
bun run prisma:seed   # 或项目的 seed 命令
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(contract): seed 新增 contractReviewGlobalReview node + prompt"
```

---

## Task 3.2: uploadClientVersion.service Step 4 AI 填充

**Files:**
- Modify: `server/services/assistant/contract/uploadClientVersion.service.ts`

- [ ] **Step 1: 替换 Step 4 占位**

```ts
// ============ Step 4: AI 增量审查 + 全局复核 ============
try {
    const modifiedClauses = diffState.clauseDiffResult.modified
    const aiNewRisks: any[] = []

    // 4.1 增量审查每条 modified clause
    for (let i = 0; i < modifiedClauses.length; i++) {
        const { newClause } = modifiedClauses[i]
        yield { type: 'progress', data: { step: 'ai', status: 'progress', current: i + 1, total: modifiedClauses.length } }

        // 已处置风险保护：查该条款上已有的 archivedStatus != null 的 risks，记 id，审查输出时不重复
        const existingArchived = await prisma.contractRisks.findMany({
            where: {
                reviewId: review.id,
                anchorParagraphIndex: newClause.index,
                archivedStatus: { not: null },
            },
            select: { id: true, category: true },
        })

        try {
            const analyzed = await analyzeSingleClause({
                clause: { index: newClause.index, number: String(newClause.index + 1), text: newClause.text },
                stance: review.stance,
                partyA: review.partyA,
                partyB: review.partyB,
                contractType: review.contractType,
                playbookSnapshot: review.playbookSnapshot as any,
            })
            // analyzed 返回新识别的风险数组
            for (const risk of (analyzed.risks ?? [])) {
                // 不覆盖已处置风险（纯新增）
                aiNewRisks.push({
                    reviewId: review.id,
                    source: 'ai',
                    ...risk,
                    anchorParagraphIndex: newClause.index,
                })
            }
        } catch (e) {
            logger.error('analyzeSingleClause 失败', { clauseIndex: newClause.index, error: e })
            // 单条失败不阻塞，继续下一条
        }
    }

    // 4.2 批量写入 AI 新风险
    if (aiNewRisks.length > 0) {
        await prisma.contractRisks.createMany({ data: aiNewRisks })
    }

    // 4.3 全局复核
    let globalReviewRiskCount = 0
    if (modifiedClauses.length > 0) {
        try {
            const globalModel = createChatModel(getValidNodeConfig('contractReviewGlobalReview'))
            const globalPrompt = await loadPromptFromDb('contractReviewGlobalReview')  // 复用现有 prompt 读取 helper
            const existingRisks = await prisma.contractRisks.findMany({
                where: { reviewId: review.id, archivedStatus: null },
                select: { category: true, level: true },
                take: 20,
            })
            const input = globalPrompt
                .replace('{{overview.summary}}', (review.summary as any)?.summary ?? '')
                .replace('{{modifiedClauses}}', JSON.stringify(modifiedClauses.map(m => ({ index: m.newClause.index, oldText: m.oldClause.text, newText: m.newClause.text }))))
                .replace('{{existingRisks}}', JSON.stringify(existingRisks))

            const resp = await globalModel.invoke(input)
            const text = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content)
            const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}')

            if (!parsed.noIssue && parsed.category) {
                await prisma.contractRisks.create({
                    data: {
                        reviewId: review.id,
                        source: 'global_review',
                        category: parsed.category,
                        level: parsed.level ?? 'medium',
                        stance: 'balanced',
                        problem: parsed.problem ?? '',
                        analysis: parsed.analysis ?? null,
                        suggestion: parsed.suggestion ?? null,
                        anchorQuote: '（本轮复核）',
                        anchorParagraphIndex: 0,
                    },
                })
                globalReviewRiskCount = 1
            }
        } catch (e) {
            logger.error('全局复核失败', { error: e })
            // 不阻塞
        }
    }

    diffState.aiRiskCount = aiNewRisks.length
    diffState.globalReviewRiskCount = globalReviewRiskCount
    yield { type: 'progress', data: { step: 'ai', status: 'done' } }
} catch (e: any) {
    yield { type: 'error', data: { step: 'ai', code: 'AI_FAILED', message: e?.message ?? 'AI 审查失败' } }
    // AI 失败不 return —— 继续走 merge（律师能看到非 AI 部分的变更）
}
```

- [ ] **Step 2: 扩展 summary**

```ts
if (diffState.aiRiskCount > 0) parts.push('AI 已重审')
if (diffState.globalReviewRiskCount > 0) parts.push('全局复核新增 1 条')
```

- [ ] **Step 3: 测试覆盖**

- modified clauses 非空 → analyzeSingleClause 被调用 total 次
- 已处置风险保护：即便 AI 输出同 category 风险，旧风险的 archivedStatus 不变
- 全局复核：noIssue=true → 不写 global_review；有输出 → 写 1 条
- AI 失败 → 不阻塞 merge

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): uploadClientVersion B3 填充（AI 增量审查 + 全局复核）"
```

---

## Task 3.3: RiskListPanel 新徽章 + 本轮变化横幅

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`

- [ ] **Step 1: 风险卡片加徽章**

在 RiskListPanel 的 risk 卡片头部加：

```vue
<!-- risk 徽章区 -->
<div class="flex items-center gap-1">
    <!-- AI 已重审（source=ai 且 createdAt > 上次 client_return 版本时间）-->
    <span v-if="isRecentlyReviewed(r)" class="text-[10px] bg-primary/10 text-primary px-1 py-0.5 rounded">AI 已重审</span>
    <!-- 风险等级 -->
    <span class="..." >{{ RISK_LEVEL_LABEL[r.level] }}</span>
</div>
```

`isRecentlyReviewed` 计算：比较 risk.createdAt 和上次非 auto_backup 版本的 createdAt。

- [ ] **Step 2: Panel 加本轮变化横幅**

在 ContractReviewPanel 结果屏顶部（只读横幅之下）加：

```vue
<div
    v-if="banner.visible"
    class="flex items-center gap-2 px-4 py-2 border-b bg-primary/5 text-primary text-sm shrink-0"
>
    <InfoIcon class="size-4 shrink-0" />
    <span class="font-medium">v{{ banner.versionNumber }} 客户回传 · {{ banner.summary }}</span>
    <button class="ml-auto text-xs" @click="dismissBanner"><X class="size-4" /></button>
</div>
```

script:

```ts
const banner = computed(() => {
    const current = versioning.versions.value.find(v => v.id === versioning.workspace.value.currentVersionId)
    if (!current || current.systemLabel !== 'client_return') return { visible: false }
    const storageKey = `lexseek:contractReview:bannerDismissed:${current.id}`
    if (localStorage.getItem(storageKey) === '1') return { visible: false }
    // summary 从 uploadNewVersion 结果存 local state 或从 version 元信息读
    return { visible: true, versionNumber: current.versionNumber, summary: banner本地State.summary, versionId: current.id }
})

function dismissBanner() {
    const vid = banner.value.versionId
    if (vid) localStorage.setItem(`lexseek:contractReview:bannerDismissed:${vid}`, '1')
    // 触发 banner 重算（可以用 ref 触发）
}
```

- [ ] **Step 3: uploadNewVersion 完成时记 summary 到本地 state**

`ContractReviewPanel.handleUploadCompleted(newVersionId, summary)` 里把 summary 存到一个本地 ref 或 store，横幅计算时取。

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(contract): AI 重审徽章 + 本轮变化横幅"
```

---

## Task 3.4: 端到端手测清单 + 总测试跑

**Files:**（无文件修改，验证步骤）

- [ ] **Step 1: 典型场景手测**

在本地开发环境 `bun dev`，按以下 10 条验证：

1. 律师首次上传合同 → AI 审完 → v1 initial_upload 产生 → Word 下载里每条批注 `w:author` 带 `LS:` 前缀、`w:initials` 是 LEXSEEK-...
2. 律师加几条批注 + 改风险处置 → 点"上传新版本"选**完全相同的 docx**（客户没改）→ 分步进度 UI 5 步走完 → 横幅显示"无变更" / 时间线新增 client_return 节点 + 可能的 auto_backup 节点
3. 把客户视角的 docx 打开，手动改一处数字（如违约金 20% → 15%），回传 → 上传 → diff 步骤识别 1 条 modified → AI 重审该条款 → 风险卡片带 "AI 已重审" 徽章
4. 客户新加一条独立批注（"管辖法院改深圳"）→ 上传 → "外部新增（1）" 分组顶置显示
5. 客户删除一条 AI 批注 → 上传 → "客户已移除（1）" 折叠分组出现，展开看到该批注 + 恢复推送按钮
6. 点恢复推送 → 弹确认 dialog → 确认 → 下次导出 docx 该批注又被写入
7. 客户重写某条款到完全不同 → 上传 → 孤立批注区显示原锚点的风险 + 原文 tooltip
8. 上传一份完全不相干的 docx → 孤立批注数 ≈ 历史风险数
9. 切到历史 client_return 版本 → 只读态正常；切回工作区横幅持久化（点关闭不再弹）
10. 工作区无编辑 + 上传相同 docx → 跳过 auto_backup，只产 client_return

- [ ] **Step 2: 回归测试总跑**

```bash
npx nuxi typecheck
npx vitest run tests/server/assistant/contract/
npx vitest run tests/app/composables/useContractReviewVersion*
npx vitest run tests/app/components/assistant/contract/
```

期望合同相关测试 > 95% 通过；任何新失败必须定位并修复。

- [ ] **Step 3: 迁移状态 sanity**

```bash
bun run prisma:migrate status
```

应显示 "Database schema is up to date"（无 drift 或 pending migration）。

- [ ] **Step 4: Final Commit**

```bash
git commit -m "chore(contract): Phase B 端到端联调与总测试跑" --allow-empty
```

（如无代码改动可空 commit 作为里程碑）

---

## Phase B Done Definition

- [ ] Phase B 所有 24 个 Task 完成
- [ ] `npx nuxi typecheck` 0 错误
- [ ] 合同相关测试 > 95% 通过
- [ ] `prisma:migrate status` 无 drift
- [ ] 手测清单 10 条全部通过
- [ ] seedData.sql contractReviewGlobalReview node 已加
- [ ] M5 导出切换到 injectAnnotations（Word 批注带 LS: 前缀）
- [ ] Phase A 存量合同第一次 Phase B 上传的 clauses 补算正确

完成后进入 Phase C（独立 Plan）：对比抽屉 / 锚点关键词兜底 / 客户改 AI 批注文本识别 / 语义去重。

---

## 风险点与回滚

- **Phase A 存量合同补算失败**：若 segmentClauses 对某些历史 docxText 解析报错，单条 review 上传失败但不影响其他 review
- **AI 重审全部失败**：logger 里有 ai_failed 日志，律师看到非 AI 部分的变更，AI 部分空缺；可手动重跑（Phase C 加重试按钮）
- **commentInjector 新入口 Bug 导致 M5 导出坏**：保留旧 `injectComments` 入口，紧急回退通过环境变量或单行开关切换回旧入口
- **DB 迁移在生产出问题**：Phase B 只加字段 + 索引，不删列不改类型，回滚只需 `ALTER TABLE DROP COLUMN`（或 Prisma 反向迁移）
