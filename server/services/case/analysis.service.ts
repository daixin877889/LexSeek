/**
 * 案件分析结果服务层
 *
 * 提供分析结果的业务逻辑封装，包括分析结果保存、版本管理、历史查询
 * Requirements: 8.1, 8.2, 9.6, 9.7
 */

import type { caseAnalyses } from '~~/generated/prisma/client'

// 导入 DAO 函数
import {
    createAnalysisDao,
    findAnalysisByIdDao,
    findManyAnalysesDao,
    findAnalysesBySessionIdDao,
    findAnalysisVersionsDao,
    findLatestAnalysisVersionDao,
    findAnalysisBySessionAndNodeDao,
    getNextVersionDao,
    updateAnalysisDao,
    softDeleteAnalysisDao,
    softDeleteAnalysesBySessionDao,
    countAnalysesByCaseIdDao,
    deactivateVersionsDao,
    activateVersionDao,
    findActiveAnalysisVersionDao,
    findStaleInProgressAnalysesDao,
    batchUpdateAnalysisStatusDao,
    AnalysisStatus,
} from './analysis.dao'

// 导入案件服务
import { getCaseByIdService, getSessionByIdService } from './case.service'
import { isCaseReadOnly } from '#shared/types/case'

// 注意：类型和枚举请直接从 './analysis.dao' 导入
// 避免 Nuxt 自动导入时产生重复警告

/** 保存分析结果输入 */
export interface SaveAnalysisInput {
    /** 案件 ID */
    caseId: number
    /** 会话 ID */
    sessionId: string
    /** 节点 ID */
    nodeId: number
    /** 分析类型（节点名称） */
    analysisType: string
    /** 分析结果（Markdown 格式） */
    analysisResult: string
    /** 还原后的结果（解密后的内容，可选） */
    originalResult?: string | null
    /** 消耗的千 token 数（积分扣减单位） */
    tokenCount?: number | null
    /** 实际 token 总数 */
    tokens?: number | null
}

/** 分析历史项 */
export interface AnalysisHistoryItem {
    /** 节点 ID */
    nodeId: number
    /** 节点名称 */
    nodeName: string
    /** 节点标题 */
    nodeTitle: string | null
    /** 节点类型 */
    nodeType: string
    /** 版本列表 */
    versions: {
        /** 分析结果 ID */
        id: number
        /** 版本号 */
        version: number
        /** 会话 ID */
        sessionId: string
        /** 分析状态 */
        status: number
        /** 创建时间 */
        createdAt: Date
    }[]
}

/**
 * 保存分析结果
 * 如果是新的分析，创建记录；如果是重新生成，创建新版本
 * Requirements: 8.1, 8.2
 *
 * @param data 保存数据
 * @returns 保存的分析结果
 */
export const saveAnalysisResultService = async (
    data: SaveAnalysisInput
): Promise<caseAnalyses> => {
    // 验证案件是否存在
    const caseRecord = await getCaseByIdService(data.caseId, false)
    if (!caseRecord) {
        throw new Error('案件不存在')
    }

    // 验证会话是否存在
    const session = await getSessionByIdService(data.sessionId)
    if (!session) {
        throw new Error('会话不存在')
    }

    // 获取下一个版本号
    const nextVersion = await getNextVersionDao(data.caseId, data.nodeId)

    // 创建分析结果
    const analysis = await createAnalysisDao({
        caseId: data.caseId,
        sessionId: data.sessionId,
        nodeId: data.nodeId,
        analysisType: data.analysisType,
        analysisResult: data.analysisResult,
        originalResult: data.originalResult ?? null,
        version: nextVersion,
        status: AnalysisStatus.COMPLETED,
    })

    return analysis
}

/**
 * 保存分析结果并在同一事务内激活版本
 * 用于模块对话 Agent 的 save_analysis_result 工具
 *
 * @param data 保存数据
 * @returns 保存的分析结果（已激活）
 */
export const saveAndActivateAnalysisService = async (
    data: SaveAnalysisInput,
): Promise<caseAnalyses> => {
    return await prisma.$transaction(async (tx) => {
        // 获取下一个版本号
        const version = await getNextVersionDao(data.caseId, data.nodeId, tx)

        // 创建新版本记录
        const analysis = await createAnalysisDao(
            {
                caseId: data.caseId,
                sessionId: data.sessionId,
                nodeId: data.nodeId,
                analysisType: data.analysisType,
                analysisResult: data.analysisResult,
                originalResult: data.originalResult ?? null,
                version,
                status: AnalysisStatus.COMPLETED,
                tokenCount: data.tokenCount ?? null,
                tokens: data.tokens ?? null,
            },
            tx,
        )

        // 在同一事务内激活新版本
        await activateVersionDao(analysis.id, data.caseId, data.nodeId, tx)

        return analysis
    })
}

