/**
 * 商品数据访问层
 *
 * 提供商品的 CRUD 操作
 */
import { Prisma } from '#shared/types/prisma'
import { ProductType, ProductStatus } from '#shared/types/product'

// 定义 Prisma 客户端类型（支持事务）
type PrismaClient = typeof prisma

/**
 * 创建商品
 * @param data 商品创建数据
 * @param tx 事务客户端（可选）
 * @returns 创建的商品
 */
export const createProductDao = async (
    data: Prisma.productsCreateInput,
    tx?: PrismaClient
): Promise<products> => {
    try {
        const product = await (tx || prisma).products.create({
            data: {
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return product
    } catch (error) {
        logger.error('创建商品失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询商品
 * @param id 商品 ID
 * @param tx 事务客户端（可选）
 * @returns 商品或 null
 */
export const findProductByIdDao = async (
    id: number,
    tx?: PrismaClient
): Promise<(products & { level: membershipLevels | null }) | null> => {
    try {
        const product = await (tx || prisma).products.findUnique({
            where: { id, deletedAt: null },
            include: { level: true },
        })
        return product
    } catch (error) {
        logger.error('通过 ID 查询商品失败：', error)
        throw error
    }
}

/**
 * 查询所有上架商品（按 sortOrder 升序）
 * @param type 商品类型（可选）
 * @param tx 事务客户端（可选）
 * @returns 商品列表
 */
export const findAllActiveProductsDao = async (
    type?: ProductType,
    tx?: PrismaClient
): Promise<(products & { level: membershipLevels | null })[]> => {
    try {
        const products = await (tx || prisma).products.findMany({
            where: {
                status: ProductStatus.ON_SHELF,
                deletedAt: null,
                ...(type !== undefined && { type }),
            },
            include: { level: true },
            orderBy: { sortOrder: 'asc' },
        })
        return products
    } catch (error) {
        logger.error('查询所有上架商品失败：', error)
        throw error
    }
}

/**
 * 查询所有商品（分页）
 * @param options 查询选项
 * @param tx 事务客户端（可选）
 * @returns 商品列表和总数
 */
export const findAllProductsDao = async (
    options: {
        page?: number
        pageSize?: number
        type?: ProductType
        status?: ProductStatus
    } = {},
    tx?: PrismaClient
): Promise<{ list: (products & { level: membershipLevels | null })[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10, type, status } = options
        const skip = (page - 1) * pageSize

        const where: Prisma.productsWhereInput = {
            deletedAt: null,
            ...(type !== undefined && { type }),
            ...(status !== undefined && { status }),
        }

        const [list, total] = await Promise.all([
            (tx || prisma).products.findMany({
                where,
                include: { level: true },
                skip,
                take: pageSize,
                orderBy: { sortOrder: 'asc' },
            }),
            (tx || prisma).products.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询所有商品失败：', error)
        throw error
    }
}

/**
 * 更新商品
 * @param id 商品 ID
 * @param data 更新数据
 * @param tx 事务客户端（可选）
 * @returns 更新后的商品
 */
export const updateProductDao = async (
    id: number,
    data: Prisma.productsUpdateInput,
    tx?: PrismaClient
): Promise<products> => {
    try {
        const product = await (tx || prisma).products.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return product
    } catch (error) {
        logger.error('更新商品失败：', error)
        throw error
    }
}

/**
 * 软删除商品
 * @param id 商品 ID
 * @param tx 事务客户端（可选）
 */
export const deleteProductDao = async (
    id: number,
    tx?: PrismaClient
): Promise<void> => {
    try {
        await (tx || prisma).products.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })
    } catch (error) {
        logger.error('删除商品失败：', error)
        throw error
    }
}
