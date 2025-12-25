
/**
 * token 黑名单
 */
import type { Prisma } from "#shared/types/prisma";
/**
 * 添加 token 黑名单
 * @param token 
 * @param userId 
 * @param expiredAt 
 * @returns 
 */
export const addTokenBlacklistDao = async (token: string, userId: number, expiredAt: Date, tx?: Prisma.TransactionClient): Promise<void> => {
    try {
        await (tx || prisma).tokenBlacklist.create({
            data: {
                token,
                userId,
                expiredAt,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            },
        });
    } catch (error) {
        logger.error('添加 token 黑名单失败：', error)
        throw error
    }
};

/**
 * 通过 token 查找 token 黑名单
 * @param token 
 * @returns 
 */
export const findTokenBlacklistByTokenDao = async (token: string, tx?: Prisma.TransactionClient): Promise<tokenBlacklist | null> => {
    try {
        const tokenBlacklist = await (tx || prisma).tokenBlacklist.findFirst({
            where: {
                token,
                deletedAt: null,
            },
        });
        if (!tokenBlacklist) {
            return null;
        }
        return tokenBlacklist;
    } catch (error) {
        logger.error('通过 token 查找 token 黑名单失败：', error)
        throw error
    }
};

/**
 * 软删除 token 黑名单
 * @param token 
 * @returns 
 */
export const deleteTokenBlacklistByTokenDao = async (token: string, tx?: Prisma.TransactionClient): Promise<void> => {
    try {
        await (tx || prisma).tokenBlacklist.updateMany({
            where: {
                token,
                deletedAt: null,
            },
            data: {
                deletedAt: new Date(),
            },
        });
    } catch (error) {
        logger.error('删除 token 黑名单失败：', error)
        throw error
    }
};

/**
 * 删除过期 token 黑名单
 * @param tx 
 * @returns 
 */
export const deleteExpiredTokenBlacklistDao = async (tx?: Prisma.TransactionClient): Promise<void> => {
    try {

        await (tx || prisma).tokenBlacklist.deleteMany({
            where: {
                expiredAt: {
                    lt: new Date(),
                },
                deletedAt: null,
            },
        });
    } catch (error) {
        logger.error('删除过期 token 黑名单失败：', error)
        throw error
    }
};