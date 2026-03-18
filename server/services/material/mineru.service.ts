/**
 * MinerU PDF 转换服务
 *
 * 提供 PDF 文档转换功能，包括任务提交、回调处理、结果解析、轮询保底机制
 * Requirements: 3.1.1-3.1.19
 */

import type { mineruTasks, docRecognitionRecords, Prisma } from '~~/generated/prisma/client'
import { getActiveTokenValueService, hasActiveTokenService } from './mineruToken.service'
import {
    createMineruTaskService,
    updateMineruTaskService,
    getMineruTaskByTaskIdService,
    getPendingMineruTasksService,
    isMineruTaskProcessedService,
} from './mineruTask.service'
import {
    createDocRecognitionRecordDao,
    findDocRecognitionByOssFileIdDao,
    updateDocRecognitionRecordDao,
    findDocRecognitionsByOssFileIdsDao,
} from './mineru.dao'
import { generateSignedUrlService, uploadFileService } from '../storage/storage.service'
import { checkPointsService, consumePointsService } from '../point/pointConsumption.service'
import {
    findOssFileByIdDao,
    findOssFileByIdIncludeDeletedDao,
} from '../files/ossFiles.dao'
import JSZip from 'jszip'
import { v4 as uuidv4 } from 'uuid'
import { $fetch as ofetch } from 'ofetch'
import { processUrlImagesInMarkdown } from './imageProcessor'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { getExtensionFromFileName } from '~~/shared/utils/file'
import { PollingConfig, calculateBackoffDelay, DEFAULT_POLLING_CONFIG } from './materialConstants'

/**
 * MinerU PDF 转换专用轮询配置
 * PDF 处理耗时较长，使用适中的轮询策略
 */
const MINERU_POLLING_CONFIG: PollingConfig = {
    initialDelay: 5000,      // 5 秒初始延迟
    backoffFactor: 1.5,      // 1.5 倍退避因子
    maxDelay: 300000,        // 5 分钟最大延迟
    maxRetries: 20,          // 最多 20 次重试（比默认值少，因为 PDF 处理通常更快完成）
}

/** PDF 解析积分消耗项目标识符 */
const DOC_PARSE_ITEM_KEY = 'doc_parse'

/** MinerU API 基础 URL */
const MINERU_API_BASE = 'https://mineru.net/api/v4/extract'


/** MinerU 任务提交选项 */
export interface MineruSubmitOptions {
    /** 是否启用 OCR */
    enableOcr?: boolean
    /** 是否启用公式识别 */
    enableFormula?: boolean
    /** 是否启用表格识别 */
    enableTable?: boolean
    /** 页码范围（如 "1-10"） */
    pageRange?: string
    /** 回调 URL */
    callbackUrl?: string
}

/** MinerU 任务提交结果 */
export interface MineruSubmitResult {
    /** 是否成功 */
    success: boolean
    /** 任务记录 */
    task?: mineruTasks
    /** 错误信息 */
    error?: string
}

/** MinerU 转换结果 */
export interface MineruConversionResult {
    /** 是否成功 */
    success: boolean
    /** Markdown 内容 */
    markdownContent?: string
    /** HTML 内容 */
    htmlContent?: string
    /** 错误信息 */
    error?: string
}

// 使用共享的默认轮询配置，定义在 materialConstants.ts 中


// ==================== 工具函数 ====================

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 从 ZIP 文件中提取 Markdown 内容和图片
 */
async function extractMarkdownFromZip(zipBuffer: Buffer): Promise<{
    markdown: string
    images: Map<string, Buffer>
}> {
    const zip = await JSZip.loadAsync(zipBuffer)
    let markdown = ''
    const images = new Map<string, Buffer>()

    // 查找 full.md 文件
    for (const [filename, file] of Object.entries(zip.files)) {
        if (filename.endsWith('full.md') || filename === 'full.md') {
            markdown = await file.async('string')
        } else if (/\.(png|jpg|jpeg|gif|webp)$/i.test(filename)) {
            // 提取图片文件
            const imageBuffer = await file.async('nodebuffer')
            images.set(filename, imageBuffer)
        }
    }

    return { markdown, images }
}

