/**
 * 案件服务层
 *
 * 提供案件的业务逻辑封装，包括案件创建、获取、更新、会话管理
 * Requirements: 3.1, 3.2, 5.6, 5.7, 8.3, 8.4, 8.5
 */

import type { cases, caseSessions } from '~~/generated/prisma/client'
import { v7 as uuidv7 } from 'uuid'

// 导入 DAO 函数
import {
    createCaseDao,
    createSessionDao,
    findCaseByIdDao,
    findCaseBySessionIdDao,
    findSessionByIdDao,
    findManyCasesDao,
    updateCaseDao,
    updateSessionStatusDao,
    softDeleteCaseDao,
    findLatestSessionByCaseIdDao,
    checkCaseOwnershipDao,
} from './case.dao'
import { CaseStatus, SessionStatus, CaseMaterialType } from '#shared/types/case'

// 导入案件类型服务
import { getCaseTypeByIdService } from './caseType.service'

// 导入案件材料服务
import { batchAddCaseMaterialsService } from './caseMaterial.service'

// 注意：类型和枚举请直接从 './case.dao' 导入
// 避免 Nuxt 自动导入时产生重复警告

/** 创建案件结果 */
export interface CreateCaseResult {
    /** 案件 ID */
    caseId: number
    /** 会话 ID（对应 LangGraph thread_id） */
    sessionId: string
    /** 案件记录 */
    case: cases
    /** 会话记录 */
    session: caseSessions
}

/**
 * 创建案件
 * 同时创建案件记录、会话记录和材料记录，使用事务确保原子性
 * Requirements: 3.1, 7.4
 *
 * @param data 创建数据
 * @returns 创建结果，包含 caseId 和 sessionId
 */
export const createCaseService = async (
    data: CreateCaseInput
): Promise<CreateCaseResult> => {
    // 验证案件类型是否存在且启用
    const caseType = await getCaseTypeByIdService(data.caseTypeId)
    if (!caseType) {
        throw new Error('案件类型不存在')
    }
    if (caseType.status !== 1) {
        throw new Error('案件类型已禁用')
    }

    // 如果未提供标题，生成默认标题
    const title = data.title || `待分析的${caseType.name}`

    // 生成唯一的 sessionId（使用 UUID v7，时间有序）
    const sessionId = uuidv7()

    // 准备材料列表
    const materials = [...(data.materials || [])]

    // 如果提供了 content，将其作为 CASE_CONTENT 类型材料添加到材料列表
    if (data.content && data.content.trim().length > 0) {
        materials.unshift({
            type: CaseMaterialType.CASE_CONTENT,
            name: '案件描述',
            content: data.content,
        })
    }

    // 使用事务创建案件、会话和材料
    const result = await prisma.$transaction(async (tx) => {
        // 创建案件（不再保存 content 到案件表）
        const caseRecord = await createCaseDao({ ...data, title, content: null }, tx as any)

        // 创建会话
        const session = await createSessionDao({
            sessionId,
            caseId: caseRecord.id,
            status: SessionStatus.IN_PROGRESS,
        }, tx as any)

        // 创建材料（包含从 content 转换的材料）
        if (materials.length > 0) {
            await batchAddCaseMaterialsService(
                caseRecord.id,
                data.userId,
                materials,
                tx as any
            )
        }

        return { caseRecord, session }
    })

    // 异步向量化文本材料（fire-and-forget）
    if (materials.length > 0) {
        const { ensureMaterialsEmbeddedService } = await import('../material/materialProcess.service')
        const { getMaterialsByCaseIdService } = await import('../material/material.service')
        const allMaterials = await getMaterialsByCaseIdService(result.caseRecord.id)
        const textMaterialsForEmbedding = allMaterials.filter(m => m.type === CaseMaterialType.CASE_CONTENT)
        if (textMaterialsForEmbedding.length > 0) {
            const vectorizePromise = ensureMaterialsEmbeddedService(textMaterialsForEmbedding, data.userId)
            vectorizePromise.catch(error => {
                logger.error('文本材料向量化失败', {
                    error: error instanceof Error ? error.message : String(error),
                    materialIds: textMaterialsForEmbedding.map(m => m.id),
                    caseId: result.caseRecord.id,
                })
            })
        }
    }

    // 异步保存 AI 提取结果到长期记忆（fire-and-forget）
    if (data.extractedInfo && data.extractedInfo.length > 0) {
        const { saveCaseInfoService } = await import('./caseExtraction.service')
        const enabledCaseTypes = await getEnabledCaseTypesService()
        const confirmedData: import('#shared/types/case').ExtractedCaseInfo = {
            title: data.title || result.caseRecord.title,
            plaintiff: (data.plaintiff ?? []).map(p => p.name),
            defendant: (data.defendant ?? []).map(p => p.name),
            caseType: enabledCaseTypes.find(t => t.id === data.caseTypeId)?.name ?? '',
            summary: data.summary ?? '',
            extraFields: data.extractedInfo,
        }
        saveCaseInfoService(result.caseRecord.id, confirmedData, enabledCaseTypes).catch(error => {
            logger.error('保存提取结果到长期记忆失败', {
                error: error instanceof Error ? error.message : String(error),
                caseId: result.caseRecord.id,
            })
        })
    }

    return {
        caseId: result.caseRecord.id,
        sessionId,
        case: result.caseRecord,
        session: result.session,
    }
}

