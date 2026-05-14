/**
 * 案件数据访问层
 *
 * 提供案件的 CRUD 操作
 * Requirements: 3.1, 3.2, 5.6, 5.7, 8.3, 8.4, 8.5
 */

import type { cases, caseSessions, Prisma } from '~~/generated/prisma/client'
import {
    CaseStatus,
    SessionStatus,
    type PartyInfo,
    type CreateCaseInput,
    type UpdateCaseInput,
    type CaseListParams,
    type CreateSessionInput,
} from '#shared/types/case'

/** 案件详情（包含关联数据） */
export interface CaseWithRelations extends cases {
    caseType?: {
        id: number
        name: string
        description: string | null
    }
    caseSessions?: caseSessions[]
}

/**
 * 创建案件
 * @param data 创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的案件
 */
export const createCaseDao = async (
    data: CreateCaseInput,
    tx?: Prisma.TransactionClient
): Promise<cases> => {
    const client = tx || prisma
    try {
        const caseRecord = await client.cases.create({
            data: {
                title: data.title ?? '',
                content: data.content,
                userId: data.userId,
                caseTypeId: data.caseTypeId,
                plaintiff: (data.plaintiff ?? undefined) as any,
                defendant: (data.defendant ?? undefined) as any,
                isDemo: data.isDemo ?? false,
                status: data.status ?? CaseStatus.CONSULTING,
                summary: data.summary ?? undefined,
                extractedInfo: (data.extractedInfo ?? undefined) as any,
                // 显式 fallback 到 'plaintiff'（与 DB DEFAULT 一致），避免 zod default 与 DB default 不一致时的歧义
                stance: data.stance ?? 'plaintiff',
                courtName: data.courtName ?? undefined,
                firstInstanceCaseNo: data.firstInstanceCaseNo ?? undefined,
                firstInstanceJudge: data.firstInstanceJudge ?? undefined,
                secondInstanceCaseNo: data.secondInstanceCaseNo ?? undefined,
                secondInstanceJudge: data.secondInstanceJudge ?? undefined,
            },
        })
        return caseRecord
    } catch (error) {
        logger.error('创建案件失败：', error)
        throw error
    }
}

/**
 * 创建案件会话
 * @param data 创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的会话
 */
export const createSessionDao = async (
    data: CreateSessionInput,
    tx?: Prisma.TransactionClient
): Promise<caseSessions> => {
    const client = tx || prisma
    try {
        const session = await client.caseSessions.create({
            data: {
                sessionId: data.sessionId,
                caseId: data.caseId,
                status: data.status ?? SessionStatus.IN_PROGRESS,
                type: data.type ?? 1,
                metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : undefined,
            },
        })
        return session
    } catch (error) {
        logger.error('创建案件会话失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询案件
 * @param id 案件 ID
 * @param includeRelations 是否包含关联数据
 * @returns 案件或 null
 */
export const findCaseByIdDao = async (
    id: number,
    includeRelations = false
): Promise<CaseWithRelations | null> => {
    try {
        const caseRecord = await prisma.cases.findFirst({
            where: { id, deletedAt: null },
            include: includeRelations ? {
                caseType: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                    },
                },
                caseSessions: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'desc' },
                },
            } : undefined,
        })
        return caseRecord as CaseWithRelations | null
    } catch (error) {
        logger.error('通过 ID 查询案件失败：', error)
        throw error
    }
}

/**
 * 通过会话 ID 查询案件
 * @param sessionId 会话 ID
 * @returns 案件或 null
 */
export const findCaseBySessionIdDao = async (
    sessionId: string
): Promise<CaseWithRelations | null> => {
    try {

        const session = await prisma.caseSessions.findFirst({
            where: { sessionId, deletedAt: null },
            include: {
                case: {
                    include: {
                        caseType: {
                            select: {
                                id: true,
                                name: true,
                                description: true,
                            },
                        },
                    },
                },
            },
        })

        if (!session || !session.case || session.case.deletedAt) {
            return null
        }

        return {
            ...session.case,
            caseSessions: [session],
        } as CaseWithRelations
    } catch (error) {
        logger.error('通过会话 ID 查询案件失败：', error)
        throw error
    }
}

/**
 * 通过会话 ID 查询会话
 * @param sessionId 会话 ID
 * @returns 会话或 null
 */
export const findSessionByIdDao = async (
    sessionId: string
): Promise<caseSessions | null> => {
    try {
        const session = await prisma.caseSessions.findFirst({
            where: { sessionId, deletedAt: null },
        })
        return session
    } catch (error) {
        logger.error('通过会话 ID 查询会话失败：', error)
        throw error
    }
}

/**
 * 查询案件列表（分页）
 * @param options 查询参数
 * @returns 案件列表和总数
 */
