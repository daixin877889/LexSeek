/**
 * ASR 音频转录服务
 *
 * 提供音频内容转录功能，集成阿里云百炼 ASR API
 * 支持积分扣减、任务管理、结果处理
 * Requirements: 3.2.1-3.2.10
 */

import type { asrTasks, asrRecords, Prisma } from '~~/generated/prisma/client'
import {
    createAsrTaskService,
    updateAsrTaskService,
    getAsrTaskByTaskIdService,
    getPendingAsrTasksService,
    isAsrTaskProcessedService,
    AsrTaskStatus,
} from './asrTask.service'
import {
    AsrRecordStatus,
    createAsrRecordDao,
    findAsrRecordByOssFileIdDao,
    findAsrRecordByIdDao,
    findAsrRecordsByOssFileIdsDao,
    findAsrRecordsByTaskIdDao,
    updateAsrRecordDao,
    updateAsrRecordsByTaskIdDao,
} from './asr.dao'
import { generateSignedUrlService, uploadFileService } from '../storage/storage.service'
import { checkPointsService, consumePointsService } from '../point/pointConsumption.service'

/** ASR 转录积分消耗项目标识符 */
const ASR_TRANSCRIBE_ITEM_KEY = 'asr_transcribe'

/** 支持的音频 MIME 类型 */
export const SUPPORTED_AUDIO_TYPES = [
    'audio/mpeg',       // mp3
    'audio/mp3',        // mp3
    'audio/wav',        // wav
    'audio/x-wav',      // wav
    'audio/wave',       // wav
    'audio/ogg',        // ogg
    'audio/flac',       // flac
    'audio/x-flac',     // flac
    'audio/aac',        // aac
    'audio/mp4',        // m4a
    'audio/x-m4a',      // m4a
    'audio/webm',       // webm
    'audio/amr',        // amr
    'audio/opus',       // opus
]

/** ASR 任务提交选项 */
export interface AsrSubmitOptions {
    /** 是否启用时间戳对齐 */
    timestampAlignmentEnabled?: boolean
    /** 语言提示 */
    languageHints?: string[]
    /** 是否启用语气词过滤 */
    disfluencyRemovalEnabled?: boolean
    /** 是否启用说话人分离 */
    diarizationEnabled?: boolean
}

/** ASR 任务提交结果 */
export interface AsrSubmitResult {
    /** 是否成功 */
    success: boolean
    /** 任务记录 */
    task?: asrTasks
    /** ASR 识别记录 */
    record?: asrRecords
    /** 错误信息 */
    error?: string
}

/** ASR 转录结果 */
export interface AsrTranscriptionResult {
    /** 是否成功 */
    success: boolean
    /** 转录文本 */
    text?: string
    /** 说话人列表 */
    speakers?: Array<{ id: number; name: string; color?: string }>
    /** 音频时长（秒） */
    duration?: number
    /** 详细结果 */
    result?: Record<string, any>
    /** 错误信息 */
    error?: string
}

/** 轮询配置 */
interface PollingConfig {
    /** 初始延迟（毫秒） */
    initialDelay: number
    /** 最大延迟（毫秒） */
    maxDelay: number
    /** 最大重试次数 */
    maxRetries: number
    /** 退避因子 */
    backoffFactor: number
}

/** 默认轮询配置 */
const DEFAULT_POLLING_CONFIG: PollingConfig = {
    initialDelay: 5000,      // 5 秒
    maxDelay: 300000,        // 5 分钟
    maxRetries: 30,          // 最多 30 次（音频转录可能需要更长时间）
    backoffFactor: 1.5,      // 每次延迟增加 1.5 倍
}

/** 说话人颜色列表 */
const SPEAKER_COLORS = [
    '#3B82F6', // 蓝色
    '#10B981', // 绿色
    '#F59E0B', // 橙色
    '#EF4444', // 红色
    '#8B5CF6', // 紫色
    '#EC4899', // 粉色
    '#06B6D4', // 青色
    '#84CC16', // 黄绿色
]

// ==================== 工具函数 ====================

/**
 * 验证音频类型是否支持
 * Requirements: 3.2.1
 */
export function validateAudioType(mimeType: string): boolean {
    return SUPPORTED_AUDIO_TYPES.includes(mimeType.toLowerCase())
}

/**
 * 计算指数退避延迟
 */
function calculateBackoffDelay(
    retryCount: number,
    config: PollingConfig = DEFAULT_POLLING_CONFIG
): number {
    const delay = config.initialDelay * Math.pow(config.backoffFactor, retryCount)
    return Math.min(delay, config.maxDelay)
}

