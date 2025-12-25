/**
 * 角色数据访问层
 */
import type { Prisma } from "#shared/types/prisma";
/**
 * 查询角色列表
 */
export const findRoleByIdsDao = async (ids: number[], tx?: Prisma.TransactionClient): Promise<roles[]> => {
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