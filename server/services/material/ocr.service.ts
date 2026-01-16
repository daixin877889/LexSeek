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
import {
    ImageRecognitionStatus,
    ImageType,
    createImageRecognitionRecordDao,
    findImageRecognitionByOssFileIdDao,
    findImageRecognitionByIdDao,
    updateImageRecognitionRecordDao,
    findImageRecognitionsByOssFileIdsDao,
} from './ocr.dao'
import { generateSignedUrlService } from '../storage/storage.service'
import { getNodeConfigService, type NodeConfig } from '../node/node.service'
import { embedImageService } from './materialEmbedding.service'

/** OCR 节点名称 */
const OCR_NODE_NAME = 'extractImageInfo'

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
}

// 结构化输出定义
const imageInfoSchema = z.object({
    imgType: z.enum(['doc', 'photo']).describe('图片的类型：doc-文档类图片，photo-照片类图片'),
    imageInfo: z.string().describe('图片包含的内容信息，使用 Markdown 格式'),
})

/**
 * Markdown 转 HTML
 * 使用 marked 库进行专业的 Markdown 解析
 */
async function markdownToHtml(markdown: string): Promise<string> {
    // 配置 marked 选项
    marked.setOptions({
        gfm: true,        // 启用 GitHub Flavored Markdown
        breaks: true,     // 将换行符转换为 <br>
    })

    return marked.parse(markdown)
}

/**
 * 验证图片类型是否支持
 * Requirements: 3.3.1, 3.3.2
 */
export function validateImageType(mimeType: string): boolean {
    return SUPPORTED_IMAGE_TYPES.includes(mimeType.toLowerCase())
}

/**
 * 获取 OCR 节点配置
 * 从 node 系统获取 OCR 相关的模型和提示词配置
 */
async function getOcrNodeConfig(): Promise<NodeConfig> {
    const config = await getNodeConfigService(OCR_NODE_NAME)

    if (!config) {
        throw new Error(`OCR 节点 "${OCR_NODE_NAME}" 未配置或未启用`)
    }

    if (config.modelApiKeys.length === 0) {
        throw new Error(`OCR 节点 "${OCR_NODE_NAME}" 的模型提供商未配置 API 密钥`)
    }

    return config
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

        // 获取 OCR 节点配置
        const nodeConfig = await getOcrNodeConfig()

        // 创建 AI 模型实例
        const model = createAiModelFromConfig(nodeConfig)
        const modelWithStructure = model.withStructuredOutput(imageInfoSchema)

        // 获取系统提示词
        const systemPrompt = getSystemPromptFromConfig(nodeConfig)

        const result = await modelWithStructure.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage([
                {
                    type: 'image_url',
                    image_url: {
                        url: imageUrl,
                    },
                },
            ]),
        ])

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
    // 构建 data URL 格式
    const dataUrl = `data:${mimeType};base64,${base64Data}`
    return extractImageInfo(dataUrl)
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
        const htmlContent = await markdownToHtml(extractResult.imageInfo)

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

        // 尝试创建失败记录
        try {
            const failedRecord = await createImageRecognitionRecordDao(
                {
                    userId,
                    ossFileId,
                    status: ImageRecognitionStatus.FAILED,
                },
                tx
            )
            return {
                record: failedRecord,
                success: false,
                error: error.message,
            }
        } catch {
            return {
                record: null as any,
                success: false,
                error: error.message,
            }
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

        // 2. 向量化处理
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
        const htmlContent = await markdownToHtml(markdownContent)

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
 * 用于客户端直接上传 base64 图片数据的场景
 * @param base64Data 图片 base64 数据（不含 data:image/xxx;base64, 前缀）
 * @param mimeType 图片 MIME 类型（如 image/jpeg）
 * @param ossFileId 关联的 OSS 文件 ID
 * @param userId 用户 ID
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
        if (!validateImageType(mimeType)) {
            return {
                record: null as any,
                success: false,
                error: `图片类型 ${mimeType} 不支持识别，支持的类型: ${SUPPORTED_IMAGE_TYPES.join(', ')}`,
            }
        }

        // 2. 检查是否已有识别记录
        const existingRecord = await findImageRecognitionByOssFileIdDao(ossFileId, tx)
        if (existingRecord) {
            return {
                record: existingRecord,
                success: true,
                error: '图片已存在识别记录',
            }
        }

        // 3. 验证 OSS 文件是否存在
        const ossFile = await (tx || prisma).ossFiles.findFirst({
            where: { id: ossFileId, deletedAt: null },
        })

        if (!ossFile) {
            return {
                record: null as any,
                success: false,
                error: 'OSS 文件不存在',
            }
        }

        // 4. 调用 AI 服务识别图片内容（使用 base64）
        const extractResult = await extractImageInfoByBase64(base64Data, mimeType)

        // 5. 将 Markdown 转换为 HTML
        const htmlContent = await markdownToHtml(extractResult.imageInfo)

        // 6. 创建图片识别记录
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

        logger.info('图片识别记录创建成功（base64）', {
            recordId: record.id,
            ossFileId,
            imageType: extractResult.imgType,
        })

        // 7. 向量化处理
        try {
            if (record.markdownContent) {
                const embeddingResult = await embedImageService({
                    content: record.markdownContent,
                    userId,
                    ossFileId,
                    fileName: ossFile.fileName || `image_${ossFileId}`,
                })

                // 更新记录的向量信息
                await updateImageRecognitionRecordDao(record.id, {
                    vectorIds: embeddingResult.ids,
                    lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
                }, tx)

                logger.info('图片向量化完成（base64）', {
                    recordId: record.id,
                    ossFileId,
                    chunkCount: embeddingResult.chunkCount,
                })
            }
        } catch (embedError: any) {
            // 向量化失败不影响识别结果
            logger.warn('图片向量化失败，但识别结果已保存（base64）', {
                ossFileId,
                error: embedError.message,
            })
        }

        return {
            record,
            success: true,
        }
    } catch (error: any) {
        logger.error('创建图片识别记录失败（base64）', {
            ossFileId,
            userId,
            mimeType,
            error: error.message,
        })

        // 尝试创建失败记录
        try {
            const failedRecord = await createImageRecognitionRecordDao(
                {
                    userId,
                    ossFileId,
                    status: ImageRecognitionStatus.FAILED,
                },
                tx
            )
            return {
                record: failedRecord,
                success: false,
                error: error.message,
            }
        } catch {
            return {
                record: null as any,
                success: false,
                error: error.message,
            }
        }
    }
}
