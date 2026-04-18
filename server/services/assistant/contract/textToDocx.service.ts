/**
 * 纯文本 → 最小合规 .docx Buffer。
 *
 * 用 jszip 直接构造五文件最小骨架（docx 官方包未装）；输出必须能被 mammoth 重新 parse。
 * 使用 zipRewriter 的 writeTextToZip 和 xmlUtils 的 escapeXml，统一 zip 操作与 XML 转义路径。
 */
import JSZip from 'jszip'
import { writeTextToZip, zipToBuffer, type DocxZip } from './docx/zipRewriter'
import { escapeXml } from './docx/xmlUtils'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`

function buildDocumentXml(text: string): string {
    const lines = text.length === 0 ? [''] : text.split(/\r?\n/)
    const paragraphs = lines
        .map(
            (line) =>
                `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
        )
        .join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>${paragraphs}</w:body>
</w:document>`
}

export async function textToDocxService(text: string): Promise<Buffer> {
    const zip: DocxZip = new JSZip()
    writeTextToZip(zip, '[Content_Types].xml', CONTENT_TYPES)
    writeTextToZip(zip, '_rels/.rels', ROOT_RELS)
    writeTextToZip(zip, 'word/_rels/document.xml.rels', DOCUMENT_RELS)
    writeTextToZip(zip, 'word/document.xml', buildDocumentXml(text))
    return await zipToBuffer(zip)
}
