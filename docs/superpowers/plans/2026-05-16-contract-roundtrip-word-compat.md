# 合同审查回传识别 Word 兼容性修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让客户用 Microsoft Word 编辑保存过的合同 docx 回传时，LexSeek 仍能识别其中 AI 批注与修订的归属。

**Architecture:** 修复全部在回传解析端，导出端零改动。回传识别不再依赖会被 Word 改动的东西 —— 不靠固定路径找 customXml（改为按命名空间 URI 扫描），不靠 docx 内编号匹配批注（改为按正文内容匹配），修订识别在检测到 docx 被规范化重写时禁用 w:id 精确层、走正文比对。

**Tech Stack:** TypeScript / Nuxt Server / jszip / fast-xml-parser（经 `xmlAst` 封装）/ diff-match-patch（经 `textSimilarity` 封装）/ Vitest。

设计文档：`docs/superpowers/specs/2026-05-16-contract-roundtrip-word-compat-design.md`。

---

## 文件结构

**新增：**
- `server/agents/contract/docx/customXmlLocator.ts` — 按命名空间 URI 在 docx zip 内定位 LexSeek 的 customXml 身份证文件。
- `server/agents/contract/docx/commentContentMatch.ts` — 纯函数：把回传批注按正文内容匹配到系统批注。

**修改：**
- `server/agents/contract/docx/wordCommentParser.ts` — `readCustomXmlRefs` 改用定位器。
- `server/agents/contract/docx/redlineParser.ts` — `parseRedlineMarks` 改用定位器并返回 `trustWordIds`；`classifyRedlineDecision` 加 `trustWordIds` 入参；新增 `resolveFullCorpus`。
- `server/agents/contract/uploadClientVersion.service.ts` — 批注关联改用内容匹配；修订识别传 `trustWordIds` 并对 AMBIGUOUS 做全文兜底重判。

**测试：**
- `tests/server/assistant/contract/docx/customXmlLocator.test.ts`（新）
- `tests/server/assistant/contract/docx/commentContentMatch.test.ts`（新）
- `tests/server/assistant/contract/docx/wordCommentParser.test.ts`（追加）
- `tests/server/assistant/contract/docx/redlineParser.test.ts`（追加）
- `tests/server/assistant/contract/docx/fixtures/word-resaved-review3.docx`（新，真实 Word 重存 docx）
- `tests/server/assistant/contract/docx/wordCompatIntegration.test.ts`（新，真实 docx 回归）

---

## Task 1: customXml 定位器

**Files:**
- Create: `server/agents/contract/docx/customXmlLocator.ts`
- Test: `tests/server/assistant/contract/docx/customXmlLocator.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/assistant/contract/docx/customXmlLocator.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
    locateLexseekCustomXml,
    ANNOTATION_REFS_NS,
    REDLINE_REFS_NS,
} from '~~/server/agents/contract/docx/customXmlLocator'

describe('locateLexseekCustomXml', () => {
    it('原始路径的 annotationRefs → 命中，atOriginalPath=true', async () => {
        const zip = new JSZip()
        zip.file('word/customXml/annotationRefs.xml',
            `<lexseekAnnotationRefs xmlns="${ANNOTATION_REFS_NS}"><ref wId="0"/></lexseekAnnotationRefs>`)
        const r = await locateLexseekCustomXml(zip, ANNOTATION_REFS_NS, 'word/customXml/annotationRefs.xml')
        expect(r).not.toBeNull()
        expect(r!.path).toBe('word/customXml/annotationRefs.xml')
        expect(r!.atOriginalPath).toBe(true)
        expect(r!.xml).toContain('lexseekAnnotationRefs')
    })

    it('被 Word 改名移到包根的 redlineRefs → 命中，atOriginalPath=false', async () => {
        const zip = new JSZip()
        zip.file('customXml/item1.xml',
            `<lexseekRedlineRefs xmlns="${REDLINE_REFS_NS}"><ref riskId="1"/></lexseekRedlineRefs>`)
        zip.file('customXml/itemProps1.xml',
            `<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>`)
        const r = await locateLexseekCustomXml(zip, REDLINE_REFS_NS, 'word/customXml/redlineRefs.xml')
        expect(r).not.toBeNull()
        expect(r!.path).toBe('customXml/item1.xml')
        expect(r!.atOriginalPath).toBe(false)
    })

    it('docx 内无 LexSeek customXml → 返回 null', async () => {
        const zip = new JSZip()
        zip.file('customXml/item1.xml', `<foo xmlns="urn:other"/>`)
        const r = await locateLexseekCustomXml(zip, ANNOTATION_REFS_NS, 'word/customXml/annotationRefs.xml')
        expect(r).toBeNull()
    })

    it('Word 的 itemProps（customXml properties）不被误识别', async () => {
        const zip = new JSZip()
        zip.file('customXml/itemProps1.xml',
            `<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{GUID}"/>`)
        const r = await locateLexseekCustomXml(zip, REDLINE_REFS_NS, 'word/customXml/redlineRefs.xml')
        expect(r).toBeNull()
    })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/server/assistant/contract/docx/customXmlLocator.test.ts --reporter=verbose`
Expected: FAIL（`customXmlLocator` 模块不存在）。

- [ ] **Step 3: 实现定位器**

新建 `server/agents/contract/docx/customXmlLocator.ts`：

```typescript
/**
 * 在 docx zip 内按命名空间 URI 定位 LexSeek 写入的 customXml 身份证文件。
 *
 * 为什么不按固定路径找：LexSeek 导出时把身份证写在 word/customXml/xxx.xml，
 * 但 Microsoft Word 重新保存 docx 会按 OOXML 规范把 customXml part 移到包根
 * customXml/ 并改名为 item{N}.xml。固定路径查找失效。命名空间 URI 是 LexSeek
 * 专有、且 Word 不会改 customXml 文件内容，据此识别最稳。
 */
