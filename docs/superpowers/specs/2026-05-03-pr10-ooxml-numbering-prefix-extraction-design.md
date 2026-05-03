# PR10 · OOXML numbering 提取拼接子项编号 · 设计文档

> **定位**：合同审查 PR10 — 修复 mammoth 剥离 Word auto-numbering 导致 segmentClauses 在 docx 上传路径无法识别子项的 bug。PR9 已修复 `clauseSegmenter.ts` 算法层（识别「1.」「2.」单数字编号），但 docx 路径下 mammoth 输出文本根本没有这些字符，PR9 修复用不上。
> **代号**：`contract-review-pr10-ooxml-numbering`（不在用户面前出现）
> **用户视角**：上传 docx 合同审查后，左侧 DocxPreview 能定位到子项段落（与粘贴文本路径一致）。
> **范围**：parseContractDocx 内部增加 OOXML numbering 解析层，把 list item 段落自动拼接「N. 」「（一）」等前缀，让 segmentClauses 识别为子项 segment。

---

## 1. 背景

### 1.1 实测 root cause（review #891 e2e 验证）

`server/agents/contract/docx/parser.ts:43`：

```ts
const { value: rawText } = await mammoth.extractRawText({ buffer })
let paragraphs = splitParagraphs(rawText)
```

mammoth 默认**不展开 docx 自动列表编号**（Word `<w:numPr>` 渲染的 1./2./3.）。导致：

- docx 实际显示「1. 合同期限：本合同期限为 3 年」（含编号字符）
- mammoth 输出「合同期限：本合同期限为 3 年」（**编号被剥离**）
- segmentClauses 的 `RE_NUM_DOT = /^(\d+(?:\.\d+)*\.?)\s/` 行首匹配失败
- review #891 切出 7 个 segment（仅父条款），子项全合并到父条款 segment

对比 review #890（粘贴文本路径）切出 19 个 segment，子项全部独立识别。

### 1.2 PR9 不能解决的原因

PR9 修复了 `clauseSegmenter.ts:178-186` 让单数字「1.」「2.」「3.」编号被识别为父条款内子项。但前提是文本里有这些字符。docx 路径下文本里压根没有这些字符，PR9 修复用不上。

### 1.3 OOXML numbering 实测结构（review #891 docx 实证）

`word/numbering.xml` 里：

```xml
<w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
        <w:start w:val="1"/>
        <w:numFmt w:val="decimal"/>
        <w:lvlText w:val="%1."/>
    </w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val=""/></w:lvl>
    ...
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="13"/></w:num>
```

`word/document.xml` 的 list item 段落：

```xml
<w:p>
    <w:pPr>
        <w:numPr>
            <w:ilvl w:val="0"/>
            <w:numId w:val="1"/>
        </w:numPr>
    </w:pPr>
    <w:r><w:t>合同期限：本合同期限为 3 年。</w:t></w:r>
</w:p>
```

每个 list item 段落通过 `<w:numPr>` 引用一个 numId，numId → abstractNumId → 多 ilvl 配置（numFmt + lvlText + start）。**Word 渲染时按 (numId, ilvl) 维护运行计数器，按模板渲染前缀**，再拼接到段落原文前。

review #891 实测：18 个 numId（独立计数器），16 个 decimal「%1.」格式 + 2 个 bullet「￮」格式，全部 ilvl=0 单层。

---

## 2. 范围与边界

### 2.1 做的事

1. 新建 `server/agents/contract/docx/numbering.ts`：纯函数解析 numbering.xml + document.xml，输出「段落 → 前缀字符串」映射
2. 修改 `parser.ts` 的 `parseContractDocx`：调用 numbering.ts 拿前缀映射，给对应段落拼接前缀
3. **支持 numFmt**：`decimal` / `chineseCounting` / `chineseLegalSimplified` / `decimalEnclosedCircle` / `lowerLetter` / `upperLetter` / `lowerRoman` / `upperRoman` / `bullet`
4. **支持多层嵌套**（ilvl=0..N）：维护各 ilvl 运行计数器，按 lvlText 模板的 `%1 %2 ... %9` 占位符渲染
5. **支持 lvlText 任意模板**：`"%1."` / `"（%1）"` / `"%1、"` / `"%1.%2"` 等
6. **未识别 numFmt 走 fallback**：跳过该段不拼前缀 + logger.warn 埋点

