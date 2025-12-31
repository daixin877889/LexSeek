/**
 * 权限审计日志数据访问层
 * 
 * 记录权限相关的操作日志
 */
import type { Prisma } from "#shared/types/prisma"
import type { PaginationParams, AuditLogAction } from "#shared/types/rbac"

// ==================== 类型定义 ====================

/** 审计日志创建输入 */
export interface CreateAuditLogInput {
    action: AuditLogAction | string
    targetType: string
    targetId: number
    operatorId: number
    oldValue?: Prisma.InputJsonValue | null
    newValue?: Prisma.InputJsonValue | null
    ip?: string | null
}

/** 审计日志查询条件 */
export interface FindAuditLogsQuery {
    action?: string
    targetType?: string
    targetId?: number
    operatorId?: number
    startTime?: Date
    endTime?: Date
    keyword?: string
}

// ==================== 审计日志 DAO ====================

/**
 * 创建审计日志
 */
export const createAuditLogDao = async (
    data: CreateAuditLogInput,
    tx?: Prisma.TransactionClient
) => {
    return (tx || prisma).permissionAuditLogs.create({
        data: {
            action: data.action,
            targetType: data.targetType,
            targetId: data.targetId,
            operatorId: data.operatorId,
            oldValue: data.oldValue ?? undefined,
            newValue: data.newValue ?? undefined,
            ip: data.ip ?? null,
        },
    })
}

/**
 * 查询审计日志列表（支持分页和筛选）
 */
export const findAuditLogsDao = async (
    query: FindAuditLogsQuery = {},
    pagination: PaginationParams = {},
    tx?: Prisma.TransactionClient
) => {
    const { page = 1, pageSize = 20 } = pagination
    const skip = (page - 1) * pageSize

    // 构建查询条件
    const where: Prisma.permissionAuditLogsWhereInput = {}

    if (query.action) {
        where.action = query.action
    }
    if (query.targetType) {
        where.targetType = query.targetType
    }
    if (query.targetId) {
        where.targetId = query.targetId
    }
    if (query.operatorId) {
        where.operatorId = query.operatorId
    }
    if (query.startTime || query.endTime) {
        where.createdAt = {}
        if (query.startTime) {
            where.createdAt.gte = query.startTime
        }
        if (query.endTime) {
            where.createdAt.lte = query.endTime
        }
    }

    const [items, total] = await Promise.all([
        (tx || prisma).permissionAuditLogs.findMany({
            where,
            include: {
                operator: {
                    select: { id: true, name: true, phone: true },
                },
            },
            skip,
            take: pageSize,
            orderBy: { createdAt: 'desc' },
        }),
        (tx || prisma).permissionAuditLogs.count({ where }),
    ])

    return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    }
}

/**
 * 根据 ID 查询审计日志
 */
export const findAuditLogByIdDao = async (id: number, tx?: Prisma.TransactionClient) => {
    return (tx || prisma).permissionAuditLogs.findUnique({
        where: { id },
        include: {
            operator: {
                select: { id: true, name: true, phone: true },
            },
        },
    })
}

/**
 * 查询指定目标的审计日志
 */
export const findAuditLogsByTargetDao = async (
    targetType: string,
    targetId: number,
    pagination: PaginationParams = {},
    tx?: Prisma.TransactionClient
) => {
    return findAuditLogsDao({ targetType, targetId }, pagination, tx)
}
