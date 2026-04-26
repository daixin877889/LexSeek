/**
 * 文书模板占位符扫描器
 *
 * 用 mammoth 提取 .docx 纯文本，正则匹配 {{name}} 占位符。
 * 支持中英混合命名（name 由 \u4e00-\u9fa5 或 \w 字符组成）。
 */
import mammoth from 'mammoth'
import type { Placeholder } from '#shared/types/document'

const PLACEHOLDER_RE = /\{\{([\u4e00-\u9fa5\w]+)\}\}/g

export async function scanPlaceholders(docxBuffer: Buffer): Promise<Placeholder[]> {
    const { value: rawText } = await mammoth.extractRawText({ buffer: docxBuffer })
    const map = new Map<string, string>()
    let match: RegExpExecArray | null
    while ((match = PLACEHOLDER_RE.exec(rawText)) !== null) {
        const name = match[1]
        if (name != null && !map.has(name)) {
            const lineStart = rawText.lastIndexOf('\n', match.index) + 1
            const lineEnd = rawText.indexOf('\n', match.index + match[0].length)
            const firstContext = rawText.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
            map.set(name, firstContext)
        }
    }
    return [...map.entries()].map(([name, firstContext]) => ({ name, firstContext }))
}
