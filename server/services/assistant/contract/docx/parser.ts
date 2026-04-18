/**
 * 合同 .docx 段落提取。
 *
 * 返回：
 * - paragraphs：非空段落文本数组，索引即 spec §10.4 定义的 clauseIndex
 * - rawXml：word/document.xml 原文，供 commentInjector 按顺序定位 <w:p>
 */
import mammoth from 'mammoth'
import { loadDocxZip, readTextFromZip } from './zipRewriter'

export interface ParsedContract {
    paragraphs: string[]
    rawXml: string
}

export async function parseContractDocx(buffer: Buffer): Promise<ParsedContract> {
    const { value: rawText } = await mammoth.extractRawText({ buffer })
    const paragraphs = rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

    const zip = await loadDocxZip(buffer)
    const rawXml = await readTextFromZip(zip, 'word/document.xml')

    return { paragraphs, rawXml }
}
