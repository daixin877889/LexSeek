/**
 * 小索对话中 Mermaid 图表的高清 PNG 导出
 *
 * 问题：vue-stream-markdown@0.7.1 内置的 SVG→PNG 转换（`svgToPngBlob`，内部函数，0.7.1 不再对外暴露）
 * - 直接用 `new Image(); img.src = data:image/svg+xml;base64,...` 加载 SVG，
 * - 然后 `img.width * 5 × img.height * 5` 画到 canvas。
 *
 * 但 Mermaid 的 SVG 长这样：`<svg width="100%" style="max-width:1234px" viewBox="0 0 1234 567">`。
 * 在 Image 脱离文档的语境下 `width="100%"` 会让 `naturalWidth` 回退到浏览器默认值（常常 300×150），
 * scale=5 之后只有 1500×750 的栅格底图，再加上不乘 DPR，Retina 屏上必然糊。
 *
 * 本 composable 的修复思路：
 * 1. 用项目已安装的 `mermaid` 直接渲染出 SVG（保证拿到最新渲染结果）。
 * 2. 从 viewBox 读出真实宽高，强制写回 <svg> 的 width / height 属性。
 * 3. 用 Blob URL（不走 btoa，避开中文/emoji 编码失败）加载图像。
 * 4. canvas 目标尺寸 = viewBox 尺寸 × scale × devicePixelRatio（并钳制到 16000px，避开 iOS Safari 上限）。
 *
 * 通过 `markdownControls` 借助 vue-stream-markdown 的 `controls.code.customize` 扩展点拦截
 * 下拉里"PNG"那一项的点击，SVG / MMD 保持走库内原逻辑，不动 node_modules。
 *
 * 注意：**是 `controls.code` 不是 `controls.mermaid`**。库把 mermaid 作为 `lang=mermaid`
 * 的代码块渲染，下拉是 CodeBlock 组件画的，走 `resolveControls('code', ...)`；
 * `controls.mermaid.customize` 控的是图内部 ZoomContainer 的缩放按钮，不是这里要拦的下载。
 */

import type { CodeNodeRendererProps, Control, ControlTransformer, SelectOption } from 'vue-stream-markdown'
import mermaid from 'mermaid'
import { toast } from 'vue-sonner'

/** 默认栅格倍率（相对 viewBox 尺寸），实际像素还会再乘 devicePixelRatio。 */
export const DEFAULT_PNG_SCALE = 5

/** canvas 最大边长，iOS Safari 上限 16384，留一点余量。 */
const MAX_CANVAS_SIDE = 16000

/**
 * 从 SVG 字符串的 viewBox 里解析出宽高。
 *
 * viewBox 合法格式：`min-x min-y width height`，以空白或逗号分隔。
 * 任意一个维度为 0 或负数都视为非法。
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
 * 强制覆盖根 `<svg>` 的 width / height 属性为给定像素值。
 *
 * 保留其他属性不动，只动最外层第一个 `<svg ...>` 开标签，
 * 避免波及 Mermaid 在图表内部偶尔嵌套的 `<svg>`（箭头、图标等）。
 */
export function injectSvgDimensions(svg: string, width: number, height: number): string {
    return svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
        // 先剔掉已有的 width / height（包括百分比值），再在末尾追加像素值
        const cleaned = attrs
            .replace(/\s+width\s*=\s*["'][^"']*["']/i, '')
            .replace(/\s+height\s*=\s*["'][^"']*["']/i, '')
        return `<svg${cleaned} width="${width}" height="${height}">`
    })
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        // 不设 crossOrigin：src 是自己编码的 data: URL，同源的，设了反而会触发 CORS 检查
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('SVG 图像加载失败'))
        img.src = url
    })
}

/**
 * 把 SVG 字符串编码成 data: URL。
 *
 * 不用 `btoa(unescape(encodeURIComponent(...)))` 那一套——遇到 Mermaid 图里常见的
 * 中文 / emoji 会抛 `InvalidCharacterError`，而且 `unescape` 已废弃。
 * 直接用 `encodeURIComponent` 做 URL 编码，浏览器加载时自己解码；UTF-8 安全、零特殊字符坑。
 *
 * 同时选用 data: URL 而非 blob: URL：后者在 Chrome 中会被当作跨源加载，
 * 导致 canvas 被标记为 tainted，`toBlob` 抛 `SecurityError`。
 */
function svgToDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) reject(new Error('canvas.toBlob 返回空'))
            else resolve(blob)
        }, 'image/png')
    })
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

export function useMermaidHdPng() {
    const { isDark } = useColorMode()

    async function renderToSvg(code: string): Promise<string> {
        // 沿用 vue-stream-markdown 的主题切换方式：在源码前插入 %%{init}%% 指令
        const theme = isDark.value ? 'dark' : 'default'
        const wrapped = code.trimStart().startsWith('%%{')
            ? code
            : `%%{init: {"theme": "${theme}"}}%%\n${code}`
        const id = `mermaid-hd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const { svg } = await mermaid.render(id, wrapped)
        return svg
    }

    async function svgToPngBlob(svg: string, scale: number): Promise<Blob> {
        const viewBox = extractViewBoxSize(svg)
        // viewBox 缺失时给个兜底（避免 0 除），实测 Mermaid 永远会出 viewBox
        const baseW = viewBox?.width ?? 1200
        const baseH = viewBox?.height ?? 800
        const fixed = injectSvgDimensions(svg, baseW, baseH)

        const img = await loadSvgImage(svgToDataUrl(fixed))
        const dpr = Math.max(1, window.devicePixelRatio || 1)

        // 总倍率 = scale × DPR，并钳制在 MAX_CANVAS_SIDE 以内避免 iOS Safari 崩溃
        let totalScale = scale * dpr
        const maxScaleByW = MAX_CANVAS_SIDE / baseW
        const maxScaleByH = MAX_CANVAS_SIDE / baseH
        const scaleCap = Math.min(maxScaleByW, maxScaleByH)
        if (totalScale > scaleCap) totalScale = Math.max(1, scaleCap)

        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(baseW * totalScale)
        canvas.height = Math.ceil(baseH * totalScale)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D 上下文不可用')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        return canvasToPngBlob(canvas)
    }

    /** 根据 Mermaid 源码生成高清 PNG 并触发浏览器下载。失败时 toast 报错并 reject。 */
    async function exportHd(code: string, scale = DEFAULT_PNG_SCALE): Promise<void> {
        try {
            if (!code?.trim()) throw new Error('Mermaid 源码为空')
            const svg = await renderToSvg(code)
            if (!svg) throw new Error('Mermaid 渲染结果为空')
            const blob = await svgToPngBlob(svg, scale)
            triggerDownload(blob, `diagram-${Date.now()}.png`)
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error(`下载高清 PNG 失败：${msg}`)
            throw err
        }
    }

    /**
     * 传给 `<Markdown :controls="...">` 的配置对象。
     *
     * 实现关键点：vue-stream-markdown 把 mermaid 作为 `lang=mermaid` 的代码块渲染，
     * 下拉里的 SVG / PNG / MMD 三个选项来自 CodeBlock 组件（见 code-block-*.js 里的
     * `resolveControls('code', ...)`）。所以 customize 必须挂在 `controls.code` 上，
     * 挂到 `controls.mermaid` 完全不会被调用（那个是图内部 ZoomContainer 的配置）。
     *
     * 所有代码块都会经过这里，仅在 lang === 'mermaid' 且点击的是 PNG 时才接管。
     */
    const customizeCode: ControlTransformer<CodeNodeRendererProps> = (builtin, props) => {
        if (props.node?.lang !== 'mermaid') return builtin
        return builtin.map((ctrl: Control) => {
            if (ctrl.key !== 'download') return ctrl
            const originalOnClick = ctrl.onClick
            return {
                ...ctrl,
                onClick: (e: MouseEvent, item?: SelectOption) => {
                    if (item?.value === 'png') {
                        // 吞掉 reject，exportHd 内部已 toast，不再二次上报
                        void exportHd(props.node?.value ?? '').catch(() => {})
                        return
                    }
                    originalOnClick(e, item)
                },
            }
        })
    }

    const markdownControls = {
        code: { customize: customizeCode },
    }

    return { exportHd, markdownControls }
}
