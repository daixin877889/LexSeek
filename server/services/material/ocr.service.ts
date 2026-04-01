/**
 * 图片识别服务（OCR）
 *
 * 提供图片内容识别功能，支持多种图片格式
 * 调用 AI 服务识别图片内容，将 Markdown 转换为 HTML
 * 使用 node 系统统一管理 OCR 配置（模型、提示词等）
 * Requirements: 3.3.1-3.3.11
 */

import type { imageRecognitionRecords, Prisma } from '~~/generated/prisma/client'
import { z } from 'zod'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from '../node/chatModelFactory'
import { marked } from 'marked'
import { ImageRecognitionStatus } from '#shared/types/recognition'
import {
    createImageRecognitionRecordDao,
    findImageRecognitionByOssFileIdDao,
    findImageRecognitionByIdDao,
    updateImageRecognitionRecordDao,
    findImageRecognitionsByOssFileIdsDao,
} from './ocr.dao'
import { generateSignedUrlService } from '../storage/storage.service'
import { getValidNodeConfig, getNodeConfigService, type NodeConfig } from '../node/node.service'
import { embedImageService } from './materialEmbedding.service'
import { markdownToHtmlService } from './mineruResult.service'

/** OCR 节点名称 */
const OCR_NODE_NAME = 'extractImageInfo'

/** 429 重试配置 */
const RETRY_CONFIG = { maxRetries: 3, baseDelayMs: 2000 }

/**
 * 带指数退避的重试包装，仅对 429 限流错误重试
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
        try {
            return await fn()
        } catch (error: any) {
            const is429 = error?.status === 429
                || error?.message?.includes('429')
                || error?.cause?.status === 429
            if (!is429 || attempt === RETRY_CONFIG.maxRetries) {
                throw error
            }
            const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt)
            logger.warn(`OCR 调用触发 429 限流，${delay}ms 后重试 (${attempt + 1}/${RETRY_CONFIG.maxRetries})`)
            await new Promise(resolve => setTimeout(resolve, delay))
        }
    }
    throw new Error('重试次数已耗尽')
}

/** 支持的图片 MIME 类型 */
export const SUPPORTED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
]

/** 图片信息提取结果 */
export interface ImageInfoResult {
    /** 图片类型：doc-文档，photo-照片 */
    imgType: ImageType
    /** 图片包含的内容信息（Markdown 格式） */
    imageInfo: string
}

/** 图片识别结果 */
export interface OcrResult {
    /** 识别记录 */
    record: imageRecognitionRecords
    /** 是否成功 */
    success: boolean
    /** 错误信息 */
    error?: string
    /** 任务信息（用于标识已有成功记录） */
    task?: {
        taskId: string
    }
}

// 结构化输出定义
const imageInfoSchema = z.object({
    imgType: z.enum(['doc', 'photo']).describe('图片的类型：doc-文档类图片，photo-照片类图片'),
    imageInfo: z.string().describe('图片包含的内容信息，使用 Markdown 格式'),
})

/**
 * 验证图片类型是否支持
 * Requirements: 3.3.1, 3.3.2
 */
export function validateImageType(mimeType: string): boolean {
    return SUPPORTED_IMAGE_TYPES.includes(mimeType.toLowerCase())
}

/**
 * 从节点配置中获取系统提示词
 * @param config 节点配置
 * @returns 系统提示词内容
 */
function getSystemPromptFromConfig(config: NodeConfig): string {
    // 查找 system 类型的提示词
    const systemPrompt = config.prompts.find((p) => p.type === 'system')
    if (!systemPrompt || !systemPrompt.content) {
        throw new Error(`OCR 节点 "${config.name}" 未配置系统提示词，请在后台配置`)
    }

    return systemPrompt.content
}

/**
 * 根据节点配置创建 AI 模型实例
 *
 * 使用 chatModelFactory 根据节点配置的 SDK 类型动态创建对应的 LangChain 模型实例
 * 支持 OpenAI、DeepSeek、Gemini、Anthropic 四种 SDK 类型
 *
 * @param config 节点配置
 * @returns BaseChatModel 实例
 * @see Requirements 5.1, 5.2, 5.3, 5.4 - 动态模型实例化
 */