import type { DocxZip } from './zipRewriter'

/** 批注身份证（annotationRefs）根命名空间 */
export const ANNOTATION_REFS_NS = 'urn:lexseek:contract-review:v1'
/** 修订身份证（redlineRefs）根命名空间 */
export const REDLINE_REFS_NS = 'urn:lexseek:contract-review-redline:v1'

export interface LocatedCustomXml {
    /** customXml 文件的原始 XML 文本 */
    xml: string
    /** 在 zip 内的实际路径 */
    path: string
    /** 是否仍在 LexSeek 导出的原始路径（未被 Word 等工具规范化移动过） */
    atOriginalPath: boolean
}

/**
 * 遍历 docx zip 内所有 customXml part，返回命名空间 URI 匹配的第一个。
 *
 * @param zip          已 loadDocxZip 的 docx
 * @param namespaceUri LexSeek 专有命名空间 URI（见本文件常量）
 * @param originalPath LexSeek 导出时写入的原始路径，用于判定文件是否被移动过
 * @returns 命中返回 LocatedCustomXml；未命中返回 null
 */
export async function locateLexseekCustomXml(
    zip: DocxZip,
    namespaceUri: string,
    originalPath: string,
): Promise<LocatedCustomXml | null> {
    // 正则覆盖包根 customXml/ 与 word/customXml/ 两种位置
    const candidates = zip.file(/customXml\/[^/]*\.xml$/i)
    for (const file of candidates) {
        const xml = await file.async('string')
        // 命名空间 URI 是定值字符串，不随 Word 改文件名 / 加元素前缀而变
        if (xml.includes(namespaceUri)) {
            return { xml, path: file.name, atOriginalPath: file.name === originalPath }
        }
    }
    return null
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/server/assistant/contract/docx/customXmlLocator.test.ts --reporter=verbose`
Expected: PASS（4 个用例）。

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/agents/contract/docx/customXmlLocator.ts tests/server/assistant/contract/docx/customXmlLocator.test.ts
git commit -m "feat(contract): 新增 customXml 命名空间定位器"
```

---

## Task 2: wordCommentParser 改用定位器

**Files:**
- Modify: `server/agents/contract/docx/wordCommentParser.ts`
- Test: `tests/server/assistant/contract/docx/wordCommentParser.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `tests/server/assistant/contract/docx/wordCommentParser.test.ts` 末尾追加：

```typescript
describe('parseWordComments · Word 兼容性（customXml 被改名）', () => {
    it('customXml 被移到包根改名后，仍能解析出批注身份证', async () => {
        const original = await readFile(SAMPLE)
        const anns: ContractAnnotationForExport[] = [makeAnnotation({ id: 1, anchorParagraphIndex: 1 })]
        const { buffer } = await injectAnnotations(original, anns, 777)

        // 模拟 Word 重存：把 word/customXml/annotationRefs.xml 挪到包根 customXml/item9.xml
        const zip = await loadDocxZip(buffer)
        const moved = await zip.file('word/customXml/annotationRefs.xml')!.async('string')
        zip.remove('word/customXml/annotationRefs.xml')
        zip.file('customXml/item9.xml', moved)
        const resaved = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

        const { annotationRefsByWId } = await parseWordComments(resaved)
        expect(annotationRefsByWId.size).toBeGreaterThan(0)
        const entry = [...annotationRefsByWId.values()][0]!
        expect(entry.annotationId).toBe(1)
        expect(entry.reviewId).toBe(777)
    })
})
```

文件顶部 import 需补 `loadDocxZip`（来自 `~~/server/agents/contract/docx/zipRewriter`）—— 若已存在则跳过。

Run: `npx vitest run tests/server/assistant/contract/docx/wordCommentParser.test.ts --reporter=verbose`
Expected: FAIL（`readCustomXmlRefs` 写死 `word/customXml/annotationRefs.xml`，改名后读不到，`annotationRefsByWId` 为空）。

- [ ] **Step 2: 改 readCustomXmlRefs 用定位器**

`server/agents/contract/docx/wordCommentParser.ts`：

import 区追加：
```typescript
import { locateLexseekCustomXml, ANNOTATION_REFS_NS } from './customXmlLocator'
```

把现有 `readCustomXmlRefs` 函数整体替换为：

```typescript
/**
 * 读 LexSeek 批注身份证（annotationRefs）的 wId → {reviewId, annotationId} 映射。
 * 文件按命名空间定位（兼容 Word 改名）；不存在或损坏时返回空 Map，上层走内容匹配。
 */
async function readCustomXmlRefs(zip: JSZip): Promise<Map<number, AnnotationRefEntry>> {
    const result = new Map<number, AnnotationRefEntry>()
    const located = await locateLexseekCustomXml(zip, ANNOTATION_REFS_NS, 'word/customXml/annotationRefs.xml')
    if (!located) return result
    try {
        const ast = parseOoxml(located.xml)
        for (const node of findAll(ast, 'ref')) {
            const wIdStr = getAttr(node, 'wId')
            const annIdStr = getAttr(node, 'annotationId')
            const reviewIdStr = getAttr(node, 'reviewId')
            if (!wIdStr || !annIdStr || !reviewIdStr) continue
            const wId = parseInt(wIdStr, 10)
            const annotationId = parseInt(annIdStr, 10)
            const reviewId = parseInt(reviewIdStr, 10)
            if (isNaN(wId) || isNaN(annotationId) || isNaN(reviewId)) continue
            const rand = getAttr(node, 'rand') ?? ''
            result.set(wId, {
                reviewId,
                annotationId,
                source: 'customXml',
                ref: rand ? `LEXSEEK-${annotationId}-${rand}` : `LEXSEEK-${annotationId}`,
            })
        }
    } catch { /* 文件损坏，走 fallback */ }
    return result
}
```

> 与原实现唯一差别：取 XML 文本的来源从 `zip.file('word/customXml/annotationRefs.xml')` 改为 `locateLexseekCustomXml(...)`；解析逻辑一字不变。

- [ ] **Step 3: 运行测试，确认通过**

Run: `npx vitest run tests/server/assistant/contract/docx/wordCommentParser.test.ts --reporter=verbose`
Expected: PASS（含新追加用例与原有全部用例）。

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add server/agents/contract/docx/wordCommentParser.ts tests/server/assistant/contract/docx/wordCommentParser.test.ts
git commit -m "feat(contract): 批注身份证改用命名空间定位，兼容 Word 改名"
```

---

## Task 3: 批注内容匹配纯函数

**Files:**
- Create: `server/agents/contract/docx/commentContentMatch.ts`
- Test: `tests/server/assistant/contract/docx/commentContentMatch.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/assistant/contract/docx/commentContentMatch.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { matchCommentsToAnnotations } from '~~/server/agents/contract/docx/commentContentMatch'

const ANN_A = '【高风险】薪酬合规\n问题：试用期工资仅为转正后 50%，违反法定底线。'
const ANN_B = '【中风险】合同期限\n问题：3 年固定期限合同缺少到期续签预警机制。'

describe('matchCommentsToAnnotations', () => {
    it('exact：归一化后完全相等 → 命中', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: ANN_A }],
            [{ id: 100, content: ANN_A }, { id: 101, content: ANN_B }],
        )
        expect(r.get(5)).toBe(100)
    })

    it('换行被 Word 压成空格 → 归一化后仍 exact 命中', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: ANN_A.replace(/\n/g, ' ') }],
            [{ id: 100, content: ANN_A }],
        )
        expect(r.get(5)).toBe(100)
    })

    it('客户改了几个字 → fuzzy 命中', () => {
        const edited = ANN_A.replace('50%', '百分之五十')
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: edited }],
            [{ id: 100, content: ANN_A }, { id: 101, content: ANN_B }],
        )
        expect(r.get(5)).toBe(100)
    })

    it('内容与任何系统批注都不像 → 不命中', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: '客户自己新增的一句无关批注' }],
            [{ id: 100, content: ANN_A }, { id: 101, content: ANN_B }],
        )
        expect(r.has(5)).toBe(false)
    })

    it('两条系统批注内容完全相同 → exact 多命中，不匹配（避免错选）', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: ANN_A }],
            [{ id: 100, content: ANN_A }, { id: 101, content: ANN_A }],
        )
        expect(r.has(5)).toBe(false)
    })

    it('空 content → 跳过', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: '' }],
            [{ id: 100, content: ANN_A }],
        )
        expect(r.has(5)).toBe(false)
    })
})
```

Run: `npx vitest run tests/server/assistant/contract/docx/commentContentMatch.test.ts --reporter=verbose`
Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现内容匹配纯函数**

新建 `server/agents/contract/docx/commentContentMatch.ts`：

```typescript
/**
 * 把回传 docx 的批注按正文内容匹配到系统库的批注。
 *
 * 为什么不靠批注编号：Microsoft Word 重存 docx 会重排批注 w:id，导出时写入
 * 身份证的 wId 与回传 docx 实际编号对不上。批注正文内容 Word 不改（除非用户
 * 手动编辑），据此匹配最稳（spec §5）。
 */
import { normalizeForMatch, calcSimilarity } from '../utils/textSimilarity'

/** 参与匹配的回传批注（最小字段） */
export interface CommentForMatch {
    wId: number
    content: string
}

/** 参与匹配的系统批注（最小字段） */
export interface AnnotationForMatch {
    id: number
    content: string
}

/** 模糊匹配相似度阈值：低于此值不认定匹配 */
export const CONTENT_MATCH_FUZZY_THRESHOLD = 0.85
/** 模糊匹配时最高分与次高分的最小差距：拉不开则视为歧义，不匹配 */
export const CONTENT_MATCH_MIN_GAP = 0.05

/**
 * 把每条回传批注匹配到一条系统批注。
 *
 * 匹配口径（spec §5）：
 *  - 一级 exact：normalizeForMatch 归一化后完全相等（消除 Word 把换行压成空格等差异）。
 *  - 二级 fuzzy：无 exact 命中时，calcSimilarity 取最高分；分数 ≥ 阈值、且与次高分
 *    拉开 ≥ CONTENT_MATCH_MIN_GAP 才认定；否则视为歧义不匹配。
 *  - 用完整 content 比对（AI 批注通常数百字，唯一性强）。
 *
 * @returns Map<回传批注 wId, 命中的系统批注 id>；未命中的批注不在 Map 中。
 *          允许多条回传批注命中同一系统批注（由上层 collided 逻辑处理）。
 */
export function matchCommentsToAnnotations(
    comments: CommentForMatch[],
    annotations: AnnotationForMatch[],
): Map<number, number> {
    const annNorm = annotations.map(a => ({ id: a.id, norm: normalizeForMatch(a.content) }))
    const result = new Map<number, number>()
    for (const c of comments) {
        const cNorm = normalizeForMatch(c.content)
        if (!cNorm) continue
        // 一级：exact
        const exact = annNorm.filter(a => a.norm === cNorm)
        if (exact.length === 1) { result.set(c.wId, exact[0]!.id); continue }
        if (exact.length > 1) continue // 多条系统批注内容完全相同，无法区分
        // 二级：fuzzy
        let bestId = -1
        let bestScore = 0
        let runnerUp = 0
        for (const a of annNorm) {
            const s = calcSimilarity(cNorm, a.norm)
            if (s > bestScore) { runnerUp = bestScore; bestScore = s; bestId = a.id }
            else if (s > runnerUp) { runnerUp = s }
        }
        if (bestId !== -1 && bestScore >= CONTENT_MATCH_FUZZY_THRESHOLD
            && bestScore - runnerUp >= CONTENT_MATCH_MIN_GAP) {
            result.set(c.wId, bestId)
        }
    }
    return result
}
```

Run: `npx vitest run tests/server/assistant/contract/docx/commentContentMatch.test.ts --reporter=verbose`
Expected: PASS（6 个用例）。

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add server/agents/contract/docx/commentContentMatch.ts tests/server/assistant/contract/docx/commentContentMatch.test.ts
git commit -m "feat(contract): 新增批注内容匹配纯函数"
```

---

## Task 4: redlineParser 改用定位器 + classifyRedlineDecision 加可信开关

**Files:**
- Modify: `server/agents/contract/docx/redlineParser.ts`
- Test: `tests/server/assistant/contract/docx/redlineParser.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `tests/server/assistant/contract/docx/redlineParser.test.ts` 末尾追加：

```typescript
import { classifyRedlineDecision, resolveFullCorpus } from '~~/server/agents/contract/docx/redlineParser'
import { ClientRedlineDecision } from '#shared/types/contract'

describe('classifyRedlineDecision · trustWordIds 开关（spec §6）', () => {
    const ref = { riskId: 1, delIds: [10], insId: 11, paraIdxs: [0] }

    it('trustWordIds=true 且 del+ins 都存活 → 精确层判 UNTOUCHED', () => {
        const d = classifyRedlineDecision({
            ref, trustWordIds: true,
            survivingInsIds: new Set([11]), survivingDelIds: new Set([10]),
            corpusT: '双方按约担责', corpusDel: '甲方负全责',
            problematicQuote: '甲方负全责', suggestedClauseText: '双方按约担责',
        })
        expect(d).toBe(ClientRedlineDecision.UNTOUCHED)
    })

    it('trustWordIds=false → 跳过精确层，即便 id 碰巧存活也走正文比对', () => {
        // del/ins id 在存活集合里（模拟 Word 重排后碰巧命中），但 trustWordIds=false
        // → 不走精确层；正文里 corpusDel 含原文 → 正文层判 UNTOUCHED
        const d = classifyRedlineDecision({
            ref, trustWordIds: false,
            survivingInsIds: new Set([11]), survivingDelIds: new Set([10]),
            corpusT: '双方按约担责', corpusDel: '甲方负全责',
            problematicQuote: '甲方负全责', suggestedClauseText: '双方按约担责',
        })
        expect(d).toBe(ClientRedlineDecision.UNTOUCHED)
    })

    it('trustWordIds=false + 正文是新文本 → 正文层判 ACCEPTED', () => {
        const d = classifyRedlineDecision({
            ref, trustWordIds: false,
            survivingInsIds: new Set([11]), survivingDelIds: new Set([10]),
            corpusT: '双方按约担责', corpusDel: '',
            problematicQuote: '甲方负全责', suggestedClauseText: '双方按约担责',
        })
        expect(d).toBe(ClientRedlineDecision.ACCEPTED)
    })
})

describe('resolveFullCorpus', () => {
    it('拼接所有段落的归一化语料', () => {
        const parsed = {
            reviewId: 1, refs: [], survivingInsIds: new Set<number>(), survivingDelIds: new Set<number>(),
            trustWordIds: true,
            paragraphs: [
                { tNorm: '第一段', delNorm: '删一' },
                { tNorm: '第二段', delNorm: '删二' },
            ],
        }
        const r = resolveFullCorpus(parsed)
        expect(r.corpusT).toBe('第一段 第二段')
        expect(r.corpusDel).toBe('删一 删二')
    })
})
```

Run: `npx vitest run tests/server/assistant/contract/docx/redlineParser.test.ts --reporter=verbose`
Expected: FAIL（`classifyRedlineDecision` 无 `trustWordIds` 入参；`resolveFullCorpus` 未导出；`ParsedRedlineMarks` 无 `trustWordIds`）。

- [ ] **Step 2: 改 redlineParser.ts**

`server/agents/contract/docx/redlineParser.ts`：

(a) import 区追加：
```typescript
import { locateLexseekCustomXml, REDLINE_REFS_NS } from './customXmlLocator'
```

(b) `ParsedRedlineMarks` 接口加字段（放在 `paragraphs` 之后）：
```typescript
    /**
     * docx 内 w:id 是否可信。身份证文件在原始路径 = docx 未被 Word 等工具规范化
     * 重写过 = w:id 未被重排 = 可信；否则不可信，修订判定须跳过精确层。
     */
    trustWordIds: boolean
```

(c) `parseRedlineMarks` 整体替换为（核心改动：身份证文件用定位器找；返回 `trustWordIds`）：
```typescript
export async function parseRedlineMarks(docxBuffer: Buffer): Promise<ParsedRedlineMarks> {
    const empty = (): ParsedRedlineMarks => ({
        reviewId: null, refs: [], survivingInsIds: new Set(), survivingDelIds: new Set(),
        paragraphs: [], trustWordIds: true,
    })
    let zip: Awaited<ReturnType<typeof loadDocxZip>>
    try {
        zip = await loadDocxZip(docxBuffer)
    } catch {
        // docxBuffer 不是合法 docx zip：修订标记是回传识别的增强项而非核心，解析失败
        // 降级为空结果，由上层批注链路 + 安全保护兜底，不中止回传。
        return empty()
    }

    let reviewId: number | null = null
    const refs: RedlineRefEntry[] = []
    // 身份证文件按命名空间定位（兼容 Word 把 customXml 改名移位）
    const located = await locateLexseekCustomXml(zip, REDLINE_REFS_NS, 'word/customXml/redlineRefs.xml')
    // 文件不在原始路径 → docx 被 Word 等规范化重写过 → docx 内 w:id 不可信
    const trustWordIds = located ? located.atOriginalPath : true
    if (located) {
        try {
            const ast = parseOoxml(located.xml)
            const root = findFirst(ast, 'lexseekRedlineRefs')
            if (root) {
                const rid = parseInt(getAttr(root, 'reviewId') ?? '', 10)
                reviewId = Number.isFinite(rid) ? rid : null
            }
            for (const node of findAll(ast, 'ref')) {
                const riskId = parseInt(getAttr(node, 'riskId') ?? '', 10)
                const insId = parseInt(getAttr(node, 'insId') ?? '', 10)
                const parseIds = (attr: string) => (getAttr(node, attr) ?? '')
                    .split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n))
                const delIds = parseIds('delIds')
                const paraIdxs = parseIds('paraIdxs')
                if (Number.isFinite(riskId) && Number.isFinite(insId) && delIds.length > 0) {
                    refs.push({ riskId, delIds, insId, paraIdxs })
                }
            }
        } catch { /* 文件损坏 → 空 refs */ }
    }

    const survivingInsIds = new Set<number>()
    const survivingDelIds = new Set<number>()
    const paragraphs: RedlineParagraph[] = []
    const docFile = zip.file('word/document.xml')
    if (docFile) {
        const ast = parseOoxml(await docFile.async('string'))
        for (const n of findAll(ast, 'w:ins')) {
            const id = parseInt(getAttr(n, 'w:id') ?? '', 10)
            if (Number.isFinite(id)) survivingInsIds.add(id)
        }
        for (const n of findAll(ast, 'w:del')) {
            const id = parseInt(getAttr(n, 'w:id') ?? '', 10)
            if (Number.isFinite(id)) survivingDelIds.add(id)
        }
        for (const para of collectNonEmptyParagraphs(ast)) {
            let rawT = ''
            let rawDel = ''
            walk([para], (n) => {
                const tag = tagOf(n)
                if (tag === 'w:t') rawT += textOf(n)
                else if (tag === 'w:delText') rawDel += textOf(n)
            })
            paragraphs.push({ tNorm: normalizeForMatch(rawT), delNorm: normalizeForMatch(rawDel) })
        }
    }

    return { reviewId, refs, survivingInsIds, survivingDelIds, paragraphs, trustWordIds }
}
```

(d) `ClassifyRedlineInput` 接口加字段（放在 `suggestedClauseText` 之后）：
```typescript
    /** docx 内 w:id 是否可信（见 ParsedRedlineMarks.trustWordIds）；false 时跳过精确层 */
    trustWordIds: boolean
```

(e) `classifyRedlineDecision` 的精确层（Layer 1）用 `trustWordIds` 包裹。把函数体里 `// ===== Layer 1：w:id 精确层 =====` 那一整段替换为：
```typescript
    // ===== Layer 1：w:id 精确层（仅在 w:id 可信时启用）=====
    // docx 经 Word 等工具规范化重写后，w:id 被重排、新旧编号空间重叠，拿旧 id 去查
    // 会碰巧命中不相干修订 → 随机误判。trustWordIds=false 时必须跳过（spec §6）。
    if (trustWordIds) {
        const delAllAlive = ref.delIds.length > 0 && ref.delIds.every(id => survivingDelIds.has(id))
        const delNoneAlive = ref.delIds.every(id => !survivingDelIds.has(id))
        const insAlive = survivingInsIds.has(ref.insId)
        if (delAllAlive && insAlive) return ClientRedlineDecision.UNTOUCHED
        if (!(delNoneAlive && !insAlive)) return ClientRedlineDecision.AMBIGUOUS // 部分存活
    }
```
并把函数顶部解构里的 `const { ref, survivingInsIds, survivingDelIds, corpusT, corpusDel } = input` 改为加入 `trustWordIds`：
```typescript
    const { ref, survivingInsIds, survivingDelIds, corpusT, corpusDel, trustWordIds } = input
```

(f) 文件末尾追加 `resolveFullCorpus`：
```typescript
/**
 * 取全文语料（所有非空段落拼接），用于 paraIdxs 段落定位失准时的兜底重判（spec §6）。
 */
export function resolveFullCorpus(parsed: ParsedRedlineMarks): { corpusT: string; corpusDel: string } {
    return {
        corpusT: parsed.paragraphs.map(p => p.tNorm).join(' '),
        corpusDel: parsed.paragraphs.map(p => p.delNorm).join(' '),
    }
}
```

- [ ] **Step 3: 运行测试，确认通过**

既有用例 `redlineParser.test.ts` / `redlineParser.classify.test.ts` 调 `classifyRedlineDecision` 时未传 `trustWordIds` 会类型报错 —— 给这些既有调用补 `trustWordIds: true`（维持它们原本「精确层启用」的语义）。`redlineParser.classify.test.ts` 的 `run()` 辅助函数在传给 `classifyRedlineDecision` 的对象里加 `trustWordIds: true`。

Run: `npx vitest run tests/server/assistant/contract/docx/redlineParser.test.ts tests/server/assistant/contract/docx/redlineParser.classify.test.ts --reporter=verbose`
Expected: PASS。

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add server/agents/contract/docx/redlineParser.ts tests/server/assistant/contract/docx/redlineParser.test.ts tests/server/assistant/contract/docx/redlineParser.classify.test.ts
git commit -m "feat(contract): 修订身份证改用命名空间定位，w:id 不可信时禁用精确层"
```

---

## Task 5: uploadClientVersion 接入内容匹配与可信开关

**Files:**
- Modify: `server/agents/contract/uploadClientVersion.service.ts`
- Test: `tests/server/agents/contract/uploadClientVersion.service.test.ts`（既有用例回归）

- [ ] **Step 1: 改批注关联为内容匹配**

`server/agents/contract/uploadClientVersion.service.ts`：

(a) import 区追加：
```typescript
import { matchCommentsToAnnotations } from './docx/commentContentMatch'
```

(b) 定位「建 annotationId → ParsedWordComment 映射」前的位置（现 `const annById = new Map(...)` 之前），插入内容匹配：
```typescript
    // Word 兼容性（spec §5）：Word 重存 docx 会重排批注 w:id，导出时写入身份证的
    // wId 主键失效。改用正文内容把回传批注重新关联到系统批注。
    // annotationRefsByWId 的 value（reviewId / annotationId）不受 Word 影响，仍用于
    // 取「身份证声明的归属 review」做跨审查判定。
    const annRefEntries = [...annotationRefsByWId.values()]
    const declaredAnnReviewId = annRefEntries.length > 0 ? annRefEntries[0]!.reviewId : null
    const contentMatchByWId = matchCommentsToAnnotations(
        newComments.map(c => ({ wId: c.wId, content: c.content })),
        dbAnnotations.map(a => ({ id: a.id, content: a.content })),
    )
    // 重建 wId → {reviewId, annotationId}：annotationId 来自内容匹配，reviewId 取
    // 身份证文件声明值（跨审查时 ≠ review.id）。
    const commentRefByWId = new Map<number, { reviewId: number; annotationId: number }>()
    for (const [wId, annotationId] of contentMatchByWId) {
        commentRefByWId.set(wId, {
            reviewId: declaredAnnReviewId ?? review.id,
            annotationId,
        })
    }
```

(c) 把原批注匹配循环里 `const refFromMap = annotationRefsByWId.get(c.wId)` 改为：
```typescript
        const refFromMap = commentRefByWId.get(c.wId)
```
循环体其余逻辑（跨审查判定、`annById.has` 校验、collided、`commentByAnnId.set`）完全不变 —— `commentRefByWId` 的 value 结构与原 `AnnotationRefEntry` 在被用到的字段（`reviewId` / `annotationId`）上一致。

(d) 诊断快照 `snapshotSource`（现用 `annotationRefsByWId.get(c.wId)`）同步改为 `commentRefByWId.get(c.wId)`，使 `source` / `declaredReviewId` / `declaredAnnotationId` 反映内容匹配结果；`source` 字段值用字面量 `'content'`：
```typescript
    const snapshotSource = newComments.slice(0, SNAPSHOT_LIMIT).map(c => {
        const fromMap = commentRefByWId.get(c.wId)
        return {
            wId: c.wId,
            author: c.wAuthor,
            source: fromMap ? 'content' : null,
            declaredReviewId: fromMap?.reviewId ?? null,
            declaredAnnotationId: fromMap?.annotationId ?? null,
            contentPreview: (c.content ?? '').slice(0, 40),
        }
    })
    const parsedCount = newComments.filter(c => commentRefByWId.has(c.wId)).length
```

- [ ] **Step 2: 修订识别传 trustWordIds + AMBIGUOUS 全文兜底**

import 区追加（与现有 `redlineParser` import 合并）：
```typescript
import { resolveFullCorpus } from './docx/redlineParser'
```

把 Step 3b 的 `if (redlineUsable)` 块内、`for (const ref of rl.refs)` 循环体替换为：
```typescript
        for (const ref of rl.refs) {
            const risk = riskByIdForRedline.get(ref.riskId)
            if (!risk || !risk.problematicQuote || !risk.suggestedClauseText) continue
            const { corpusT, corpusDel } = resolveCorpusForRef(rl, ref)
            let decision = classifyRedlineDecision({
                ref,
                survivingInsIds: rl.survivingInsIds,
                survivingDelIds: rl.survivingDelIds,
                corpusT,
                corpusDel,
                problematicQuote: risk.problematicQuote,
                suggestedClauseText: risk.suggestedClauseText,
                trustWordIds: rl.trustWordIds,
            })
            // spec §6：按 paraIdxs 取的段落语料判不出（段落序号被 Word 增删段落漂移）
            // 时，用全文语料兜底重判一次。
            if (decision === ClientRedlineDecision.AMBIGUOUS) {
                const full = resolveFullCorpus(rl)
                decision = classifyRedlineDecision({
                    ref,
                    survivingInsIds: rl.survivingInsIds,
                    survivingDelIds: rl.survivingDelIds,
                    corpusT: full.corpusT,
                    corpusDel: full.corpusDel,
                    problematicQuote: risk.problematicQuote,
                    suggestedClauseText: risk.suggestedClauseText,
                    trustWordIds: rl.trustWordIds,
                })
            }
            redlineDecisions.set(ref.riskId, decision)
            redlineCounts[decision]++
        }
```

- [ ] **Step 3: 运行既有测试，回归确认**

`uploadClientVersion.service.test.ts` 既有用例 mock 了 `parseWordComments`，部分用例靠 `annotationRefsByWId` 的 wId 命中来验证批注匹配。改用 content 匹配后，这些用例的 mock 需调整：mock 的 `comments` 的 `content` 要与 mock 的 `dbAnnotations`（`findMany` mock 返回）的 `content` 一致，content 匹配才命中。逐个用例核对：凡断言「批注命中 / external 升级 / collided」的，把 mock comment 的 `content` 设为与目标 annotation 的 `content` 相同（命中）或不同（不命中），使断言成立。

Run: `npx vitest run tests/server/agents/contract/uploadClientVersion.service.test.ts tests/server/assistant/contract/uploadClientVersion.redline.test.ts --reporter=verbose`
Expected: PASS（既有用例按上述调整 mock 后全绿）。

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add server/agents/contract/uploadClientVersion.service.ts tests/server/agents/contract/uploadClientVersion.service.test.ts tests/server/assistant/contract/uploadClientVersion.redline.test.ts
git commit -m "feat(contract): 回传链路批注改内容匹配、修订传 w:id 可信开关"
```

---

## Task 6: 真实 Word 重存 docx 回归测试

**Files:**
- Create: `tests/server/assistant/contract/docx/fixtures/word-resaved-review3.docx`
- Create: `tests/server/assistant/contract/docx/wordCompatIntegration.test.ts`

- [ ] **Step 1: 放入真实 fixture**

把诊断阶段确认的真实「被 Word 重存过的回传 docx」复制为 fixture：
```bash
mkdir -p tests/server/assistant/contract/docx/fixtures
cp /Users/daixin/Downloads/劳动合同_v1_2026-05-16.docx tests/server/assistant/contract/docx/fixtures/word-resaved-review3.docx
```
该 docx 特征（已实测）：customXml 身份证被 Word 移到包根 `customXml/item1.xml`(redlineRefs，17 条 ref)、`item2.xml`(annotationRefs，5 条 ref)；批注与修订 w:id 均被重排。

- [ ] **Step 2: 写回归测试**

新建 `tests/server/assistant/contract/docx/wordCompatIntegration.test.ts`：

```typescript
/**
 * Word 兼容性回归测试：用真实「被 Word 重存过的回传 docx」验证回传解析端
 * 能定位被改名的 customXml 身份证、并正确标记 w:id 不可信。
 *
 * 防回归目标：杜绝再次写死 word/customXml/xxx.xml 固定路径。
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseWordComments } from '~~/server/agents/contract/docx/wordCommentParser'
import { parseRedlineMarks } from '~~/server/agents/contract/docx/redlineParser'

const FIXTURE = join(__dirname, 'fixtures/word-resaved-review3.docx')

describe('Word 兼容性 · 真实重存 docx', () => {
    it('parseWordComments 能定位被 Word 改名的批注身份证', async () => {
        const buf = await readFile(FIXTURE)
        const { comments, annotationRefsByWId } = await parseWordComments(buf)
        expect(comments.length).toBe(5)
        // customXml 被 Word 改名到包根，定位器仍能找到 → annotationRefsByWId 非空
        expect(annotationRefsByWId.size).toBe(5)
        const entry = [...annotationRefsByWId.values()][0]!
        expect(entry.reviewId).toBe(3)
    })

    it('parseRedlineMarks 能定位被改名的修订身份证，且标记 w:id 不可信', async () => {
        const buf = await readFile(FIXTURE)
        const parsed = await parseRedlineMarks(buf)
        expect(parsed.refs.length).toBe(17)
        expect(parsed.reviewId).toBe(3)
        // 身份证文件已被 Word 移出原始路径 → trustWordIds 必须为 false
        expect(parsed.trustWordIds).toBe(false)
    })
})
```

Run: `npx vitest run tests/server/assistant/contract/docx/wordCompatIntegration.test.ts --reporter=verbose`
Expected: PASS（2 个用例）。

- [ ] **Step 3: Commit**

```bash
git add tests/server/assistant/contract/docx/fixtures/word-resaved-review3.docx tests/server/assistant/contract/docx/wordCompatIntegration.test.ts
git commit -m "test(contract): 真实 Word 重存 docx 回归测试"
```

---

## Task 7: 全量回归 + 文档同步

**Files:**
- Modify: `docs/tech-docs/backend/contract.md`

- [ ] **Step 1: 全量测试**

Run: `bun run test`
Expected: 本功能相关测试全绿；失败项仅限本功能未触碰的既有问题（参见 `tests/KNOWN_FAILS.md` 与并行 dashboard 工作引入项）。

- [ ] **Step 2: 补文档**

在 `docs/tech-docs/backend/contract.md` 的「修订版回传识别」一节补一段「Word 兼容性」说明：customXml 身份证按命名空间 URI 定位（不靠路径）、批注按内容匹配（不靠 w:id）、修订在 docx 被规范化重写时禁用精确层走正文比对。控制在 15 行内。

- [ ] **Step 3: Commit**

```bash
git add docs/tech-docs/backend/contract.md
git commit -m "docs(contract): 补充回传识别 Word 兼容性说明"
```

---

## 自查

- **Spec 覆盖**：spec §4 层 1 → Task 1+2+4；§5 层 2 → Task 3+5；§6 层 3 → Task 4+5；§7 跨审查 → Task 5（`declaredAnnReviewId`）；§9 测试 → Task 6；§8 改动范围全部命中。
- **类型一致**：`LocatedCustomXml`、`trustWordIds`、`matchCommentsToAnnotations` 返回 `Map<number,number>`、`ClassifyRedlineInput.trustWordIds`、`resolveFullCorpus` 在各 Task 间签名一致。
- **导出端零改动**：确认无任何 Task 改 `commentInjector` / `redlineInjector` / `customXmlRegistrar`。
