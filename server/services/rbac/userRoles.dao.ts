/**
 * 用户角色数据访问层
 */
import type { Prisma } from "#shared/types/prisma";
import type { roleRouters, roles, routers, userRoles } from '~~/generated/prisma/client'

/**
 * 创建用户角色关联
 */
export const createUserRoleDao = async (userId: number, roleId: number, tx?: Prisma.TransactionClient): Promise<userRoles> => {
    try {
        const userRole = await (tx || prisma).userRoles.create({
            data: { userId, roleId, createdAt: new Date(), updatedAt: new Date() },
        });
        logger.debug("创建用户角色关联成功:", userRole);
        return userRole;
    } catch (error: any) {
        logger.error("创建用户角色关联失败:", error);
        throw error;
    }
}


/**
 * 通过用户ID查询用户角色
 * @param userId 用户ID
 * @returns 用户角色
 *
 * 必须同时过滤：1) userRoles 软删；2) 关联 role 已禁用 / 软删除。
 * 否则用户「我的角色」展示和 token 上下文里都会出现已注销的角色。
 */
export const findUserRolesByUserIdDao = async (userId: number, tx?: Prisma.TransactionClient): Promise<(userRoles & { role: roles })[]> => {
    try {
        const userRoles = await (tx || prisma).userRoles.findMany({
            where: {
                userId,
                deletedAt: null,
                role: {
                    status: 1,
                    deletedAt: null,
                },
            },
            include: {
                role: true,
            },
        });
        // logger.debug("查询用户角色成功:", userRoles);
        return userRoles;
    } catch (error) {
        logger.error("查询用户角色失败:", error);
        throw error;
    }
}

/**
 * 通过用户ID查询用户角色路由权限
 * @param userId 用户ID
 * @returns 用户角色路由权限
 */
export const findUserRolesRouterByUserIdDao = async (userId: number, options?: {
    tx?: any,
    roleId?: number | number[]
}):
    Promise<(
        userRoles &
        {
            role: roles &
            {
                roleRouters: roleRouters[]
                & { router: routers }
            }
        })[]> => {
    try {
        // 必须过滤掉：1) 软删的 userRoles；2) 已禁用 / 软删的 role；
        // 3) 软删的 roleRouters 关联；4) 软删的 router 本身。
        // 任何一层漏过滤都会让用户菜单显示已经撤销的角色 / 路由项。
        let where: any = {
            userId,
            deletedAt: null,
            role: {
                status: 1,
                deletedAt: null,
            },
        }
        if (options?.roleId) {
            where.roleId = { in: Array.isArray(options?.roleId) ? options?.roleId : [options?.roleId] }
        }
        const userRoles = await (options?.tx || prisma).userRoles.findMany({
            where,
            include: {
                role: {
                    include: {
                        roleRouters: {
                            where: {
                                deletedAt: null,
                                router: { deletedAt: null },
                            },
                            include: {
                                router: true,
                            },
                        },
                    },
                }
            }
        });
        return userRoles;
    } catch (error: any) {
        logger.error("查询用户角色路由权限失败:", error);
        throw error;
    }
}