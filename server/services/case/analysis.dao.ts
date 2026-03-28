/**
 * 案件分析结果数据访问层
 *
 * 提供案件分析结果的 CRUD 操作
 * Requirements: 8.1, 8.2, 9.6, 9.7
 */

import type { caseAnalyses, Prisma } from '~~/generated/prisma/client'

/** 分析状态枚举 */
export enum AnalysisStatus {
    /** 进行中 */
    IN_PROGRESS = 1,
    /** 已完成 */
    COMPLETED = 2,
    /** 已失败 */
    FAILED = 3,
}

/** 创建分析结果输入 */
export interface CreateAnalysisInput {
    /** 案件 ID */
    caseId: number
    /** 会话 ID */
    sessionId: string
    /** 节点 ID */
    nodeId: number
    /** 分析类型（节点名称） */
    analysisType: string
    /** 分析结果（Markdown 格式） */
    analysisResult?: string | null
    /** 还原后的结果（解密后的内容） */
    originalResult?: string | null
    /** 版本号 */
    version?: number
    /** 分析状态 */
    status?: number
    /** 是否为激活版本 */
    isActive?: boolean
}

/** 更新分析结果输入 */
export interface UpdateAnalysisInput {
    /** 分析结果（Markdown 格式） */
    analysisResult?: string | null
    /** 还原后的结果（解密后的内容） */
    originalResult?: string | null
    /** 分析状态 */
    status?: number
    /** 是否为激活版本 */
    isActive?: boolean
}

/** 分析结果列表查询参数 */
export interface AnalysisListParams {
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
    /** 案件 ID */
    caseId?: number
    /** 会话 ID */
    sessionId?: string
    /** 节点 ID */
    nodeId?: number
    /** 分析类型 */
    analysisType?: string
    /** 分析状态 */
    status?: number
    /** 排序字段 */
    orderBy?: 'id' | 'version' | 'createdAt' | 'updatedAt'
    /** 排序方向 */
    orderDir?: 'asc' | 'desc'
}

/** 分析结果详情（包含关联数据） */
export interface AnalysisWithRelations extends caseAnalyses {
    node?: {
        id: number
        name: string
        title: string | null
        type: string
    }
    case?: {
        id: number
        title: string
    }
}

/**
 * 创建分析结果
 * @param data 创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的分析结果
 */
export const createAnalysisDao = async (
    data: CreateAnalysisInput,
    tx?: Prisma.TransactionClient
): Promise<caseAnalyses> => {
    const client = tx || prisma
    try {
        const analysis = await client.caseAnalyses.create({
            data: {
                caseId: data.caseId,
                sessionId: data.sessionId,
                nodeId: data.nodeId,
                analysisType: data.analysisType,
                analysisResult: data.analysisResult ?? null,
                originalResult: data.originalResult ?? null,
                version: data.version ?? 1,
                status: data.status ?? AnalysisStatus.IN_PROGRESS,
                isActive: data.isActive ?? false,
            },
        })
        return analysis
    } catch (error) {
        logger.error('创建分析结果失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询分析结果
 * @param id 分析结果 ID
 * @param includeRelations 是否包含关联数据
 * @returns 分析结果或 null
 */
export const findAnalysisByIdDao = async (
    id: number,
    includeRelations = false
): Promise<AnalysisWithRelations | null> => {
    try {
        const analysis = await prisma.caseAnalyses.findFirst({
            where: { id, deletedAt: null },
            include: includeRelations ? {
                node: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                        type: true,
                    },
                },
                case: {
                    select: {
                        id: true,
                        title: true,
                    },
                },
            } : undefined,
        })
        return analysis as AnalysisWithRelations | null
    } catch (error) {
        logger.error('通过 ID 查询分析结果失败：', error)
        throw error
    }
}

/**
 * 查询案件的分析结果列表
 * @param options 查询参数
 * @returns 分析结果列表和总数
 */
export const findManyAnalysesDao = async (
    options: AnalysisListParams = {}
): Promise<{ list: AnalysisWithRelations[]; total: number }> => {
    const {
        page = 1,
        pageSize = 20,
        caseId,
        sessionId,
        nodeId,
        analysisType,
        status,
        orderBy = 'createdAt',
        orderDir = 'desc',
    } = options

    try {
        const where: Prisma.caseAnalysesWhereInput = { deletedAt: null }

        if (caseId !== undefined) {
            where.caseId = caseId
        }

        if (sessionId !== undefined) {
            where.sessionId = sessionId
        }

        if (nodeId !== undefined) {
            where.nodeId = nodeId
        }

        if (analysisType !== undefined) {
            where.analysisType = analysisType
        }

        if (status !== undefined) {
            where.status = status
        }

        const [list, total] = await Promise.all([
            prisma.caseAnalyses.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
                include: {
                    node: {
                        select: {
                            id: true,
                            name: true,
                            title: true,
                            type: true,
                        },
                    },
                    case: {
                        select: {
                            id: true,
                            title: true,
                        },
                    },
                },
            }),
            prisma.caseAnalyses.count({ where }),
        ])

        return { list: list as AnalysisWithRelations[], total }
    } catch (error) {
        logger.error('查询分析结果列表失败：', error)
        throw error
    }
}