/**
 * 生成说话人信息
 */
function generateSpeakers(speakerCount: number): Array<{ id: number; name: string; color: string }> {
    const speakers: Array<{ id: number; name: string; color: string }> = []
    for (let i = 0; i < speakerCount; i++) {
        speakers.push({
            id: i,
            name: `说话人 ${i + 1}`,
            color: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
        })
    }
    return speakers
}

/**
 * 从转录结果中提取纯文本
 */
function extractTextFromTranscription(transcription: any): string {
    if (!transcription) return ''

    // 如果是字符串，直接返回
    if (typeof transcription === 'string') {
        return transcription
    }

    // 如果有 text 字段
    if (transcription.text) {
        return transcription.text
    }

    // 如果有 sentences 数组
    if (Array.isArray(transcription.sentences)) {
        return transcription.sentences
            .map((s: any) => s.text || s.sentence || '')
            .filter(Boolean)
            .join('\n')
    }

    // 如果有 words 数组
    if (Array.isArray(transcription.words)) {
        return transcription.words
            .map((w: any) => w.text || w.word || '')
            .filter(Boolean)
            .join(' ')
    }

    return ''
}

/**
 * 从转录结果中提取说话人数量
 */
function extractSpeakerCount(transcription: any): number {
    if (!transcription) return 1

    const speakerIds = new Set<number>()

    // 从 sentences 中提取
    if (Array.isArray(transcription.sentences)) {
        transcription.sentences.forEach((s: any) => {
            if (s.speaker_id !== undefined) {
                speakerIds.add(s.speaker_id)
            }
        })
    }

    // 从 words 中提取
    if (Array.isArray(transcription.words)) {
        transcription.words.forEach((w: any) => {
            if (w.speaker_id !== undefined) {
                speakerIds.add(w.speaker_id)
            }
        })
    }

    return speakerIds.size || 1
}

// ==================== 服务层 ====================

/**
 * 检查用户积分是否足够
/**
 * 检查用户积分是否足够进行 ASR 转录
 * Requirements: 3.2.6, 3.2.7
 * 
 * @deprecated 请使用 checkPointsService('asr_transcribe', durationMinutes)
 */
export const checkUserPointsForAsrService = async (
    userId: number,
    durationMinutes: number = 1
): Promise<{ sufficient: boolean; required: number; available: number }> => {
    try {
        const result = await checkPointsService(userId, ASR_TRANSCRIBE_ITEM_KEY, Math.ceil(durationMinutes))
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
 * 提交音频转录任务
 * Requirements: 3.2.1, 3.2.2, 3.2.6, 3.2.7
 *
 * @param ossFileId OSS 文件 ID
 * @param userId 用户 ID
 * @param options 转录选项
 * @returns 提交结果
 */
export const submitAsrTaskService = async (
    ossFileId: number,
    userId: number,
    options: AsrSubmitOptions = {}
): Promise<AsrSubmitResult> => {
    try {
        // 1. 获取 ASR API Token（从环境变量获取）
        const asrToken = process.env.DASHSCOPE_API_KEY
        if (!asrToken) {
            return { success: false, error: '未配置 ASR API Token（DASHSCOPE_API_KEY）' }
        }

        // 2. 获取文件信息
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: ossFileId, deletedAt: null },
        })
        if (!ossFile) {
            return { success: false, error: '文件不存在' }
        }
        if (!ossFile.filePath) {
            return { success: false, error: '文件路径不存在' }
        }

        // 3. 验证音频类型
        if (ossFile.fileType && !validateAudioType(ossFile.fileType)) {
            return {
                success: false,
                error: `音频类型 ${ossFile.fileType} 不支持，支持的类型: ${SUPPORTED_AUDIO_TYPES.join(', ')}`,
            }
        }

        // 4. 检查是否已有识别记录
        const existingRecord = await findAsrRecordByOssFileIdDao(ossFileId)
        if (existingRecord) {
            return {
                success: false,
                error: '该音频已存在识别记录，请勿重复提交',
            }
        }

        // 5. 检查用户积分（暂时按 1 分钟计算，实际时长在转录完成后确定）
        // Requirements: 3.2.6, 3.2.7
        const pointCheck = await checkUserPointsForAsrService(userId, 1)
        if (!pointCheck.sufficient) {
            return { success: false, error: '积分不足，请先充值' }
        }

        // 6. 生成签名 URL
        const audioUrl = await generateSignedUrlService(ossFile.filePath, {
            expires: 7200, // 2 小时有效期（音频转录可能需要较长时间）
        })

        // 7. 构建请求参数
        const requestBody = {
            model: 'paraformer-v2',
            input: {
                file_urls: [audioUrl],
            },
            parameters: {
                timestamp_alignment_enabled: options.timestampAlignmentEnabled ?? false,
                language_hints: options.languageHints ?? ['zh', 'en'],
                disfluency_removal_enabled: options.disfluencyRemovalEnabled ?? false,
                diarization_enabled: options.diarizationEnabled ?? true,
            },
        }

        // 8. 调用阿里云百炼 ASR API 提交任务
        // Requirements: 3.2.1
        const response = await $fetch<{
            request_id?: string
            output?: {
                task_id: string
                task_status: string
            }
            code?: string
            message?: string
        }>('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${asrToken}`,
                'Content-Type': 'application/json',
                'X-DashScope-Async': 'enable',
            },
            body: requestBody,
        })

        if (response.code) {
            logger.error('ASR 任务提交失败：', response.message)
            return { success: false, error: response.message || '任务提交失败' }
        }

        const taskId = response.output?.task_id
        if (!taskId) {
            return { success: false, error: '未获取到任务 ID' }
        }

        // 9. 创建 ASR 任务记录
        // Requirements: 3.2.2
        const task = await createAsrTaskService({
            taskId,
            status: AsrTaskStatus.PROCESSING,
            taskRawData: {
                audioUrl,
                options: requestBody,
                submittedAt: new Date().toISOString(),
                originalResponse: response,
            },
        })

        // 10. 创建 ASR 识别记录
        // Requirements: 3.2.4
        const record = await createAsrRecordDao({
            userId,
            ossFileId,
            asrTasksId: task.id,
            status: AsrRecordStatus.PROCESSING,
            audioUrl,
        })

        logger.info(`ASR 任务提交成功：taskId=${taskId}, ossFileId=${ossFileId}`)

        return { success: true, task, record }
    } catch (error) {
        logger.error('提交 ASR 转录任务失败：', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : '提交任务失败',
        }
    }
}

