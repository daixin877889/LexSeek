# 案件分析导出 Word 时 Mermaid 图表转图片 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导出案件分析结果为 Word 时，把 Markdown 里的 Mermaid 图表渲染成图片嵌入文档。

**Architecture:** 在浏览器端把 ` ```mermaid ` 围栏块逐个渲染成 PNG 的 data URL，替换成 `![](data:... "宽x高")` 图片写回 Markdown，再用 `markdown-docx` 打包成 docx。`markdown-docx` 默认下载器原生支持 data URL，无需自定义 imageAdapter；主路径失败回退 `marked` + `html-docx-js`。渲染失败的图表保留原始代码块。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript；`mermaid`（图表渲染）、`markdown-docx`（Markdown→docx）、`html-docx-js-typescript`（回退）、`file-saver`（下载）、`marked`（回退）。测试 Vitest + fast-check。

> 设计文档：`docs/superpowers/specs/2026-05-16-case-analysis-docx-mermaid-image-design.md`

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `app/utils/mermaidMarkdown.ts` | 新增 | 纯函数：扫描 / 替换 Markdown 里的 ` ```mermaid ` 围栏块 |
| `app/lib/mermaidRaster.ts` | 新增 | Mermaid 源码 → PNG data URL（DOM 栅格化）+ 纯辅助函数 |
| `app/composables/useMarkdownDocxExport.ts` | 新增 | 编排：预处理 Mermaid → 打包 docx → 回退 → 下载 |
| `app/composables/useMermaidHdPng.ts` | 重写 | 改为复用 `mermaidRaster.ts`，删除自带的 SVG→PNG 实现 |
| `app/components/caseDetail/CaseExportDialog.vue` | 修改 | `executeExport` 改调 `useMarkdownDocxExport` |
| `tests/app/utils/mermaidMarkdown.test.ts` | 新增 | `mermaidMarkdown.ts` 纯函数单测 |
| `tests/app/lib/mermaidRaster.test.ts` | 新增 | `mermaidRaster.ts` 纯辅助函数单测（含从旧测试迁移的用例） |
| `tests/app/composables/useMermaidHdPng.test.ts` | 删除 | 内含的纯函数已迁出，删除（不留空文件） |

**依赖关系**：Task 1（mermaidMarkdown）与 Task 2（mermaidRaster）相互独立；Task 3（重构 useMermaidHdPng）依赖 Task 2；Task 4（useMarkdownDocxExport）依赖 Task 1+2；Task 5（接入 Dialog）依赖 Task 4；Task 6 验证全部。按 Task 编号顺序执行即可。

---

## Task 1: mermaidMarkdown.ts —— 围栏块扫描与替换（纯函数）

**Files:**
- Create: `app/utils/mermaidMarkdown.ts`
- Test: `tests/app/utils/mermaidMarkdown.test.ts`

- [ ] **Step 1: 写失败的测试**

创建 `tests/app/utils/mermaidMarkdown.test.ts`：

```ts
/**
 * mermaidMarkdown 单元测试
 *
 * 验证 ```mermaid 围栏块的扫描与替换是纯字符串逻辑、不破坏块外内容。
 */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { extractMermaidBlocks, replaceMermaidBlocks } from '~/utils/mermaidMarkdown'

describe('extractMermaidBlocks', () => {
    it('无 mermaid 块时返回空数组', () => {
        expect(extractMermaidBlocks('# 标题\n\n普通段落')).toEqual([])
    })

    it('提取单个 mermaid 块，code 与位置正确', () => {
        const md = '前文\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n后文'
        const blocks = extractMermaidBlocks(md)
        expect(blocks).toHaveLength(1)
        expect(blocks[0]!.code).toBe('graph TD\n  A-->B')
        expect(md.slice(blocks[0]!.start, blocks[0]!.end))
            .toBe('```mermaid\ngraph TD\n  A-->B\n```')
    })

    it('提取多个 mermaid 块', () => {
        const md = '```mermaid\nA\n```\n\n中间\n\n```mermaid\nB\n```'
        const blocks = extractMermaidBlocks(md)
        expect(blocks).toHaveLength(2)
        expect(blocks[0]!.code).toBe('A')
        expect(blocks[1]!.code).toBe('B')
    })

    it('容忍语言标记后的尾随空格', () => {
        const md = '```mermaid   \ngraph TD\n```'
        expect(extractMermaidBlocks(md)).toHaveLength(1)
    })

    it('不误匹配非 mermaid 代码块', () => {
        expect(extractMermaidBlocks('```js\nconst a = 1\n```')).toEqual([])
        expect(extractMermaidBlocks('```\nplain\n```')).toEqual([])
    })
})

