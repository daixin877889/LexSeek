/**
 * 积分消耗项目数据访问层
 * 
 * 提供积分消耗项目的查询操作
 */

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 通过 ID 查询积分消耗项目
 * @param id 积分消耗项目 ID
 * @param tx 事务客户端（可选）
 * @returns 积分消耗项目或 null
 */
export const findPointConsumptionItemByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<pointConsumptionItems | null> => {
    try {
        const item = await (tx || prisma).pointConsumptionItems.findUnique({
            where: { id, deletedAt: null },
        })
        return item
    } catch (error) {
        logger.error('通过 ID 查询积分消耗项目失败：', error)
        throw error
    }
}

/**
 * 查询启用的积分消耗项目列表
 * @param tx 事务客户端（可选）
 * @returns 启用的积分消耗项目列表
 */
export const findEnabledPointConsumptionItemsDao = async (
    tx?: PrismaClient
): Promise<pointConsumptionItems[]> => {
    try {
        const items = await (tx || prisma).pointConsumptionItems.findMany({
            where: {
                status: PointConsumptionItemStatus.ENABLED,
                deletedAt: null,
            },
            orderBy: { id: 'asc' },
        })
        return items
    } catch (error) {
        logger.error('查询启用的积分消耗项目列表失败：', error)
        throw error
    }
}
