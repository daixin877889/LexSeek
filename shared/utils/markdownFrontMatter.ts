/**
 * Markdown Front Matter 解析工具
 *
 * 用于从 Markdown 内容中提取和合并 YAML front matter，
 * 确保编辑器处理时不会破坏 front matter 的原始格式。
 */

/**
 * Front Matter 解析结果
 */
export interface FrontMatterResult {
    /** 原始 front matter 字符串（包含 --- 分隔符和结尾换行） */
    frontMatter: string | null
    /** 正文内容（不包含 front matter） */
    content: string
    /** front matter 是否有效 */
    hasFrontMatter: boolean
}

/**
 * 匹配 YAML front matter 的正则表达式
 *
 * 规则：
 * 1. 必须以 `---` 开头
 * 2. 后面跟换行符（\r?\n）
 * 3. 中间可以是任意内容（包括空，非贪婪匹配）
 * 4. 以换行符 + `---` 或直接 `---` 结束（支持空 front matter）
 * 5. 结束的 `---` 后可以有可选的换行符
 */
const FRONT_MATTER_REGEX = /^(---\r?\n[\s\S]*?---\r?\n?)/

/**
 * 从 Markdown 内容中提取 YAML front matter
 *
 * @param markdown 原始 Markdown 内容
 * @returns 解析结果，包含 front matter 和正文内容
 *
 * @example
 * ```ts
 * const result = extractFrontMatter(`---
 * title: 测试
 * ---
 * 正文内容`)
 *
 * // result.frontMatter = '---\ntitle: 测试\n---\n'
 * // result.content = '正文内容'
 * // result.hasFrontMatter = true
 * ```
 */
export function extractFrontMatter(markdown: string): FrontMatterResult {
    // 处理空内容
    if (!markdown || markdown.trim() === '') {
        return {
            frontMatter: null,
            content: markdown || '',
            hasFrontMatter: false,
        }
    }

    // 尝试匹配 front matter
    const match = markdown.match(FRONT_MATTER_REGEX)

    if (match && match[1]) {
        const frontMatter = match[1]
        const content = markdown.slice(frontMatter.length)

        return {
            frontMatter,
            content,
            hasFrontMatter: true,
        }
    }

    // 没有匹配到有效的 front matter
    return {
        frontMatter: null,
        content: markdown,
        hasFrontMatter: false,
    }
}

/**
 * 将 front matter 和正文内容合并
 *
 * @param frontMatter front matter 字符串（包含 --- 分隔符）
 * @param content 正文内容
 * @returns 合并后的 Markdown 内容
 *
 * @example
 * ```ts
 * const merged = mergeFrontMatter('---\ntitle: 测试\n---\n', '正文内容')
 * // merged = '---\ntitle: 测试\n---\n正文内容'
 * ```
 */
export function mergeFrontMatter(frontMatter: string | null, content: string): string {
    if (!frontMatter) {
        return content
    }

    // 确保 front matter 以换行结尾
    const normalizedFrontMatter = frontMatter.endsWith('\n')
        ? frontMatter
        : frontMatter + '\n'

    return normalizedFrontMatter + content
}
