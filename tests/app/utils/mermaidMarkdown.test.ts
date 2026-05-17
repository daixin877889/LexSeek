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
