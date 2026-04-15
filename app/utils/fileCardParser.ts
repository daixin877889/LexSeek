/**
 * `[file-card]` 标记解析器
 *
 * Agent 工具 `upload_workspace_file` 返回多行格式：
 * ```
 * [file-card]
 * fileId: 17
 * fileName: presentation.pptx
 * fileSize: 155790
 * mimeType: application/...
 * [/file-card]
 * ```
 *
 * 但 LLM 经常违反"原样粘贴"约定，缩写成单行格式：
 * ```
 * [file-card]fileId=17[/file-card]
 * ```
 * 或省略部分字段。本 parser 在两种 separator（`:` 和 `=`）都接受，
 * 且只硬性要求 `fileId`，其它字段缺失时由前端组件自动从 API 拉取。
 */

/** 文件卡片字段 */
export interface FileCardData {
    fileId: string
    /** 缺失时前端会从元数据 API 自动拉取 */
    fileName: string
    /** 缺失时显示为 0，前端会从 API 拉取 */
    fileSize: number
    /** 缺失时使用 application/octet-stream 占位，前端会从 API 拉取 */
    mimeType: string
    /** 临时文件标记 */
    temporary?: boolean
    /** 临时文件过期时间（ISO 字符串） */
    expiresAt?: string
}

/** `[file-card]...[/file-card]` 整体匹配（非贪婪、含跨行） */
export const FILE_CARD_RE = /\[file-card\]([\s\S]*?)\[\/file-card\]/g

/**
 * 解析单个 `[file-card]` 块体（不含外层标签）
 *
 * 接受的 key/value 格式：
 * - `key: value`（标准多行格式，tool 默认输出）
 * - `key=value`（LLM 缩写格式，例如 `[file-card]fileId=17[/file-card]`）
 * - 一行一个 kv 对；同一块内可混用 `:` 和 `=`
 *
 * @param block tag 之间的文本（已剥离 `[file-card]` 与 `[/file-card]`）
 * @returns 解析结果；缺失 `fileId` 时返回 null（无法渲染）
 */
export function parseFileCardBlock(block: string): FileCardData | null {
    const fields: Record<string, string> = {}

    for (const rawLine of block.split('\n')) {
        const line = rawLine.trim()
        if (!line) continue

        const sepIdx = findSeparator(line)
        if (sepIdx === -1) continue
        const key = line.slice(0, sepIdx).trim()
        const value = line.slice(sepIdx + 1).trim()
        if (key && value) fields[key] = value
    }

    if (!fields.fileId) return null

    return {
        fileId: fields.fileId,
        fileName: fields.fileName ?? '',
        fileSize: Number(fields.fileSize ?? 0) || 0,
        mimeType: fields.mimeType ?? '',
        temporary: fields.temporary === 'true',
        expiresAt: fields.expiresAt,
    }
}

/** 找到第一个 `:` 或 `=`，谁靠前用谁（这是 key/value 分隔符） */
function findSeparator(s: string): number {
    const colon = s.indexOf(':')
    const equals = s.indexOf('=')
    if (colon === -1) return equals
    if (equals === -1) return colon
    return Math.min(colon, equals)
}

/** 消息内容片段：markdown 文本或文件卡片 */
export type FileCardSegment =
    | { type: 'markdown', text: string }
    | { type: 'file-card', data: FileCardData }

/**
 * 将原始消息内容解析为片段数组
 *
 * 有效的 `[file-card]` 块替换为 file-card 片段；解析失败（缺 fileId）
 * 则保留原文为 markdown 片段
 */
export function parseMessageSegments(content: string): FileCardSegment[] {
    if (!content.includes('[file-card]')) {
        return [{ type: 'markdown', text: content }]
    }

    const result: FileCardSegment[] = []
    let lastIndex = 0

    for (const match of content.matchAll(FILE_CARD_RE)) {
        const matchStart = match.index!
        const matchEnd = matchStart + match[0].length
        const blockContent = match[1]!

        if (matchStart > lastIndex) {
            const text = content.slice(lastIndex, matchStart)
            if (text) result.push({ type: 'markdown', text })
        }

        const data = parseFileCardBlock(blockContent)
        if (data) {
            result.push({ type: 'file-card', data })
        } else {
            // 解析失败保留原文（debug 用）
            result.push({ type: 'markdown', text: match[0] })
        }

        lastIndex = matchEnd
    }

    if (lastIndex < content.length) {
        result.push({ type: 'markdown', text: content.slice(lastIndex) })
    }

    return result
}
