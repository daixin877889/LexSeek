/**
 * 解析 docx 文件中的 word/comments.xml，提取所有 Word 原生批注。
 *
 * 实现切换到 fast-xml-parser AST（见 xmlAst.ts）：
 * - 不再用正则扫 `<w:comment>` / `<w:commentRangeStart>`
 * - 属性读取、XML 实体解码、子节点文本合并都交给 parser
 * - 保留原行为不变（见单测），但消除"正则能匹配 Word 的所有合法格式"的赌注
 */
import type JSZip from 'jszip'
import { loadDocxZip } from './zipRewriter'
import { parseCommentRef } from '../utils/wordCommentRef'
import {
    parseOoxml,
    tagOf,
    childrenOf,
    getAttr,
    walk,
    findAll,
    textOf,
    hasRunChild,
} from './xmlAst'

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
     * 与 commentInjector 的非空段落序号体系一致，前端 locate 时同口径。
     */
    anchorParagraphIndex: number | null
}

export interface AnnotationRefEntry {
    /** docx 身份证里声明的归属 review；跨 review 上传时 upload 侧要拒绝 */
    reviewId: number
    annotationId: number
    /** 识别来源。customXml 是最稳的权威源；author 是 Word 不截断的兜底；initials 已弃用 */
    source: 'customXml' | 'author'
    /** 调试/审计用的原始字符串（customXml 里拼 LEXSEEK-{id}-{rand}，author 里是 w:author 原值） */
    ref: string
}

/**
 * parseWordComments 的完整返回结构。
 *
 * - comments：全部 Word 批注
 * - annotationRefsByWId：wId → {annotationId, ref} 映射。识别优先级：
 *     1. customXml/annotationRefs.xml（Word/WPS 不篡改，主防线）
 *     2. w:author 尾部 `[#id-rand8]`（LibreOffice 清掉 customXml 时的兜底）
 *     3. w:initials 的 LEXSEEK 字面量（Phase B 老 docx 兼容）
 */
export interface ParsedDocxComments {
    comments: ParsedWordComment[]
    annotationRefsByWId: Map<number, AnnotationRefEntry>
}

/**
 * 解析 docx Buffer 中的所有 Word 批注。
 *
 * 若 docx 无 `word/comments.xml`，comments 为空数组，annotationRefsByWId 为空 Map。
 */
export async function parseWordComments(docxBuffer: Buffer): Promise<ParsedDocxComments> {
    const zip = await loadDocxZip(docxBuffer)

    const commentsFile = zip.file('word/comments.xml')
    if (!commentsFile) return { comments: [], annotationRefsByWId: new Map() }

    const commentsXml = await commentsFile.async('string')
    const comments = parseCommentNodes(commentsXml)

    // 从 document.xml 反查每条 comment 的锚点段落
    const docFile = zip.file('word/document.xml')
    if (docFile) {
        const docXml = await docFile.async('string')
        const wIdToParaIdx = buildCommentAnchorMap(docXml)
        for (const c of comments) {
            const idx = wIdToParaIdx.get(c.wId)
            if (typeof idx === 'number') c.anchorParagraphIndex = idx
        }
    }

    // 按优先级构建 wId → {reviewId, annotationId} 映射：
    //   1. customXml（Word 不篡改的权威源）
    //   2. w:author 尾 [#reviewId-annotationId-rand8]（LibreOffice 清 customXml 时兜底）
    const annotationRefsByWId = new Map<number, AnnotationRefEntry>()
    const customXmlMap = await readCustomXmlRefs(zip)
    for (const c of comments) {
        const fromCustomXml = customXmlMap.get(c.wId)
        if (fromCustomXml) {
            annotationRefsByWId.set(c.wId, fromCustomXml)
            continue
        }
        const parsed = parseCommentRef(c.wAuthor, c.wInitials)
        if (parsed) {
            annotationRefsByWId.set(c.wId, {
                reviewId: parsed.reviewId,
                annotationId: parsed.annotationId,
                source: 'author',
                ref: c.wAuthor || '',
            })
        }
    }

    return { comments, annotationRefsByWId }
}

