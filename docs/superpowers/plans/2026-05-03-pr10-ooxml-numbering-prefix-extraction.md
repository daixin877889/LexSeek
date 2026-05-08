# PR10 OOXML numbering 提取拼接子项编号 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 docx 上传合同审查无法定位子项段落的 bug — 让 `parseContractDocx` 解析 `word/numbering.xml` 给 list item 段落拼接「1. 」「（一）」等前缀，让 `segmentClauses` 切到子项粒度；同时扩展 `ClauseSegment` 契约新增 `textWithoutNumber` 字段，让下游 anchor 锚点不带编号字符规避 redlineInjector 严格等值校验失败。

**Architecture:** 采用方案 D（OCP 扩展契约）：(1) 新建 `numbering.ts` 解析 OOXML numbering 渲染段落前缀；(2) 修改 `parser.ts` 在拼前缀前强制走 AST 路径保证 prefixMap 与 paragraphs 同源；(3) 扩展 `ClauseSegment` / `ClauseSnapshotItem` 加 `textWithoutNumber` 字段（OCP，原字段不变）；(4) 在 risk 落库时复用 `contractRisk.service.ts:98` 现有「双锚点·层 1」机制，注入 `row.clauseText = segment.textWithoutNumber` 覆盖 LLM 自填的含编号 clauseText。`redlineInjector` / `commentInjector` / `reviewResultPersistence` 全部零改动。

**Tech Stack:** TypeScript / Nuxt 4 Server / Vitest / mammoth 1.11 / JSZip / fast-xml-parser（项目已封装为 `xmlAst.ts`）

**Spec:** `docs/superpowers/specs/2026-05-03-pr10-ooxml-numbering-prefix-extraction-design.md`

---

## File Structure

**新建文件**：
- `server/agents/contract/docx/numbering.ts` — OOXML numbering 解析 + 段落前缀渲染（核心逻辑，预计 ~250 行）
- `tests/server/assistant/contract/docx/numbering.test.ts` — numbering.ts 单元测试

**修改文件**：
- `shared/types/contract.ts:358` / `:453` — 扩展 `ClauseSegment` + `ClauseSnapshotItem` 加 `textWithoutNumber` + `offsetStartWithoutNumber` 字段
- `server/agents/contract/docx/clauseSegmenter.ts:230-249` — 切分时填充 `textWithoutNumber`
- `server/agents/contract/docx/parser.ts` — 集成 numbering.ts，prefixMap 非空时强制走 AST
- `server/agents/contract/uploadClientVersion.service.ts:174-179` — snapshot 写入携带 `textWithoutNumber`
- `server/agents/contract/uploadClientVersion.service.ts:561, 576` — 增量审查 risk 落库注入 `clause.textWithoutNumber`
- `server/services/workflow/agents/contractReviewMainAgent.ts:123-127` — 首次审查 risk 落库注入 `segment.textWithoutNumber`
- `tests/server/assistant/contract/docx/clauseSegmenter.test.ts` — 加 `textWithoutNumber` 验证 case
- `tests/server/assistant/contract/docx/parser.test.ts` — 加 numbering 集成 case
- `tests/server/assistant/contract/contractRisk.service.test.ts` — 加 row.clauseText 注入 case

---

## Task 1: 扩展 ClauseSegment / ClauseSnapshotItem 契约（OCP）

**Files:**
- Modify: `shared/types/contract.ts:358-369`（ClauseSegment）
- Modify: `shared/types/contract.ts:453-458`（ClauseSnapshotItem）

- [ ] **Step 1: 修改 ClauseSegment 类型定义**

修改 `shared/types/contract.ts:358-369`，加 `textWithoutNumber` + `offsetStartWithoutNumber` 字段：

```ts
/**
 * 条款切分结果（仅在 workflow 内存中流转，不落库）
 */
export interface ClauseSegment {
    /** 顺序号，从 1 开始 */
    index: number
    /** 条款编号文本，如 "3.2"、"第五条"、null（无标号散段） */
    number: string | null
    /** 条款正文（含编号字符；保持向后兼容，prompt 模板从此字段取 clauseTextRaw） */
    text: string
    /**
     * PR10 新增：条款正文（不含编号字符；anchor 锚定专用）。
     * 用途：redlineInjector / commentInjector 在 OOXML <w:p> 上做严格行级匹配时，
     * OOXML textContent 永远不含 numbering 前缀（Word 渲染时动态生成），
     * 必须用此字段而非 text 才能严格等值匹配。
     */
    textWithoutNumber: string
    /** Phase B：该条款在 docxText 中的起始字符偏移（闭区间） */
    offsetStart: number
    /** Phase B：该条款在 docxText 中的结束字符偏移（开区间，即 offsetStart + text.length） */
    offsetEnd: number
    /** PR10 新增：textWithoutNumber 在 docxText 中的起始字符偏移（= offsetStart + 编号字符长度） */
    offsetStartWithoutNumber: number
}
```

- [ ] **Step 2: 修改 ClauseSnapshotItem 类型定义**

修改 `shared/types/contract.ts:453-458`，同步加字段（持久化到 snapshot.clauses）。**新字段标 optional**——旧 snapshot 数据没有这俩字段，标 optional 让 PR10 之前生成的 review 仍能正常读：

```ts
export interface ClauseSnapshotItem {
    index: number
    text: string
    /**
     * PR10 新增（optional）：与 ClauseSegment.textWithoutNumber 同源。
     * 历史 snapshot 数据无此字段；使用方应 fallback 到 text（含编号）。
     * Phase A 兜底重切（uploadClientVersion.service.ts:215-219）会填值。
     */
    textWithoutNumber?: string
    offsetStart: number
    offsetEnd: number
    /** PR10 新增（optional）：理由同上 */
    offsetStartWithoutNumber?: number
}
```

> 决策：`ClauseSegment` 新字段为 required（新生成数据必填），`ClauseSnapshotItem` 新字段为 optional（兼容旧 snapshot）。

- [ ] **Step 3: 运行类型检查确认无回归**

Run: `npx nuxi typecheck 2>&1 | grep -E "ClauseSegment|ClauseSnapshotItem|textWithoutNumber" | head -30`

Expected: 出现引用 `ClauseSegment` / `ClauseSnapshotItem` 但未填充新字段的位置（clauseSegmenter.ts / uploadClientVersion.service.ts / contractReviewMainAgent.ts），后续任务会逐一修复。

> **重要**：本步骤会出现编译错误，是预期的——Task 2 / Task 10 / Task 11 / Task 12 会逐一修复。在完成所有任务前不要尝试单独修复这些类型错误，否则会破坏 TDD 节奏。

- [ ] **Step 4: 提交契约扩展**

```bash
git add shared/types/contract.ts
git commit -m "feat(contract): 扩展 ClauseSegment / ClauseSnapshotItem 加 textWithoutNumber 字段（PR10 OCP 扩展契约）"
```

---

## Task 2: clauseSegmenter 填充新字段（TDD）

**Files:**
- Modify: `server/agents/contract/docx/clauseSegmenter.ts:230-249`
- Test: `tests/server/assistant/contract/docx/clauseSegmenter.test.ts`

- [ ] **Step 1: 写失败测试 — 单数字「1.」编号剥前缀**

在 `tests/server/assistant/contract/docx/clauseSegmenter.test.ts` 末尾添加（用现有 describe block 的 `segmentClausesByRegex`）：