/**
 * 获取案件详情
 * Requirements: 3.2
 *
 * @param caseId 案件 ID
 * @param includeRelations 是否包含关联数据（案件类型、会话列表）
 * @returns 案件详情或 null
 */
export const getCaseByIdService = async (
    caseId: number,
    includeRelations = true
): Promise<import('./case.dao').CaseWithRelations | null> => {
    return await findCaseByIdDao(caseId, includeRelations)
}

/**
 * 通过会话 ID 获取案件
 *
 * @param sessionId 会话 ID
 * @returns 案件详情或 null
 */
export const getCaseBySessionIdService = async (
    sessionId: string
): Promise<import('./case.dao').CaseWithRelations | null> => {
    return await findCaseBySessionIdDao(sessionId)
}

/**
 * 获取会话详情
 *
 * @param sessionId 会话 ID
 * @returns 会话详情或 null
 */
export const getSessionByIdService = async (
    sessionId: string
): Promise<caseSessions | null> => {
    return await findSessionByIdDao(sessionId)
}

/**
 * 获取用户案件列表
 * Requirements: 9.1
 *
 * @param userId 用户 ID
 * @param options 查询参数
 * @returns 案件列表和总数
 */
export const getUserCasesService = async (
    userId: number,
    options: Omit<CaseListParams, 'userId'> = {}
): Promise<{ list: CaseWithRelations[]; total: number }> => {
    return await findManyCasesDao({ ...options, userId })
}

/**
 * 获取案件列表（管理员用）
 *
 * @param options 查询参数
 * @returns 案件列表和总数
 */
export const getCasesService = async (
    options: CaseListParams = {}
): Promise<{ list: import('./case.dao').CaseWithRelations[]; total: number }> => {
    return await findManyCasesDao(options)
}

/**
 * 更新案件基本信息
 * Requirements: 5.6, 5.7
 *
 * @param caseId 案件 ID
 * @param data 更新数据
 * @returns 更新后的案件
 */
export const updateCaseService = async (
    caseId: number,
    data: UpdateCaseInput
): Promise<cases> => {
    // 检查案件是否存在
    const existing = await findCaseByIdDao(caseId)
    if (!existing) {
        throw new Error('案件不存在')
    }

    // 如果更新案件类型，验证新类型是否存在且启用
    if (data.caseTypeId !== undefined && data.caseTypeId !== existing.caseTypeId) {
        const caseType = await getCaseTypeByIdService(data.caseTypeId)
        if (!caseType) {
            throw new Error('案件类型不存在')
        }
        if (caseType.status !== 1) {
            throw new Error('案件类型已禁用')
        }
    }

    return await updateCaseDao(caseId, data)
}

/**
 * 更新案件状态
 *
 * @param caseId 案件 ID
 * @param status 新状态
 * @returns 更新后的案件
 */
export const updateCaseStatusService = async (
    caseId: number,
    status: CaseStatus
): Promise<cases> => {
    // 检查案件是否存在
    const existing = await findCaseByIdDao(caseId)
    if (!existing) {
        throw new Error('案件不存在')
    }

    return await updateCaseDao(caseId, { status })
}

/**
 * 更新会话状态
 *
 * @param sessionId 会话 ID
 * @param status 新状态
 * @returns 更新后的会话
 */
