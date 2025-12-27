/**
 * 营销活动类型定义
 */

/** 营销活动类型 */
export enum CampaignType {
    /** 注册赠送 */
    REGISTER_GIFT = 1,
    /** 邀请奖励 */
    INVITATION_REWARD = 2,
    /** 活动奖励 */
    ACTIVITY_REWARD = 3,
}

/** 营销活动状态 */
export enum CampaignStatus {
    /** 禁用 */
    DISABLED = 0,
    /** 启用 */
    ENABLED = 1,
}

/** 营销活动信息 */
export interface CampaignInfo {
    id: number
    name: string
    type: CampaignType
    levelId: number | null
    levelName: string | null
    duration: number | null
    giftPoint: number | null
    startAt: string
    endAt: string
    status: CampaignStatus
    remark: string | null
}

/** 创建营销活动参数 */
export interface CreateCampaignParams {
    name: string
    type: CampaignType
    levelId?: number
    duration?: number
    giftPoint?: number
    startAt: Date
    endAt: Date
    status?: CampaignStatus
    remark?: string
}
