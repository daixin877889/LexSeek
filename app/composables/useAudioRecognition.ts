/**
 * 音频识别 Composable
 *
 * 封装音频识别相关的 API 调用，包括：
 * - 提交识别任务
 * - 轮询任务状态
 * - 获取识别结果
 * - 更新说话人名称
 * - 加密音频文件识别（解密 → 上传临时文件 → 提交识别）
 *
 * @requirements 6.6.1, 6.6.2, 6.7.4
 */

import type { OssFileItem } from '~~/app/store/file'
import type { PostSignatureResult } from '~~/shared/types/oss'
import { AsrRecordStatus, AsrRecordStatusText } from '#shared/types/recognition'

/** 支持的音频扩展名 */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm', 'amr', 'opus']

/** 音频扩展名到 MIME 类型的映射 */
const AUDIO_MIME_MAP: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
    amr: 'audio/amr',
    opus: 'audio/opus',
}

/**
 * 根据文件名获取 MIME 类型
 */
const getMimeTypeFromFileName = (fileName: string): string | null => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    return ext ? AUDIO_MIME_MAP[ext] || null : null
}

/**
 * 判断是否为音频文件
 * 支持格式：MP3、WAV、M4A、AAC、FLAC、OGG、WEBM、AMR、OPUS
 */
export const isAudioFile = (fileName: string): boolean => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    return AUDIO_EXTENSIONS.includes(ext || '')
}

/** ASR 任务提交选项 */
export interface AsrSubmitOptions {
    /** 语言提示，默认 ['zh', 'en'] */
    languageHints?: string[]
    /** 是否启用说话人分离，默认 true */
    diarizationEnabled?: boolean
}

/** 说话人信息 */
export interface Speaker {
    /** 说话人 ID */
    id: number
    /** 说话人名称 */
    name: string
    /** 说话人颜色（可选） */
    color?: string
}

/** 识别结果句子信息 */
export interface SentenceResult {
    /** 句子文本 */
    text: string
    /** 开始时间（毫秒） */
    begin_time: number
    /** 结束时间（毫秒） */
    end_time: number
    /** 说话人 ID */
    speaker_id: number
    /** 句子 ID */
    sentence_id: number
}

/** 提交识别任务响应 */
interface SubmitRecognitionResponse {
    /** 任务 ID */
    taskId: string | null
    /** 任务状态 */
    taskStatus: number
}

/** 查询任务状态响应 */
interface TaskStatusResponse {
    /** 任务 ID */
    taskId: string
    /** 任务状态 */
    status: number
    /** 识别记录 ID（成功时返回） */
    recordId: number | null
    /** 识别记录状态（成功时返回） */
    recordStatus: number | null
}

/** 获取识别结果响应 */
interface GetResultResponse {
    /** 识别记录 ID */
    id: number
    /** 状态 */
    status: AsrRecordStatus
    /** 音频 URL */
    audioUrl: string
    /** 音频时长（毫秒） */
    audioDuration: number
    /** 说话人列表 */
    speakers: Speaker[]
    /** 识别结果句子列表 */
    result: SentenceResult[]
}

/** 更新说话人响应 */
interface UpdateSpeakersResponse {
    /** 识别记录 ID */
    id: number
    /** 更新后的说话人列表 */
    speakers: Speaker[]
    /** 关键词 */
    keywords: any
    /** 摘要 */
    summary: string | null
}

/** 轮询配置 */
interface PollingConfig {
    /** 轮询间隔（毫秒），默认 3000 */
    interval: number
    /** 最大轮询次数，默认 60 */
    maxRetries: number
}

/** 默认轮询配置 */
const DEFAULT_POLLING_CONFIG: PollingConfig = {
    interval: 3000,    // 3 秒
    maxRetries: 60,    // 最多 60 次（约 3 分钟）
}

/** 临时文件上传签名响应 */
interface TempUploadSignature extends PostSignatureResult {
    /** 临时文件路径 */
    key: string
    /** 实际的音频 MIME 类型（从数据库 originalMimeType 获取） */
    mimeType: string
}

/** 加密音频识别进度阶段 */
export type EncryptedAudioProgressStage = 'downloading' | 'decrypting' | 'preparing' | 'uploading' | 'submitting'

/** 加密音频识别进度回调参数 */
export interface EncryptedAudioProgress {
    /** 当前阶段 */
    stage: EncryptedAudioProgressStage
    /** 进度百分比（0-100） */
    progress: number
}

/**
 * 等待指定时间
 */
const sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 音频识别 Composable
 *
 * @example
 * ```typescript
 * const { submitRecognition, pollTaskStatus, getResult, updateSpeakers } = useAudioRecognition()
 *
 * // 提交识别任务
 * const submitResult = await submitRecognition(ossFileId)
 * if (submitResult) {
 *     // 轮询任务状态
 *     const finalStatus = await pollTaskStatus(submitResult.recordId!, (status) => {
 *         console.log('当前状态:', AsrRecordStatusText[status])
 *     })
 *
 *     if (finalStatus === AsrRecordStatus.SUCCESS) {
 *         // 获取识别结果
 *         const result = await getResult(submitResult.recordId!)
 *         console.log('识别结果:', result)
 *     }
 * }
 * ```
 */
export const useAudioRecognition = () => {
    /**
     * 提交音频识别任务
     *
     * @param ossFileId OSS 文件 ID
     * @param options 识别选项
     * @returns 提交结果，失败返回 null
     */
    const submitRecognition = async (
        ossFileId: number,
        options?: AsrSubmitOptions
    ): Promise<SubmitRecognitionResponse | null> => {
        return await useApiFetch<SubmitRecognitionResponse>('/api/v1/recognition/audio', {
            method: 'POST',
            body: { ossFileId, options },
        })
    }

    /**
     * 查询任务状态
     *
     * @param taskId 任务 ID
     * @returns 任务状态，失败返回 null
     */
    const getTaskStatus = async (taskId: string): Promise<TaskStatusResponse | null> => {
        return await useApiFetch<TaskStatusResponse>(`/api/v1/recognition/audio/task/${taskId}`)
    }

    /**
     * 轮询任务状态
     *
     * 每隔指定时间查询一次任务状态，直到任务完成（成功或失败）或达到最大轮询次数
     *
     * @param taskId 任务 ID
     * @param onProgress 进度回调，每次轮询时调用
     * @param config 轮询配置
     * @returns 最终的识别记录 ID（成功时返回）或 null（失败时）
     */
    const pollTaskStatus = async (
        taskId: string,
        onProgress?: (status: number) => void,
        config: PollingConfig = DEFAULT_POLLING_CONFIG
    ): Promise<number | null> => {
        let retryCount = 0

        while (retryCount < config.maxRetries) {
            // 查询当前任务状态
            const result = await getTaskStatus(taskId)

            if (!result) {
                // 查询失败，继续轮询
                retryCount++
                await sleep(config.interval)
                continue
            }

            // 回调通知当前状态
            onProgress?.(result.status)

            // 检查是否已完成（成功或失败）
            if (result.status === AsrTaskStatus.SUCCESS) {
                // 任务成功，返回识别记录 ID
                return result.recordId
            }

            if (result.status === AsrTaskStatus.FAILED) {
                // 任务失败，返回 null
                return null
            }

            // 继续轮询
            retryCount++
            await sleep(config.interval)
        }

        // 超过最大轮询次数，返回 null
        return null
    }

    /**
     * 轮询任务状态（旧版本，兼容性保留）
     *
     * @deprecated 请使用 pollTaskStatus(taskId) 代替
     */
    const pollTaskStatusOld = async (
        recordId: number,
        onProgress?: (status: AsrRecordStatus) => void,
        config: PollingConfig = DEFAULT_POLLING_CONFIG
    ): Promise<AsrRecordStatus> => {
        let retryCount = 0

        while (retryCount < config.maxRetries) {
            // 查询当前状态
            const result = await getResult(recordId)

            if (!result) {
                // 查询失败，继续轮询
                retryCount++
                await sleep(config.interval)
                continue
            }

            // 回调通知当前状态
            onProgress?.(result.status)

            // 检查是否已完成（成功或失败）
            if (result.status === AsrRecordStatus.SUCCESS || result.status === AsrRecordStatus.FAILED) {
                return result.status
            }

            // 继续轮询
            retryCount++
            await sleep(config.interval)
        }

        // 超过最大轮询次数，返回当前状态（可能是 PENDING 或 PROCESSING）
        const finalResult = await getResult(recordId)
        return finalResult?.status ?? AsrRecordStatus.FAILED
    }

    /**
     * 获取识别结果
     *
     * @param recordId 识别记录 ID
     * @returns 识别结果，失败返回 null
     */
    const getResult = async (recordId: number): Promise<GetResultResponse | null> => {
        return await useApiFetch<GetResultResponse>(`/api/v1/recognition/audio/${recordId}`)
    }

    /**
     * 更新说话人名称
     *
     * @param recordId 识别记录 ID
     * @param speakers 说话人列表
     * @returns 更新结果，失败返回 null
     */
    const updateSpeakers = async (
        recordId: number,
        speakers: Speaker[]
    ): Promise<UpdateSpeakersResponse | null> => {
        return await useApiFetch<UpdateSpeakersResponse>(`/api/v1/recognition/audio/${recordId}`, {
            method: 'PUT',
            body: { speakers },
        })
    }

    /**
     * 更新识别记录（通用方法）
     *
     * 支持更新说话人、关键词、摘要等信息
     *
     * @param recordId 识别记录 ID
     * @param data 更新数据
     * @returns 更新结果，失败返回 null
     */
    const updateRecord = async (
        recordId: number,
        data: {
            speakers?: Speaker[]
            keywords?: any
            summary?: string
        }
    ): Promise<UpdateSpeakersResponse | null> => {
        return await useApiFetch<UpdateSpeakersResponse>(`/api/v1/recognition/audio/${recordId}`, {
            method: 'PUT',
            body: data,
        })
    }

    /**
     * 通过 OSS 文件 ID 查询现有的 ASR 识别记录
     *
     * 直接查询数据库中是否已存在该文件的识别记录，不会触发新的识别任务
     *
     * @param ossFileId OSS 文件 ID
     * @returns 识别记录信息，如果没有记录则返回 null
     */
    const getRecordByOssFileId = async (
        ossFileId: number
    ): Promise<{
        id: number
        ossFileId: number
        status: AsrRecordStatus
        audioUrl: string
        audioDuration: number
        speakers: Speaker[]
        result: SentenceResult[]
    } | null> => {
        return await useApiFetch(`/api/v1/recognition/audio/by-oss-file/${ossFileId}`)
    }

    /**
     * 检查文件是否已有识别记录（不触发新任务）
     *
     * 通过查询 API 检查文件是否已有识别记录
     * 与 submitRecognition 不同，此方法不会创建新的识别任务
     *
     * @param ossFileId OSS 文件 ID
     * @returns 识别记录信息，如果没有记录则返回 { hasRecord: false }
     */
    const checkRecognitionStatus = async (
        ossFileId: number
    ): Promise<{
        hasRecord: boolean
        recordId: number | null
        status: AsrRecordStatus | null
    }> => {
        const record = await getRecordByOssFileId(ossFileId)

        if (!record) {
            return { hasRecord: false, recordId: null, status: null }
        }

        return {
            hasRecord: true,
            recordId: record.id,
            status: record.status,
        }
    }

    /**
     * 从 ArrayBuffer 获取音频时长
     * 
     * @param audioData 音频数据
     * @param mimeType 音频 MIME 类型
     * @returns 音频时长（秒），失败返回 null
     */
    const getAudioDurationFromBuffer = async (audioData: ArrayBuffer, mimeType: string): Promise<number | null> => {
        return new Promise((resolve) => {
            try {
                const blob = new Blob([audioData], { type: mimeType })
                const url = URL.createObjectURL(blob)
                const audio = new Audio()

                // 设置超时，避免无限等待
                const timeout = setTimeout(() => {
                    URL.revokeObjectURL(url)
                    logger.warn('[getAudioDurationFromBuffer] 获取音频时长超时')
                    resolve(null)
                }, 5000) // 5 秒超时

                audio.onloadedmetadata = () => {
                    clearTimeout(timeout)
                    URL.revokeObjectURL(url)
                    const duration = Math.ceil(audio.duration)
                    logger.info(`[getAudioDurationFromBuffer] 音频时长：${duration} 秒`)
                    resolve(duration)
                }

                audio.onerror = (error) => {
                    clearTimeout(timeout)
                    URL.revokeObjectURL(url)
                    logger.warn('[getAudioDurationFromBuffer] 无法获取音频时长', error)
                    resolve(null)
                }

                audio.src = url
            } catch (error) {
                logger.error('[getAudioDurationFromBuffer] 获取音频时长失败', error)
                resolve(null)
            }
        })
    }

    return {
        // 核心方法
        submitRecognition,
        getTaskStatus,
        pollTaskStatus,
        getResult,
        updateSpeakers,
        updateRecord,

        // 辅助方法
        checkRecognitionStatus,
        getRecordByOssFileId,

        // 工具函数
        isAudioFile,

        // 常量导出
        AsrRecordStatus,
        AsrRecordStatusText,
        AsrTaskStatus,
    }
}
