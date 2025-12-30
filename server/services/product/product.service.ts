/**
 * 商品服务层
 *
 * 提供商品相关的业务逻辑
 */
import type { ProductInfo, PriceCalculateParams, PriceCalculateResult } from '#shared/types/product'
import { ProductType, ProductStatus } from '#shared/types/product'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import { findProductByIdDao, findAllActiveProductsDao } from './product.dao'
import { countUserProductOrdersDao, countUserProductsOrdersDao } from '../payment/order.dao'

/**
 * 将 Prisma Decimal 转换为数字（可为 null）
 */
const decimalToNumber = (value: any): number | null => {
    if (value === null || value === undefined) {
        return null
    }
    return decimalToNumberUtils(value)
}

/**
 * 获取商品详情
 * @param id 商品 ID
 * @returns 商品信息或 null
 */
export const getProductByIdService = async (
    id: number
): Promise<ProductInfo | null> => {
    const product = await findProductByIdDao(id)

    if (!product) {
        return null
    }

    return {
        id: product.id,
        name: product.name,
        description: product.description,
        type: product.type as ProductType,
        category: product.category,
        levelId: product.levelId,
        levelName: product.level?.name || null,
        priceMonthly: decimalToNumber(product.priceMonthly),
        priceYearly: decimalToNumber(product.priceYearly),
        defaultDuration: product.defaultDuration,
        unitPrice: decimalToNumber(product.unitPrice),
        originalPriceMonthly: decimalToNumber(product.originalPriceMonthly),
        originalPriceYearly: decimalToNumber(product.originalPriceYearly),
        originalUnitPrice: decimalToNumber(product.originalUnitPrice),
        minQuantity: product.minQuantity,
        maxQuantity: product.maxQuantity,
        purchaseLimit: product.purchaseLimit,
        pointAmount: product.pointAmount,
        giftPoint: product.giftPoint,
        status: product.status as ProductStatus,
        sortOrder: product.sortOrder,
    }
}

/**
 * 获取所有上架商品
 * @param type 商品类型（可选）
 * @returns 商品列表
 */
export const getActiveProductsService = async (
    type?: ProductType
): Promise<ProductInfo[]> => {
    const products = await findAllActiveProductsDao(type)

    return products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        type: product.type as ProductType,
        category: product.category,
        levelId: product.levelId,
        levelName: product.level?.name || null,
        priceMonthly: decimalToNumber(product.priceMonthly),
        priceYearly: decimalToNumber(product.priceYearly),
        defaultDuration: product.defaultDuration,
        unitPrice: decimalToNumber(product.unitPrice),
        originalPriceMonthly: decimalToNumber(product.originalPriceMonthly),
        originalPriceYearly: decimalToNumber(product.originalPriceYearly),
        originalUnitPrice: decimalToNumber(product.originalUnitPrice),
        minQuantity: product.minQuantity,
        maxQuantity: product.maxQuantity,
        purchaseLimit: product.purchaseLimit,
        pointAmount: product.pointAmount,
        giftPoint: product.giftPoint,
        status: product.status as ProductStatus,
        sortOrder: product.sortOrder,
    }))
}

/**
 * 计算商品价格
 * @param params 价格计算参数
 * @returns 价格计算结果
 */
export const calculatePriceService = async (
    params: PriceCalculateParams
): Promise<PriceCalculateResult> => {
    const { productId, quantity, paymentCycle = 'yearly' } = params

    // 获取商品信息
    const product = await findProductByIdDao(productId)
    if (!product) {
        throw new Error('商品不存在')
    }

    if (product.status !== ProductStatus.ON_SHELF) {
        throw new Error('商品已下架')
    }

    // 验证购买数量
    const minQty = product.minQuantity || 1
    const maxQty = product.maxQuantity

    if (quantity < minQty) {
        throw new Error(`购买数量不能少于${minQty}`)
    }

    if (maxQty && quantity > maxQty) {
        throw new Error(`购买数量不能超过${maxQty}`)
    }

    let unitPrice = 0
    let paymentUnit: number | undefined
    let duration: number | undefined

    if (product.type === ProductType.MEMBERSHIP) {
        // 会员商品价格计算
        if (paymentCycle === 'monthly') {
            if (!product.priceMonthly) {
                throw new Error('该会员商品不支持月付')
            }
            unitPrice = decimalToNumberUtils(product.priceMonthly)
            paymentUnit = 1 // 月
            duration = quantity
        } else {
            if (!product.priceYearly) {
                throw new Error('该会员商品不支持年付')
            }
            unitPrice = decimalToNumberUtils(product.priceYearly)
            paymentUnit = 2 // 年
            duration = quantity
        }
    } else if (product.type === ProductType.POINTS) {
        // 积分商品价格计算
        if (!product.unitPrice) {
            throw new Error('积分商品价格配置错误')
        }
        unitPrice = decimalToNumberUtils(product.unitPrice)
    } else {
        throw new Error('不支持的商品类型')
    }

    const totalPrice = unitPrice * quantity

    return {
        productId,
        quantity,
        unitPrice,
        totalPrice,
        paymentCycle: product.type === ProductType.MEMBERSHIP ? paymentCycle : undefined,
        paymentUnit,
        duration,
    }
}

/**
 * 检查用户是否可以购买该商品
 * @param userId 用户ID
 * @param productId 商品ID
 * @returns 如果可以购买返回 true，否则抛出错误
 */
export const checkProductPurchaseLimitService = async (
    userId: number,
    productId: number
): Promise<boolean> => {
    // 获取商品信息
    const product = await findProductByIdDao(productId)
    if (!product) {
        throw new Error('商品不存在')
    }

    // 如果没有购买限制或限制为0，直接返回可以购买
    if (!product.purchaseLimit || product.purchaseLimit === 0) {
        return true
    }

    // 获取用户购买该商品的次数
    const purchaseCount = await countUserProductOrdersDao(userId, productId)

    // 如果购买次数达到限制，抛出错误
    if (purchaseCount >= product.purchaseLimit) {
        throw new Error('该商品购买次数已达上限')
    }

    return true
}

/**
 * 批量过滤已达到购买限制的商品
 * @param userId 用户ID
 * @param products 商品列表
 * @returns 过滤后的商品列表（移除已达购买限制的商品）
 */
export const filterProductsByPurchaseLimitService = async (
    userId: number,
    products: ProductInfo[]
): Promise<ProductInfo[]> => {
    // 提取所有有购买限制的商品ID（purchaseLimit > 0）
    const limitedProductIds = products
        .filter(p => p.purchaseLimit && p.purchaseLimit > 0)
        .map(p => p.id)

    // 如果没有有限制的商品，直接返回原列表
    if (limitedProductIds.length === 0) {
        return products
    }

    // 批量获取用户购买这些商品的次数
    const purchaseCountMap = await countUserProductsOrdersDao(userId, limitedProductIds)

    // 过滤掉已达到购买限制的商品
    const filteredProducts = products.filter(product => {
        // 如果没有购买限制或限制为0，保留
        if (!product.purchaseLimit || product.purchaseLimit === 0) {
            return true
        }

        // 获取该商品的购买次数
        const purchaseCount = purchaseCountMap.get(product.id) || 0

        // 如果购买次数小于限制，保留
        return purchaseCount < product.purchaseLimit
    })

    return filteredProducts
}