/**
 * 查询案件会话的所有分析结果
 * @param sessionId 会话 ID
 * @returns 分析结果列表
 */
export const findAnalysesBySessionIdDao = async (
    sessionId: string
): Promise<AnalysisWithRelations[]> => {
    try {
        const analyses = await prisma.caseAnalyses.findMany({
            where: { sessionId, deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: {
                node: {
                    select: {
                        id: true,
                        name: true,
                        title: true,
                        type: true,
                    },
                },
            },
        })
        return analyses as AnalysisWithRelations[]
    } catch (error) {
        logger.error('查询会话分析结果失败：', error)
        throw error
    }
}

/**
 * 查询案件某个节点的所有版本
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @returns 分析结果版本列表
 */
export const findAnalysisVersionsDao = async (
    caseId: number,
    nodeId: number
): Promise<caseAnalyses[]> => {
    try {
        const analyses = await prisma.caseAnalyses.findMany({
            where: { caseId, nodeId, deletedAt: null },
            orderBy: { version: 'desc' },
        })
        return analyses
    } catch (error) {
        logger.error('查询分析结果版本失败：', error)
        throw error
    }
}

/**
 * 查询案件某个节点的最新版本
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @returns 最新版本的分析结果或 null
 */
export const findLatestAnalysisVersionDao = async (
    caseId: number,
    nodeId: number
): Promise<caseAnalyses | null> => {
    try {
        const analysis = await prisma.caseAnalyses.findFirst({
            where: { caseId, nodeId, deletedAt: null },
            orderBy: { version: 'desc' },
        })
        return analysis
    } catch (error) {
        logger.error('查询最新分析结果版本失败：', error)
        throw error
    }
}

/**
 * 查询会话中某个节点的分析结果
 * @param sessionId 会话 ID
 * @param nodeId 节点 ID
 * @param status 分析状态（可选）
 * @returns 分析结果或 null
 */
export const findAnalysisBySessionAndNodeDao = async (
    sessionId: string,
    nodeId: number,
    status?: number
): Promise<caseAnalyses | null> => {
    try {
        const where: Prisma.caseAnalysesWhereInput = { sessionId, nodeId, deletedAt: null }
        if (status !== undefined) {
            where.status = status
        }
        return await prisma.caseAnalyses.findFirst({ where })
    } catch (error) {
        logger.error('查询会话节点分析结果失败：', error)
        throw error
    }
}

/**
 * 获取案件某个节点的下一个版本号
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 * @returns 下一个版本号
 */
export const getNextVersionDao = async (
    caseId: number,
    nodeId: number,
    tx?: Prisma.TransactionClient
): Promise<number> => {
    try {
        const client = tx || prisma
        const latest = await client.caseAnalyses.findFirst({
            where: { caseId, nodeId, deletedAt: null },
            orderBy: { version: 'desc' },
        })
        return latest ? latest.version + 1 : 1
    } catch (error) {
        logger.error('获取下一个版本号失败：', error)
        throw error
    }
}

/**
 * 更新分析结果
 * @param id 分析结果 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的分析结果
 */
export const updateAnalysisDao = async (
    id: number,
    data: UpdateAnalysisInput,
    tx?: Prisma.TransactionClient
): Promise<caseAnalyses> => {
    const client = tx || prisma
    try {
        const updateData: any = {
            updatedAt: new Date(),
        }
        if (data.analysisResult !== undefined) updateData.analysisResult = data.analysisResult
        if (data.originalResult !== undefined) updateData.originalResult = data.originalResult
        if (data.status !== undefined) updateData.status = data.status
        if (data.isActive !== undefined) updateData.isActive = data.isActive

        const analysis = await client.caseAnalyses.update({
            where: { id },
            data: updateData,
        })
        return analysis
    } catch (error) {
        logger.error('更新分析结果失败：', error)
        throw error
    }
}

/**
 * 软删除分析结果
 * @param id 分析结果 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteAnalysisDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    try {
        await client.caseAnalyses.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('删除分析结果失败：', error)
        throw error
    }
}

/**
 * 批量软删除会话的所有分析结果
 * @param sessionId 会话 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteAnalysesBySessionDao = async (
    sessionId: string,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    try {
        await client.caseAnalyses.updateMany({
            where: { sessionId, deletedAt: null },
            data: { deletedAt: new Date() },
        })
    } catch (error) {
        logger.error('批量删除会话分析结果失败：', error)
        throw error
    }
}

/**
 * 查询案件的分析历史（按节点分组）
 * @param caseId 案件 ID
 * @returns 按节点分组的分析历史
 */
export const findAnalysisHistoryByCaseIdDao = async (
    caseId: number
): Promise<Map<number, caseAnalyses[]>> => {
    try {
        const analyses = await prisma.caseAnalyses.findMany({
            where: { caseId, deletedAt: null },
            orderBy: [
                { nodeId: 'asc' },
                { version: 'desc' },
            ],
        })

        // 按节点 ID 分组
        const historyMap = new Map<number, caseAnalyses[]>()
        for (const analysis of analyses) {
            const nodeAnalyses = historyMap.get(analysis.nodeId) || []
            nodeAnalyses.push(analysis)
            historyMap.set(analysis.nodeId, nodeAnalyses)
        }

        return historyMap
    } catch (error) {
        logger.error('查询案件分析历史失败：', error)
        throw error
    }
}

/**
 * 统计案件的分析结果数量
 * @param caseId 案件 ID
 * @param status 状态筛选（可选）
 * @returns 分析结果数量
 */
export const countAnalysesByCaseIdDao = async (
    caseId: number,
    status?: number
): Promise<number> => {
    try {
        const where: Prisma.caseAnalysesWhereInput = { caseId, deletedAt: null }
        if (status !== undefined) {
            where.status = status
        }
        return await prisma.caseAnalyses.count({ where })
    } catch (error) {
        logger.error('统计案件分析结果数量失败：', error)
        throw error
    }
}

/**
 * 取消激活指定案件节点的所有激活版本
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 */
export const deactivateVersionsDao = async (
    caseId: number,
    nodeId: number,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    try {
        await client.caseAnalyses.updateMany({
            where: { caseId, nodeId, isActive: true, deletedAt: null },
            data: { isActive: false, updatedAt: new Date() },
        })
    } catch (error) {
        logger.error('取消激活版本失败：', error)
        throw error
    }
}

/**
 * 激活指定版本（同时取消同节点其他版本的激活状态）
 * @param analysisId 分析结果 ID
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @param tx 事务客户端（可选）
 */
export const activateVersionDao = async (
    analysisId: number,
    caseId: number,
    nodeId: number,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const execute = async (client: Prisma.TransactionClient) => {
        await client.caseAnalyses.updateMany({
            where: { caseId, nodeId, isActive: true, deletedAt: null },
            data: { isActive: false, updatedAt: new Date() },
        })
        await client.caseAnalyses.update({
            where: { id: analysisId },
            data: { isActive: true, updatedAt: new Date() },
        })
    }
    try {
        if (tx) {
            await execute(tx)
        } else {
            await prisma.$transaction(async (txClient) => {
                await execute(txClient)
            })
        }
    } catch (error) {
        logger.error('激活版本失败：', error)
        throw error
    }
}

/**
 * 查询指定案件节点的激活版本
 * @param caseId 案件 ID
 * @param nodeId 节点 ID
 * @returns 激活的分析结果或 null
 */
export const findActiveAnalysisVersionDao = async (
    caseId: number,
    nodeId: number
): Promise<caseAnalyses | null> => {
    try {
        return await prisma.caseAnalyses.findFirst({
            where: { caseId, nodeId, isActive: true, deletedAt: null },
        })
    } catch (error) {
        logger.error('查询激活版本失败：', error)
        throw error
    }
}
