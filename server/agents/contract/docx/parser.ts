/**
 * 合同 .docx 段落提取。
 *
 * 返回：
 * - paragraphs：非空段落文本数组，索引即 spec §10.4 定义的 clauseIndex
 * - rawXml：word/document.xml 原文，供 commentInjector 按顺序定位 <w:p>
 *
 * DOCX-H4 修复：mammoth.extractRawText 不展开 w:tbl 单元格内的段落，含表格的合同
 * 表格内容会丢段。补 fallback：rawText 段落数 / rawXml 内 w:p 节点总数 < 60% 时
 * 视为 mammoth 漏段，改用 AST 直读 body 内全部 w:p（含 w:tbl 内嵌套）。
 */
import mammoth from 'mammoth'
import { loadDocxZip, readTextFromZip, type DocxZip } from './zipRewriter'
import { parseOoxml, findFirst, walk, tagOf, paragraphText, hasRunChild, splitParagraphs, type NodeArray } from './xmlAst'
import { buildNumberingPrefixMap, type NumberingPrefixMap } from './numbering'

export interface ParsedContract {
    paragraphs: string[]
    rawXml: string
}

const TABLE_FALLBACK_RATIO = 0.6

/** 直接 AST 解析 word/document.xml 的 w:body：递归收集所有非空 w:p（含 w:tbl 内嵌套） */
function paragraphsFromAst(rawXml: string): string[] {
    try {
        const ast = parseOoxml(rawXml)
        const body = findFirst(ast, 'w:body')
        if (!body) return []
        const out: string[] = []
        walk((body as Record<string, unknown>)['w:body'] as NodeArray, (n) => {
            if (tagOf(n) !== 'w:p') return
            if (!hasRunChild(n)) return
            const text = paragraphText(n).trim()
            if (text.length > 0) out.push(text)
        })
        return out
    } catch {
        return []
    }
}

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
