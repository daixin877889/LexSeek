# 合同审查 PR6 · Track Changes 修订模式导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为合同审查导出新增 OOXML Track Changes（修订模式）能力，下载按钮支持「批注 / 修订 / 两者并存」三选一切换；后端新增 `redlineInjector` 在原 docx 写 `<w:ins>` / `<w:del>` 标签，`commentInjector` 改造接受 `idStart` 与 `redlineInjector` 共享同一份 OOXML w:id 池避免冲突让 Word 报「文件已损坏」。

**Architecture:** 复用 PR3 已落地的 quote 字符级锚点（`problematic_quote` / `quote_char_start` / `quote_char_end`，offset 相对 `clauseText`）→ 在 OOXML AST 里定位段落与 run（`redlineLocate.ts`）→ 拆 run 时 deep-clone `<w:rPr>` 副本保留字体/字号/颜色 → wrap 进 `<w:del>` 紧邻插 `<w:ins>` 写 `suggestedClauseText`（`redlineInjector.ts`）→ 由 `rebuildDocxService` 按 `mode` 协调三模式产物；`xmlAst.findMaxSharedId` 扫描 OOXML 共享 ID 池底数让两个 injector 顺序分配 w:id；前端把 `RiskListPanel` 单按钮改成 DropdownMenu + RadioGroup，模式偏好持久化到 `localStorage:contract-review-export-mode`。

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / Prisma / shadcn-vue / fast-xml-parser / JSZip / Vitest + happy-dom + @vue/test-utils。复用 `xmlAst` AST helper / `zipRewriter` jszip 封装 / `prisma/seeds/contract-samples/labor.docx` 测试 fixture。

**Spec:** `docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md`（PR6 范围 = §8 + §11.6 + §12 风险点）

**前置（已落地）：**
- `ContractRiskEntity` 含 `problematicQuote / quoteCharStart / quoteCharEnd / quoteMatchSource / clauseText / clauseParagraphIndex / clauseCharStart / clauseCharEnd`（`shared/types/contract.ts:485-525`）
- `commentInjector.injectAnnotations` API（`server/agents/contract/docx/commentInjector.ts:328`）
- `xmlAst` helper：`parseOoxml / stringifyOoxml / walk / findFirst / findAll / getAttr / setAttr / makeElement / makeLeaf / makeText / textOf / paragraphText / hasRunChild / escapeXml`（`server/agents/contract/docx/xmlAst.ts`）
- `zipRewriter`：`loadDocxZip / readTextFromZip / writeTextToZip / zipToBuffer`（`server/agents/contract/docx/zipRewriter.ts`）
- AI 批注 `content` 字段实际只存 `risk.problem` 一行（见 `uploadClientVersion.service.ts:589`），不含 `suggestedClauseText`——spec §8.3.6「both 模式 comment 文本去掉 suggestedClauseText 段」**已天然达成**，PR6 不必额外剥

**工期：** 3.5 天 × 18 个 Task

---

## 文件结构

### 新增（5）
- `server/agents/contract/docx/redlineLocate.ts` — 纯函数：在 OOXML AST 段落数组里定位 quote 字符段对应的「段落区间 + 起止 run + run 内偏移」
- `server/agents/contract/docx/redlineInjector.ts` — 主入口：跨 run 拆分 + 装配 `<w:del>` / `<w:ins>` + 段落删除标记同步 + ID 协调
- `tests/server/assistant/contract/docx/redlineLocate.test.ts`
- `tests/server/assistant/contract/docx/redlineInjector.test.ts`
- `tests/server/assistant/contract/contractReviewRebuild.mode.test.ts`

### 修改（13）
- `shared/types/contract.ts` — 新增 `ContractExportMode` 类型 + 默认值常量 + 标签映射
- `server/agents/contract/docx/xmlAst.ts` — 新增 `findMaxSharedId` + `ID_BEARING_TAGS` + 抽出 `collectNonEmptyParagraphs` 共享函数
- `server/agents/contract/docx/commentInjector.ts` — `injectAnnotations` 入参加 `opts: { idStart? }`、返回值加 `nextIdAfter`；`collectNonEmptyParagraphs` 改 import
- `server/agents/contract/docx/index.ts` — 导出 `injectRedlineMarks` / `RedlineRisk` / `InjectRedlineResult` / `findMaxSharedId`
- `server/agents/contract/riskSchema.builder.ts` — `suggestedClauseText` refine reject `\n`
- `server/agents/contract/contractReviewRebuild.service.ts` — 接受 `opts.mode`，三模式协调
- `server/agents/contract/contractReviewVersion.service.ts` — `downloadContractReviewVersionService` 接受 `opts.mode` 同样三模式协调
- `server/api/v1/assistant/contract/reviews/download/[id].get.ts` — query 加 `mode`
- `server/api/v1/assistant/contract/reviews/versions/download/[versionId].get.ts` — query 加 `mode`
- `app/composables/useContractReviewExport.ts` — `onDownload(mode)` 接受 mode 参数 + URL 透传
- `app/components/assistant/contract/RiskListPanel.vue` — 单按钮 → DropdownMenu + RadioGroup + emit `download(mode)`
- `app/components/assistant/contract/ContractReviewPanel.vue` — `handleDownload(mode)` 透传到 `onDownload`、历史版本 download 同步加 `mode` query
- `docs/tech-docs/backend/contract.md` — 新增「6. 导出模式（批注 / 修订 / 双模式）」章节

### 测试扩展（5）
- `tests/server/assistant/contract/docx/xmlAst.test.ts`
- `tests/server/assistant/contract/docx/commentInjector.annotations.test.ts`
- `tests/server/assistant/contract/riskSchema.test.ts`
- `tests/server/assistant/contract/download.api.test.ts`
- `tests/app/components/assistant/contract/RiskListPanel.test.ts`

---

## Task 1：新增 ContractExportMode 类型

**Files:**
- Modify: `shared/types/contract.ts`（追加到文件末尾）
- Test: 不需要单测（纯类型 + 字面量常量）；类型一致性靠 `bun run typecheck` 校验

- [ ] **Step 1：追加常量与类型到 `shared/types/contract.ts` 末尾**

```typescript
// ===== PR6: 导出模式 =====

/** 合同审查 docx 导出模式 */
export const CONTRACT_EXPORT_MODES = ['comment', 'redline', 'both'] as const
export type ContractExportMode = typeof CONTRACT_EXPORT_MODES[number]

/** 默认模式：保持现状向后兼容（未传 mode 时走批注） */
export const DEFAULT_CONTRACT_EXPORT_MODE: ContractExportMode = 'comment'

export const CONTRACT_EXPORT_MODE_LABEL: Record<ContractExportMode, string> = {
    comment: '批注模式',
    redline: '修订模式（Track Changes）',
    both: '两者并存',
}
```

- [ ] **Step 2：跑类型检查**

Run: `bun run typecheck`
Expected: PASS（无类型错误；新增的类型未被使用是允许的）

- [ ] **Step 3：commit**

```bash
git add shared/types/contract.ts
git commit -m "feat(contract): 新增 ContractExportMode 类型与默认值常量

PR6 spec §8.1 三模式 toggle 类型基础。"
```

---

## Task 2：xmlAst 新增 findMaxSharedId

**Files:**
- Modify: `server/agents/contract/docx/xmlAst.ts`
- Test: `tests/server/assistant/contract/docx/xmlAst.test.ts`

- [ ] **Step 1：追加测试到 `tests/server/assistant/contract/docx/xmlAst.test.ts` 末尾**

```typescript
describe('findMaxSharedId', () => {
    const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

    it('空文档返回 -1', () => {
        const ast = parseOoxml(`<?xml version="1.0"?><w:document ${W_NS}><w:body/></w:document>`)
        expect(findMaxSharedId(ast)).toBe(-1)
    })

    it('扫描 bookmarkStart / commentRangeStart / w:ins 跨标签取最大', () => {
        const xml = `<?xml version="1.0"?>
<w:document ${W_NS}>
  <w:body>
    <w:bookmarkStart w:id="3" w:name="b1"/>
    <w:p>
      <w:commentRangeStart w:id="7"/>
      <w:ins w:id="5" w:author="x" w:date="2024-01-01T00:00:00Z">
        <w:r><w:t>foo</w:t></w:r>
      </w:ins>
    </w:p>
  </w:body>
</w:document>`
        const ast = parseOoxml(xml)
        expect(findMaxSharedId(ast)).toBe(7)
    })

    it('忽略非 ID 池标签的同名 w:id 属性', () => {
        const xml = `<?xml version="1.0"?>
<w:document ${W_NS}>
  <w:body><w:p w:id="999"><w:r><w:t>foo</w:t></w:r></w:p></w:body>
</w:document>`
        const ast = parseOoxml(xml)
        expect(findMaxSharedId(ast)).toBe(-1)
    })

    it('忽略非数字 w:id 值', () => {
        const xml = `<?xml version="1.0"?>
<w:document ${W_NS}>
  <w:body><w:bookmarkStart w:id="abc" w:name="b1"/></w:body>
</w:document>`
        const ast = parseOoxml(xml)
        expect(findMaxSharedId(ast)).toBe(-1)
    })

    it('w:del 与 rPrChange 也算入', () => {
        const xml = `<?xml version="1.0"?>
<w:document ${W_NS}>
  <w:body>
    <w:p>
      <w:del w:id="11" w:author="LexSeek AI" w:date="2026-05-02T10:30:00Z">
        <w:r><w:rPr><w:rPrChange w:id="12" w:author="x" w:date="2026-05-02T10:30:00Z"><w:rPr/></w:rPrChange></w:rPr><w:delText>原</w:delText></w:r>
      </w:del>
    </w:p>
  </w:body>
</w:document>`
        const ast = parseOoxml(xml)
        expect(findMaxSharedId(ast)).toBe(12)
    })
})
```

并在文件顶部 `import` 行追加 `findMaxSharedId`。

- [ ] **Step 2：跑测试确认失败**

Run: `npx vitest run tests/server/assistant/contract/docx/xmlAst.test.ts -t findMaxSharedId`
Expected: FAIL — `findMaxSharedId is not exported from ...`

- [ ] **Step 3：在 `server/agents/contract/docx/xmlAst.ts` 末尾追加实现**

```typescript
/**
 * OOXML 共享 w:id 池涉及的标签集合。
 *
 * 来源：ECMA-376 第一部分对 `w:id` 属性的定义——同一份 docx 内多种修订/书签/批注/移动元素
 * 共享一套唯一 ID 池。撞 ID → Word 报"文件已损坏"拒打开（macOS Preview 容忍但 Windows
 * Word 严格）。redlineInjector 与 commentInjector 必须协调使用 findMaxSharedId 获取起始 ID。
 */
const ID_BEARING_TAGS = new Set([
    'w:bookmarkStart', 'w:bookmarkEnd',
    'w:ins', 'w:del', 'w:rPrChange', 'w:pPrChange',
    'w:sectPrChange', 'w:tblPrChange', 'w:tcPrChange', 'w:trPrChange',
    'w:cellIns', 'w:cellDel', 'w:cellMerge', 'w:numberingChange',
    'w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference',
    'w:moveFromRangeStart', 'w:moveToRangeStart',
    'w:moveFromRangeEnd', 'w:moveToRangeEnd',
])

/**
 * 扫描 OOXML AST 的所有 w:id 共享池标签，返回最大 w:id。
 *
 * @param rootAst 已 parseOoxml 的 document.xml AST
 * @returns 最大 w:id；不存在时返回 -1（调用方 +1 起 0）
 */
export function findMaxSharedId(rootAst: NodeArray): number {
    let max = -1
    walk(rootAst, (node) => {
        const tag = tagOf(node)
        if (!tag || !ID_BEARING_TAGS.has(tag)) return
        const idStr = getAttr(node, 'w:id')
        if (!idStr) return
        const id = parseInt(idStr, 10)
        if (Number.isFinite(id) && id > max) max = id
    })
    return max
}
```

- [ ] **Step 4：跑测试确认通过**

Run: `npx vitest run tests/server/assistant/contract/docx/xmlAst.test.ts -t findMaxSharedId`
Expected: PASS（5 个测试）

- [ ] **Step 5：commit**

```bash
git add server/agents/contract/docx/xmlAst.ts tests/server/assistant/contract/docx/xmlAst.test.ts
git commit -m "feat(contract): xmlAst 新增 findMaxSharedId 扫描共享 w:id 池

PR6 spec §8.3.1 redline+comment ID 协调依赖。"
```

---

## Task 3：xmlAst 抽出 collectNonEmptyParagraphs 共享函数

PR6 的 redlineInjector 与现有 commentInjector 都要遍历 docx body 直接子非空段落（口径必须严格一致，否则 anchorParagraphIndex 在两个 injector 里指向不同段）。把当前 commentInjector.ts 内部 file-private 的 `collectNonEmptyParagraphs` 抽到 xmlAst.ts 让两个 injector 共用。

**Files:**
- Modify: `server/agents/contract/docx/xmlAst.ts`（新增 export）
- Modify: `server/agents/contract/docx/commentInjector.ts`（删除内部实现 + import）
- Test: 覆盖在现有 `tests/server/assistant/contract/docx/commentInjector.annotations.test.ts`（黑盒行为不变）

- [ ] **Step 1：在 `xmlAst.ts` 末尾追加导出 `collectNonEmptyParagraphs`**

```typescript
/**
 * 取 w:body 直接子 <w:p> 列表，过滤"非空段落"（含 w:r 子节点）。
 *
 * 注意：只看 body 直接子段落，不递归 w:tbl 单元格里的段落——保持与 anchorParagraphIndex
 * 历史口径一致。commentInjector 与 redlineInjector 共享。
 */
export function collectNonEmptyParagraphs(documentAst: NodeArray): Node[] {
    const body = findFirst(documentAst, 'w:body')
    if (!body) return []
    const result: Node[] = []
    for (const kid of childrenOf(body)) {
        if (tagOf(kid) !== 'w:p') continue
        if (!hasRunChild(kid)) continue
        result.push(kid)
    }
    return result
}
```

- [ ] **Step 2：在 `commentInjector.ts` 删除原 file-private `collectNonEmptyParagraphs`（line 142-152）+ 在文件顶部 import 加上 `collectNonEmptyParagraphs`**