function createAiModelFromConfig(config: NodeConfig) {
    const apiKey = config.modelApiKeys[0]?.apiKey
    if (!apiKey) {
        throw new Error('模型 API 密钥未配置')
    }

    // 使用 chatModelFactory 根据 SDK 类型创建对应的模型实例
    return createChatModel({
        sdkType: config.modelSdkType,
        modelName: config.modelName,
        apiKey: apiKey,
        baseUrl: config.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: false,
    })
}

/**
 * 调用 AI 服务识别图片内容
 * Requirements: 3.3.4, 3.3.5
 */
async function extractImageInfo(imageUrl: string): Promise<ImageInfoResult> {
    try {
        logger.info('开始识别图片内容', { imageUrl: imageUrl.substring(0, 100) + '...' })

        // 如果是 data URL，需要先压缩
        let processedImageUrl = imageUrl
        if (imageUrl.startsWith('data:')) {
            const { compressImageFromBase64 } = await import('../../utils/imageCompression')

            // 解析 data URL
            const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
            if (matches) {
                const [, mimeType, base64Data] = matches

                // 压缩图片（限制为 9MB，留一些余量）
                const compressed = await compressImageFromBase64(base64Data!, mimeType!, {
                    maxSizeBytes: 9 * 1024 * 1024, // 9MB
                })

                // 重新构建 data URL
                processedImageUrl = `data:${compressed.mimeType};base64,${compressed.base64Data}`
                logger.info('图片已压缩', {
                    originalSize: base64Data!.length,
                    compressedSize: compressed.base64Data!.length,
                })
            }
        } else {
            // 如果是普通 URL，下载并压缩
            const { compressImageFromUrl } = await import('../../utils/imageCompression')
            const compressed = await compressImageFromUrl(imageUrl, {
                maxSizeBytes: 9 * 1024 * 1024, // 9MB
            })

            // 转换为 data URL
            processedImageUrl = `data:${compressed.mimeType};base64,${compressed.buffer.toString('base64')}`
            logger.info('图片已下载并压缩', {
                originalUrl: imageUrl.substring(0, 100),
                compressedSize: compressed.buffer.length,
            })
        }

        // 获取 OCR 节点配置
        const nodeConfig = await getValidNodeConfig(OCR_NODE_NAME, 'OCR')

        // 创建 AI 模型实例
        const model = createAiModelFromConfig(nodeConfig)
        const modelWithStructure = model.withStructuredOutput(imageInfoSchema)

        // 获取系统提示词
        const systemPrompt = getSystemPromptFromConfig(nodeConfig)

        const result = await withRateLimitRetry(() => modelWithStructure.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage([
                {
                    type: 'image_url',
                    image_url: {
                        url: processedImageUrl,
                    },
                },
            ]),
        ]))

        // 验证返回结果
        if (!result || !result.imgType || !result.imageInfo) {
            throw new Error('AI 返回的图片信息格式不正确或缺少必要字段')
        }

        // 清理内容
        result.imageInfo = result.imageInfo.trim()

        logger.info('图片识别成功', {
            imgType: result.imgType,
            contentLength: result.imageInfo.length,
            nodeName: nodeConfig.name,
            modelName: nodeConfig.modelName,
        })

        return {
            imgType: result.imgType as ImageType,
            imageInfo: result.imageInfo,
        }
    } catch (error: any) {
        logger.error('图片识别失败', {
            error: error.message,
            stack: error.stack,
        })
        throw new Error(`图片识别失败: ${error.message}`)
    }
}

/**
 * 通过 base64 数据调用 AI 服务识别图片内容
 * @param base64Data 图片 base64 数据（不含前缀）
 * @param mimeType 图片 MIME 类型（如 image/jpeg）
 */
