/**
 * MinerU 批量上传回调接口
 *
 * POST /api/v1/callback/mineru-batch
 *
 * 接收 MinerU 批量上传文件识别完成的回调通知
 * 验证签名后更新任务状态和识别记录
 *
 * @requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { z } from 'zod'
import crypto from 'crypto'
import { processMineruResultService } from '~~/server/services/material/mineruResult.service'
import { DocRecognitionStatus, MineruTaskStatus } from '#shared/types/recognition'
import { findDocRecognitionByOssFileIdDao, updateDocRecognitionRecordDao } from '~~/server/services/material/mineru.dao'

/** MinerU 批量回调请求体验证 Schema */
const callbackBodySchema = z.object({
    /** 校验签名（uid + seed + content 的 SHA256） */
    checksum: z.string().min(1, 'checksum 不能为空'),
    /** 回调内容（JSON 字符串） */
    content: z.string().min(1, 'content 不能为空'),
})

/** content 解析后的文件结果 */
interface MineruFileResult {
    /** 数据 ID（ossFileId_userId） */
    data_id: string
    /** 文件名 */
    file_name?: string
    /** 状态：done 或 failed */
    state: 'done' | 'failed'
    /** 错误信息（失败时） */
    err_msg?: string
    /** 完整 ZIP 下载链接（成功时） */
    full_zip_url?: string
    /** 旧版结果格式（兼容） */
    result?: {
        download_url?: string
    }
}

/** content 解析后的结构 */
interface MineruBatchCallbackContent {
    /** 批量任务 ID */
    batch_id: string
    /** 文件结果列表（新版字段名） */
    extract_result?: MineruFileResult[]
    /** 文件结果列表（旧版字段名，兼容） */
    files?: MineruFileResult[]
}

/** 回调响应格式 */
interface CallbackResponse {
    code: string
    message: string
}

/**
 * 解析 data_id 获取 ossFileId 和 userId
 * data_id 格式：ossFileId_userId
 */
const parseDataId = (dataId: string): { ossFileId: number; userId: number } | null => {
    const parts = dataId.split('_')
    if (parts.length !== 2) {
        return null
    }

    const ossFileId = parseInt(parts[0]!, 10)
    const userId = parseInt(parts[1]!, 10)

    if (isNaN(ossFileId) || isNaN(userId)) {
        return null
    }

    return { ossFileId, userId }
}

/**
 * 验证回调签名
 * checksum = SHA256(uid + seed + content)
 */
const verifyChecksum = (
    checksum: string,
    content: string,
    seed: string,
    uid: string
): boolean => {
    const expectedChecksum = crypto
        .createHash('sha256')
        .update(uid + seed + content)
        .digest('hex')

    return checksum === expectedChecksum
}

/**
 * 根据 ossFileId 查找对应的 MinerU 任务
 * 查找最近的处理中状态的任务
 */
const findMineruTaskByOssFileId = async (
    ossFileId: number,
    userId: number
): Promise<Awaited<ReturnType<typeof prisma.mineruTasks.findFirst>>> => {
    return await prisma.mineruTasks.findFirst({
        where: {
            ossFileId,
            userId,
            deletedAt: null,
            status: MineruTaskStatus.PROCESSING,
        },
        orderBy: { createdAt: 'desc' },
    })
}