export const updateSessionStatusService = async (
    sessionId: string,
    status: SessionStatus
): Promise<caseSessions> => {
    // 检查会话是否存在
    const existing = await findSessionByIdDao(sessionId)
    if (!existing) {
        throw new Error('会话不存在')
    }

    return await updateSessionStatusDao(sessionId, status)
}

/**
 * 删除案件（软删除）
 *
 * @param caseId 案件 ID
 */
export const deleteCaseService = async (caseId: number): Promise<void> => {
    // 检查案件是否存在
    const existing = await findCaseByIdDao(caseId)
    if (!existing) {
        throw new Error('案件不存在')
    }

    await softDeleteCaseDao(caseId)
}

/**
 * 获取案件的最新会话
 *
 * @param caseId 案件 ID
 * @returns 最新会话或 null
 */
export const getLatestSessionService = async (
    caseId: number
): Promise<caseSessions | null> => {
    return await findLatestSessionByCaseIdDao(caseId)
}

/**
 * 为案件创建新会话
 * 用于重新开始分析或创建新的分析版本
 *
 * @param caseId 案件 ID
 * @returns 新创建的会话
 */
export const createNewSessionService = async (
    caseId: number
): Promise<caseSessions> => {
    // 检查案件是否存在
    const existing = await findCaseByIdDao(caseId)
    if (!existing) {
        throw new Error('案件不存在')
    }

    // 生成新的 sessionId
    const sessionId = uuidv7()

    // 创建新会话
    const session = await createSessionDao({
        sessionId,
        caseId,
        status: SessionStatus.IN_PROGRESS,
    })

    return session
}

/**
 * 检查用户是否拥有案件
 *
 * @param caseId 案件 ID
 * @param userId 用户 ID
 * @returns 是否拥有
 */
export const checkCaseOwnershipService = async (
    caseId: number,
    userId: number
): Promise<boolean> => {
    return await checkCaseOwnershipDao(caseId, userId)
}

/**
 * 验证用户对案件的访问权限
 * 如果用户无权访问，抛出错误
 *
 * @param caseId 案件 ID
 * @param userId 用户 ID
 */
export const validateCaseAccessService = async (
    caseId: number,
    userId: number
): Promise<void> => {
    const hasAccess = await checkCaseOwnershipDao(caseId, userId)
    if (!hasAccess) {
        throw new Error('无权访问该案件')
    }
}

/**
 * 完成案件分析
 * 将案件状态和会话状态都更新为已完成
 *
 * @param caseId 案件 ID
 * @param sessionId 会话 ID
 */
export const completeCaseAnalysisService = async (
    caseId: number,
    sessionId: string
): Promise<void> => {
    await prisma.$transaction(async (tx) => {
        // 更新案件状态为已完成
        await updateCaseDao(caseId, { status: CaseStatus.CLOSED }, tx as any)

        // 更新会话状态为已完成
        await updateSessionStatusDao(sessionId, SessionStatus.COMPLETED, tx as any)
    })
}

/**
 * 标记会话为中断状态
 * 用于工作流中断时更新会话状态
 *
 * @param sessionId 会话 ID
 */
export const markSessionInterruptedService = async (
    sessionId: string
): Promise<caseSessions> => {
    return await updateSessionStatusDao(sessionId, SessionStatus.INTERRUPTED)
}

/**
 * 标记会话为失败状态
 * 用于工作流执行失败时更新会话状态
 *
 * @param sessionId 会话 ID
 */
export const markSessionFailedService = async (
    sessionId: string
): Promise<caseSessions> => {
    return await updateSessionStatusDao(sessionId, SessionStatus.FAILED)
}

/**
 * 恢复会话为进行中状态
 * 用于从中断或失败状态恢复工作流
 *
 * @param sessionId 会话 ID
 */
export const resumeSessionService = async (
    sessionId: string
): Promise<caseSessions> => {
    // 检查会话是否存在
    const existing = await findSessionByIdDao(sessionId)
    if (!existing) {
        throw new Error('会话不存在')
    }

    // 只有中断或失败状态的会话可以恢复
    if (existing.status !== SessionStatus.INTERRUPTED && existing.status !== SessionStatus.FAILED) {
        throw new Error('只有中断或失败状态的会话可以恢复')
    }

    return await updateSessionStatusDao(sessionId, SessionStatus.IN_PROGRESS)
}
