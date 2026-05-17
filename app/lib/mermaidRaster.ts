/**
 * Mermaid 源码 → PNG（data URL）渲染工具。
 *
 * 本文件含 DOM 副作用（mermaid 渲染、canvas 栅格化），定位为渲染工具而非纯工具；
 * 其中 extractViewBoxSize / injectSvgDimensions / clampDiagramSize 是纯函数，单独导出供单测。
 *
 * 修复的渲染坑（迁移自原 useMermaidHdPng）：
 * - Mermaid 输出 `<svg width="100%" viewBox="...">`，脱离文档时 naturalWidth 回退到
 *   300×150，栅格化后模糊 → 从 viewBox 解析真实宽高并强制写回 <svg>。
 * - 用 data: URL（encodeURIComponent，非 btoa）加载 SVG，避开中文/emoji 编码失败与 canvas tainted。
 * - canvas 目标边长钳制到 MAX_CANVAS_SIDE，避开 iOS Safari 上限。
 */

/** canvas 最大边长，iOS Safari 上限 16384，留余量 */
const MAX_CANVAS_SIDE = 16000

/** mermaid 渲染选项 */
export interface MermaidPngOptions {
    /** mermaid 主题，默认 'default'（浅色） */
    theme?: 'default' | 'dark'
    /** 栅格倍率（相对 viewBox 尺寸），实际像素再乘 devicePixelRatio */
    scale: number
    /**
     * 显示尺寸的最大宽度（整数像素）。给定时按 viewBox 宽高比缩放到不超过该宽度，
     * 用于 Word 嵌图；不给定时显示尺寸即 viewBox 原始尺寸。
     */
    maxDisplayWidth?: number
}

/** mermaid 渲染结果 */
export interface MermaidPngResult {
    /** PNG 的 data URL */
    dataUrl: string
    /** 建议显示宽度（整数像素） */
    width: number
    /** 建议显示高度（整数像素） */
    height: number
}

/**
 * 从 SVG 字符串的 viewBox 解析宽高。viewBox 格式：`min-x min-y width height`。
 * 任一维度为 0 或负数视为非法，返回 null。
 */
export function extractViewBoxSize(svg: string): { width: number, height: number } | null {
    const match = svg.match(/viewBox\s*=\s*["']([^"']+)["']/)
    if (!match) return null
    const parts = match[1]!.trim().split(/[\s,]+/).map(Number)
    if (parts.length !== 4) return null
    const [, , w, h] = parts as [number, number, number, number]
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
    return { width: w, height: h }
}

/**
 * 强制覆盖根 <svg> 的 width / height 属性为给定像素值。
 * 只动最外层第一个 <svg> 开标签，不波及内部嵌套的 <svg>。
 */
export function injectSvgDimensions(svg: string, width: number, height: number): string {
    return svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
        const cleaned = attrs
            .replace(/\s+width\s*=\s*["'][^"']*["']/i, '')
            .replace(/\s+height\s*=\s*["'][^"']*["']/i, '')
        return `<svg${cleaned} width="${width}" height="${height}">`
    })
}

/**
 * 按 viewBox 宽高比，把图表显示尺寸钳制到不超过 maxWidth。
 * 返回整数像素（markdown-docx 的 title 尺寸正则 /^(\d+%?)x(\d+%?)$/ 只认整数）。
 */
export function clampDiagramSize(
    viewBoxWidth: number,
    viewBoxHeight: number,
    maxWidth: number,
): { width: number, height: number } {
    if (viewBoxWidth <= maxWidth) {
        return { width: Math.round(viewBoxWidth), height: Math.round(viewBoxHeight) }
    }
    const ratio = maxWidth / viewBoxWidth
    return {
        width: Math.round(maxWidth),
        height: Math.max(1, Math.round(viewBoxHeight * ratio)),
    }
}

/** 用 mermaid 渲染源码为 SVG 字符串，主题通过 %%{init}%% 指令注入 */
async function renderMermaidToSvg(code: string, theme: 'default' | 'dark'): Promise<string> {
    // 动态 import：mermaid 体积大，按需加载，避免进主 bundle
    const { default: mermaid } = await import('mermaid')
    const wrapped = code.trimStart().startsWith('%%{')
        ? code
        : `%%{init: {"theme": "${theme}"}}%%\n${code}`
    const id = `mermaid-raster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const { svg } = await mermaid.render(id, wrapped)
    return svg
}

/** 把 SVG 字符串编码成 data: URL（UTF-8 安全，避开 btoa 对中文/emoji 的编码失败） */
function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 加载 data: URL 形式的 SVG 为 HTMLImageElement */
function loadSvgImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('SVG 图像加载失败'))
        img.src = url
    })
}

/**
 * 把 Mermaid 源码渲染成 PNG 的 data URL。
 *
 * @throws 源码为空 / 渲染失败 / SVG 加载失败 / canvas 不可用时抛错，由调用方决定降级策略。
 */
export async function mermaidToPng(
    code: string,
    options: MermaidPngOptions,
): Promise<MermaidPngResult> {
    if (!code?.trim()) throw new Error('Mermaid 源码为空')
    const theme = options.theme ?? 'default'
    const svg = await renderMermaidToSvg(code, theme)
    if (!svg) throw new Error('Mermaid 渲染结果为空')

    const viewBox = extractViewBoxSize(svg)
    // viewBox 缺失时兜底（实测 Mermaid 永远会出 viewBox）
    const baseW = viewBox?.width ?? 1200
    const baseH = viewBox?.height ?? 800
    const fixedSvg = injectSvgDimensions(svg, baseW, baseH)

    const img = await loadSvgImage(svgToDataUrl(fixedSvg))
    const dpr = Math.max(1, window.devicePixelRatio || 1)

    // 总倍率 = scale × DPR，钳制在 MAX_CANVAS_SIDE 以内
    let totalScale = options.scale * dpr
    const scaleCap = Math.min(MAX_CANVAS_SIDE / baseW, MAX_CANVAS_SIDE / baseH)
    if (totalScale > scaleCap) totalScale = Math.max(1, scaleCap)

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(baseW * totalScale)
    canvas.height = Math.ceil(baseH * totalScale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D 上下文不可用')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const display = options.maxDisplayWidth != null
        ? clampDiagramSize(baseW, baseH, options.maxDisplayWidth)
        : { width: Math.round(baseW), height: Math.round(baseH) }

    return {
        dataUrl: canvas.toDataURL('image/png'),
        width: display.width,
        height: display.height,
    }
}
