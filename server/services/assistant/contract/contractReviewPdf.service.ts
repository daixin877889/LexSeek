/**
 * 合同审查 PDF 导出服务
 *
 * 负责：
 *  - 按 reviewId 读取审查记录（通过 DAO），同时做 owner 校验
 *  - 用 pdfmake + 项目内嵌 NotoSansSC 字体服务端渲染 PDF（不依赖任何浏览器）
 *  - 返回完整 PDF Buffer，交由 handler 下发
 *
 * 设计：
 *  - 单例 pdfmake（由 pdfmake/js/index.js 暴露）共享字体字典，每次调用前 setFonts 覆盖为固定
 *    NotoSansSC 映射，字典内容始终一致，并发安全
 *  - Markdown 摘要不做富文本解析，只做最小正则剥除 `#`、`**`、`*`、`` ` `` 等符号后按段落渲染
 *  - 按 severity 分组（高/中/低），每组内按 clauseIndex 升序
 *
 * **Feature: contract-review-m6.2**
 */
// pdfmake 的 default 单例实例无显式类型，走 unknown 包装；使用 @types/pdfmake 的 TDocumentDefinitions 约束文档结构。
import pdfmakeSingleton from 'pdfmake'
import type { TDocumentDefinitions, TFontDictionary, Content } from 'pdfmake/interfaces'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getContractReviewDAO } from './contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import type { ContractOverview, Risk, RiskLevel } from '#shared/types/contract'
import {
    REVIEW_STATUS_LABEL,
    STANCE_LABEL,
    RISK_LEVEL_LABEL,
    type ContractReviewStatus,
    type Stance,
} from '#shared/types/contract'

interface PdfMakeSingleton {
    setFonts: (fonts: TFontDictionary) => void
    createPdf: (def: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> }
}
const pdfmake = pdfmakeSingleton as unknown as PdfMakeSingleton

export interface ExportPdfOptions {
    includeRisks: boolean
}

// 字体文件位于 server/services/assistant/contract/fonts/NotoSansSC-Regular.ttf。
// dev 时 cwd=工程根，build 后 import.meta.url 指向 .nuxt/output/server，两条候选路径二选一。
const FONT_CANDIDATES = [
    path.resolve(process.cwd(), 'server/services/assistant/contract/fonts/NotoSansSC-Regular.ttf'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fonts/NotoSansSC-Regular.ttf'),
]
const FONT_PATH = FONT_CANDIDATES.find(p => fs.existsSync(p))
if (!FONT_PATH) {
    throw new Error(`NotoSansSC 字体缺失，已检查：${FONT_CANDIDATES.join(', ')}`)
}

const FONT_DESCRIPTORS = {
    NotoSansSC: {
        normal: FONT_PATH,
        bold: FONT_PATH,
        italics: FONT_PATH,
        bolditalics: FONT_PATH,
    },
}

const SEVERITY_ORDER: RiskLevel[] = ['high', 'medium', 'low']
const SEVERITY_META: Record<RiskLevel, { label: string; color: string; fill: string }> = {
    high: { label: RISK_LEVEL_LABEL.high, color: '#b91c1c', fill: '#fee2e2' },
    medium: { label: RISK_LEVEL_LABEL.medium, color: '#b45309', fill: '#fef3c7' },
    low: { label: RISK_LEVEL_LABEL.low, color: '#15803d', fill: '#dcfce7' },
}

/** 只去除 Markdown 常见标记符，不做富文本解析 */
function stripMarkdown(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '• ')
        .trim()
}