修改 line 27-44 的 import 块，把 `collectNonEmptyParagraphs` 加入：

```typescript
import {
    parseOoxml,
    stringifyOoxml,
    tagOf,
    childrenOf,
    getAttr,
    walk,
    findFirst,
    findAll,
    makeLeaf,
    makeElement,
    makeText,
    makeXmlDecl,
    appendChildToFirst,
    paragraphText,
    hasRunChild,
    collectNonEmptyParagraphs,
    type Node,
    type NodeArray,
} from './xmlAst'
```

并删除原 line 142-152 整个本地 `collectNonEmptyParagraphs` 函数。

- [ ] **Step 3：跑现有 commentInjector 测试确认行为不变**

Run: `npx vitest run tests/server/assistant/contract/docx/commentInjector.annotations.test.ts tests/server/assistant/contract/docx/commentInjector.test.ts`
Expected: PASS（所有现有用例继续绿）

- [ ] **Step 4：commit**

```bash
git add server/agents/contract/docx/xmlAst.ts server/agents/contract/docx/commentInjector.ts
git commit -m "refactor(contract): collectNonEmptyParagraphs 抽到 xmlAst 共享

PR6 redlineInjector 与 commentInjector 共用同一份段落提取口径。"
```

---

## Task 4：riskSchema 拒绝含换行的 suggestedClauseText

**Files:**
- Modify: `server/agents/contract/riskSchema.builder.ts`
- Test: `tests/server/assistant/contract/riskSchema.test.ts`

- [ ] **Step 1：在 `tests/server/assistant/contract/riskSchema.test.ts` 末尾追加用例**

```typescript
describe('RISK_SHAPE.suggestedClauseText 换行约束（PR6 §8.3.3）', () => {
    const baseRisk = {
        id: 'r1',
        clauseIndex: 0,
        clauseText: '原文',
        level: 'high' as const,
        category: '违约',
        problem: 'p',
        analysis: 'a',
        risk: 'r',
        suggestion: 's',
    }

    it('含 LF 的 suggestedClauseText 被 schema reject', () => {
        const result = RISK_SHAPE.safeParse({
            ...baseRisk,
            suggestedClauseText: '第一行\n第二行',
        })
        expect(result.success).toBe(false)
        if (!result.success) {
            const hit = result.error.issues.some(i =>
                i.path.includes('suggestedClauseText') && /换行/.test(i.message))
            expect(hit).toBe(true)
        }
    })

    it('含 CRLF 的 suggestedClauseText 也被 reject', () => {
        const result = RISK_SHAPE.safeParse({
            ...baseRisk,
            suggestedClauseText: '第一行\r\n第二行',
        })
        expect(result.success).toBe(false)
    })

    it('单段连续文字通过', () => {
        const result = RISK_SHAPE.safeParse({
            ...baseRisk,
            suggestedClauseText: '一段连续文字，含中英文标点 and English.',
        })
        expect(result.success).toBe(true)
    })

    it('low 级别仍允许省略 suggestedClauseText', () => {
        const result = RISK_SHAPE.safeParse({
            ...baseRisk,
            level: 'low',
        })
        expect(result.success).toBe(true)
    })
})
```

- [ ] **Step 2：跑测试确认 fail**

Run: `npx vitest run tests/server/assistant/contract/riskSchema.test.ts -t '换行约束'`
Expected: FAIL — schema 不强制 reject 含 `\n` 的输入

- [ ] **Step 3：修改 `server/agents/contract/riskSchema.builder.ts` line 32 的 suggestedClauseText 字段**

把：
```typescript
    suggestedClauseText: z.string().max(10000).optional().describe('AI 重写后的完整条款（high/medium 必填）'),
```
改为：
```typescript
    suggestedClauseText: z.string().max(10000)
        .refine(s => !/\r|\n/.test(s), {
            message: 'suggestedClauseText 不允许换行（v1 整段替换不支持多段插入；spec §8.3.3）',
        })
        .optional()
        .describe('AI 重写后的完整条款（high/medium 必填，单段连续文字不可含 CR/LF）'),
```

- [ ] **Step 4：跑测试确认 pass**

Run: `npx vitest run tests/server/assistant/contract/riskSchema.test.ts`
Expected: PASS（包括既有 + 新增 4 条用例）

- [ ] **Step 5：commit**

```bash
git add server/agents/contract/riskSchema.builder.ts tests/server/assistant/contract/riskSchema.test.ts
git commit -m "feat(contract): suggestedClauseText 拒绝 \\n / \\r 强制单段

spec §8.3.3：v1 整段替换不支持多段插入；prompt 改造交由 v2 LLM 端约束。"
```

---

## Task 5：commentInjector 接受 idStart + 返回 nextIdAfter

**Files:**
- Modify: `server/agents/contract/docx/commentInjector.ts`
- Test: `tests/server/assistant/contract/docx/commentInjector.annotations.test.ts`

- [ ] **Step 1：追加测试用例到 `commentInjector.annotations.test.ts` 末尾**

```typescript
describe('injectAnnotations idStart 协调（PR6 §8.3.1）', () => {
    it('未传 idStart 时 wId 从 0 开始（向后兼容）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(0, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]
        const { buffer, nextIdAfter } = await injectAnnotations(original, annotations, 999)
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        expect(commentsXml).toContain('w:id="0"')
        expect(commentsXml).toContain('w:id="1"')
        expect(commentsXml).not.toContain('w:id="2"')
        expect(nextIdAfter).toBe(2)
    })

    it('传 idStart=10 时 wId 从 10 开始 + nextIdAfter=12', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, anchorParagraphIndex: Math.min(0, paragraphs.length - 1) }),
            makeAnnotation({ id: 2, anchorParagraphIndex: Math.min(1, paragraphs.length - 1) }),
        ]
        const { buffer, nextIdAfter } = await injectAnnotations(original, annotations, 999, { idStart: 10 })
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        expect(commentsXml).toContain('w:id="10"')
        expect(commentsXml).toContain('w:id="11"')
        expect(commentsXml).not.toContain('w:id="12"')
        expect(nextIdAfter).toBe(12)
    })

    it('空 annotations + idStart=5 → nextIdAfter=5（不消耗 ID）', async () => {
        const original = await readFile(SAMPLE)
        const { nextIdAfter } = await injectAnnotations(original, [], 999, { idStart: 5 })
        expect(nextIdAfter).toBe(5)
    })

    it('parentAnnotationId 引用按新 idStart 偏移后的 wId', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const idx = Math.min(1, paragraphs.length - 1)
        const annotations: ContractAnnotationForExport[] = [
            makeAnnotation({ id: 1, authorName: 'AI', anchorParagraphIndex: idx }),
            makeAnnotation({ id: 2, authorName: '张律师', parentAnnotationId: 1, anchorParagraphIndex: idx }),
        ]
        const { buffer } = await injectAnnotations(original, annotations, 999, { idStart: 100 })
        const zip = await loadDocxZip(buffer)
        const commentsXml = await readTextFromZip(zip, 'word/comments.xml')
        // id=2 的 annotation 对应 w:id="101"，其父 id=1 对应 w:id="100"
        expect(commentsXml).toMatch(/w:parentId="100"/)
    })
})
```

- [ ] **Step 2：跑测试确认 fail**

Run: `npx vitest run tests/server/assistant/contract/docx/commentInjector.annotations.test.ts -t 'idStart 协调'`
Expected: FAIL — 函数签名未接受 `opts`，nextIdAfter 不在返回值

- [ ] **Step 3：修改 `commentInjector.ts` 接口与实现**

修改 line 305-309 的 `InjectAnnotationsResult`：

```typescript
export interface InjectAnnotationsResult {
    buffer: Buffer
    /** 每条 annotation 最终使用的 wordCommentRef（供调用方回写 DB） */
    refsByAnnotationId: Map<number, string>
    /**
     * 本次注入分配的 wId 末位 + 1（即"下一个可用 wId"）。
     * 供 both 模式下 redlineInjector 协调时接力 commentInjector 共享 ID 池。
     */
    nextIdAfter: number
}
```

修改函数签名（line 328）+ 入参解析：

```typescript
export async function injectAnnotations(
    docxBuffer: Buffer,
    annotations: ContractAnnotationForExport[],
    reviewId: number,
    opts?: { idStart?: number },
): Promise<InjectAnnotationsResult> {
    const idStart = opts?.idStart ?? 0
    const nextIdAfter = idStart + annotations.length
    const refsByAnnotationId = new Map<number, string>()

    if (annotations.length === 0) {
        const zip = await loadDocxZip(docxBuffer)
        zip.remove('word/comments.xml')
        zip.remove('word/_rels/comments.xml.rels')
        zip.remove('word/customXml/annotationRefs.xml')
        zip.remove('word/customXml/_rels/annotationRefs.xml.rels')
        await ensureContentTypesRegistered(zip, { comments: false, customXml: false })
        await ensureDocumentRelsRegistered(zip, { comments: false, customXml: false })
        return { buffer: await zipToBuffer(zip), refsByAnnotationId, nextIdAfter }
    }

    for (const a of annotations) {
        refsByAnnotationId.set(a.id, a.wordCommentRef ?? generateWordCommentRef(a.id))
    }
    // ... 余下逻辑保留 ...
```

修改 line 359-360 的 wId 映射：

```typescript
    const wordIdByAnnotationId = new Map<number, number>()
    annotations.forEach((a, idx) => wordIdByAnnotationId.set(a.id, idStart + idx))
```

修改 `validAnnotations.length === 0` 分支返回（约 line 414-416）：

```typescript
    if (validAnnotations.length === 0) {
        return { buffer: Buffer.from(docxBuffer), refsByAnnotationId, nextIdAfter }
    }
```

修改最终成功 return（约 line 450）：

```typescript
    return { buffer: await zipToBuffer(zip), refsByAnnotationId, nextIdAfter }
```

- [ ] **Step 4：跑现有所有 commentInjector 测试 + 新用例**

Run: `npx vitest run tests/server/assistant/contract/docx/commentInjector.annotations.test.ts tests/server/assistant/contract/docx/commentInjector.test.ts`
Expected: PASS（既有 N 个用例 + 4 个新增）

- [ ] **Step 5：上游调用方查漏**

Run: `grep -rn "injectAnnotations(" server/ tests/ --include="*.ts" | grep -v node_modules`
Expected: 调用方只增不减；既有调用方都不传 `opts`，默认 `idStart=0`，行为兼容。

- [ ] **Step 6：commit**

```bash
git add server/agents/contract/docx/commentInjector.ts tests/server/assistant/contract/docx/commentInjector.annotations.test.ts
git commit -m "feat(contract): commentInjector 接受 idStart 返回 nextIdAfter

PR6 §8.3.1 双模式协调：commentInjector 不再写死 wId 数组下标，
both 模式下从 redline 的 nextIdAfter 接力分配。
默认 idStart=0 完全向后兼容现有调用方。"
```

---

## Task 6：redlineLocate 定位算法

按 `clauseText` 拆行 + `quote_char_start/end` 行内 offset → 段落区间 + run 内 offset。算法对齐 spec §7.3.1 docxPreview 的 walkToTextNode（PR5），但跑在 OOXML AST 而非 DOM 上。

**Files:**
- Create: `server/agents/contract/docx/redlineLocate.ts`
- Create: `tests/server/assistant/contract/docx/redlineLocate.test.ts`

