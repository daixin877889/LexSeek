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

        // bullet 显式 skip：拼 "￮" "•" 会污染原文且 segmentClauses 不识别为编号
        if (lvl.numFmt === 'bullet') {
            logger.info('[numbering] bullet 段落跳过不拼前缀', { numId, ilvl, paraIndex })
            return
        }

        // counter ++ 或首次取 start
        const counterKey = `${numId}:${ilvl}`
        const currentCount = counters.has(counterKey)
            ? counters.get(counterKey)! + 1
            : lvl.start
        counters.set(counterKey, currentCount)

        // 子层级 reset 子层 counter（OOXML 规则：父级 ++ 时子级归零）
        // 实施：删除子层 counter，下次见时按 start 重启
        for (const [k] of counters) {
            const [kNumId, kIlvlStr] = k.split(':')
            if (kNumId === String(numId) && parseInt(kIlvlStr!, 10) > ilvl) {
                counters.delete(k)
            }
        }

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

/** 把数字渲染成对应 numFmt 的字符串。未识别格式返回 null。*/
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
