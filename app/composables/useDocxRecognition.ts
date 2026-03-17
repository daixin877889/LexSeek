/**
 * 文档识别工具函数
 *
 * 提供文档文件类型判断的工具函数
 * 识别功能已迁移到统一 API /api/v1/recognition/start
 *
 * @requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 4.1, 6.2, 6.3, 6.4
 */

import { getExtensionFromFileName } from '~~/shared/utils/file'

/** 支持的文档扩展名 */
const DOCX_EXTENSIONS = ['docx']
const DOC_EXTENSIONS = ['doc']
const PDF_EXTENSIONS = ['pdf']
const MARKDOWN_EXTENSIONS = ['md', 'mkd', 'markdown']
const TXT_EXTENSIONS = ['txt']

/**
 * 判断是否为 docx 文件（使用 mammoth.js 浏览器端识别）
 */
export const isDocxFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return DOCX_EXTENSIONS.includes(ext)
}

/**
 * 判断是否为 doc 文件（使用 MinerU 识别）
 */
export const isDocFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return DOC_EXTENSIONS.includes(ext)
}

/**
 * 判断是否为 pdf 文件（使用 MinerU 识别）
 */
export const isPdfFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return PDF_EXTENSIONS.includes(ext)
}

/**
 * 判断是否需要使用 MinerU 识别（doc 或 pdf 文件）
 */
export const needsMineruRecognition = (fileName: string): boolean => {
    return isDocFile(fileName) || isPdfFile(fileName)
}

/**
 * 判断是否为 markdown 文件
 */
export const isMarkdownFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return MARKDOWN_EXTENSIONS.includes(ext)
}

/**
 * 判断是否为 txt 文件
 */
export const isTxtFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return TXT_EXTENSIONS.includes(ext)
}
