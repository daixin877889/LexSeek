/**
 * 角色 API 权限关联数据访问层
 * 
 * 管理角色与 API 权限的多对多关联关系
 */
import type { Prisma } from "#shared/types/prisma"

// ==================== 角色 API 权限关联 DAO ====================

/**
 * 为角色分配 API 权限
 */
export const assignApiPermissionsToRoleDao = async (
    roleId: number,
    permissionIds: number[],
    tx?: Prisma.TransactionClient
) => {
    // 过滤已存在的关联
    const existing = await (tx || prisma).roleApiPermissions.findMany({
        where: {
            roleId,
            permissionId: { in: permissionIds },
        },
        select: { permissionId: true },
    })
    const existingIds = new Set(existing.map(e => e.permissionId))
    const newIds = permissionIds.filter(id => !existingIds.has(id))

    if (newIds.length === 0) {
        return { count: 0 }
    }

    return (tx || prisma).roleApiPermissions.createMany({
        data: newIds.map(permissionId => ({
            roleId,
            permissionId,
        })),
        skipDuplicates: true,
    })
}

/**
 * 移除角色的 API 权限
 */
export const removeApiPermissionsFromRoleDao = async (
    roleId: number,
    permissionIds: number[],
    tx?: Prisma.TransactionClient
) => {
    return (tx || prisma).roleApiPermissions.deleteMany({
        where: {
            roleId,
            permissionId: { in: permissionIds },
        },
    })
}

/**
 * 设置角色的 API 权限（全量替换）
 */
export const setRoleApiPermissionsDao = async (
    roleId: number,
    permissionIds: number[],
    tx?: Prisma.TransactionClient
) => {
    const client = tx || prisma

    // 删除现有关联
    await client.roleApiPermissions.deleteMany({
        where: { roleId },
    })

    // 创建新关联
    if (permissionIds.length > 0) {
        await client.roleApiPermissions.createMany({
            data: permissionIds.map(permissionId => ({
                roleId,
                permissionId,
            })),
        })
    }

    return { count: permissionIds.length }
}

/**
 * 查询角色的 API 权限列表
 */
export const findRoleApiPermissionsDao = async (
    roleId: number,
    tx?: Prisma.TransactionClient
) => {
    const relations = await (tx || prisma).roleApiPermissions.findMany({
        where: { roleId },
        include: {
            permission: {
                include: { group: true },
            },
        },
    })

    return relations.map(r => r.permission)
}

/**
 * 查询多个角色的 API 权限列表
 */
export const findRolesApiPermissionsDao = async (
    roleIds: number[],
    tx?: Prisma.TransactionClient
) => {
    const relations = await (tx || prisma).roleApiPermissions.findMany({
        where: { roleId: { in: roleIds } },
        include: {
            permission: true,
        },
    })

    // 去重返回权限列表
    const permissionMap = new Map<number, typeof relations[0]['permission']>()
    for (const r of relations) {
        if (!permissionMap.has(r.permission.id)) {
            permissionMap.set(r.permission.id, r.permission)
        }
    }

    return Array.from(permissionMap.values())
}

/**
 * 查询用户的 API 权限列表（通过用户角色）
 */
export const findUserApiPermissionsDao = async (
    userId: number,
    tx?: Prisma.TransactionClient
) => {
    // 获取用户的所有角色
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: { userId },
        select: { roleId: true },
    })

    if (userRoles.length === 0) {
        return []
    }

    const roleIds = userRoles.map(ur => ur.roleId)
    return findRolesApiPermissionsDao(roleIds, tx)
}

/**
 * 检查角色是否拥有指定 API 权限
 */
export const checkRoleHasApiPermissionDao = async (
    roleId: number,
    permissionId: number,
    tx?: Prisma.TransactionClient
) => {
    const count = await (tx || prisma).roleApiPermissions.count({
        where: {
            roleId,
            permissionId,
        },
    })
    return count > 0
}

/**
 * 检查用户是否拥有指定 API 权限（通过路径和方法）
 */
export const checkUserHasApiPermissionByPathDao = async (
    userId: number,
    path: string,
    method: string,
    tx?: Prisma.TransactionClient
) => {
    // 获取用户的所有角色
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: { userId },
        select: { roleId: true },
    })

    if (userRoles.length === 0) {
        return false
    }

    const roleIds = userRoles.map(ur => ur.roleId)

    // 查询是否有匹配的权限
    const count = await (tx || prisma).roleApiPermissions.count({
        where: {
            roleId: { in: roleIds },
            permission: {
                path,
                method: { in: [method, '*'] },
                status: 1,
                deletedAt: null,
            },
        },
    })

    return count > 0
}

/**
 * 获取拥有指定 API 权限的角色列表
 */
export const findRolesByApiPermissionDao = async (
    permissionId: number,
    tx?: Prisma.TransactionClient
) => {
    const relations = await (tx || prisma).roleApiPermissions.findMany({
        where: { permissionId },
        include: {
            role: true,
        },
    })

    return relations.map(r => r.role)
}
