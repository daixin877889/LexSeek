/**
 * API 权限数据访问层
 * 
 * 提供 API 权限的 CRUD 操作
 */
import type { Prisma } from "#shared/types/prisma"
import type { PaginationParams } from "#shared/types/rbac"

// ==================== 类型定义 ====================

/** API 权限创建输入 */
export interface CreateApiPermissionInput {
    path: string
    method: string
    name: string
    description?: string | null
    groupId?: number | null
    isPublic?: boolean
    status?: number
}

/** API 权限更新输入 */
export interface UpdateApiPermissionInput {
    path?: string
    method?: string
    name?: string
    description?: string | null
    groupId?: number | null
    isPublic?: boolean
    status?: number
}

/** API 权限查询条件 */
export interface FindApiPermissionsQuery {
    path?: string
    method?: string
    groupId?: number | null
    isPublic?: boolean
    status?: number
    keyword?: string
}

// ==================== 权限分组 DAO ====================

/**
 * 创建 API 权限分组
 */
export const createApiPermissionGroupDao = async (
    data: { name: string; description?: string | null; sort?: number },
    tx?: Prisma.TransactionClient
) => {
    return (tx || prisma).apiPermissionGroups.create({
        data: {
            name: data.name,
            description: data.description ?? null,
            sort: data.sort ?? 0,
        },
    })
}

/**
 * 查询所有 API 权限分组
 */
export const findAllApiPermissionGroupsDao = async (tx?: Prisma.TransactionClient) => {
    return (tx || prisma).apiPermissionGroups.findMany({
        orderBy: { sort: 'asc' },
    })
}

/**
 * 根据 ID 查询 API 权限分组
 */
export const findApiPermissionGroupByIdDao = async (id: number, tx?: Prisma.TransactionClient) => {
    return (tx || prisma).apiPermissionGroups.findUnique({
        where: { id },
    })
}

// ==================== API 权限 DAO ====================

/**
 * 创建 API 权限
 */
export const createApiPermissionDao = async (
    data: CreateApiPermissionInput,
    tx?: Prisma.TransactionClient
) => {
    return (tx || prisma).apiPermissions.create({
        data: {
            path: data.path,
            method: data.method,
            name: data.name,
            description: data.description ?? null,
            groupId: data.groupId ?? null,
            isPublic: data.isPublic ?? false,
            status: data.status ?? 1,
        },
    })
}

/**
 * 批量创建 API 权限
 */
export const createManyApiPermissionsDao = async (
    data: CreateApiPermissionInput[],
    tx?: Prisma.TransactionClient
) => {
    return (tx || prisma).apiPermissions.createMany({
        data: data.map(item => ({
            path: item.path,
            method: item.method,
            name: item.name,
            description: item.description ?? null,
            groupId: item.groupId ?? null,
            isPublic: item.isPublic ?? false,
            status: item.status ?? 1,
        })),
        skipDuplicates: true,
    })
}

/**
 * 根据 ID 查询 API 权限
 */
export const findApiPermissionByIdDao = async (id: number, tx?: Prisma.TransactionClient) => {
    return (tx || prisma).apiPermissions.findFirst({
        where: { id, deletedAt: null },
        include: { group: true },
    })
}

/**
 * 根据路径和方法查询 API 权限
 */
export const findApiPermissionByPathMethodDao = async (
    path: string,
    method: string,
    tx?: Prisma.TransactionClient
) => {
    return (tx || prisma).apiPermissions.findFirst({
        where: {
            path,
            method,
            deletedAt: null,
        },
    })
}

/**
 * 查询 API 权限列表（支持分页和筛选）
 */
export const findApiPermissionsDao = async (
    query: FindApiPermissionsQuery = {},
    pagination: PaginationParams = {},
    tx?: Prisma.TransactionClient
) => {
    const { page = 1, pageSize = 20 } = pagination
    const skip = (page - 1) * pageSize

    // 构建查询条件
    const where: Prisma.apiPermissionsWhereInput = {
        deletedAt: null,
    }

    if (query.path) {
        where.path = { contains: query.path }
    }
    if (query.method) {
        where.method = query.method
    }
    if (query.groupId !== undefined) {
        where.groupId = query.groupId
    }
    if (query.isPublic !== undefined) {
        where.isPublic = query.isPublic
    }
    if (query.status !== undefined) {
        where.status = query.status
    }
    if (query.keyword) {
        where.OR = [
            { path: { contains: query.keyword } },
            { name: { contains: query.keyword } },
            { description: { contains: query.keyword } },
        ]
    }

    const [items, total] = await Promise.all([
        (tx || prisma).apiPermissions.findMany({
            where,
            include: { group: true },
            skip,
            take: pageSize,
            orderBy: [{ groupId: 'asc' }, { path: 'asc' }],
        }),
        (tx || prisma).apiPermissions.count({ where }),
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
 * 查询所有公开的 API 权限
 */
export const findPublicApiPermissionsDao = async (tx?: Prisma.TransactionClient) => {
    return (tx || prisma).apiPermissions.findMany({
        where: {
            isPublic: true,
            status: 1,
            deletedAt: null,
        },
        select: {
            id: true,
            path: true,
            method: true,
        },
    })
}

/**
 * 更新 API 权限
 */
export const updateApiPermissionDao = async (
    id: number,
    data: UpdateApiPermissionInput,
    tx?: Prisma.TransactionClient
) => {
    return (tx || prisma).apiPermissions.update({
        where: { id },
        data: {
            ...data,
            updatedAt: new Date(),
        },
    })
}

/**
 * 批量更新 API 权限公开状态
 */
export const updateApiPermissionsPublicStatusDao = async (
    ids: number[],
    isPublic: boolean,
    tx?: Prisma.TransactionClient
) => {
    return (tx || prisma).apiPermissions.updateMany({
        where: { id: { in: ids }, deletedAt: null },
        data: {
            isPublic,
            updatedAt: new Date(),
        },
    })
}

/**
 * 软删除 API 权限
 */
export const deleteApiPermissionDao = async (id: number, tx?: Prisma.TransactionClient) => {
    return (tx || prisma).apiPermissions.update({
        where: { id },
        data: {
            deletedAt: new Date(),
            updatedAt: new Date(),
        },
    })
}

/**
 * 检查 API 权限是否存在（排除指定 ID）
 */
export const checkApiPermissionExistsDao = async (
    path: string,
    method: string,
    excludeId?: number,
    tx?: Prisma.TransactionClient
) => {
    const where: Prisma.apiPermissionsWhereInput = {
        path,
        method,
        deletedAt: null,
    }
    if (excludeId) {
        where.id = { not: excludeId }
    }

    const count = await (tx || prisma).apiPermissions.count({ where })
    return count > 0
}