/**
 * 上传图片到 OSS 并返回 OSS 信息（用于生成占位符）
 * 返回 ossFileId 和 bucket，而不是直接返回 URL
 */
async function uploadImageToOss(
    imageName: string,
    imageBuffer: Buffer,
    taskId: string,
    userId: number
): Promise<{ bucket: string; ossFileId: number } | null> {
    const ext = getExtensionFromFileName(imageName) || 'png'
    const uniqueName = `${uuidv4()}.${ext}`
    const ossPath = `mineru/${taskId}/${uniqueName}`

    const config = useRuntimeConfig()
    const storageConfig = config.storage
    const ossConfig = storageConfig.aliyunOss
    const bucket = ossConfig.bucket

    try {
        // 先创建 OSS 文件记录
        const ossFile = await prisma.ossFiles.create({
            data: {
                userId,
                bucketName: bucket,
                fileName: imageName,
                filePath: ossPath,
                fileSize: imageBuffer.length,
                fileType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
                source: FileSource.CASE_ANALYSIS,
                status: OssFileStatus.UPLOADED,
                encrypted: false,
            },
        })

        // 上传文件
        await uploadFileService(ossPath, imageBuffer, {
            contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        })

        return {
            bucket,
            ossFileId: ossFile.id,
        }
    } catch (error) {
        logger.error(`上传图片失败: ${imageName}, buffer大小: ${imageBuffer?.length}, 错误:`, error)
        return null
    }
}


/**
 * 替换 Markdown 中的图片路径为 OSS 占位符
 */
async function replaceImagePaths(
    markdown: string,
    images: Map<string, Buffer>,
    taskId: string,
    userId: number
): Promise<string> {
    let result = markdown

    // 1. 并行上传所有图片
    const uploadResults = await Promise.all(
        Array.from(images.entries()).map(async ([imageName, imageBuffer]) => {
            try {
                const ossInfo = await uploadImageToOss(imageName, imageBuffer, taskId, userId)
                return { imageName, ossInfo, success: !!ossInfo }
            } catch (error) {
                logger.error(`上传图片失败: ${imageName}`, error)
                return { imageName, ossInfo: null, success: false }
            }
        })
    )

    // 2. 串行替换 Markdown 中的图片引用（因为需要保持 result 的状态）
    for (const { imageName, ossInfo, success } of uploadResults) {
        if (!success || !ossInfo) {
            logger.error(`上传图片失败，跳过: ${imageName}`)
            continue
        }

        // 生成占位符
        const placeholder = `{{OSS_IMAGE:${ossInfo.bucket}:${ossInfo.ossFileId}}}`

        // 替换 Markdown 中的图片引用
        const escapedName = escapeRegExp(imageName)
        const regex = new RegExp(`(!\\[[^\\]]*\\]\\()([^)]*${escapedName})\\)`, 'g')
        result = result.replace(regex, `$1${placeholder})`)

        // 同时处理相对路径的情况
        const baseName = imageName.split('/').pop() || imageName
        const escapedBaseName = escapeRegExp(baseName)
        const baseRegex = new RegExp(`(!\\[[^\\]]*\\]\\()([^)]*${escapedBaseName})\\)`, 'g')
        result = result.replace(baseRegex, `$1${placeholder})`)
    }

    return result
}

/**
 * Markdown 转 HTML
 * 使用 marked 库进行专业的 Markdown 解析，支持完整的 CommonMark 规范和 GFM 扩展
 */
async function markdownToHtml(markdown: string): Promise<string> {
    const { marked } = await import('marked')

    // 配置 marked 选项
    marked.setOptions({
        gfm: true,        // 启用 GitHub Flavored Markdown
        breaks: true,     // 将换行符转换为 <br>
    })

    return marked.parse(markdown)
}

// ==================== 服务层 ====================

/**
 * 检查用户积分是否足够
/**
 * 检查用户积分是否足够进行 PDF 转换
 * Requirements: 3.1.15, 3.1.16
 * 
 * @deprecated 请使用 checkPointsService('doc_parse', pageCount)
 */
