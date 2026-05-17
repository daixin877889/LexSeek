/**
 * 小索对话中 Mermaid 图表的高清 PNG 导出。
 *
 * vue-stream-markdown 内置的 SVG→PNG 转换在 Retina 屏上会糊（详见 app/lib/mermaidRaster.ts
 * 的说明）。本 composable 通过 controls.code.customize 拦截下拉里「PNG」项的点击，
 * 改用 mermaidRaster 的 mermaidToPng 生成高清 PNG 并下载；SVG / MMD 保持库内原逻辑。
 *
 * 注意：是 `controls.code` 不是 `controls.mermaid`——库把 mermaid 作为 lang=mermaid
 * 的代码块渲染，下拉是 CodeBlock 组件画的，走 resolveControls('code', ...)；
 * controls.mermaid.customize 控的是图内部 ZoomContainer 的缩放按钮，不是这里要拦的下载。
 */

import type { CodeNodeRendererProps, Control, ControlTransformer, SelectOption } from 'vue-stream-markdown'
import { toast } from 'vue-sonner'
import { mermaidToPng } from '~/lib/mermaidRaster'
import { useColorMode } from '~/composables/useColorMode'

/** 默认栅格倍率（相对 viewBox 尺寸），实际像素还会再乘 devicePixelRatio */
export const DEFAULT_PNG_SCALE = 5

/** 用 data URL 触发浏览器下载 */
function triggerDownload(dataUrl: string, filename: string): void {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
}

export function useMermaidHdPng() {
    const { isDark } = useColorMode()

    /** 根据 Mermaid 源码生成高清 PNG 并触发浏览器下载。失败时 toast 报错并 reject。 */
    async function exportHd(code: string, scale = DEFAULT_PNG_SCALE): Promise<void> {
        try {
            const { dataUrl } = await mermaidToPng(code, {
                // 小索对话内的下载跟随 App 明暗模式
                theme: isDark.value ? 'dark' : 'default',
                scale,
            })
            triggerDownload(dataUrl, `diagram-${Date.now()}.png`)
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            toast.error(`下载高清 PNG 失败：${msg}`)
            throw err
        }
    }

    /**
     * 传给 `<Markdown :controls="...">` 的配置对象。
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