/**
 * 开始分析（创建进行中状态的记录）
 * 用于在分析开始时创建记录，后续更新结果
 *
 * @param data 创建数据
 * @returns 创建的分析结果
 */
export const startAnalysisService = async (
    data: Omit<SaveAnalysisInput, 'analysisResult' | 'originalResult'>
): Promise<caseAnalyses> => {
    // 验证案件是否存在
    const caseRecord = await getCaseByIdService(data.caseId, false)
    if (!caseRecord) {
        throw new Error('案件不存在')
    }

    // ARCHIVED 只读守卫（spec §1.4 / §12 铁律）
    if (isCaseReadOnly(caseRecord.status)) {
        throw new Error('案件已归档，无法启动分析')
    }

    // 验证会话是否存在
    const session = await getSessionByIdService(data.sessionId)
    if (!session) {
        throw new Error('会话不存在')
    }

    // 检查是否已存在该会话和节点的分析记录
    const existing = await findAnalysisBySessionAndNodeDao(data.sessionId, data.nodeId)
    if (existing) {
        // 如果已存在，返回现有记录
        return existing
    }

    // 获取下一个版本号
    const nextVersion = await getNextVersionDao(data.caseId, data.nodeId)

    // 创建进行中状态的分析结果
    const analysis = await createAnalysisDao({
        caseId: data.caseId,
        sessionId: data.sessionId,
        nodeId: data.nodeId,
        analysisType: data.analysisType,
        version: nextVersion,
        status: AnalysisStatus.IN_PROGRESS,
    })

    return analysis
}

/**
 * 完成分析（更新分析结果和状态）
 *
 * @param analysisId 分析结果 ID
 * @param result 分析结果
 * @param originalResult 还原后的结果（可选）
 * @returns 更新后的分析结果
 */
export const completeAnalysisService = async (
    analysisId: number,
    result: string,
    originalResult?: string | null
): Promise<caseAnalyses> => {
    // 检查分析记录是否存在
    const existing = await findAnalysisByIdDao(analysisId)
    if (!existing) {
        throw new Error('分析记录不存在')
    }

    // 更新分析结果和状态
    const analysis = await updateAnalysisDao(analysisId, {
        analysisResult: result,
        originalResult: originalResult ?? null,
        status: AnalysisStatus.COMPLETED,
    })

    return analysis
}

/**
 * 标记分析失败
 *
 * @param analysisId 分析结果 ID
 * @returns 更新后的分析结果
 */
export const failAnalysisService = async (
    analysisId: number
): Promise<caseAnalyses> => {
    // 检查分析记录是否存在
    const existing = await findAnalysisByIdDao(analysisId)
    if (!existing) {
        throw new Error('分析记录不存在')
    }

    // 更新状态为失败
    const analysis = await updateAnalysisDao(analysisId, {
        status: AnalysisStatus.FAILED,
    })

    return analysis
}

/**
 * 获取分析结果详情
 *
 * @param analysisId 分析结果 ID
 * @param includeRelations 是否包含关联数据
 * @returns 分析结果详情或 null
 */
export const getAnalysisByIdService = async (
    analysisId: number,
    includeRelations = true
): Promise<import('./analysis.dao').AnalysisWithRelations | null> => {
    return await findAnalysisByIdDao(analysisId, includeRelations)
}

/**
 * 获取会话的所有分析结果
 * Requirements: 8.1
 *
 * @param sessionId 会话 ID
 * @returns 分析结果列表
 */
export const getSessionAnalysesService = async (
    sessionId: string
): Promise<import('./analysis.dao').AnalysisWithRelations[]> => {
    return await findAnalysesBySessionIdDao(sessionId)
}

/**
 * 获取案件某个节点的所有版本
 * Requirements: 9.6, 9.7
 *
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @returns 分析结果版本列表
 */
export const getAnalysisVersionsService = async (
    caseId: number,
    nodeId: number
): Promise<caseAnalyses[]> => {
    return await findAnalysisVersionsDao(caseId, nodeId)
}

/**
 * 获取案件某个节点的最新版本
 *
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @returns 最新版本的分析结果或 null
 */
export const getLatestAnalysisVersionService = async (
    caseId: number,
    nodeId: number
): Promise<caseAnalyses | null> => {
    return await findLatestAnalysisVersionDao(caseId, nodeId)
}