function formatDateTime(d: Date | null | undefined): string {
    if (!d) return '-'
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 根据 reviewId 生成 PDF Buffer。
 * 失败路径：
 *  - 记录不存在 / owner 不匹配：抛 Error('review not found')
 *
 * owner 校验放在 service 层，handler 只做透传与鉴权。
 */
export async function exportReviewPdfService(
    reviewId: number,
    userId: number,
    options: ExportPdfOptions,
): Promise<Buffer> {
    const review = await getContractReviewDAO(reviewId)
    if (!review || review.userId !== userId) {
        throw new Error('review not found')
    }

    const originalFile = review.originalFileId
        ? await findOssFileByIdDao(review.originalFileId)
        : null
    const originalFileName = originalFile?.fileName ?? '未命名合同'

    // Task 1.2（M6.1 子期 1）：DB 层 summary 暂仍是 string，子期 3 的迁移完成前，
    // 在 PDF 入口把字符串临时包装成 ContractOverview（highlights 置 null），
    // 让下游渲染逻辑统一按 ContractOverview 访问；迁移后 DAO 直接返回 JSON 时兼容
    // 透传的 Record 形态，无需再改此处逻辑。
    const rawSummary = review.summary as unknown
    let overview: ContractOverview | null = null
    if (typeof rawSummary === 'string' && rawSummary.length > 0) {
        overview = { highlights: null, overall: rawSummary }
    } else if (rawSummary && typeof rawSummary === 'object') {
        overview = rawSummary as ContractOverview
    }

    const docDefinition = buildDocDefinition({
        originalFileName,
        contractType: review.contractType,
        partyA: review.partyA,
        partyB: review.partyB,
        stance: review.stance,
        status: review.status,
        createdAt: review.createdAt,
        summary: overview,
        risks: (review.risks as unknown as Risk[] | null) ?? null,
        includeRisks: options.includeRisks,
    })

    pdfmake.setFonts(FONT_DESCRIPTORS)
    const doc = pdfmake.createPdf(docDefinition)
    return (await doc.getBuffer()) as Buffer
}

// ==================== docDefinition 构造 ====================

interface BuildContext {
    originalFileName: string
    contractType: string | null
    partyA: string | null
    partyB: string | null
    stance: string | null
    status: string
    createdAt: Date
    summary: ContractOverview | null
    risks: Risk[] | null
    includeRisks: boolean
}

function buildDocDefinition(ctx: BuildContext): TDocumentDefinitions {
    const content: Content[] = []

    content.push({ text: ctx.originalFileName, style: 'docTitle', margin: [0, 0, 0, 12] })

    content.push({
        table: {
            widths: ['auto', '*', 'auto', '*'],
            body: [
                [
                    { text: '合同类型', style: 'infoLabel' },
                    { text: ctx.contractType ?? '-', style: 'infoValue' },
                    { text: '审查立场', style: 'infoLabel' },
                    {
                        text: ctx.stance ? STANCE_LABEL[ctx.stance as Stance] ?? ctx.stance : '-',
                        style: 'infoValue',
                    },
                ],
                [
                    { text: '甲方', style: 'infoLabel' },
                    { text: ctx.partyA ?? '-', style: 'infoValue' },
                    { text: '乙方', style: 'infoLabel' },
                    { text: ctx.partyB ?? '-', style: 'infoValue' },
                ],
                [
                    { text: '当前状态', style: 'infoLabel' },
                    {
                        text: REVIEW_STATUS_LABEL[ctx.status as ContractReviewStatus] ?? ctx.status,
                        style: 'infoValue',
                    },
                    { text: '审查时间', style: 'infoLabel' },
                    { text: formatDateTime(ctx.createdAt), style: 'infoValue' },
                ],
            ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 16],
    })

    content.push({ text: '审查摘要', style: 'sectionTitle', margin: [0, 0, 0, 6] })
    const summaryText = ctx.summary?.overall ? stripMarkdown(ctx.summary.overall) : ''
    if (summaryText) {
        for (const para of summaryText.split(/\n{2,}/)) {
            content.push({ text: para.replace(/\n/g, ' '), style: 'body', margin: [0, 0, 0, 6] })
        }
    } else {
        content.push({ text: '（暂无摘要）', style: 'bodyMuted', margin: [0, 0, 0, 6] })
    }

    if (ctx.includeRisks) {
        content.push({
            text: '风险点清单',
            style: 'sectionTitle',
            margin: [0, 14, 0, 8],
            pageBreak: 'before',
        })

        const risks = ctx.risks ?? []
        if (risks.length === 0) {
            content.push({ text: '无风险记录', style: 'bodyMuted' })
        } else {
            for (const level of SEVERITY_ORDER) {
                const group = risks
                    .filter(r => r.level === level)
                    .sort((a, b) => a.clauseIndex - b.clauseIndex)
                if (group.length === 0) continue
                const meta = SEVERITY_META[level]
                content.push({
                    text: `${meta.label}风险 (${group.length})`,
                    style: 'groupTitle',
                    color: meta.color,
                    margin: [0, 8, 0, 4],
                })
                for (const r of group) {
                    content.push(buildRiskBlock(r, meta))
                }
            }
        }
    }

    return {
        defaultStyle: { font: 'NotoSansSC', fontSize: 11, lineHeight: 1.35 },
        pageMargins: [40, 48, 40, 56],
        content,
        footer: (currentPage: number, pageCount: number) => ({
            columns: [
                { text: '本报告仅供参考，不构成法律意见', style: 'footerLeft' },
                {
                    text: `生成于 ${formatDateTime(new Date())} | 第 ${currentPage} / ${pageCount} 页`,
                    style: 'footerRight',
                    alignment: 'right',
                },
            ],
            margin: [40, 12, 40, 0],
        }),
        styles: {
            docTitle: { fontSize: 16, bold: true },
            sectionTitle: { fontSize: 13, bold: true, color: '#111827' },
            groupTitle: { fontSize: 12, bold: true },
            infoLabel: { bold: true, color: '#374151', fontSize: 10, margin: [0, 3, 0, 3] },
            infoValue: { color: '#111827', fontSize: 10, margin: [0, 3, 0, 3] },
            body: { fontSize: 11, color: '#1f2937' },
            bodyMuted: { fontSize: 11, color: '#6b7280', italics: true },
            badge: { fontSize: 10, bold: true, color: '#ffffff' },
            riskTitle: { fontSize: 12, bold: true, color: '#111827' },
            riskLabel: { fontSize: 10, bold: true, color: '#374151' },
            riskClause: { fontSize: 10, color: '#6b7280', italics: true },
            riskBody: { fontSize: 11, color: '#1f2937' },
            riskSuggested: { fontSize: 11, color: '#15803d' },
            footerLeft: { fontSize: 9, color: '#9ca3af' },
            footerRight: { fontSize: 9, color: '#9ca3af' },
        },
    }
}

function buildRiskBlock(r: Risk, meta: { label: string; color: string; fill: string }): Content {
    const lines: Content[] = []
    lines.push({
        columns: [
            {
                width: 'auto',
                table: {
                    body: [[{ text: meta.label, style: 'badge', fillColor: meta.color, margin: [6, 2, 6, 2] }]],
                },
                layout: 'noBorders',
            },
            { width: '*', text: r.problem || r.category, style: 'riskTitle', margin: [8, 2, 0, 0] },
        ],
        columnGap: 4,
        margin: [0, 4, 0, 4],
    })
    if (r.clauseText) {
        lines.push({
            text: [
                { text: `所在条款（#${r.clauseIndex}）：`, style: 'riskLabel' },
                { text: r.clauseText, style: 'riskClause' },
            ],
            margin: [0, 0, 0, 4],
        })
    }
    if (r.analysis) {
        lines.push({
            text: [
                { text: '条款分析：', style: 'riskLabel' },
                { text: r.analysis, style: 'riskBody' },
            ],
            margin: [0, 0, 0, 3],
        })
    }
    if (r.risk) {
        lines.push({
            text: [
                { text: '法律风险：', style: 'riskLabel' },
                { text: r.risk, style: 'riskBody' },
            ],
            margin: [0, 0, 0, 3],
        })
    }
    if (r.legalBasis) {
        lines.push({
            text: [
                { text: '法律依据：', style: 'riskLabel' },
                { text: r.legalBasis, style: 'riskBody' },
            ],
            margin: [0, 0, 0, 3],
        })
    }
    if (r.suggestion) {
        lines.push({
            text: [
                { text: '修改建议：', style: 'riskLabel' },
                { text: r.suggestion, style: 'riskBody' },
            ],
            margin: [0, 0, 0, 3],
        })
    }
    if (r.suggestedClauseText) {
        lines.push({
            text: [
                { text: '建议条款：', style: 'riskLabel' },
                { text: r.suggestedClauseText, style: 'riskSuggested' },
            ],
            margin: [0, 0, 0, 6],
        })
    }
    return {
        stack: lines,
        margin: [0, 0, 0, 8],
    }
}
