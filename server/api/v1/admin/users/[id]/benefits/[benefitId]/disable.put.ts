/**
 * 禁用用户权益记录
 *
 * PUT /api/v1/admin/users/:id/benefits/:benefitId/disable
 */

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const userId = parseInt(getRouterParam(event, 'id') || '')
    const benefitRecordId = parseInt(getRouterParam(event, 'benefitId') || '')

    if (isNaN(userId)) {
        return resError(event, 400, '无效的用户ID')
    }
    if (isNaN(benefitRecordId)) {
        return resError(event, 400, '无效的权益记录ID')
    }

    try {
        // 检查权益记录是否存在
        const record = await prisma.userBenefits.findFirst({
            where: {
                id: benefitRecordId,
                userId,
                deletedAt: null,
            },
        })
        if (!record) {
            return resError(event, 404, '权益记录不存在')
        }

        if (record.status === 0) {
            return resError(event, 400, '该权益记录已被禁用')
        }

        // 禁用权益记录
        await prisma.userBenefits.update({
            where: { id: benefitRecordId },
            data: {
                status: 0,
                updatedAt: new Date(),
            },
        })

        // 记录审计日志
        const admin = event.context.auth?.user
        logger.info(`管理员 ${admin?.id} 禁用了用户 ${userId} 的权益记录 ${benefitRecordId}`)

        return resSuccess(event, '禁用成功', { disabled: true })
    } catch (error) {
        logger.error('禁用用户权益记录失败：', error)
        return resError(event, 500, '禁用用户权益记录失败')
    }
})