describe('replaceMermaidBlocks', () => {
    it('把成功渲染的块替换成带尺寸 title 的 data URL 图片', () => {
        const md = 'X\n\n```mermaid\ngraph TD\n```\n\nY'
        const blocks = extractMermaidBlocks(md)
        const out = replaceMermaidBlocks(md, blocks, [
            { dataUrl: 'data:image/png;base64,AAA', width: 600, height: 400 },
        ])
        expect(out).toBe('X\n\n![diagram](data:image/png;base64,AAA "600x400")\n\nY')
    })

    it('渲染失败（null）的块保留原始代码', () => {
        const md = '```mermaid\nbad syntax\n```'
        const blocks = extractMermaidBlocks(md)
        expect(replaceMermaidBlocks(md, blocks, [null])).toBe(md)
    })

    it('多块混合：部分成功部分失败，互不影响', () => {
        const md = '```mermaid\nA\n```\n\n```mermaid\nB\n```'
        const blocks = extractMermaidBlocks(md)
        const out = replaceMermaidBlocks(md, blocks, [
            { dataUrl: 'data:image/png;base64,AAA', width: 100, height: 50 },
            null,
        ])
        expect(out).toBe('![diagram](data:image/png;base64,AAA "100x50")\n\n```mermaid\nB\n```')
    })

    it('属性测试：全部渲染失败时输出与输入完全一致', () => {
        fc.assert(
            fc.property(fc.string(), (md) => {
                const blocks = extractMermaidBlocks(md)
                const out = replaceMermaidBlocks(md, blocks, blocks.map(() => null))
                expect(out).toBe(md)
            }),
            { numRuns: 100 },
        )
    })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/app/utils/mermaidMarkdown.test.ts --reporter=verbose`
Expected: FAIL —— 模块 `~/utils/mermaidMarkdown` 不存在。

- [ ] **Step 3: 写最小实现**

创建 `app/utils/mermaidMarkdown.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/app/utils/mermaidMarkdown.test.ts --reporter=verbose`
Expected: PASS —— 全部用例通过。

- [ ] **Step 5: 提交**

```bash
git add app/utils/mermaidMarkdown.ts tests/app/utils/mermaidMarkdown.test.ts
git commit -m "feat(cases): 新增 mermaid 围栏块扫描与替换纯函数"
```

---

## Task 2: mermaidRaster.ts —— Mermaid 源码渲染成 PNG

**Files:**
- Create: `app/lib/mermaidRaster.ts`
- Test: `tests/app/lib/mermaidRaster.test.ts`

> 说明：`extractViewBoxSize` / `injectSvgDimensions` 从 `app/composables/useMermaidHdPng.ts` 原样迁移而来（逻辑不变）；`clampDiagramSize` 为新增；`mermaidToPng` 为新增的渲染主函数，含 DOM 副作用，靠 Task 6 的 E2E 覆盖，不写单测。

- [ ] **Step 1: 写失败的测试**

创建 `tests/app/lib/mermaidRaster.test.ts`（前两个 describe 的用例从旧 `useMermaidHdPng.test.ts` 迁移、仅改 import；`clampDiagramSize` 为新增）：

```ts
/**
 * mermaidRaster 纯辅助函数单元测试
 *
 * 只测纯函数（viewBox 解析 / SVG 尺寸注入 / 显示尺寸钳制）；
 * mermaidToPng 依赖 mermaid 渲染 + canvas，在 happy-dom 下行为不真实，由 E2E 覆盖。
 */
import { describe, expect, it } from 'vitest'
import { clampDiagramSize, extractViewBoxSize, injectSvgDimensions } from '~/lib/mermaidRaster'

describe('extractViewBoxSize', () => {
    it('解析标准 viewBox 返回宽高', () => {
        expect(extractViewBoxSize('<svg viewBox="0 0 1234 567"></svg>')).toEqual({
            width: 1234,
            height: 567,
        })
    })

    it('支持逗号分隔的 viewBox', () => {
        expect(extractViewBoxSize('<svg viewBox="0,0,100,50"></svg>')).toEqual({
            width: 100,
            height: 50,
        })
    })

    it('viewBox 缺失时返回 null', () => {
        expect(extractViewBoxSize('<svg></svg>')).toBeNull()
    })

    it('viewBox 格式不完整（少于 4 个数）时返回 null', () => {
        expect(extractViewBoxSize('<svg viewBox="0 0 100"></svg>')).toBeNull()
    })

    it('宽或高为非正数时返回 null', () => {
        expect(extractViewBoxSize('<svg viewBox="0 0 -10 50"></svg>')).toBeNull()
        expect(extractViewBoxSize('<svg viewBox="0 0 0 50"></svg>')).toBeNull()
        expect(extractViewBoxSize('<svg viewBox="0 0 100 0"></svg>')).toBeNull()
    })

    it('忽略前导空白和多余空格', () => {
        expect(extractViewBoxSize('<svg viewBox="  0   0   800   400  "></svg>')).toEqual({
            width: 800,
            height: 400,
        })
    })
})

describe('injectSvgDimensions', () => {
    it('把 width="100%" / height="50%" 替换成像素值', () => {
        const input = '<svg width="100%" height="50%" viewBox="0 0 800 400">x</svg>'
        const out = injectSvgDimensions(input, 800, 400)
        expect(out).toContain('width="800"')
        expect(out).toContain('height="400"')
        expect(out).not.toContain('width="100%"')
        expect(out).not.toContain('height="50%"')
    })

    it('缺失 width/height 时追加', () => {
        const input = '<svg viewBox="0 0 800 400">x</svg>'
        const out = injectSvgDimensions(input, 800, 400)
        expect(out).toContain('width="800"')
        expect(out).toContain('height="400"')
    })

    it('保留其他属性（id / xmlns / style / class）', () => {
        const input
            = '<svg id="m1" xmlns="http://www.w3.org/2000/svg" class="foo" style="max-width:100px" width="100%" viewBox="0 0 100 50">x</svg>'
        const out = injectSvgDimensions(input, 100, 50)
        expect(out).toContain('id="m1"')
        expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
        expect(out).toContain('class="foo"')
        expect(out).toContain('style="max-width:100px"')
        expect(out).toContain('width="100"')
        expect(out).toContain('height="50"')
    })

    it('只改 root <svg>，不影响内部嵌套 svg', () => {
        const input
            = '<svg viewBox="0 0 800 400" width="100%"><g><svg width="10" height="10"></svg></g></svg>'
        const out = injectSvgDimensions(input, 800, 400)
        expect(out.startsWith('<svg ')).toBe(true)
        expect(out).toContain('width="800"')
        expect(out).toContain('height="400"')
        expect(out).toContain('<svg width="10" height="10">')
    })

    it('保留不带值的属性（例如 xml:space）', () => {
        const input = '<svg xml:space="preserve" width="100%" viewBox="0 0 100 50">x</svg>'
        const out = injectSvgDimensions(input, 100, 50)
        expect(out).toContain('xml:space="preserve"')
        expect(out).toContain('width="100"')
    })
})

describe('clampDiagramSize', () => {
    it('viewBox 宽度不超过上限时原样返回（取整）', () => {
        expect(clampDiagramSize(500, 300, 600)).toEqual({ width: 500, height: 300 })
    })

    it('viewBox 宽度超过上限时按宽高比缩小', () => {
        expect(clampDiagramSize(1200, 600, 600)).toEqual({ width: 600, height: 300 })
    })

    it('小数尺寸四舍五入取整', () => {
        expect(clampDiagramSize(599.6, 299.4, 600)).toEqual({ width: 600, height: 299 })
    })

    it('极扁的图缩小后高度至少为 1', () => {
        expect(clampDiagramSize(100000, 1, 600)).toEqual({ width: 600, height: 1 })
    })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/app/lib/mermaidRaster.test.ts --reporter=verbose`
Expected: FAIL —— 模块 `~/lib/mermaidRaster` 不存在。

- [ ] **Step 3: 写实现**

创建 `app/lib/mermaidRaster.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/app/lib/mermaidRaster.test.ts --reporter=verbose`
Expected: PASS —— `extractViewBoxSize` / `injectSvgDimensions` / `clampDiagramSize` 全部通过。

- [ ] **Step 5: 类型检查**

Run: `bun run typecheck`
Expected: 无错误（注意 `bun run typecheck` 会全量检查，确认未引入新错误）。

- [ ] **Step 6: 提交**

```bash
git add app/lib/mermaidRaster.ts tests/app/lib/mermaidRaster.test.ts
git commit -m "feat(cases): 新增 mermaid 源码渲染 PNG 的 mermaidRaster 工具"
```

---

## Task 3: 重构 useMermaidHdPng.ts 复用 mermaidRaster

**Files:**
- Modify（整体重写）: `app/composables/useMermaidHdPng.ts`
- Delete: `tests/app/composables/useMermaidHdPng.test.ts`

> 背景：`useMermaidHdPng` 当前自带一份 SVG→PNG 实现（`extractViewBoxSize` / `injectSvgDimensions` / `renderToSvg` / `svgToPngBlob` 等）。Task 2 已把这套逻辑下沉到 `mermaidRaster.ts`，本 Task 让 `useMermaidHdPng` 改为复用，删除重复实现。对外 API（`exportHd` / `markdownControls`）保持不变——外部仅 `MessageResponse.vue` / `ReasoningContent.vue` 使用 `markdownControls`。

- [ ] **Step 1: 整体重写 useMermaidHdPng.ts**

用以下内容覆盖 `app/composables/useMermaidHdPng.ts`：

```ts
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
```

- [ ] **Step 2: 删除已失效的旧测试文件**

`extractViewBoxSize` / `injectSvgDimensions` 已迁出，旧测试的对应用例已在 Task 2 迁移到 `tests/app/lib/mermaidRaster.test.ts`。删除旧文件（不保留空文件）：

```bash
git rm tests/app/composables/useMermaidHdPng.test.ts
```

- [ ] **Step 3: 类型检查**

Run: `bun run typecheck`
Expected: 无错误。重点确认 `MessageResponse.vue` / `ReasoningContent.vue` 仍能解构 `markdownControls`。

- [ ] **Step 4: 回归验证 mermaidRaster 测试仍通过**

Run: `npx vitest run tests/app/lib/mermaidRaster.test.ts --reporter=verbose`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add app/composables/useMermaidHdPng.ts tests/app/composables/useMermaidHdPng.test.ts
git commit -m "refactor(cases): useMermaidHdPng 复用 mermaidRaster，移除重复的 SVG→PNG 实现"
```

---

## Task 4: useMarkdownDocxExport.ts —— 导出编排 composable

**Files:**
- Create: `app/composables/useMarkdownDocxExport.ts`

> 该 composable 是编排层，内部全是 DOM / 第三方库 IO，不写单测，由 Task 6 的 E2E 覆盖。`logger` 在前端为白名单自动导入，无需 import。

- [ ] **Step 1: 写实现**

创建 `app/composables/useMarkdownDocxExport.ts`：

```ts
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
```

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add app/composables/useMarkdownDocxExport.ts
git commit -m "feat(cases): 新增 useMarkdownDocxExport 导出含图 docx 编排层"
```

---

## Task 5: 接入 CaseExportDialog.vue

**Files:**
- Modify: `app/components/caseDetail/CaseExportDialog.vue`

> 把 `executeExport` 里现有的「markdown-docx 主方案 + html-docx 备用方案」两段内联逻辑，替换成一行 `exportMarkdownToDocx` 调用。拼接 Markdown、文件名清洗、toast 错误处理保持不变。

- [ ] **Step 1: 新增 composable 的 import**

在 `app/components/caseDetail/CaseExportDialog.vue` 的 `<script setup>` 中，把：

```ts
import { toast } from 'vue-sonner'
```

替换为：

```ts
import { toast } from 'vue-sonner'
import { useMarkdownDocxExport } from '~/composables/useMarkdownDocxExport'
```

- [ ] **Step 2: 初始化 composable**

把：

```ts
const exportItems = ref<ExportItem[]>([])
const selectMode = ref(false)
const exporting = ref(false)
```

替换为：

```ts
const exportItems = ref<ExportItem[]>([])
const selectMode = ref(false)
const exporting = ref(false)

const { exportMarkdownToDocx } = useMarkdownDocxExport()
```

- [ ] **Step 3: 替换 executeExport 实现**

把整个 `executeExport` 函数（从 `async function executeExport()` 到对应的闭合 `}`）：

```ts
async function executeExport() {
  const selected = exportItems.value.filter(i => i.selected)
  if (selected.length === 0) return

  exporting.value = true
  try {
    let md = `# ${props.title}\n\n`
    for (const item of selected) {
      md += item.content + '\n\n'
    }

    const filename = sanitizeFilename(`【LexSeek 分析】${props.title || '案件报告'}.docx`)

    // 主方案：markdown-docx
    try {
      const { default: markdownDocx, Packer } = await import('markdown-docx')
      const doc = await markdownDocx(md, { ignoreHtml: true })
      const blob = await Packer.toBlob(doc)
      const { saveAs } = await import('file-saver')
      saveAs(blob, filename)
    }
    catch {
      // 备用方案：marked + html-docx-js-typescript
      const { marked } = await import('marked')
      const html = await marked(md)
      const { asBlob } = await import('html-docx-js-typescript')
      const blob = await asBlob(html)
      const { saveAs } = await import('file-saver')
      saveAs(blob as Blob, filename)
    }

    open.value = false
    emit('exportComplete')
  }
  catch (error) {
    console.error('导出文档失败:', error)
    toast.error('导出文档失败，请稍后重试')
  }
  finally {
    exporting.value = false
  }
}
```

替换为：

```ts
async function executeExport() {
  const selected = exportItems.value.filter(i => i.selected)
  if (selected.length === 0) return

  exporting.value = true
  try {
    let md = `# ${props.title}\n\n`
    for (const item of selected) {
      md += item.content + '\n\n'
    }

    const filename = sanitizeFilename(`【LexSeek 分析】${props.title || '案件报告'}.docx`)
    await exportMarkdownToDocx(md, filename)

    open.value = false
    emit('exportComplete')
  }
  catch (error) {
    console.error('导出文档失败:', error)
    toast.error('导出文档失败，请稍后重试')
  }
  finally {
    exporting.value = false
  }
}
```

- [ ] **Step 4: 类型检查**

Run: `bun run typecheck`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add app/components/caseDetail/CaseExportDialog.vue
git commit -m "feat(cases): 案件分析导出 Word 改用 useMarkdownDocxExport 支持 mermaid 转图"
```

---

## Task 6: E2E 验证与回归冒烟

**Files:** 无（仅验证；若发现缺陷，回到对应 Task 修复后另起 commit）

- [ ] **Step 1: 启动开发服务器**

Run: `bun dev`
Expected: 服务器在 `http://localhost:3000`（或配置端口）启动成功。

- [ ] **Step 2: 跑相关单元测试确认全绿**

Run: `npx vitest run tests/app/utils/mermaidMarkdown.test.ts tests/app/lib/mermaidRaster.test.ts --reporter=verbose`
Expected: PASS —— 两个文件全部用例通过。

- [ ] **Step 3: E2E —— 导出含 Mermaid 的案件分析（chrome-devtools MCP）**

用 chrome-devtools MCP 操作浏览器：
1. 访问站点并登录（测试账号见 `.claude/rules/testing.md`：`13064768490` / `daixin88`，开发库账号以本地为准）。
2. 进入一个「已有分析结果且分析内容里含 ` ```mermaid ` 图表」的案件详情页（`/dashboard/cases/[id]`）。若没有现成数据，先在某案件跑出含图表的分析模块。
3. 打开「导出案件文档」对话框（`CaseExportDialog`），选中含 Mermaid 的模块，点「确认导出」。
4. 等待下载完成（导出按钮 loading 结束、对话框关闭）。

验证下载的 `.docx`（用 Word / WPS 打开，或解压检查 `word/media/` 下有 PNG）：
- [ ] Mermaid 图表显示为**图片**，不是原始代码文本。
- [ ] 图片宽度适配正文、未溢出页面。
- [ ] 正文其余文字、标题、列表格式正常。
- [ ] 控制台无报错。

- [ ] **Step 4: E2E —— 渲染失败时保留代码块**

在某个分析模块内容里临时构造一个**语法错误**的 mermaid 块（例如 ` ```mermaid\n graph TD A--B-- \n``` ` 这类非法语法），重复 Step 3 导出：
- [ ] 该错误图表在 docx 里**保留为代码块文本**，导出未整体失败。
- [ ] 同一文档里其它合法图表仍正常转成图片。

- [ ] **Step 5: 回归冒烟 —— 小索对话 PNG 下载**

`useMermaidHdPng` 被重构过，E2E 未覆盖该入口，手动冒烟：
1. 进入含小索对话且回复中带 Mermaid 图表的页面。
2. 在 Mermaid 代码块的下拉菜单点「PNG」。
- [ ] 浏览器正常下载一张清晰的 `diagram-*.png`。
- [ ] 切换 App 深色模式后再下载，PNG 主题随之变化（验证 `theme` 跟随 `isDark` 未回归）。

- [ ] **Step 6: 全量测试 + 收尾**

Run: `bun run test`
Expected: 测试套件通过（与本次改动无关的既有失败以 `tests/KNOWN_FAILS.md` 为准）。

收尾：对本次新增 / 改动的 5 个源文件运行 `simplify` 技能过一遍代码。若 `simplify` 产生改动，单独提交：

```bash
git commit -m "refactor(cases): simplify 优化 mermaid 导出相关代码"
```

---

## 自检对照（spec 覆盖性）

- 导出 Word 时 Mermaid → 图片：Task 1（替换为图片）+ Task 2（渲染 PNG）+ Task 4（编排）+ Task 5（接入）✓
- 不用自定义 imageAdapter、走 data URL：Task 4 `renderDocx` 不传 imageAdapter ✓
- `title="宽x高"` 控制显示尺寸：Task 1 `replaceMermaidBlocks` + Task 2 `clampDiagramSize` ✓
- 强制浅色主题：Task 4 `embedMermaidImages` 传 `theme: 'default'` ✓
- 渲染失败保留原始代码块：Task 1（null → 不替换）+ Task 4（catch → push null）+ Task 6 Step 4 验证 ✓
- 主路径失败回退 html-docx-js：Task 4 `renderDocx` catch 分支 ✓
- 复用栅格化、不重复造轮子：Task 2 抽取 + Task 3 useMermaidHdPng 复用 ✓
- 纯函数 / DOM 分离：`mermaidMarkdown.ts`（纯）vs `mermaidRaster.ts`（DOM）✓
- 测试策略：Task 1 / Task 2 单测，Task 6 E2E + 冒烟 ✓
- 收尾验收（typecheck / simplify / E2E / 回归冒烟）：各 Task 的 typecheck 步 + Task 6 ✓
