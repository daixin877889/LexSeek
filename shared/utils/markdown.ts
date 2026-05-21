/**
 * Markdown 工具
 *
 * 提供给前后端共用的 markdown 文本处理函数。
 */

/**
 * 判断一行是否是 ATX 一级标题：
 * - 行首允许 0-3 个空格（CommonMark）
 * - 接 `#`
 * - 紧跟一个空格（标题文本可空）
 * - 不匹配 `## ` / `### ` / `#标题`（# 后无空格） / 单独的 `#`
 */
function isAtxH1Line(line: string): boolean {
    const m = /^( {0,3})#( +.*| *)$/.exec(line)
    if (!m) return false
    const rest = m[2] ?? ''
    return rest.length > 0 && rest.startsWith(' ')
}

/**
 * 判断一行是否是 fenced code block 围栏开始（``` 或 ~~~）。
 * 返回围栏字符（'```' 或 '~~~'），不是围栏返回 null。
 */
function detectFenceOpen(line: string): string | null {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('```')) return '```'
    if (trimmed.startsWith('~~~')) return '~~~'
    return null
}

/**
 * 跳过 fenced code block。
 * 给定围栏开始行索引，向后扫描，返回下一个待处理的行索引（围栏结束行的下一行）。
 * 未找到结束围栏时，视为代码块延伸到文档末尾。
 */
function skipFencedBlock(lines: string[], start: number, fence: string): number {
    for (let i = start + 1; i < lines.length; i++) {
        const trimmed = (lines[i] ?? '').trimStart()
        if (trimmed.startsWith(fence)) {
            return i + 1
        }
    }
    return lines.length
}

/**
 * 判断一行是否是 indented code block（行首 4 空格或 1 tab）。
 */
function isIndentedCodeLine(line: string): boolean {
    return line.startsWith('\t') || line.startsWith('    ')
}

/**
 * 判断一行是否是 blockquote（行首 0-3 空格 + `>`）。
 */
function isBlockquoteLine(line: string): boolean {
    return /^( {0,3})>/.test(line)
}

/**
 * 去除 markdown 第一个一级标题（# xxx）之前的所有内容。
 *
 * 用于清洗 LLM 输出的说明性前言。若没有匹配到一级标题，原文不动返回。
 * 处理后不保留前导空行 / 空白，输出从该一级标题行的行首开始。
 *
 * 匹配跳过：
 * - fenced code block（``` 或 ~~~ 围栏）内的 `# foo`
 * - indented code block（4 空格或 tab 缩进）内的 `# foo`
 * - blockquote（`> # foo`）内的一级标题
 *
 * @param markdown 原始 markdown
 * @returns 清洗后的 markdown；入参 null/undefined 统一返回空串
 */
export function stripContentBeforeFirstH1(markdown: string | null | undefined): string {
    if (markdown == null || markdown === '') return ''

    const lines = markdown.split(/\r?\n/)

    let i = 0
    let h1LineIndex = -1
    while (i < lines.length) {
        const line = lines[i] ?? ''

        const fence = detectFenceOpen(line)
        if (fence) {
            i = skipFencedBlock(lines, i, fence)
            continue
        }

        if (isIndentedCodeLine(line) || isBlockquoteLine(line)) {
            i++
            continue
        }

        if (isAtxH1Line(line)) {
            h1LineIndex = i
            break
        }

        i++
    }

    if (h1LineIndex === -1) return markdown

    const eol = /\r\n/.test(markdown) ? '\r\n' : '\n'
    return lines.slice(h1LineIndex).join(eol)
}
