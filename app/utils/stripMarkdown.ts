/**
 * 去掉常见 Markdown 标记返回纯文本预览。
 *
 * 用于在工具结果卡片（MaterialSearchTool / AnalysisSearchTool 等）的列表预览段
 * 显示去格式化的摘录，避免 # / ** / 列表符号污染纯文本预览。完整渲染走 vue-stream-markdown。
 */
export function stripMarkdown(input: string): string {
    return input
        .replace(/```[\s\S]*?```/g, '')                  // 代码块
        .replace(/`([^`]+)`/g, '$1')                     // 行内代码
        .replace(/!\[([^\]]*)]\([^)]*\)/g, '$1')         // 图片
        .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')          // 链接
        .replace(/^#{1,6}\s+/gm, '')                     // 标题井号
        .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1') // 粗斜体/删除线
        .replace(/^\s*[-*+]\s+/gm, '')                   // 无序列表
        .replace(/^\s*\d+\.\s+/gm, '')                   // 有序列表
        .replace(/^\s*>\s?/gm, '')                       // 引用
        .replace(/\n{2,}/g, ' ')                         // 多换行折叠
        .replace(/\s+/g, ' ')                            // 连续空白
        .trim()
}