async function extractImageInfoByBase64(base64Data: string, mimeType: string): Promise<ImageInfoResult> {
    try {
        logger.info('开始识别图片内容（base64）', { mimeType, dataLength: base64Data.length })

        // 构建 data URL 格式（不需要压缩，因为前端已经处理过了）
        const dataUrl = `data:${mimeType};base64,${base64Data}`

        // 获取 OCR 节点配置
        const nodeConfig = await getValidNodeConfig(OCR_NODE_NAME, 'OCR')

        // 创建 AI 模型实例
        const model = createAiModelFromConfig(nodeConfig)
        const modelWithStructure = model.withStructuredOutput(imageInfoSchema)

        // 获取系统提示词
        const systemPrompt = getSystemPromptFromConfig(nodeConfig)

        const result = await withRateLimitRetry(() => modelWithStructure.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage([
                {
                    type: 'image_url',
                    image_url: {
                        url: dataUrl,
                    },
                },
            ]),
        ]))

        // 验证返回结果
        if (!result || !result.imgType || !result.imageInfo) {
            throw new Error('AI 返回的图片信息格式不正确或缺少必要字段')
        }

        // 清理内容
        result.imageInfo = result.imageInfo.trim()

        logger.info('图片识别成功（base64）', {
            imgType: result.imgType,
            contentLength: result.imageInfo.length,
            nodeName: nodeConfig.name,
            modelName: nodeConfig.modelName,
        })

        return {
            imgType: result.imgType as ImageType,
            imageInfo: result.imageInfo,
        }
    } catch (error: any) {
        logger.error('图片识别失败（base64）', {
            error: error.message,
            stack: error.stack,
        })
        throw new Error(`图片识别失败: ${error.message}`)
    }
}

/**
 * 创建图片识别记录（仅识别，不向量化）
 * Requirements: 3.3.1-3.3.8
 */