### 2.2 不做的事（YAGNI）

| 子项 | 理由 |
|---|---|
| 修复既有 review 数据（旧 risk 重写 clauseText / clauseParagraphIndex） | 接受新旧数据不一致；新审查自动用 PR10 修复 |
| 罕见 numFmt：hindiNumbers / japaneseCounting / koreanLegal / cardinalText / ordinalText 等 | 中国合同极罕见，logger.warn 命中后视情况追加 |
| lvlOverride（同 numId 不同段落用不同 start）| 实测合同里独立 numId 已能覆盖 |
| lvlPicBulletId（图片 bullet）| 中国合同罕见 |
| styles.xml 引用的 list 样式 | 不直接挂在 numPr 的间接引用，logger.warn 命中 |
| 改 mammoth.extractRawText 调用 | 只在外面拼前缀，不动 mammoth 主路径 |

### 2.3 用户语言

- 不暴露「numbering / numId / ilvl / numFmt」等技术词
- 用户感知：上传 docx 合同审查与粘贴文本完全一致，DocxPreview 能精确定位到子项段落

---

## 3. numbering.ts 实现细节

### 3.1 主入口

```ts
// server/agents/contract/docx/numbering.ts

import { parseOoxml, walk, findFirst, findAll, getAttr, tagOf, textOf } from './xmlAst'
import { logger } from '#shared/utils/logger'

/** 段落索引 → 已渲染前缀字符串（含尾部空格） */
export type NumberingPrefixMap = Map<number, string>

/**
 * 解析 OOXML numbering.xml + document.xml，返回每个 list item 段落的渲染前缀。
 *
 * paraIndex 与 mammoth.splitParagraphs 输出 / paragraphsFromAst 输出同口径
 * （非空段落 0-based 索引）。
 *
 * 实测合同 numFmt 分布（review #891）：
 *   - decimal "%1."（"1." "2." "3."）— 主流
 *   - bullet "￮"（非编号子项）— 偶见
 *
 * 支持 numFmt：decimal / chineseCounting / chineseLegalSimplified /
 * decimalEnclosedCircle / lowerLetter / upperLetter / lowerRoman / upperRoman /
 * bullet。其它 numFmt 走 fallback：跳过该段 + logger.warn 计数。
 *
 * @param documentXml word/document.xml 全文
 * @param numberingXml word/numbering.xml 全文（不存在时传 null）
 * @returns 段落索引 → 前缀字符串的 Map（不在 list 内的段落不出现）
 */
export function buildNumberingPrefixMap(
    documentXml: string,
    numberingXml: string | null,
): NumberingPrefixMap
```

### 3.2 numbering.xml 解析

```ts
interface LvlConfig {
    numFmt: string         // 'decimal' / 'chineseCounting' / 'bullet' ...
    lvlText: string        // '%1.' / '（%1）' / '%1.%2' / '￮' / ...
    start: number          // <w:start> 默认 1
}

interface AbstractNum {
    /** ilvl → LvlConfig 映射；ilvl 0..8（OOXML 最多 9 层）*/
    levels: Map<number, LvlConfig>
}

interface NumberingDef {
    /** numId → abstractNumId 映射（解析自 <w:num>）*/
    numIdMap: Map<number, number>
    /** abstractNumId → AbstractNum（解析自 <w:abstractNum>）*/
    abstractNums: Map<number, AbstractNum>
}

function parseNumberingXml(numberingXml: string): NumberingDef
```

实现：
1. `parseOoxml` 解析 XML AST
2. `findAll(ast, 'w:abstractNum')` 收集所有 abstractNum，每个 abstractNum 内 `findAll('w:lvl')` 收集多 ilvl 配置
3. `findAll(ast, 'w:num')` 收集 numId → abstractNumId 映射
4. 对每个 lvl：`getAttr('w:numFmt') / w:lvlText / w:start` 提取属性

### 3.3 document.xml 段落遍历

