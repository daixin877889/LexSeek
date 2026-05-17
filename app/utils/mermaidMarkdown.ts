/**
 * Markdown 中 Mermaid 围栏代码块的扫描与替换（纯函数，无副作用、无 DOM 依赖）。
 *
 * 用于导出 Word 时把 ```mermaid 代码块替换成已渲染好的 data URL 图片。
 * 渲染本身在 app/lib/mermaidRaster.ts，本文件只负责定位与字符串替换。
 */

/** 一个 mermaid 围栏块在原始 markdown 中的位置与源码 */
export interface MermaidBlock {
    /** 围栏内的 mermaid 源码（不含围栏行本身） */
    code: string
    /** 围栏块在原始 markdown 中的起始下标（含） */
    start: number
    /** 围栏块在原始 markdown 中的结束下标（不含） */
    end: number
}

/** 一张已渲染好的 mermaid 图片，供替换时写入 markdown */
export interface MermaidImageRef {
    /** PNG 的 data URL（data:image/png;base64,...） */
    dataUrl: string
    /** 在 Word 中的显示宽度（整数像素） */
    width: number
    /** 在 Word 中的显示高度（整数像素） */
    height: number
}

/**
 * 扫描 markdown 中所有 ```mermaid 围栏代码块。
 *
 * 只匹配标准三反引号围栏（容忍行首缩进、语言标记前后的空白）；
 * 不处理波浪号 ~~~ 围栏——AI 生成内容一律用反引号围栏。
 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
    // 每次新建正则，避免 g 标志的 lastIndex 跨调用残留
    const fenceRe = /^[ \t]*```[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/gm
    const blocks: MermaidBlock[] = []
    let match: RegExpExecArray | null
    while ((match = fenceRe.exec(markdown)) !== null) {
        blocks.push({
            code: match[1] ?? '',
            start: match.index,
            end: match.index + match[0].length,
        })
    }
    return blocks
}

/**
 * 把成功渲染的 mermaid 围栏块替换成 data URL 图片。
 *
 * @param markdown 原始 markdown
 * @param blocks   extractMermaidBlocks 的结果
 * @param images   与 blocks 一一对应的渲染结果；null 表示该块渲染失败、保留原始代码
 *
 * 图片写成 `![diagram](dataUrl "宽x高")`，title 里的「宽x高」会被 markdown-docx
 * 的 parseImageTitleSize 用作 Word 中的显示尺寸。
 */
export function replaceMermaidBlocks(
    markdown: string,
    blocks: MermaidBlock[],
    images: Array<MermaidImageRef | null>,
): string {
    let result = markdown
    // 逆序替换：先替换靠后的块，前面块的 start/end 下标才不会失效
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i]!
        const image = images[i]
        if (!image) continue
        const imageMarkdown = `![diagram](${image.dataUrl} "${image.width}x${image.height}")`
        result = result.slice(0, block.start) + imageMarkdown + result.slice(block.end)
    }
    return result
}
