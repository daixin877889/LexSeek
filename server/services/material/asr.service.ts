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
} from './asrTask.service'
import {
    createAsrRecordDao,
    findAsrRecordByOssFileIdDao,
    findAsrRecordByIdDao,
    findAsrRecordsByOssFileIdsDao,
    findAsrRecordsByTaskIdDao,
    updateAsrRecordDao,
    updateAsrRecordsByTaskIdDao,
} from './asr.dao'
import { generateSignedUrlService, uploadFileService, deleteFileService } from '../storage/storage.service'
import { markMaterialsByOssFileIdService } from './material.service'
import { MaterialStatus } from '#shared/types/material'
import { v7 as uuidv7 } from 'uuid'
import dayjs from 'dayjs'
import { $fetch as ofetch } from 'ofetch'
import { checkPointsService, consumePointsService, preDeductPointsService, settlePointsService, rollbackPreDeductService } from '../point/pointConsumption.service'
import { getValidNodeConfig, getNodeConfigService, type NodeConfig } from '../node/node.service'
import { embedAudioService as embedAudioToVectorStore, formatAsrResultForEmbedding } from './materialEmbedding.service'
import { DEFAULT_POLLING_CONFIG, calculateBackoffDelay } from './materialConstants'
import type { PollingConfig } from './materialConstants'
import { AsrRecordStatus, AsrTaskStatus } from '#shared/types/recognition'

/** 音频识别节点名称 */
const ASR_NODE_NAME = 'audioRecognition'

/**
 * ASR 音频转录专用轮询配置
 * 音频处理通常耗时较长，使用更宽松的轮询策略
 */
const ASR_POLLING_CONFIG: PollingConfig = {
    initialDelay: 5000,      // 5 秒初始延迟
    backoffFactor: 1.5,      // 1.5 倍退避因子
    maxDelay: 300000,        // 5 分钟最大延迟
    maxRetries: 30,          // 最多 30 次重试
}

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
    /** 详细结果（精简后的结果，存入数据库） */
    result?: Record<string, any>
    /** 原始结果（包含词级别时间戳，用于上传 OSS） */
    rawResult?: Record<string, any>
    /** 原始 JSON 的 OSS 文件 ID */
    jsonOssFileId?: number
    /** 错误信息 */
    error?: string
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
 * 生成说话人信息
 */
