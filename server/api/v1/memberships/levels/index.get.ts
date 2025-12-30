/**
 * 获取会员级别列表
 *
 * GET /api/v1/memberships/levels
 *
 * 返回所有启用的会员级别，按 sortOrder 升序排列（数字越大级别越高）
 */
// import { findAllActiveMembershipLevelsDao } from '~/server/services/membership/membershipLevel.dao'
import { MembershipLevelInfo, MembershipLevelStatus } from '#shared/types/membership'

export default defineEventHandler(async (event) => {
    try {
        // 查询所有启用的会员级别
        const levels = await findAllActiveMembershipLevelsDao()

        // 转换为响应格式
        const data: MembershipLevelInfo[] = levels.map((level) => ({
            id: level.id,
            name: level.name,
            description: level.description,
            sortOrder: level.sortOrder,
            status: level.status as MembershipLevelStatus,
        }))

        return resSuccess(event, '获取会员级别列表成功', data)
    } catch (error) {
        logger.error('获取会员级别列表失败：', error)
        return resError(event, 500, '获取会员级别列表失败')
    }
})
