/**
 * 权益服务层
 *
 * 提供权益相关的业务逻辑
 */
import type { UserBenefitInfo } from '#shared/types/membership'

/**
 * 获取用户当前会员的权益列表
 * @param userId 用户 ID
 * @returns 用户权益列表
 */
export const getUserBenefitsService = async (
    userId: number
): Promise<UserBenefitInfo[]> => {
    // 获取用户当前有效会员
    const membership = await findCurrentUserMembershipDao(userId)

    if (!membership) {
        return []
    }

    // 获取会员级别的权益
    const membershipBenefits = await findBenefitsByLevelIdDao(membership.levelId)

    // 转换为响应格式
    return membershipBenefits.map((mb) => ({
        id: mb.benefit.id,
        name: mb.benefit.name,
        description: mb.benefit.description,
        type: mb.benefit.type,
        value: mb.benefit.value,
    }))
}

/**
 * 获取指定会员级别的权益列表
 * @param levelId 会员级别 ID
 * @returns 权益列表
 */
export const getBenefitsByLevelIdService = async (
    levelId: number
): Promise<UserBenefitInfo[]> => {
    const membershipBenefits = await findBenefitsByLevelIdDao(levelId)

    return membershipBenefits.map((mb) => ({
        id: mb.benefit.id,
        name: mb.benefit.name,
        description: mb.benefit.description,
        type: mb.benefit.type,
        value: mb.benefit.value,
    }))
}