- [ ] **Step 1：先写测试 `tests/server/assistant/contract/docx/redlineLocate.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import {
    parseOoxml,
    collectNonEmptyParagraphs,
} from '~~/server/agents/contract/docx/xmlAst'
import { locateQuoteInParagraphs } from '~~/server/agents/contract/docx/redlineLocate'

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function makeDoc(...paragraphsXml: string[]): ReturnType<typeof collectNonEmptyParagraphs> {
    const xml = `<?xml version="1.0"?><w:document ${W_NS}><w:body>${paragraphsXml.join('')}</w:body></w:document>`
    return collectNonEmptyParagraphs(parseOoxml(xml))
}

describe('locateQuoteInParagraphs', () => {
    it('单 run 内的 quote：起止 runIdx 相同', () => {
        const paragraphs = makeDoc(
            '<w:p><w:r><w:t>违约金按 0.05% 计算。</w:t></w:r></w:p>',
        )
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '违约金按 0.05% 计算。',
            clauseParagraphIndex: 0,
            quoteCharStart: 5,  // "0.05%"
            quoteCharEnd: 10,
        })
        expect(loc).not.toBeNull()
        expect(loc!.startParaIdx).toBe(0)
        expect(loc!.endParaIdx).toBe(0)
        expect(loc!.splits).toHaveLength(1)
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 5,
            endRunIdx: 0,
            endRunOffset: 10,
        })
    })

    it('跨多 run 的 quote：起止 runIdx 不同', () => {
        const paragraphs = makeDoc(
            '<w:p>'
            + '<w:r><w:rPr><w:b/></w:rPr><w:t>违约金</w:t></w:r>'
            + '<w:r><w:t>按月底支付，逾期每日加收 </w:t></w:r>'
            + '<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>0.05%</w:t></w:r>'
            + '<w:r><w:t> 滞纳金。</w:t></w:r>'
            + '</w:p>',
        )
        // clauseText = "违约金按月底支付，逾期每日加收 0.05% 滞纳金。"
        // quote 取 "0.05%"（"违约金按月底支付，逾期每日加收 ".length = 16 字符）
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '违约金按月底支付,逾期每日加收 0.05% 滞纳金。'.replace(',', '，'),
            clauseParagraphIndex: 0,
            quoteCharStart: 16,
            quoteCharEnd: 21,
        })
        expect(loc).not.toBeNull()
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 2,
            startRunOffset: 0,
            endRunIdx: 2,
            endRunOffset: 5,
        })
    })

    it('quote 跨 run 起止：拆两个 run', () => {
        const paragraphs = makeDoc(
            '<w:p>'
            + '<w:r><w:t>违约金按月底</w:t></w:r>'
            + '<w:r><w:t>支付</w:t></w:r>'
            + '</w:p>',
        )
        // clauseText = "违约金按月底支付"
        // quote = "月底支" (offset 3..6) 起 run0[3..]、止 run1[0..1]
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '违约金按月底支付',
            clauseParagraphIndex: 0,
            quoteCharStart: 3,
            quoteCharEnd: 6,
        })
        expect(loc).not.toBeNull()
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 3,
            endRunIdx: 1,
            endRunOffset: 1,
        })
    })

    it('quote 跨多段（clauseText 含 \\n）', () => {
        const paragraphs = makeDoc(
            '<w:p><w:r><w:t>第一行内容</w:t></w:r></w:p>',
            '<w:p><w:r><w:t>第二行内容</w:t></w:r></w:p>',
        )
        // clauseText = "第一行内容\n第二行内容"，长度 11（\n 占 1）
        // quote = "内容\n第二" (offset 3..8)
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '第一行内容\n第二行内容',
            clauseParagraphIndex: 0,
            quoteCharStart: 3,
            quoteCharEnd: 8,
        })
        expect(loc).not.toBeNull()
        expect(loc!.startParaIdx).toBe(0)
        expect(loc!.endParaIdx).toBe(1)
        expect(loc!.splits).toHaveLength(2)
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 3,
            endRunIdx: 0,
            endRunOffset: 5, // 第一行末尾
        })
        expect(loc!.splits[1]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 0,
            endRunIdx: 0,
            endRunOffset: 2, // "第二"
        })
    })

    it('clauseParagraphIndex 越界 → 返回 null', () => {
        const paragraphs = makeDoc('<w:p><w:r><w:t>foo</w:t></w:r></w:p>')
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: 'foo',
            clauseParagraphIndex: 5,
            quoteCharStart: 0,
            quoteCharEnd: 3,
        })
        expect(loc).toBeNull()
    })

    it('quote 范围越出 clauseText → 返回 null', () => {
        const paragraphs = makeDoc('<w:p><w:r><w:t>foo</w:t></w:r></w:p>')
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: 'foo',
            clauseParagraphIndex: 0,
            quoteCharStart: 1,
            quoteCharEnd: 99,
        })
        expect(loc).toBeNull()
    })

    it('段落 textContent 不含 quote 字符段 → 返回 null', () => {
        // clauseText 与 OOXML 段落 textContent 不一致（罕见迁移残留），定位失败返回 null
        const paragraphs = makeDoc('<w:p><w:r><w:t>合同正文 A</w:t></w:r></w:p>')
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '合同正文 B',  // 与段落 textContent "合同正文 A" 不一致
            clauseParagraphIndex: 0,
            quoteCharStart: 0,
            quoteCharEnd: 3,
        })
        expect(loc).toBeNull()
    })

    it('w:tab 视作 1 字符', () => {
        const paragraphs = makeDoc(
            '<w:p>'
            + '<w:r><w:t>前</w:t><w:tab/><w:t>后</w:t></w:r>'
            + '</w:p>',
        )
        // textContent = "前\t后" (3 字符)；clauseText 同；quote = "\t后" (offset 1..3)
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs: paragraphs,
            clauseText: '前\t后',
            clauseParagraphIndex: 0,
            quoteCharStart: 1,
            quoteCharEnd: 3,
        })
        expect(loc).not.toBeNull()
        expect(loc!.splits[0]!.runSplit).toEqual({
            startRunIdx: 0,
            startRunOffset: 1,
            endRunIdx: 0,
            endRunOffset: 3,
        })
    })
})
```

- [ ] **Step 2：跑测试确认 fail（文件不存在）**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineLocate.test.ts`
Expected: FAIL — `Cannot find module .../redlineLocate`

- [ ] **Step 3：创建 `server/agents/contract/docx/redlineLocate.ts`**

```typescript
/**
 * 在 OOXML 段落数组里定位 quote 字符段对应的「段落区间 + 起止 run + run 内偏移」。
 *
 * 输入约定（PR3 落地）：
 *  - clauseText：完整条款原文，可含 `\n` 表示跨多段（segmentClauses 用 \n 连接 lines）
 *  - quoteCharStart/End：相对 clauseText 的字符 offset（不是文档全文）
 *  - clauseParagraphIndex：clauseText 起始段在 collectNonEmptyParagraphs 数组里的索引
 *
 * 字符等价性（textContent 累加规则，与 docxPreview spec §7.3.2 对齐）：
 *  - <w:t> 文本 → 字面字符
 *  - <w:tab/> → 1 字符（合同 clauseText 里 tab 也是 \t 单字符）
 *  - <w:br/> → 0 字符（不算字符 offset）
 *  - 其它 run 子节点（w:rPr 等）→ 0 字符
 *
 * 失败返回 null：clauseParagraphIndex 越界 / quote 越界 clauseText / 段落 textContent
 * 与 clauseText 不一致（迁移残留）/ 累加未命中。
 */
import {
    childrenOf,
    tagOf,
    textOf,
    type Node,
} from './xmlAst'

export interface RunSplit {
    /** quote 起始 run 在段落 kids 数组里的下标（不计 w:pPr 等头部，但下游用 kids 数组下标） */
    startRunIdx: number
    /** quote 起始 run 内的字符偏移（指向 quote 第一个字符） */
    startRunOffset: number
    /** quote 结尾 run 在段落 kids 数组里的下标 */
    endRunIdx: number
    /** quote 结尾 run 内的字符偏移（exclusive，指向 quote 之后第一个字符） */
    endRunOffset: number
}

export interface QuoteLocation {
    /** quote 起始段在 nonEmptyParagraphs 里的索引 */
    startParaIdx: number
    /** quote 结尾段在 nonEmptyParagraphs 里的索引 */
    endParaIdx: number
    /**
     * 起止段的 run 拆分点：
     *  - 起始段（i==startParaIdx）：runSplit 表示 quote 的"起始 run + offset"，
     *    endRunIdx/endRunOffset 表示该段内 quote 的结束（同段时 == 整 quote 终点；跨段时 == 段落末尾）
     *  - 中间段（startParaIdx < i < endParaIdx）：runSplit==null（整段全删）
     *  - 结尾段（i==endParaIdx）：runSplit.startRunIdx=0/startRunOffset=0，
     *    endRunIdx/endRunOffset 是 quote 的真实终点
     */
    splits: Array<{ paraIdx: number; runSplit: RunSplit | null }>
}

interface RunHit {
    runIdx: number
    runOffset: number
}

/**
 * 段落里按 textContent 累加 charOffset，找 (runIdx, runOffset)。
 *
 * 越界返回 null。允许 charOffset == paraTextLength（指向段末，作为 endOffset 合法）。
 */
function findRunOffsetInParagraph(paraNode: Node, charOffset: number): RunHit | null {
    const kids = childrenOf(paraNode)
    let consumed = 0
    for (let runIdx = 0; runIdx < kids.length; runIdx++) {
        const kid = kids[runIdx]!
        if (tagOf(kid) !== 'w:r') continue
        const runLen = computeRunLength(kid)
        if (consumed + runLen >= charOffset) {
            return { runIdx, runOffset: charOffset - consumed }
        }
        consumed += runLen
    }
    if (charOffset === consumed) {
        // 指向段末（exclusive 结束位置允许落到最后一个 run 的 runLen）
        for (let runIdx = kids.length - 1; runIdx >= 0; runIdx--) {
            if (tagOf(kids[runIdx]!) === 'w:r') {
                return { runIdx, runOffset: computeRunLength(kids[runIdx]!) }
            }
        }
    }
    return null
}

function computeRunLength(runNode: Node): number {
    let len = 0
    for (const kid of childrenOf(runNode)) {
        const t = tagOf(kid)
        if (t === 'w:t') len += textOf(kid).length
        else if (t === 'w:tab') len += 1
        // w:br / w:rPr / 其它子节点 0 字符
    }
    return len
}

function paragraphTextLengthByRunRule(paraNode: Node): number {
    let len = 0
    for (const kid of childrenOf(paraNode)) {
        if (tagOf(kid) !== 'w:r') continue
        len += computeRunLength(kid)
    }
    return len
}

export function locateQuoteInParagraphs(input: {
    nonEmptyParagraphs: Node[]
    clauseText: string
    clauseParagraphIndex: number
    quoteCharStart: number
    quoteCharEnd: number
}): QuoteLocation | null {
    const { nonEmptyParagraphs, clauseText, clauseParagraphIndex, quoteCharStart, quoteCharEnd } = input

    // 边界：quote 越界 clauseText
    if (quoteCharStart < 0 || quoteCharEnd > clauseText.length || quoteCharStart >= quoteCharEnd) return null

    // 拆 clauseText 行 + 累加每行起止
    const lines = clauseText.split('\n')
    const linePositions: Array<{ start: number; end: number }> = []
    let cursor = 0
    for (const line of lines) {
        linePositions.push({ start: cursor, end: cursor + line.length })
        cursor += line.length + 1  // +1 是 \n
    }

    // 找 quote 起止落在哪些行 + 行内 offset
    const startHit = locateInLines(linePositions, quoteCharStart)
    const endHitRaw = locateInLines(linePositions, quoteCharEnd)
    if (!startHit || !endHitRaw) return null
    // endHit 落在行起点（即 quote 正好在前一行末尾结束）时，归到前一行末尾以避免空尾段
    let endHit = endHitRaw
    if (endHit.lineIdx > startHit.lineIdx && endHit.lineOffset === 0) {
        endHit = { lineIdx: endHit.lineIdx - 1, lineOffset: lines[endHit.lineIdx - 1]!.length }
    }

    // 起止段在 OOXML 段落里的索引
    const startParaIdx = clauseParagraphIndex + startHit.lineIdx
    const endParaIdx = clauseParagraphIndex + endHit.lineIdx
    if (startParaIdx < 0 || endParaIdx >= nonEmptyParagraphs.length) return null

    const splits: QuoteLocation['splits'] = []

    if (startParaIdx === endParaIdx) {
        // 同段
        const para = nonEmptyParagraphs[startParaIdx]!
        // 起止段 textContent 长度必须 ≥ 行长度（基本一致性校验）
        if (paragraphTextLengthByRunRule(para) < endHit.lineOffset) return null
        const startRun = findRunOffsetInParagraph(para, startHit.lineOffset)
        const endRun = findRunOffsetInParagraph(para, endHit.lineOffset)
        if (!startRun || !endRun) return null
        splits.push({
            paraIdx: startParaIdx,
            runSplit: {
                startRunIdx: startRun.runIdx,
                startRunOffset: startRun.runOffset,
                endRunIdx: endRun.runIdx,
                endRunOffset: endRun.runOffset,
            },
        })
    }
    else {
        // 跨段：起始段
        const startPara = nonEmptyParagraphs[startParaIdx]!
        const startParaLen = paragraphTextLengthByRunRule(startPara)
        if (startParaLen < lines[startHit.lineIdx]!.length) return null
        const sStart = findRunOffsetInParagraph(startPara, startHit.lineOffset)
        const sEnd = findRunOffsetInParagraph(startPara, startParaLen)
        if (!sStart || !sEnd) return null
        splits.push({
            paraIdx: startParaIdx,
            runSplit: {
                startRunIdx: sStart.runIdx,
                startRunOffset: sStart.runOffset,
                endRunIdx: sEnd.runIdx,
                endRunOffset: sEnd.runOffset,
            },
        })

        // 中间段（全删）
        for (let i = startParaIdx + 1; i < endParaIdx; i++) {
            splits.push({ paraIdx: i, runSplit: null })
        }

        // 结尾段
        const endPara = nonEmptyParagraphs[endParaIdx]!
        if (paragraphTextLengthByRunRule(endPara) < endHit.lineOffset) return null
        const eStart = findRunOffsetInParagraph(endPara, 0)
        const eEnd = findRunOffsetInParagraph(endPara, endHit.lineOffset)
        if (!eStart || !eEnd) return null
        splits.push({
            paraIdx: endParaIdx,
            runSplit: {
                startRunIdx: eStart.runIdx,
                startRunOffset: eStart.runOffset,
                endRunIdx: eEnd.runIdx,
                endRunOffset: eEnd.runOffset,
            },
        })
    }

    return { startParaIdx, endParaIdx, splits }
}

function locateInLines(
    linePositions: Array<{ start: number; end: number }>,
    charOffset: number,
): { lineIdx: number; lineOffset: number } | null {
    for (let i = 0; i < linePositions.length; i++) {
        const lp = linePositions[i]!
        // 包含起点（inclusive）+ 包含终点（inclusive，以便 endOffset 落到行末）
        if (charOffset >= lp.start && charOffset <= lp.end) {
            return { lineIdx: i, lineOffset: charOffset - lp.start }
        }
    }
    return null
}
```

- [ ] **Step 4：跑测试确认 pass**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineLocate.test.ts`
Expected: PASS（8 个测试）

- [ ] **Step 5：commit**

```bash
git add server/agents/contract/docx/redlineLocate.ts tests/server/assistant/contract/docx/redlineLocate.test.ts
git commit -m "feat(contract): redlineLocate 在 OOXML AST 定位 quote 字符段

PR6 §8.3.2 跨 run 拆分基础：按 clauseText 拆行 + 行内 offset 还原到
段落数组 + 段内 run 索引 + run 内偏移。算法对齐 spec §7.3.2 字符等价规则。"
```

---

## Task 7：redlineInjector 主实现（拆 run + 装配 del/ins）

**Files:**
- Create: `server/agents/contract/docx/redlineInjector.ts`
- Create: `tests/server/assistant/contract/docx/redlineInjector.test.ts`

- [ ] **Step 1：先写测试 `tests/server/assistant/contract/docx/redlineInjector.test.ts` 顶部 + 第一组用例**

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    parseOoxml,
    stringifyOoxml,
    findFirst,
    findAll,
    getAttr,
    collectNonEmptyParagraphs,
} from '~~/server/agents/contract/docx/xmlAst'
import {
    loadDocxZip,
    readTextFromZip,
} from '~~/server/agents/contract/docx/zipRewriter'
import {
    injectRedlineMarks,
    type RedlineRisk,
} from '~~/server/agents/contract/docx/redlineInjector'

const SAMPLE = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')
const W_AUTHOR = 'LexSeek AI'

function makeRisk(overrides: Partial<RedlineRisk> & { id: number }): RedlineRisk {
    return {
        clauseText: '',
        clauseParagraphIndex: 0,
        problematicQuote: null,
        quoteCharStart: null,
        quoteCharEnd: null,
        suggestedClauseText: null,
        ...overrides,
    }
}