```ts
function buildNumberingPrefixMap(documentXml, numberingXml) {
    const prefixMap = new Map<number, string>()
    if (!numberingXml) return prefixMap  // 无 numbering.xml → 无前缀

    const numbering = parseNumberingXml(numberingXml)
    const docAst = parseOoxml(documentXml)
    
    /** key = `${numId}:${ilvl}`，value = 当前已渲染数（首次见时取 start）*/
    const counters = new Map<string, number>()
    let paraIndex = -1  // 与 mammoth.splitParagraphs 同口径

    walk(docAst, (node) => {
        if (tagOf(node) !== 'w:p') return
        const text = paragraphText(node).trim()
        if (text.length === 0) return  // 空段被 splitParagraphs 过滤
        paraIndex++

        const numPr = findFirst(childrenOf(node), 'w:numPr')
        if (!numPr) return  // 非 list 段落

        const numId = parseInt(getAttr(findFirst(childrenOf(numPr), 'w:numId') ?? {}, 'w:val') ?? '', 10)
        const ilvl = parseInt(getAttr(findFirst(childrenOf(numPr), 'w:ilvl') ?? {}, 'w:val') ?? '0', 10)
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

        // 维护各 ilvl counter（首次见时取 start，否则 ++）
        const counterKey = `${numId}:${ilvl}`
        const currentCount = counters.has(counterKey)
            ? counters.get(counterKey)! + 1
            : lvl.start
        counters.set(counterKey, currentCount)
        // 子层级 reset 子层 counter（OOXML 规则：父级 ++ 时子级归零）
        // 简化：如果 ilvl=0 ++，ilvl=1..N counter 在下次见时按 start 重启
        for (const [k] of counters) {
            const [kNumId, kIlvlStr] = k.split(':')
            if (kNumId === String(numId) && parseInt(kIlvlStr!, 10) > ilvl) {
                counters.delete(k)
            }
        }

        // 渲染前缀
        const prefix = renderLvlText(lvl, abstractNum, counters, numId, ilvl)
        if (prefix !== null) {
            prefixMap.set(paraIndex, prefix + ' ')  // 尾部空格让 RE_NUM_DOT 能匹配 \s
        }
    })

    return prefixMap
}
```

### 3.4 numFmt 渲染表

```ts
/**
 * 把 lvlText 模板（含 %1 %2 ...）替换为各级 counter 的渲染值。
 * 返回 null 表示未识别 numFmt → 跳过该段。
 */
function renderLvlText(
    lvl: LvlConfig,
    abstractNum: AbstractNum,
    counters: Map<string, number>,
    numId: number,
    currentIlvl: number,
): string | null {
    let result = lvl.lvlText

    // bullet 特殊：lvlText 直接是 bullet 字符（如 "￮" "•"），无 %N 占位符
    if (lvl.numFmt === 'bullet') {
        return lvl.lvlText  // 直接拼 bullet 字符
    }

    // 替换 %1 %2 ... %N 占位符为对应 ilvl 的 counter 渲染
    for (let i = 1; i <= currentIlvl + 1; i++) {
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
    return result
}

/** 把数字渲染成对应 numFmt 的字符串。未识别格式返回 null。*/
function renderNumber(numFmt: string, n: number): string | null {
    switch (numFmt) {
        case 'decimal': return String(n)
        case 'chineseCounting': return cnNum(n)               // 一二三四
        case 'chineseLegalSimplified': return cnLegalNum(n)   // 壹贰叁
        case 'decimalEnclosedCircle': return circledNum(n)    // ①②③
        case 'lowerLetter': return letterNum(n, false)        // a b c
        case 'upperLetter': return letterNum(n, true)         // A B C
        case 'lowerRoman': return romanNum(n, false)          // i ii iii
        case 'upperRoman': return romanNum(n, true)           // I II III
        default:
            return null  // 未识别 → 调用方 logger.warn + 跳过段落
    }
}
```

### 3.5 中文数字 / 罗马数字 / 字母 / 圆圈数字 渲染辅助

```ts
function cnNum(n: number): string {
    // 1..99 用 "一二三...九十一二..."；100+ 极罕见，按数字位逐位渲染
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
    // 类似 cnNum 但用大写中文
    ...
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

---

## 4. parser.ts 改造

```ts
// 新增 import
import { buildNumberingPrefixMap, type NumberingPrefixMap } from './numbering'

async function readNumberingXmlOrNull(zip: JSZip): Promise<string | null> {
    const file = zip.file('word/numbering.xml')
    if (!file) return null
    return file.async('string')
}