export const checkUserPointsService = async (
    userId: number,
    pageCount: number = 1
): Promise<{ sufficient: boolean; required: number; available: number }> => {
    try {
        const result = await checkPointsService(userId, DOC_PARSE_ITEM_KEY, pageCount)
        return {
            sufficient: result.sufficient,
            required: result.required,
            available: result.available,
        }
    } catch (error) {
        logger.error('检查用户积分失败：', error)
        throw error
    }
}


/**
 * 提交 PDF 转换任务
 * Requirements: 3.1.1, 3.1.2, 3.1.3, 3.1.15, 3.1.16
 *
 * @param ossFileId OSS 文件 ID
 * @param userId 用户 ID
 * @param options 转换选项
 * @returns 提交结果
 */
export const submitPdfConversionService = async (
    ossFileId: number,
    userId: number,
    options: MineruSubmitOptions = {}
): Promise<MineruSubmitResult> => {
    try {
        // 1. 检查是否已有成功的识别记录（优先检查，避免不必要的 API 调用）
        // 如果已有成功的识别记录，说明文件已经识别过了，直接返回
        const existingRecord = await findDocRecognitionByOssFileIdDao(ossFileId)
        if (existingRecord && existingRecord.status === DocRecognitionStatus.SUCCESS) {
            logger.info(`文档已存在成功的识别记录，直接返回：ossFileId=${ossFileId}, recordId=${existingRecord.id}`)
            return {
                success: true,
                // 返回一个虚拟的 task 对象，表示任务已完成
                task: {
                    id: 0,
                    taskId: 'existing',
                    ossFileId,
                    userId,
                    status: MineruTaskStatus.SUCCESS,
                } as any,
            }
        }

        // 2. 检查是否有可用的 Token
        // Requirements: 3.1.1.6, 3.1.1.7
        const hasToken = await hasActiveTokenService()
        if (!hasToken) {
            return { success: false, error: '没有可用的 MinerU Token' }
        }

        const token = await getActiveTokenValueService()
        if (!token) {
            return { success: false, error: '获取 MinerU Token 失败' }
        }

        // 3. 获取文件信息（通过 DAO 层）
        const ossFile = await findOssFileByIdDao(ossFileId)
        if (!ossFile) {
            return { success: false, error: '文件不存在' }
        }
        if (!ossFile.filePath) {
            return { success: false, error: '文件路径不存在' }
        }

        // 4. 检查用户积分（暂时按 1 页计算，实际页数在转换完成后确定）
        // Requirements: 3.1.15, 3.1.16
        const pointCheck = await checkUserPointsService(userId, 1)
        if (!pointCheck.sufficient) {
            return { success: false, error: '积分不足，请先充值' }
        }

        // 5. 生成签名 URL
        const fileUrl = await generateSignedUrlService(ossFile.filePath, {
            expires: 3600, // 1 小时有效期
        })

        // 6. 构建请求参数
        const requestBody: Record<string, any> = {
            url: fileUrl,
            enable_ocr: options.enableOcr ?? true,
            enable_formula: options.enableFormula ?? true,
            enable_table: options.enableTable ?? true,
        }

        if (options.pageRange) {
            requestBody.page_range = options.pageRange
        }

        if (options.callbackUrl) {
            requestBody.callback_url = options.callbackUrl
        }


        // 6. 调用 MinerU API 提交任务
        // Requirements: 3.1.1
        //
        // 说明：对外部 URL 使用 ofetch，避免 Nuxt/Nitro $fetch 进行路由/条件类型深层推导，
        // 在某些 TS 版本下会报 “类型实例化过深，且可能无限”。
        type MineruSubmitTaskResponse = {
            code: number
            msg: string
            data?: {
                task_id: string
            }
        }

        const response = await ofetch<MineruSubmitTaskResponse>(`${MINERU_API_BASE}/task`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: requestBody,
        })

        // 添加日志查看 MinerU 提交任务的响应
        logger.info(`MinerU 任务提交响应：ossFileId=${ossFileId}, response=${JSON.stringify(response)}`)

        if (response.code !== 0) {
            logger.error('MinerU 任务提交失败：', response.msg)
            return { success: false, error: response.msg || '任务提交失败' }
        }

        const taskId = response.data?.task_id
        if (!taskId) {
            return { success: false, error: '未获取到任务 ID' }
        }

        // 7. 创建任务记录
        // Requirements: 3.1.3
        const task = await createMineruTaskService({
            taskId,
            ossFileId,
            userId,
            status: MineruTaskStatus.PROCESSING,
            taskRawData: {
                fileUrl,
                options: requestBody,
                submittedAt: new Date().toISOString(),
            },
            isEncrypted: false,
        })

        // 9. 不在提交时创建识别记录，只在识别成功时创建
        // 识别记录将在 completeConversionService 中创建或更新

        logger.info(`MinerU 任务提交成功：taskId=${taskId}, ossFileId=${ossFileId}`)

        return { success: true, task }
    } catch (error) {
        logger.error('提交 PDF 转换任务失败：', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : '提交任务失败',
        }
    }
}


