/**
 * useMermaidHdPng 单元测试
 *
 * 目的：vue-stream-markdown 内置的 SVG→PNG 转换使用 scale=5 且不注入显式宽高，
 * 在 Mermaid 输出 `<svg width="100%" style="max-width:..." viewBox="...">` 时，
 * `new Image().naturalWidth` 会回退到 300×150，5 倍放大后仍然模糊。
 *
 * 本 composable 通过 `controls.mermaid.customize` 拦截 PNG 点击，先把 viewBox
 * 转成显式 width/height，再按 scale × devicePixelRatio 栅格化，解决清晰度问题。
 *
 * 这里只对纯函数（viewBox 解析 / 属性注入）做单测；canvas / Image / Blob 部分
 * 在 happy-dom 下行为不真实，和 imageWatermarkService 一样排除覆盖率。
 */

import { describe, expect, it } from 'vitest'
import { extractViewBoxSize, injectSvgDimensions } from '~/composables/useMermaidHdPng'

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

    it('只改 root <svg>，不影响内部嵌套 svg（同一 SVG 内多个 <svg> 极少见但要安全）', () => {
        const input
            = '<svg viewBox="0 0 800 400" width="100%"><g><svg width="10" height="10"></svg></g></svg>'
        const out = injectSvgDimensions(input, 800, 400)
        // 只有第一个 <svg> 被改
        expect(out.startsWith('<svg ')).toBe(true)
        expect(out).toContain('width="800"')
        expect(out).toContain('height="400"')
        // 内嵌 svg 的原始宽高保留
        expect(out).toContain('<svg width="10" height="10">')
    })

    it('保留不带值的属性（例如 xml:space）', () => {
        const input = '<svg xml:space="preserve" width="100%" viewBox="0 0 100 50">x</svg>'
        const out = injectSvgDimensions(input, 100, 50)
        expect(out).toContain('xml:space="preserve"')
        expect(out).toContain('width="100"')
    })
})
