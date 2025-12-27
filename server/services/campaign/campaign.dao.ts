/**
 * 营销活动数据访问层
 *
 * 提供营销活动的 CRUD 操作
 */
import { Prisma } from '#shared/types/prisma'
import { CampaignType, CampaignStatus } from '#shared/types/campaign'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建营销活动
 * @param data 营销活动创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的营销活动
 */
export const createCampaignDao = async (
    data: Prisma.campaignsCreateInput,
    tx?: PrismaClient
): Promise<campaigns> => {
    try {
        const campaign = await (tx || prisma).campaigns.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return campaign
    } catch (error) {
        logger.error('创建营销活动失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询营销活动
 * @param id 营销活动 ID
 * @param tx 事务客户端（可选）
 * @returns 营销活动或 null
 */
export const findCampaignByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<(campaigns & { level: membershipLevels | null }) | null> => {
    try {
        const campaign = await (tx || prisma).campaigns.findUnique({
            where: { id, deletedAt: null },
            include: { level: true },
        })
        return campaign
    } catch (error) {
        logger.error('通过 ID 查询营销活动失败：', error)
        throw error
    }
}

/**
 * 查询指定类型的有效营销活动
 * @param type 活动类型
 * @param tx 事务客户端（可选）
 * @returns 有效的营销活动或 null
 */
export const findActiveCampaignByTypeDao = async (
    type: CampaignType,
    tx?: PrismaClient
): Promise<(campaigns & { level: membershipLevels | null }) | null> => {
    try {
        const now = new Date()
        const campaign = await (tx || prisma).campaigns.findFirst({
            where: {
                type,
                status: CampaignStatus.ENABLED,
                startAt: { lte: now },
                endAt: { gt: now },
                deletedAt: null,
            },
            include: { level: true },
            orderBy: { createdAt: 'desc' },
        })
        return campaign
    } catch (error) {
        logger.error('查询有效营销活动失败：', error)
        throw error
    }
}

/**
 * 查询所有营销活动（分页）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 营销活动列表和总数
 */
export const findAllCampaignsDao = async (
    options: {
        page?: number
        pageSize?: number
        type?: CampaignType
        status?: CampaignStatus
    } = {},
    tx?: PrismaClient
): Promise<{ list: (campaigns & { level: membershipLevels | null })[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10, type, status } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.campaignsWhereInput = {
            deletedAt: null,
            ...(type !== undefined && { type }),
            ...(status !== undefined && { status }),
        }

        const [list, total] = await Promise.all([
            (tx || prisma).campaigns.findMany({
                where,
                include: { level: true },
                skip,
                take: pageSize,
                orderBy: { createdAt: 'desc' },
            }),
            (tx || prisma).campaigns.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询所有营销活动失败：', error)
        throw error
    }
}

/**
 * 更新营销活动
 * @param id 营销活动 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的营销活动
 */
export const updateCampaignDao = async (
    id: number,
    data: Prisma.campaignsUpdateInput,
    tx?: PrismaClient
): Promise<campaigns> => {
    try {
        const campaign = await (tx || prisma).campaigns.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return campaign
    } catch (error) {
        logger.error('更新营销活动失败：', error)
        throw error
    }
}

/**
 * 软删除营销活动
 * @param id 营销活动 ID
 * @param tx 事务客户端（可选）
 */
export const deleteCampaignDao = async (
    id: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).campaigns.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('删除营销活动失败：', error)
        throw error
    }
}
