/**
 * HTML 净化工具测试
 *
 * **Feature: html-sanitizer-xss-guard**
 */
import { describe, it, expect } from 'vitest'
import { sanitizeRichHtml } from '~~/server/utils/htmlSanitizer'

describe('sanitizeRichHtml - 富文本 HTML 净化', () => {
    it('移除 <script> 标签及其内容', () => {
        const out = sanitizeRichHtml('<p>正常</p><script>alert(1)</script>')
        expect(out).toContain('<p>正常</p>')
        expect(out).not.toContain('<script>')
        expect(out).not.toContain('alert(1)')
    })

    it('移除 on* 事件属性', () => {
        const out = sanitizeRichHtml('<img src="https://x/a.png" onerror="alert(1)">')
        expect(out).not.toContain('onerror')
    })

    it('移除 javascript: 协议链接', () => {
        const out = sanitizeRichHtml('<a href="javascript:alert(1)">点我</a>')
        expect(out).not.toContain('javascript:')
    })

    it('移除 <iframe>', () => {
        const out = sanitizeRichHtml('<iframe src="https://evil"></iframe>')
        expect(out).not.toContain('<iframe')
    })

    it('保留标题/表格/图片等正常排版', () => {
        const html = '<h1>标题</h1><table><tr><td>单元格</td></tr></table>'
            + '<img src="https://oss/img.png" alt="图">'
        const out = sanitizeRichHtml(html)
        expect(out).toContain('<h1>标题</h1>')
        expect(out).toContain('<td>单元格</td>')
        expect(out).toContain('src="https://oss/img.png"')
    })

    it('保留 OSS 图片占位符（纯文本不受影响）', () => {
        const out = sanitizeRichHtml('<p>见图 {{OSS_IMAGE:bucket:123}}</p>')
        expect(out).toContain('{{OSS_IMAGE:bucket:123}}')
    })

    it('保留 img 的 base64 data 协议', () => {
        const out = sanitizeRichHtml('<img src="data:image/png;base64,iVBORw0KG">')
        expect(out).toContain('data:image/png;base64')
    })
})
