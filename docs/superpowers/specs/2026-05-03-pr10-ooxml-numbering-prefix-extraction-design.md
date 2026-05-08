# PR10 · OOXML numbering 提取拼接子项编号 · 设计文档

> **定位**：合同审查 PR10 — 修复 mammoth 剥离 Word auto-numbering 导致 segmentClauses 在 docx 上传路径无法识别子项的 bug。PR9 已修复 `clauseSegmenter.ts` 算法层（识别「1.」「2.」单数字编号），但 docx 路径下 mammoth 输出文本根本没有这些字符，PR9 修复用不上。
> **代号**：`contract-review-pr10-ooxml-numbering`（不在用户面前出现）
> **用户视角**：上传 docx 合同审查后，左侧 DocxPreview 能定位到子项段落（与粘贴文本路径一致）。
> **范围**：(1) parseContractDocx 内部增加 OOXML numbering 解析层，把 list item 段落自动拼接「N. 」「（一）」等前缀让 segmentClauses 识别；(2) 扩展 `ClauseSegment` 契约新增 `textWithoutNumber` 字段（OCP），让下游 anchor 锚点字段不携带编号字符，规避 redlineInjector 严格等值校验失败。

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

> mammoth 1.11.0 官方源码核对（`node_modules/mammoth/lib/raw-text.js` + `lib/docx/numbering-xml.js:73-101`）：`extractRawText` 只走 text/tab/paragraph 三种节点；`convertToHtml` 默认 styleMap 也无 list/numbering 渲染规则；`transformDocument` 拿到的 AST 在 numbering-xml.js 阶段就把 `start/lvlText/numFmt` 丢弃。**mammoth 没有任何官方/半官方方式输出 numbering 前缀**——自己解析 numbering.xml 不是重复造轮子，是唯一可行路径。

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

### 1.4 段落 → 锚点 链路（核心约束）

仅仅给段落拼前缀让 segmentClauses 切出子项 segment 是**不够的**。下游还有一条 docx 写回 OOXML 的锚点链路：

```
LLM 输出 risk.clauseText
    ↓ 落库 contractRisks.clauseText（NOT NULL）
    ↓
redlineInjector / commentInjector
    ↓ 用 risk.clauseText 在 OOXML <w:p> 上做严格行级匹配
       redlineLocate.ts:177 / 194 / 213 / 219 严格 `paragraphTextWithRunRule(para) !== lines[i] return null`
       commentInjector.ts:412-433 用 paraText.includes(quoteLine ≥ 8 字符) 包含匹配
```

**关键事实**：OOXML `<w:p>` 的 textContent 是 `<w:t>` 节点累加，**永远不含 numbering 前缀**——前缀是 Word 渲染时按 numbering.xml 动态生成，不进 textContent。

如果 PR10 仅在 paragraphs 拼前缀让 segmentClauses 切到子项，但 segment.text 仍含「1. 」前缀字符 → ctx.clause.text 含前缀 → LLM 看到含前缀 prompt → LLM 逐字摘录到 risk.clauseText 也含前缀 → redlineInjector 严格比对 OOXML（无前缀）**100% 失败**，比修复前更糟。

PR10 必须同时解决「切分识别」+「锚点匹配」两个问题。具体做法见 §5。

---

## 2. 范围与边界

### 2.1 做的事

