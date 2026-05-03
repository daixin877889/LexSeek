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

    // Task 5-8 在此基础上实现段落遍历 + 渲染
    return prefixMap
}
