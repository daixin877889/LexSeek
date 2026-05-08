/**
 * 支付类型定义
 */

/** 支付渠道 */
export enum PaymentChannel {
    /** 微信支付 */
    WECHAT = 'wechat',
    /** 支付宝 */
    ALIPAY = 'alipay',
}

/** 支付方式 */
export enum PaymentMethod {
    /** 小程序支付（微信JSAPI/支付宝小程序） */
    MINI_PROGRAM = 'mini_program',
    /** 扫码支付（微信Native/支付宝当面付） */
    SCAN_CODE = 'scan_code',
    /** 手机网页支付（微信H5/支付宝手机网站） */
    WAP = 'wap',
    /** APP支付 */
    APP = 'app',
    /** PC网页支付 */
    PC = 'pc',
}

/** 订单状态 */
export enum OrderStatus {
    /** 待支付 */
    PENDING = 0,
    /** 已支付 */
    PAID = 1,
    /** 已取消 */
    CANCELLED = 2,
    /** 已退款 */
    REFUNDED = 3,
}

/** 支付单状态 */
export enum PaymentTransactionStatus {
    /** 待支付 */
    PENDING = 0,
    /** 支付成功 */
    SUCCESS = 1,
    /** 支付失败 */
    FAILED = 2,
    /** 已过期 */
    EXPIRED = 3,
    /** 已退款 */
    REFUNDED = 4,
}

/** 时长单位 */
export enum DurationUnit {
    /** 月 */
    MONTH = 'month',
    /** 年 */
    YEAR = 'year',
}

/** 订单类型 */
export enum OrderType {
    /** 新购 */
    PURCHASE = 'purchase',
    /** 升级 */
    UPGRADE = 'upgrade',
    /** 续费 */
    RENEW = 'renew',
}

/** 支付单位（用于会员商品） */
export enum PaymentUnit {
    /** 按月 */
    MONTH = 1,
    /** 按年 */
    YEAR = 2,
}

/** 订单信息 */
export interface OrderInfo {
    id: number
    orderNo: string
    userId: number
    productId: number
    productName: string
    amount: number
    duration: number
    durationUnit: DurationUnit
    status: OrderStatus
    paidAt: string | null
    expiredAt: string
    createdAt: string
}

/** 支付单信息 */
export interface PaymentTransactionInfo {
    id: number
    transactionNo: string
    orderId: number
    amount: number
    paymentChannel: PaymentChannel
    paymentMethod: PaymentMethod
    outTradeNo: string | null
    status: PaymentTransactionStatus
    paidAt: string | null
    expiredAt: string
    errorMessage: string | null
}

/** 创建订单参数 */
export interface CreateOrderParams {
    userId: number
    productId: number
    duration: number
    durationUnit: DurationUnit
}

/** 订单项（用于前端展示） */
export interface OrderItem {
    id: number
    orderNo: string
    productName: string
    productType: number
    amount: number
    duration: number
    durationUnit: DurationUnit
    status: OrderStatus
    paidAt: string | null
    expiredAt: string
    createdAt: string
}

// ============================================
// 管理端订单 / 支付类型
// ============================================

/** 管理端订单列表查询参数 */
export interface AdminOrderQuery {
    /** 关键字：匹配订单号 / 用户手机号 / 用户昵称 */
    keyword?: string
    /** 订单状态（单选；不传 = 全部） */
    status?: OrderStatus
    /** 订单类型 */
    orderType?: OrderType
    /** 商品 ID（精确匹配） */
    productId?: number
    /** 起始创建时间 */
    startTime?: Date
    /** 结束创建时间 */
    endTime?: Date
}

/** 管理端订单列表项（前端展示用，已 flatten user/product） */
export interface AdminOrderListItem {
    id: number
    orderNo: string
    userId: number
    userPhone: string
    userName: string | null
    productId: number
    productName: string
    amount: number
    duration: number
    durationUnit: DurationUnit
    orderType: OrderType
    status: OrderStatus
    paidAt: Date | null
    createdAt: Date
}

/** 管理端订单详情 */
export interface AdminOrderDetail extends AdminOrderListItem {
    expiredAt: Date
    /** 业务备注（只读） */
    remark: string | null
    /** 管理员备注（仅后台可见） */
    adminRemark: string | null
    adminRemarkUpdatedBy: number | null
    adminRemarkUpdatedAt: Date | null
    /** join 出的修改人昵称（service 单独查询填充） */
    adminRemarkUpdaterName: string | null
    /** 关联支付单 */
    paymentTransactions: AdminPaymentListItem[]
    /** 操作记录（审计日志） */
    auditLogs: AdminAuditLogItem[]
}

