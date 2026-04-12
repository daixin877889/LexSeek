/**
 * 示范案例服务层
 *
 * 提供示范案例的业务逻辑封装
 * Requirements: 18.7, 18.8, 18.9, 18.10
 */

import type { demoCases } from '~~/generated/prisma/client'
import type { Prisma } from '~~/generated/prisma/client'

// 导入 DAO 函数
import {
    createDemoCaseDao,
    findDemoCaseByIdDao,
    findDemoCaseByTitleDao,
    findManyDemoCasesDao,
    findEnabledDemoCasesDao,
    updateDemoCaseDao,
    softDeleteDemoCaseDao,
} from './demoCase.dao'

// 类型从 DAO 导入使用，不再 re-export 以避免 Nuxt 自动导入冲突
// 外部使用时请直接从 demoCase.dao 导入类型

/**
 * 创建示范案例
 * Requirements: 18.8
 */
export const createDemoCaseService = async (
    data: import('./demoCase.dao').CreateDemoCaseInput
): Promise<demoCases> => {
    // 检查标题是否已存在
    const existing = await findDemoCaseByTitleDao(data.title)
    if (existing) {
        throw new Error('示范案例标题已存在')
    }

    return await createDemoCaseDao(data)
}

/**
 * 获取示范案例详情
 */
export const getDemoCaseByIdService = async (
    id: number
): Promise<demoCases | null> => {
    return await findDemoCaseByIdDao(id)
}

/**
 * 获取示范案例列表（分页，后台管理用）
 * Requirements: 18.7
 */
export const getDemoCasesService = async (
    options: import('./demoCase.dao').DemoCaseListParams = {}
): Promise<{ list: demoCases[]; total: number }> => {
    return await findManyDemoCasesDao(options)
}


/**
 * 获取启用的示范案例列表（前台展示用）
 * Requirements: 18.1, 18.2
 */
export const getEnabledDemoCasesService = async (
    caseTypeId?: number
): Promise<demoCases[]> => {
    return await findEnabledDemoCasesDao(caseTypeId)
}

/**
 * 更新示范案例
 * Requirements: 18.9
 */
export const updateDemoCaseService = async (
    id: number,
    data: import('./demoCase.dao').UpdateDemoCaseInput
): Promise<demoCases> => {
    // 检查案例是否存在
    const existing = await findDemoCaseByIdDao(id)
    if (!existing) {
        throw new Error('示范案例不存在')
    }

    // 如果更新标题，检查标题是否已存在
    if (data.title && data.title !== existing.title) {
        const titleExists = await findDemoCaseByTitleDao(data.title)
        if (titleExists) {
            throw new Error('示范案例标题已存在')
        }
    }

    return await updateDemoCaseDao(id, data)
}

/**
 * 更新示范案例状态
 * Requirements: 18.10
 */
export const updateDemoCaseStatusService = async (
    id: number,
    status: number
): Promise<demoCases> => {
    // 检查案例是否存在
    const existing = await findDemoCaseByIdDao(id)
    if (!existing) {
        throw new Error('示范案例不存在')
    }

    return await updateDemoCaseDao(id, { status })
}

/**
 * 删除示范案例（软删除）
 */
export const deleteDemoCaseService = async (id: number): Promise<void> => {
    // 检查案例是否存在
    const existing = await findDemoCaseByIdDao(id)
    if (!existing) {
        throw new Error('示范案例不存在')
    }

    await softDeleteDemoCaseDao(id)
}

// ==================== cloneRecognitionService ====================

/** 克隆识别记录的输入参数 */
export interface CloneRecognitionInput {
    tx: Prisma.TransactionClient
    sourceUserId: number
    sourceOssFileId: number
    targetUserId: number
    targetOssFileId: number
}

/**
 * 克隆 admin 源文件的识别记录到用户名下（复用 MinerU/OCR/ASR 结果）
 *
 * 只克隆 status=2 的成功记录。last_embedding_at 显式置 NULL：
 * 因为嵌入向量本身不克隆，由分析启动时的 ensureMaterialsReadyService 延迟生成。
 * 若复制源的 last_embedding_at，batchCheckMaterialEmbeddedService 会误判已嵌入。
 *
 * ASR 记录中 asr_tasks_id / json_oss_file_id / temp_file_path 显式置 NULL，
 * 避免跨用户引用 admin 侧的 ASR 任务 / JSON 文件 / 临时文件路径。
 */
