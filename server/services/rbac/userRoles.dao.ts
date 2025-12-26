/**
 * 用户角色数据访问层
 */
import type { Prisma } from "#shared/types/prisma";

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
 */
export const findUserRolesByUserIdDao = async (userId: number, tx?: Prisma.TransactionClient): Promise<(userRoles & { role: roles })[]> => {
    try {
        const userRoles = await (tx || prisma).userRoles.findMany({
            where: { userId, deletedAt: null },
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
        let where: any = {
            userId,
            deletedAt: null,
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