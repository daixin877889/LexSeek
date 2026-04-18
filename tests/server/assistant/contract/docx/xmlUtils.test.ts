import { describe, it, expect } from 'vitest'
import { appendChildXml, escapeXml } from '~~/server/services/assistant/contract/docx/xmlUtils'

describe('xmlUtils', () => {
    it('appendChildXml 把片段字符串追加到父节点末尾', () => {
        const fragment =
            '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
        const input = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="xml" ContentType="application/xml"/>
</Types>`
        const out = appendChildXml(input, 'Types', fragment)
        expect(out).toContain('<Default Extension="xml"')
        expect(out).toContain('<Override PartName="/word/comments.xml"')
        expect(out.indexOf('<Default')).toBeLessThan(out.indexOf('<Override'))
        expect(out).toContain('</Types>')
    })

    it('appendChildXml 未找到父节点时抛错', () => {
        expect(() => appendChildXml('<root/>', 'NotExist', '<x/>')).toThrow('未找到父节点 </NotExist>')
    })

    it('escapeXml 正确转义 5 个特殊字符', () => {
        expect(escapeXml("a & b < c > d \"e\" 'f'")).toBe("a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;")
    })

    it('escapeXml 保留普通中文与数字', () => {
        expect(escapeXml('甲方 123 年')).toBe('甲方 123 年')
    })
})
