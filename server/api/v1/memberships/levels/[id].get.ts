/**
 * 获取会员级别详情
 *
 * GET /api/v1/memberships/levels/:id
 *
 * 返回指定 ID 的会员级别详情
 */
import { z } from 'zod'
import { findMembershipLevelByIdDao } from '~/server/services/membership/membershipLevel.dao'
import { MembershipLevelInfo, MembershipLevelStatus } from '#shared/types/membership'

// 参数验证 schema
const paramsSchema = z.object({
    id: z.string().regex(/^\d+$/, 'ID 必须是数字').transform(Number),
})

export default defineEventHandler(async (event) => {
    try {
        // 验证路由参数
        const params = getRouterParams(event)
        const result = paramsSchema.safeParse(params)

        if (!result.success) {
            return resError(event, 400, result.error.errors[0].message)
        }

        const { id } = result.data

        // 查询会员级别
        const level = await findMembershipLevelByIdDao(id)

        if (!level) {
            return resError(event, 404, '会员级别不存在')
        }

        // 转换为响应格式
        const data: MembershipLevelInfo = {
            id: level.id,
            name: level.name,
            description: level.description,
            sortOrder: level.sortOrder,
            status: level.status as MembershipLevelStatus,
        }

        return resSuccess(event, '获取会员级别详情成功', data)
    } catch (error) {
        logger.error('获取会员级别详情失败：', error)
        return resError(event, 500, '获取会员级别详情失败')
    }
})