/**
 * 获取案件的分析历史
 * 按节点分组，每个节点包含所有版本
 * Requirements: 9.6, 9.7
 *
 * @param caseId 案件 ID
 * @returns 分析历史列表
 */
export const getCaseAnalysisHistoryService = async (
    caseId: number
): Promise<AnalysisHistoryItem[]> => {
    // 验证案件是否存在
    const caseRecord = await getCaseByIdService(caseId, false)
    if (!caseRecord) {
        throw new Error('案件不存在')
    }

    // 获取案件的所有分析结果（包含节点信息）
    const { list: analyses } = await findManyAnalysesDao({
        caseId,
        pageSize: 1000, // 获取所有记录
        orderBy: 'createdAt',
        orderDir: 'desc',
    })

    // 按节点分组
    const historyMap = new Map<number, AnalysisHistoryItem>()

    for (const analysis of analyses) {
        const nodeId = analysis.nodeId
        let historyItem = historyMap.get(nodeId)

        if (!historyItem && analysis.node) {
            historyItem = {
                nodeId,
                nodeName: analysis.node.name,
                nodeTitle: analysis.node.title,
                nodeType: analysis.node.type,
                versions: [],
            }
            historyMap.set(nodeId, historyItem)
        }

        if (historyItem) {
            historyItem.versions.push({
                id: analysis.id,
                version: analysis.version,
                sessionId: analysis.sessionId,
                status: analysis.status,
                createdAt: analysis.createdAt,
            })
        }
    }

    // 转换为数组并按节点 ID 排序
    return Array.from(historyMap.values()).sort((a, b) => a.nodeId - b.nodeId)
}

/**
 * 获取分析结果列表（分页）
 *
 * @param options 查询参数
 * @returns 分析结果列表和总数
 */
export const getAnalysesService = async (
    options: import('./analysis.dao').AnalysisListParams = {}
): Promise<{ list: import('./analysis.dao').AnalysisWithRelations[]; total: number }> => {
    return await findManyAnalysesDao(options)
}

/**
 * 更新分析结果内容
 * Requirements: 8.2
 *
 * @param analysisId 分析结果 ID
 * @param result 新的分析结果
 * @param originalResult 还原后的结果（可选）
 * @returns 更新后的分析结果
 */
export const updateAnalysisResultService = async (
    analysisId: number,
    result: string,
    originalResult?: string | null
): Promise<caseAnalyses> => {
    // 检查分析记录是否存在
    const existing = await findAnalysisByIdDao(analysisId)
    if (!existing) {
        throw new Error('分析记录不存在')
    }

    // 更新分析结果
    const analysis = await updateAnalysisDao(analysisId, {
        analysisResult: result,
        originalResult: originalResult ?? null,
    })

    return analysis
}

/**
 * 删除分析结果（软删除）
 *
 * @param analysisId 分析结果 ID
 */
export const deleteAnalysisService = async (analysisId: number): Promise<void> => {
    const existing = await findAnalysisByIdDao(analysisId)
    if (!existing) {
        throw new Error('分析记录不存在')
    }

    const wasActive = existing.isActive

    // 软删除时同时重置 isActive
    if (wasActive) {
        await updateAnalysisDao(analysisId, { isActive: false })
    }
    await softDeleteAnalysisDao(analysisId)

    // 如果删除的是激活版本，自动转移到次新 COMPLETED 版本
    if (wasActive) {
        const nextActive = await prisma.caseAnalyses.findFirst({
            where: {
                caseId: existing.caseId,
                nodeId: existing.nodeId,
                status: AnalysisStatus.COMPLETED,
                deletedAt: null,
            },
            orderBy: { version: 'desc' },
        })
        if (nextActive) {
            await updateAnalysisDao(nextActive.id, { isActive: true })
        }
    }
}

/**
 * 删除会话的所有分析结果（软删除）
 *
 * @param sessionId 会话 ID
 */
export const deleteSessionAnalysesService = async (sessionId: string): Promise<void> => {
    await softDeleteAnalysesBySessionDao(sessionId)
}

/**
 * 统计案件的分析结果数量
 *
 * @param caseId 案件 ID
 * @param status 状态筛选（可选）
 * @returns 分析结果数量
 */
export const countCaseAnalysesService = async (
    caseId: number,
    status?: number
): Promise<number> => {
    return await countAnalysesByCaseIdDao(caseId, status)
}

