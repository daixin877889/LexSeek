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
import { loadDocxZip, readTextFromZip } from './zipRewriter'
import { parseOoxml, findFirst, walk, tagOf, paragraphText, hasRunChild, type NodeArray } from './xmlAst'

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

export async function parseContractDocx(buffer: Buffer): Promise<ParsedContract> {
    const { value: rawText } = await mammoth.extractRawText({ buffer })
    let paragraphs = rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

    const zip = await loadDocxZip(buffer)
    const rawXml = await readTextFromZip(zip, 'word/document.xml')

    // DOCX-H4 fallback：若 mammoth 段落数远小于 AST 中的 w:p 总数，
    // 说明含表格被跳过；改用 AST 完整提取（含表格内段落）。
    const astParagraphs = paragraphsFromAst(rawXml)
    if (
        astParagraphs.length > paragraphs.length
        && (astParagraphs.length === 0
            || paragraphs.length / astParagraphs.length < TABLE_FALLBACK_RATIO)
    ) {
        paragraphs = astParagraphs
    }

    return { paragraphs, rawXml }
}
