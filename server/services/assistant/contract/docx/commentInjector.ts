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
    const regex = new RegExp(PARA_REGEX.source, 'g')
    let m: RegExpExecArray | null
    while ((m = regex.exec(documentXml)) !== null) {
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
 * 注入 Word 原生批注，返回新 .docx Buffer。
 */
export async function injectComments(docxBuffer: Buffer, risks: Risk[]): Promise<Buffer> {
    const zip = await loadDocxZip(docxBuffer)

    if (risks.length === 0) {
        zip.remove('word/comments.xml')
        return await zipToBuffer(zip)
    }

    const documentXml = await readTextFromZip(zip, 'word/document.xml')
    const contentTypesXml = await readTextFromZip(zip, '[Content_Types].xml')
    const relsXml = await readTextFromZip(zip, 'word/_rels/document.xml.rels')

    const nonEmpty = scanNonEmptyParagraphs(documentXml)
    const nonEmptyCount = nonEmpty.length

    const skipped = risks.filter((r) => r.clauseIndex < 0 || r.clauseIndex >= nonEmptyCount)
    if (skipped.length > 0) {
        logger.warn('[commentInjector] 跳过越界 risk', {
            total: risks.length,
            skipped: skipped.length,
            indices: skipped.map((r) => r.clauseIndex),
            nonEmptyCount,
        })
    }
    const validRisks = risks.filter(
        (r) => r.clauseIndex >= 0 && r.clauseIndex < nonEmptyCount,
    )
    if (validRisks.length === 0) {
        return Buffer.from(docxBuffer)
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

    return await zipToBuffer(zip)
}
