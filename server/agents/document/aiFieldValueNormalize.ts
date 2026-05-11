/**
 * AI 输出字段值规范化
 *
 * LLM 调 save_document_draft / update_document_draft 时，常常把"还不知道答案"的字段
 * 塞成「【待补充：xxx】」「[未提供：xxx]」「【暂无】」等占位字符串，而不是按 prompt
 * 要求传 null。这些占位串如果原样落库会带来两个问题：
 *  1. 字段统计虚高：filledFieldCount 把占位串当成"已填"，前端显示"15/15 已填"假象
 *  2. 文书正文乱入占位字符串：渲染时直接打到文档里，用户看到「对【待补充：法院名称】一案」
 *
 * 工具层在写库前调本模块兜底，**只过 LLM 的输出，不影响用户手填路径**
 *（patchDraftService 等服务层不挂这个过滤）。
 */

const AI_PLACEHOLDER_REGEX = /^[【\[]\s*(?:待补充|未提供|暂无|未知|未填|无)[\s\S]*[】\]]$/

/**
 * 是否为 LLM 占位符样值。匹配规则：整字段值是「【待补充...】」「[未提供...]」等
 * 由占位关键词包裹的整体；不会误伤合法内容里出现"待补充"三字的情况。
 */
export function isAIPlaceholderValue(v: string | null | undefined): boolean {
    if (v == null) return true
    const trimmed = v.trim()
    if (!trimmed) return true
    return AI_PLACEHOLDER_REGEX.test(trimmed)
}

/**
 * save_document_draft 用：首次写入字段值。占位符 → null（字段保留在 values 里，
 * 但值是 null，前端表单显示空白；后续 update 可以正常修改）。
 */
export function normalizeAIInitialFieldValues(
    fieldValues: Record<string, string | null>,
): Record<string, string | null> {
    const out: Record<string, string | null> = {}
    for (const [key, value] of Object.entries(fieldValues)) {
        out[key] = isAIPlaceholderValue(value) ? null : value
    }
    return out
}

/**
 * update_document_draft 用：增量 patch 字段。占位符 → 丢弃（不下发给 service，
 * 保留原值不变）。LLM 显式传 null 视作"清空"意图，照常下发。
 */
export function cleanAIFieldUpdates(
    fieldUpdates: Record<string, string | null>,
): Record<string, string | null> {
    const out: Record<string, string | null> = {}
    for (const [key, value] of Object.entries(fieldUpdates)) {
        if (value === null) {
            out[key] = null
        }
        else if (!isAIPlaceholderValue(value)) {
            out[key] = value
        }
        // 占位符：跳过
    }
    return out
}
