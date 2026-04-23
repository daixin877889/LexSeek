/**
 * 解析 docx 文件中的 word/comments.xml，提取所有 Word 原生批注。
 * annotationRefsByWId 从 w:initials 字段（LEXSEEK-{id}-{rand8} 格式）派生，
 * 非 LEXSEEK 格式的批注（旧格式或外部批注）不写入此 Map。
 *
 * 用正则字符串扫描，与项目现有 xmlUtils.ts 保持一致，不引入 fast-xml-parser。
 */
import { loadDocxZip } from './zipRewriter'
import { parseWordCommentRef } from '../utils/wordCommentRef'

export interface ParsedWordComment {
    wId: number
    wAuthor: string
    wInitials: string
    content: string
    parentWId: number | null
    dateIso: string | null
    /**
     * 批注锚点所在的"非空段落"序号（0-based）；
     * 若 document.xml 中找不到 commentRangeStart 为 null。
     * 与 commentInjector 的 scanNonEmptyParagraphs 序号体系一致，前端 locate 时同口径。
     */
    anchorParagraphIndex: number | null
}

export interface AnnotationRefEntry {
    annotationId: number
    ref: string
}

/**
 * parseWordComments 的完整返回结构。
 *
 * - comments：全部 Word 批注
 * - annotationRefsByWId：wId → {annotationId, ref} 映射，从 w:initials（LEXSEEK 格式）派生。
 *   非 LEXSEEK 格式的批注（旧格式或外部批注）不写入此 Map。
 */
export interface ParsedDocxComments {
    comments: ParsedWordComment[]
    annotationRefsByWId: Map<number, AnnotationRefEntry>
}

// 匹配单个完整 <w:comment ...>...</w:comment> 块
const COMMENT_BLOCK_RE = /<w:comment\s([^>]*)>([\s\S]*?)<\/w:comment>/g

// 匹配属性值 w:name="value"
function extractAttr(attrs: string, name: string): string | null {
    const re = new RegExp(`w:${name}="([^"]*)"`)
    const m = re.exec(attrs)
    return m ? (m[1] ?? null) : null
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
            parts.push(tm[1] ?? '')
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
 * annotationRefsByWId 从每条批注的 w:initials 字段派生：
 *   符合 LEXSEEK-{id}-{rand8} 格式的批注写入此 Map；其余忽略。
 * 若 docx 无 word/comments.xml，comments 为空数组，annotationRefsByWId 为空 Map。
 */
export async function parseWordComments(docxBuffer: Buffer): Promise<ParsedDocxComments> {
    const zip = await loadDocxZip(docxBuffer)

    const file = zip.file('word/comments.xml')
    if (!file) return { comments: [], annotationRefsByWId: new Map() }

    const xml = await file.async('string')
    const comments: ParsedWordComment[] = []

    COMMENT_BLOCK_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = COMMENT_BLOCK_RE.exec(xml)) !== null) {
        const attrs = m[1] ?? ''
        const inner = m[2] ?? ''

        const idStr = extractAttr(attrs, 'id')
        if (idStr === null) continue
        const wId = parseInt(idStr, 10)
        if (isNaN(wId)) continue

        const parentIdStr = extractAttr(attrs, 'parentId')
        const parentWId = parentIdStr !== null ? parseInt(parentIdStr, 10) : null

        comments.push({
            wId,
            wAuthor: unescapeXml(extractAttr(attrs, 'author') ?? ''),
            wInitials: unescapeXml(extractAttr(attrs, 'initials') ?? ''),
            content: unescapeXml(extractContent(inner)),
            parentWId: parentWId !== null && !isNaN(parentWId) ? parentWId : null,
            dateIso: extractAttr(attrs, 'date'),
            anchorParagraphIndex: null, // 下面由 document.xml 填充
        })
    }

    // 从 document.xml 反查每条 comment 的锚点段落序号（与 commentInjector 的 scanNonEmptyParagraphs 同口径）
    const docFile = zip.file('word/document.xml')
    if (docFile) {
        const docXml = await docFile.async('string')
        const wIdToParaIdx = buildCommentAnchorMap(docXml)
        for (const c of comments) {
            const idx = wIdToParaIdx.get(c.wId)
            if (typeof idx === 'number') c.anchorParagraphIndex = idx
        }
    }

    const annotationRefsByWId = new Map<number, AnnotationRefEntry>()
    for (const c of comments) {
        const parsed = parseWordCommentRef(c.wInitials)
        if (parsed) {
            annotationRefsByWId.set(c.wId, { annotationId: parsed.annotationId, ref: c.wInitials })
        }
    }

    return { comments, annotationRefsByWId }
}

/**
 * 扫描 document.xml，为每个 w:commentRangeStart 标记找到它所在的"非空段落"序号。
 * 非空段落定义：含 <w:r> 的 <w:p>，与 commentInjector 一致，保证前端/服务端 locate 同口径。
 */
function buildCommentAnchorMap(documentXml: string): Map<number, number> {
    const result = new Map<number, number>()
    const paraRe = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
    const rangeStartRe = /<w:commentRangeStart\s[^/]*w:id="(\d+)"/g

    let nonEmptyIdx = 0
    let pm: RegExpExecArray | null
    while ((pm = paraRe.exec(documentXml)) !== null) {
        const pText = pm[0]
        if (!/<w:r[\s>]/.test(pText)) continue
        rangeStartRe.lastIndex = 0
        let sm: RegExpExecArray | null
        while ((sm = rangeStartRe.exec(pText)) !== null) {
            const wId = parseInt(sm[1]!, 10)
            if (!isNaN(wId) && !result.has(wId)) {
                // 一条 comment 可能跨多段，记首次出现的段落
                result.set(wId, nonEmptyIdx)
            }
        }
        nonEmptyIdx++
    }
    return result
}