/**
 * 处理转录结果
 * Requirements: 3.2.3, 3.2.4
 *
 * @param taskId ASR 任务 ID
 * @param transcriptionUrl 转录结果 URL
 * @returns 处理结果
 */
export const processTranscriptionResultService = async (
    taskId: string,
    transcriptionUrl: string
): Promise<AsrTranscriptionResult> => {
    try {
        // 1. 下载转录结果 JSON
        const response = await $fetch<any>(transcriptionUrl)

        if (!response) {
            return { success: false, error: '转录结果为空' }
        }

        // 2. 提取转录文本
        const text = extractTextFromTranscription(response)

        // 3. 提取说话人数量并生成说话人信息
        const speakerCount = extractSpeakerCount(response)
        const speakers = generateSpeakers(speakerCount)

        // 4. 提取音频时长（如果有）
        let duration: number | undefined
        if (response.duration) {
            duration = Math.ceil(response.duration / 1000) // 转换为秒
        } else if (response.audio_duration) {
            duration = Math.ceil(response.audio_duration)
        }

        return {
            success: true,
            text,
            speakers,
            duration,
            result: response,
        }
    } catch (error) {
        logger.error('处理转录结果失败：', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : '处理转录结果失败',
        }
    }
}

/**
 * 完成转录并保存结果
 * Requirements: 3.2.4, 3.2.8, 3.2.9
 *
 * @param taskId ASR 任务 ID（外部任务 ID）
 * @param transcriptionResult 转录结果
 */
export const completeTranscriptionService = async (
    taskId: string,
    transcriptionResult: AsrTranscriptionResult
): Promise<void> => {
    try {
        // 1. 获取任务信息
        const task = await getAsrTaskByTaskIdService(taskId)
        if (!task) {
            throw new Error('任务不存在')
        }

        // 2. 更新任务状态
        await updateAsrTaskService(task.id, {
            status: AsrTaskStatus.SUCCESS,
            result: {
                text: transcriptionResult.text,
                speakers: transcriptionResult.speakers,
                duration: transcriptionResult.duration,
                raw_result: transcriptionResult.result,
                completed_at: new Date().toISOString(),
            },
        })

        // 3. 更新 ASR 识别记录
        const records = await findAsrRecordsByTaskIdDao(task.id)
        for (const record of records) {
            await updateAsrRecordDao(record.id, {
                status: AsrRecordStatus.SUCCESS,
                audioDuration: transcriptionResult.duration,
                result: transcriptionResult.result,
                speakers: transcriptionResult.speakers,
            })

            // 4. 扣减积分（按分钟计费）
            // Requirements: 3.2.8, 3.2.9
            const durationMinutes = transcriptionResult.duration
                ? Math.ceil(transcriptionResult.duration / 60)
                : 1

            try {
                await consumePointsService(record.userId, ASR_TRANSCRIBE_ITEM_KEY, durationMinutes, { sourceId: record.id })
                logger.info(`ASR 转录积分扣减成功：userId=${record.userId}, minutes=${durationMinutes}`)
            } catch (pointError) {
                // 积分扣减失败不影响转录结果，但需要记录日志
                logger.error('ASR 转录积分扣减失败：', pointError)
            }
        }

        logger.info(`ASR 转录完成：taskId=${taskId}`)
    } catch (error) {
        logger.error('完成转录失败：', error)
        throw error
    }
}