```ts
describe('PR10 textWithoutNumber 填充', () => {
    it('单数字「1. 合同期限」剥编号字符', () => {
        const text = '1. 合同期限：本合同期限为 3 年\n2. 试用期：2 个月'
        const r = segmentClausesByRegex(text)
        expect(r.segments).toHaveLength(2)
        const s1 = r.segments[0]!
        expect(s1.text).toBe('1. 合同期限：本合同期限为 3 年')
        expect(s1.textWithoutNumber).toBe('合同期限：本合同期限为 3 年')
        expect(s1.offsetStartWithoutNumber).toBe(s1.offsetStart + 3)  // "1. " 占 3 字符
    })

    it('「第一条」剥编号字符', () => {
        const text = '第一条 总则\n第二条 双方义务'
        const r = segmentClausesByRegex(text)
        expect(r.segments).toHaveLength(2)
        const s1 = r.segments[0]!
        expect(s1.number).toBe('第一条')
        expect(s1.textWithoutNumber).toBe('总则')
    })

    it('「一、」剥编号字符', () => {
        const text = '一、双方义务\n二、违约责任'
        const r = segmentClausesByRegex(text)
        expect(r.segments).toHaveLength(2)
        const s1 = r.segments[0]!
        expect(s1.textWithoutNumber).toBe('双方义务')
    })

    it('多级「3.1」剥编号字符', () => {
        const text = '第三条 工作时间\n3.1 标准工时\n3.2 加班规则'
        const r = segmentClausesByRegex(text)
        const sub = r.segments.find(s => s.number === '3.1')
        expect(sub).toBeDefined()
        expect(sub!.textWithoutNumber).toBe('标准工时')
    })

    it('无编号 segment（fallback 散段）：textWithoutNumber === text', () => {
        // segmentClausesByRegex 命中 0 时不切；测试用前置编号逼出散段
        const text = '1. xxx\n散段无编号正文也归到此 segment\n2. yyy'
        const r = segmentClausesByRegex(text)
        const s1 = r.segments[0]!
        // s1.text 跨多行，textWithoutNumber 仅剥行首 "1. "
        expect(s1.textWithoutNumber.startsWith('xxx')).toBe(true)
        expect(s1.textWithoutNumber).not.toMatch(/^1\./)
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/docx/clauseSegmenter.test.ts -t "PR10 textWithoutNumber" --reporter=verbose`

Expected: 5 个测试全部 FAIL（提示 `segment.textWithoutNumber` undefined / `segment.offsetStartWithoutNumber` undefined）

- [ ] **Step 3: 实施 — 修改 clauseSegmenter.ts:230-249**

把 `server/agents/contract/docx/clauseSegmenter.ts` 第 228-249 行的循环改为：

```ts
    // 按行号切分：每个 match 到下一个 match 之前（或文末）的所有行拼起来作为 text
    const segments: ClauseSegment[] = []
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i]!.lineIdx
        const end = i + 1 < matches.length ? matches[i + 1]!.lineIdx : lines.length
        const raw = lines.slice(start, end).join('\n')
        const text = raw.trim()
        if (!text) continue

        // raw 在 normalizedText 中的起始位置
        const rawStart = lineStarts[start]!
        // trim() 可能截掉 raw 头部空白，offsetStart 是 raw 内 text 的起始相对位移
        const trimOffset = raw.indexOf(text)
        const offsetStart = rawStart + trimOffset

        // PR10：剥行首编号字符填 textWithoutNumber + offsetStartWithoutNumber
        const number = matches[i]!.number
        let textWithoutNumber = text
        let skippedLen = 0
        if (number && text.startsWith(number)) {
            const afterNumber = text.slice(number.length).replace(/^\s+/, '')
            skippedLen = text.length - afterNumber.length
            textWithoutNumber = afterNumber
        }

        segments.push({
            index: segments.length + 1,
            number,
            text,
            textWithoutNumber,
            offsetStart,
            offsetEnd: offsetStart + text.length,
            offsetStartWithoutNumber: offsetStart + skippedLen,
        })
    }
    return { segments, normalizedText }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/docx/clauseSegmenter.test.ts -t "PR10 textWithoutNumber" --reporter=verbose`

Expected: 5 个测试全部 PASS

- [ ] **Step 5: 运行 clauseSegmenter 现有所有测试确保无回归**

Run: `npx vitest run tests/server/assistant/contract/docx/clauseSegmenter.test.ts --reporter=verbose`

Expected: 既有 PR9 + 现状测试全部 PASS

- [ ] **Step 6: Commit**

```bash
git add server/agents/contract/docx/clauseSegmenter.ts tests/server/assistant/contract/docx/clauseSegmenter.test.ts
git commit -m "feat(contract): clauseSegmenter 填充 textWithoutNumber + offsetStartWithoutNumber（PR10 GREEN）"
```

---

## Task 3: numbering.ts 骨架（空函数 + 类型导出）

**Files:**
- Create: `server/agents/contract/docx/numbering.ts`
- Create: `tests/server/assistant/contract/docx/numbering.test.ts`

- [ ] **Step 1: 写最小失败测试 — 无 numberingXml 返回空 Map**

新建 `tests/server/assistant/contract/docx/numbering.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { buildNumberingPrefixMap } from '~~/server/agents/contract/docx/numbering'

describe('numbering · buildNumberingPrefixMap', () => {
    it('numbering.xml 缺失返回空 Map', () => {
        const docXml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>'
        const result = buildNumberingPrefixMap(docXml, null)
        expect(result.size).toBe(0)
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts --reporter=verbose`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 numbering.ts 骨架**

新建 `server/agents/contract/docx/numbering.ts`：

```ts
import {
    parseOoxml,
    walk,
    findFirst,
    findAll,
    getAttr,
    tagOf,
    paragraphText,
    hasRunChild,
    type NodeArray,
} from './xmlAst'
import { logger } from '#shared/utils/logger'

/** 段落索引 → 已渲染前缀字符串（含尾部空格） */
export type NumberingPrefixMap = Map<number, string>

interface LvlConfig {
    numFmt: string
    lvlText: string
    start: number
}

interface AbstractNum {
    levels: Map<number, LvlConfig>
}

interface NumberingDef {
    numIdMap: Map<number, number>
    abstractNums: Map<number, AbstractNum>
}

/**
 * 解析 OOXML numbering.xml + document.xml，返回每个 list item 段落的渲染前缀。
 *
 * paraIndex 与 paragraphsFromAst 输出同口径（深度优先遍历 <w:p>，含表格内段落，
 * 仅过滤 hasRunChild=false 与 trim().length=0）。调用方必须保证最终
 * applyPrefixMap 的 paragraphs 列表与本函数 paraIndex 同源（见 parser.ts 改造）。
 *
 * 支持 numFmt：decimal / chineseCounting / chineseLegalSimplified /
 * decimalEnclosedCircle / lowerLetter / upperLetter / lowerRoman / upperRoman。
 * bullet 显式 skip（拼字符会污染原文且 segmentClauses 不识别）。
 * 未识别 numFmt / 空 lvlText 走 fallback：跳过该段 + logger.warn 计数。
 *
 * @param documentXml word/document.xml 全文
 * @param numberingXml word/numbering.xml 全文（不存在时传 null）
 * @returns 段落索引 → 前缀字符串的 Map（不在 list 内 / bullet / 未识别格式 的段落不出现）
 */
export function buildNumberingPrefixMap(
    documentXml: string,
    numberingXml: string | null,
): NumberingPrefixMap {
    const prefixMap = new Map<number, string>()
    if (!numberingXml) return prefixMap
    // 后续 Task 4-8 实现
    return prefixMap
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts --reporter=verbose`

Expected: PASS（1 passed）

- [ ] **Step 5: Commit**

```bash
git add server/agents/contract/docx/numbering.ts tests/server/assistant/contract/docx/numbering.test.ts
git commit -m "feat(contract): numbering.ts 骨架 + 类型导出（PR10 RED→GREEN）"
```

---

## Task 4: parseNumberingXml 实现

**Files:**
- Modify: `server/agents/contract/docx/numbering.ts`
- Modify: `tests/server/assistant/contract/docx/numbering.test.ts`