export async function createImageConversionService(
    ossFileId: number,
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<OcrResult> {
    try {
        // 1. 验证 OSS 文件是否存在
        const ossFile = await (tx || prisma).ossFiles.findFirst({
            where: { id: ossFileId, deletedAt: null },
        })

        if (!ossFile || !ossFile.filePath) {
            return {
                record: null as any,
                success: false,
                error: 'OSS 文件不存在',
            }
        }

        // 2. 检查是否已有识别记录
        const existingRecord = await findImageRecognitionByOssFileIdDao(ossFileId, tx)
        if (existingRecord) {
            // 如果已存在的记录是已完成状态，直接返回成功
            if (existingRecord.status === ImageRecognitionStatus.COMPLETED) {
                return {
                    record: existingRecord,
                    success: true,
                    task: { taskId: 'existing' }
                }
            }
            // 如果是其他状态（处理中、失败等），返回失败
            return {
                record: existingRecord,
                success: false,
                error: '图片已存在识别记录，请勿重复创建',
            }
        }

        // 3. 验证图片类型是否支持
        if (ossFile.fileType && !validateImageType(ossFile.fileType)) {
            logger.error(`图片类型不支持识别: ${ossFile.fileType}`)
            return {
                record: null as any,
                success: false,
                error: `图片类型 ${ossFile.fileType} 不支持识别，支持的类型: ${SUPPORTED_IMAGE_TYPES.join(', ')}`,
            }
        }

        // 4. 获取 OSS 私有文件下载 URL
        const downloadUrl = await generateSignedUrlService(ossFile.filePath, {
            expires: 3600, // 1 小时有效期
            method: 'GET',
        })

        // 5. 调用 AI 服务识别图片内容
        const extractResult = await extractImageInfo(downloadUrl)

        // 6. 将 Markdown 转换为 HTML
        const htmlContent = await markdownToHtmlService(extractResult.imageInfo)

        // 7. 创建图片识别记录
        const record = await createImageRecognitionRecordDao(
            {
                userId,
                ossFileId,
                status: ImageRecognitionStatus.COMPLETED,
                imageType: extractResult.imgType,
                htmlContent,
                markdownContent: extractResult.imageInfo,
            },
            tx
        )

        logger.info('图片识别记录创建成功', {
            recordId: record.id,
            ossFileId,
            imageType: extractResult.imgType,
        })

        return {
            record,
            success: true,
        }
    } catch (error: any) {
        logger.error('创建图片识别记录失败', {
            ossFileId,
            userId,
            error: error.message,
        })

        // 识别失败时不创建识别记录
        return {
            record: null as any,
            success: false,
            error: error.message,
        }
    }
}

/**
 * 创建图片识别记录（包含向量化）
 * Requirements: 3.3.1-3.3.11
 */
export async function createImageRecognitionService(
    ossFileId: number,
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<OcrResult> {
    try {
        // 1. 先执行基础识别
        const conversionResult = await createImageConversionService(ossFileId, userId, tx)

        if (!conversionResult.success || !conversionResult.record) {
            return conversionResult
        }

        // 2. 如果已有成功的识别记录（taskId === 'existing'），跳过向量化处理
        if (conversionResult.task?.taskId === 'existing') {
            logger.info('图片已存在成功的识别记录，跳过向量化处理', {
                ossFileId,
                recordId: conversionResult.record.id,
            })
            return conversionResult
        }

        // 3. 向量化处理
        try {
            const record = conversionResult.record
            if (record.markdownContent) {
                // 获取 OSS 文件信息
                const ossFile = await (tx || prisma).ossFiles.findFirst({
                    where: { id: ossFileId, deletedAt: null },
                })

                const embeddingResult = await embedImageService({
                    content: record.markdownContent,
                    userId,
                    ossFileId,
                    fileName: ossFile?.fileName || `image_${ossFileId}`,
                })

                // 更新记录的向量信息
                await updateImageRecognitionRecordDao(record.id, {
                    vectorIds: embeddingResult.ids,
                    lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
                }, tx)

                logger.info('图片向量化完成', {
                    recordId: record.id,
                    ossFileId,
                    chunkCount: embeddingResult.chunkCount,
                })

            }
        } catch (embedError: any) {
            // 向量化失败不影响识别结果
            logger.warn('图片向量化失败，但识别结果已保存', {
                ossFileId,
                error: embedError.message,
            })

        }

        return conversionResult
    } catch (error: any) {
        logger.error('创建图片识别记录（含向量化）失败', {
            ossFileId,
            userId,
            error: error.message,
        })
        return {
            record: null as any,
            success: false,
            error: error.message,
        }
    }
}

/**
 * 编辑图片识别记录
 * Requirements: 3.3.6
 */
export async function updateImageRecognitionService(
    id: number,
    markdownContent: string,
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords> {
    try {
        // 1. 验证记录是否存在
        const existingRecord = await findImageRecognitionByIdDao(id, tx)
        if (!existingRecord) {
            throw new Error('图片识别记录不存在')
        }

        // 2. 验证用户权限
        if (existingRecord.userId !== userId) {
            throw new Error('无权限编辑此记录')
        }

        // 3. 将 Markdown 转换为 HTML
        const htmlContent = await markdownToHtmlService(markdownContent)

        // 4. 更新记录
        const updatedRecord = await updateImageRecognitionRecordDao(
            id,
            {
                markdownContent,
                htmlContent,
            },
            tx
        )

        logger.info('图片识别记录更新成功', { recordId: id })

        return updatedRecord
    } catch (error: any) {
        logger.error('编辑图片识别记录失败', {
            id,
            userId,
            error: error.message,
        })
        throw error
    }
}

/**
 * 根据 ossFileId 查询识别记录
 */
export async function findByOssFileIdService(
    ossFileId: number,
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords | null> {
    return await findImageRecognitionByOssFileIdDao(ossFileId, tx)
}

/**
 * 根据 ossFileId 集合查询识别记录
 */
export async function findByOssFileIdsService(
    fileIds: number[],
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords[]> {
    return await findImageRecognitionsByOssFileIdsDao(fileIds, tx)
}

/**
 * 根据 ID 查询识别记录
 */
export async function findByIdService(
    id: number,
    tx?: Prisma.TransactionClient
): Promise<imageRecognitionRecords | null> {
    return await findImageRecognitionByIdDao(id, tx)
}

/**
 * 通过 base64 数据创建图片识别记录
 * 
 * 参考 ASR 服务的 completeTranscriptionService 方法实现
 * 只在识别成功后才创建识别记录，识别失败时不创建记录
 * 
 * 用于客户端直接上传 base64 图片数据的场景
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.6, 10.7, 10.8, 10.9
 * 
 * @param base64Data 图片 base64 数据（不含 data:image/xxx;base64, 前缀）
 * @param mimeType 图片 MIME 类型（如 image/jpeg）
 * @param ossFileId 关联的 OSS 文件 ID
 * @param userId 用户 ID
 * @param tx 事务对象（可选）
 * @returns 识别结果
 */
export async function createImageRecognitionByBase64Service(
    base64Data: string,
    mimeType: string,
    ossFileId: number,
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<OcrResult> {
    try {
        // 1. 验证图片类型是否支持
        // Requirements: 10.1
        if (!validateImageType(mimeType)) {
            logger.error('图片类型不支持识别', { mimeType, ossFileId })
            return {
                record: null as any,
                success: false,
                error: `图片类型 ${mimeType} 不支持识别，支持的类型: ${SUPPORTED_IMAGE_TYPES.join(', ')}`,
            }
        }

        // 2. 验证 OSS 文件是否存在
        // Requirements: 10.1
        const ossFile = await (tx || prisma).ossFiles.findFirst({
            where: { id: ossFileId, deletedAt: null },
        })

        if (!ossFile) {
            logger.error('OSS 文件不存在', { ossFileId })
            return {
                record: null as any,
                success: false,
                error: 'OSS 文件不存在',
            }
        }

        // 3. 检查是否已有识别记录
        // Requirements: 10.6, 10.7, 10.8
        const existingRecord = await findImageRecognitionByOssFileIdDao(ossFileId, tx)
        if (existingRecord) {
            // 如果已有成功的识别记录，直接返回
            // Requirements: 10.6
            if (existingRecord.status === ImageRecognitionStatus.COMPLETED) {
                logger.info('图片已存在成功的识别记录，直接返回', {
                    recordId: existingRecord.id,
                    ossFileId,
                })
                return {
                    record: existingRecord,
                    success: true,
                    task: { taskId: 'existing' }
                }
            }

            // 如果是失败或处理中的记录，软删除旧记录后重新识别
            // Requirements: 10.7, 10.9
            logger.info('检测到失败或处理中的识别记录，将软删除并重新识别', {
                recordId: existingRecord.id,
                ossFileId,
                oldStatus: existingRecord.status,
            })

            // 软删除旧记录
            await (tx || prisma).imageRecognitionRecords.update({
                where: { id: existingRecord.id },
                data: { deletedAt: new Date() },
            })
        }

        // 4. 调用 AI 服务识别图片内容（使用 base64）
        // Requirements: 10.1, 10.2
        let extractResult: ImageInfoResult
        try {
            extractResult = await extractImageInfoByBase64(base64Data, mimeType)
        } catch (aiError: any) {
            // AI 识别失败时不创建记录，直接返回错误
            // Requirements: 10.2
            logger.error('AI 图片识别失败', {
                ossFileId,
                mimeType,
                error: aiError.message,
            })
            return {
                record: null as any,
                success: false,
                error: `图片识别失败: ${aiError.message}`,
            }
        }

        // 5. 将 Markdown 转换为 HTML
        // Requirements: 10.5
        const htmlContent = await markdownToHtmlService(extractResult.imageInfo)

        // 6. 识别成功后才创建图片识别记录
        // Requirements: 10.1, 10.4, 10.5
        const record = await createImageRecognitionRecordDao(
            {
                userId,
                ossFileId,
                status: ImageRecognitionStatus.COMPLETED,
                imageType: extractResult.imgType,
                htmlContent,
                markdownContent: extractResult.imageInfo,
            },
            tx
        )

        logger.info('图片识别成功，记录已创建', {
            recordId: record.id,
            ossFileId,
            imageType: extractResult.imgType,
            contentLength: extractResult.imageInfo.length,
        })

        // 7. 异步触发向量化嵌入（失败不影响主流程）
        // Requirements: 10.10, 10.11, 10.12, 10.13, 10.14
        triggerImageEmbeddingAsync(record.id, ossFileId, userId, ossFile.fileName || `image_${ossFileId}`, tx)

        return {
            record,
            success: true,
        }
    } catch (error: any) {
        // 识别失败时不创建识别记录
        // Requirements: 10.2
        logger.error('创建图片识别记录失败', {
            ossFileId,
            userId,
            mimeType,
            error: error.message,
            stack: error.stack,
        })

        return {
            record: null as any,
            success: false,
            error: error.message,
        }
    }
}

/**
 * 异步触发图片识别结果向量化
 * 
 * 在识别完成后异步调用向量化服务，失败不影响主流程
 * 参考 ASR 服务的 triggerAudioEmbeddingAsync 实现
 * 
 * Requirements: 10.10, 10.11, 10.12, 10.13, 10.14
 * 
 * @param recordId 图片识别记录 ID
 * @param ossFileId OSS 文件 ID
 * @param userId 用户 ID
 * @param fileName 文件名
 * @param tx 事务对象（可选）
 */
function triggerImageEmbeddingAsync(
    recordId: number,
    ossFileId: number,
    userId: number,
    fileName: string,
    tx?: Prisma.TransactionClient
): void {
    // 使用 Promise 异步执行，不阻塞主流程
    embedImageRecordService(recordId, ossFileId, userId, fileName, tx)
        .then((result) => {
            if (result.success) {
                logger.info('图片向量化成功', {
                    recordId,
                    ossFileId,
                    vectorIds: result.vectorIds?.length || 0,
                    chunkCount: result.chunkCount || 0,
                })
            } else {
                // 向量化失败只记录警告日志，不影响主流程
                // Requirements: 10.12
                logger.warn('图片向量化失败', {
                    recordId,
                    ossFileId,
                    error: result.error,
                })
            }
        })
        .catch((error) => {
            // 向量化异常只记录错误日志，不影响主流程
            // Requirements: 10.12
            logger.error('图片向量化异常', {
                recordId,
                ossFileId,
                error: error.message,
            })
        })
}

/**
 * 为图片识别记录执行向量化嵌入
 * 
 * Requirements: 10.10, 10.11, 10.13, 10.14
 * 
 * @param recordId 图片识别记录 ID
 * @param ossFileId OSS 文件 ID
 * @param userId 用户 ID
 * @param fileName 文件名
 * @param tx 事务对象（可选）
 * @returns 向量化结果
 */
async function embedImageRecordService(
    recordId: number,
    ossFileId: number,
    userId: number,
    fileName: string,
    tx?: Prisma.TransactionClient
): Promise<{
    success: boolean
    vectorIds?: string[]
    chunkCount?: number
    error?: string
}> {
    try {
        // 1. 获取识别记录
        const record = await findImageRecognitionByIdDao(recordId, tx)
        if (!record || !record.markdownContent) {
            return {
                success: false,
                error: '识别记录不存在或内容为空',
            }
        }

        // 2. 调用向量化服务
        // Requirements: 10.10
        const embeddingResult = await embedImageService({
            content: record.markdownContent,
            userId,
            ossFileId,
            fileName,
        })

        // 3. 更新记录的向量信息
        // Requirements: 10.11
        await updateImageRecognitionRecordDao(recordId, {
            vectorIds: embeddingResult.ids,
            lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
        }, tx)

        return {
            success: true,
            vectorIds: embeddingResult.ids,
            chunkCount: embeddingResult.chunkCount,
        }
    } catch (embedError: any) {

        return {
            success: false,
            error: embedError.message,
        }
    }
}