/** 管理端支付列表查询参数 */
export interface AdminPaymentQuery {
    /** 关键字：匹配支付单号 / 第三方交易号 / 关联订单号 / 用户手机号 / 用户昵称 */
    keyword?: string
    status?: PaymentTransactionStatus
    paymentChannel?: PaymentChannel
    paymentMethod?: PaymentMethod
    startTime?: Date
    endTime?: Date
}

/** 管理端支付列表项 */
export interface AdminPaymentListItem {
    id: number
    transactionNo: string
    orderId: number
    orderNo: string
    userId: number
    userPhone: string
    amount: number
    paymentChannel: PaymentChannel
    paymentMethod: PaymentMethod
    status: PaymentTransactionStatus
    outTradeNo: string | null
    paidAt: Date | null
    createdAt: Date
}

/** 管理端支付详情 */
export interface AdminPaymentDetail extends AdminPaymentListItem {
    expiredAt: Date
    callbackData: unknown | null
    errorMessage: string | null
    remark: string | null
    adminRemark: string | null
    adminRemarkUpdatedBy: number | null
    adminRemarkUpdatedAt: Date | null
    adminRemarkUpdaterName: string | null
    /** 关联订单（轻量信息） */
    order: { id: number; orderNo: string; status: OrderStatus; amount: number }
    auditLogs: AdminAuditLogItem[]
}

/** 审计日志详情项 */
export interface AdminAuditLogItem {
    id: number
    action: string
    operatorId: number
    operatorName: string | null
    oldValue: unknown
    newValue: unknown
    createdAt: Date
}

// ============================================
// 状态映射（前端组件统一 import，禁止本地重复定义）
// ============================================

/** 订单状态 → shadcn Badge variant */
export const OrderStatusVariant: Record<OrderStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    [OrderStatus.PENDING]: 'secondary',
    [OrderStatus.PAID]: 'default',
    [OrderStatus.CANCELLED]: 'outline',
    [OrderStatus.REFUNDED]: 'destructive',
}

/** 支付状态 → shadcn Badge variant */
export const PaymentStatusVariant: Record<PaymentTransactionStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    [PaymentTransactionStatus.PENDING]: 'secondary',
    [PaymentTransactionStatus.SUCCESS]: 'default',
    [PaymentTransactionStatus.FAILED]: 'destructive',
    [PaymentTransactionStatus.EXPIRED]: 'outline',
    [PaymentTransactionStatus.REFUNDED]: 'destructive',
}

/** 订单状态 → 中文文本 */
export const OrderStatusText: Record<OrderStatus, string> = {
    [OrderStatus.PENDING]: '待支付',
    [OrderStatus.PAID]: '已支付',
    [OrderStatus.CANCELLED]: '已取消',
    [OrderStatus.REFUNDED]: '已退款',
}

/** 支付状态 → 中文文本 */
export const PaymentStatusText: Record<PaymentTransactionStatus, string> = {
    [PaymentTransactionStatus.PENDING]: '待支付',
    [PaymentTransactionStatus.SUCCESS]: '支付成功',
    [PaymentTransactionStatus.FAILED]: '支付失败',
    [PaymentTransactionStatus.EXPIRED]: '已过期',
    [PaymentTransactionStatus.REFUNDED]: '已退款',
}

/** 订单类型 → 中文文本 */
export const OrderTypeText: Record<OrderType, string> = {
    [OrderType.PURCHASE]: '新购',
    [OrderType.UPGRADE]: '升级',
    [OrderType.RENEW]: '续费',
}

/** 支付渠道 → 中文文本 */
export const PaymentChannelText: Record<PaymentChannel, string> = {
    [PaymentChannel.WECHAT]: '微信',
    [PaymentChannel.ALIPAY]: '支付宝',
}

/** 支付方式 → 中文文本 */
export const PaymentMethodText: Record<PaymentMethod, string> = {
    [PaymentMethod.MINI_PROGRAM]: '小程序',
    [PaymentMethod.SCAN_CODE]: '扫码',
    [PaymentMethod.WAP]: 'H5',
    [PaymentMethod.APP]: 'APP',
    [PaymentMethod.PC]: 'PC',
}