1. 新建 `server/agents/contract/docx/numbering.ts`：纯函数解析 numbering.xml + document.xml，输出「段落 → 前缀字符串」映射
2. 修改 `parser.ts` 的 `parseContractDocx`：调用 numbering.ts 拿前缀映射，给对应段落拼接前缀（**修复 prefixMap 与 paragraphs 同源问题**——见 §4）
3. **扩展 `ClauseSegment` 契约**（`shared/types/contract.ts`）：新增 `textWithoutNumber`、`offsetStartWithoutNumber` 字段（OCP，原字段保持不变）
4. 修改 `clauseSegmenter.ts:230-249` 切分逻辑：填充 `textWithoutNumber` + `offsetStartWithoutNumber`（剥掉行首 `matches[i].number` 字符）
5. 扩展 `ClauseSnapshotItem` 契约 + `uploadClientVersion.service.ts:174-179`：写入 snapshot 时携带 `textWithoutNumber`
6. **修改 risk 落库调用方**（`contractReviewMainAgent.ts` 首次审查 + `uploadClientVersion.service.ts:761` 增量审查）：调用 `persistAiRisksAsContractRows` 时传入 `row.clauseText = segment.textWithoutNumber`，覆盖 LLM 自填的含编号 clauseText（复用 `contractRisk.service.ts:98` 现有「双锚点 · 层 1」注入机制）
7. **支持 numFmt**：`decimal` / `chineseCounting` / `chineseLegalSimplified` / `decimalEnclosedCircle` / `lowerLetter` / `upperLetter` / `lowerRoman` / `upperRoman`；**bullet 显式 skip 不写入 prefixMap**（拼字符会污染原文且 segmentClauses 无任何正则识别 bullet 为编号，纯负面）
8. **支持多层嵌套**（ilvl=0..N）：维护各 ilvl 运行计数器，按 lvlText 模板的 `%1 %2 ... %9` 占位符渲染
9. **支持 lvlText 任意模板**：`"%1."` / `"（%1）"` / `"%1、"` / `"%1.%2"` 等
10. **未识别 numFmt 走 fallback**：跳过该段不拼前缀 + logger.warn 埋点
11. **空 lvlText（`<w:lvlText w:val=""/>`）跳过**：避免给段落拼接单空格污染原文

### 2.2 不做的事（YAGNI）

| 子项 | 理由 |
|---|---|
| 修复既有 review 数据（旧 risk 重写 clauseText / clauseParagraphIndex） | 接受新旧数据不一致；新审查自动用 PR10 修复 |
| 罕见 numFmt：hindiNumbers / japaneseCounting / koreanLegal / cardinalText / ordinalText 等 | 中国合同极罕见，logger.warn 命中后视情况追加 |
| lvlOverride（同 numId 不同段落用不同 start）| 实测合同里独立 numId 已能覆盖 |
| lvlPicBulletId（图片 bullet）| 中国合同罕见 |
| styles.xml 引用的 list 样式 | 不直接挂在 numPr 的间接引用，logger.warn 命中 |
| 改 mammoth.extractRawText 调用 | 只在外面拼前缀，不动 mammoth 主路径 |
| 扩展 segmentClauses 正则识别非 decimal/chineseCounting 的 numFmt 渲染结果 | clauseSegmenter 现有 `RE_NUM_DOT` / `RE_CN_COMMA` / `RE_DI_TIAO` 仅识别 decimal「1. 」与 chineseCounting「一、」两种格式；其他 numFmt（chineseLegalSimplified「壹」/ decimalEnclosedCircle「①」/ lowerLetter / Roman 等）拼到段首段后下游切不动，segment 仍合并到父条款。**PR10 范围内不扩 clauseSegmenter 正则**——记录为已知约束，PR11+ 视实测分布按需补 |

### 2.3 用户语言

- 不暴露「numbering / numId / ilvl / numFmt」等技术词
- 用户感知：上传 docx 合同审查与粘贴文本完全一致，DocxPreview 能精确定位到子项段落

---

## 3. numbering.ts 实现细节

### 3.1 主入口

```ts
// server/agents/contract/docx/numbering.ts

import {
    parseOoxml,
    walk,
    findFirst,
    findAll,
    getAttr,
    tagOf,
    childrenOf,
    paragraphText,
    type NodeArray,
} from './xmlAst'
import { logger } from '#shared/utils/logger'

/** 段落索引 → 已渲染前缀字符串（含尾部空格） */
export type NumberingPrefixMap = Map<number, string>

/**
 * 解析 OOXML numbering.xml + document.xml，返回每个 list item 段落的渲染前缀。
 *
 * paraIndex 与 paragraphsFromAst 输出同口径（深度优先遍历 <w:p> 含表格内段落，
 * 仅过滤 hasRunChild=false 与 trim().length=0）。调用方必须保证最终
 * applyPrefixMap 的 paragraphs 列表与本函数 paraIndex 同源——见 §4。
 *
 * 实测合同 numFmt 分布（review #891）：
 *   - decimal "%1."（"1." "2." "3."）— 16 个 numId 主流
 *   - bullet "￮"（非编号子项）— 2 个 numId，本函数 skip
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
): NumberingPrefixMap
```

