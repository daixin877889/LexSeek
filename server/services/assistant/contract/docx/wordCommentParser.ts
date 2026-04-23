/**
 * 解析 docx 文件中的 word/comments.xml，提取所有 Word 原生批注。
 *
 * 用正则字符串扫描，与项目现有 xmlUtils.ts 保持一致，不引入 fast-xml-parser。
 */
import { loadDocxZip } from './zipRewriter'

export interface ParsedWordComment {
    wId: number
    wAuthor: string
    wInitials: string
    content: string
    parentWId: number | null
    dateIso: string | null
}

// 匹配单个完整 <w:comment ...>...</w:comment> 块
const COMMENT_BLOCK_RE = /<w:comment\s([^>]*)>([\s\S]*?)<\/w:comment>/g

// 匹配属性值 w:name="value"
function extractAttr(attrs: string, name: string): string | null {
    const re = new RegExp(`w:${name}="([^"]*)"`)
    const m = re.exec(attrs)
    return m ? m[1] : null
}

// 提取段落内所有 <w:t> 文本，多段用 \n 分隔
function extractContent(inner: string): string {
    const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
    const paragraphs: string[] = []
    let pm: RegExpExecArray | null
    while ((pm = paraRe.exec(inner)) !== null) {
        const tRe = /<w:t(?:[^>]*)>([\s\S]*?)<\/w:t>/g
        const parts: string[] = []
        let tm: RegExpExecArray | null
        while ((tm = tRe.exec(pm[0])) !== null) {
            parts.push(tm[1])
        }
        paragraphs.push(parts.join(''))
    }
    return paragraphs.join('\n')
}

// 解码 XML 5 字符标准转义
function unescapeXml(s: string): string {
    return s
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
}

/**
 * 解析 docx Buffer 中的所有 Word 批注。
 * 若 docx 无 word/comments.xml（原始未批注文件），返回空数组。
 */
export async function parseWordComments(docxBuffer: Buffer): Promise<ParsedWordComment[]> {
    const zip = await loadDocxZip(docxBuffer)
    const file = zip.file('word/comments.xml')
    if (!file) return []

    const xml = await file.async('string')
    const result: ParsedWordComment[] = []

    COMMENT_BLOCK_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = COMMENT_BLOCK_RE.exec(xml)) !== null) {
        const attrs = m[1]
        const inner = m[2]

        const idStr = extractAttr(attrs, 'id')
        if (idStr === null) continue
        const wId = parseInt(idStr, 10)
        if (isNaN(wId)) continue

        const parentIdStr = extractAttr(attrs, 'parentId')
        const parentWId = parentIdStr !== null ? parseInt(parentIdStr, 10) : null

        result.push({
            wId,
            wAuthor: unescapeXml(extractAttr(attrs, 'author') ?? ''),
            wInitials: unescapeXml(extractAttr(attrs, 'initials') ?? ''),
            content: unescapeXml(extractContent(inner)),
            parentWId: parentWId !== null && !isNaN(parentWId) ? parentWId : null,
            dateIso: extractAttr(attrs, 'date'),
        })
    }

    return result
}