export async function cloneRecognitionService(input: CloneRecognitionInput): Promise<void> {
    const { tx, sourceUserId, sourceOssFileId, targetUserId, targetOssFileId } = input

    // 1. 克隆文档识别
    await tx.$executeRawUnsafe(`
        INSERT INTO doc_recognition_records
          (user_id, oss_file_id, status, html_content, markdown_content,
           keywords, summary, vector_ids, last_embedding_at, last_edit_at,
           created_at, updated_at)
        SELECT $1::int, $2::int, status, html_content, markdown_content,
               keywords, summary, '[]'::jsonb, NULL, last_edit_at,
               now(), now()
        FROM doc_recognition_records
        WHERE user_id = $3::int
          AND oss_file_id = $4::int
          AND status = 2
          AND deleted_at IS NULL
    `, targetUserId, targetOssFileId, sourceUserId, sourceOssFileId)

    // 2. 克隆图片识别
    await tx.$executeRawUnsafe(`
        INSERT INTO image_recognition_records
          (user_id, oss_file_id, status, image_type, html_content, markdown_content,
           keywords, summary, vector_ids, last_embedding_at, last_edit_at,
           created_at, updated_at)
        SELECT $1::int, $2::int, status, image_type, html_content, markdown_content,
               keywords, summary, '[]'::jsonb, NULL, last_edit_at,
               now(), now()
        FROM image_recognition_records
        WHERE user_id = $3::int
          AND oss_file_id = $4::int
          AND status = 2
          AND deleted_at IS NULL
    `, targetUserId, targetOssFileId, sourceUserId, sourceOssFileId)

    // 3. 克隆 ASR 识别（跨用户引用字段显式置 NULL）
    await tx.$executeRawUnsafe(`
        INSERT INTO asr_records
          (user_id, oss_file_id, asr_tasks_id, status, audio_url, audio_duration,
           result, json_oss_file_id, temp_file_path, speakers, keywords, summary,
           vector_ids, last_embedding_at, last_edit_at, created_at, updated_at)
        SELECT $1::int, $2::int,
               NULL,
               status, audio_url, audio_duration,
               result,
               NULL,
               NULL,
               speakers, keywords, summary,
               '[]'::jsonb, NULL, last_edit_at, now(), now()
        FROM asr_records
        WHERE user_id = $3::int
          AND oss_file_id = $4::int
          AND status = 2
          AND deleted_at IS NULL
    `, targetUserId, targetOssFileId, sourceUserId, sourceOssFileId)
}

// ==================== ensureSourceFileRecognitionService ====================

import { detectFileTypeService } from '~~/server/services/material/fileDetect.service'
import { createImageConversionService } from '~~/server/services/material/ocr.service'
import { convertPdfService } from '~~/server/services/material/mineru.service'
import { transcribeAudioService } from '~~/server/services/material/asr.service'
import { readTextFileService } from '~~/server/services/material/textReader.service'
import { recognizeDocxService } from '~~/server/services/material/docxRecognition.service'
import { CaseMaterialType } from '#shared/types/case'
import { getExtensionFromFileName } from '~~/shared/utils/file'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'

/**
 * 确保示范案例源文件已经被识别过一次（admin save 阶段的引导）
 *
 * 若三张识别表中任一已有记录（无论状态），直接 return；
 * 否则按文件类型分发到对应识别服务触发。
 * 触发失败仅记 warn 日志，不抛错（demoCase 保存不应因识别故障而失败）。
 */
export async function ensureSourceFileRecognitionService(sourceOssFileId: number): Promise<void> {
    const source = await findOssFileByIdDao(sourceOssFileId)
    if (!source || source.deletedAt) {
        throw new Error(`sourceOssFileId=${sourceOssFileId} 不存在或已删除`)
    }

    const [doc, image, asr] = await Promise.all([
        prisma.docRecognitionRecords.findFirst({
            where: { ossFileId: sourceOssFileId, deletedAt: null },
            select: { id: true },
        }),
        prisma.imageRecognitionRecords.findFirst({
            where: { ossFileId: sourceOssFileId, deletedAt: null },
            select: { id: true },
        }),
        prisma.asrRecords.findFirst({
            where: { ossFileId: sourceOssFileId, deletedAt: null },
            select: { id: true },
        }),
    ])

    if (doc || image || asr) {
        return
    }

    const ext = getExtensionFromFileName(source.fileName) || ''
    const fileType = detectFileTypeService(source.fileName)

    try {
        switch (fileType) {
            case CaseMaterialType.IMAGE:
                await createImageConversionService(sourceOssFileId, source.userId)
                break
            case CaseMaterialType.AUDIO:
                await transcribeAudioService(sourceOssFileId, source.userId)
                break
            case CaseMaterialType.DOCUMENT:
                if (ext === 'md' || ext === 'txt') {
                    await readTextFileService(sourceOssFileId, source.userId)
                } else if (ext === 'docx') {
                    await recognizeDocxService(sourceOssFileId, source.userId)
                } else {
                    await convertPdfService(sourceOssFileId, source.userId)
                }
                break
            default:
                await convertPdfService(sourceOssFileId, source.userId)
        }
    } catch (err) {
        logger.warn('ensureSourceFileRecognitionService 触发失败', {
            sourceOssFileId,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}