/** AST 解析 comments.xml 的所有 <w:comment> 节点 */
function parseCommentNodes(xml: string): ParsedWordComment[] {
    const ast = parseOoxml(xml)
    const result: ParsedWordComment[] = []
    for (const node of findAll(ast, 'w:comment')) {
        const idStr = getAttr(node, 'w:id')
        if (idStr == null) continue
        const wId = parseInt(idStr, 10)
        if (isNaN(wId)) continue

        const parentStr = getAttr(node, 'w:parentId')
        const parentWId = parentStr != null ? parseInt(parentStr, 10) : null

        result.push({
            wId,
            wAuthor: getAttr(node, 'w:author') ?? '',
            wInitials: getAttr(node, 'w:initials') ?? '',
            content: collectCommentText(node),
            parentWId: parentWId !== null && !isNaN(parentWId) ? parentWId : null,
            dateIso: getAttr(node, 'w:date') ?? null,
            anchorParagraphIndex: null, // 后续 document.xml 扫描填充
        })
    }
    return result
}

/** 收集 <w:comment> 下所有段落的文本，多段用 \n 分隔 */
function collectCommentText(commentNode: Record<string, unknown>): string {
    const paragraphs: string[] = []
    for (const para of childrenOf(commentNode)) {
        if (tagOf(para) !== 'w:p') continue
        const parts: string[] = []
        walk([para], (n) => {
            if (tagOf(n) === 'w:t') parts.push(textOf(n))
        })
        paragraphs.push(parts.join(''))
    }
    return paragraphs.join('\n')
}

/**
 * 读 `word/customXml/annotationRefs.xml` 的 wId → {reviewId, annotationId} 映射。
 * 文件不存在、缺 reviewId 或损坏时跳过该条目，上层自动走 author fallback。
 */
async function readCustomXmlRefs(zip: JSZip): Promise<Map<number, AnnotationRefEntry>> {
    const result = new Map<number, AnnotationRefEntry>()
    const file = zip.file('word/customXml/annotationRefs.xml')
    if (!file) return result
    try {
        const xml = await file.async('string')
        const ast = parseOoxml(xml)
        for (const node of findAll(ast, 'ref')) {
            const wIdStr = getAttr(node, 'wId')
            const annIdStr = getAttr(node, 'annotationId')
            const reviewIdStr = getAttr(node, 'reviewId')
            if (!wIdStr || !annIdStr || !reviewIdStr) continue
            const wId = parseInt(wIdStr, 10)
            const annotationId = parseInt(annIdStr, 10)
            const reviewId = parseInt(reviewIdStr, 10)
            if (isNaN(wId) || isNaN(annotationId) || isNaN(reviewId)) continue
            const rand = getAttr(node, 'rand') ?? ''
            result.set(wId, {
                reviewId,
                annotationId,
                source: 'customXml',
                ref: rand ? `LEXSEEK-${annotationId}-${rand}` : `LEXSEEK-${annotationId}`,
            })
        }
    } catch { /* 文件损坏，走 fallback */ }
    return result
}

/**
 * 扫描 document.xml，建立 wId → 非空段落序号 的映射。
 *
 * "非空段落"：body 下直接子 `<w:p>` 中含 `<w:r>` 的那些，与 commentInjector
 * 的段落扫描口径一致，确保前后端 locate 同步。
 */
function buildCommentAnchorMap(documentXml: string): Map<number, number> {
    const ast = parseOoxml(documentXml)
    const result = new Map<number, number>()

    // 找到 w:body 下的直接子 <w:p>（不递归进表格内的段落，和现有行为一致）
    const body = findAll(ast, 'w:body')[0]
    if (!body) return result

    let nonEmptyIdx = 0
    for (const para of childrenOf(body)) {
        if (tagOf(para) !== 'w:p') continue
        if (!hasRunChild(para)) continue
        // 遍历段落内所有 commentRangeStart，记首次出现的段落（跨段 comment 取第一段）
        walk([para], (n) => {
            if (tagOf(n) !== 'w:commentRangeStart') return
            const idStr = getAttr(n, 'w:id')
            if (!idStr) return
            const wId = parseInt(idStr, 10)
            if (!isNaN(wId) && !result.has(wId)) result.set(wId, nonEmptyIdx)
        })
        nonEmptyIdx++
    }
    return result
}
