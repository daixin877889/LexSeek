/**
 * DOCX 文件识别服务
 *
 * 提供 docx 文件的解析功能，使用 mammoth 库
 * 支持提取图片并上传到 OSS，替换为占位符
 */

import type { docRecognitionRecords } from '~~/generated/prisma/client'
import { DocRecognitionStatus } from '#shared/types/recognition'
import {
    createDocRecognitionRecordDao,
    findDocRecognitionByOssFileIdDao,
    updateDocRecognitionRecordDao,
} from './mineru.dao'
import { downloadFileService, uploadFileService } from '../storage/storage.service'
import {
    findOssFileByIdDao,
    findOssFileByIdIncludeDeletedDao,
} from '../files/ossFiles.dao'
import { embedDocumentService } from './materialEmbedding.service'
import mammoth from 'mammoth'
import { processAllImagesInMarkdown } from './imageProcessor'
import { sanitizeRichHtml } from '~~/server/utils/htmlSanitizer'

/** DOCX 识别结果 */
export interface DocxRecognitionResult {
    /** 是否成功 */
    success: boolean
    /** 识别记录 */
    record?: docRecognitionRecords
    /** 错误信息 */
    error?: string
}

/**
 * 清理 Markdown 中的 HTML 标签
 * 特别是 Word 文档中的锚点标签 <a id="_Hlk*"></a>
 */
function cleanHtmlTags(markdown: string): string {
    // 清理 Word 锚点标签 <a id="_Hlk..."></a>
    let result = markdown.replace(/<a id="_Hlk\d+"><\/a>/g, '')

    // 清理其他常见的 Word 生成的 HTML 标签
    // 保留 <img> 标签（会被 mammoth 转换为 markdown 图片格式）
    result = result.replace(/<a[^>]*>[^<]*<\/a>/g, '')
    result = result.replace(/<span[^>]*>[^<]*<\/span>/g, '')
    result = result.replace(/<font[^>]*>[^<]*<\/font>/g, '')

    // 清理空标签
    result = result.replace(/<[^>]*>\s*<\/[^>]*>/g, '')

    return result
}

/**
 * 修复 Markdown 图片格式
 * 处理 alt 文本中的换行和多余空白
 */
function fixMarkdownImageFormat(markdown: string): string {
    // 匹配图片语法，包括 alt 文本中的换行
    // 格式: ![alt text\nmore](url)
    const imageRegex = /!\[([\s\S]*?)\]\(([^)]+)\)/g

    return markdown.replace(imageRegex, (match, altText, url) => {
        // 清理 alt 文本：去除换行和多余空白，合并为单行
        const cleanAlt = altText
            .replace(/\s+/g, ' ')  // 将所有空白（包括换行）替换为单个空格
            .replace(/\s*-\s*/g, ' - ')  // 确保短横线周围有空格
            .trim()

        return `![${cleanAlt}](${url})`
    })
}

/**
 * 处理 Markdown 中的图片（base64 + URL）
 * - base64 图片：上传到 OSS 并替换为占位符
 * - 远程 URL 图片：下载后上传到 OSS 并替换为占位符
 */
async function processDocxImages(
    markdown: string,
    userId: number,
    docFileName: string
): Promise<string> {
    // 使用统一的图片处理函数
    return await processAllImagesInMarkdown(markdown, userId, docFileName)
}

/**
 * 识别 DOCX 文件
 *
 * @param ossFileId OSS 文件 ID
 * @param userId 用户 ID
 * @returns 识别结果
 */
export const recognizeDocxService = async (
    ossFileId: number,
    userId: number
): Promise<DocxRecognitionResult> => {
    try {
        // 1. 获取 OSS 文件信息
        const ossFile = await findOssFileByIdDao(ossFileId)
        if (!ossFile) {
            return { success: false, error: '文件不存在' }
        }
        if (!ossFile.filePath) {
            return { success: false, error: '文件路径不存在' }
        }

        const docFileName = ossFile.fileName.replace(/\.docx$/i, '')

        // 2. 检查是否已有成功的识别记录
        const existingRecord = await findDocRecognitionByOssFileIdDao(ossFileId)
        if (existingRecord && existingRecord.status === DocRecognitionStatus.SUCCESS) {
            logger.info(`DOCX 文件已存在成功的识别记录，直接返回：ossFileId=${ossFileId}, recordId=${existingRecord.id}`)
            return { success: true, record: existingRecord }
        }

        // 3. 从 OSS 下载文件
        const fileBuffer = await downloadFileService(ossFile.filePath)

        // 4. 使用 mammoth 解析 docx 文件
        const mammothResult = await mammoth.convertToMarkdown({ buffer: fileBuffer })

        let markdownContent = mammothResult.value

        if (!markdownContent || markdownContent.trim() === '') {
            return { success: false, error: 'DOCX 文件内容为空或解析失败' }
        }

        // 5. 处理图片：将 base64 图片上传到 OSS 并替换为占位符
        markdownContent = await processDocxImages(markdownContent, userId, docFileName)

        // 6. 清理 HTML 标签（如 Word 锚点标签）和修复图片格式
        markdownContent = cleanHtmlTags(markdownContent)
        markdownContent = fixMarkdownImageFormat(markdownContent)

        // 7. 将 Markdown 转换为 HTML
        const { marked } = await import('marked')
        marked.setOptions({
            gfm: true,
            breaks: true,
        })
        // 净化 marked 输出，防止存储型 XSS
        const htmlContent = sanitizeRichHtml(await marked.parse(markdownContent))

        // 7. 创建或更新识别记录
        let docRecord: docRecognitionRecords
        if (existingRecord) {
            docRecord = await updateDocRecognitionRecordDao(existingRecord.id, {
                status: DocRecognitionStatus.SUCCESS,
                markdownContent,
                htmlContent,
            })
        } else {
            docRecord = await createDocRecognitionRecordDao({
                userId,
                ossFileId,
                status: DocRecognitionStatus.SUCCESS,
                markdownContent,
                htmlContent,
            })
        }

        // 8. 进行向量化嵌入
        try {
            // 获取 OSS 文件信息用于嵌入元数据（包含已删除的文件）
            const ossFileForEmbedding = await findOssFileByIdIncludeDeletedDao(ossFileId)
            const fileName = ossFileForEmbedding?.fileName || `document_${ossFileId}`

            const embeddingResult = await embedDocumentService({
                content: markdownContent,
                userId,
                ossFileId,
                fileName,
            })

            // 更新识别记录的向量信息
            await updateDocRecognitionRecordDao(docRecord.id, {
                vectorIds: embeddingResult.ids,
                lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
            })

            logger.info(`DOCX 文件向量化嵌入完成：ossFileId=${ossFileId}, chunkCount=${embeddingResult.chunkCount}`)

        } catch (embeddingError) {
            // 嵌入失败不影响主流程，只记录日志
            logger.error('DOCX 文件向量化嵌入失败：', embeddingError)

        }

        logger.info(`DOCX 文件识别完成：ossFileId=${ossFileId}`)

        return { success: true, record: docRecord }
    } catch (error) {
        logger.error('识别 DOCX 文件失败：', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : '识别文件失败',
        }
    }
}
