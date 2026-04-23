/**
 * Word 原生批注注入：按 spec §10.1 改四处文件，按 §10.2 五模块格式写 comments.xml。
 * Phase B 新增 injectAnnotations：按 annotation 逐条注入，支持 wordCommentRef / 答复批注。
 */
import type { Risk, RiskLevel, AnnotationAuthorType } from '#shared/types/contract'
import {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
} from './zipRewriter'
import { appendChildXml, escapeXml } from './xmlUtils'
import { generateWordCommentRef } from '../utils/wordCommentRef'

const LEVEL_LABEL: Record<RiskLevel, string> = {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
}

const COMMENTS_OVERRIDE =
    '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'

const COMMENTS_REL =
    '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>'

/** 生成五模块批注文本（含问题摘要） */
function buildCommentText(risk: Risk): string {
    const lines: string[] = []
    lines.push(`[${LEVEL_LABEL[risk.level]}] ${risk.category}`)
    lines.push(risk.problem)
    lines.push('')
    if (risk.legalBasis) {
        lines.push(`【法律依据】${risk.legalBasis}`)
        lines.push('')
    }
    lines.push('【条款分析】')
    lines.push(risk.analysis)
    lines.push('')
    lines.push('【法律风险】')
    lines.push(risk.risk)
    lines.push('')
    lines.push('【修改建议】')
    lines.push(risk.suggestion)
    return lines.join('\n')
}

/** 批注文本按换行拆成多个 <w:p> */
function buildCommentXmlBody(text: string): string {
    return text
        .split('\n')
        .map(
            (line) =>
                `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
        )
        .join('')
}

function buildCommentsXml(risks: Risk[]): string {
    const now = new Date().toISOString()
    const items = risks
        .map(
            (risk, i) =>
                `<w:comment w:id="${i}" w:author="LexSeek 审查助手" w:date="${now}">${buildCommentXmlBody(
                    buildCommentText(risk),
                )}</w:comment>`,
        )
        .join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${items}</w:comments>`
}

const PARA_REGEX = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g

/**
 * 从段落 XML 中提取纯文本（去除所有 XML 标签）。
 * 用于 anchorQuote 字符串匹配定位段落。
 */
function extractTextFromParagraphXml(paraXml: string): string {
    return paraXml.replace(/<[^>]+>/g, '')
}

/**
 * 按 anchorQuote 在非空段落列表中搜索，返回第一个包含该字符串的段落索引。
 * 找不到时返回 -1。
 *
 * Phase B 数据形态：anchor_quote 存的是条款完整内容（多段落拼接，\n 分隔），
 * 而 docx 中每段是独立 <w:p>，需要按行拆出锚点片段逐行匹配。
 * 依次尝试前 3 个有效行，任一命中即返回；单行 quote 等价于全量匹配，不影响原语义。
 */
function findParagraphIndexByQuote(
    nonEmpty: Array<{ text: string; start: number; end: number }>,
    quote: string,
): number {
    if (!quote) return -1

    // 按行拆分，过滤掉过短的噪音行（单字符标点等），保留 2 个字符以上的有效行
    const lines = quote
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length >= 2)

    if (lines.length === 0) return -1

    // 依次尝试前 3 行，任一命中即返回
    for (const line of lines.slice(0, 3)) {
        for (let i = 0; i < nonEmpty.length; i++) {
            if (extractTextFromParagraphXml(nonEmpty[i]!.text).includes(line)) return i
        }
    }
    return -1
}

/** 扫描 document.xml，返回非空段落列表（含有 <w:r> 的 <w:p>）及其位置信息 */
function scanNonEmptyParagraphs(
    documentXml: string,
): Array<{ text: string; start: number; end: number }> {
    const result: Array<{ text: string; start: number; end: number }> = []
    PARA_REGEX.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PARA_REGEX.exec(documentXml)) !== null) {
        if (/<w:r[\s>]/.test(m[0])) {
            result.push({ text: m[0], start: m.index, end: m.index + m[0].length })
        }
    }
    return result
}