export default defineEventHandler(async (event): Promise<CallbackResponse> => {
    try {
        // 获取请求体
        const body = await readBody(event)

        // 验证请求体格式
        const parseResult = callbackBodySchema.safeParse(body)
        if (!parseResult.success) {
            logger.error('MinerU 批量回调：请求体验证失败', parseResult.error.issues)
            return { code: 'FAIL', message: '请求参数无效' }
        }

        const { checksum, content } = parseResult.data

        // 解析 content JSON 字符串
        let callbackContent: MineruBatchCallbackContent
        try {
            callbackContent = JSON.parse(content)
        } catch {
            logger.error('MinerU 批量回调：content 解析失败')
            return { code: 'FAIL', message: 'content 格式无效' }
        }

        // 打印完整的回调内容用于调试
        logger.info('MinerU 批量回调：收到原始 content', {
            contentKeys: Object.keys(callbackContent),
            fullContent: JSON.stringify(callbackContent).substring(0, 1000)
        })

        const { batch_id: batchId, extract_result: extractResult, files: legacyFiles } = callbackContent

        // 兼容新旧两种字段名：extract_result（新版）和 files（旧版）
        const files = extractResult || legacyFiles

        if (!batchId || !Array.isArray(files) || files.length === 0) {
            logger.error('MinerU 批量回调：content 内容不完整', {
                batchId,
                filesCount: files?.length,
                filesType: typeof files,
                hasExtractResult: 'extract_result' in callbackContent,
                hasFiles: 'files' in callbackContent
            })
            return { code: 'FAIL', message: 'content 内容不完整' }
        }

        logger.info(`MinerU 批量回调：收到批次 ${batchId} 的回调通知，文件数: ${files.length}`)

        // 处理每个文件的回调结果
        let successCount = 0
        let failCount = 0

        for (const fileResult of files) {
            const { data_id: dataId, state, result, err_msg: errMsg } = fileResult

            // 解析 data_id
            const parsed = parseDataId(dataId)
            if (!parsed) {
                logger.error(`MinerU 批量回调：data_id 格式无效: ${dataId}`)
                failCount++
                continue
            }

            const { ossFileId, userId } = parsed

            // 查找对应的 MinerU 任务
            const task = await findMineruTaskByOssFileId(ossFileId, userId)
            if (!task) {
                logger.warn(`MinerU 批量回调：未找到对应任务 ossFileId=${ossFileId}, userId=${userId}`)
                failCount++
                continue
            }

            // 获取任务中保存的 seed 用于验证签名
            const taskRawData = task.taskRawData as Record<string, any> | null
            const seed = taskRawData?.seed as string | undefined

            // 签名验证：checksum = SHA256(uid + seed + content)
            // 配置了 NUXT_MINERU_UID 时强制验签；未配置时降级 warn 并继续（保持生产可用性）
            const mineruUid = useRuntimeConfig().mineru?.uid
            if (mineruUid) {
                if (!seed) {
                    logger.error(`MinerU 批量回调：任务缺少 seed 无法验签 ossFileId=${ossFileId}`)
                    failCount++
                    continue
                }
                if (!verifyChecksum(checksum, content, seed, mineruUid)) {
                    logger.error(`MinerU 批量回调：签名验证失败 ossFileId=${ossFileId}`)
                    failCount++
                    continue
                }
            } else {
                logger.warn(`MinerU 批量回调：NUXT_MINERU_UID 未配置，签名验证跳过 ossFileId=${ossFileId}`)
            }

            // 幂等检查：如果任务已完成，跳过
            if (task.status === MineruTaskStatus.SUCCESS || task.status === MineruTaskStatus.FAILED) {
                logger.info(`MinerU 批量回调：任务已处理，跳过 ossFileId=${ossFileId}`)
                successCount++
                continue
            }

            // 根据状态更新任务
            if (state === 'done') {
                // 兼容新旧两种下载链接字段：full_zip_url（新版）和 result.download_url（旧版）
                const downloadUrl = fileResult.full_zip_url || result?.download_url

                if (!downloadUrl) {
                    logger.error(`MinerU 批量回调：缺少下载链接 ossFileId=${ossFileId}`)
                    failCount++
                    continue
                }

                // 更新 MinerU 任务状态为处理中
                await prisma.mineruTasks.update({
                    where: { id: task.id },
                    data: {
                        status: MineruTaskStatus.SUCCESS,
                        result: {
                            downloadUrl,
                            completedAt: new Date().toISOString(),
                        },
                        completedAt: new Date(),
                        updatedAt: new Date(),
                    },
                })

                // 在服务端直接处理识别结果（下载 ZIP、解压、上传图片、保存结果）
                try {
                    const docFileName = fileResult.file_name
                    await processMineruResultService(downloadUrl, ossFileId, userId, docFileName)
                    logger.info(`MinerU 批量回调：文件识别结果处理完成 ossFileId=${ossFileId}`)
                } catch (processError) {
                    logger.error(`MinerU 批量回调：处理识别结果失败 ossFileId=${ossFileId}`, processError)
                    // 即使处理失败，任务状态已经是成功，浏览器可以重试处理
                }

                logger.info(`MinerU 批量回调：文件识别成功 ossFileId=${ossFileId}, downloadUrl=${downloadUrl}`)
                successCount++
            } else {
                // 识别失败
                const errorMessage = errMsg || '识别失败'

                // 更新 MinerU 任务状态
                await prisma.mineruTasks.update({
                    where: { id: task.id },
                    data: {
                        status: MineruTaskStatus.FAILED,
                        errorMsg: errorMessage,
                        completedAt: new Date(),
                        updatedAt: new Date(),
                    },
                })

                // 更新文档识别记录状态为失败
                const docRecord = await findDocRecognitionByOssFileIdDao(ossFileId)
                if (docRecord) {
                    await updateDocRecognitionRecordDao(docRecord.id, {
                        status: DocRecognitionStatus.FAILED,
                    })
                }

                logger.error(`MinerU 批量回调：文件识别失败 ossFileId=${ossFileId}, error=${errorMessage}`)
                failCount++
            }
        }

        logger.info(`MinerU 批量回调处理完成：batchId=${batchId}, success=${successCount}, fail=${failCount}`)

        return { code: 'SUCCESS', message: '处理成功' }
    } catch (error) {
        logger.error('MinerU 批量回调异常：', error)
        return { code: 'FAIL', message: '处理异常' }
    }
})