/**
 * 标记转录失败
 * Requirements: 3.2.5, 3.2.10
 *
 * @param taskId ASR 任务 ID（外部任务 ID）
 * @param errorMsg 错误信息
 */
export const failTranscriptionService = async (
    taskId: string,
    errorMsg: string
): Promise<void> => {
    try {
        // 1. 获取任务信息
        const task = await getAsrTaskByTaskIdService(taskId)
        if (!task) {
            logger.warn(`标记转录失败：任务不存在 taskId=${taskId}`)
            return
        }

        // 2. 更新任务状态
        await updateAsrTaskService(task.id, {
            status: AsrTaskStatus.FAILED,
            result: {
                error: errorMsg,
                failed_at: new Date().toISOString(),
            },
        })

        // 3. 更新 ASR 识别记录状态
        await updateAsrRecordsByTaskIdDao(task.id, AsrRecordStatus.FAILED)

        // 4. 不扣减积分
        // Requirements: 3.2.10
        logger.info(`ASR 转录失败，不扣减积分：taskId=${taskId}, error=${errorMsg}`)
    } catch (error) {
        logger.error('标记转录失败时出错：', error)
        throw error
    }
}

/**
 * 轮询查询单个任务状态
 *
 * @param taskId ASR 任务 ID（外部任务 ID）
 * @returns 任务是否完成
 */