/**
 * 处理转换结果
 * Requirements: 3.1.5, 3.1.6, 3.1.7, 3.1.8
 *
 * @param taskId MinerU 任务 ID
 * @param downloadUrl 结果下载 URL
 * @param userId 用户 ID（用于上传图片到 OSS）
 * @returns 处理结果
 */
export const processConversionResultService = async (
    taskId: string,
    downloadUrl: string,
    userId: number
): Promise<MineruConversionResult> => {
    try {
        // 1. 下载 ZIP 文件
        // Requirements: 3.1.5
        const response = await ofetch<ArrayBuffer>(downloadUrl, {
            responseType: 'arrayBuffer',
        } as any)
        const zipBuffer = Buffer.from(response)

        // 2. 解压并提取内容
        // Requirements: 3.1.6
        const { markdown, images } = await extractMarkdownFromZip(zipBuffer)

        if (!markdown) {
            return { success: false, error: 'ZIP 文件中未找到 full.md 文件' }
        }

        // 3. 如果有图片，上传到 OSS 并替换路径为占位符
        // Requirements: 3.1.7
        let processedMarkdown = markdown
        if (images.size > 0) {
            processedMarkdown = await replaceImagePaths(markdown, images, taskId, userId)
        }

        // 4. 处理 Markdown 中的外部 URL 图片
        // 获取任务信息以获取文件名
        const task = await getMineruTaskByTaskIdService(taskId)
        const ossFile = task ? await findOssFileByIdDao(task.ossFileId) : null
        const docFileName = ossFile?.fileName?.replace(/\.[^.]+$/, '') || `document_${taskId}`

        processedMarkdown = await processUrlImagesInMarkdown(processedMarkdown, userId, docFileName)

        // 5. 转换为 HTML
        const htmlContent = await markdownToHtml(processedMarkdown)

        return {
            success: true,
            markdownContent: processedMarkdown,
            htmlContent,
        }
    } catch (error) {
        logger.error('处理转换结果失败：', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : '处理转换结果失败',
        }
    }
}


/**
 * 完成转换并保存结果
 * Requirements: 3.1.8, 3.1.17, 3.1.18
 *
 * @param taskId MinerU 任务 ID
 * @param markdownContent Markdown 内容
 * @param htmlContent HTML 内容
 * @param pageCount 页数（用于积分扣减）
 */
