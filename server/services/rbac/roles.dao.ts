/**
 * 角色数据访问层
 */
import { Prisma } from '#shared/types/prisma'

/**
 * 查询角色列表
 */
export const findRoleByIdsDao = async (ids: number[], tx?: any): Promise<roles[]> => {
    try {
        const roles = await (tx || prisma).roles.findMany({
            where: { id: { in: ids }, status: 1, deletedAt: null },
        });
        logger.debug("查询角色列表成功:", roles);
        return roles;
    } catch (error) {
        logger.error("查询角色列表失败:", error);
        throw error;
    }
}

/**
 * 获取用户角色列表 通过用户ID
 * @param userId 用户ID
 * @returns 用户角色列表
 */
export const findUserRolesByUserIdDao = async (userId: number, tx?: any): Promise<(userRoles & { role: roles })[]> => {
    try {
        const userRoles = await (tx || prisma).userRoles.findMany({
            where: { userId, status: 1, deletedAt: null },
            include: {
                role: true,
            },
        });
        return userRoles;
    } catch (error) {
        logger.error("获取用户角色列表失败:", error);
        throw error;
    }
}