/**
 * 在第 N 个非空 <w:p> 内插入批注范围标记。
 * 按倒序修改以避免字符串偏移量错位。
 */
function injectRangeMarkers(
    documentXml: string,
    injections: Array<{ index: number; id: number }>,
    nonEmpty: Array<{ text: string; start: number; end: number }>,
): string {
    const sortedInjections = [...injections]
        .map((inj) => ({ ...inj, target: nonEmpty[inj.index] }))
        .filter((inj) => inj.target !== undefined)
        .sort((a, b) => b.target!.start - a.target!.start)

    let result = documentXml
    for (const inj of sortedInjections) {
        const target = inj.target!
        const pText = target.text

        const openTagMatch = /^<w:p(?:\s[^>]*)?>/.exec(pText)
        if (!openTagMatch) continue
        const openTagEnd = openTagMatch[0].length
        const closeTagStart = pText.lastIndexOf('</w:p>')
        if (closeTagStart < 0) continue

        const newP =
            pText.slice(0, openTagEnd) +
            `<w:commentRangeStart w:id="${inj.id}"/>` +
            pText.slice(openTagEnd, closeTagStart) +
            `<w:commentRangeEnd w:id="${inj.id}"/><w:r><w:commentReference w:id="${inj.id}"/></w:r>` +
            pText.slice(closeTagStart)

        result = result.slice(0, target.start) + newP + result.slice(target.end)
    }

    return result
}

/**
 * 注入结果：
 * - buffer: 新 .docx（包含有效 risks 的批注）
 * - validRisks: clauseIndex 落在文档段落范围内、实际被写进批注的 risks
 * - skippedIndices: 越界被丢弃的 clauseIndex 列表（供上层决定是否也从 DB 中剔除）
 *
 * 约定：持久化侧应使用 `validRisks` 回写 DB，保证 risks JSON 与 docx 批注一致。
 */
export interface InjectCommentsResult {
    buffer: Buffer
    validRisks: Risk[]
    skippedIndices: number[]
}

/**
 * 注入 Word 原生批注，返回新 .docx Buffer 及越界信息。
 */
export async function injectComments(docxBuffer: Buffer, risks: Risk[]): Promise<InjectCommentsResult> {
    const zip = await loadDocxZip(docxBuffer)

    if (risks.length === 0) {
        zip.remove('word/comments.xml')
        return {
            buffer: await zipToBuffer(zip),
            validRisks: [],
            skippedIndices: [],
        }
    }

    const documentXml = await readTextFromZip(zip, 'word/document.xml')
    const contentTypesXml = await readTextFromZip(zip, '[Content_Types].xml')
    const relsXml = await readTextFromZip(zip, 'word/_rels/document.xml.rels')

    const nonEmpty = scanNonEmptyParagraphs(documentXml)
    const nonEmptyCount = nonEmpty.length

    // 单次遍历：按 clauseIndex 越界与否分桶，避免对 risks 做 3 次过滤
    const validRisks: Risk[] = []
    const skippedIndices: number[] = []
    for (const r of risks) {
        if (r.clauseIndex >= 0 && r.clauseIndex < nonEmptyCount) validRisks.push(r)
        else skippedIndices.push(r.clauseIndex)
    }
    if (skippedIndices.length > 0) {
        // 大量越界时不一一打印，避免日志刷屏
        const preview = skippedIndices.length > 10
            ? skippedIndices.slice(0, 10).concat(['...' as unknown as number])
            : skippedIndices
        logger.warn('[commentInjector] 跳过越界 risk', {
            total: risks.length,
            skipped: skippedIndices.length,
            indicesPreview: preview,
            nonEmptyCount,
        })
    }
    if (validRisks.length === 0) {
        return {
            buffer: Buffer.from(docxBuffer),
            validRisks: [],
            skippedIndices,
        }
    }

    const injections = validRisks.map((r, i) => ({ index: r.clauseIndex, id: i }))

    writeTextToZip(zip, 'word/document.xml', injectRangeMarkers(documentXml, injections, nonEmpty))
    writeTextToZip(zip, 'word/comments.xml', buildCommentsXml(validRisks))

    if (!contentTypesXml.includes('PartName="/word/comments.xml"')) {
        writeTextToZip(
            zip,
            '[Content_Types].xml',
            appendChildXml(contentTypesXml, 'Types', COMMENTS_OVERRIDE),
        )
    }

    if (!relsXml.includes('Target="comments.xml"')) {
        writeTextToZip(
            zip,
            'word/_rels/document.xml.rels',
            appendChildXml(relsXml, 'Relationships', COMMENTS_REL),
        )
    }

    return {
        buffer: await zipToBuffer(zip),
        validRisks,
        skippedIndices,
    }
}

