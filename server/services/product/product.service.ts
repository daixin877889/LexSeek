/**
 * 商品服务层
 *
 * 提供商品相关的业务逻辑
 */
import { Decimal } from 'decimal.js'
import { findProductByIdDao, findAllActiveProductsDao } from './product.dao'
import { ProductType, ProductStatus, type ProductInfo } from '#shared/types/product'

/**
 * 将 Decimal 转换为数字
 */
const decimalToNumber = (value: Decimal | null | undefined): number | null => {
    if (value === null || value === undefined) {
        return null
    }
    return new Decimal(value).toNumber()
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
        type: product.type as ProductType,
        levelId: product.levelId,
        levelName: product.level?.name || null,
        priceMonthly: decimalToNumber(product.priceMonthly),
        priceYearly: decimalToNumber(product.priceYearly),
        giftPoint: product.giftPoint,
        unitPrice: decimalToNumber(product.unitPrice),
        pointAmount: product.pointAmount,
        purchaseLimit: product.purchaseLimit,
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
        type: product.type as ProductType,
        levelId: product.levelId,
        levelName: product.level?.name || null,
        priceMonthly: decimalToNumber(product.priceMonthly),
        priceYearly: decimalToNumber(product.priceYearly),
        giftPoint: product.giftPoint,
        unitPrice: decimalToNumber(product.unitPrice),
        pointAmount: product.pointAmount,
        purchaseLimit: product.purchaseLimit,
        status: product.status as ProductStatus,
        sortOrder: product.sortOrder,
    }))
}
