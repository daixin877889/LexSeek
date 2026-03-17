/**
 * 文本文件读取服务
 *
 * 提供 md/txt 文件的直接读取功能
 * 支持 md 文件中的图片处理
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
import { v4 as uuidv4 } from 'uuid'
import { processAllImagesInMarkdown } from './imageProcessor'

/** 文本文件读取结果 */
export interface TextReaderResult {
    /** 是否成功 */
    success: boolean
    /** 识别记录 */
    record?: docRecognitionRecords
    /** 错误信息 */
    error?: string
}

/**
 * 处理 Markdown 中的图片（base64 + URL）
 * - base64 图片：上传到 OSS 并替换为占位符
 * - 远程 URL 图片：下载后上传到 OSS 并替换为占位符
 */
async function processMdImages(
    markdown: string,
    userId: number,
    docFileName: string
): Promise<string> {
    // 使用统一的图片处理函数
    return await processAllImagesInMarkdown(markdown, userId, docFileName)
}

/**
 * 读取文本文件内容
 *
 * @param ossFileId OSS 文件 ID
 * @param userId 用户 ID
 * @returns 读取结果
 */
export const readTextFileService = async (
    ossFileId: number,
    userId: number
): Promise<TextReaderResult> => {
    try {
        // 1. 获取 OSS 文件信息
        const ossFile = await findOssFileByIdDao(ossFileId)
        if (!ossFile) {
            return { success: false, error: '文件不存在' }
        }
        if (!ossFile.filePath) {
            return { success: false, error: '文件路径不存在' }
        }

        const docFileName = ossFile.fileName.replace(/\.(md|txt)$/i, '')

        // 2. 检查是否已有成功的识别记录
        const existingRecord = await findDocRecognitionByOssFileIdDao(ossFileId)
        if (existingRecord && existingRecord.status === DocRecognitionStatus.SUCCESS) {
            logger.info(`文本文件已存在成功的识别记录，直接返回：ossFileId=${ossFileId}, recordId=${existingRecord.id}`)
            return { success: true, record: existingRecord }
        }

        // 3. 从 OSS 下载文件
        const fileBuffer = await downloadFileService(ossFile.filePath)

        // 4. 将 Buffer 转换为字符串（UTF-8 编码）
        const content = fileBuffer.toString('utf-8')

        // 5. 简单处理：将纯文本内容作为 Markdown
        // 对于 txt 文件，直接将内容作为 Markdown；对于 md 文件，保持原样
        const ext = ossFile.fileName.split('.').pop()?.toLowerCase()
        let markdownContent = ext === 'md' ? content : `# ${ossFile.fileName}\n\n${content}`

        // 6. 如果是 md 文件，处理图片
        if (ext === 'md') {
            markdownContent = await processMdImages(markdownContent, userId, docFileName)
        }

        // 7. 将 Markdown 转换为 HTML（简单处理）
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${ossFile.fileName}</title>
</head>
<body>
${markdownContent
    .split('\n')
    .map(line => {
        // 简单处理：处理标题
        if (line.startsWith('# ')) {
            return `<h1>${line.slice(2)}</h1>`
        }
        if (line.startsWith('## ')) {
            return `<h2>${line.slice(3)}</h2>`
        }
        if (line.startsWith('### ')) {
            return `<h3>${line.slice(4)}</h3>`
        }
        // 处理段落
        if (line.trim()) {
            return `<p>${line}</p>`
        }
        return ''
    })
    .join('\n')}
</body>
</html>`

        // 8. 创建或更新识别记录
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

        // 9. 进行向量化嵌入
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

            logger.info(`文本文件向量化嵌入完成：ossFileId=${ossFileId}, chunkCount=${embeddingResult.chunkCount}`)

            // 更新 case_materials 表的 embedding_status
            try {
                const { findMaterialsByOssFileIdDAO, updateMaterialEmbeddingStatusDAO } = await import('../case/caseMaterial.dao')
                const materials = await findMaterialsByOssFileIdDAO(ossFileId)
                for (const material of materials) {
                    await updateMaterialEmbeddingStatusDAO(material.id, 'completed')
                    logger.info(`更新材料 ${material.id} 的 embedding_status 为 completed`)
                }
            } catch (updateError: any) {
                logger.warn('更新 case_materials embedding_status 失败', {
                    ossFileId,
                    error: updateError.message,
                })
            }
        } catch (embeddingError) {
            // 嵌入失败不影响主流程，只记录日志
            logger.error('文本文件向量化嵌入失败：', embeddingError)

            // 更新 case_materials 表的 embedding_status 为 failed
            try {
                const { findMaterialsByOssFileIdDAO, updateMaterialEmbeddingStatusDAO } = await import('../case/caseMaterial.dao')
                const materials = await findMaterialsByOssFileIdDAO(ossFileId)
                for (const material of materials) {
                    await updateMaterialEmbeddingStatusDAO(material.id, 'failed')
                }
            } catch (updateError: any) {
                logger.warn('更新 case_materials embedding_status 失败', {
                    ossFileId,
                    error: updateError.message,
                })
            }
        }

        logger.info(`文本文件读取完成：ossFileId=${ossFileId}`)

        return { success: true, record: docRecord }
    } catch (error) {
        logger.error('读取文本文件失败：', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : '读取文件失败',
        }
    }
}