- [ ] **Step 1: 写失败测试 — parseNumberingXml 解析 abstractNum + numIdMap**

在 `tests/server/assistant/contract/docx/numbering.test.ts` 添加（注：`parseNumberingXml` 是模块内部函数，本测试用 fixture 通过 `buildNumberingPrefixMap` 间接验证）：

```ts
const NUMBERING_XML_SIMPLE_DECIMAL = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0">
            <w:start w:val="1"/>
            <w:numFmt w:val="decimal"/>
            <w:lvlText w:val="%1."/>
        </w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`

const DOC_XML_TWO_DECIMAL_PARAS = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>合同期限</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>试用期</w:t></w:r></w:p>
    </w:body>
</w:document>`

it('numbering.xml 解析失败时不应抛错（容错）', () => {
    const result = buildNumberingPrefixMap('<w:document xmlns:w="x"><w:body/></w:document>', '<bad>not valid</bad>')
    expect(result.size).toBe(0)
})

it('numId → abstractNumId → lvl 配置 解析正确（间接通过 buildNumberingPrefixMap 验证）', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, NUMBERING_XML_SIMPLE_DECIMAL)
    // Task 5 完整实现后才能 PASS；这里先期待 size 0（骨架没渲染逻辑）
    // 实际验证留给 Task 5 — 此测试 Task 4 阶段会 SKIP
    expect(result).toBeInstanceOf(Map)
})
```

> 说明：此 Task 主要是补 parseNumberingXml 内部解析逻辑，行为通过 Task 5 的端到端用例验证。本步骤先保持容错性（第一个 it），完整渲染验证移到 Task 5。

- [ ] **Step 2: 实施 — 在 numbering.ts 加 parseNumberingXml 内部函数**

在 `server/agents/contract/docx/numbering.ts` 现有 `buildNumberingPrefixMap` 上方插入：

```ts
function parseNumberingXml(numberingXml: string): NumberingDef | null {
    let ast: NodeArray
    try {
        ast = parseOoxml(numberingXml)
    } catch (err) {
        logger.warn('[numbering] numbering.xml 解析失败，降级为空 NumberingDef', { err })
        return null
    }

    const numIdMap = new Map<number, number>()
    const abstractNums = new Map<number, AbstractNum>()

    // 解析 <w:num> → numId → abstractNumId 映射
    for (const numNode of findAll(ast, 'w:num')) {
        const numIdStr = getAttr(numNode, 'w:numId')
        if (!numIdStr) continue
        const numId = parseInt(numIdStr, 10)
        if (Number.isNaN(numId)) continue
        const refNode = findFirst([numNode], 'w:abstractNumId')
        if (!refNode) continue
        const refStr = getAttr(refNode, 'w:val')
        const ref = refStr ? parseInt(refStr, 10) : NaN
        if (Number.isNaN(ref)) continue
        numIdMap.set(numId, ref)
    }

    // 解析 <w:abstractNum> → abstractNumId → AbstractNum
    for (const abstractNumNode of findAll(ast, 'w:abstractNum')) {
        const idStr = getAttr(abstractNumNode, 'w:abstractNumId')
        if (!idStr) continue
        const id = parseInt(idStr, 10)
        if (Number.isNaN(id)) continue

        const levels = new Map<number, LvlConfig>()
        for (const lvlNode of findAll([abstractNumNode], 'w:lvl')) {
            const ilvlStr = getAttr(lvlNode, 'w:ilvl')
            if (!ilvlStr) continue
            const ilvl = parseInt(ilvlStr, 10)
            if (Number.isNaN(ilvl)) continue

            const numFmtNode = findFirst([lvlNode], 'w:numFmt')
            const lvlTextNode = findFirst([lvlNode], 'w:lvlText')
            const startNode = findFirst([lvlNode], 'w:start')

            const numFmt = numFmtNode ? (getAttr(numFmtNode, 'w:val') ?? 'decimal') : 'decimal'
            const lvlText = lvlTextNode ? (getAttr(lvlTextNode, 'w:val') ?? '') : ''
            // Word 实际渲染：start 缺省按 1（与 ECMA-376 字面默认 0 不同；生产合同几乎都显式写 1）
            const start = startNode ? parseInt(getAttr(startNode, 'w:val') ?? '1', 10) : 1

            levels.set(ilvl, { numFmt, lvlText, start: Number.isNaN(start) ? 1 : start })
        }
        abstractNums.set(id, { levels })
    }

    return { numIdMap, abstractNums }
}
```

修改 `buildNumberingPrefixMap` 使其调用 `parseNumberingXml` 但不渲染（Task 5 补）：

```ts
export function buildNumberingPrefixMap(
    documentXml: string,
    numberingXml: string | null,
): NumberingPrefixMap {
    const prefixMap = new Map<number, string>()
    if (!numberingXml) return prefixMap

    const numbering = parseNumberingXml(numberingXml)
    if (!numbering) return prefixMap

    // Task 5-8 在此基础上实现段落遍历 + 渲染
    return prefixMap
}
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts --reporter=verbose`

Expected: 全部 PASS（容错测试 + size 是 Map 实例的弱断言）

- [ ] **Step 4: Commit**

```bash
git add server/agents/contract/docx/numbering.ts tests/server/assistant/contract/docx/numbering.test.ts
git commit -m "feat(contract): numbering.ts parseNumberingXml 实现 abstractNum/numId 解析（PR10）"
```

---

## Task 5: buildNumberingPrefixMap 主体（decimal 单层 ilvl=0 渲染）

**Files:**
- Modify: `server/agents/contract/docx/numbering.ts`
- Modify: `tests/server/assistant/contract/docx/numbering.test.ts`

- [ ] **Step 1: 写失败测试 — decimal "%1." 渲染连续 1./2./3.**

在 `tests/server/assistant/contract/docx/numbering.test.ts` 添加：

```ts
it('decimal "%1." ilvl=0 连续渲染 1. → 2.', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, NUMBERING_XML_SIMPLE_DECIMAL)
    expect(result.size).toBe(2)
    expect(result.get(0)).toBe('1. ')   // 注意尾部空格
    expect(result.get(1)).toBe('2. ')
})

it('非 list 段落不进 prefixMap', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
        <w:p><w:r><w:t>普通段落无 numPr</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>条款 A</w:t></w:r></w:p>
        <w:p><w:r><w:t>另一段普通段落</w:t></w:r></w:p>
    </w:body>
</w:document>`
    const result = buildNumberingPrefixMap(docXml, NUMBERING_XML_SIMPLE_DECIMAL)
    expect(result.size).toBe(1)
    expect(result.get(1)).toBe('1. ')   // 第 2 段（index=1）才有前缀
})

it('w:start val="3" 从 3. 开始', () => {
    const numberingXml = NUMBERING_XML_SIMPLE_DECIMAL.replace('w:start w:val="1"', 'w:start w:val="3"')
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, numberingXml)
    expect(result.get(0)).toBe('3. ')
    expect(result.get(1)).toBe('4. ')
})