export async function parseContractDocx(buffer: Buffer): Promise<ParsedContract> {
    const { value: rawText } = await mammoth.extractRawText({ buffer })
    let paragraphs = splitParagraphs(rawText)

    const zip = await loadDocxZip(buffer)
    const rawXml = await readTextFromZip(zip, 'word/document.xml')
    const numberingXml = await readNumberingXmlOrNull(zip)

    // 新增：构建 numbering 前缀映射
    const prefixMap = buildNumberingPrefixMap(rawXml, numberingXml)
    paragraphs = applyPrefixMap(paragraphs, prefixMap)

    // DOCX-H4 fallback：mammoth 段落数远小于 AST → 用 AST 完整提取
    const astParagraphs = applyPrefixMap(paragraphsFromAst(rawXml), prefixMap)
    if (
        astParagraphs.length > paragraphs.length
        && (astParagraphs.length === 0
            || paragraphs.length / astParagraphs.length < TABLE_FALLBACK_RATIO)
    ) {
        paragraphs = astParagraphs
    }

    return { paragraphs, rawXml }
}

function applyPrefixMap(paragraphs: string[], prefixMap: NumberingPrefixMap): string[] {
    return paragraphs.map((p, i) => {
        const prefix = prefixMap.get(i)
        return prefix ? prefix + p : p
    })
}
```

---

## 5. 与下游兼容性分析

### 5.1 paragraphs 数量不变

prefix 拼接发生在每个段落 in-place，不增不减。`commentInjector` / `redlineInjector` 用 `clauseParagraphIndex` 定位段落，行为不变。

### 5.2 fuzzy 匹配容忍度

- `commentInjector` 用 `risk.clauseText` 作 anchorQuote 在段落上 fuzzy 匹配
- LLM 看到带前缀的 prompt（PR10 修复后），输出 `clauseText` 大概率含前缀（spec §5.4 要求 LLM 逐字摘录）
- 即使 LLM 输出不含前缀的 `clauseText`，dmp Match_Threshold=0.3 容忍 < 25% 字符差异（PR7 既有约束）
- 「1. 」前缀仅 3 字符 vs 平均 50+ 字符段落 → 差异比例 < 6%，完全在容忍范围 ✓

### 5.3 既有 review 数据兼容性

| 场景 | 兼容性 |
|---|---|
| 旧 review 已存的 risk（PR10 前 mammoth 输出无前缀） | clauseText / clauseParagraphIndex 不动，UI 仍能定位（精度同 PR10 前）|
| 旧 review 重审 / 客户回传 | 新 docxText 含前缀，archorMigrate 走 PR7 双锚点：档 1 quote 不含前缀（无影响）；档 2 clauseText fuzzy（dmp 容忍前缀差异）✓ |
| 新 review（PR10 后）| 完整修复，子项段落级定位 ✓ |

### 5.4 reviewedFile 导出

`commentInjector` / `redlineInjector` 用 OOXML AST 操作 `<w:p>`，不依赖前缀文本——导出的 reviewed.docx 保留 Word 原始 numbering 渲染，前缀依然由 Word 自动生成。**导出 docx 与现状一致**，不会出现重复编号。

---

## 6. 测试策略

### 6.1 单元测试 `tests/server/assistant/contract/docx/numbering.test.ts`

| 用例 | 验证 |
|---|---|
| decimal `"%1."` ilvl=0 | "1." → "2." → "3." 连续渲染 + 尾部空格 |
| decimal `"（%1）"` ilvl=0 | "（1）" → "（2）" |
| chineseCounting `"%1、"` ilvl=0 | "一、" → "二、" → "三、" |
| chineseLegalSimplified | "壹、" → "贰、" |
| decimalEnclosedCircle | "①" → "②" |
| lowerLetter / upperLetter | "a" / "b" / "A" / "B" |
| lowerRoman / upperRoman | "i" / "ii" / "I" / "II" |
| bullet `"￮"` | 直接拼 "￮" |
| 多层嵌套 ilvl=1 lvlText=`"%1.%2"` | "1.1" / "1.2" / "2.1"（父级 ++ 子级 reset）|
| 多层嵌套 ilvl=2 lvlText=`"%1.%2.%3"` | "1.1.1" / "1.1.2" |
| `<w:start val="3"/>` | 从 "3." 开始 |
| numId 引用不存在 abstractNumId | 跳过该段 + logger.warn |
| 未识别 numFmt（如 `hindiNumbers`） | 跳过 + logger.warn |
| numbering.xml 缺失（普通 docx 无 list） | 空 prefixMap |

### 6.2 集成测试 `tests/server/assistant/contract/docx/parser.test.ts` 扩展

用 `prisma/seeds/contract-samples/labor.docx` + 用户 review #891 docx 做端到端：

```ts
it('parseContractDocx 给 list 段落拼接 numbering 前缀', async () => {
    const buffer = readFileSync('/path/to/labor.docx')
    const { paragraphs } = await parseContractDocx(buffer)
    expect(paragraphs.some(p => p.startsWith('1. 合同期限'))).toBe(true)
    expect(paragraphs.some(p => p.startsWith('2. 试用期'))).toBe(true)
})

