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
    const analysis = input.analysis as string | undefined
    const stanceRisk = input.risk as string | undefined
    const parts: string[] = []
    parts.push(`【${levelLabel}】${(input.category as string) ?? '未分类'}`)
    parts.push(`问题：${(input.problem as string) ?? ''}`)
    if (input.legalBasis) parts.push(`法律依据：${input.legalBasis}`)
    // 分析段：新数据用 analysis；legacy JSON 的分析字段叫 risk，analysis 缺失时回退
    parts.push(`分析：${analysis ?? stanceRisk ?? ''}`)
    // M12：立场专属法律风险段——仅当 analysis 与 risk 同时存在（新格式数据，risk 是
    // 独立于 analysis 的立场专属风险）才单独成段，避免 legacy JSON（risk 即 analysis）
    // 重复渲染同一段文字。
    if (analysis && stanceRisk) parts.push(`法律风险：${stanceRisk}`)
    parts.push(`建议：${(input.suggestion as string) ?? ''}`)
    return parts.join('\n')
}
