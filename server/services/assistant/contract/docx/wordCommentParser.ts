/**
 * 解析 docx 文件中的 word/comments.xml，提取所有 Word 原生批注。
 * Phase B 新增：同时解析 word/customXml/annotationRefs.xml，提供可靠的 wId→annotationId 映射。
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

export interface AnnotationRefEntry {
    annotationId: number
    ref: string
}

/**
 * parseWordComments 的完整返回结构。
 *
 * - comments：全部 Word 批注（与原来的数组语义相同）
 * - annotationRefsByWId：从 word/customXml/annotationRefs.xml 解析的 wId → {annotationId, ref} 映射。
 *   若 docx 不含 customXml（Phase B 之前导出的旧 docx 或非系统导出文件），此 Map 为空，
 *   调用方应 fallback 到 wInitials 解析路径。
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

// 匹配 customXml 中单个 <ref .../>
const ANNOTATION_REF_RE = /<ref\s([^/]*)\/?>/g

/**
 * 解析 word/customXml/annotationRefs.xml，提取 wId→{annotationId, ref} 映射。
 * 若文件不存在或解析失败，返回空 Map（调用方负责 fallback）。
 */
async function parseAnnotationRefs(zip: ReturnType<typeof loadDocxZip> extends Promise<infer T> ? T : never): Promise<Map<number, AnnotationRefEntry>> {
    const map = new Map<number, AnnotationRefEntry>()
    const file = zip.file('word/customXml/annotationRefs.xml')
    if (!file) return map

    try {
        const xml = await file.async('string')
        ANNOTATION_REF_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = ANNOTATION_REF_RE.exec(xml)) !== null) {
            const attrs = m[1] ?? ''
            const wIdStr = /\bwId="([^"]*)"/.exec(attrs)?.[1]
            const annIdStr = /\bannotationId="([^"]*)"/.exec(attrs)?.[1]
            const ref = /\bref="([^"]*)"/.exec(attrs)?.[1]
            if (wIdStr == null || annIdStr == null || ref == null) continue
            const wId = parseInt(wIdStr, 10)
            const annotationId = parseInt(annIdStr, 10)
            if (isNaN(wId) || isNaN(annotationId)) continue
            map.set(wId, { annotationId, ref: unescapeXml(ref) })
        }
    } catch {
        // 解析失败时静默降级，返回空 Map
    }
    return map
}

/**
 * 解析 docx Buffer 中的所有 Word 批注及 customXml annotation 映射。
 * 若 docx 无 word/comments.xml（原始未批注文件），comments 为空数组。
 * 若 docx 无 word/customXml/annotationRefs.xml（旧格式），annotationRefsByWId 为空 Map。
 */
export async function parseWordComments(docxBuffer: Buffer): Promise<ParsedDocxComments> {
    const zip = await loadDocxZip(docxBuffer)

    // 并行解析 comments.xml 和 annotationRefs.xml
    const [comments, annotationRefsByWId] = await Promise.all([
        (async (): Promise<ParsedWordComment[]> => {
            const file = zip.file('word/comments.xml')
            if (!file) return []

            const xml = await file.async('string')
            const result: ParsedWordComment[] = []

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
        })(),
        parseAnnotationRefs(zip),
    ])

    return { comments, annotationRefsByWId }
}
