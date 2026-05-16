/**
 * 在 docx zip 内按命名空间 URI 定位 LexSeek 写入的 customXml 身份证文件。
 *
 * 为什么不按固定路径找：LexSeek 导出时把身份证写在 word/customXml/xxx.xml，
 * 但 Microsoft Word 重新保存 docx 会按 OOXML 规范把 customXml part 移到包根
 * customXml/ 并改名为 item{N}.xml。固定路径查找失效。命名空间 URI 是 LexSeek
 * 专有、且 Word 不会改 customXml 文件内容，据此识别最稳。
 */
import type { DocxZip } from './zipRewriter'

/** 批注身份证（annotationRefs）根命名空间 */
export const ANNOTATION_REFS_NS = 'urn:lexseek:contract-review:v1'
/** 修订身份证（redlineRefs）根命名空间 */
export const REDLINE_REFS_NS = 'urn:lexseek:contract-review-redline:v1'

export interface LocatedCustomXml {
    /** customXml 文件的原始 XML 文本 */
    xml: string
    /** 在 zip 内的实际路径 */
    path: string
    /** 是否仍在 LexSeek 导出的原始路径（未被 Word 等工具规范化移动过） */
    atOriginalPath: boolean
}

/**
 * 遍历 docx zip 内所有 customXml part，返回命名空间 URI 匹配的第一个。
 *
 * @param zip          已 loadDocxZip 的 docx
 * @param namespaceUri LexSeek 专有命名空间 URI（见本文件常量）
 * @param originalPath LexSeek 导出时写入的原始路径，用于判定文件是否被移动过
 * @returns 命中返回 LocatedCustomXml；未命中返回 null
 */
export async function locateLexseekCustomXml(
    zip: DocxZip,
    namespaceUri: string,
    originalPath: string,
): Promise<LocatedCustomXml | null> {
    // 正则覆盖包根 customXml/ 与 word/customXml/ 两种位置
    const candidates = zip.file(/customXml\/[^/]*\.xml$/i)
    for (const file of candidates) {
        const xml = await file.async('string')
        // 命名空间 URI 是定值字符串，不随 Word 改文件名 / 加元素前缀而变
        if (xml.includes(namespaceUri)) {
            return { xml, path: file.name, atOriginalPath: file.name === originalPath }
        }
    }
    return null
}
