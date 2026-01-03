/**
 * 删除权益类型（软删除）
 *
 * DELETE /api/v1/admin/benefits/:id
 */

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的权益ID')
    }

    try {
        // 检查权益是否存在
        const existing = await prisma.benefits.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) {
            return resError(event, 404, '权益不存在')
        }

        // 检查是否有会员级别正在使用该权益
        const membershipBenefitCount = await prisma.membershipBenefits.count({
            where: { benefitId: id, deletedAt: null },
        })
        if (membershipBenefitCount > 0) {
            return resError(event, 400, '该权益已被会员级别使用，无法删除')
        }

        // 检查是否有用户权益记录
        const userBenefitCount = await prisma.userBenefits.count({
            where: { benefitId: id, deletedAt: null },
        })
        if (userBenefitCount > 0) {
            return resError(event, 400, '该权益已有用户记录，无法删除')
        }

        // 软删除权益
        await prisma.benefits.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedAt: new Date(),
            },
        })

        return resSuccess(event, '删除权益成功', { deleted: true })
    } catch (error) {
        logger.error('删除权益失败：', error)
        return resError(event, 500, '删除权益失败')
    }
})
