/**
 * LLM 输出的 JSON 解析共享工具。
 *
 * LLM 常见输出有几种模式：
 *   1. 纯净 JSON: `{ "risk": ... }`
 *   2. 带前缀解释: `思考一下...{ JSON }`
 *   3. markdown fence: ` ```json\n{...}\n``` `
 *   4. 多段内容: `{解释1} 结论 { JSON } 补充说明 {不是JSON}`
 *
 * 用 `content.match(/\{[\s\S]*\}/)` 的 greedy 模式会把 #4 抓成一坨坏 JSON。
 * 平衡括号扫描：从第一个 `{` 起按深度配对 `{}`，尊重字符串字面量 + 转义，
 * 首次 depth=0 时返回子串——只拿第一个完整 JSON 对象，剩余内容不管。
 */
export function extractFirstJsonObject(content: string): string | null {
    const start = content.indexOf('{')
    if (start < 0) return null
    let depth = 0
    let inStr = false
    let escaped = false
    for (let i = start; i < content.length; i++) {
        const ch = content[i]
        if (escaped) { escaped = false; continue }
        if (inStr) {
            if (ch === '\\') escaped = true
            else if (ch === '"') inStr = false
            continue
        }
        if (ch === '"') { inStr = true; continue }
        if (ch === '{') depth++
        else if (ch === '}') {
            depth--
            if (depth === 0) return content.slice(start, i + 1)
        }
    }
    return null
}

/** 一句话总结 unknown 值的"形状"，用于 schema 失败时的诊断日志 */
export function summarizeJsonShape(v: unknown): string {
    if (v === null) return 'null'
    if (Array.isArray(v)) return `Array(len=${v.length})`
    const t = typeof v
    if (t !== 'object') return t
    const keys = Object.keys(v as Record<string, unknown>)
    return `Object{${keys.slice(0, 10).join(',')}${keys.length > 10 ? ',...' : ''}}`
}