export const completeConversionService = async (
    taskId: string,
    markdownContent: string,
    htmlContent: string,
    pageCount: number = 1
): Promise<void> => {
    try {
        // 1. 获取任务信息
        const task = await getMineruTaskByTaskIdService(taskId)
        if (!task) {
            throw new Error('任务不存在')
        }

        // 2. 更新任务状态
        await updateMineruTaskService(task.id, {
            status: MineruTaskStatus.SUCCESS,
            result: {
                markdown_content: markdownContent,
                html_content: htmlContent,
                page_count: pageCount,
                completed_at: new Date().toISOString(),
            },
            completedAt: new Date(),
        })

        // 3. 创建或更新文档识别记录（只在识别成功时创建）
        let docRecord = await findDocRecognitionByOssFileIdDao(task.ossFileId)
        if (docRecord) {
            // 如果已存在识别记录，更新它
            await updateDocRecognitionRecordDao(docRecord.id, {
                status: DocRecognitionStatus.SUCCESS,
                markdownContent,
                htmlContent,
            })
        } else {
            // 如果不存在识别记录，创建新记录（识别成功时才创建）
            docRecord = await createDocRecognitionRecordDao({
                userId: task.userId,
                ossFileId: task.ossFileId,
                status: DocRecognitionStatus.SUCCESS,
                markdownContent,
                htmlContent,
            })
        }

        // 4. 进行向量化嵌入
        if (docRecord) {
            try {
                // 获取 OSS 文件信息用于嵌入元数据（包含已删除的文件）
                const ossFile = await findOssFileByIdIncludeDeletedDao(task.ossFileId)
                const fileName = ossFile?.fileName || `document_${task.ossFileId}`

                const { embedDocumentService } = await import('./materialEmbedding.service')
                const embeddingResult = await embedDocumentService({
                    content: markdownContent,
                    userId: task.userId,
                    ossFileId: task.ossFileId,
                    fileName,
                })

                // 更新识别记录的向量信息
                await updateDocRecognitionRecordDao(docRecord.id, {
                    vectorIds: embeddingResult.ids,
                    lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
                })

                logger.info(`PDF 转换向量化嵌入完成：taskId=${taskId}, chunkCount=${embeddingResult.chunkCount}`)

                // 更新 case_materials 表的 embedding_status（批量更新）
                try {
                    const { batchUpdateMaterialEmbeddingStatusByOssFileIdDAO } = await import('../case/caseMaterial.dao')
                    await batchUpdateMaterialEmbeddingStatusByOssFileIdDAO(task.ossFileId, 'completed')
                    logger.info(`批量更新材料 ${task.ossFileId} 的 embedding_status 为 completed`)
                } catch (updateError: any) {
                    // 更新失败不影响主流程
                    logger.warn('更新 case_materials embedding_status 失败', {
                        ossFileId: task.ossFileId,
                        error: updateError.message,
                    })
                }
            } catch (embeddingError) {
                // 嵌入失败不影响转换结果，只记录日志
                logger.error('PDF 转换向量化嵌入失败：', embeddingError)

                // 更新 case_materials 表的 embedding_status 为 failed（批量更新）
                try {
                    const { batchUpdateMaterialEmbeddingStatusByOssFileIdDAO } = await import('../case/caseMaterial.dao')
                    await batchUpdateMaterialEmbeddingStatusByOssFileIdDAO(task.ossFileId, 'failed')
                } catch (updateError: any) {
                    logger.warn('更新 case_materials embedding_status 失败', {
                        ossFileId: task.ossFileId,
                        error: updateError.message,
                    })
                }
            }
        }

        // 5. 扣减积分
        // Requirements: 3.1.17, 3.1.18
        try {
            await consumePointsService(task.userId, DOC_PARSE_ITEM_KEY, pageCount, { sourceId: task.id })
            logger.info(`PDF 转换积分扣减成功：userId=${task.userId}, pages=${pageCount}`)
        } catch (pointError) {
            // 积分扣减失败不影响转换结果，但需要记录日志
            // 识别已经完成，结果已经保存，不应该因为积分问题而标记为失败
            logger.error('PDF 转换积分扣减失败：', pointError)
            // TODO: 可以考虑创建一个"待支付"记录，让用户充值后补扣积分
        }

        logger.info(`PDF 转换完成：taskId=${taskId}`)
    } catch (error) {
        logger.error('完成转换失败：', error)
        throw error
    }
}


/**
 * 标记转换失败
 * Requirements: 3.1.9, 3.1.19
 *
 * @param taskId MinerU 任务 ID
 * @param errorMsg 错误信息
 */
