/**
 * 积分记录类型定义模块
 *
 * 包含积分记录相关的所有类型定义，如积分记录类型、积分记录值等。
 */

/**
 * 积分记录来源类型
 */
export enum PointRecordSourceType {
    /** 购买会员赠送 */
    MEMBERSHIP_GIFT = 1,
    /** 直接购买 */
    DIRECT_PURCHASE = 2,
    /** 兑换码赠送 */
    EXCHANGE_CODE_GIFT = 3,
    /** 积分兑换 */
    POINT_EXCHANGE = 4,
    /** 活动奖励 */
    ACTIVITY_REWARD = 5,
    /** 推荐注册 */
    REFERRAL_REGISTER = 6,
    /** 注册赠送 */
    REGISTER_GIFT = 7,
    /** 邀请注册赠送 */
    INVITATION_TO_REGISTER = 8,
    /** 会员升级补偿 */
    MEMBERSHIP_UPGRADE_COMPENSATION = 9,
    /** 其他 */
    OTHER = 99,
}

/**
 * 积分记录来源类型名称
 */
export const PointRecordSourceTypeName = {
    [PointRecordSourceType.MEMBERSHIP_GIFT]: "购买会员赠送",
    [PointRecordSourceType.DIRECT_PURCHASE]: "直接购买",
    [PointRecordSourceType.EXCHANGE_CODE_GIFT]: "兑换码赠送",
    [PointRecordSourceType.POINT_EXCHANGE]: "积分兑换",
    [PointRecordSourceType.ACTIVITY_REWARD]: "活动奖励",
    [PointRecordSourceType.REFERRAL_REGISTER]: "推荐注册",
    [PointRecordSourceType.REGISTER_GIFT]: "注册赠送",
    [PointRecordSourceType.INVITATION_TO_REGISTER]: "邀请注册赠送",
    [PointRecordSourceType.MEMBERSHIP_UPGRADE_COMPENSATION]: "会员升级补偿",
    [PointRecordSourceType.OTHER]: "其他",
}

/**
 * 积分状态
 */
export enum PointRecordStatus {
    /** 有效 */
    VALID = 1,
    /** 会员升级结算 */
    MEMBERSHIP_UPGRADE_SETTLEMENT = 2,
    /** 已作废 */
    CANCELLED = 3,
}


/**
 * 积分消耗项目状态
 */
export enum PointConsumptionItemStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/**
 * 积分消耗项目状态名称
 */
export const PointConsumptionItemStatusName = {
    [PointConsumptionItemStatus.DISABLED]: "禁用",
    [PointConsumptionItemStatus.ENABLED]: "启用",
}

/**
 * 积分消耗记录状态
 */
export enum PointConsumptionRecordStatus {
    /** 无效 */
    INVALID = 0,
    /** 预扣 */
    PRE_DEDUCT = 1,
    /** 已结算 */
    SETTLED = 2,
}

/**
 * 积分消耗记录状态名称
 */
export const PointConsumptionRecordStatusName = {
    [PointConsumptionRecordStatus.INVALID]: "无效",
    [PointConsumptionRecordStatus.PRE_DEDUCT]: "预扣",
    [PointConsumptionRecordStatus.SETTLED]: "已结算",
}
