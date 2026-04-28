/**
 * 角色 API 权限关联数据访问层
 * 
 * 管理角色与 API 权限的多对多关联关系
 */
import type { Prisma } from "#shared/types/prisma"
import type { userRoles } from '~~/generated/prisma/client'

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
    // 过滤掉软删的关联和已禁用 / 软删的权限，与 admin 后台「角色权限」展示语义一致：
    // 这里返回的是「当前真正生效」的权限，不包含历史撤销的关联。
    const relations = await (tx || prisma).roleApiPermissions.findMany({
        where: {
            roleId,
            deletedAt: null,
            permission: {
                status: 1,
                deletedAt: null,
            },
        },
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
 *
 * 必须过滤掉：1) 软删除的关联记录；2) 被禁用 / 软删除的 API 权限本身。
 * 否则被撤销的权限仍然算用户拥有，与 super_admin 分支
 * （permission.service.ts 已经过滤 status:1 + deletedAt:null）行为不一致。
 */
export const findRolesApiPermissionsDao = async (
    roleIds: number[],
    tx?: Prisma.TransactionClient
) => {
    const relations = await (tx || prisma).roleApiPermissions.findMany({
        where: {
            roleId: { in: roleIds },
            deletedAt: null,
            permission: {
                status: 1,
                deletedAt: null,
            },
        },
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
 *
 * 必须过滤掉：1) 软删除的 user-role 关联；2) 被禁用 / 软删除的角色。
 * 否则被注销的角色仍然给用户超额权限。
 */
export const findUserApiPermissionsDao = async (
    userId: number,
    tx?: Prisma.TransactionClient
) => {
    // 获取用户的所有角色
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: {
            userId,
            deletedAt: null,
            role: {
                status: 1,
                deletedAt: null,
            },
        },
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
 *
 * 需要排除软删关联和已禁用 / 软删的权限，否则会把"已撤销"的权限当成"角色仍然拥有"。
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
            deletedAt: null,
            permission: {
                status: 1,
                deletedAt: null,
            },
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
    // 获取用户的所有角色，过滤掉软删的 user-role 和 已禁用 / 软删的角色
    const userRoles = await (tx || prisma).userRoles.findMany({
        where: {
            userId,
            deletedAt: null,
            role: {
                status: 1,
                deletedAt: null,
            },
        },
        select: { roleId: true },
    })

    if (userRoles.length === 0) {
        return false
    }

    const roleIds = userRoles.map(ur => ur.roleId)

    // 查询是否有匹配的权限：再次过滤掉软删的 role-permission 关联
    const count = await (tx || prisma).roleApiPermissions.count({
        where: {
            roleId: { in: roleIds },
            deletedAt: null,
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
 *
 * 必须过滤掉：1) 软删的关联记录；2) 已禁用 / 软删的角色。
 * admin 后台展示「该权限被哪些角色使用」，不应该包含已经撤销的关联或已注销的角色。
 */
export const findRolesByApiPermissionDao = async (
    permissionId: number,
    tx?: Prisma.TransactionClient
) => {
    const relations = await (tx || prisma).roleApiPermissions.findMany({
        where: {
            permissionId,
            deletedAt: null,
            role: {
                status: 1,
                deletedAt: null,
            },
        },
        include: {
            role: true,
        },
    })

    return relations.map(r => r.role)
}