### 3.2 numbering.xml 解析

```ts
interface LvlConfig {
    numFmt: string         // 'decimal' / 'chineseCounting' / 'bullet' ...
    lvlText: string        // '%1.' / '（%1）' / '%1.%2' / '￮' / ...
    start: number          // <w:start> 默认 1（Word 实际渲染行为，与 ECMA-376 字面默认 0 不同；生产合同几乎都显式写 start=1）
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
4. 对每个 lvl：`getAttr(node, 'w:numFmt') / 'w:lvlText' / 'w:start'` 提取属性

### 3.3 document.xml 段落遍历

```ts
function buildNumberingPrefixMap(documentXml, numberingXml) {
    const prefixMap = new Map<number, string>()
    if (!numberingXml) return prefixMap  // 无 numbering.xml → 无前缀

    const numbering = parseNumberingXml(numberingXml)
    const docAst = parseOoxml(documentXml)

    /** key = `${numId}:${ilvl}`，value = 当前已渲染数（首次见时取 start）*/
    const counters = new Map<string, number>()
    let paraIndex = -1  // 与 paragraphsFromAst 同口径

    walk(docAst, (node) => {
        if (tagOf(node) !== 'w:p') return
        const text = paragraphText(node).trim()
        if (text.length === 0) return  // 空段被 paragraphsFromAst 过滤
        paraIndex++

        // 注意：findFirst 接收 NodeArray，传 [node] 让深度优先 walk 进入子树
        const numPr = findFirst([node], 'w:numPr')
        if (!numPr) return  // 非 list 段落

        const numIdNode = findFirst([numPr], 'w:numId')
        const ilvlNode = findFirst([numPr], 'w:ilvl')
        if (!numIdNode) return

        const numId = parseInt(getAttr(numIdNode, 'w:val') ?? '', 10)
        const ilvl = parseInt(ilvlNode ? (getAttr(ilvlNode, 'w:val') ?? '0') : '0', 10)
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

        // bullet 显式 skip：拼 "￮" "•" 会污染原文且 segmentClauses 不识别为编号 → 纯负面
        if (lvl.numFmt === 'bullet') {
            logger.info('[numbering] bullet 段落跳过不拼前缀', { numId, ilvl, paraIndex })
            return
        }

        // 维护各 ilvl counter（首次见时取 start，否则 ++）
        const counterKey = `${numId}:${ilvl}`
        const currentCount = counters.has(counterKey)
            ? counters.get(counterKey)! + 1
            : lvl.start
        counters.set(counterKey, currentCount)
        // 子层级 reset 子层 counter（OOXML 规则：父级 ++ 时子级归零）
        // 简化：删除子层 counter，下次见时按 start 重启
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
 * 返回 null 表示未识别 numFmt 或空 lvlText → 跳过该段。
 *
 * 注意：OOXML ECMA-376 §17.9.13 lvlText.val 规定「除 %<digit> 外全部按字面量输出」，
 * 不存在 %% 转义概念。renderNumber 输出仅含数字/中文/字母/罗马字符，不含 % $ 等正则
 * 元字符或 backreference 字符，replace(/%N/g, ...) 不会触发递归替换或转义异常。
 */
function renderLvlText(
    lvl: LvlConfig,
    abstractNum: AbstractNum,
    counters: Map<string, number>,
    numId: number,
    currentIlvl: number,
): string | null {
    // 空 lvlText 显式 skip：避免给段落拼接单空格污染原文
    if (lvl.lvlText.length === 0) {
        logger.warn('[numbering] 空 lvlText 跳过段落', { numId, ilvl: currentIlvl })
        return null
    }

    let result = lvl.lvlText

    // 替换 %1 %2 ... %N 占位符为对应 ilvl 的 counter 渲染
    // 倒序替换避免 %10 被 %1 拦截（OOXML 最多 9 级，理论不会出现 %10，但仍是好习惯）
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

    // 渲染后若仍是空白（如所有占位符替换后剩余字面量都是空格）→ skip
    if (result.trim().length === 0) {
        logger.warn('[numbering] 渲染后 lvlText 为空白，跳过段落', { numId, ilvl: currentIlvl })
        return null
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
        // bullet 不进 renderNumber：在 buildNumberingPrefixMap 入口已 skip
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

---

## 4. parser.ts 改造（含表格索引修复）

```ts
// 新增 import
import { buildNumberingPrefixMap, type NumberingPrefixMap } from './numbering'

async function readNumberingXmlOrNull(zip: DocxZip): Promise<string | null> {
    const file = zip.file('word/numbering.xml')
    if (!file) return null
    return file.async('string')
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

    // ========== 表格索引修复（维度 5 E3）==========
    // mammoth.extractRawText 跳过 <w:tbl> 单元格内段落；buildNumberingPrefixMap 走全树。
    // 当合同含表格但 mammoth 段数 ≥ 60% AST 时（DOCX-H4 fallback 不触发），
    // 直接 applyPrefixMap(mammoth 段落) 会把前缀错位拼到非 list 段落 → 必须在
    // 拼前缀前判断 paragraphs 是否与 prefixMap 同源（即是否走 AST 路径）。
    //
    // 实施：始终把 paragraphs 切到 AST 路径（paragraphsFromAst 输出与 prefixMap 同源）。
    // 这与现有 DOCX-H4 fallback 行为兼容——fallback 本来就是为了切到 AST，
    // 现在改为「prefixMap 非空 → 强制走 AST；否则保留原 DOCX-H4 fallback」。
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

function applyPrefixMap(paragraphs: string[], prefixMap: NumberingPrefixMap): string[] {
    return paragraphs.map((p, i) => {
        const prefix = prefixMap.get(i)
        return prefix ? prefix + p : p
    })
}
```

---

## 5. 方案 D：扩展契约 + anchor 注入

### 5.1 致命问题（§1.4 详述）

LLM 看到含前缀 prompt → 摘录到 risk.clauseText 含前缀 → redlineInjector / commentInjector 在 OOXML（无前缀）上严格行级匹配 100% 失败。dmp 容忍度路径**不在** redline / comment 主路径（仅在 anchorMigrate.ts Phase B 客户回传场景），无法兜底。

### 5.2 ClauseSegment 契约扩展（OCP 开闭原则）

```ts
// shared/types/contract.ts
export interface ClauseSegment {
    index: number
    number: string | null
    text: string                          // 保持不变（向后兼容，含编号字符）
    textWithoutNumber: string             // 新增：不含编号字符（anchor 锚定专用）
    offsetStart: number
    offsetEnd: number
    offsetStartWithoutNumber: number      // 新增：textWithoutNumber 在 normalizedText 中的起始 offset
}

export interface ClauseSnapshotItem {
    index: number
    text: string
    textWithoutNumber: string             // 新增（与 ClauseSegment 同步）
    offsetStart: number
    offsetEnd: number
    offsetStartWithoutNumber: number      // 新增
}
```

**为什么是扩展而非修改 segment.text**：
- segment.text 是 LLM prompt 的 clauseTextRaw 来源（`analyzeSingleClause.ts:125-127`）；改它会破坏粘贴文本路径下 LLM 视角，引入 LLM 输出质量回归风险
- 新增字段 textWithoutNumber 让两条路径并行使用：LLM prompt 仍用 segment.text（视角不变），下游 anchor 用 textWithoutNumber（精确匹配 OOXML）
- 现有所有 segment.text 调用方零 breaking change

### 5.3 实施清单

**实施点 1**：`server/agents/contract/docx/clauseSegmenter.ts:230-249` 切分逻辑填充新字段：

```ts
for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.lineIdx
    const end = i + 1 < matches.length ? matches[i + 1]!.lineIdx : lines.length
    const raw = lines.slice(start, end).join('\n')
    const text = raw.trim()
    if (!text) continue

    const rawStart = lineStarts[start]!
    const trimOffset = raw.indexOf(text)
    const offsetStart = rawStart + trimOffset

    // 剥编号字符：构造 textWithoutNumber + offsetStartWithoutNumber
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
```

**实施点 2**：`server/agents/contract/uploadClientVersion.service.ts:174-179` snapshot 写入：

```ts
newClauses = segments.map(s => ({
    index: s.index,
    text: s.text,
    textWithoutNumber: s.textWithoutNumber,
    offsetStart: s.offsetStart,
    offsetEnd: s.offsetEnd,
    offsetStartWithoutNumber: s.offsetStartWithoutNumber,
}))
```

**实施点 3**（核心）：risk 落库时通过 `row.clauseText` 注入 `textWithoutNumber`，复用现有「双锚点 · 层 1」机制（`contractRisk.service.ts:98`）：

```ts
// uploadClientVersion.service.ts:761 增量审查路径
const segmentByIndex = new Map(newClauses.map(c => [c.index, c]))
const risksToWrite: PersistAiRiskRow[] = aiRisks.map(risk => ({
    risk,
    source: 'ai',
    // 新增：用 segment.textWithoutNumber 覆盖 LLM 自填的 clauseText（含编号）
    clauseText: segmentByIndex.get(risk.clauseIndex)?.textWithoutNumber ?? risk.clauseText,
    clauseParagraphIndex: clauseToParaMap.get(risk.clauseIndex) ?? null,
}))
await persistAiRisksAsContractRows({ reviewId, rows: risksToWrite, tx })
```

```ts
// server/agents/contract/contractReviewMainAgent.ts 首次审查路径
// 同样在调用 persistAiRisksAsContractRows 时传入 row.clauseText = segment.textWithoutNumber
```

**实施点 4**：无。redlineInjector / commentInjector / reviewResultPersistence / redlineLocate **零改动**——它们读到的 contractRisks.clauseText 已经是 textWithoutNumber（不含编号），在 OOXML（不含编号）上严格匹配自然通过。

### 5.4 链路对比

| 阶段 | 字段 | PR10 之前 | PR10 之后（方案 D） |
|---|---|---|---|
| LLM prompt 视角 | `ctx.clause.text` | 来自 segment.text | 来自 segment.text（**不变**，仍含编号） |
| LLM 输出 | `risk.clauseText` | LLM 摘录（可能含/不含编号） | LLM 摘录（**不变**） |
| risk 落库 | `contractRisks.clauseText` | LLM 输出原文 | **被 segment.textWithoutNumber 覆盖**（不含编号） |
| redlineInjector 比对 | OOXML `<w:t>` accumulated | 永远不含编号 | 永远不含编号 |
| 严格 `!==` 校验 | | LLM 输出 vs OOXML 不一致时失败 | textWithoutNumber vs OOXML 一致 ✓ |

---

## 6. 与下游兼容性分析

### 6.1 paragraphs 数量不变

prefix 拼接发生在每个段落 in-place，不增不减。`commentInjector` / `redlineInjector` 用 `clauseParagraphIndex` 定位段落，行为不变。

### 6.2 redline / comment 锚点链路（替换原 §5.2 错误论述）

> ⚠️ 修订前的设计文档 §5.2 用 dmp Match_Threshold=0.3 论证兼容性是错的：dmp 仅在 `textSimilarity.ts:108` 用于 `anchorMigrate.ts`（Phase B 客户回传锚点迁移），redline / comment 主路径不走 dmp。

**redlineInjector / redlineLocate.ts:177**：严格行级 `paragraphTextWithRunRule(para) !== lines[startHit.lineIdx] return null`。
**commentInjector.ts:412-433**：`paraText.includes(quoteLine ≥ 8 字符)` 严格包含。

PR10 后 `contractRisks.clauseText` 落库为 segment.textWithoutNumber（剥过编号），与 OOXML `<w:t>` 累积文本（永远不含编号）严格一致——两条路径都通过。

### 6.3 既有 review 数据兼容性

| 场景 | 兼容性 |
|---|---|
| 旧 review 已存的 risk（PR10 前 mammoth 输出无前缀，clauseText 不含编号） | **天然兼容**——旧数据 clauseText 也是不含编号的，与 PR10 后 textWithoutNumber 同口径 ✓ |
| 旧 review 重审 / 客户回传 | 新 docxText 含前缀但 contractRisks.clauseText 仍是不含编号；anchorMigrate 走 PR7 双锚点（dmp Match_Threshold≈30% 编辑距离阈值）能容忍少量改动 ✓ |
| 新 review（PR10 后）| 完整修复，子项段落级定位 ✓ |

### 6.4 reviewedFile 导出

`commentInjector` / `redlineInjector` 用 OOXML AST 操作 `<w:p>`，不依赖前缀文本——导出的 reviewed.docx 保留 Word 原始 numbering 渲染，前缀依然由 Word 自动生成。**导出 docx 与现状一致**，不会出现重复编号。

---

## 7. 测试策略

### 7.1 单元测试 `tests/server/assistant/contract/docx/numbering.test.ts`

| 用例 | 验证 |
|---|---|
| decimal `"%1."` ilvl=0 | "1." → "2." → "3." 连续渲染 + 尾部空格 |
| decimal `"（%1）"` ilvl=0 | "（1）" → "（2）" |
| chineseCounting `"%1、"` ilvl=0 | "一、" → "二、" → "三、" |
| chineseLegalSimplified | "壹、" → "贰、" |
| decimalEnclosedCircle | "①" → "②" |
| lowerLetter / upperLetter | "a" / "b" / "A" / "B" |
| lowerRoman / upperRoman | "i" / "ii" / "I" / "II" |
| **bullet `"￮"` skip** | bullet 段不写入 prefixMap + logger.info 计数 |
| **空 lvlText `""` skip** | 不写入 prefixMap + logger.warn 计数 |
| 多层嵌套 ilvl=1 lvlText=`"%1.%2"` | "1.1" / "1.2" / "2.1"（父级 ++ 子级 reset）|
| 多层嵌套 ilvl=2 lvlText=`"%1.%2.%3"` | "1.1.1" / "1.1.2" |
| `<w:start val="3"/>` | 从 "3." 开始 |
| numId 引用不存在 abstractNumId | 跳过该段 + logger.warn |
| 未识别 numFmt（如 `hindiNumbers`） | 跳过 + logger.warn |
| numbering.xml 缺失（普通 docx 无 list） | 空 prefixMap |
| **含表格 docx，prefixMap 与 astParagraphs 同源** | 前缀拼到正确段落（验证 §4 表格索引修复） |

### 7.2 单元测试 `tests/server/assistant/contract/docx/clauseSegmenter.test.ts` 扩展

| 用例 | 验证 |
|---|---|
| 单数字「1. 合同期限...」 | segment.text="1. 合同期限..."、**textWithoutNumber="合同期限..."**、offsetStartWithoutNumber 比 offsetStart 大 3 |
| 「第一条 总则」 | textWithoutNumber="总则"（剥掉「第一条 」） |
| 「一、双方义务」 | textWithoutNumber="双方义务" |
| 多级「3.1 子项 A」 | textWithoutNumber="子项 A" |
| 无编号正文段（合并到父条款） | textWithoutNumber === text（不剥） |

### 7.3 集成测试 `tests/server/assistant/contract/docx/parser.test.ts` 扩展

```ts
it('parseContractDocx 给 list 段落拼接 numbering 前缀', async () => {
    const buffer = readFileSync('prisma/seeds/contract-samples/labor.docx')
    const { paragraphs } = await parseContractDocx(buffer)
    expect(paragraphs.some(p => p.startsWith('1. 合同期限'))).toBe(true)
    expect(paragraphs.some(p => p.startsWith('2. 试用期'))).toBe(true)
})

it('parseContractDocx → segmentClauses 切到子项级（与粘贴文本路径一致）', async () => {
    const buffer = readFileSync('prisma/seeds/contract-samples/labor.docx')
    const { paragraphs } = await parseContractDocx(buffer)
    const fullText = paragraphs.join('\n')
    const { segments } = await segmentClauses(fullText)
    expect(segments.length).toBeGreaterThanOrEqual(15)
    // 验证 textWithoutNumber 不含编号
    expect(segments.find(s => s.number === '1.')!.textWithoutNumber).not.toMatch(/^1\./)
})
```

### 7.4 集成测试 `tests/server/assistant/contract/contractRisk.service.test.ts` 扩展

| 用例 | 验证 |
|---|---|
| persistAiRisksAsContractRows row.clauseText 注入 | DB 落库 contractRisks.clauseText === row.clauseText（覆盖 LLM 自填）|
| docx 上传 → risk 落库 → redlineLocate 严格匹配 | 不返回 null，定位到正确 paraIdx + runIdx |

### 7.5 回归测试

- 既有 `parser.test.ts` / `clauseSegmenter.test.ts` / `commentInjector.test.ts` / `redlineInjector.test.ts` / `uploadClientVersion.service.test.ts` 单测无回归
- 既有 `analyzeSingleClause.test.ts` 无回归（ctx.clause.text 仍来自 segment.text，LLM prompt 视角不变）

### 7.6 手工冒烟

按 review #891 同款合同重传 → 验证：
1. 审查中/审查后都能定位到子项段落（与 review #890 粘贴文本路径一致）
2. 导出 reviewed.docx 不出现重复编号
3. 子项 risk 的 redline / comment 都能正确写回

---

## 8. 风险与 mitigation

| 风险 | 影响 | mitigation |
|---|---|---|
| 真实合同有自定义 numbering 我们没覆盖（罕见 numFmt：hindiNumbers / japaneseCounting / koreanLegal） | 子项不识别，降级到父条款级（与 PR10 之前一致）| logger.warn 埋点 + 不破坏现状 |
| 真实合同用 styles.xml 间接 list 样式（`<w:pStyle>` 引用 list style） | styled list 段落不识别 | logger.warn 命中后 PR11 追加（YAGNI）|
| **prefixMap 与 paragraphs 异源**（mammoth 跳过表格段，prefixMap 走全树） | 前缀错位拼到非 list 段落 | §4 实施：prefixMap 非空时强制走 AST，保证两者同源 |
| **空 lvlText 拼空格污染** | 段落首多一个空格字符，污染 LLM 视角与 anchor | §3.4 renderLvlText 空 lvlText / 渲染后空白 → return null skip |
| **bullet 字符进入 segment.text** | "￮" 进入下游字段污染原文 | §3.3 buildNumberingPrefixMap 入口对 bullet 显式 skip 不写入 prefixMap |
| Phase B 客户回传场景兼容性（旧 risk.clauseText vs 新 docxText 含前缀） | 锚点迁移失败 | dmp Match_Threshold≈30% 编辑距离阈值（实测 textSimilarity.ts:108 + 1000 字符 distance），3 字符前缀完全在容忍范围 |
| ilvl 父级 ++ 子级 reset 实现 bug | "1.1" 后续段子级 counter 不归零导致 "1.3" 跳到 "2.1" 时算错 | 单测覆盖父级 ++ 子级 reset case |
| 非 decimal/chineseCounting 的 numFmt（如 `chineseLegalSimplified`「壹」/ `decimalEnclosedCircle`「①」/ Roman / Letter）拼前缀但 segmentClauses 切不动 | 子项仍合并到父条款（与 PR10 之前一致，但 segment.text 多了"壹、"等字符） | logger.warn 命中 + PR11+ 视实测分布扩展 clauseSegmenter 正则；中间态 segment.textWithoutNumber 仍能正确剥（matches[i].number 来自 RE_xxx 命中规则） |

---

## 9. 后续路线（不在 PR10 范围）

- **数据迁移脚本**：把既有 review 的 docxText / risks.clauseParagraphIndex 重新跑一遍 PR10 修复后的 parseContractDocx + segmentClauses，让旧 review 也享有子项级定位。当前 YAGNI（接受新旧不一致）
- **罕见 numFmt 支持**：hindiNumbers / japaneseCounting / koreanLegal 等。当前 logger.warn 命中后单独 PR 追加
- **clauseSegmenter 正则扩展**：让「（一）」「①」「a.」「i.」「壹、」等被识别为子项编号。当前 PR11+ 视实测分布按需补
- **styles.xml 间接 list 样式**：`<w:pStyle>` 引用 list style 的场景。当前 YAGNI（中国合同罕见）
- **图片 bullet（lvlPicBulletId）**：用图片作 bullet 的场景。当前 YAGNI

---

## 10. PR 拆分

| # | PR | 内容 | 工期 |
|---|---|---|---|
| 10 | `contract-pr10-ooxml-numbering` | numbering.ts 新建 + parser.ts 改造（含表格索引修复）+ ClauseSegment 契约扩展 + clauseSegmenter 填充 + uploadClientVersion / contractReviewMainAgent 注入 row.clauseText + 单测 + 集成测试 | 1.5 天 |

合并发布约束：

- 与 PR7/8/9 独立无依赖，可在 origin/dev 任意基础上 cut 分支
- merge 后新建 review 自动用修复版本；既有 review 不动
- 数据库 schema 无变更（snapshot 是 JSONB，扩展字段不需迁移）
