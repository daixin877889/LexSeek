/**
 * 把含 Mermaid 图表的 Markdown 导出为 Word 文档（.docx）。
 *
 * 流程：扫描 ```mermaid 围栏块 → 逐个渲染成 PNG 的 data URL → 替换成 data URL 图片 →
 * markdown-docx 打包（默认下载器原生用 fetch 解码 data URL，无需自定义 imageAdapter）→
 * 主路径失败时回退 marked + html-docx-js。
 *
 * 渲染失败的 mermaid 块保留原始代码块；主、回退路径都失败时抛错，由调用方提示 UI。
 */

import { extractMermaidBlocks, replaceMermaidBlocks } from '~/utils/mermaidMarkdown'
import type { MermaidImageRef } from '~/utils/mermaidMarkdown'
import { mermaidToPng } from '~/lib/mermaidRaster'

/** Word 正文宽度（A4 竖版，约 600px），用于把图表显示宽度钳制到正文内 */
const WORD_CONTENT_WIDTH = 600
/** 导出图表的栅格倍率（相对 viewBox），保证清晰又不至于让 docx 体积过大 */
const EXPORT_PNG_SCALE = 2

export function useMarkdownDocxExport() {
    /** 把所有 ```mermaid 围栏块渲染成 data URL 图片；渲染失败的块保留原始代码 */
    async function embedMermaidImages(markdown: string): Promise<string> {
        const blocks = extractMermaidBlocks(markdown)
        if (blocks.length === 0) return markdown

        const images: Array<MermaidImageRef | null> = []
        for (const block of blocks) {
            try {
                const png = await mermaidToPng(block.code, {
                    // Word 是白底，固定浅色主题，不跟随 App 明暗模式
                    theme: 'default',
                    scale: EXPORT_PNG_SCALE,
                    maxDisplayWidth: WORD_CONTENT_WIDTH,
                })
                images.push({ dataUrl: png.dataUrl, width: png.width, height: png.height })
            }
            catch (err) {
                logger.warn('[useMarkdownDocxExport] Mermaid 渲染失败，保留原始代码块', err)
                images.push(null)
            }
        }
        return replaceMermaidBlocks(markdown, blocks, images)
    }

    /** 把 Markdown 打包成 docx Blob：主路径 markdown-docx，失败回退 html-docx-js */
    async function renderDocx(markdown: string): Promise<Blob> {
        try {
            const { default: markdownDocx, Packer } = await import('markdown-docx')
            const doc = await markdownDocx(markdown, { ignoreHtml: true })
            return await Packer.toBlob(doc)
        }
        catch (err) {
            logger.warn('[useMarkdownDocxExport] markdown-docx 失败，回退 html-docx-js', err)
            const { marked } = await import('marked')
            const html = await marked(markdown)
            const { asBlob } = await import('html-docx-js-typescript')
            return await asBlob(html) as Blob
        }
    }

    /**
     * 把含 Mermaid 图表的 Markdown 导出为 .docx 并触发浏览器下载。
     * @param markdown 完整 Markdown
     * @param filename 下载文件名（含 .docx 后缀）
     * @throws 主、回退路径都失败时抛错，由调用方决定 UI 提示。
     */
    async function exportMarkdownToDocx(markdown: string, filename: string): Promise<void> {
        const processed = await embedMermaidImages(markdown)
        const blob = await renderDocx(processed)
        const { saveAs } = await import('file-saver')
        saveAs(blob, filename)
    }

    return { exportMarkdownToDocx }
}
