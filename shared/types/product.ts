/**
 * 商品类型定义
 */

/** 商品类型 */
export enum ProductType {
    /** 会员商品 */
    MEMBERSHIP = 1,
    /** 积分商品 */
    POINTS = 2,
}

/** 商品状态 */
export enum ProductStatus {
    /** 下架 */
    OFF_SHELF = 0,
    /** 上架 */
    ON_SHELF = 1,
}

/** 商品信息 */
export interface ProductInfo {
    id: number
    name: string
    type: ProductType
    levelId: number | null
    levelName: string | null
    priceMonthly: number | null
    priceYearly: number | null
    giftPoint: number | null
    unitPrice: number | null
    pointAmount: number | null
    purchaseLimit: number | null
    status: ProductStatus
    sortOrder: number
}

/** 创建商品参数 */
export interface CreateProductParams {
    name: string
    type: ProductType
    levelId?: number
    priceMonthly?: number
    priceYearly?: number
    giftPoint?: number
    unitPrice?: number
    pointAmount?: number
    purchaseLimit?: number
    status?: ProductStatus
    sortOrder?: number
}
