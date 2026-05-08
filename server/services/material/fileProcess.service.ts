/**
 * 文件粒度识别服务（提取阶段专用，不关联案件）
 *
 * 在 AI 信息提取前确保所有上传文件已完成识别。
 * 与 materialProcess.service.ts 不同，此服务不关联案件，直接通过 ossFileId 操作。
 */

import { CaseMaterialType, getMaterialTypeFromMime } from '#shared/types/case'
import { extractTextFromAsrResult } from './materialPipeline.service'
import { createImageConversionService } from './ocr.service'
import { convertPdfService, getDocRecognitionByOssFileIdService } from './mineru.service'
import { transcribeAudioService } from './asr.service'
import type { asrRecords, ossFiles } from '~~/generated/prisma/client'

/** 识别完成状态码（对应 DB 中 status=2） */
const RECOGNITION_STATUS_COMPLETED = 2

/** 识别等待超时（毫秒） */
const MAX_RECOGNITION_WAIT_MS = 5 * 60 * 1000
/** 文档识别轮询间隔（毫秒） */
const DOC_POLL_INTERVAL_MS = 5000
/** 音频识别轮询间隔（毫秒） */
const AUDIO_POLL_INTERVAL_MS = 3000

/** 识别记录的通用形状 */
interface RecognitionRecord {
    ossFileId: number
    status: number
    markdownContent?: string | null
}

/** ASR 识别记录形状 */
interface AsrRecord {
    ossFileId: number
    status: number
    summary: string | null
    result: any
}

/** 文件处理上下文（提取阶段的材料容器，不关联案件） */
export interface FileProcessContext {
    ossFileId: number
    name: string
    /** 文件 MIME 类型 */
    fileType: string
    /** 材料类型 */
    materialType: CaseMaterialType
    /** 识别状态 */
    recognitionStatus: 'idle' | 'processing' | 'success' | 'failed'
    /** 识别内容 */
    content?: string
    /** 错误信息 */
    error?: string
}

/**
 * 处理 OSS 文件的识别（不关联案件）
 *
 * @param ossFileIds OSS 文件 ID 列表
 * @param userId 当前用户 ID
 * @returns 每个文件的处理结果
 */
export async function processFileMaterials(
    ossFileIds: number[],
    userId: number,
): Promise<FileProcessContext[]> {
    // 1. 批量查询 OSS 文件信息
    const ossFiles = await prisma.ossFiles.findMany({
        where: { id: { in: ossFileIds }, deletedAt: null },
        select: { id: true, fileName: true, fileType: true, filePath: true },
    })
    const fileMap = new Map(ossFiles.map(f => [f.id, f]))

    // 2. 批量查询已识别的记录
    const [docRecords, imgRecords, asrRecords] = await Promise.all([
        prisma.docRecognitionRecords.findMany({
            where: { ossFileId: { in: ossFileIds }, deletedAt: null },
            select: { ossFileId: true, status: true, markdownContent: true },
        }),
        prisma.imageRecognitionRecords.findMany({
            where: { ossFileId: { in: ossFileIds }, deletedAt: null },
            select: { ossFileId: true, status: true, markdownContent: true },
        }),
        prisma.asrRecords.findMany({
            where: { ossFileId: { in: ossFileIds }, deletedAt: null },
            select: { ossFileId: true, status: true, summary: true, result: true },
        }),
    ])

    // 构建 Map 加速查找（O(1) 替代 O(n) 线性扫描）
    const docMap = buildRecordMap(docRecords)
    const imgMap = buildRecordMap(imgRecords)
    const asrMap = new Map(asrRecords.filter(r => r.status === RECOGNITION_STATUS_COMPLETED).map(r => [r.ossFileId, r]))

    // 3. 并行处理所有文件
    const results = await Promise.allSettled(
        ossFileIds.map(ossFileId => processOneFile(ossFileId, fileMap, docMap, imgMap, asrMap, userId)),
    )

    const fileContexts: FileProcessContext[] = results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : {
            ossFileId: ossFileIds[i]!,
            name: `file_${ossFileIds[i]}`,
            fileType: 'unknown',
            materialType: CaseMaterialType.DOCUMENT,
            recognitionStatus: 'failed' as const,
            error: (r.reason as Error)?.message ?? '未知错误',
        },
    )

    // 4. 记录成功文件（嵌入将由案件创建后的流程处理）
    const succeeded = fileContexts.filter(r => r.recognitionStatus === 'success' && r.content)
    if (succeeded.length > 0) {
        logger.info('文件识别完成，嵌入将由案件创建后的流程处理', {
            ossFileIds: succeeded.map(f => f.ossFileId),
        })
    }

    return fileContexts
}

/** 构建识别记录的 ossFileId → record Map（仅保留已完成的） */
function buildRecordMap(records: RecognitionRecord[]): Map<number, RecognitionRecord> {
    return new Map(
        records.filter(r => r.status === RECOGNITION_STATUS_COMPLETED).map(r => [r.ossFileId, r]),
    )
}

