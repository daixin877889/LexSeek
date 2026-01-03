/**
 * 获取权益类型列表
 *
 * GET /api/v1/admin/benefits
 */

import { z } from 'zod'
import {
    BenefitUnitTypeNames,
    BenefitConsumptionModeNames,
    BenefitStatusNames,
    type BenefitAdminInfo,
} from '#shared/types/benefit'
import { formatByteSize } from '#shared/utils/unitConverision'

/** 查询参数验证 */
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.coerce.number().int().min(0).max(1).optional(),
    keyword: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    // 验证查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0].message)
    }

    const { page, pageSize, status, keyword } = result.data

    try {
        // 构建查询条件
        const where: Prisma.benefitsWhereInput = {
            deletedAt: null,
        }

        if (status !== undefined) {
            where.status = status
        }

        if (keyword) {
            where.OR = [
                { name: { contains: keyword } },
                { code: { contains: keyword } },
                { description: { contains: keyword } },
            ]
        }

        // 查询数据
        const [benefits, total] = await Promise.all([
            prisma.benefits.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { id: 'asc' },
            }),
            prisma.benefits.count({ where }),
        ])

        // 格式化返回数据
        const items: BenefitAdminInfo[] = benefits.map((benefit) => ({
            id: benefit.id,
            code: benefit.code,
            name: benefit.name,
            description: benefit.description,
            unitType: benefit.unitType,
            unitTypeName: BenefitUnitTypeNames[benefit.unitType] || benefit.unitType,
            consumptionMode: benefit.consumptionMode,
            consumptionModeName: BenefitConsumptionModeNames[benefit.consumptionMode] || benefit.consumptionMode,
            defaultValue: benefit.defaultValue.toString(),
            formattedDefaultValue: benefit.unitType === 'byte'
                ? formatByteSize(Number(benefit.defaultValue))
                : benefit.defaultValue.toString(),
            status: benefit.status,
            statusName: BenefitStatusNames[benefit.status] || '未知',
            createdAt: benefit.createdAt.toISOString(),
            updatedAt: benefit.updatedAt.toISOString(),
        }))

        return resSuccess(event, '获取权益列表成功', {
            items,
            total,
            totalPages: Math.ceil(total / pageSize),
        })
    } catch (error) {
        logger.error('获取权益列表失败：', error)
        return resError(event, 500, '获取权益列表失败')
    }
})