// ============================================================
// Phase B：injectAnnotations —— 按 annotation 逐条注入批注
// ============================================================

/**
 * 导出入参：每条 annotation 的导出所需数据。
 * anchorParagraphIndex 通过 riskId 反查 contractRisks 表获得（调用方负责填入）。
 */
export interface ContractAnnotationForExport {
    id: number
    riskId: number
    authorType: AnnotationAuthorType
    /** AI=固定 "AI"；lawyer=律师姓名；external=Word author 原值 */
    authorName: string
    content: string
    parentAnnotationId: number | null
    /** 锚点原文（用于 document.xml 段落定位，暂按 anchorParagraphIndex 定位） */
    anchorQuote: string
    /** 条款索引，与 injectComments 的 clauseIndex 语义一致 */
    anchorParagraphIndex: number
    /** 已存在则沿用；为 null 时内部按 generateWordCommentRef(id) 生成 */
    wordCommentRef: string | null
}

export interface InjectAnnotationsResult {
    buffer: Buffer
    /** 每条 annotation 最终使用的 wordCommentRef（供调用方回写 DB） */
    refsByAnnotationId: Map<number, string>
}

/**
 * 按 annotation 注入 Word 批注。Phase B 新入口，与现有 injectComments 并存。
 *
 * 规则：
 * - 每条 annotation 生成一个 <w:comment>，w:id 按数组顺序 0,1,2...
 * - w:author = 'LS:' + annotation.authorName（LS 前缀使客户 Word 可见来源）
 * - w:initials = wordCommentRef（LEXSEEK-{id}-{rand8} 格式，回传识别用）
 * - parentAnnotationId 非空且父 annotation 在本批次中 → 写 w:parentId 实现"答复批注"
 * - anchorParagraphIndex 越界时该 annotation 跳过（仍写入 refsByAnnotationId 供回写）
 */
