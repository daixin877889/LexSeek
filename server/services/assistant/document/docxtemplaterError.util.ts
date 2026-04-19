/**
 * docxtemplater 错误解析工具
 *
 * docxtemplater 抛出的错误有两种常见形态：
 *   - MultiError：properties.errors[*].properties.{explanation, xtag}
 *   - TemplateError：properties.{explanation, xtag}
 * 本工具抽取首条可读错误，模板上传校验 + 渲染兜底均使用同一份逻辑。
 */

interface DocxtemplaterErrorLike {
    message?: string
    properties?: {
        explanation?: string
        xtag?: string
        errors?: Array<{ properties?: { explanation?: string; xtag?: string } }>
    }
}

/**
 * 提取 docxtemplater 错误的首条可读信息。
 * @returns 形如 `Unclosed tag（位置：{foo）` 或 fallback 到 `err.message`
 */
export function extractDocxtemplaterErrorDetail(err: unknown): string {
    const anyErr = err as DocxtemplaterErrorLike
    const nested = anyErr?.properties?.errors?.[0]?.properties
    if (nested?.explanation) {
        return `${nested.explanation}${nested.xtag ? `（位置：${nested.xtag}）` : ''}`
    }
    const top = anyErr?.properties
    if (top?.explanation) {
        return `${top.explanation}${top.xtag ? `（位置：${top.xtag}）` : ''}`
    }
    return anyErr?.message ?? '未知错误'
}
