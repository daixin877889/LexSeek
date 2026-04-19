/**
 * Word 原生批注注入：按 spec §10.1 改四处文件，按 §10.2 五模块格式写 comments.xml。
 */
import type { Risk, RiskLevel } from '#shared/types/contract'
import {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
} from './zipRewriter'
import { appendChildXml, escapeXml } from './xmlUtils'

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