export const failConversionService = async (
    taskId: string,
    errorMsg: string
): Promise<void> => {
    try {
        // 1. 获取任务信息
        const task = await getMineruTaskByTaskIdService(taskId)
        if (!task) {
            logger.warn(`标记转换失败：任务不存在 taskId=${taskId}`)
            return
        }

        // 2. 更新任务状态
        await updateMineruTaskService(task.id, {
            status: MineruTaskStatus.FAILED,
            errorMsg,
            completedAt: new Date(),
        })

        // 3. 识别失败时不创建/更新识别记录
        // 识别记录只在识别成功时创建

        // 4. 不扣减积分
        // Requirements: 3.1.19
        logger.info(`PDF 转换失败，不扣减积分：taskId=${taskId}, error=${errorMsg}`)
    } catch (error) {
        logger.error('标记转换失败时出错：', error)
        throw error
    }
}



/**
 * 轮询查询单个任务状态
 * Requirements: 3.1.10, 3.1.11, 3.1.14
 *
 * @param taskId MinerU 任务 ID
 * @returns 任务是否完成
 */
export const pollTaskStatusService = async (taskId: string): Promise<boolean> => {
    try {
        // 检查任务是否已处理（幂等检查）
        // Requirements: 3.1.12
        const isProcessed = await isMineruTaskProcessedService(taskId)
        if (isProcessed) {
            return true
        }

        // 获取 Token
        const token = await getActiveTokenValueService()
        if (!token) {
            logger.error('轮询任务状态失败：没有可用的 Token')
            return false
        }

        // 调用 MinerU API 查询状态
        type MineruPollTaskResponse = {
            code: number
            msg: string
            trace_id?: string
            data?: {
                task_id: string
                state: string
                err_msg?: string
                progress?: number
                full_zip_url?: string
                extract_progress?: {
                    extracted_pages: number
                    total_pages: number
                    start_time: string
                }
            }
        }

        const response = await ofetch<MineruPollTaskResponse>(`${MINERU_API_BASE}/task/${taskId}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })

        // 添加日志查看 MinerU 返回的完整数据
        logger.info(`MinerU 轮询响应：taskId=${taskId}, response=${JSON.stringify(response)}`)

        if (response.code !== 0) {
            logger.error(`轮询任务状态失败：${response.msg}`)
            return false
        }

        const data = response.data
        if (!data) {
            return false
        }

        // 根据状态处理
        switch (data.state) {
            case 'done':
                // 任务完成，处理结果
                // Requirements: 3.1.11
                const downloadUrl = data.full_zip_url
                if (downloadUrl) {
                    // 获取任务信息以获取 userId
                    const task = await getMineruTaskByTaskIdService(taskId)
                    const userId = task?.userId || 0

                    const result = await processConversionResultService(taskId, downloadUrl, userId)
                    if (result.success && result.markdownContent && result.htmlContent) {
                        await completeConversionService(
                            taskId,
                            result.markdownContent,
                            result.htmlContent
                        )
                    } else {
                        await failConversionService(taskId, result.error || '处理结果失败')
                    }
                } else {
                    await failConversionService(taskId, '转换成功但未返回下载链接')
                }
                return true

            case 'failed':
                // 任务失败
                await failConversionService(taskId, data.err_msg || '转换失败')
                return true

            default:
                // 任务仍在处理中
                return false
        }
    } catch (error) {
        logger.error(`轮询任务状态异常：taskId=${taskId}`, error)
        return false
    }
}


/**
 * 轮询保底机制 - 批量检查待处理任务
 * Requirements: 3.1.10, 3.1.13, 3.1.14
 *
 * 使用指数退避策略控制轮询间隔
 */
export const pollPendingTasksService = async (): Promise<{
    checked: number
    completed: number
    failed: number
}> => {
    const result = { checked: 0, completed: 0, failed: 0 }

    try {
        // 获取待处理的任务
        const pendingTasks = await getPendingMineruTasksService(50)

        for (const task of pendingTasks) {
            // 跳过无效的 taskId（包括 'existing'）
            if (!task.taskId || task.taskId === 'existing') continue

            result.checked++

            try {
                const isCompleted = await pollTaskStatusService(task.taskId)
                if (isCompleted) {
                    // 重新获取任务状态判断是成功还是失败
                    const updatedTask = await getMineruTaskByTaskIdService(task.taskId)
                    if (updatedTask?.status === MineruTaskStatus.SUCCESS) {
                        result.completed++
                    } else {
                        result.failed++
                    }
                }
            } catch (error) {
                logger.error(`轮询任务失败：taskId=${task.taskId}`, error)
            }
        }

        logger.info(`轮询保底检查完成：checked=${result.checked}, completed=${result.completed}, failed=${result.failed}`)
    } catch (error) {
        logger.error('轮询保底机制异常：', error)
    }

    return result
}


/**
 * 启动单个任务的轮询（带指数退避）
 * Requirements: 3.1.10, 3.1.13, 3.1.14
 *
 * @param taskId MinerU 任务 ID
 * @param config 轮询配置
 */
export const startTaskPollingService = async (
    taskId: string,
    config: PollingConfig = MINERU_POLLING_CONFIG
): Promise<void> => {
    let retryCount = 0

    const poll = async (): Promise<void> => {
        // 检查是否超过最大重试次数
        // Requirements: 3.1.13
        if (retryCount >= config.maxRetries) {
            logger.warn(`任务轮询超时：taskId=${taskId}, retries=${retryCount}`)
            await failConversionService(taskId, '轮询超时，任务可能仍在处理中')
            return
        }

        try {
            const isCompleted = await pollTaskStatusService(taskId)
            if (isCompleted) {
                return
            }

            // 计算下次轮询延迟（指数退避）
            // Requirements: 3.1.14
            const delay = calculateBackoffDelay(retryCount, config)
            retryCount++

            logger.debug(`任务轮询等待：taskId=${taskId}, delay=${delay}ms, retry=${retryCount}`)

            // 等待后继续轮询
            await new Promise((resolve) => setTimeout(resolve, delay))
            await poll()
        } catch (error) {
            logger.error(`任务轮询异常：taskId=${taskId}`, error)
            retryCount++

            if (retryCount < config.maxRetries) {
                const delay = calculateBackoffDelay(retryCount, config)
                await new Promise((resolve) => setTimeout(resolve, delay))
                await poll()
            } else {
                await failConversionService(taskId, '轮询异常，已达最大重试次数')
            }
        }
    }

    // 启动轮询（异步执行，不阻塞主流程）
    poll().catch((error) => {
        logger.error(`任务轮询启动失败：taskId=${taskId}`, error)
    })
}


/**
 * 提交 PDF 转换任务并启动轮询
 * Requirements: 3.1.1-3.1.19
 *
 * 这是对外暴露的主要接口，整合了任务提交和轮询保底机制
 *
 * @param ossFileId OSS 文件 ID
 * @param userId 用户 ID
 * @param options 转换选项
 * @returns 提交结果
 */
export const convertPdfService = async (
    ossFileId: number,
    userId: number,
    options: MineruSubmitOptions = {}
): Promise<MineruSubmitResult> => {
    // 1. 提交任务
    const submitResult = await submitPdfConversionService(ossFileId, userId, options)

    if (!submitResult.success || !submitResult.task) {
        return submitResult
    }

    // 2. 如果没有配置回调 URL，启动轮询保底机制
    // Requirements: 3.1.10
    // 只有当 taskId 不是 'existing' 时才启动轮询（已有成功记录的情况）
    if (!options.callbackUrl && submitResult.task.taskId && submitResult.task.taskId !== 'existing') {
        startTaskPollingService(submitResult.task.taskId)
    }

    return submitResult
}

/**
 * 获取文档识别记录
 */
export const getDocRecognitionByOssFileIdService = async (
    ossFileId: number
): Promise<docRecognitionRecords | null> => {
    return await findDocRecognitionByOssFileIdDao(ossFileId)
}

/**
 * 批量获取文档识别记录
 */
export const getDocRecognitionsByOssFileIdsService = async (
    ossFileIds: number[]
): Promise<docRecognitionRecords[]> => {
    return await findDocRecognitionsByOssFileIdsDao(ossFileIds)
}