describe('injectRedlineMarks', () => {
    it('quote=null 的 risk 全跳过且不修改 docx', async () => {
        const original = await readFile(SAMPLE)
        const result = await injectRedlineMarks(original, [
            makeRisk({ id: 1 }),
        ], { reviewId: 999, idStart: 0 })
        expect(result.skippedRiskIds).toEqual([1])
        expect(result.nextIdAfter).toBe(0)
        // 原始 buffer 内容相同（不必字节相等，但段落数应一致）
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        expect(docXml).not.toContain('<w:ins ')
        expect(docXml).not.toContain('<w:del ')
    })

    it('suggestedClauseText 为空的 risk 跳过', async () => {
        const original = await readFile(SAMPLE)
        const result = await injectRedlineMarks(original, [
            makeRisk({
                id: 2,
                problematicQuote: 'foo',
                quoteCharStart: 0,
                quoteCharEnd: 3,
                clauseText: 'foo bar',
                suggestedClauseText: null,
            }),
        ], { reviewId: 999, idStart: 0 })
        expect(result.skippedRiskIds).toEqual([2])
    })

    it('clauseParagraphIndex=null 的 risk 跳过', async () => {
        const original = await readFile(SAMPLE)
        const result = await injectRedlineMarks(original, [
            makeRisk({
                id: 3,
                problematicQuote: 'foo',
                quoteCharStart: 0,
                quoteCharEnd: 3,
                clauseText: 'foo bar',
                clauseParagraphIndex: null,
                suggestedClauseText: 'baz',
            }),
        ], { reviewId: 999, idStart: 0 })
        expect(result.skippedRiskIds).toEqual([3])
    })
})
```

- [ ] **Step 2：跑测试确认 fail**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineInjector.test.ts`
Expected: FAIL — `Cannot find module .../redlineInjector`

- [ ] **Step 3：创建 `server/agents/contract/docx/redlineInjector.ts` 骨架（先实现跳过逻辑）**

```typescript
/**
 * OOXML Track Changes（修订模式）注入。
 *
 * 输入：每条 risk 的 quote 锚点（PR3 落地）+ suggestedClauseText（risksSchema 已强制单段）。
 * 输出：原 docx 内 quote 范围内所有 run 被 wrap 进 `<w:del>`（保留原 `<w:rPr>` 副本，
 *   `<w:t>` → `<w:delText>`），紧邻插入 `<w:ins>` 包裹 suggestedClauseText（继承 quote
 *   起始 run 的 rPr）。整段被删时段落标记同步加 `<w:pPr><w:rPr><w:del/></w:rPr></w:pPr>`。
 *
 * 跳过条件（risk 不参与 redline，记入 skippedRiskIds，调用方可走 comment fallback）：
 *  - problematicQuote == null（无锚点）
 *  - quoteCharStart/End == null（同上）
 *  - suggestedClauseText 为空（low risk 无改写建议）
 *  - clauseParagraphIndex == null
 *  - locateQuoteInParagraphs 返回 null（OOXML 段落 textContent 与 clauseText 不一致等）
 *
 * ID 协调（spec §8.3.1）：
 *  - 入参 idStart 必须 ≥ findMaxSharedId(原 docx) + 1
 *  - 每条 redline 占 2 个 ID（w:del + w:ins）；整段删除时多占 1 个（pPr/rPr/del）
 *  - 返回 nextIdAfter = idStart + 已分配数，供 both 模式接力 commentInjector
 */
import type { Buffer as NodeBuffer } from 'node:buffer'
import {
    parseOoxml,
    stringifyOoxml,
    childrenOf,
    tagOf,
    textOf,
    makeElement,
    makeText,
    collectNonEmptyParagraphs,
    type Node,
    type NodeArray,
} from './xmlAst'
import {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
} from './zipRewriter'
import { locateQuoteInParagraphs, type RunSplit } from './redlineLocate'

const REDLINE_AUTHOR = 'LexSeek AI'

export interface RedlineRisk {
    /** contractRisks.id（数据库主键），仅用于 skippedRiskIds 回报 */
    id: number
    clauseText: string
    clauseParagraphIndex: number | null
    problematicQuote: string | null
    quoteCharStart: number | null
    quoteCharEnd: number | null
    suggestedClauseText: string | null
}

export interface InjectRedlineResult {
    buffer: NodeBuffer
    /** 没装 redline 的 risk id 列表（按 spec §8.4 调用方走 comment fallback） */
    skippedRiskIds: number[]
    /** 下一个可用 w:id（供 both 模式接力 commentInjector） */
    nextIdAfter: number
    warnings: string[]
}

export async function injectRedlineMarks(
    docxBuffer: Buffer,
    risks: RedlineRisk[],
    options: { reviewId: number; idStart: number },
): Promise<InjectRedlineResult> {
    const skippedRiskIds: number[] = []
    const warnings: string[] = []
    let cursorId = options.idStart

    // 先过滤掉前置 invalid 的 risk（不解 zip 也能判断）
    const candidates: RedlineRisk[] = []
    for (const r of risks) {
        if (
            !r.problematicQuote
            || r.quoteCharStart == null
            || r.quoteCharEnd == null
            || !r.suggestedClauseText
            || r.clauseParagraphIndex == null
        ) {
            skippedRiskIds.push(r.id)
            continue
        }
        candidates.push(r)
    }

    if (candidates.length === 0) {
        return {
            buffer: Buffer.from(docxBuffer),
            skippedRiskIds,
            nextIdAfter: cursorId,
            warnings,
        }
    }

    const zip = await loadDocxZip(docxBuffer)
    const documentAst = parseOoxml(await readTextFromZip(zip, 'word/document.xml'))
    const nonEmptyParagraphs = collectNonEmptyParagraphs(documentAst)
    const dateIso = new Date().toISOString()

    for (const risk of candidates) {
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs,
            clauseText: risk.clauseText,
            clauseParagraphIndex: risk.clauseParagraphIndex!,
            quoteCharStart: risk.quoteCharStart!,
            quoteCharEnd: risk.quoteCharEnd!,
        })
        if (!loc) {
            skippedRiskIds.push(risk.id)
            warnings.push(`risk ${risk.id}: locateQuoteInParagraphs 返回 null（clauseText 与段落 textContent 不一致或越界）`)
            continue
        }

        // 实施由 Task 8 / Task 9 完成（先占位让骨架编译通过）
        skippedRiskIds.push(risk.id)
        warnings.push(`risk ${risk.id}: redline 装配未实现`)
    }

    writeTextToZip(zip, 'word/document.xml', stringifyOoxml(documentAst))
    return {
        buffer: await zipToBuffer(zip),
        skippedRiskIds,
        nextIdAfter: cursorId,
        warnings,
    }
}
```

