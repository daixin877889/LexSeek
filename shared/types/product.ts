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
    description: string | null
    type: ProductType
    category: string | null
    levelId: number | null
    levelName: string | null
    priceMonthly: number | null
    priceYearly: number | null
    defaultDuration: number | null
    unitPrice: number | null
    originalPriceMonthly: number | null
    originalPriceYearly: number | null
    originalUnitPrice: number | null
    minQuantity: number | null
    maxQuantity: number | null
    purchaseLimit: number | null
    pointAmount: number | null
    giftPoint: number | null
    status: ProductStatus
    sortOrder: number
}

/** 创建商品参数 */
export interface CreateProductParams {
    name: string
    description?: string
    type: ProductType
    category?: string
    levelId?: number
    priceMonthly?: number
    priceYearly?: number
    defaultDuration?: number
    unitPrice?: number
    originalPriceMonthly?: number
    originalPriceYearly?: number
    originalUnitPrice?: number
    minQuantity?: number
    maxQuantity?: number
    purchaseLimit?: number
    pointAmount?: number
    giftPoint?: number
    status?: ProductStatus
    sortOrder?: number
}

/** 更新商品参数 */
export interface UpdateProductParams {
    name?: string
    description?: string
    category?: string
    priceMonthly?: number
    priceYearly?: number
    defaultDuration?: number
    unitPrice?: number
    originalPriceMonthly?: number
    originalPriceYearly?: number
    originalUnitPrice?: number
    minQuantity?: number
    maxQuantity?: number
    purchaseLimit?: number
    pointAmount?: number
    giftPoint?: number
    status?: ProductStatus
    sortOrder?: number
}

/** 价格计算参数 */
export interface PriceCalculateParams {
    /** 商品ID */
    productId: number
    /** 购买数量 */
    quantity: number
    /** 支付周期（会员商品专用） */
    paymentCycle?: 'monthly' | 'yearly'
}

/** 价格计算结果 */
export interface PriceCalculateResult {
    /** 商品ID */
    productId: number
    /** 购买数量 */
    quantity: number
    /** 单价 */
    unitPrice: number
    /** 总价 */
    totalPrice: number
    /** 支付周期（会员商品专用） */
    paymentCycle?: 'monthly' | 'yearly'
    /** 时间单位 */
    paymentUnit?: number
    /** 购买时长 */
    duration?: number
}