export const findManyCasesDao = async (
    options: CaseListParams = {}
): Promise<{ list: CaseWithRelations[]; total: number }> => {
    const {
        page = 1,
        pageSize = 20,
        userId,
        caseTypeId,
        status,
        isDemo,
        keyword,
        orderBy = 'createdAt',
        orderDir = 'desc',
    } = options

    try {
        const where: Prisma.casesWhereInput = { deletedAt: null }

        if (userId !== undefined) {
            where.userId = userId
        }

        if (caseTypeId !== undefined) {
            where.caseTypeId = caseTypeId
        }

        if (status !== undefined) {
            where.status = status
        }

        if (isDemo !== undefined) {
            where.isDemo = isDemo
        }

        if (keyword) {
            where.OR = [
                { title: { contains: keyword, mode: 'insensitive' } },
                { content: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        const [list, total] = await Promise.all([
            prisma.cases.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
                include: {
                    caseType: {
                        select: {
                            id: true,
                            name: true,
                            description: true,
                        },
                    },
                    caseSessions: {
                        where: { deletedAt: null },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
            }),
            prisma.cases.count({ where }),
        ])

        return { list: list as CaseWithRelations[], total }
    } catch (error) {
        logger.error('查询案件列表失败：', error)
        throw error
    }
}

/**
 * 更新案件
 * @param id 案件 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的案件
 */
export const updateCaseDao = async (
    id: number,
    data: UpdateCaseInput,
    tx?: Prisma.TransactionClient
): Promise<cases> => {
    const client = tx || prisma
    try {
        // 构建更新数据
        const updateData: any = {
            updatedAt: new Date(),
        }
        if (data.title !== undefined) updateData.title = data.title
        if (data.content !== undefined) updateData.content = data.content
        if (data.caseTypeId !== undefined) updateData.caseTypeId = data.caseTypeId
        if (data.plaintiff !== undefined) updateData.plaintiff = data.plaintiff
        if (data.defendant !== undefined) updateData.defendant = data.defendant
        if (data.status !== undefined) updateData.status = data.status
        if (data.courtName !== undefined) updateData.courtName = data.courtName
        if (data.firstInstanceCaseNo !== undefined) updateData.firstInstanceCaseNo = data.firstInstanceCaseNo
        if (data.secondInstanceCaseNo !== undefined) updateData.secondInstanceCaseNo = data.secondInstanceCaseNo
        if (data.firstInstanceJudge !== undefined) updateData.firstInstanceJudge = data.firstInstanceJudge
        if (data.secondInstanceJudge !== undefined) updateData.secondInstanceJudge = data.secondInstanceJudge
        if (data.stance !== undefined) updateData.stance = data.stance
        if (data.summary !== undefined) updateData.summary = data.summary

        const caseRecord = await client.cases.update({
            where: { id },
            data: updateData,
        })
        return caseRecord
    } catch (error) {
        logger.error('更新案件失败：', error)
        throw error
    }
}

/**
 * 更新会话状态
 * @param sessionId 会话 ID
 * @param status 新状态
 * @param tx 事务客户端（可选）
 * @returns 更新后的会话
 */
export const updateSessionStatusDao = async (
    sessionId: string,
    status: number,
    tx?: Prisma.TransactionClient
): Promise<caseSessions> => {
    const client = tx || prisma
    try {
        const session = await client.caseSessions.update({
            where: { sessionId },
            data: {
                status,
                updatedAt: new Date(),
            },
        })
        return session
    } catch (error) {
        logger.error('更新会话状态失败：', error)
        throw error
    }
}

/**
 * 软删除案件
 * @param id 案件 ID
 * @param tx 事务客户端（可选）
 */
export const softDeleteCaseDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<void> => {
    const client = tx || prisma
    try {
        const now = new Date()
        // 同时软删除案件和关联的会话
        await Promise.all([
            client.cases.update({
                where: { id },
                data: { deletedAt: now },
            }),
            client.caseSessions.updateMany({
                where: { caseId: id, deletedAt: null },
                data: { deletedAt: now },
            }),
        ])
    } catch (error) {
        logger.error('删除案件失败：', error)
        throw error
    }
}

/**
 * 获取案件的最新会话
 * @param caseId 案件 ID
 * @returns 最新会话或 null
 */
export const findLatestSessionByCaseIdDao = async (
    caseId: number
): Promise<caseSessions | null> => {
    try {
        const session = await prisma.caseSessions.findFirst({
            where: { caseId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        })
        return session
    } catch (error) {
        logger.error('获取案件最新会话失败：', error)
        throw error
    }
}

/**
 * 检查用户是否拥有案件
 * @param caseId 案件 ID
 * @param userId 用户 ID
 * @returns 是否拥有
 */
export const checkCaseOwnershipDao = async (
    caseId: number,
    userId: number
): Promise<boolean> => {
    try {
        const count = await prisma.cases.count({
            where: { id: caseId, userId, deletedAt: null },
        })
        return count > 0
    } catch (error) {
        logger.error('检查案件所有权失败：', error)
        throw error
    }
}