/** 处理单个文件 */
async function processOneFile(
    ossFileId: number,
    fileMap: Map<number, { id: number; fileName: string; fileType: string | null; filePath: string | null }>,
    docMap: Map<number, RecognitionRecord>,
    imgMap: Map<number, RecognitionRecord>,
    asrMap: Map<number, AsrRecord>,
    userId: number,
): Promise<FileProcessContext> {
    const ossFile = fileMap.get(ossFileId)
    if (!ossFile) {
        return {
            ossFileId,
            name: `file_${ossFileId}`,
            fileType: 'unknown',
            materialType: CaseMaterialType.DOCUMENT,
            recognitionStatus: 'failed',
            error: '文件不存在',
        }
    }

    const materialType = getMaterialTypeFromMime(ossFile.fileType)
    const base = {
        ossFileId,
        name: ossFile.fileName,
        fileType: ossFile.fileType ?? 'unknown',
        materialType,
    }

    const existingContent = findExistingContent(ossFileId, materialType, docMap, imgMap, asrMap)
    if (existingContent) {
        return { ...base, recognitionStatus: 'success', content: existingContent }
    }

    try {
        const content = await recognizeFile(ossFileId, materialType, userId)
        return { ...base, recognitionStatus: 'success', content }
    } catch (err: any) {
        return { ...base, recognitionStatus: 'failed', error: err.message }
    }
}

/** 查找已有识别内容（通过 Map O(1) 查找） */
function findExistingContent(
    ossFileId: number,
    materialType: CaseMaterialType,
    docMap: Map<number, RecognitionRecord>,
    imgMap: Map<number, RecognitionRecord>,
    asrMap: Map<number, AsrRecord>,
): string | null {
    switch (materialType) {
        case CaseMaterialType.DOCUMENT:
            return docMap.get(ossFileId)?.markdownContent ?? null
        case CaseMaterialType.IMAGE:
            return imgMap.get(ossFileId)?.markdownContent ?? null
        case CaseMaterialType.AUDIO: {
            const r = asrMap.get(ossFileId)
            return r?.summary ?? extractTextFromAsrResult(r?.result) ?? null
        }
        default:
            return null
    }
}

/**
 * 统一等待识别完成（不重复启动轮询）
 *
 * 底层服务已内置后台轮询：
 * - convertPdfService → startTaskPollingService
 * - transcribeAudioService → startAsrTaskPollingService
 *
 * 当前函数仅轮询 DB 状态等待结果写入。
 */
async function waitForRecognitionComplete(
    type: 'doc' | 'audio',
    ossFileId: number,
): Promise<string> {
    const intervalMs = type === 'doc' ? DOC_POLL_INTERVAL_MS : AUDIO_POLL_INTERVAL_MS
    const startTime = Date.now()

    while (Date.now() - startTime < MAX_RECOGNITION_WAIT_MS) {
        await new Promise(resolve => setTimeout(resolve, intervalMs))

        if (type === 'doc') {
            const record = await getDocRecognitionByOssFileIdService(ossFileId)
            if (record?.markdownContent) return record.markdownContent
        } else {
            const record = await prisma.asrRecords.findFirst({
                where: { ossFileId, status: RECOGNITION_STATUS_COMPLETED, deletedAt: null },
                select: { summary: true, result: true },
            })
            if (record) {
                const content = record.summary || extractTextFromAsrResult(record.result)
                if (content) return content
            }
        }
    }

    throw new Error(`${type === 'doc' ? '文档' : '音频'}识别超时`)
}

/**
 * 触发文件识别
 * - 图片：同步处理，直接返回结果
 * - 文档/音频：异步处理，提交后等待 DB 状态变化
 */
async function recognizeFile(
    ossFileId: number,
    materialType: CaseMaterialType,
    userId: number,
): Promise<string> {
    switch (materialType) {
        case CaseMaterialType.IMAGE: {
            const result = await createImageConversionService(ossFileId, userId)
            if (!result.success) throw new Error(result.error || '图片识别失败')
            return result.record?.markdownContent ?? ''
        }
        case CaseMaterialType.AUDIO: {
            const result = await transcribeAudioService(ossFileId, userId)
            if (!result.success) throw new Error(result.error || '音频识别失败')
            if (result.task?.taskId && result.task.taskId !== 'existing') {
                return await waitForRecognitionComplete('audio', ossFileId)
            }
            const record = await prisma.asrRecords.findFirst({
                where: { ossFileId, status: RECOGNITION_STATUS_COMPLETED, deletedAt: null },
                select: { summary: true, result: true },
            })
            const content = record?.summary || extractTextFromAsrResult(record?.result)
            if (content) return content
            throw new Error('音频识别结果为空')
        }
        default: {
            const result = await convertPdfService(ossFileId, userId)
            if (!result.success) throw new Error(result.error || '文档识别失败')
            if (result.task?.taskId && result.task.taskId !== 'existing') {
                return await waitForRecognitionComplete('doc', ossFileId)
            }
            const record = await getDocRecognitionByOssFileIdService(ossFileId)
            if (record?.markdownContent) return record.markdownContent
            throw new Error('文档识别结果为空')
        }
    }
}
