/**
 * API 权限数据访问层
 *
 * 提供 API 权限的 CRUD 操作。
 *
 * 入库前规范化策略（重要，防止 RBAC 审查 C4 / H5 复发）：
 * - 所有 createXxx / updateXxx 都会调用 normalizeApiPath / normalizeApiMethod
 *   规范化输入；对路径里的 [xxx] 转为 :xxx，并把 method 强制大写。
 * - validateApiPathFormat 拒绝任何残留的 [/]，从源头保证 pathMatcher 协议一致。
 */
import type { Prisma } from "#shared/types/prisma"
import type { PaginationParams } from "#shared/types/rbac"
import {
    normalizeApiMethod,
    normalizeApiPath,
    validateApiPathFormat,
} from '~~/server/services/rbac/guard.service'

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
 *
 * 过滤掉已禁用 / 软删的分组，避免在分组下拉里出现已经废弃的项。
 */
export const findAllApiPermissionGroupsDao = async (tx?: Prisma.TransactionClient) => {
    return (tx || prisma).apiPermissionGroups.findMany({
        where: {
            status: 1,
            deletedAt: null,
        },
        orderBy: { sort: 'asc' },
    })
}

/**
 * 根据 ID 查询 API 权限分组
 *
 * 用 findFirst 而非 findUnique，是因为要叠加 deletedAt 过滤；软删的分组应当视为不存在。
 */
export const findApiPermissionGroupByIdDao = async (id: number, tx?: Prisma.TransactionClient) => {
    return (tx || prisma).apiPermissionGroups.findFirst({
        where: { id, deletedAt: null },
    })
}

// ==================== API 权限 DAO ====================

/**
 * 创建 API 权限
 *
 * 规范化 + 校验流程：
 * 1) normalizeApiPath 把 [xxx] -> :xxx，去尾随 /；
 * 2) normalizeApiMethod 强制大写；
 * 3) validateApiPathFormat 兜底防止规范化残留。
 *
 * 任意一步校验失败抛 Error，handler 捕获后返回 400。
 */
export const createApiPermissionDao = async (
    data: CreateApiPermissionInput,
    tx?: Prisma.TransactionClient
) => {
    const path = normalizeApiPath(data.path)
    const reason = validateApiPathFormat(path)
    if (reason) {
        throw new Error(reason)
    }
    const method = normalizeApiMethod(data.method)

    return (tx || prisma).apiPermissions.create({
        data: {
            path,
            method,
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
 *
 * 与 createApiPermissionDao 同样的规范化策略；任一项格式不合法整体拒绝，
 * 避免 createMany 因部分 path 格式错乱写入脏数据后无法局部回滚。
 */
export const createManyApiPermissionsDao = async (
    data: CreateApiPermissionInput[],
    tx?: Prisma.TransactionClient
) => {
    const normalized = data.map(item => {
        const path = normalizeApiPath(item.path)
        const reason = validateApiPathFormat(path)
        if (reason) {
            throw new Error(`${reason}（path=${item.path}）`)
        }
        return {
            path,
            method: normalizeApiMethod(item.method),
            name: item.name,
            description: item.description ?? null,
            groupId: item.groupId ?? null,
            isPublic: item.isPublic ?? false,
            status: item.status ?? 1,
        }
    })

    return (tx || prisma).apiPermissions.createMany({
        data: normalized,
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
    const { page = 1, pageSize = 20, all = false } = pagination
    const skip = all ? undefined : (page - 1) * pageSize
    const take = all ? undefined : pageSize

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
            take,
            orderBy: [{ groupId: 'asc' }, { path: 'asc' }],
        }),
        (tx || prisma).apiPermissions.count({ where }),
    ])

    if (all) {
        return {
            items,
            total,
            page: 1,
            pageSize: total,
            totalPages: total > 0 ? 1 : 0,
        }
    }

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
 *
 * 仅在 path / method 显式修改时做规范化校验；其它字段不动。
 */
export const updateApiPermissionDao = async (
    id: number,
    data: UpdateApiPermissionInput,
    tx?: Prisma.TransactionClient
) => {
    const updateData: UpdateApiPermissionInput & { updatedAt: Date } = {
        ...data,
        updatedAt: new Date(),
    }

    if (typeof data.path === 'string') {
        const path = normalizeApiPath(data.path)
        const reason = validateApiPathFormat(path)
        if (reason) {
            throw new Error(reason)
        }
        updateData.path = path
    }
    if (typeof data.method === 'string') {
        updateData.method = normalizeApiMethod(data.method)
    }

    return (tx || prisma).apiPermissions.update({
        where: { id },
        data: updateData,
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
 *
 * 必须同时软删 role_api_permissions 中所有引用该权限的关联（H7）。
 * 否则关联记录是"孤儿关联"，未来如果代码忘记过滤 permission.deletedAt 就会
 * 把已撤销的权限重新激活到角色上。
 *
 * 调用方传 tx 时直接复用，不再嵌套事务；不传 tx 时本函数自己起事务。
 */
export const deleteApiPermissionDao = async (id: number, tx?: Prisma.TransactionClient) => {
    const now = new Date()
    const run = async (client: Prisma.TransactionClient) => {
        const updated = await client.apiPermissions.update({
            where: { id },
            data: { deletedAt: now, updatedAt: now },
        })
        await client.roleApiPermissions.updateMany({
            where: { permissionId: id, deletedAt: null },
            data: { deletedAt: now, updatedAt: now },
        })
        return updated
    }

    if (tx) {
        return run(tx)
    }
    return prisma.$transaction(run)
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