export async function injectAnnotations(
    docxBuffer: Buffer,
    annotations: ContractAnnotationForExport[],
): Promise<InjectAnnotationsResult> {
    // 1. 为每条 annotation 确定 wordCommentRef（已有则沿用，为 null 则新生成）
    const refsByAnnotationId = new Map<number, string>()

    if (annotations.length === 0) {
        const zip = await loadDocxZip(docxBuffer)
        zip.remove('word/comments.xml')
        return { buffer: await zipToBuffer(zip), refsByAnnotationId }
    }

    for (const a of annotations) {
        refsByAnnotationId.set(a.id, a.wordCommentRef ?? generateWordCommentRef(a.id))
    }

    const zip = await loadDocxZip(docxBuffer)
    const documentXml = await readTextFromZip(zip, 'word/document.xml')
    const contentTypesXml = await readTextFromZip(zip, '[Content_Types].xml')
    const relsXml = await readTextFromZip(zip, 'word/_rels/document.xml.rels')

    const nonEmpty = scanNonEmptyParagraphs(documentXml)
    const nonEmptyCount = nonEmpty.length

    // 2. 按原顺序分配 Word 本地 w:id（0,1,2...），越界的也分配 id 但不写入 document.xml
    const wordIdByAnnotationId = new Map<number, number>()
    annotations.forEach((a, idx) => wordIdByAnnotationId.set(a.id, idx))

    // 3. 为每条 annotation 解析最终段落索引：anchorQuote 字符串匹配优先，找不到再 fallback 到 anchorParagraphIndex
    const resolvedParagraphIndex = new Map<number, number>()
    const validAnnotations: ContractAnnotationForExport[] = []
    for (const a of annotations) {
        const quoteIdx = findParagraphIndexByQuote(nonEmpty, a.anchorQuote)
        if (quoteIdx >= 0) {
            resolvedParagraphIndex.set(a.id, quoteIdx)
            validAnnotations.push(a)
        } else if (a.anchorParagraphIndex >= 0 && a.anchorParagraphIndex < nonEmptyCount) {
            resolvedParagraphIndex.set(a.id, a.anchorParagraphIndex)
            validAnnotations.push(a)
        } else {
            logger.warn('[commentInjector] injectAnnotations: anchorQuote 未命中且 anchorParagraphIndex 越界，跳过', {
                annotationId: a.id,
                anchorQuote: a.anchorQuote,
                anchorParagraphIndex: a.anchorParagraphIndex,
                nonEmptyCount,
            })
        }
    }

    if (validAnnotations.length === 0) {
        return { buffer: Buffer.from(docxBuffer), refsByAnnotationId }
    }

    // 4. 组装 comments.xml（含全部 annotations，包含越界的，保持 w:id 连续）
    writeTextToZip(
        zip,
        'word/comments.xml',
        buildCommentsXmlFromAnnotations(annotations, refsByAnnotationId, wordIdByAnnotationId),
    )

    // 5. 在 document.xml 的对应段落处插入 commentRangeStart/End/Reference
    const injections = validAnnotations.map(a => ({
        index: resolvedParagraphIndex.get(a.id)!,
        id: wordIdByAnnotationId.get(a.id)!,
    }))
    writeTextToZip(zip, 'word/document.xml', injectRangeMarkers(documentXml, injections, nonEmpty))

    // 6. 确保 [Content_Types].xml 和 rels 中包含 comments 注册项
    if (!contentTypesXml.includes('PartName="/word/comments.xml"')) {
        writeTextToZip(
            zip,
            '[Content_Types].xml',
            appendChildXml(contentTypesXml, 'Types', COMMENTS_OVERRIDE),
        )
    }
    if (!relsXml.includes('Target="comments.xml"')) {
        writeTextToZip(
            zip,
            'word/_rels/document.xml.rels',
            appendChildXml(relsXml, 'Relationships', COMMENTS_REL),
        )
    }

    return { buffer: await zipToBuffer(zip), refsByAnnotationId }
}

/** 构造 Phase B 格式的 comments.xml */
function buildCommentsXmlFromAnnotations(
    annotations: ContractAnnotationForExport[],
    refs: Map<number, string>,
    wordIds: Map<number, number>,
): string {
    const now = new Date().toISOString()
    const items = annotations.map(a => {
        const wId = wordIds.get(a.id)!
        const initials = refs.get(a.id)!
        const author = `LS:${a.authorName}`
        const parentAttr =
            a.parentAnnotationId !== null && wordIds.has(a.parentAnnotationId)
                ? ` w:parentId="${wordIds.get(a.parentAnnotationId)}"`
                : ''
        return `<w:comment w:id="${wId}" w:author="${escapeXml(author)}" w:initials="${escapeXml(initials)}" w:date="${now}"${parentAttr}><w:p><w:r><w:t xml:space="preserve">${escapeXml(a.content)}</w:t></w:r></w:p></w:comment>`
    }).join('')

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${items}</w:comments>`
}
