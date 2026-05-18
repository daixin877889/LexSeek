/**
 * HTML 净化工具
 *
 * 识别结果（marked 转换的 markdown / 客户端提交的 docx HTML）落库前必须净化，
 * 剔除 script、事件属性、javascript: 协议等，防止存储型 XSS。
 */
import sanitizeHtml from 'sanitize-html'

/** 识别结果富文本净化配置：保留排版/表格/图片，剔除脚本与事件属性 */
const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
    // 默认标签集合不含 img / h1 / h2，识别结果需要，显式补充
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ['src', 'alt', 'title', 'width', 'height'],
        '*': ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // 客户端 docx 识别可能内嵌 base64 图片，仅对 img 放行 data: 协议
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
}

/**
 * 净化富文本 HTML：移除 script/iframe、on* 事件属性、危险协议，保留排版结构。
 */
export function sanitizeRichHtml(dirty: string): string {
    return sanitizeHtml(dirty, RICH_TEXT_OPTIONS)
}