- [ ] **Step 4：跑前 3 个测试**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineInjector.test.ts`
Expected: PASS — 跳过逻辑生效

- [ ] **Step 5：扩展测试（同段单 run 装配 + 跨 run 装配 + xml:space 保留）**

追加到 `redlineInjector.test.ts`：

```typescript
describe('injectRedlineMarks 装配（同段 quote）', () => {
    /** 自测试用 fixture：单段、单 run 的最小 docx XML */
    const FIXTURE_XML_SINGLE_RUN = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">违约金按 0.05% 计算。</w:t></w:r></w:p>
  </w:body>
</w:document>`

    /**
     * 用最小 fixture XML 替换 labor.docx 的 word/document.xml，做单元测试。
     * 跑产物时 OOXML 其余 part 沿用 labor.docx（避免重新构造完整 docx 文件）。
     */
    async function buildFixtureBuffer(documentXml: string): Promise<Buffer> {
        const original = await readFile(SAMPLE)
        const zip = await loadDocxZip(original)
        zip.file('word/document.xml', documentXml)
        return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    }

    it('单 run 内的 quote：拆 run 三段，保留 rPr 副本，生成 w:del + w:ins', async () => {
        const buffer = await buildFixtureBuffer(FIXTURE_XML_SINGLE_RUN)
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText: '违约金按 0.05% 计算。',
            clauseParagraphIndex: 0,
            problematicQuote: '0.05%',
            quoteCharStart: 5,
            quoteCharEnd: 10,
            suggestedClauseText: '0.5%',
        }], { reviewId: 999, idStart: 100 })

        expect(result.skippedRiskIds).toEqual([])
        expect(result.nextIdAfter).toBe(102)

        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        expect(docXml).toContain('<w:del w:id="100"')
        expect(docXml).toContain(`w:author="${W_AUTHOR}"`)
        expect(docXml).toContain('<w:ins w:id="101"')
        expect(docXml).toContain('<w:delText xml:space="preserve">0.05%</w:delText>')
        // ins 内 suggestedClauseText 保留 xml:space="preserve"
        expect(docXml).toMatch(/<w:t xml:space="preserve">0\.5%<\/w:t>/)
        // 删除前后段保持原 <w:t>（违约金按 + 计算。）
        expect(docXml).toContain('<w:t xml:space="preserve">违约金按 </w:t>')
        expect(docXml).toContain('<w:t xml:space="preserve"> 计算。</w:t>')
        // 三段都保留原 <w:b/> 粗体 rPr 副本
        const docAst = parseOoxml(docXml)
        const rPrElems = findAll(docAst, 'w:rPr')
        // 至少 4 处：原前段、del 内、ins 内、原后段（具体数视实现而定，≥3）
        expect(rPrElems.length).toBeGreaterThanOrEqual(3)
    })

    it('跨多 run 的 quote：起止 run 各拆，中间 run 全 wrap，所有 run 保留 rPr 副本', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">违约金</w:t></w:r>
      <w:r><w:t xml:space="preserve">按月底支付,逾期每日加收 </w:t></w:r>
      <w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">0.05%</w:t></w:r>
      <w:r><w:t xml:space="preserve"> 滞纳金。</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
        const buffer = await buildFixtureBuffer(xml)
        // clauseText 与段落 textContent 严格一致（不替换中文逗号）
        const clauseText = '违约金按月底支付,逾期每日加收 0.05% 滞纳金。'
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText,
            clauseParagraphIndex: 0,
            problematicQuote: '0.05%',
            quoteCharStart: clauseText.indexOf('0.05%'),
            quoteCharEnd: clauseText.indexOf('0.05%') + 5,
            suggestedClauseText: '0.5%',
        }], { reviewId: 999, idStart: 0 })

        expect(result.skippedRiskIds).toEqual([])
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        expect(docXml).toContain('<w:delText xml:space="preserve">0.05%</w:delText>')
        // 红色 run rPr 在 del 内仍保留
        expect(docXml).toMatch(/<w:rPr><w:color w:val="FF0000"\/><\/w:rPr>[\s\S]*<w:delText/)
        // ins 文本是 0.5%，继承 quote 起始 run 的红色 rPr
        expect(docXml).toMatch(/<w:ins[^>]*><w:r><w:rPr><w:color w:val="FF0000"\/><\/w:rPr><w:t xml:space="preserve">0\.5%<\/w:t><\/w:r><\/w:ins>/)
    })

    it('w:author 固定 LexSeek AI / w:date 含 Z 时区', async () => {
        const buffer = await buildFixtureBuffer(FIXTURE_XML_SINGLE_RUN)
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText: '违约金按 0.05% 计算。',
            clauseParagraphIndex: 0,
            problematicQuote: '0.05%',
            quoteCharStart: 5,
            quoteCharEnd: 10,
            suggestedClauseText: '0.5%',
        }], { reviewId: 999, idStart: 0 })
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        expect(docXml).toContain(`w:author="${W_AUTHOR}"`)
        expect(docXml).toMatch(/w:date="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z"/)
    })
})
```

- [ ] **Step 6：跑测试确认装配用例 fail（占位实现报"未实现"）**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineInjector.test.ts`
Expected: 跳过用例继续 PASS，装配用例 FAIL

- [ ] **Step 7：在 `redlineInjector.ts` 实现拆 run + 装配 helper**

把 Task 7 Step 3 的占位代码替换为真实实现。在文件末尾追加：

```typescript
/**
 * 深克隆 AST 节点（fast-xml-parser 返回的是普通 plain object，JSON 拷贝足够）。
 */
function deepClone<T>(node: T): T {
    return JSON.parse(JSON.stringify(node))
}

function getRPr(runNode: Node): Node | null {
    return childrenOf(runNode).find(k => tagOf(k) === 'w:rPr') ?? null
}

/**
 * 把单个 <w:r> 在指定 run 内偏移处一刀切两半，保留 rPr 副本。
 * 字符等价规则与 redlineLocate 一致：w:t 字面 / w:tab=1 / w:br=0。
 *
 * 返回 { left, right }；任一边没有内容（仅含 rPr）→ 该侧返回 null。
 */
function splitRunAtOffset(runNode: Node, offset: number): { left: Node | null; right: Node | null } {
    const kids = childrenOf(runNode)
    const rPr = kids.find(k => tagOf(k) === 'w:rPr') ?? null
    const leftKids: NodeArray = []
    const rightKids: NodeArray = []
    if (rPr) { leftKids.push(deepClone(rPr)); rightKids.push(deepClone(rPr)) }

    let consumed = 0
    for (const kid of kids) {
        const tag = tagOf(kid)
        if (tag === 'w:rPr') continue
        if (tag === 'w:t') {
            const txt = textOf(kid)
            const len = txt.length
            const startC = consumed
            const endC = consumed + len
            if (endC <= offset) {
                leftKids.push(deepClone(kid))
            }
            else if (startC >= offset) {
                rightKids.push(deepClone(kid))
            }
            else {
                // 横跨切分点
                const cut = offset - startC
                if (cut > 0) {
                    leftKids.push(makeElement('w:t', { 'xml:space': 'preserve' }, [makeText(txt.slice(0, cut))]))
                }
                if (cut < len) {
                    rightKids.push(makeElement('w:t', { 'xml:space': 'preserve' }, [makeText(txt.slice(cut))]))
                }
            }
            consumed += len
        }
        else if (tag === 'w:tab') {
            // 1 字符
            if (consumed < offset) leftKids.push(deepClone(kid))
            else rightKids.push(deepClone(kid))
            consumed += 1
        }
        else if (tag === 'w:br') {
            // 0 字符；按 consumed 与 offset 关系归边
            if (consumed < offset) leftKids.push(deepClone(kid))
            else rightKids.push(deepClone(kid))
        }
        else {
            if (consumed < offset) leftKids.push(deepClone(kid))
            else rightKids.push(deepClone(kid))
        }
    }

    const leftHasContent = leftKids.some(k => tagOf(k) !== 'w:rPr')
    const rightHasContent = rightKids.some(k => tagOf(k) !== 'w:rPr')
    return {
        left: leftHasContent ? makeElement('w:r', {}, leftKids) : null,
        right: rightHasContent ? makeElement('w:r', {}, rightKids) : null,
    }
}

/**
 * 把一个 <w:r> 的 <w:t> 子节点替换为 <w:delText>，rPr 副本保留。
 * 用于 quote 范围内"已切分好的"run（不含 w:tab 等其它子节点的特殊处理；
 * 这些子节点保留原样写入 del 内）。
 */
function convertRunToDeleteRun(runNode: Node): Node {
    const kids = childrenOf(runNode)
    const newKids: NodeArray = []
    for (const kid of kids) {
        const tag = tagOf(kid)
        if (tag === 'w:t') {
            newKids.push(makeElement('w:delText', { 'xml:space': 'preserve' }, [makeText(textOf(kid))]))
        }
        else {
            newKids.push(deepClone(kid))
        }
    }
    return makeElement('w:r', {}, newKids)
}

interface AppliedSegment {
    /** 在该段落内消耗的 ID 数：单段非整段 = 2（del+ins）；跨段中间 = 1（仅 del，无 ins）；
     *  跨段起止 = del 各 1，ins 仅在结尾段 1（约定 ins 接在 quote 实际终点之后）；
     *  整段删除（startParaIdx==endParaIdx 且 quote 覆盖整段 textContent） = 3（del + ins + pPr/del）。
     *  Task 8 处理整段 case；本 Task 仅处理 quote 不覆盖整段的常态。 */
    consumedIds: number
}

/**
 * 在指定段落内按 RunSplit 应用 redline 拆分：
 *  - quote 范围 run 替换为 w:delText 并 wrap 进 w:del
 *  - 起止 run 在 offset 处拆分（保留 rPr 副本）
 *  - 仅在 includeIns=true 时紧邻 ins 段后插入 w:ins 包裹 suggestedClauseText
 *
 * 修改 paraNode 的子节点数组（in-place）。
 */
function applyRedlineToParagraph(input: {
    paraNode: Node
    runSplit: RunSplit
    suggestedClauseText: string | null
    delId: number
    insId: number | null
    dateIso: string
}): void {
    const { paraNode, runSplit, suggestedClauseText, delId, insId, dateIso } = input
    const tag = tagOf(paraNode)
    if (!tag) return
    const kids = paraNode[tag] as NodeArray
    if (!Array.isArray(kids)) return

    // 1. 把起始 run 拆成 [前段(外)] + [起段(内 = quote 起始)]
    const startRunNode = kids[runSplit.startRunIdx]!
    const startSplit = splitRunAtOffset(startRunNode, runSplit.startRunOffset)

    // 2. 把结尾 run 拆成 [止段(内 = quote 结尾)] + [后段(外)]
    const endRunNode = kids[runSplit.endRunIdx]!
    const endSplit = splitRunAtOffset(endRunNode, runSplit.endRunOffset)

    // 3. 收集 quote 范围内的"内"run：startSplit.right + 中间 run + endSplit.left
    //    若 startRunIdx == endRunIdx：起止同 run；正确切法是先按 endRunOffset 切，再按 startRunOffset 切左半部分
    let quoteRuns: NodeArray = []
    if (runSplit.startRunIdx === runSplit.endRunIdx) {
        // 同 run：先取 [..endOffset] 再切其内 [startOffset..]
        const sameRun = startRunNode
        const upToEnd = splitRunAtOffset(sameRun, runSplit.endRunOffset)
        // upToEnd.left = 前段 + quote ；upToEnd.right = 后段
        if (upToEnd.left) {
            const inner = splitRunAtOffset(upToEnd.left, runSplit.startRunOffset)
            // inner.left = 前段；inner.right = quote
            const before = inner.left  // 起始 run 之前段（外）
            const inner2 = inner.right  // quote 内
            const after = upToEnd.right  // 结尾 run 之后段（外）

            const newRuns: NodeArray = []
            if (before) newRuns.push(before)
            const delChildren: NodeArray = []
            if (inner2) delChildren.push(convertRunToDeleteRun(inner2))
            if (delChildren.length > 0) {
                newRuns.push(makeElement('w:del', {
                    'w:id': String(delId),
                    'w:author': REDLINE_AUTHOR,
                    'w:date': dateIso,
                }, delChildren))
            }
            if (insId != null && suggestedClauseText) {
                // 继承 quote 起始 run 的 rPr 副本作 ins 内 run 的 rPr
                const inheritRpr = inner2 ? getRPr(inner2) : null
                newRuns.push(buildInsertNode({
                    text: suggestedClauseText,
                    inheritedRpr: inheritRpr ? deepClone(inheritRpr) : null,
                    insId,
                    dateIso,
                }))
            }
            if (after) newRuns.push(after)

            kids.splice(runSplit.startRunIdx, 1, ...newRuns)
            return
        }
    }

    // 跨 run（startRunIdx < endRunIdx）
    const beforeStartRun = startSplit.left   // 外
    const startInnerRun = startSplit.right   // quote 起始
    const middleRuns = kids.slice(runSplit.startRunIdx + 1, runSplit.endRunIdx)
        .filter(k => tagOf(k) === 'w:r')
        .map(k => deepClone(k))
    const endInnerRun = endSplit.left   // quote 结尾
    const afterEndRun = endSplit.right  // 外

    const delChildren: NodeArray = []
    if (startInnerRun) delChildren.push(convertRunToDeleteRun(startInnerRun))
    for (const m of middleRuns) delChildren.push(convertRunToDeleteRun(m))
    if (endInnerRun) delChildren.push(convertRunToDeleteRun(endInnerRun))

    const newRuns: NodeArray = []
    if (beforeStartRun) newRuns.push(beforeStartRun)
    if (delChildren.length > 0) {
        newRuns.push(makeElement('w:del', {
            'w:id': String(delId),
            'w:author': REDLINE_AUTHOR,
            'w:date': dateIso,
        }, delChildren))
    }
    if (insId != null && suggestedClauseText) {
        const inheritRpr = startInnerRun ? getRPr(startInnerRun) : null
        newRuns.push(buildInsertNode({
            text: suggestedClauseText,
            inheritedRpr: inheritRpr ? deepClone(inheritRpr) : null,
            insId,
            dateIso,
        }))
    }
    if (afterEndRun) newRuns.push(afterEndRun)

    // 替换 [startRunIdx..endRunIdx] 区间为 newRuns
    kids.splice(runSplit.startRunIdx, runSplit.endRunIdx - runSplit.startRunIdx + 1, ...newRuns)
}

function buildInsertNode(input: {
    text: string
    inheritedRpr: Node | null
    insId: number
    dateIso: string
}): Node {
    const { text, inheritedRpr, insId, dateIso } = input
    const runChildren: NodeArray = []
    if (inheritedRpr) runChildren.push(inheritedRpr)
    runChildren.push(makeElement('w:t', { 'xml:space': 'preserve' }, [makeText(text)]))
    return makeElement('w:ins', {
        'w:id': String(insId),
        'w:author': REDLINE_AUTHOR,
        'w:date': dateIso,
    }, [makeElement('w:r', {}, runChildren)])
}
```

并把 Step 3 占位代码（`// 实施由 Task 8...` 后两行）替换为：

```typescript
        // 同段（暂不处理跨段，跨段在 Task 8 加上）
        if (loc.startParaIdx !== loc.endParaIdx) {
            skippedRiskIds.push(risk.id)
            warnings.push(`risk ${risk.id}: quote 跨多段，PR6 暂仅同段支持`)
            continue
        }

        const split = loc.splits[0]!
        if (!split.runSplit) {
            skippedRiskIds.push(risk.id)
            warnings.push(`risk ${risk.id}: runSplit 为 null`)
            continue
        }

        const delId = cursorId
        const insId = cursorId + 1
        applyRedlineToParagraph({
            paraNode: nonEmptyParagraphs[loc.startParaIdx]!,
            runSplit: split.runSplit,
            suggestedClauseText: risk.suggestedClauseText,
            delId,
            insId,
            dateIso,
        })
        cursorId += 2
```

- [ ] **Step 8：跑装配用例确认 pass**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineInjector.test.ts`
Expected: PASS（6 个用例：3 跳过 + 3 装配）

- [ ] **Step 9：commit**

```bash
git add server/agents/contract/docx/redlineInjector.ts tests/server/assistant/contract/docx/redlineInjector.test.ts
git commit -m "feat(contract): redlineInjector 主实现（同段跨 run 拆分 + del/ins 装配）

PR6 §8.3.2 / §8.3.4：
- splitRunAtOffset 拆 run 时 deep-clone <w:rPr> 副本到两侧（保留字体/字号/颜色）
- quote 范围 <w:t> 替换为 <w:delText>（保留 xml:space=preserve）
- <w:del> wrap 完整 quote runs，紧邻插入 <w:ins> 含 suggestedClauseText
  （继承 quote 起始 run 的 rPr 副本）
- ID 协调：每条 redline 占 2 个 ID（del + ins）
- 跨段 / 整段删除留待 Task 8 实现"
```

---

## Task 8：redlineInjector 跨段 + 整段删除段落标记

**Files:**
- Modify: `server/agents/contract/docx/redlineInjector.ts`
- Modify: `tests/server/assistant/contract/docx/redlineInjector.test.ts`

- [ ] **Step 1：追加测试用例（跨段 + 完整段删除）**

```typescript
describe('injectRedlineMarks 跨段 / 整段删除', () => {
    async function buildFixtureBuffer(documentXml: string): Promise<Buffer> {
        const original = await readFile(SAMPLE)
        const zip = await loadDocxZip(original)
        zip.file('word/document.xml', documentXml)
        return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    }

    it('quote 跨多段：起始段 + 中间段 + 结尾段都装 w:del，结尾段后插 w:ins', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">第一行内容</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">第二行内容</w:t></w:r></w:p>
  </w:body>
</w:document>`
        const buffer = await buildFixtureBuffer(xml)
        // clauseText = "第一行内容\n第二行内容" (11 字符)
        // quote = "内容\n第二" (offset 3..8)
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText: '第一行内容\n第二行内容',
            clauseParagraphIndex: 0,
            problematicQuote: '内容\n第二',
            quoteCharStart: 3,
            quoteCharEnd: 8,
            suggestedClauseText: 'XYZ',
        }], { reviewId: 999, idStart: 0 })

        expect(result.skippedRiskIds).toEqual([])
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        // 第一段含 w:del 包裹 "内容"
        expect(docXml).toMatch(/<w:del[^>]*><w:r>(<w:rPr\/>)?<w:delText xml:space="preserve">内容<\/w:delText><\/w:r><\/w:del>/)
        // 第二段含 w:del 包裹 "第二" + 后面跟 w:ins "XYZ"
        expect(docXml).toMatch(/<w:delText xml:space="preserve">第二<\/w:delText>[\s\S]*<w:ins[^>]*>[\s\S]*XYZ/)
        // ID 顺序：每段 1 个 del + 全 redline 共 1 个 ins → 共 3 ID
        expect(result.nextIdAfter).toBe(3)
    })

    it('整段删除（quote 覆盖整段 textContent）：段落 pPr/rPr/del 同步加上', async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">这一整段都是问题。</w:t></w:r></w:p>
  </w:body>
</w:document>`
        const buffer = await buildFixtureBuffer(xml)
        const clauseText = '这一整段都是问题。'
        const result = await injectRedlineMarks(buffer, [{
            id: 1,
            clauseText,
            clauseParagraphIndex: 0,
            problematicQuote: clauseText,
            quoteCharStart: 0,
            quoteCharEnd: clauseText.length,
            suggestedClauseText: '建议改写后的整段。',
        }], { reviewId: 999, idStart: 0 })

        expect(result.skippedRiskIds).toEqual([])
        const zip = await loadDocxZip(result.buffer)
        const docXml = await readTextFromZip(zip, 'word/document.xml')
        // 段落 pPr/rPr/del 加上
        expect(docXml).toMatch(/<w:pPr><w:rPr><w:del[^/]*\/><\/w:rPr><\/w:pPr>/)
        // 占用 3 个 ID（del + ins + pPr/del）
        expect(result.nextIdAfter).toBe(3)
    })
})
```

- [ ] **Step 2：跑测试确认 fail**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineInjector.test.ts -t '跨段 / 整段删除'`
Expected: FAIL — 跨段被 skip / 整段没加 pPr/rPr/del

- [ ] **Step 3：在 `redlineInjector.ts` 替换跨段早退逻辑**

把 Task 7 Step 7 中"暂不处理跨段"分支整段替换为：

```typescript
        // 整段删除判定：startParaIdx == endParaIdx 且 quote 覆盖该段所有 textContent
        const isWholeParagraphDeletion = (() => {
            if (loc.startParaIdx !== loc.endParaIdx) return false
            const split = loc.splits[0]!.runSplit
            if (!split) return false
            const para = nonEmptyParagraphs[loc.startParaIdx]!
            const paraLen = paragraphTextLengthByRunRule(para)
            return split.startRunIdx === firstRunIdx(para)
                && split.startRunOffset === 0
                && split.endRunOffset === computeRunLength(childrenOf(para)[split.endRunIdx]!)
                && split.endRunIdx === lastRunIdx(para)
                && paraLen === risk.quoteCharEnd! - risk.quoteCharStart!
        })()

        if (loc.startParaIdx === loc.endParaIdx) {
            const split = loc.splits[0]!.runSplit!
            const delId = cursorId
            const insId = cursorId + 1
            applyRedlineToParagraph({
                paraNode: nonEmptyParagraphs[loc.startParaIdx]!,
                runSplit: split,
                suggestedClauseText: risk.suggestedClauseText,
                delId,
                insId,
                dateIso,
            })
            cursorId += 2
            if (isWholeParagraphDeletion) {
                addParagraphDeleteMark(nonEmptyParagraphs[loc.startParaIdx]!, cursorId, dateIso)
                cursorId += 1
            }
        }
        else {
            // 跨段：每段独立 w:del，结尾段后追加 w:ins
            for (let i = 0; i < loc.splits.length; i++) {
                const seg = loc.splits[i]!
                const para = nonEmptyParagraphs[seg.paraIdx]!
                const isStart = i === 0
                const isEnd = i === loc.splits.length - 1
                const split = seg.runSplit ?? wholeParagraphRunSplit(para)
                const delId = cursorId
                const insId = isEnd ? cursorId + 1 : null
                applyRedlineToParagraph({
                    paraNode: para,
                    runSplit: split,
                    suggestedClauseText: isEnd ? risk.suggestedClauseText : null,
                    delId,
                    insId,
                    dateIso,
                })
                cursorId += isEnd ? 2 : 1
            }
        }
```

并在 redlineInjector.ts 末尾追加 helper：

```typescript
function computeRunLength(runNode: Node): number {
    let len = 0
    for (const kid of childrenOf(runNode)) {
        const t = tagOf(kid)
        if (t === 'w:t') len += textOf(kid).length
        else if (t === 'w:tab') len += 1
    }
    return len
}

function paragraphTextLengthByRunRule(paraNode: Node): number {
    let len = 0
    for (const kid of childrenOf(paraNode)) {
        if (tagOf(kid) !== 'w:r') continue
        len += computeRunLength(kid)
    }
    return len
}

function firstRunIdx(paraNode: Node): number {
    const kids = childrenOf(paraNode)
    return kids.findIndex(k => tagOf(k) === 'w:r')
}

function lastRunIdx(paraNode: Node): number {
    const kids = childrenOf(paraNode)
    for (let i = kids.length - 1; i >= 0; i--) {
        if (tagOf(kids[i]!) === 'w:r') return i
    }
    return -1
}

function wholeParagraphRunSplit(paraNode: Node): RunSplit {
    const kids = childrenOf(paraNode)
    const startIdx = firstRunIdx(paraNode)
    const endIdx = lastRunIdx(paraNode)
    return {
        startRunIdx: startIdx,
        startRunOffset: 0,
        endRunIdx: endIdx,
        endRunOffset: computeRunLength(kids[endIdx]!),
    }
}

/**
 * 段落整段被删时同步加 <w:pPr><w:rPr><w:del/></w:rPr></w:pPr>。
 * 已存在 w:pPr 时复用，否则新建放到段落首位。
 */
function addParagraphDeleteMark(paraNode: Node, delId: number, dateIso: string): void {
    const tag = tagOf(paraNode)
    if (!tag) return
    const kids = paraNode[tag] as NodeArray
    if (!Array.isArray(kids)) return

    let pPr = kids.find(k => tagOf(k) === 'w:pPr')
    if (!pPr) {
        pPr = makeElement('w:pPr', {}, [])
        kids.unshift(pPr)
    }

    const pPrTag = tagOf(pPr)!
    const pPrKids = pPr[pPrTag] as NodeArray

    let rPr = pPrKids.find(k => tagOf(k) === 'w:rPr')
    if (!rPr) {
        rPr = makeElement('w:rPr', {}, [])
        pPrKids.unshift(rPr)
    }
    const rPrTag = tagOf(rPr)!
    const rPrKids = rPr[rPrTag] as NodeArray
    rPrKids.push({
        'w:del': [],
        ':@': {
            '@_w:id': String(delId),
            '@_w:author': REDLINE_AUTHOR,
            '@_w:date': dateIso,
        },
    } as Node)
}
```

- [ ] **Step 4：跑测试确认 pass**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineInjector.test.ts`
Expected: PASS（全部用例 8 条）

- [ ] **Step 5：commit**

```bash
git add server/agents/contract/docx/redlineInjector.ts tests/server/assistant/contract/docx/redlineInjector.test.ts
git commit -m "feat(contract): redlineInjector 支持跨段 quote + 整段删除段落标记

PR6 §8.3.5：
- 跨段：每段独立 w:del，结尾段后追加 w:ins（每段消耗 1 ID，结尾段 2 ID）
- 整段删除：在 w:p 的 w:pPr/w:rPr 内追加 <w:del/> 子标记保证律师
  接受所有修订后段落标记一并删除（不留空段）"
```

---

## Task 9：docx/index.ts 导出新模块

**Files:**
- Modify: `server/agents/contract/docx/index.ts`

- [ ] **Step 1：在 `index.ts` 末尾追加导出**

```typescript
export { injectRedlineMarks } from './redlineInjector'
export type { RedlineRisk, InjectRedlineResult } from './redlineInjector'
export { findMaxSharedId, collectNonEmptyParagraphs } from './xmlAst'
```

并把现有第 13 行从 `export { escapeXml } from './xmlAst'` 改为：

```typescript
export { escapeXml, findMaxSharedId, collectNonEmptyParagraphs } from './xmlAst'
```

（即合并到一行 export，避免重复）

- [ ] **Step 2：跑全量 docx 测试确认无回归**

Run: `npx vitest run tests/server/assistant/contract/docx/`
Expected: PASS（既有 + 新增）

- [ ] **Step 3：commit**

```bash
git add server/agents/contract/docx/index.ts
git commit -m "feat(contract): docx index 导出 redlineInjector + findMaxSharedId"
```

---

## Task 10：rebuildDocxService 接受 mode 三模式协调

**Files:**
- Modify: `server/agents/contract/contractReviewRebuild.service.ts`
- Create: `tests/server/assistant/contract/contractReviewRebuild.mode.test.ts`

- [ ] **Step 1：先写测试 `tests/server/assistant/contract/contractReviewRebuild.mode.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

;(globalThis as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    createOssFileDao: vi.fn(async () => ({ id: 999 })),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
    uploadFileService: vi.fn(async () => ({ name: 'oss/path.docx' })),
    generateSignedUrlService: vi.fn(async () => 'https://signed/url'),
    deleteFileService: vi.fn(),
}))
vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(async () => ({ bucket: 'b' })),
}))
vi.mock('~~/server/agents/contract/contractAnnotation.dao', () => ({
    listAnnotationsForExportDAO: vi.fn(async () => []),
}))
vi.mock('~~/server/agents/contract/contractAnnotation.service', () => ({
    filterExportableDbAnnotations: vi.fn((annotations: any[]) => annotations),
}))
vi.mock('~~/server/agents/contract/contractRisk.dao', () => ({
    listContractRisksDAO: vi.fn(async () => []),
}))
vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    setCompletedAfterRebuildDAO: vi.fn(),
}))
vi.mock('~~/server/agents/contract/docx', async () => {
    const actual = await vi.importActual<any>('~~/server/agents/contract/docx')
    return {
        ...actual,
        injectAnnotations: vi.fn(async (buf: Buffer) => ({
            buffer: buf, refsByAnnotationId: new Map(), nextIdAfter: 0,
        })),
        injectRedlineMarks: vi.fn(async (buf: Buffer, risks: any[]) => ({
            buffer: buf, skippedRiskIds: [], nextIdAfter: 0, warnings: [],
        })),
    }
})