function generateSpeakers(speakerCount: number): Array<{ id: number; name: string; color: string }> {
    const speakers: Array<{ id: number; name: string; color: string }> = []
    for (let i = 0; i < speakerCount; i++) {
        speakers.push({
            id: i,
            name: `说话人 ${i + 1}`,
            color: SPEAKER_COLORS[i % SPEAKER_COLORS.length]!,
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

/** ASR 原始结果中的句子信息 */
interface AsrRawSentence {
    /** 句子开始时间（毫秒） */
    begin_time: number
    /** 句子结束时间（毫秒） */
    end_time: number
    /** 句子文本内容 */
    text: string
    /** 句子 ID */
    sentence_id: number
    /** 说话人 ID */
    speaker_id: number
    /** 词级别时间戳（精简时移除） */
    words?: any[]
    /** 其他可能的字段 */
    [key: string]: any
}

/** ASR 原始结果中的转录通道信息 */
interface AsrRawTranscript {
    /** 通道 ID */
    channel_id: number
    /** 内容时长（毫秒） */
    content_duration_in_milliseconds: number
    /** 句子列表 */
    sentences: AsrRawSentence[]
    /** 其他可能的字段 */
    [key: string]: any
}

/** ASR 原始结果结构 */
interface AsrRawResult {
    /** 音频文件 URL */
    file_url: string
    /** 音频属性信息 */
    properties: {
        /** 音频格式 */
        audio_format?: string
        /** 原始采样率 */
        original_sampling_rate?: number
        /** 原始时长（毫秒） */
        original_duration_in_milliseconds?: number
        /** 其他属性 */
        [key: string]: any
    }
    /** 转录结果列表 */
    transcripts: AsrRawTranscript[]
    /**
     * 某些返回格式会把时长放在顶层字段（不同版本/供应商兼容）
     * - duration: 毫秒
     * - audio_duration: 秒
     */
    duration?: number
    audio_duration?: number
}

/** 精简后的句子信息（仅保留必要字段） */
interface SimplifiedSentence {
    /** 句子开始时间（毫秒） */
    begin_time: number
    /** 句子结束时间（毫秒） */
    end_time: number
    /** 句子文本内容 */
    text: string
    /** 句子 ID */
    sentence_id: number
    /** 说话人 ID */
    speaker_id: number
}

/** 精简后的转录通道信息 */
interface SimplifiedTranscript {
    /** 通道 ID */
    channel_id: number
    /** 内容时长（毫秒） */
    content_duration_in_milliseconds: number
    /** 句子列表（精简后） */
    sentences: SimplifiedSentence[]
}

/** 精简后的 ASR 结果结构 */
export interface SimplifiedAsrResult {
    /** 音频文件 URL */
    file_url: string
    /** 音频属性信息 */
    properties: AsrRawResult['properties']
    /** 转录结果列表（精简后） */
    transcripts: SimplifiedTranscript[]
}

/**
 * 精简 ASR 识别结果
 * 
 * 移除词级别时间戳，仅保留句子级别信息，减少数据存储量
 * 原始结果包含词级别时间戳（words 数组），数据量较大
 * 精简后仅保留句子级别信息：begin_time、end_time、text、sentence_id、speaker_id
 * 
 * Requirements: 6.12（结果精简策略）
 * 
 * @param rawResult 原始 ASR 识别结果
 * @returns 精简后的识别结果
 */
export function simplifyAsrResultService(rawResult: AsrRawResult): SimplifiedAsrResult {
    // 处理空结果或无效结果
    if (!rawResult) {
        return {
            file_url: '',
            properties: {},
            transcripts: [],
        }
    }

    return {
        file_url: rawResult.file_url || '',
        properties: rawResult.properties || {},
        transcripts: (rawResult.transcripts || []).map((transcript: AsrRawTranscript): SimplifiedTranscript => ({
            channel_id: transcript.channel_id,
            content_duration_in_milliseconds: transcript.content_duration_in_milliseconds,
            sentences: (transcript.sentences || []).map((sentence: AsrRawSentence): SimplifiedSentence => ({
                // 仅保留句子级别的必要字段，移除 words 等词级别信息
                begin_time: sentence.begin_time,
                end_time: sentence.end_time,
                text: sentence.text,
                sentence_id: sentence.sentence_id,
                speaker_id: sentence.speaker_id,
            })),
        })),
    }
}

/** 上传原始 JSON 到 OSS 的结果 */
export interface UploadRawJsonResult {
    /** 是否成功 */
    success: boolean
    /** OSS 文件 ID（成功时返回） */
    ossFileId?: number
    /** OSS 文件路径（成功时返回） */
    filePath?: string
    /** 错误信息（失败时返回） */
    error?: string
}

/**
 * 上传原始 ASR 识别结果 JSON 到 OSS
 * 
 * 将原始识别结果（包含词级别时间戳）上传到 OSS 保存，用于后续需要时查看完整数据
 * 文件路径格式：asr/raw/{年}/{月}/{日}/{uuid}.json
 * 
 * Requirements: 6.3.2（上传原始 JSON 到 OSS 保存）
 * 
 * @param rawResult 原始 ASR 识别结果
 * @param userId 用户 ID（用于关联 OSS 文件记录）
 * @returns 上传结果，包含 OSS 文件 ID
 */
export async function uploadRawAsrJsonToOssService(
    rawResult: AsrRawResult,
    userId: number
): Promise<UploadRawJsonResult> {
    try {
        // 1. 获取存储配置
        const config = useRuntimeConfig()
        const storageConfig = config.storage
        const ossConfig = storageConfig.aliyunOss
        const bucket = ossConfig.bucket

        // 2. 生成文件路径：asr/raw/{年}/{月}/{日}/{uuid}.json
        const now = dayjs()
        const year = now.format('YYYY')
        const month = now.format('MM')
        const day = now.format('DD')
        const uuid = uuidv7()
        const filePath = `asr/raw/${year}/${month}/${day}/${uuid}.json`

        // 3. 将原始结果转换为 JSON 字符串
        const jsonContent = JSON.stringify(rawResult, null, 2)
        const buffer = Buffer.from(jsonContent, 'utf-8')

        // 4. 上传到 OSS
        const uploadResult = await uploadFileService(filePath, buffer, {
            contentType: 'application/json',
        })

        // 5. 创建 OSS 文件记录
        const ossFile = await prisma.ossFiles.create({
            data: {
                userId,
                bucketName: bucket,
                fileName: `${uuid}.json`,
                filePath,
                fileSize: buffer.length,
                fileType: 'application/json',
                status: 1, // 已上传
            },
        })

        logger.info(`原始 ASR JSON 上传成功：ossFileId=${ossFile.id}, filePath=${filePath}, etag=${uploadResult.etag}`)

        return {
            success: true,
            ossFileId: ossFile.id,
            filePath,
        }
    } catch (error) {
        logger.error('上传原始 ASR JSON 到 OSS 异常：', error)
        return {
            success: false,
            error: error instanceof Error ? error.message : '上传异常',
        }
    }
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
 * @param audioDuration 音频时长（秒）
 * @param options 转录选项
 * @param tempFilePath 临时文件路径（加密文件解密后上传的路径，可选）
 * @returns 提交结果
 */
export const submitAsrTaskService = async (
    ossFileId: number,
    userId: number,
    options: AsrSubmitOptions = {},
    tempFilePath?: string
): Promise<AsrSubmitResult> => {
    try {

        let audioDuration: number = 0


        // 1. 获取 ASR 节点配置（从模型管理获取 API Key）
        let nodeConfig: NodeConfig
        try {
            nodeConfig = await getValidNodeConfig(ASR_NODE_NAME, 'ASR')
        } catch (configError: any) {
            return { success: false, error: configError.message }
        }
        const asrToken = nodeConfig.modelApiKeys[0]!.apiKey

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

        // 4. 检查是否已有成功的识别记录
        // 如果已有成功的识别记录，直接返回
        const existingRecord = await findAsrRecordByOssFileIdDao(ossFileId)
        if (existingRecord && existingRecord.status === AsrRecordStatus.SUCCESS) {
            logger.info(`音频已存在成功的识别记录，直接返回：ossFileId=${ossFileId}, recordId=${existingRecord.id}`)
            return {
                success: true,
                // 返回一个虚拟的 task 对象，表示任务已完成
                task: {
                    id: existingRecord.asrTasksId || 0,
                    taskId: 'existing',
                    status: AsrTaskStatus.SUCCESS,
                } as any,
            }
        }

        // 5. 生成签名 URL
        const audioUrl = await generateSignedUrlService(ossFile.filePath, {
            expires: 3600, // 1 小时有效期
            method: 'GET',
        })

        logger.debug(`原始文件签名 URL：${audioUrl}`)

        // 6. 获取音频时长
        audioDuration = await getAudioDuration(audioUrl) || 0
        if (audioDuration <= 0) {
            return { success: false, error: '音频时长获取失败' }
        }

        // 7. 预扣积分（使用实际音频时长）
        const durationMinutes = Math.ceil(audioDuration / 60)
        let preDeductBatchId: string | null = null

        try {
            const preDeductResult = await preDeductPointsService(userId, ASR_TRANSCRIBE_ITEM_KEY, durationMinutes)
            preDeductBatchId = preDeductResult.batchId
            logger.info(`ASR 任务积分预扣成功：userId=${userId}, minutes=${durationMinutes}, batchId=${preDeductBatchId}`)
        } catch (preDeductError) {
            const errorMsg = preDeductError instanceof Error ? preDeductError.message : '积分预扣失败'
            logger.error('ASR 任务积分预扣失败：', preDeductError)
            return {
                success: false,
                error: errorMsg
            }
        }

        // // 6. 生成签名 URL
        // // 如果提供了临时文件路径（加密文件解密后上传的路径），使用临时文件路径
        // // 否则使用原始文件路径
        // let audioUrl: string
        // if (tempFilePath) {
        //     // 使用临时文件路径生成签名 URL
        //     audioUrl = await generateSignedUrlService(tempFilePath, {
        //         expires: 7200, // 2 小时有效期（音频转录可能需要较长时间）
        //     })
        //     logger.info(`使用临时文件路径生成签名 URL：tempFilePath=${tempFilePath}`)
        //     logger.info(`临时文件签名 URL：${audioUrl}`)

        //     // 验证 URL 是否可访问（HEAD 请求检查）
        //     try {
        //         const headResponse = await fetch(audioUrl, { method: 'HEAD' })
        //         logger.info(`临时文件 URL 验证成功：status=${headResponse.status}, content-length=${headResponse.headers.get('content-length')}, content-type=${headResponse.headers.get('content-type')}`)
        //     } catch (headError: any) {
        //         logger.error(`临时文件 URL 验证失败：${headError.message}`)
        //     }
        // } else {
        //     // 使用原始文件路径生成签名 URL
        //     audioUrl = await generateSignedUrlService(ossFile.filePath, {
        //         expires: 7200, // 2 小时有效期（音频转录可能需要较长时间）
        //     })
        //     logger.debug(`原始文件签名 URL：${audioUrl}`)
        // }

        // 7. 构建请求参数（使用节点配置中的模型名称）
        const requestBody = {
            model: nodeConfig.modelName,
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
        //
        // 说明：Nuxt/Nitro 的 $fetch 类型在推导 URL + options 时会触发非常深的条件类型，
        // 在某些 TS 版本/配置下会报 “类型实例化过深，且可能无限”。
        // 这里用显式响应类型 + 将 options 断言为 any 来避免深层推导（运行时行为不变）。
        type DashScopeAsrSubmitResponse = {
            request_id?: string
            output?: {
                task_id: string
                task_status: string
            }
            code?: string
            message?: string
        }

        const response = await ofetch<DashScopeAsrSubmitResponse>(
            `${nodeConfig.modelProviderBaseUrl}/services/audio/asr/transcription`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${asrToken}`,
                    'Content-Type': 'application/json',
                    'X-DashScope-Async': 'enable',
                },
                body: requestBody,
            }
        )

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
                // 存储 ossFileId 和 userId，用于识别成功时创建识别记录
                ossFileId,
                userId,
                // 存储临时文件路径，用于识别成功后清理
                tempFilePath: tempFilePath || null,
                // 存储预扣批次 ID，用于识别完成后结算或回滚
                preDeductBatchId,
                // 存储音频时长，用于结算时计算实际消耗
                audioDuration,
            },
            // 标记是否为加密文件
            isEncrypted: !!tempFilePath,
        })

        // 10. 不在提交时创建识别记录，只在识别成功时创建
        // 识别记录将在 completeTranscriptionService 中创建

        logger.info(`ASR 任务提交成功：taskId=${taskId}, ossFileId=${ossFileId}, tempFilePath=${tempFilePath || 'N/A'}`)

        return { success: true, task }
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
 * 
 * 1. 下载原始转录结果 JSON
 * 2. 调用 uploadRawAsrJsonToOssService 上传原始 JSON 到 OSS
 * 3. 调用 simplifyAsrResultService 精简结果
 * 4. 返回精简后的结果用于存入数据库
 * 
 * Requirements: 3.2.3, 3.2.4, 6.3.3
 *
 * @param taskId ASR 任务 ID
 * @param transcriptionUrl 转录结果 URL
 * @param userId 用户 ID（用于上传 OSS 文件记录）
 * @returns 处理结果
 */
export const processTranscriptionResultService = async (
    taskId: string,
    transcriptionUrl: string,
    userId?: number
): Promise<AsrTranscriptionResult> => {
    try {
        // 1. 下载原始转录结果 JSON
        // 使用 ofetch 避免 Nuxt/Nitro $fetch 对路由的深层类型推导（外部 URL 不需要该推导）
        const rawResponse = await ofetch<AsrRawResult>(transcriptionUrl)

        if (!rawResponse) {
            return { success: false, error: '转录结果为空' }
        }

        // 2. 上传原始 JSON 到 OSS（如果提供了 userId）
        // 原始 JSON 上传失败不影响主流程
        let jsonOssFileId: number | undefined
        if (userId) {
            try {
                const uploadResult = await uploadRawAsrJsonToOssService(rawResponse, userId)
                if (uploadResult.success && uploadResult.ossFileId) {
                    jsonOssFileId = uploadResult.ossFileId
                    logger.info(`原始 ASR JSON 上传成功：taskId=${taskId}, ossFileId=${jsonOssFileId}`)
                } else {
                    // 上传失败只记录日志，不影响主流程
                    logger.warn(`原始 ASR JSON 上传失败：taskId=${taskId}, error=${uploadResult.error}`)
                }
            } catch (uploadError) {
                // 上传异常只记录日志，不影响主流程
                logger.warn(`原始 ASR JSON 上传异常：taskId=${taskId}`, uploadError)
            }
        }

        // 3. 调用精简逻辑，移除词级别时间戳
        const simplifiedResult = simplifyAsrResultService(rawResponse)

        // 4. 提取转录文本
        const text = extractTextFromTranscription(simplifiedResult)

        // 5. 提取说话人数量并生成说话人信息
        const speakerCount = extractSpeakerCount(simplifiedResult)
        const speakers = generateSpeakers(speakerCount)

        // 6. 提取音频时长（如果有）
        let duration: number | undefined
        if (rawResponse.properties?.original_duration_in_milliseconds) {
            // 从 properties 中获取原始时长（毫秒转秒）
            duration = Math.ceil(rawResponse.properties.original_duration_in_milliseconds / 1000)
        } else if (rawResponse.duration) {
            duration = Math.ceil(rawResponse.duration / 1000) // 转换为秒
        } else if (rawResponse.audio_duration) {
            duration = Math.ceil(rawResponse.audio_duration)
        }

        return {
            success: true,
            text,
            speakers,
            duration,
            result: simplifiedResult,      // 精简后的结果，存入数据库
            rawResult: rawResponse,        // 原始结果（已上传到 OSS）
            jsonOssFileId,                 // 原始 JSON 的 OSS 文件 ID
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
 * 
 * 将精简后的结果存入数据库，并更新 jsonOssFileId 字段
 * 
 * Requirements: 3.2.4, 3.2.8, 3.2.9, 6.3.3, 6.5.2
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

        // 2. 从 taskRawData 中提取 ossFileId、userId、tempFilePath 和 preDeductBatchId
        const taskRawData = task.taskRawData as Record<string, any> | null
        if (!taskRawData || !taskRawData.ossFileId || !taskRawData.userId) {
            throw new Error('任务数据不完整，缺少 ossFileId 或 userId')
        }

        const ossFileId = taskRawData.ossFileId as number
        const userId = taskRawData.userId as number
        const audioUrl = taskRawData.audioUrl as string
        const tempFilePath = taskRawData.tempFilePath as string | null
        const preDeductBatchId = taskRawData.preDeductBatchId as string | null
        const submittedAudioDuration = taskRawData.audioDuration as number | null

        // 3. 更新任务状态
        await updateAsrTaskService(task.id, {
            status: AsrTaskStatus.SUCCESS,
            result: {
                text: transcriptionResult.text,
                speakers: transcriptionResult.speakers,
                duration: transcriptionResult.duration,
                raw_result: transcriptionResult.result, // 存储精简后的结果
                completed_at: new Date().toISOString(),
            },
        })

        // 4. 创建或更新 ASR 识别记录（只在识别成功时创建）
        let record = await findAsrRecordByOssFileIdDao(ossFileId)
        if (record) {
            // 如果已存在识别记录，更新它
            await updateAsrRecordDao(record.id, {
                status: AsrRecordStatus.SUCCESS,
                audioDuration: transcriptionResult.duration,
                result: transcriptionResult.result,      // 精简后的结果
                jsonOssFileId: transcriptionResult.jsonOssFileId, // 原始 JSON 的 OSS 文件 ID
                speakers: transcriptionResult.speakers,
                asrTasksId: task.id,
                audioUrl,
                tempFilePath: tempFilePath || undefined,
            })
        } else {
            // 如果不存在识别记录，创建新记录（识别成功时才创建）
            record = await createAsrRecordDao({
                userId,
                ossFileId,
                asrTasksId: task.id,
                status: AsrRecordStatus.SUCCESS,
                audioUrl,
                audioDuration: transcriptionResult.duration,
                result: transcriptionResult.result,
                jsonOssFileId: transcriptionResult.jsonOssFileId,
                speakers: transcriptionResult.speakers,
                tempFilePath: tempFilePath || undefined,
            })
        }

        // 5. 结算预扣积分（按实际时长计费）
        // Requirements: 3.2.8, 3.2.9
        if (preDeductBatchId) {
            const actualDurationMinutes = transcriptionResult.duration
                ? Math.ceil(transcriptionResult.duration / 60)
                : (submittedAudioDuration ? Math.ceil(submittedAudioDuration / 60) : 1)

            try {
                await settlePointsService(preDeductBatchId, actualDurationMinutes)
                logger.info(`ASR 转录积分结算成功：userId=${userId}, actualMinutes=${actualDurationMinutes}, batchId=${preDeductBatchId}`)
            } catch (settleError: any) {
                // 结算失败不影响转录结果，但需要记录日志
                // 如果是"预扣批次不存在"错误，回退到直接扣减模式
                if (settleError.message?.includes('预扣批次不存在')) {
                    logger.warn(`预扣批次不存在，回退到直接扣减模式：batchId=${preDeductBatchId}`)
                    try {
                        await consumePointsService(userId, ASR_TRANSCRIBE_ITEM_KEY, actualDurationMinutes, { sourceId: record.id })
                        logger.info(`ASR 转录积分扣减成功（回退模式）：userId=${userId}, minutes=${actualDurationMinutes}`)
                    } catch (pointError) {
                        logger.error('ASR 转录积分扣减失败（回退模式）：', pointError)
                    }
                } else {
                    logger.error('ASR 转录积分结算失败：', settleError)
                    // TODO: 可以考虑创建一个"待支付"记录，让用户充值后补扣积分
                }
            }
        } else {
            // 兼容旧数据：如果没有预扣批次 ID，使用直接扣减
            const durationMinutes = transcriptionResult.duration
                ? Math.ceil(transcriptionResult.duration / 60)
                : 1

            try {
                await consumePointsService(userId, ASR_TRANSCRIBE_ITEM_KEY, durationMinutes, { sourceId: record.id })
                logger.info(`ASR 转录积分扣减成功（兼容模式）：userId=${userId}, minutes=${durationMinutes}`)
            } catch (pointError) {
                logger.error('ASR 转录积分扣减失败（兼容模式）：', pointError)
            }
        }

        // 6. 异步触发向量化嵌入（失败不影响主流程）
        // Requirements: 6.5.2
        triggerAudioEmbeddingAsync(record.id, userId)

        // 6.1 切对应 caseMaterials 状态为 COMPLETED + 异步生成摘要
        // 历史 bug：之前只更新 asrTasks/asrRecords，case_materials.status 永远停在 PENDING/PROCESSING
        await markMaterialsByOssFileIdService(ossFileId, MaterialStatus.COMPLETED)

        // 7. 清理临时文件（加密文件解密后上传的临时文件）
        // Requirements: 6.7.3
        if (tempFilePath) {
            try {
                await deleteFileService(tempFilePath)
                logger.info(`临时音频文件已删除：${tempFilePath}`)
                // 清空记录中的临时文件路径
                await updateAsrRecordDao(record.id, { tempFilePath: null })
            } catch (deleteError) {
                // 删除失败只记录日志，不影响主流程
                logger.warn(`临时音频文件删除失败：${tempFilePath}`, deleteError)
            }
        }

        logger.info(`ASR 转录完成：taskId=${taskId}, jsonOssFileId=${transcriptionResult.jsonOssFileId || 'N/A'}`)
    } catch (error) {
        logger.error('完成转录失败：', error)
        throw error
    }
}

/**
 * 异步触发音频识别结果向量化
 * 
 * 在识别完成后异步调用向量化服务，失败不影响主流程
 * 
 * Requirements: 6.5.2
 * 
 * @param recordId ASR 识别记录 ID
 * @param userId 用户 ID
 */
function triggerAudioEmbeddingAsync(recordId: number, userId: number): void {
    // 使用 Promise 异步执行，不阻塞主流程
    embedAsrRecordService(recordId, userId)
        .then((result) => {
            if (result.success) {
                logger.info(`音频向量化成功：recordId=${recordId}, vectorIds=${result.vectorIds?.length || 0}, chunkCount=${result.chunkCount || 0}`)
            } else {
                // 向量化失败只记录警告日志，不影响主流程
                logger.warn(`音频向量化失败：recordId=${recordId}, error=${result.error}`)
            }
        })
        .catch((error) => {
            // 向量化异常只记录错误日志，不影响主流程
            logger.error(`音频向量化异常：recordId=${recordId}`, error)
        })
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

        // 3. 从 taskRawData 中提取必要信息
        const taskRawData = task.taskRawData as Record<string, any> | null

        // 3.1 切对应 caseMaterials 状态为 FAILED（如果有 ossFileId 关联）
        const failedOssFileId = taskRawData?.ossFileId as number | null
        if (failedOssFileId) {
            await markMaterialsByOssFileIdService(failedOssFileId, MaterialStatus.FAILED)
        }

        // 4. 回滚预扣积分
        // Requirements: 3.2.10
        const preDeductBatchId = taskRawData?.preDeductBatchId as string | null
        if (preDeductBatchId) {
            try {
                await rollbackPreDeductService(preDeductBatchId)
                logger.info(`ASR 转录积分回滚成功：batchId=${preDeductBatchId}`)
            } catch (rollbackError) {
                logger.error('ASR 转录积分回滚失败：', rollbackError)
            }
        }

        // 5. 识别失败时不创建/更新识别记录
        // 识别记录只在识别成功时创建

        // 6. 清理临时文件（加密文件解密后上传的临时文件）
        // Requirements: 6.7.3
        const tempFilePath = taskRawData?.tempFilePath as string | null
        if (tempFilePath) {
            try {
                await deleteFileService(tempFilePath)
                logger.info(`临时音频文件已删除：${tempFilePath}`)
            } catch (deleteError) {
                // 删除失败只记录日志，不影响主流程
                logger.warn(`临时音频文件删除失败：${tempFilePath}`, deleteError)
            }
        }

        // 7. 不扣减积分（已回滚预扣）
        // Requirements: 3.2.10
        logger.info(`ASR 转录失败，积分已回滚：taskId=${taskId}, error=${errorMsg}`)
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

        // 获取 ASR 节点配置（从模型管理获取 API Key）
        let nodeConfig: NodeConfig
        try {
            nodeConfig = await getValidNodeConfig(ASR_NODE_NAME, 'ASR')
        } catch (configError: any) {
            logger.error('轮询任务状态失败：', configError.message)
            return false
        }
        const asrToken = nodeConfig.modelApiKeys[0]!.apiKey

        // 调用阿里云百炼 ASR API 查询状态
        // 同上：避免 $fetch 深层类型推导导致 TS “类型实例化过深” 报错。
        type DashScopeAsrTaskStatusResponse = {
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
        }

        const response = await ofetch<DashScopeAsrTaskStatusResponse>(
            `${nodeConfig.modelProviderBaseUrl}/tasks/${taskId}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${asrToken}`,
                },
            }
        )

        // 记录完整的 API 响应用于调试
        logger.debug(`ASR 任务状态查询响应：taskId=${taskId}, response=${JSON.stringify(response)}`)

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
                    const firstResult = results[0]!
                    if (firstResult.transcription_url) {
                        // 获取关联的 ASR 任务记录，以获取 userId 用于上传原始 JSON
                        const task = await getAsrTaskByTaskIdService(taskId)
                        let userId: number | undefined
                        if (task) {
                            const records = await findAsrRecordsByTaskIdDao(task.id)
                            if (records.length > 0) {
                                userId = records[0]!.userId
                            }
                        }

                        const transcriptionResult = await processTranscriptionResultService(
                            taskId,
                            firstResult.transcription_url,
                            userId  // 传入 userId 用于上传原始 JSON 到 OSS
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
                // 任务失败，提取详细错误信息
                // DashScope API 的错误详情在 output.results 数组中
                let detailedError = response.message || '转录失败'
                if (output.results && output.results.length > 0) {
                    const firstResult = output.results[0] as any
                    if (firstResult.code || firstResult.message) {
                        detailedError = `${firstResult.code || 'ERROR'}: ${firstResult.message || '未知错误'}`
                    }
                }
                logger.error(`ASR 任务失败：taskId=${taskId}, status=${output.task_status}, error=${detailedError}, results=${JSON.stringify(output.results)}`)
                await failTranscriptionService(taskId, detailedError)
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
 * @param audioDuration 音频时长（秒）
 * @param options 转录选项
 * @param tempFilePath 临时文件路径（加密文件解密后上传的路径，可选）
 * @returns 提交结果
 */
export const transcribeAudioService = async (
    ossFileId: number,
    userId: number,
    options?: AsrSubmitOptions,
    tempFilePath?: string
): Promise<AsrSubmitResult> => {
    // 1. 提交任务
    const submitResult = await submitAsrTaskService(ossFileId, userId, options, tempFilePath)

    if (!submitResult.success || !submitResult.task) {
        return submitResult
    }

    // 2. 启动轮询保底机制
    // 排除 existing（已有成功记录的情况不需要轮询）
    if (submitResult.task.taskId && submitResult.task.taskId !== 'existing') {
        startAsrTaskPollingService(submitResult.task.taskId, ASR_POLLING_CONFIG)
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


/** 音频嵌入结果 */
export interface AudioEmbeddingResult {
    /** 是否成功 */
    success: boolean
    /** 生成的向量 ID 列表 */
    vectorIds?: string[]
    /** 最后嵌入时间 */
    lastEmbeddingAt?: string
    /** 分块数量 */
    chunkCount?: number
    /** 错误信息 */
    error?: string
}

/**
 * 从精简后的 ASR 结果中提取格式化文本
 * 
 * 将所有句子转换为带时间戳和说话人信息的格式，用于向量化嵌入
 * 输出格式：[MM:SS-MM:SS]说话人X：文本内容
 * 
 * @param result 精简后的 ASR 识别结果
 * @param speakers 说话人信息列表（可选）
 * @returns 格式化后的文本
 */
export function extractTextFromSimplifiedResult(
    result: SimplifiedAsrResult | Record<string, any>,
    speakers?: Array<{ id: number; name: string }>
): string {
    if (!result || !result.transcripts) {
        return ''
    }

    // 收集所有句子
    const allSentences: Array<{
        text: string
        begin_time: number
        end_time: number
        speaker_id: number
        sentence_id?: number
    }> = []

    for (const transcript of result.transcripts) {
        if (transcript.sentences && Array.isArray(transcript.sentences)) {
            for (const sentence of transcript.sentences) {
                if (sentence.text) {
                    allSentences.push({
                        text: sentence.text,
                        begin_time: sentence.begin_time || 0,
                        end_time: sentence.end_time || 0,
                        speaker_id: sentence.speaker_id ?? 0,
                        sentence_id: sentence.sentence_id,
                    })
                }
            }
        }
    }

    // 使用 formatAsrResultForEmbedding 格式化输出
    return formatAsrResultForEmbedding(allSentences, speakers)
}

/**
 * 音频识别结果向量化嵌入
 * 
 * 将音频识别结果进行向量化嵌入，用于后续的语义检索
 * 
 * 功能：
 * 1. 提取识别文本（从精简后的结果中提取所有句子文本）
 * 2. 调用 materialEmbedding.service.ts 进行向量化
 * 3. 更新 asrRecords 的 vectorIds 和 lastEmbeddingAt 字段
 * 4. 嵌入失败不影响主流程（仅记录日志）
 * 
 * Requirements: 6.5（音频识别向量化嵌入）
 * 
 * @param recordId ASR 识别记录 ID
 * @param userId 用户 ID
 * @param tx 可选的事务客户端
 * @returns 嵌入结果
 */
export const embedAsrRecordService = async (
    recordId: number,
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<AudioEmbeddingResult> => {
    try {
        // 1. 获取 ASR 识别记录
        const record = await findAsrRecordByIdDao(recordId, tx)
        if (!record) {
            return {
                success: false,
                error: 'ASR 识别记录不存在',
            }
        }

        // 2. 检查识别状态
        if (record.status !== AsrRecordStatus.SUCCESS) {
            return {
                success: false,
                error: `ASR 识别记录状态不正确：${record.status}，需要状态为成功(${AsrRecordStatus.SUCCESS})`,
            }
        }

        // 3. 检查是否有识别结果
        const result = record.result as SimplifiedAsrResult | Record<string, any> | null
        if (!result) {
            return {
                success: false,
                error: 'ASR 识别记录没有识别结果',
            }
        }

        // 4. 获取说话人信息
        const speakers = record.speakers as Array<{ id: number; name: string }> | null

        // 5. 提取识别文本（带时间戳和说话人信息）
        const text = extractTextFromSimplifiedResult(result, speakers || undefined)
        if (!text || text.trim().length === 0) {
            logger.warn(`ASR 识别记录 ${recordId} 的识别文本为空，跳过向量化`)
            return {
                success: true,
                vectorIds: [],
                chunkCount: 0,
            }
        }

        // 6. 获取 OSS 文件信息（用于获取文件名）
        const ossFile = await (tx || prisma).ossFiles.findFirst({
            where: { id: record.ossFileId, deletedAt: null },
        })
        const fileName = ossFile?.fileName || `audio_${record.ossFileId}`

        // 7. 调用向量化服务
        const embeddingResult = await embedAudioToVectorStore({
            content: text,
            userId,
            ossFileId: record.ossFileId,
            fileName,
        })

        // 8. 更新 ASR 识别记录的向量信息
        // 注意：summary 字段不在此处写入——已切换语义为"200 字摘要"，由
        // generateMaterialSummaryService 在识别完成后异步生成；
        // 转录正文由 fetchMaterialContents 等读取方从 result JSON 现拼。
        await updateAsrRecordDao(recordId, {
            vectorIds: embeddingResult.ids,
            lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
        }, tx)

        logger.info(`音频识别结果向量化完成：recordId=${recordId}, ossFileId=${record.ossFileId}, chunkCount=${embeddingResult.chunkCount}`)

        return {
            success: true,
            vectorIds: embeddingResult.ids,
            lastEmbeddingAt: embeddingResult.lastEmbeddingAt,
            chunkCount: embeddingResult.chunkCount,
        }
    } catch (error) {
        // 嵌入失败不影响主流程，仅记录日志
        logger.error(`音频识别结果向量化失败：recordId=${recordId}`, error)

        return {
            success: false,
            error: error instanceof Error ? error.message : '向量化失败',
        }
    }
}

/**
 * 从 ASR result JSON 提取纯文本（兼容多种 result 形态）
 *
 * 与 extractTextFromSimplifiedResult 不同：本函数不带说话人/时间戳，纯文本；
 * 用于摘要 LLM 输入和材料正文读取。
 *
 * 兼容两种格式：
 * - 扁平格式: { sentences: [{ text }] }
 * - SimplifiedAsrResult 嵌套格式: { transcripts: [{ sentences: [{ text }] }] }
 *
 * 放在 asr.service.ts 是为了让 material.service.ts 可以直接 import 而不形成
 * material ↔ pipeline 的循环依赖（pipeline 本身已 import material）。
 */
export function extractTextFromAsrResult(result: any): string | null {
    if (!result) return null

    // 扁平格式: { sentences: [...] }
    if (result.sentences && Array.isArray(result.sentences)) {
        const text = result.sentences
            .map((s: any) => s.text || '')
            .filter(Boolean)
            .join('\n')
        if (text) return text
    }

    // SimplifiedAsrResult 嵌套格式: { transcripts: [{ sentences: [...] }] }
    if (result.transcripts && Array.isArray(result.transcripts)) {
        const text = result.transcripts
            .flatMap((t: any) => t.sentences || [])
            .map((s: any) => s.text || '')
            .filter(Boolean)
            .join('\n')
        if (text) return text
    }

    // 兜底：直接取 text 字段
    if (typeof result.text === 'string' && result.text.trim()) {
        return result.text
    }

    return null
}
