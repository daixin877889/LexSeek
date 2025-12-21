/**
 * 用户角色数据访问层
 */
import { Prisma } from '#shared/types/prisma'

/**
 * 创建用户角色关联
 */
export const createUserRoleDao = async (userId: number, roleId: number, tx?: any): Promise<userRoles> => {
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
export const findUserRolesByUserIdDao = async (userId: number, tx?: any): Promise<(userRoles & { role: roles })[]> => {
    try {
        const userRoles = await (tx || prisma).userRoles.findMany({
            where: { userId, deletedAt: null },
            include: {
                role: true,
            },
        });
        logger.debug("查询用户角色成功:", userRoles);
        return userRoles;
    } catch (error) {
        logger.error("查询用户角色失败:", error);
        throw error;
    }
}