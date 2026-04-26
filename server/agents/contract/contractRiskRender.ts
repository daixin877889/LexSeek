/**
 * 把 AI 风险对象渲染为 ContractAnnotation content 用的五段式批注文本。
 *
 * 接受宽松入参（`Partial<Risk>` 或 legacy JSON 的 `Record<string, unknown>`），
 * 同时供 `contractReviewMainAgent`（Risk 类型）和 `contractReviewMigrate`（legacy JSON）复用，
 * 避免两处定义造成 Phase B 迭代时格式漂移。
 */

interface RiskLike {
    level?: unknown
    category?: unknown
    problem?: unknown
    legalBasis?: unknown
    analysis?: unknown
    /** 部分 legacy JSON 里分析字段可能叫 `risk` 而非 `analysis` */
    risk?: unknown
    suggestion?: unknown
}

export function renderRiskAsAnnotationText(input: RiskLike): string {
    const level = input.level as string
    const levelLabel = level === 'high' ? '高风险' : level === 'medium' ? '中风险' : '低风险'
    const parts: string[] = []
    parts.push(`【${levelLabel}】${(input.category as string) ?? '未分类'}`)
    parts.push(`问题：${(input.problem as string) ?? ''}`)
    if (input.legalBasis) parts.push(`法律依据：${input.legalBasis}`)
    parts.push(`分析：${(input.analysis ?? input.risk ?? '') as string}`)
    parts.push(`建议：${(input.suggestion as string) ?? ''}`)
    return parts.join('\n')
}
