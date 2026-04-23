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
 * 同时剥离 XML 1.0 禁止的非法控制字符（否则生成的 docx 无法被 Word 打开）。
 *
 * 允许字符：U+0009 \t / U+000A \n / U+000D \r；
 * 禁止字符：U+0000-U+0008、U+000B-U+000C、U+000E-U+001F、U+FFFE、U+FFFF。
 * 客户姓名从剪贴板粘贴时偶尔混入 U+0008 退格、U+001B ESC 等，必须过滤。
 *
 * 供 commentInjector 写批注文本、textToDocxService 写纯文本段落共用。
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g
export function escapeXml(input: string): string {
    return input
        .replace(ILLEGAL_XML_CHARS, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}
