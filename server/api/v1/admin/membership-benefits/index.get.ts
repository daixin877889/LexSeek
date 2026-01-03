/**
 * 获取会员级别权益配置列表
 *
 * GET /api/v1/admin/membership-benefits
 */

import { formatByteSize } from '#shared/utils/unitConverision'
import type { MembershipBenefitConfig, AvailableBenefit } from '#shared/types/benefit'

export default defineEventHandler(async (event) => {
    try {
        // 获取所有会员级别
        const levels = await prisma.membershipLevels.findMany({
            where: { deletedAt: null },
            orderBy: { sortOrder: 'asc' },
        })

        // 获取所有启用的权益类型
        const benefits = await prisma.benefits.findMany({
            where: { status: 1, deletedAt: null },
            orderBy: { id: 'asc' },
        })

        // 获取所有会员权益配置
        const membershipBenefits = await prisma.membershipBenefits.findMany({
            where: { deletedAt: null },
            include: { benefit: true },
        })

        // 构建会员级别权益配置
        const levelConfigs: MembershipBenefitConfig[] = levels.map((level) => {
            const levelBenefits = membershipBenefits.filter((mb) => mb.levelId === level.id)
            return {
                levelId: level.id,
                levelName: level.name,
                benefits: benefits.map((benefit) => {
                    const config = levelBenefits.find((lb) => lb.benefitId === benefit.id)
                    const benefitValue = config?.benefitValue?.toString() || '0'
                    return {
                        benefitId: benefit.id,
                        benefitCode: benefit.code,
                        benefitName: benefit.name,
                        benefitValue,
                        formattedValue: benefit.unitType === 'byte'
                            ? formatByteSize(Number(benefitValue))
                            : benefitValue,
                        unitType: benefit.unitType,
                    }
                }),
            }
        })

        // 可用权益列表
        const availableBenefits: AvailableBenefit[] = benefits.map((b) => ({
            id: b.id,
            code: b.code,
            name: b.name,
            unitType: b.unitType,
        }))

        return resSuccess(event, '获取会员权益配置成功', {
            levels: levelConfigs,
            availableBenefits,
        })
    } catch (error) {
        logger.error('获取会员权益配置失败：', error)
        return resError(event, 500, '获取会员权益配置失败')
    }
})