it('numId 引用不存在 abstractNumId 跳过段落', () => {
    const numberingXml = NUMBERING_XML_SIMPLE_DECIMAL.replace('w:abstractNumId w:val="0"', 'w:abstractNumId w:val="999"')
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, numberingXml)
    expect(result.size).toBe(0)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts --reporter=verbose`

Expected: 4 个新增 case FAIL（prefixMap 还是 0 size 或 get 返回 undefined）

- [ ] **Step 3: 实施 — buildNumberingPrefixMap 主体遍历 + decimal 渲染**

修改 `server/agents/contract/docx/numbering.ts` 的 `buildNumberingPrefixMap`：

```ts
export function buildNumberingPrefixMap(
    documentXml: string,
    numberingXml: string | null,
): NumberingPrefixMap {
    const prefixMap = new Map<number, string>()
    if (!numberingXml) return prefixMap

    const numbering = parseNumberingXml(numberingXml)
    if (!numbering) return prefixMap

    let docAst: NodeArray
    try {
        docAst = parseOoxml(documentXml)
    } catch (err) {
        logger.warn('[numbering] document.xml 解析失败，降级为空 prefixMap', { err })
        return prefixMap
    }

    /** key = `${numId}:${ilvl}`，value = 当前已渲染数（首次见时取 start）*/
    const counters = new Map<string, number>()
    let paraIndex = -1

    walk(docAst, (node) => {
        if (tagOf(node) !== 'w:p') return
        // 与 paragraphsFromAst 严格同口径：先过滤无 <w:r> 的"空段落"，再 trim 二次过滤
        if (!hasRunChild(node)) return
        const text = paragraphText(node).trim()
        if (text.length === 0) return
        paraIndex++

        // findFirst 接收 NodeArray，传 [node] 让深度优先 walk 进入子树
        const numPr = findFirst([node], 'w:numPr')
        if (!numPr) return

        const numIdNode = findFirst([numPr], 'w:numId')
        const ilvlNode = findFirst([numPr], 'w:ilvl')
        if (!numIdNode) return

        const numIdStr = getAttr(numIdNode, 'w:val')
        const numId = numIdStr ? parseInt(numIdStr, 10) : NaN
        const ilvl = ilvlNode ? parseInt(getAttr(ilvlNode, 'w:val') ?? '0', 10) : 0
        if (Number.isNaN(numId)) return

        const abstractNumId = numbering.numIdMap.get(numId)
        if (abstractNumId == null) {
            logger.warn('[numbering] numId 引用不存在', { numId, paraIndex })
            return
        }
        const abstractNum = numbering.abstractNums.get(abstractNumId)
        if (!abstractNum) {
            logger.warn('[numbering] abstractNum 不存在', { abstractNumId, paraIndex })
            return
        }
        const lvl = abstractNum.levels.get(ilvl)
        if (!lvl) {
            logger.warn('[numbering] ilvl 不存在', { numId, ilvl, paraIndex })
            return
        }

        // counter ++ 或首次取 start
        const counterKey = `${numId}:${ilvl}`
        const currentCount = counters.has(counterKey)
            ? counters.get(counterKey)! + 1
            : lvl.start
        counters.set(counterKey, currentCount)

        // 渲染前缀（Task 6-8 会扩展支持更多 numFmt）
        const prefix = renderLvlText(lvl, abstractNum, counters, numId, ilvl)
        if (prefix !== null) {
            prefixMap.set(paraIndex, prefix + ' ')
        }
    })

    return prefixMap
}

/**
 * 把 lvlText 模板（含 %1 %2 ...）替换为各级 counter 的渲染值。
 * 返回 null 表示未识别 numFmt / 空 lvlText / 渲染后空白 → 跳过该段。
 *
 * 注意：OOXML ECMA-376 §17.9.13 lvlText.val 规定「除 %<digit> 外全部按字面量输出」，
 * 不存在 %% 转义概念。renderNumber 输出仅含数字/中文/字母/罗马字符。
 */
function renderLvlText(
    lvl: LvlConfig,
    abstractNum: AbstractNum,
    counters: Map<string, number>,
    numId: number,
    currentIlvl: number,
): string | null {
    if (lvl.lvlText.length === 0) return null

    let result = lvl.lvlText
    // 倒序替换避免 %10 被 %1 拦截
    for (let i = currentIlvl + 1; i >= 1; i--) {
        const targetIlvl = i - 1
        const targetLvl = abstractNum.levels.get(targetIlvl)
        if (!targetLvl) continue
        const count = counters.get(`${numId}:${targetIlvl}`) ?? targetLvl.start
        const rendered = renderNumber(targetLvl.numFmt, count)
        if (rendered === null) {
            logger.warn('[numbering] 未识别 numFmt，跳过段落', { numFmt: targetLvl.numFmt, numId, ilvl: targetIlvl })
            return null
        }
        result = result.replace(new RegExp(`%${i}`, 'g'), rendered)
    }

    if (result.trim().length === 0) return null
    return result
}

/** 把数字渲染成对应 numFmt 的字符串。未识别格式返回 null。Task 6 会扩展。*/
function renderNumber(numFmt: string, n: number): string | null {
    switch (numFmt) {
        case 'decimal': return String(n)
        default:
            return null
    }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts --reporter=verbose`

Expected: 全部 PASS（含 decimal / 非 list 段过滤 / w:start / numId 不存在）

- [ ] **Step 5: Commit**

```bash
git add server/agents/contract/docx/numbering.ts tests/server/assistant/contract/docx/numbering.test.ts
git commit -m "feat(contract): numbering.ts decimal 单层渲染 + 段落遍历（PR10）"
```

---

## Task 6: 完整 numFmt 渲染表（chineseCounting / chineseLegal / Circle / Letter / Roman）

**Files:**
- Modify: `server/agents/contract/docx/numbering.ts`
- Modify: `tests/server/assistant/contract/docx/numbering.test.ts`

- [ ] **Step 1: 写失败测试 — 8 种 numFmt 渲染**

在 `tests/server/assistant/contract/docx/numbering.test.ts` 添加（用模板字符串构造 fixture 工厂）：

```ts
function makeNumberingXml(numFmt: string, lvlText: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0">
            <w:start w:val="1"/>
            <w:numFmt w:val="${numFmt}"/>
            <w:lvlText w:val="${lvlText}"/>
        </w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`
}

it('chineseCounting "%1、" 渲染一、二、三、', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('chineseCounting', '%1、'))
    expect(result.get(0)).toBe('一、 ')
    expect(result.get(1)).toBe('二、 ')
})

it('chineseLegalSimplified "%1、" 渲染壹、贰、', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('chineseLegalSimplified', '%1、'))
    expect(result.get(0)).toBe('壹、 ')
    expect(result.get(1)).toBe('贰、 ')
})

it('decimalEnclosedCircle "%1" 渲染 ① ②', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('decimalEnclosedCircle', '%1'))
    expect(result.get(0)).toBe('① ')
    expect(result.get(1)).toBe('② ')
})

it('lowerLetter "%1." 渲染 a. b.', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('lowerLetter', '%1.'))
    expect(result.get(0)).toBe('a. ')
    expect(result.get(1)).toBe('b. ')
})

it('upperLetter "%1." 渲染 A. B.', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('upperLetter', '%1.'))
    expect(result.get(0)).toBe('A. ')
    expect(result.get(1)).toBe('B. ')
})

it('lowerRoman "%1." 渲染 i. ii.', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('lowerRoman', '%1.'))
    expect(result.get(0)).toBe('i. ')
    expect(result.get(1)).toBe('ii. ')
})

it('upperRoman "%1." 渲染 I. II.', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('upperRoman', '%1.'))
    expect(result.get(0)).toBe('I. ')
    expect(result.get(1)).toBe('II. ')
})

it('decimal "（%1）" 渲染（1）（2）', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('decimal', '（%1）'))
    expect(result.get(0)).toBe('（1） ')
    expect(result.get(1)).toBe('（2） ')
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts -t "chineseCounting|chineseLegal|Circle|Letter|Roman|（" --reporter=verbose`

Expected: 8 个新 case FAIL（renderNumber 只支持 decimal，其他返回 null → prefixMap 跳过）

- [ ] **Step 3: 实施 — 扩展 renderNumber + 加辅助函数**

替换 `server/agents/contract/docx/numbering.ts` 的 `renderNumber` 函数 + 在文件末尾追加 5 个辅助函数：

```ts
function renderNumber(numFmt: string, n: number): string | null {
    switch (numFmt) {
        case 'decimal': return String(n)
        case 'chineseCounting': return cnNum(n)
        case 'chineseLegalSimplified': return cnLegalNum(n)
        case 'decimalEnclosedCircle': return circledNum(n)
        case 'lowerLetter': return letterNum(n, false)
        case 'upperLetter': return letterNum(n, true)
        case 'lowerRoman': return romanNum(n, false)
        case 'upperRoman': return romanNum(n, true)
        default:
            return null
    }
}

function cnNum(n: number): string {
    const digits = '〇一二三四五六七八九'
    if (n < 10) return digits[n]!
    if (n < 20) return n === 10 ? '十' : '十' + digits[n - 10]!
    if (n < 100) {
        const tens = Math.floor(n / 10), ones = n % 10
        return digits[tens]! + '十' + (ones === 0 ? '' : digits[ones]!)
    }
    return String(n)  // 100+ fallback 阿拉伯数字（合同子项不会超 100）
}

function cnLegalNum(n: number): string {
    const digits = '零壹贰叁肆伍陆柒捌玖'
    if (n < 10) return digits[n]!
    if (n < 20) return n === 10 ? '拾' : '拾' + digits[n - 10]!
    if (n < 100) {
        const tens = Math.floor(n / 10), ones = n % 10
        return digits[tens]! + '拾' + (ones === 0 ? '' : digits[ones]!)
    }
    return String(n)
}

function circledNum(n: number): string {
    if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1)  // ①..⑳
    if (n >= 21 && n <= 35) return String.fromCharCode(0x3251 + n - 21)
    return String(n)
}

function letterNum(n: number, upper: boolean): string {
    const base = upper ? 'A'.charCodeAt(0) : 'a'.charCodeAt(0)
    return String.fromCharCode(base + (n - 1))
}

function romanNum(n: number, upper: boolean): string {
    const lower = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
                   'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx']
    const s = lower[n - 1] ?? String(n)
    return upper ? s.toUpperCase() : s
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts --reporter=verbose`

Expected: 全部 PASS（含 8 种 numFmt + 之前的 decimal / 非 list 段 / start / 错 numId）

- [ ] **Step 5: Commit**

```bash
git add server/agents/contract/docx/numbering.ts tests/server/assistant/contract/docx/numbering.test.ts
git commit -m "feat(contract): numbering.ts 扩展 8 种 numFmt 渲染（chineseCounting / chineseLegal / Circle / Letter / Roman）"
```

---

## Task 7: bullet skip + 空 lvlText skip + 未识别 numFmt skip

**Files:**
- Modify: `server/agents/contract/docx/numbering.ts`
- Modify: `tests/server/assistant/contract/docx/numbering.test.ts`

- [ ] **Step 1: 写失败测试 — 三种 skip 场景**

在 `tests/server/assistant/contract/docx/numbering.test.ts` 添加：

```ts
it('bullet 段落跳过不写入 prefixMap（避免拼 "￮" 污染原文）', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('bullet', '￮'))
    expect(result.size).toBe(0)
})

it('空 lvlText 跳过段落（避免拼单空格污染原文）', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('decimal', ''))
    expect(result.size).toBe(0)
})

it('未识别 numFmt（如 hindiNumbers）跳过段落', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, makeNumberingXml('hindiNumbers', '%1.'))
    expect(result.size).toBe(0)
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts -t "bullet|空 lvlText|未识别" --reporter=verbose`

Expected: 至少 bullet 那条 FAIL（当前会拼 "￮ "）；空 lvlText / hindi 因 renderLvlText 返回 null 应该已经 PASS（验证一下逻辑）

- [ ] **Step 3: 实施 — 在 buildNumberingPrefixMap 加 bullet skip 分支**

在 `server/agents/contract/docx/numbering.ts` 的 walk 回调内，`const lvl = abstractNum.levels.get(ilvl)` 之后、counter ++ 之前，加：

```ts
        // bullet 显式 skip：拼 "￮" "•" 会污染原文且 segmentClauses 不识别为编号
        if (lvl.numFmt === 'bullet') {
            logger.info('[numbering] bullet 段落跳过不拼前缀', { numId, ilvl, paraIndex })
            return
        }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts --reporter=verbose`

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/contract/docx/numbering.ts tests/server/assistant/contract/docx/numbering.test.ts
git commit -m "feat(contract): numbering.ts 加 bullet/空 lvlText/未识别 numFmt skip 分支"
```

---

## Task 8: 多层嵌套 + 父级++子级 reset

**Files:**
- Modify: `server/agents/contract/docx/numbering.ts`
- Modify: `tests/server/assistant/contract/docx/numbering.test.ts`

- [ ] **Step 1: 写失败测试 — ilvl=1 多层 lvlText "%1.%2"**

在 `tests/server/assistant/contract/docx/numbering.test.ts` 添加：

```ts
const NUMBERING_XML_TWO_LEVELS = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0">
            <w:start w:val="1"/>
            <w:numFmt w:val="decimal"/>
            <w:lvlText w:val="%1."/>
        </w:lvl>
        <w:lvl w:ilvl="1">
            <w:start w:val="1"/>
            <w:numFmt w:val="decimal"/>
            <w:lvlText w:val="%1.%2"/>
        </w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`

const DOC_XML_TWO_LEVEL_PARAS = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>父项 A</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>子项 1</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>子项 2</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>父项 B</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>子项 1</w:t></w:r></w:p>
    </w:body>
</w:document>`

it('多层嵌套 ilvl=1 lvlText="%1.%2" 父级 ++ 时子级 reset', () => {
    const result = buildNumberingPrefixMap(DOC_XML_TWO_LEVEL_PARAS, NUMBERING_XML_TWO_LEVELS)
    expect(result.get(0)).toBe('1. ')      // 父项 A
    expect(result.get(1)).toBe('1.1 ')     // 子项 1
    expect(result.get(2)).toBe('1.2 ')     // 子项 2
    expect(result.get(3)).toBe('2. ')      // 父项 B
    expect(result.get(4)).toBe('2.1 ')     // 子项 1（不是 1.3，验证子级 reset）
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts -t "多层嵌套" --reporter=verbose`

Expected: FAIL — 当前没有子级 reset 逻辑，子项 1 渲染出 "1.3" 而不是 "2.1"

- [ ] **Step 3: 实施 — counter 维护时加子级 reset**

在 `server/agents/contract/docx/numbering.ts` 的 walk 回调内，`counters.set(counterKey, currentCount)` 之后，加：

```ts
        // 子层级 reset 子层 counter（OOXML 规则：父级 ++ 时子级归零）
        // 实施：删除子层 counter，下次见时按 start 重启
        for (const [k] of counters) {
            const [kNumId, kIlvlStr] = k.split(':')
            if (kNumId === String(numId) && parseInt(kIlvlStr!, 10) > ilvl) {
                counters.delete(k)
            }
        }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/docx/numbering.test.ts --reporter=verbose`

Expected: 全部 PASS（含多层嵌套 reset + 之前所有 case）

- [ ] **Step 5: Commit**

```bash
git add server/agents/contract/docx/numbering.ts tests/server/assistant/contract/docx/numbering.test.ts
git commit -m "feat(contract): numbering.ts 多层嵌套 ilvl 父级 ++ 子级 reset"
```

---

## Task 9: parser.ts 改造（含表格索引修复）

**Files:**
- Modify: `server/agents/contract/docx/parser.ts`
- Modify: `tests/server/assistant/contract/docx/parser.test.ts`

> **注意**：项目 `prisma/seeds/contract-samples/*.docx` 全部 5 个 fixture 都**不含 `<w:numPr>` 引用**（实测 grep `<w:numPr>` 全部 0 命中）——它们的 numbering.xml 只是 Word 模板样板。因此 PR10 的 e2e 测试**必须用 JSZip 合成最小 docx**，不能依赖现有 fixture。

- [ ] **Step 1: 写失败测试 — parseContractDocx 用合成 docx fixture 验证拼前缀**

在 `tests/server/assistant/contract/docx/parser.test.ts` 末尾加：

```ts
import JSZip from 'jszip'

/**
 * PR10 测试 helper：合成最小 docx Buffer（含 numbering.xml 引用 decimal numId=1）。
 * 返回的 buffer 可直接喂给 parseContractDocx。
 *
 * 关键部件：[Content_Types].xml + _rels/.rels + word/document.xml + word/numbering.xml
 * + word/_rels/document.xml.rels（让 numbering.xml 被 documentXml 关联）
 */
async function buildMinimalDocxWithDecimalNumbering(paragraphTexts: string[]): Promise<Buffer> {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`)
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`)
    const paraXml = paragraphTexts.map(t => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>${paraXml}</w:body>
</w:document>`)
    zip.file('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0">
            <w:start w:val="1"/>
            <w:numFmt w:val="decimal"/>
            <w:lvlText w:val="%1."/>
        </w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`)
    return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

describe('PR10 numbering 前缀拼接', () => {
    it('parseContractDocx 给 list 段落拼接 decimal 前缀', async () => {
        const buffer = await buildMinimalDocxWithDecimalNumbering([
            '合同期限：本合同期限为 3 年',
            '试用期：2 个月',
            '工资：每月 10000 元',
        ])
        const { paragraphs } = await parseContractDocx(buffer)

        // PR10 关键验证：3 段全部以 "1. " "2. " "3. " 开头
        expect(paragraphs.length).toBe(3)
        expect(paragraphs[0]).toMatch(/^1\.\s/)
        expect(paragraphs[1]).toMatch(/^2\.\s/)
        expect(paragraphs[2]).toMatch(/^3\.\s/)
        expect(paragraphs[0]).toContain('合同期限')
    })

    it('无 numbering.xml 的 docx 不拼前缀', async () => {
        // 用现有 labor.docx —— 实测无 numPr 引用，prefixMap 应为空
        const fixturePath = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')
        const buffer = readFileSync(fixturePath)
        const { paragraphs } = await parseContractDocx(buffer)
        // 无前缀拼接，paragraphs 仍是原 mammoth 输出（PR10 之前的行为）
        expect(paragraphs.length).toBeGreaterThan(0)
    })
})
```

> 注：`__dirname` 路径 `../../../../../` 是从 `tests/server/assistant/contract/docx/` 回到项目根的 5 层 — 与同目录 `parser.test.ts` 现有 fixture 路径风格一致。实施时如有偏差用 `node:path` 调整层级。

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/docx/parser.test.ts -t "PR10 numbering" --reporter=verbose`

Expected: FAIL — 第一条 case 段落仍是原文（mammoth 不输出 numbering），不以 "1. " 开头

- [ ] **Step 3: 实施 — parser.ts 改造**

修改 `server/agents/contract/docx/parser.ts` 的 `parseContractDocx` 函数（替换整个函数体）：

```ts
import { buildNumberingPrefixMap, type NumberingPrefixMap } from './numbering'

async function readNumberingXmlOrNull(zip: DocxZip): Promise<string | null> {
    const file = zip.file('word/numbering.xml')
    if (!file) return null
    return file.async('string')
}

function applyPrefixMap(paragraphs: string[], prefixMap: NumberingPrefixMap): string[] {
    return paragraphs.map((p, i) => {
        const prefix = prefixMap.get(i)
        return prefix ? prefix + p : p
    })
}

export async function parseContractDocx(buffer: Buffer): Promise<ParsedContract> {
    const zip = await loadDocxZip(buffer)
    const rawXml = await readTextFromZip(zip, 'word/document.xml')
    const numberingXml = await readNumberingXmlOrNull(zip)

    // prefixMap 与 paragraphsFromAst 同口径（深度优先遍历 <w:p>，含表格内段落）
    const prefixMap = buildNumberingPrefixMap(rawXml, numberingXml)

    // mammoth 快速路径
    const { value: rawText } = await mammoth.extractRawText({ buffer })
    let paragraphs = splitParagraphs(rawText)
    const astParagraphs = paragraphsFromAst(rawXml)

    // 表格索引修复（PR10 维度 5 E3）：
    // mammoth.extractRawText 跳过 <w:tbl> 单元格段落，buildNumberingPrefixMap 走全树。
    // 当合同含表格但 mammoth 段数 ≥ 60% AST 时（DOCX-H4 fallback 不触发），
    // 直接 applyPrefixMap(mammoth 段落) 会把前缀错位拼到非 list 段落 → 必须强制走 AST。
    if (prefixMap.size > 0) {
        // 含 numbering 的合同必须走 AST，保证段落索引与 prefixMap 同源
        paragraphs = applyPrefixMap(astParagraphs, prefixMap)
    }
    else {
        // 无 numbering（普通粘贴 docx）走原有 DOCX-H4 fallback 逻辑
        if (
            astParagraphs.length > paragraphs.length
            && (astParagraphs.length === 0
                || paragraphs.length / astParagraphs.length < TABLE_FALLBACK_RATIO)
        ) {
            paragraphs = astParagraphs
        }
    }

    return { paragraphs, rawXml }
}
```

> 注意：`DocxZip` 类型需要从 `./zipRewriter` import 或 inline 类型；如果当前 parser.ts 没有 import，加上 `import type { DocxZip } from './zipRewriter'`（或直接用 `JSZip` 类型）。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/docx/parser.test.ts --reporter=verbose`

Expected: 全部 PASS（含 PR10 新加 + 既有所有 parser test）

- [ ] **Step 5: Commit**

```bash
git add server/agents/contract/docx/parser.ts tests/server/assistant/contract/docx/parser.test.ts
git commit -m "feat(contract): parser.ts 集成 numbering 前缀拼接 + 表格索引修复（PR10 GREEN）"
```

---

## Task 10: uploadClientVersion 写 snapshot 携带 textWithoutNumber

**Files:**
- Modify: `server/agents/contract/uploadClientVersion.service.ts:174-179` 主路径
- Modify: `server/agents/contract/uploadClientVersion.service.ts:215-219` Phase A 兜底重切路径

- [ ] **Step 1: 主路径 — 修改 line 174-179 写 newClauses**

修改 `server/agents/contract/uploadClientVersion.service.ts:174-179`，把：

```ts
            newClauses = segments.map((s) => ({
                index: s.index,
                text: s.text,
                offsetStart: s.offsetStart,
                offsetEnd: s.offsetEnd,
            }))
```

改为：

```ts
            newClauses = segments.map((s) => ({
                index: s.index,
                text: s.text,
                textWithoutNumber: s.textWithoutNumber,
                offsetStart: s.offsetStart,
                offsetEnd: s.offsetEnd,
                offsetStartWithoutNumber: s.offsetStartWithoutNumber,
            }))
```

- [ ] **Step 2: Phase A 兜底重切路径 — 修改 line 215-219 写 oldClauses**

修改 `server/agents/contract/uploadClientVersion.service.ts:215-219`，把：

```ts
                oldClauses = segments.map(s => ({
                    index: s.index, text: s.text,
                    offsetStart: s.offsetStart, offsetEnd: s.offsetEnd,
                }))
```

改为：

```ts
                oldClauses = segments.map(s => ({
                    index: s.index,
                    text: s.text,
                    textWithoutNumber: s.textWithoutNumber,
                    offsetStart: s.offsetStart,
                    offsetEnd: s.offsetEnd,
                    offsetStartWithoutNumber: s.offsetStartWithoutNumber,
                }))
```

> 关键：Task 11 注入 row.clauseText 时会读 `clause.textWithoutNumber`，如果是历史 snapshot 读出（无该字段）→ undefined → 走 `?? clause.text` fallback。Phase A 兜底重切走 segmentClauses 重新切分后能填上新字段。两条路径都覆盖。

- [ ] **Step 3: 类型检查兜底**

Run: `npx nuxi typecheck 2>&1 | grep -E "uploadClientVersion|ClauseSnapshotItem|textWithoutNumber" | head -30`

Expected: uploadClientVersion 文件内不再有 ClauseSnapshotItem 缺字段错误。

- [ ] **Step 4: Commit**

```bash
git add server/agents/contract/uploadClientVersion.service.ts
git commit -m "feat(contract): uploadClientVersion snapshot 写入携带 textWithoutNumber（PR10 主路径+兜底）"
```

---

## Task 11: uploadClientVersion 增量审查注入 row.clauseText

**Files:**
- Modify: `server/agents/contract/uploadClientVersion.service.ts:494-501`（**关键** — `clause` 是新构造的 ClauseSegment，必须透传新字段）
- Modify: `server/agents/contract/uploadClientVersion.service.ts:561, 576`

> 🚨 **CRITICAL**：`uploadClientVersion.service.ts:494-501` 把 `newClauses[m.newIndex]`（ClauseSnapshotItem）转构造为 `ClauseSegment` 字面量给下游用。Task 1 后 ClauseSegment 加了 required 字段 `textWithoutNumber` + `offsetStartWithoutNumber`，**必须在此处透传**，否则：
> 1. TS 编译失败（required 字段缺失）
> 2. 即使 TS 通过，line 561/576 的 `clause.textWithoutNumber ?? clause.text` 永远 fallback 到 `item.text`（含编号）→ 增量审查 anchor 修复完全失效

- [ ] **Step 1: 修改 line 494-501 透传新字段**

定位 `server/agents/contract/uploadClientVersion.service.ts:494-501`，把：

```ts
const item = newClauses[m.newIndex]!
const clause: ClauseSegment = {
    index: item.index, number: null,
    text: item.text,
    offsetStart: item.offsetStart, offsetEnd: item.offsetEnd,
}
```

改为：

```ts
const item = newClauses[m.newIndex]!
const clause: ClauseSegment = {
    index: item.index, number: null,
    text: item.text,
    // PR10：从 ClauseSnapshotItem（optional 字段，旧 snapshot 可能无）兜底到 text
    textWithoutNumber: item.textWithoutNumber ?? item.text,
    offsetStart: item.offsetStart, offsetEnd: item.offsetEnd,
    offsetStartWithoutNumber: item.offsetStartWithoutNumber ?? item.offsetStart,
}
```

> 实施时用 grep 找文件里所有 `const clause: ClauseSegment = {` 字面量构造点，每处都补字段（防 grep 遗漏：可能不止 1 处）。

- [ ] **Step 2: 实施 — 修改 line 561 和 576 的 clauseText 注入**

定位 `server/agents/contract/uploadClientVersion.service.ts` 中两处 `clauseText: clause.text`：

第 561 行附近（"修改条款"分支，update existing risk）：
```ts
                            clauseText: clause.text,
```
改为：
```ts
                            // PR10 方案 D：用不含编号字符的文本作 anchor，规避 redlineInjector 严格匹配失败
                            // ?? clause.text 是 ClauseSnapshotItem.textWithoutNumber 的 optional 字段 fallback
                            clauseText: clause.textWithoutNumber ?? clause.text,
```

第 576 行附近（"新增条款"分支，create new risk via persistAiRisksAsContractRows）：
```ts
                        clauseText: clause.text,
```
改为：
```ts
                        // PR10 方案 D：理由同上
                        clauseText: clause.textWithoutNumber ?? clause.text,
```

> 注意：line 561 与 line 576 的 `clause` 是 Step 1 在 line 494-501 重新构造的 `ClauseSegment`（不是 ClauseSnapshotItem 本体）。Step 1 已把 `textWithoutNumber` 透传进 clause，此处直接用即可。

- [ ] **Step 3: 类型检查 + 跑相关单测**

Run: `npx nuxi typecheck 2>&1 | grep uploadClientVersion | head -10`

Expected: 无错误（Step 1 已经把 ClauseSegment 字面量构造点的 required 字段补齐）。

Run: `npx vitest run tests/server/assistant/contract/docx/ tests/server/assistant/contract/clauseSegmenter.test.ts tests/server/assistant/contract/clauseToParagraph.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: 既有合同审查相关单测 PASS。

- [ ] **Step 4: Commit**

```bash
git add server/agents/contract/uploadClientVersion.service.ts
git commit -m "feat(contract): uploadClientVersion 增量审查注入 textWithoutNumber 作 anchor + ClauseSegment 字面量透传新字段（PR10 方案 D）"
```

---

## Task 12: contractReviewMainAgent 首次审查注入 row.clauseText + 真断言

**Files:**
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts:119-127`（`riskRows.map` 块）
- Modify: `tests/server/assistant/contract/contractRisk.service.test.ts`（如已有；无则新建轻量版）

- [ ] **Step 1: 实施 — 改首次审查 riskRows 构造**

修改 `server/services/workflow/agents/contractReviewMainAgent.ts` 的 `riskRows.map` 块（约 119-127 行），把：

```ts
    const clauseIndexToParagraphIndex = buildClauseToParagraphMap(segments, paragraphs)

    // 写 ContractRisk + ContractAnnotation（每条 AI 风险各一条）
    // CORE-R2：风险落库收口到 persistAiRisksAsContractRows，annotation 由调用方按需创建
    const riskRows: PersistAiRiskRow[] = risks.map(aiRisk => ({
        risk: aiRisk,
        clauseParagraphIndex: clauseIndexToParagraphIndex.get(aiRisk.clauseIndex) ?? null,
    }))
    const createdRisks = await persistAiRisksAsContractRows({ reviewId, rows: riskRows })
```

改为：

```ts
    const clauseIndexToParagraphIndex = buildClauseToParagraphMap(segments, paragraphs)

    // PR10：用 segment.textWithoutNumber 作 anchor 字段（覆盖 LLM 自填的含编号 clauseText）
    const segmentByIndex = new Map(segments.map(s => [s.index, s]))

    // 写 ContractRisk + ContractAnnotation（每条 AI 风险各一条）
    // CORE-R2：风险落库收口到 persistAiRisksAsContractRows，annotation 由调用方按需创建
    const riskRows: PersistAiRiskRow[] = risks.map(aiRisk => ({
        risk: aiRisk,
        // PR10 方案 D：注入 segment.textWithoutNumber，规避 redlineInjector 严格行级匹配失败
        clauseText: segmentByIndex.get(aiRisk.clauseIndex)?.textWithoutNumber ?? aiRisk.clauseText,
        clauseParagraphIndex: clauseIndexToParagraphIndex.get(aiRisk.clauseIndex) ?? null,
    }))
    const createdRisks = await persistAiRisksAsContractRows({ reviewId, rows: riskRows })
```

- [ ] **Step 2: 加 mock-driven 单测验证 row.clauseText 注入**

在 `tests/server/assistant/contract/contractRisk.service.test.ts` 加（如文件不存在则新建并 import 必要的 vitest helpers）：

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { persistAiRisksAsContractRows } from '~~/server/agents/contract/contractRisk.service'
import type { Risk } from '#shared/types/contract'

describe('persistAiRisksAsContractRows · PR10 row.clauseText 注入', () => {
    it('row.clauseText 优先于 risk.clauseText（覆盖 LLM 自填）', async () => {
        // 准备：建一个 review（最小字段）
        const review = await prisma.contractReviews.create({
            data: {
                userId: 1, contractType: '劳动合同', stance: 'balanced', status: 'completed',
                docxText: '', partyA: '甲方', partyB: '乙方',
            },
        })

        const aiRisk: Risk = {
            id: 'tmp-1',
            clauseIndex: 1,
            clauseText: '1. 合同期限：本合同期限为 3 年',  // LLM 自填含编号
            level: 'medium', category: 'test', problem: 'test problem',
            risk: 'test', analysis: 'test', suggestion: 'test',
        }

        await persistAiRisksAsContractRows({
            reviewId: review.id,
            rows: [{
                risk: aiRisk,
                clauseText: '合同期限：本合同期限为 3 年',  // PR10 方案 D 注入：不含编号
                clauseParagraphIndex: 0,
            }],
        })

        const written = await prisma.contractRisks.findFirst({ where: { reviewId: review.id } })
        expect(written).not.toBeNull()
        expect(written!.clauseText).toBe('合同期限：本合同期限为 3 年')   // 注入值生效
        expect(written!.clauseText).not.toMatch(/^1\./)                    // LLM 自填的含编号被覆盖

        // 清理
        await prisma.contractRisks.deleteMany({ where: { reviewId: review.id } })
        await prisma.contractReviews.delete({ where: { id: review.id } })
    })
})
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/contractRisk.service.test.ts --reporter=verbose`

Expected: PASS（验证 row.clauseText 注入真生效）

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E "contractReviewMainAgent|persistAiRisksAsContractRows" | head -10`

Expected: 无错误。

- [ ] **Step 5: 跑相关 workflow 单测**

Run: `npx vitest run tests/server/services/workflow/ --reporter=verbose 2>&1 | tail -20`

Expected: workflow 既有单测无回归。

- [ ] **Step 6: Commit**

```bash
git add server/services/workflow/agents/contractReviewMainAgent.ts tests/server/assistant/contract/contractRisk.service.test.ts
git commit -m "feat(contract): 首次审查 risk 落库注入 segment.textWithoutNumber + 真断言（PR10 方案 D 收口）"
```

---

## Task 13: 集成测试 — parser → segmentClauses → risk 落库 e2e

**Files:**
- Modify: `tests/server/assistant/contract/docx/parser.test.ts`

- [ ] **Step 1: 加 parser → segmentClauses 端到端 case（用 Task 9 的合成 docx）**

在 `tests/server/assistant/contract/docx/parser.test.ts` 末尾追加（复用 Task 9 已 import 的 `buildMinimalDocxWithDecimalNumbering`）：

```ts
import { segmentClauses } from '~~/server/agents/contract/docx/clauseSegmenter'

describe('PR10 e2e：parseContractDocx → segmentClauses 子项级切分', () => {
    it('合成 docx（含 decimal numbering）上传后能切到子项级，且 segment.textWithoutNumber 不含编号', async () => {
        const buffer = await buildMinimalDocxWithDecimalNumbering([
            '合同期限：本合同期限为 3 年',
            '试用期：2 个月',
            '工资：每月 10000 元',
            '违约责任：违约金为月工资的 1 倍',
        ])
        const { paragraphs } = await parseContractDocx(buffer)

        // PR10 关键验证 1：paragraphs 全部以 "数字.\s" 开头（前缀拼接生效）
        expect(paragraphs.length).toBe(4)
        for (let i = 0; i < paragraphs.length; i++) {
            expect(paragraphs[i]).toMatch(new RegExp(`^${i + 1}\\.\\s`))
        }

        // PR10 关键验证 2：segmentClauses 切分识别子项（每个 list item 一个 segment）
        const fullText = paragraphs.join('\n')
        const { segments } = await segmentClauses(fullText)
        expect(segments.length).toBe(4)

        // PR10 关键验证 3：segment.textWithoutNumber 全部不含编号字符
        for (const s of segments) {
            expect(s.number).toMatch(/^\d+\.$/)
            expect(s.textWithoutNumber).not.toMatch(/^\d+\./)
            expect(s.text).toMatch(/^\d+\./)  // text 仍含编号（向后兼容）
        }
    })
})
```

- [ ] **Step 2: 运行集成测试**

Run: `npx vitest run tests/server/assistant/contract/docx/parser.test.ts -t "PR10 e2e" --reporter=verbose`

Expected: PASS（PR10 三个关键链路全部验证）

- [ ] **Step 3: 跑全套合同审查测试，确认无回归**

Run: `npx vitest run tests/server/assistant/contract/ --reporter=default 2>&1 | tail -30`

Expected: 全部 PASS（含 PR10 新加 + 既有 parser/clauseSegmenter/commentInjector/redlineInjector/redlineLocate/uploadClientVersion 等）

- [ ] **Step 4: Commit**

```bash
git add tests/server/assistant/contract/docx/parser.test.ts
git commit -m "test(contract): PR10 e2e parser → segmentClauses 子项级切分集成测试"
```

---

## Task 14: 全量测试 + 手工冒烟

**Files:** 全项目

- [ ] **Step 1: 全量类型检查**

Run: `npx nuxi typecheck 2>&1 | tail -30`

Expected: 0 errors

- [ ] **Step 2: 全量服务端测试**

Run: `bun run test:server 2>&1 | tail -30`

Expected: 全部 PASS

> 如有失败，逐条定位是否 PR10 引入回归（重点检查 ClauseSegment / ClauseSnapshotItem 字段被引用的所有位置：grep `\.text\b` `\.offsetStart\b` `segments.map`）。

- [ ] **Step 3: 手工冒烟（可选，建议）**

启动开发服务器：
```bash
bun dev
```

操作：
1. 用 review #891 同款合同（含 numbering 的 docx）重新上传
2. 等审查完成
3. 验证：左侧 DocxPreview 能定位到子项段落
4. 导出 reviewed.docx → 用 Word 打开 → 验证：批注落到具体子项段落，编号未重复
5. 修改导出的 docx 后重新上传 → 验证：增量审查锚点迁移正常

- [ ] **Step 4: 最终提交（如有）**

```bash
# 如手工冒烟过程中发现需要小修，按需 commit
git status
git diff
```

> 注：spec 文档不修改（spec 是设计契约不可变）。如需追踪实施进度，更新 plan 文档自身的 checkbox 状态。

---

## 实施完成检查表

- [ ] Task 1 ClauseSegment / ClauseSnapshotItem 契约扩展
- [ ] Task 2 clauseSegmenter 填充 textWithoutNumber
- [ ] Task 3 numbering.ts 骨架
- [ ] Task 4 parseNumberingXml 实现
- [ ] Task 5 buildNumberingPrefixMap decimal 单层
- [ ] Task 6 8 种 numFmt 渲染表
- [ ] Task 7 bullet skip + 空 lvlText skip
- [ ] Task 8 多层嵌套 + 父级++子级 reset
- [ ] Task 9 parser.ts 改造（含表格索引修复）
- [ ] Task 10 uploadClientVersion snapshot 写入新字段
- [ ] Task 11 uploadClientVersion 增量审查注入
- [ ] Task 12 contractReviewMainAgent 首次审查注入
- [ ] Task 13 parser → segmentClauses e2e 集成测试
- [ ] Task 14 全量测试 + 手工冒烟

---

## 关键约束（实施时务必遵守）

1. **不要改 segment.text 含义**：保持向后兼容，仅新增 textWithoutNumber 字段
2. **不要改 redlineInjector / commentInjector / reviewResultPersistence**：方案 D 的核心是"零侵入注入器"
3. **不要改 prompt 模板**：`analyzeSingleClause.ts` 的 `ctx.clause.text` 路径不变（LLM 视角不变）
4. **不要改 LLM 输出 RiskItem 字段**：r.clauseText 保留 LLM 摘录，仅在落库时被 row.clauseText 覆盖
5. **frequent commits**：每个 Task 一个 commit，不要等多个 Task 完成才一次 commit
6. **TDD 严格遵守**：先 RED（失败测试）→ GREEN（最小实施）→ commit；不要跳过 RED 步骤
7. **每模块完成跑模块单测，全部完成后才跑全量测试**：避免频繁全量测试浪费时间