it('parseContractDocx → segmentClauses 切到子项级（与粘贴文本路径一致）', async () => {
    const buffer = readFileSync('/path/to/labor.docx')
    const { paragraphs } = await parseContractDocx(buffer)
    const fullText = paragraphs.join('\n')
    const { segments } = await segmentClauses(fullText)
    expect(segments.length).toBeGreaterThanOrEqual(15)  // 父条款 + 子项总数
})
```

### 6.3 回归测试

- 既有 `parser.test.ts` 单测无回归
- 既有 `clauseSegmenter.test.ts` 单测无回归
- 既有 `uploadClientVersion.service.test.ts` / `analyzeSingleClause.test.ts` 等调用方测试无回归

### 6.4 手工冒烟

按 review #891 同款合同重传 → 验证审查中/审查后都能定位到子项段落（与 review #890 粘贴文本路径行为一致）。

---

## 7. 风险与 mitigation

| 风险 | 影响 | mitigation |
|---|---|---|
| 真实合同有自定义 numbering 我们没覆盖 | 子项不识别，降级到父条款级（与 PR10 之前一致）| logger.warn 埋点 + Q3 fallback 不破坏现状 |
| paragraphs 索引在 mammoth vs AST 两条路径不一致 | prefix 拼到错误段落 | prefixMap 用 document.xml `<w:p>` 顺序中的 0-based 索引；mammoth.splitParagraphs 与 paragraphsFromAst 同口径（都过滤空段）|
| numbering.xml 引用 styles.xml 的 list 样式 | styled list 段落不识别 | logger.warn 命中后追加支持（YAGNI）|
| Phase B 客户回传场景兼容性 | 新 docx 含前缀 vs 旧 risk.clauseText 不含 | dmp Match_Threshold=0.3 容忍 < 25% 字符差异，3 字符前缀完全在容忍范围 |
| ilvl 父级 ++ 子级 reset 实现 bug | "1.1" 后续段子级 counter 不归零导致 "1.3" 跳到 "2.1" 时算错 | 单测覆盖父级 ++ 子级 reset case |
| OOXML lvlText 含特殊字符（如 `(%1)` 转义）| 渲染前缀含字面 `%1` | renderLvlText 使用 `replace(/%N/g, ...)` 字符串替换，不走 regex 特殊字符 |

---

## 8. 后续路线（不在 PR10 范围）

- **数据迁移脚本**：把既有 review 的 docxText / risks.clauseParagraphIndex 重新跑一遍 PR10 修复后的 parseContractDocx + segmentClauses，让旧 review 也享有子项级定位。当前 YAGNI（接受新旧不一致）
- **罕见 numFmt 支持**：hindiNumbers / japaneseCounting / koreanLegal 等。当前 logger.warn 命中后单独 PR 追加
- **styles.xml 间接 list 样式**：`<w:pStyle>` 引用 list style 的场景。当前 YAGNI（中国合同罕见）
- **图片 bullet（lvlPicBulletId）**：用图片作 bullet 的场景。当前 YAGNI

---

## 9. PR 拆分

| # | PR | 内容 | 工期 |
|---|---|---|---|
| 10 | `contract-pr10-ooxml-numbering` | numbering.ts 新建 + parser.ts 改造 + 单测 + 集成测试 | 1 天 |

合并发布约束：

- 与 PR7/8/9 独立无依赖，可在 origin/dev 任意基础上 cut 分支
- merge 后新建 review 自动用修复版本；既有 review 不动
