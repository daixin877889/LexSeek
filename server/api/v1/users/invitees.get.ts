/**
 * 获取用户邀请记录 API
 * GET /api/v1/users/invitees
 */

export default defineEventHandler(async (event) => {
    // 获取当前登录用户
    const user = event.context.auth.user
    if (!user) {
        throw createError({
            statusCode: 401,
            message: '请先登录',
        })
    }

    try {
        // 查询被当前用户邀请的用户列表
        const invitees = await prisma.users.findMany({
            where: {
                invitedBy: user.id,
                deletedAt: null,
            },
            select: {
                id: true,
                name: true,
                phone: true,
                createdAt: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        })

        return resSuccess(event, "获取邀请用户成功", {
            invitees: invitees.map((invitee) => ({
                id: invitee.id,
                name: invitee.name,
                phone: maskPhone(invitee.phone),  // 服务端脱敏
                createdAt: invitee.createdAt?.toISOString() || '',
            })),
        })
    } catch (error) {
        logger.error('获取邀请记录失败:', error)
        return resError(event, 500, '获取邀请记录失败')
    }
})