const SAMPLE = join(__dirname, '../../../prisma/seeds/contract-samples/labor.docx')

describe('rebuildDocxService 三模式协调（PR6 §8.2）', () => {
    beforeEach(() => vi.clearAllMocks())

    async function setup() {
        const buf = await readFile(SAMPLE)
        const { findOssFileByIdDao } = await import('~~/server/services/files/ossFiles.dao')
        const { downloadFileService } = await import('~~/server/services/storage/storage.service')
        ;(findOssFileByIdDao as any).mockResolvedValue({ filePath: 'orig', fileName: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValue(buf)

        const review = {
            id: 100,
            userId: 1,
            originalFileId: 1,
            maxVersionNo: null,
        } as any

        const { rebuildDocxService } = await import('~~/server/agents/contract/contractReviewRebuild.service')
        return { rebuildDocxService, review }
    }

    it('mode=comment（默认）：只调 injectAnnotations，不调 injectRedlineMarks', async () => {
        const { rebuildDocxService, review } = await setup()
        const docx = await import('~~/server/agents/contract/docx')
        await rebuildDocxService(review)
        expect(docx.injectAnnotations).toHaveBeenCalledOnce()
        expect(docx.injectRedlineMarks).not.toHaveBeenCalled()
    })

    it('mode=redline：调 injectRedlineMarks + 跳过的 risk fallback 走 injectAnnotations', async () => {
        const { rebuildDocxService, review } = await setup()
        const docx = await import('~~/server/agents/contract/docx')
        ;(docx.injectRedlineMarks as any).mockResolvedValue({
            buffer: Buffer.alloc(0), skippedRiskIds: [42], nextIdAfter: 4, warnings: [],
        })
        const { listAnnotationsForExportDAO } = await import('~~/server/agents/contract/contractAnnotation.dao')
        ;(listAnnotationsForExportDAO as any).mockResolvedValue([
            { id: 1, riskId: 42, authorType: 'ai', authorName: 'AI', content: 'x', parentAnnotationId: null, wordCommentRef: null, createdAt: new Date(), risk: { clauseText: 'c', clauseParagraphIndex: 0, orphaned: false } },
        ])
        await rebuildDocxService(review, { mode: 'redline' })
        expect(docx.injectRedlineMarks).toHaveBeenCalledOnce()
        // fallback comment：annotations 仅 riskId in skippedRiskIds 的子集
        expect(docx.injectAnnotations).toHaveBeenCalledOnce()
        const callArgs = (docx.injectAnnotations as any).mock.calls[0]
        expect(callArgs[1]).toHaveLength(1)
        expect(callArgs[1][0].riskId).toBe(42)
        expect(callArgs[3]).toEqual({ idStart: 4 })
    })

    it('mode=both：先调 injectRedlineMarks，全部 annotations 走 injectAnnotations 接力 nextIdAfter', async () => {
        const { rebuildDocxService, review } = await setup()
        const docx = await import('~~/server/agents/contract/docx')
        ;(docx.injectRedlineMarks as any).mockResolvedValue({
            buffer: Buffer.alloc(0), skippedRiskIds: [], nextIdAfter: 6, warnings: [],
        })
        const { listAnnotationsForExportDAO } = await import('~~/server/agents/contract/contractAnnotation.dao')
        ;(listAnnotationsForExportDAO as any).mockResolvedValue([
            { id: 1, riskId: 10, authorType: 'ai', authorName: 'AI', content: 'x', parentAnnotationId: null, wordCommentRef: null, createdAt: new Date(), risk: { clauseText: 'c', clauseParagraphIndex: 0, orphaned: false } },
        ])
        await rebuildDocxService(review, { mode: 'both' })
        expect(docx.injectRedlineMarks).toHaveBeenCalledOnce()
        expect(docx.injectAnnotations).toHaveBeenCalledOnce()
        const callArgs = (docx.injectAnnotations as any).mock.calls[0]
        // both 模式 → 全部 annotations 都进 commentInjector
        expect(callArgs[1]).toHaveLength(1)
        expect(callArgs[3]).toEqual({ idStart: 6 })
    })
})
```

- [ ] **Step 2：跑测试确认 fail**

Run: `npx vitest run tests/server/assistant/contract/contractReviewRebuild.mode.test.ts`
Expected: FAIL — `rebuildDocxService` 不接受 mode 参数；`injectRedlineMarks` 永远不调

- [ ] **Step 3：修改 `server/agents/contract/contractReviewRebuild.service.ts`**

在 import 块加上：
```typescript
import { findMaxSharedId, injectRedlineMarks } from './docx'
import { parseOoxml } from './docx/xmlAst'
import { readTextFromZip, loadDocxZip } from './docx/zipRewriter'
import { listContractRisksDAO } from './contractRisk.dao'
import type { ContractExportMode } from '#shared/types/contract'
import type { RedlineRisk } from './docx'
```

修改函数签名 + 入口参数解析：
```typescript
export async function rebuildDocxService(
    review: contractReviews,
    opts: { mode?: ContractExportMode } = {},
): Promise<RebuildDocxResult> {
    const mode = opts.mode ?? 'comment'

    if (!review.originalFileId) throw new Error('审查没有原始文件，无法重生批注')
    const origOssFile = await findOssFileByIdDao(review.originalFileId)
    if (!origOssFile?.filePath) throw new Error('原始文件已丢失，无法重生批注')

    const origBuffer = await downloadFileService(origOssFile.filePath)

    // Phase B：从 contractAnnotations 表读取批注
    const dbAnnotations = await listAnnotationsForExportDAO(review.id)
    const exportable = filterExportableDbAnnotations(dbAnnotations, review.id)
    const annotations: ContractAnnotationForExport[] = exportable.map(a => ({
        id: a.id,
        riskId: a.riskId,
        authorType: a.authorType as ContractAnnotationForExport['authorType'],
        authorName: a.authorName,
        content: a.content,
        parentAnnotationId: a.parentAnnotationId,
        anchorQuote: a.risk.clauseText,
        anchorParagraphIndex: a.risk.clauseParagraphIndex!,
        wordCommentRef: a.wordCommentRef,
        createdAt: a.createdAt,
    }))

    let finalBuffer: Buffer
    let refsByAnnotationId: Map<number, string>
    const writeRefs = new Map<number, string>()

    if (mode === 'comment') {
        const r = await injectAnnotations(origBuffer, annotations, review.id)
        finalBuffer = r.buffer
        refsByAnnotationId = r.refsByAnnotationId
        for (const [k, v] of r.refsByAnnotationId) writeRefs.set(k, v)
    }
    else {
        // redline / both 都需要先扫 ID 池底数
        const docAst = parseOoxml(await readTextFromZip(await loadDocxZip(origBuffer), 'word/document.xml'))
        const idStart = findMaxSharedId(docAst) + 1

        const risks = await listContractRisksDAO(review.id)
        const redlineRisks: RedlineRisk[] = risks.map(r => ({
            id: r.id,
            clauseText: r.clauseText,
            clauseParagraphIndex: r.clauseParagraphIndex,
            problematicQuote: r.problematicQuote,
            quoteCharStart: r.quoteCharStart,
            quoteCharEnd: r.quoteCharEnd,
            suggestedClauseText: r.suggestedClauseText,
        }))
        const redlineResult = await injectRedlineMarks(origBuffer, redlineRisks, {
            reviewId: review.id, idStart,
        })

        if (mode === 'redline') {
            // 跳过的 risk → fallback 挂 comment
            const skippedSet = new Set(redlineResult.skippedRiskIds)
            const fallback = annotations.filter(a => skippedSet.has(a.riskId))
            if (fallback.length > 0) {
                const cr = await injectAnnotations(redlineResult.buffer, fallback, review.id, { idStart: redlineResult.nextIdAfter })
                finalBuffer = cr.buffer
                refsByAnnotationId = cr.refsByAnnotationId
                for (const [k, v] of cr.refsByAnnotationId) writeRefs.set(k, v)
            }
            else {
                finalBuffer = redlineResult.buffer
                refsByAnnotationId = new Map()
            }
        }
        else {
            // both：全部 annotations 走 commentInjector，从 nextIdAfter 接力
            const cr = await injectAnnotations(redlineResult.buffer, annotations, review.id, { idStart: redlineResult.nextIdAfter })
            finalBuffer = cr.buffer
            refsByAnnotationId = cr.refsByAnnotationId
            for (const [k, v] of cr.refsByAnnotationId) writeRefs.set(k, v)
        }
    }

    // 将新生成的 wordCommentRef 批量回写到 DB
    const toUpdate = exportable.filter(a => a.wordCommentRef === null && writeRefs.has(a.id))
    if (toUpdate.length > 0) {
        await prisma.$transaction(
            toUpdate.map(a =>
                prisma.contractAnnotations.update({
                    where: { id: a.id },
                    data: { wordCommentRef: writeRefs.get(a.id) },
                }),
            ),
        )
    }

    const buffer = Buffer.isBuffer(finalBuffer) ? finalBuffer : Buffer.from(finalBuffer)

    // ... 余下 OSS 上传 / setCompletedAfterRebuildDAO 逻辑保留 ...
```

- [ ] **Step 4：跑测试确认 pass**

Run: `npx vitest run tests/server/assistant/contract/contractReviewRebuild.mode.test.ts tests/server/assistant/contract/rebuildDocx.api.test.ts tests/server/assistant/contract/contractReviewRebuild.service.test.ts 2>&1 | tail -30`
Expected: PASS（mode 测试 3 条 + 既有 rebuild 测试不回归）

- [ ] **Step 5：commit**

```bash
git add server/agents/contract/contractReviewRebuild.service.ts tests/server/assistant/contract/contractReviewRebuild.mode.test.ts
git commit -m "feat(contract): rebuildDocxService 接受 mode 三模式协调

PR6 §8.2：
- mode=comment（默认，向后兼容）：只调 injectAnnotations
- mode=redline：injectRedlineMarks 先跑；skippedRiskIds 走 comment fallback
- mode=both：injectRedlineMarks → 全部 annotations 接力 commentInjector
ID 协调：findMaxSharedId 取底数，redline.nextIdAfter 接力 commentInjector idStart"
```

---

## Task 11：downloadContractReviewVersionService 接受 mode

**Files:**
- Modify: `server/agents/contract/contractReviewVersion.service.ts`

历史版本下载也要支持 mode 切换（spec 未限定，但用户体验对齐工作区）。结构与 Task 10 一致：从 snapshot 读取 risks → 走 redline / both 协调。

- [ ] **Step 1：在 `downloadContractReviewVersionService` 函数签名上加 `opts`**

```typescript
export async function downloadContractReviewVersionService(
    review: contractReviews,
    versionId: number,
    opts: { mode?: ContractExportMode } = {},
): Promise<{ data: { downloadUrl: string; filename: string } } | { error: '...' }>
```

- [ ] **Step 2：在函数体内 mode 分支调用 injectRedlineMarks / injectAnnotations**

按 Task 10 模式改造，从 snapshot.risks 取 redlineRisks（snapshot 的 risks 已含 quote 字段——PR2 后 ContractRiskEntity 直接落 snapshot），其余流程一致。

- [ ] **Step 3：跑现有版本下载测试确认无回归**

Run: `npx vitest run tests/server/assistant/contract/reviews.versions.api.test.ts`
Expected: PASS（既有用例继续绿，新参数默认 'comment' 时行为不变）

- [ ] **Step 4：commit**

```bash
git add server/agents/contract/contractReviewVersion.service.ts
git commit -m "feat(contract): 历史版本下载 service 同样支持三模式

PR6：用户在历史版本预览态切换 batch / redline / both 时与工作区一致。"
```

---

## Task 12：用户端 download API 加 mode query

**Files:**
- Modify: `server/api/v1/assistant/contract/reviews/download/[id].get.ts`
- Modify: `tests/server/assistant/contract/download.api.test.ts`

- [ ] **Step 1：在 `download.api.test.ts` 末尾追加 mode 用例**

```typescript
describe('download API mode query（PR6 §8.2）', () => {
    beforeEach(() => vi.clearAllMocks())

    it('未传 mode → 默认 comment', async () => {
        mockGetReview.mockResolvedValue({ id: 1, userId: 1, reviewedFileId: 5 })
        mockAtomicClaim.mockResolvedValue(true)
        mockRebuildDocx.mockResolvedValue({ reviewedFileId: 6, downloadUrl: 'u', filename: 'f' })
        const event = makeEvent({ userId: 1, reviewId: '1' })
        await downloadHandler(event as any)
        expect(mockRebuildDocx).toHaveBeenCalledWith(expect.anything(), { mode: 'comment' })
    })

    it('mode=redline 透传到 rebuildDocxService', async () => {
        mockGetReview.mockResolvedValue({ id: 1, userId: 1, reviewedFileId: 5 })
        mockAtomicClaim.mockResolvedValue(true)
        mockRebuildDocx.mockResolvedValue({ reviewedFileId: 6, downloadUrl: 'u', filename: 'f' })
        const event = makeEvent({ userId: 1, reviewId: '1', query: { mode: 'redline' } })
        await downloadHandler(event as any)
        expect(mockRebuildDocx).toHaveBeenCalledWith(expect.anything(), { mode: 'redline' })
    })

    it('mode=invalid → 400', async () => {
        const event = makeEvent({ userId: 1, reviewId: '1', query: { mode: 'invalid' } })
        const res = await downloadHandler(event as any)
        expect((res as any).code).toBe(400)
    })
})
```

并在 `makeEvent` helper 上加 `query` 入参（如未支持），同时在测试顶部 stub：

```typescript
;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
```

`makeEvent` 函数追加 `query` 字段映射到 `event.__query`。

- [ ] **Step 2：跑测试确认 fail**

Run: `npx vitest run tests/server/assistant/contract/download.api.test.ts -t mode`
Expected: FAIL — handler 不解析 mode

- [ ] **Step 3：修改 `server/api/v1/assistant/contract/reviews/download/[id].get.ts`**

```typescript
import { z } from 'zod'
import { CONTRACT_EXPORT_MODES, DEFAULT_CONTRACT_EXPORT_MODE } from '#shared/types/contract'
import type { ContractExportMode } from '#shared/types/contract'

const ModeQuery = z.object({
    mode: z.enum(CONTRACT_EXPORT_MODES).optional(),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '访问该合同审查' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { review } = guard

    if (!review.reviewedFileId) {
        return resError(event, 400, '审查尚未完成，暂无可下载文件')
    }

    const queryParse = ModeQuery.safeParse(getQuery(event))
    if (!queryParse.success) {
        return resError(event, 400, '导出模式参数无效')
    }
    const mode: ContractExportMode = queryParse.data.mode ?? DEFAULT_CONTRACT_EXPORT_MODE

    const claimed = await atomicSetRebuildingDAO(review.id)
    if (!claimed) {
        return resError(event, 409, '正在生成最新批注，请稍后再试')
    }

    try {
        const result = await rebuildDocxService(review, { mode })
        return resSuccess(event, '获取下载地址成功', {
            downloadUrl: result.downloadUrl,
            filename: result.filename,
        })
    }
    catch (err) {
        await rollbackRebuildDAO(review.id).catch(() => {})
        logger.error('[contract download] 每次下载重新生成失败', {
            reviewId: review.id, mode,
            err: err instanceof Error ? err.message : String(err),
        })
        return resError(event, 500, '生成批注 docx 失败，请稍后重试')
    }
})
```

- [ ] **Step 4：跑测试确认 pass**

Run: `npx vitest run tests/server/assistant/contract/download.api.test.ts`
Expected: PASS（既有 + 3 条新增）

- [ ] **Step 5：commit**

```bash
git add server/api/v1/assistant/contract/reviews/download/\[id\].get.ts tests/server/assistant/contract/download.api.test.ts
git commit -m "feat(contract): 用户端 download API 加 mode query

PR6 §8.2 GET /reviews/download/:id?mode=comment|redline|both"
```

---

## Task 13：历史版本下载 API 加 mode query

**Files:**
- Modify: `server/api/v1/assistant/contract/reviews/versions/download/[versionId].get.ts`

- [ ] **Step 1：参照 Task 12 改造**（query 校验 + 透传到 `downloadContractReviewVersionService`）

具体代码：

```typescript
import { loadOwnedReviewByVersionId } from '~~/server/services/assistant/contract/reviewGuard'
import { downloadContractReviewVersionService } from '~~/server/services/assistant/contract/contractReviewVersion.service'
import { z } from 'zod'
import { CONTRACT_EXPORT_MODES, DEFAULT_CONTRACT_EXPORT_MODE } from '#shared/types/contract'
import type { ContractExportMode } from '#shared/types/contract'

const ModeQuery = z.object({
    mode: z.enum(CONTRACT_EXPORT_MODES).optional(),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByVersionId(event, { actionLabel: '下载该历史版本' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { review } = guard
    const versionId = guard.subId!

    const queryParse = ModeQuery.safeParse(getQuery(event))
    if (!queryParse.success) {
        return resError(event, 400, '导出模式参数无效')
    }
    const mode: ContractExportMode = queryParse.data.mode ?? DEFAULT_CONTRACT_EXPORT_MODE

    const result = await downloadContractReviewVersionService(review, versionId, { mode })
    if ('error' in result) {
        switch (result.error) {
            case 'version_not_found': return resError(event, 404, '版本不存在')
            case 'origin_file_missing': return resError(event, 404, '历史版本的合同文件已丢失')
            case 'snapshot_invalid': return resError(event, 404, '历史版本快照数据异常')
            case 'inject_failed': return resError(event, 500, '生成历史版本批注文件失败，请稍后重试')
        }
    }
    return resSuccess(event, '获取下载地址成功', result.data)
})
```

- [ ] **Step 2：跑现有版本下载测试**

Run: `npx vitest run tests/server/assistant/contract/reviews.versions.api.test.ts`
Expected: PASS（既有用例无回归）

- [ ] **Step 3：commit**

```bash
git add server/api/v1/assistant/contract/reviews/versions/download/\[versionId\].get.ts
git commit -m "feat(contract): 历史版本 download API 加 mode query

PR6：与工作区下载行为一致，支持三模式切换。"
```

---

## Task 14：useContractReviewExport.onDownload 接受 mode

**Files:**
- Modify: `app/composables/useContractReviewExport.ts`

- [ ] **Step 1：修改 `onDownload` 签名 + URL 透传**

把 line 58 起的 `onDownload` 改造为：

```typescript
async function onDownload(mode: ContractExportMode = 'comment') {
    if (!reviewId.value) return

    const url = `/api/v1/assistant/contract/reviews/download/${reviewId.value}?mode=${mode}`
    const result = await useApiFetch<DownloadResponse>(url, { showError: false })
    if (!result?.downloadUrl) {
        toast.error('下载失败，请稍后重试')
        return
    }

    try {
        const httpResp = await fetch(result.downloadUrl)
        if (!httpResp.ok) throw new Error(`HTTP ${httpResp.status}`)
        triggerBrowserDownloadBlob(await httpResp.blob(), result.filename)
    }
    catch {
        triggerBrowserDownloadUrl(result.downloadUrl, result.filename)
    }
}
```

并在文件顶部 imports 加上：

```typescript
import type { ContractExportMode, DownloadResponse } from '#shared/types/contract'
```

（`DownloadResponse` 已 import，仅追加 `ContractExportMode`）

- [ ] **Step 2：跑类型检查**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3：commit**

```bash
git add app/composables/useContractReviewExport.ts
git commit -m "feat(contract): onDownload 接受 mode 参数透传到 API"
```

---

## Task 15：RiskListPanel 单按钮 → DropdownMenu

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Modify: `tests/app/components/assistant/contract/RiskListPanel.test.ts`

- [ ] **Step 1：先写测试用例**

在 `tests/app/components/assistant/contract/RiskListPanel.test.ts` 末尾追加：

```typescript
describe('RiskListPanel 下载模式 toggle（PR6 §8.1）', () => {
    it('点击下载下拉菜单可选三种模式', async () => {
        const wrapper = mount(AssistantContractRiskListPanel, {
            props: { ...basePropsCompleted },
        })
        const trigger = wrapper.find('[data-testid="download-trigger"]')
        expect(trigger.exists()).toBe(true)
        await trigger.trigger('click')
        // RadioGroup 三个 item
        const items = wrapper.findAll('[data-testid^="download-mode-"]')
        expect(items.map(i => i.attributes('data-testid'))).toEqual([
            'download-mode-comment',
            'download-mode-redline',
            'download-mode-both',
        ])
    })

    it('选中 redline → emit download(redline)', async () => {
        const wrapper = mount(AssistantContractRiskListPanel, {
            props: { ...basePropsCompleted },
        })
        await wrapper.find('[data-testid="download-trigger"]').trigger('click')
        await wrapper.find('[data-testid="download-mode-redline"]').trigger('click')
        const emitted = wrapper.emitted('download') ?? []
        expect(emitted.length).toBeGreaterThan(0)
        expect(emitted[emitted.length - 1]).toEqual(['redline'])
    })

    it('localStorage 持久化模式偏好', async () => {
        localStorage.setItem('contract-review-export-mode', 'both')
        const wrapper = mount(AssistantContractRiskListPanel, {
            props: { ...basePropsCompleted },
        })
        await wrapper.find('[data-testid="download-trigger"]').trigger('click')
        const checkedItem = wrapper.find('[data-testid="download-mode-both"][data-state="checked"]')
        expect(checkedItem.exists()).toBe(true)
    })
})
```

`basePropsCompleted` 是已有的 base props（`status='completed'`，`reviewedFileId` 非空），如不存在则按现有 RiskListPanel.test.ts 的写法构造。

- [ ] **Step 2：跑测试确认 fail**

Run: `npx vitest run tests/app/components/assistant/contract/RiskListPanel.test.ts -t '下载模式 toggle'`
Expected: FAIL — `download-trigger` 等 testid 不存在

- [ ] **Step 3：修改 `RiskListPanel.vue`**

把 line 580-593 的下载 Button 块替换为 DropdownMenu：

```vue
<DropdownMenu>
    <DropdownMenuTrigger as-child>
        <Button
            class="flex-1"
            :disabled="!canDownload || isDownloading"
            data-testid="download-trigger"
            :title="downloadButtonTitle"
        >
            <Loader2Icon v-if="isDownloading" class="size-4 mr-1 animate-spin" />
            <DownloadIcon v-else class="size-4 mr-1" />
            {{ downloadButtonLabel }}
            <ChevronDownIcon class="size-3 ml-1 opacity-60" />
        </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-56">
        <DropdownMenuLabel>导出模式</DropdownMenuLabel>
        <DropdownMenuRadioGroup
            :model-value="exportMode"
            @update:model-value="handleSelectMode"
        >
            <DropdownMenuRadioItem value="comment" data-testid="download-mode-comment">
                批注模式
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="redline" data-testid="download-mode-redline">
                修订模式（Track Changes）
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="both" data-testid="download-mode-both">
                两者并存
            </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
    </DropdownMenuContent>
</DropdownMenu>
```

并在 script 段顶部 import 块加：

```typescript
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from '~/components/ui/dropdown-menu'
import { useLocalStorage } from '@vueuse/core'
import type { ContractExportMode } from '#shared/types/contract'
```

emit 类型扩为：

```typescript
const emit = defineEmits<{
    download: [mode: ContractExportMode]
    // ... 其它不变
}>()
```

script 段追加：

```typescript
const exportMode = useLocalStorage<ContractExportMode>('contract-review-export-mode', 'comment')

function handleSelectMode(value: string | number) {
    const next = value as ContractExportMode
    exportMode.value = next
    emit('download', next)
}

const downloadButtonLabel = computed(() => {
    if (props.isDownloading) return '下载中...'
    if (props.previewVersionNumber !== null && props.previewVersionNumber !== undefined) {
        return `下载 v${props.previewVersionNumber} 历史版本`
    }
    return '下载批注 Word'
})

const downloadButtonTitle = computed(() => {
    return props.previewVersionNumber !== null && props.previewVersionNumber !== undefined
        ? `下载 v${props.previewVersionNumber} 历史版本（${exportModeLabel.value}）`
        : `下载当前工作区（${exportModeLabel.value}）`
})

const exportModeLabel = computed(() => ({
    comment: '批注模式',
    redline: '修订模式',
    both: '两者并存',
} satisfies Record<ContractExportMode, string>)[exportMode.value])
```

- [ ] **Step 4：跑测试确认 pass**

Run: `npx vitest run tests/app/components/assistant/contract/RiskListPanel.test.ts`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add app/components/assistant/contract/RiskListPanel.vue tests/app/components/assistant/contract/RiskListPanel.test.ts
git commit -m "feat(contract): 下载按钮改 DropdownMenu 三模式 toggle

PR6 §8.1：批注 / 修订 / 两者并存；模式偏好持久化到
localStorage:contract-review-export-mode。"
```

---

## Task 16：ContractReviewPanel 透传 mode

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`

- [ ] **Step 1：把 line 453 起 `handleDownload` 改造接受 mode**

```typescript
async function handleDownload(mode: ContractExportMode = 'comment') {
    if (isDownloading.value) return
    isDownloading.value = true
    try {
        const previewVid = versioning.previewVersionId.value
        if (previewVid === null) {
            await onDownload(mode)
            return
        }
        const url = `/api/v1/assistant/contract/reviews/versions/download/${previewVid}?mode=${mode}`
        const resp = await useApiFetch<{ downloadUrl: string; filename: string }>(
            url,
            { showError: false } as any,
        )
        if (!resp?.downloadUrl) {
            toast.error('历史版本下载失败，请稍后重试')
            return
        }
        try {
            const httpResp = await fetch(resp.downloadUrl)
            if (!httpResp.ok) throw new Error(`HTTP ${httpResp.status}`)
            triggerBrowserDownloadBlob(await httpResp.blob(), resp.filename)
        }
        catch {
            triggerBrowserDownloadUrl(resp.downloadUrl, resp.filename)
        }
    }
    finally {
        isDownloading.value = false
    }
}
```

并在文件顶部 import 加：
```typescript
import type { ContractExportMode } from '#shared/types/contract'
```

- [ ] **Step 2：模板中 emit 透传**

把两处 `@download="handleDownload"` 改为 `@download="(mode: ContractExportMode) => handleDownload(mode)"`（模板里类型注解写不出时直接 `@download="handleDownload"`，因为 emit 已类型化）。

- [ ] **Step 3：跑现有 ContractReviewPanel 测试**

Run: `npx vitest run tests/app/components/assistant/contract/ContractReviewPanel.test.ts tests/app/components/assistant/contract/ContractReviewPanel.phaseB.test.ts`
Expected: PASS

- [ ] **Step 4：commit**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue
git commit -m "feat(contract): handleDownload 透传 mode 到工作区/历史版本下载"
```

---

## Task 17：集成测试 + 文档

**Files:**
- Modify: `tests/server/assistant/contract/docx/redlineInjector.test.ts`（追加 round-trip）
- Modify: `docs/tech-docs/backend/contract.md`

- [ ] **Step 1：在 redlineInjector.test.ts 追加 round-trip 测试**

```typescript
describe('injectRedlineMarks · 完整 docx round-trip', () => {
    it('用 mammoth 解析含 ins/del 的输出 → 不抛错且 raw text 含 ins 内容', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await import('~~/server/agents/contract/docx/parser')
            .then(m => m.parseContractDocx(original))
        // 找 paragraphs[0] 的前 5 字作 quote
        const firstPara = paragraphs[0]!
        if (firstPara.length < 6) return // 样本过短就跳
        const result = await injectRedlineMarks(original, [{
            id: 1,
            clauseText: firstPara,
            clauseParagraphIndex: 0,
            problematicQuote: firstPara.slice(0, 5),
            quoteCharStart: 0,
            quoteCharEnd: 5,
            suggestedClauseText: 'XYZ',
        }], { reviewId: 999, idStart: 0 })
        expect(result.skippedRiskIds).toEqual([])
        const mammoth = await import('mammoth')
        const parsed = await mammoth.extractRawText({ buffer: result.buffer })
        // mammoth 会渲染 w:ins 内容，w:del 视为已删除不显示
        expect(parsed.value).toContain('XYZ')
        expect(parsed.value).not.toContain(firstPara.slice(0, 5))
    })
})
```

- [ ] **Step 2：跑 round-trip**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineInjector.test.ts -t 'round-trip'`
Expected: PASS

- [ ] **Step 3：在 `docs/tech-docs/backend/contract.md` 末尾追加章节**

```markdown
## 6. 导出模式（批注 / 修订 / 双模式）

### 6.1 三模式定义（PR6）

| 模式 | API mode | 用途 | OOXML 标签 |
|---|---|---|---|
| 批注模式 | `comment`（默认） | 律师/客户对话讨论阶段 | `<w:comment>` + `<w:commentRangeStart/End>` |
| 修订模式 | `redline` | 定稿前一轮，律师按 Track Changes 接受/拒绝改写 | `<w:ins>` / `<w:del>` |
| 两者并存 | `both` | 既要修订动作又要保留沟通气泡 | 上面两套并存，comment 包裹 del+ins 整体 |

入口：`RiskListPanel.vue` 底部下载按钮的 DropdownMenu，偏好持久化到 `localStorage:contract-review-export-mode`。

### 6.2 ID 协调（关键 · 不修会让 Word 拒打开）

OOXML `w:id` 在文档内是跨多种元素**共享**的 ID 池：bookmark / `<w:ins>` / `<w:del>` / `<w:rPrChange>` / `<w:pPrChange>` / `<w:commentRangeStart/End>` / `<w:commentReference>` / `<w:moveFromRangeStart>` 等。撞 ID → Word 报"文件已损坏"拒打开（macOS Preview 容忍但 Windows Word 严格）。

`server/agents/contract/docx/xmlAst.ts` 的 `findMaxSharedId` 扫所有此类标签返回最大值；`rebuildDocxService` 用 `findMaxSharedId(原 docx) + 1` 作为 `idStart` 喂给 `redlineInjector`，再用 `redlineInjector.nextIdAfter` 接力 `commentInjector` 的 `idStart` 参数。

### 6.3 跨 run 拆分保留 rPr

合同正文同一句话常跨多个 `<w:r>`（粗体的"违约金"在自己 run、普通字在另一 run）。`redlineInjector.splitRunAtOffset` 拆 run 时 deep-clone `<w:rPr>` 副本到两侧，quote 范围 run 把 `<w:t>` 替换为 `<w:delText>`（保留 `xml:space="preserve"`），整体 wrap 进 `<w:del>`。律师拒绝修订时原字体格式（粗体/字号/颜色）完整恢复。

### 6.4 整段删除段落标记同步

quote == 整段 `clauseText` 且 textContent 完全覆盖时，`addParagraphDeleteMark` 在 `<w:p><w:pPr><w:rPr>` 内追加 `<w:del/>` 子标记——律师"接受所有修订"会同时删段落标记不留空段。

### 6.5 已知不做

- "一键接受所有 AI 修订"按钮（v2）
- LLM 输出 `suggestedClauseText` 含 `\n` —— v1 schema reject 让 LLM 重生成；v2 再支持多段 `<w:p>` 插入
- redline 模式下 quote 失败 risk 的兜底走 comment fallback（spec §8.4 已实现）
```

- [ ] **Step 4：commit**

```bash
git add tests/server/assistant/contract/docx/redlineInjector.test.ts docs/tech-docs/backend/contract.md
git commit -m "docs(contract): 补充导出模式章节 + redlineInjector mammoth round-trip 测试"
```

---

## Task 18：Word 桌面版手动实测 + 全量 typecheck

**Files:** 无（手动验证）

- [ ] **Step 1：跑全量 typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2：跑全量后端测试**

Run: `bun run test:server 2>&1 | tail -40`
Expected: 全绿 / 仅 `KNOWN_FAILS.md` 列出的项

- [ ] **Step 3：跑全量前端测试**

Run: `bun run test:client 2>&1 | tail -40`
Expected: 全绿

- [ ] **Step 4：手动 e2e 实测**

启动 `bun dev`，登录测试账号 `13064768490 / daixin88`，路径 `/dashboard/assistant/contract`：

1. 上传 `prisma/seeds/contract-samples/labor.docx`，等审查完成
2. 风险清单底部点下载按钮 → 切到「批注模式」→ 下载 → Word 桌面版打开 → 验证侧边批注气泡正常 ✅
3. 切到「修订模式」→ 下载 → Word 打开 → 验证修订面板显示删除线 + 新增、可接受/拒绝 ✅
4. 切到「两者并存」→ 下载 → Word 打开 → 验证修订段也能悬停看到批注气泡 ✅
5. macOS Pages.app 也打开一份验证不报损坏（次要）

记录所有 Word 实测截图到 PR 描述。

- [ ] **Step 5：commit (无新代码改动) → 直接进入 PR**

如果实测发现 bug，回到对应 Task 修复后重测。

---

## PR 提交清单

提交 PR 前确认：

- [ ] 所有 Task 都打 ✅
- [ ] `bun run typecheck` 全绿
- [ ] `bun run test` 全绿（除 `tests/KNOWN_FAILS.md`）
- [ ] Word 桌面版（macOS + Windows）三模式实测 ✅
- [ ] Word "接受所有修订"后字体格式（粗体/字号/颜色）完整恢复 ✅
- [ ] both 模式下 redline + comment 的 `w:id` 不撞车（已由专项单测验证）
- [ ] PR 描述含 spec §11.6 摘要 + 实测截图

PR 标题（按项目 git 规范）：
```
feat(contract): PR6 · Track Changes 修订模式导出
```

PR body 模板：

```markdown
## Summary

- 后端新增 `redlineInjector` 在原 docx 写 OOXML Track Changes 标签
- `commentInjector` 改造接受 `idStart` 与 redlineInjector 共享 w:id 池
- 下载按钮改 DropdownMenu 三模式 toggle（批注 / 修订 / 双模式）

## Spec

`docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md` §8 + §11.6

## Test plan

- [x] xmlAst.findMaxSharedId 单测
- [x] commentInjector idStart / nextIdAfter 单测
- [x] riskSchema reject `\n` 单测
- [x] redlineLocate 定位算法 8 条用例
- [x] redlineInjector 装配（同段单 run / 跨 run / 跨段 / 整段删除）
- [x] rebuildDocxService 三模式协调
- [x] download API mode query
- [x] RiskListPanel DropdownMenu toggle + localStorage
- [x] mammoth round-trip 解析含 ins/del 的输出
- [x] Word 桌面版（macOS）三模式手测：批注气泡 / 修订面板接受拒绝 / 双模式并存
- [x] Word 桌面版（Windows）三模式手测（如有 Windows 环境）
```

---

## 已知风险与 mitigation

| 风险 | 来源 | mitigation |
|---|---|---|
| Word 拒打开（w:id 撞车） | spec §12 | findMaxSharedId 扫所有共享 ID 池标签 + 专项单测 |
| 律师拒绝修订后字体格式丢失 | spec §12 | splitRunAtOffset 拆 run 时 deep-clone rPr 副本到两侧；fixture 测试含 `<w:b/>` + `<w:color>` |
| OOXML 段落 textContent 与 clauseText 不一致 | 历史迁移残留 | redlineLocate 校验失败返回 null；调用方走 comment fallback |
| LLM 输出 suggestedClauseText 含 `\n` | spec §8.3.3 | risksSchema refine reject + prompt 端约束（v2 任务） |
| 历史版本 snapshot 不含 quote 字段 | snapshot 在 PR2 之后才有 quote | snapshot 中 risks 来自 ContractRiskEntity，PR2 起已包含；PR2 之前的版本 quote=null 自动 fallback comment |
| 下载并发：rebuilding 锁未释放 | 现有逻辑 | rebuildDocxService throw 时 `rollbackRebuildDAO` 已 catch（line 65-72，PR6 不动） |
