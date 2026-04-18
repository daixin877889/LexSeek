/**
 * docx XML 字符串级工具。
 *
 * M2 的 XML 改动（四处）分两类：
 * 1. 结构简单（[Content_Types].xml / word/_rels/document.xml.rels）→ 用 appendChildXml 字符串追加
 * 2. 结构复杂（word/document.xml / word/comments.xml）→ commentInjector 直接用字符串正则扫描 <w:p>
 *
 * 不引入 fast-xml-parser DOM round-trip，规避 v5 对 Office XML 命名空间属性的已知边缘 case。
 */

/**
 * 在 parentTag（最近的匹配标签）末尾追加一个 XML 片段字符串。
 *
 * 用途：
 * - 往 [Content_Types].xml 的 <Types> 追加 <Override>
 * - 往 word/_rels/document.xml.rels 的 <Relationships> 追加 <Relationship>
 *
 * 限制：parentTag 不带命名空间前缀；fragment 必须是合法 XML 片段
 */
export function appendChildXml(xml: string, parentTag: string, fragment: string): string {
    const closeTag = `</${parentTag}>`
    const idx = xml.lastIndexOf(closeTag)
    if (idx < 0) throw new Error(`未找到父节点 </${parentTag}>`)
    return `${xml.slice(0, idx)}${fragment}\n${xml.slice(idx)}`
}

/**
 * XML 5 字符标准转义：& < > " '
 *
 * 供 commentInjector 写批注文本、textToDocxService 写纯文本段落共用。
 */
export function escapeXml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}