/**
 * 检查会话中某个节点是否已有分析结果
 *
 * @param sessionId 会话 ID
 * @param nodeId 节点 ID
 * @returns 是否存在分析结果
 */
export const hasAnalysisForNodeService = async (
    sessionId: string,
    nodeId: number
): Promise<boolean> => {
    const analysis = await findAnalysisBySessionAndNodeDao(sessionId, nodeId)
    return analysis !== null
}

/**
 * 获取会话中某个节点的分析结果
 *
 * @param sessionId 会话 ID
 * @param nodeId 节点 ID
 * @returns 分析结果或 null
 */
export const getAnalysisBySessionAndNodeService = async (
    sessionId: string,
    nodeId: number
): Promise<caseAnalyses | null> => {
    return await findAnalysisBySessionAndNodeDao(sessionId, nodeId)
}

/**
 * 重新生成分析结果
 * 创建新版本的分析记录
 * Requirements: 8.3, 8.4, 8.5
 *
 * @param caseId 案件 ID
 * @param sessionId 会话 ID
 * @param nodeId 节点 ID
 * @param analysisType 分析类型
 * @returns 新创建的分析记录（进行中状态）
 */
export const regenerateAnalysisService = async (
    caseId: number,
    sessionId: string,
    nodeId: number,
    analysisType: string
): Promise<caseAnalyses> => {
    // 验证案件是否存在
    const caseRecord = await getCaseByIdService(caseId, false)
    if (!caseRecord) {
        throw new Error('案件不存在')
    }

    // 验证会话是否存在
    const session = await getSessionByIdService(sessionId)
    if (!session) {
        throw new Error('会话不存在')
    }

    // 获取下一个版本号
    const nextVersion = await getNextVersionDao(caseId, nodeId)

    // 创建新版本的分析记录
    const analysis = await createAnalysisDao({
        caseId,
        sessionId,
        nodeId,
        analysisType,
        version: nextVersion,
        status: AnalysisStatus.IN_PROGRESS,
    })

    return analysis
}

/**
 * 追加分析结果内容（用于流式输出）
 * 将新内容追加到现有结果后面
 *
 * @param analysisId 分析结果 ID
 * @param content 要追加的内容
 * @returns 更新后的分析结果
 */
export const appendAnalysisResultService = async (
    analysisId: number,
    content: string
): Promise<caseAnalyses> => {
    // 检查分析记录是否存在
    const existing = await findAnalysisByIdDao(analysisId)
    if (!existing) {
        throw new Error('分析记录不存在')
    }

    // 追加内容
    const newResult = (existing.analysisResult || '') + content

    // 更新分析结果
    const analysis = await updateAnalysisDao(analysisId, {
        analysisResult: newResult,
    })

    return analysis
}

/**
 * 切换激活版本
 * 验证记录存在且 status = COMPLETED，事务内切换 isActive
 *
 * @param analysisId 分析结果 ID
 * @returns 更新后的分析结果
 */
export const switchActiveVersionService = async (
    analysisId: number
): Promise<caseAnalyses> => {
    const existing = await findAnalysisByIdDao(analysisId)
    if (!existing) {
        throw new Error('分析记录不存在')
    }
    if (existing.status !== AnalysisStatus.COMPLETED) {
        throw new Error('只能激活已完成的分析记录')
    }
    await activateVersionDao(analysisId, existing.caseId, existing.nodeId)
    const updated = await findAnalysisByIdDao(analysisId)
    return updated!
}

/**
 * 获取指定案件节点的激活版本
 *
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @returns 激活的分析结果或 null
 */
export const getActiveAnalysisVersionService = async (
    caseId: number,
    nodeId: number
): Promise<caseAnalyses | null> => {
    return await findActiveAnalysisVersionDao(caseId, nodeId)
}

/**
 * 清理超时的 IN_PROGRESS 分析记录
 *
 * 作为进程崩溃导致任务丢失的兜底机制。超过 2 小时仍为 IN_PROGRESS 的记录
 * 判定为僵死，标记为 FAILED。agentRuns 心跳机制处理正常崩溃恢复（秒级），
 * 此函数只是最后一道防线。
 *
 * @returns 清理的记录数
 */
export const cleanupStaleAnalysesService = async (): Promise<number> => {
    const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000

    const staleIds = await findStaleInProgressAnalysesDao(STALE_THRESHOLD_MS)
    if (staleIds.length === 0) return 0

    const count = await batchUpdateAnalysisStatusDao(staleIds, AnalysisStatus.FAILED)
    logger.info(`已清理 ${count} 条超时分析记录`)
    return count
}
