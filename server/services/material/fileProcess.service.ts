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
        Promise.resolve([]), // textRecords 本阶段不需要
    ])

    // 3. 逐个处理
    const results: FileProcessContext[] = []
    for (const ossFileId of ossFileIds) {
        const ossFile = fileMap.get(ossFileId)
        if (!ossFile) {
            results.push({
                ossFileId,
                name: `file_${ossFileId}`,
                fileType: 'unknown',
                materialType: CaseMaterialType.DOCUMENT,
                recognitionStatus: 'failed',
                error: '文件不存在',
            })
            continue
        }

        const materialType = getMaterialTypeFromMime(ossFile.fileType)
        const existingContent = findExistingContent(ossFileId, materialType, docRecords, imgRecords, asrRecords)

        if (existingContent) {
            results.push({
                ossFileId,
                name: ossFile.fileName,
                fileType: ossFile.fileType ?? 'unknown',
                materialType,
                recognitionStatus: 'success',
                content: existingContent,
            })
            continue
        }

        try {
            const content = await recognizeFile(ossFileId, materialType, userId)
            results.push({
                ossFileId,
                name: ossFile.fileName,
                fileType: ossFile.fileType ?? 'unknown',
                materialType,
                recognitionStatus: 'success',
                content,
            })
        } catch (err: any) {
            results.push({
                ossFileId,
                name: ossFile.fileName,
                fileType: ossFile.fileType ?? 'unknown',
                materialType,
                recognitionStatus: 'failed',
                error: err.message,
            })
        }
    }

    // 4. 记录成功文件（嵌入将由案件创建后的流程处理）
    const succeeded = results.filter(r => r.recognitionStatus === 'success' && r.content)
    if (succeeded.length > 0) {
        logger.info('文件识别完成，嵌入将由案件创建后的流程处理', {
            ossFileIds: succeeded.map(f => f.ossFileId),
        })
    }

    return results
}

/** 查找已有识别内容 */
function findExistingContent(
    ossFileId: number,
    materialType: CaseMaterialType,
    docRecords: any[],
    imgRecords: any[],
    asrRecords: any[],
): string | null {
    switch (materialType) {
        case CaseMaterialType.DOCUMENT: {
            const r = docRecords.find(r => r.ossFileId === ossFileId && r.status === 2)
            return r?.markdownContent ?? null
        }
        case CaseMaterialType.IMAGE: {
            const r = imgRecords.find(r => r.ossFileId === ossFileId && r.status === 2)
            return r?.markdownContent ?? null
        }
        case CaseMaterialType.AUDIO: {
            const r = asrRecords.find(r => r.ossFileId === ossFileId && r.status === 2)
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
    const MAX_WAIT_MS = 5 * 60 * 1000
    const INTERVAL_MS = type === 'doc' ? 5000 : 3000
    const startTime = Date.now()

    while (Date.now() - startTime < MAX_WAIT_MS) {
        await new Promise(resolve => setTimeout(resolve, INTERVAL_MS))

        if (type === 'doc') {
            const record = await getDocRecognitionByOssFileIdService(ossFileId)
            if (record?.markdownContent) return record.markdownContent
        } else {
            const record = await prisma.asrRecords.findFirst({
                where: { ossFileId, status: 2, deletedAt: null },
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
            // 内部已启动后台轮询，等待 DB 状态变化
            if (result.task?.taskId && result.task.taskId !== 'existing') {
                return await waitForRecognitionComplete('audio', ossFileId)
            }
            // 兜底直接查 DB
            const record = await prisma.asrRecords.findFirst({
                where: { ossFileId, status: 2, deletedAt: null },
                select: { summary: true, result: true },
            })
            const content = record?.summary || extractTextFromAsrResult(record?.result)
            if (content) return content
            throw new Error('音频识别结果为空')
        }
        default: {
            // 文档类型（PDF、Word 等）
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