export const pollAsrTaskStatusService = async (taskId: string): Promise<boolean> => {
    try {
        // 检查任务是否已处理（幂等检查）
        const isProcessed = await isAsrTaskProcessedService(taskId)
        if (isProcessed) {
            return true
        }

        // 获取 ASR API Token
        const asrToken = process.env.DASHSCOPE_API_KEY
        if (!asrToken) {
            logger.error('轮询任务状态失败：未配置 ASR API Token')
            return false
        }

        // 调用阿里云百炼 ASR API 查询状态
        const response = await $fetch<{
            request_id?: string
            output?: {
                task_id: string
                task_status: string
                results?: Array<{
                    file_url: string
                    subtask_status: string
                    transcription_url?: string
                }>
            }
            code?: string
            message?: string
        }>(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${asrToken}`,
            },
        })

        if (response.code) {
            logger.error(`轮询 ASR 任务状态失败：${response.message}`)
            return false
        }

        const output = response.output
        if (!output) {
            return false
        }

        // 根据状态处理
        switch (output.task_status) {
            case 'SUCCEEDED':
                // 任务完成，处理结果
                const results = output.results
                if (results && results.length > 0) {
                    const firstResult = results[0]
                    if (firstResult.transcription_url) {
                        const transcriptionResult = await processTranscriptionResultService(
                            taskId,
                            firstResult.transcription_url
                        )
                        if (transcriptionResult.success) {
                            await completeTranscriptionService(taskId, transcriptionResult)
                        } else {
                            await failTranscriptionService(taskId, transcriptionResult.error || '处理结果失败')
                        }
                    } else {
                        await failTranscriptionService(taskId, '转录成功但未返回结果链接')
                    }
                } else {
                    await failTranscriptionService(taskId, '转录成功但结果为空')
                }
                return true

            case 'FAILED':
            case 'UNKNOWN':
                // 任务失败
                await failTranscriptionService(taskId, response.message || '转录失败')
                return true

            default:
                // 任务仍在处理中（PENDING, RUNNING）
                return false
        }
    } catch (error) {
        logger.error(`轮询 ASR 任务状态异常：taskId=${taskId}`, error)
        return false
    }
}

/**
 * 启动单个任务的轮询（带指数退避）
 *
 * @param taskId ASR 任务 ID（外部任务 ID）
 * @param config 轮询配置
 */
export const startAsrTaskPollingService = async (
    taskId: string,
    config: PollingConfig = DEFAULT_POLLING_CONFIG
): Promise<void> => {
    let retryCount = 0

    const poll = async (): Promise<void> => {
        // 检查是否超过最大重试次数
        if (retryCount >= config.maxRetries) {
            logger.warn(`ASR 任务轮询超时：taskId=${taskId}, retries=${retryCount}`)
            await failTranscriptionService(taskId, '轮询超时，任务可能仍在处理中')
            return
        }

        try {
            const isCompleted = await pollAsrTaskStatusService(taskId)
            if (isCompleted) {
                return
            }

            // 计算下次轮询延迟（指数退避）
            const delay = calculateBackoffDelay(retryCount, config)
            retryCount++

            logger.debug(`ASR 任务轮询等待：taskId=${taskId}, delay=${delay}ms, retry=${retryCount}`)

            // 等待后继续轮询
            await new Promise((resolve) => setTimeout(resolve, delay))
            await poll()
        } catch (error) {
            logger.error(`ASR 任务轮询异常：taskId=${taskId}`, error)
            retryCount++

            if (retryCount < config.maxRetries) {
                const delay = calculateBackoffDelay(retryCount, config)
                await new Promise((resolve) => setTimeout(resolve, delay))
                await poll()
            } else {
                await failTranscriptionService(taskId, '轮询异常，已达最大重试次数')
            }
        }
    }

    // 启动轮询（异步执行，不阻塞主流程）
    poll().catch((error) => {
        logger.error(`ASR 任务轮询启动失败：taskId=${taskId}`, error)
    })
}

/**
 * 轮询保底机制 - 批量检查待处理任务
 */
export const pollPendingAsrTasksService = async (): Promise<{
    checked: number
    completed: number
    failed: number
}> => {
    const result = { checked: 0, completed: 0, failed: 0 }

    try {
        // 获取待处理的任务
        const pendingTasks = await getPendingAsrTasksService(50)

        for (const task of pendingTasks) {
            if (!task.taskId) continue

            result.checked++

            try {
                const isCompleted = await pollAsrTaskStatusService(task.taskId)
                if (isCompleted) {
                    // 重新获取任务状态判断是成功还是失败
                    const updatedTask = await getAsrTaskByTaskIdService(task.taskId)
                    if (updatedTask?.status === AsrTaskStatus.SUCCESS) {
                        result.completed++
                    } else {
                        result.failed++
                    }
                }
            } catch (error) {
                logger.error(`轮询 ASR 任务失败：taskId=${task.taskId}`, error)
            }
        }

        logger.info(`ASR 轮询保底检查完成：checked=${result.checked}, completed=${result.completed}, failed=${result.failed}`)
    } catch (error) {
        logger.error('ASR 轮询保底机制异常：', error)
    }

    return result
}

/**
 * 提交音频转录任务并启动轮询
 * Requirements: 3.2.1-3.2.10
 *
 * 这是对外暴露的主要接口，整合了任务提交和轮询保底机制
 *
 * @param ossFileId OSS 文件 ID
 * @param userId 用户 ID
 * @param options 转录选项
 * @returns 提交结果
 */
export const transcribeAudioService = async (
    ossFileId: number,
    userId: number,
    options: AsrSubmitOptions = {}
): Promise<AsrSubmitResult> => {
    // 1. 提交任务
    const submitResult = await submitAsrTaskService(ossFileId, userId, options)

    if (!submitResult.success || !submitResult.task) {
        return submitResult
    }

    // 2. 启动轮询保底机制
    if (submitResult.task.taskId) {
        startAsrTaskPollingService(submitResult.task.taskId)
    }

    return submitResult
}

/**
 * 获取 ASR 识别记录
 */
export const getAsrRecordByOssFileIdService = async (
    ossFileId: number
): Promise<asrRecords | null> => {
    return await findAsrRecordByOssFileIdDao(ossFileId)
}

/**
 * 批量获取 ASR 识别记录
 */
export const getAsrRecordsByOssFileIdsService = async (
    ossFileIds: number[]
): Promise<asrRecords[]> => {
    return await findAsrRecordsByOssFileIdsDao(ossFileIds)
}

/**
 * 获取 ASR 识别记录（通过 ID）
 */
export const getAsrRecordByIdService = async (
    id: number
): Promise<asrRecords | null> => {
    return await findAsrRecordByIdDao(id)
}

/**
 * 更新 ASR 识别记录
 */
export const updateAsrRecordService = async (
    id: number,
    data: {
        speakers?: Array<{ id: number; name: string; color?: string }>
        keywords?: any
        summary?: string
    },
    tx?: Prisma.TransactionClient
): Promise<asrRecords> => {
    return await updateAsrRecordDao(id, data, tx)
}
