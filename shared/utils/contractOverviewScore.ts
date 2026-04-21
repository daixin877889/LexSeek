/**
 * 合同审查总览 score/counts/label 纯计算函数
 *
 * 双端共用（前端 useContractOverview + 后端 PDF 导出）。
 * 无 Vue 依赖，无副作用。
 *
 * 加权公式：score = min(100, round(3 × high + 1.5 × medium + 0.5 × low))
 * 分段：≥70 极高风险 / ≥50 风险偏高，建议谈判 / ≥30 风险可控 / <30 低风险
 */
import type { Risk } from '#shared/types/contract'

export interface OverviewCounts {
    high: number
    medium: number
    low: number
}

export function computeCounts(risks: Risk[]): OverviewCounts {
    return {
        high: risks.filter(r => r.level === 'high').length,
        medium: risks.filter(r => r.level === 'medium').length,
        low: risks.filter(r => r.level === 'low').length,
    }
}

export function computeScore(counts: OverviewCounts): number {
    return Math.min(100, Math.round(3 * counts.high + 1.5 * counts.medium + 0.5 * counts.low))
}

export function computeScoreLabel(score: number): string {
    if (score >= 70) return '极高风险'
    if (score >= 50) return '风险偏高，建议谈判'
    if (score >= 30) return '风险可控'
    return '低风险'
}
