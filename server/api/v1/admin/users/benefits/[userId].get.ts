/**
 * 获取用户权益详情（管理员视图）
 *
 * GET /api/v1/admin/users/benefits/:userId
 */

import { z } from 'zod'
import type { Prisma } from '~~/generated/prisma/client'
import {
    BenefitSourceTypeName,
    UserBenefitStatusNames,
    type UserBenefitSummary,
    type UserBenefitRecordAdmin,
} from '#shared/types/benefit'
import { formatByteSize } from '#shared/utils/unitConverision'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import type { benefits, userBenefits } from '~~/generated/prisma/client'

/** 查询参数验证 */
const querySchema = z.object({
    benefitCode: z.string().optional(),
    status: z.coerce.number().int().min(0).max(1).optional(),
})

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const userId = parseInt(getRouterParam(event, 'userId') || '')
    if (isNaN(userId)) {
        return resError(event, 400, '无效的用户ID')
    }

    // 验证查询参数
    const query = getQuery(event)
    const result = querySchema.safeParse(query)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    const { benefitCode, status } = result.data

    try {
        // 获取用户信息
        const user = await prisma.users.findFirst({
            where: { id: userId, deletedAt: null },
            select: { id: true, phone: true, name: true },
        })
        if (!user) {
            return resError(event, 404, '用户不存在')
        }

        // 获取所有启用的权益类型
        const benefits = await prisma.benefits.findMany({
            where: { status: 1, deletedAt: null },
            orderBy: { id: 'asc' },
        })

        // 获取用户权益汇总
        const now = new Date()
        const summary: UserBenefitSummary[] = []

        // 一次查出该用户全部生效中的权益记录，按 benefitId 分组（避免循环 N+1）
        const allActiveBenefits = await prisma.userBenefits.findMany({
            where: {
                userId,
                benefitId: { in: benefits.map(b => b.id) },
                status: 1,
                effectiveAt: { lte: now },
                expiredAt: { gte: now },
                deletedAt: null,
            },
            select: { benefitId: true, benefitValue: true },
        })
        const activeByBenefit = new Map<number, bigint[]>()
        for (const ub of allActiveBenefits) {
            const arr = activeByBenefit.get(ub.benefitId) ?? []
            arr.push(ub.benefitValue)
            activeByBenefit.set(ub.benefitId, arr)
        }

        // 云盘空间用量（与 benefit 无关，预先取一次，仅 storage_space 需要时使用）
        const needsStorageUsage = benefits.some(b => b.code === 'storage_space')
        let storageUsedValue = 0
        if (needsStorageUsage) {
            const usage = await prisma.ossFiles.aggregate({
                where: { userId, deletedAt: null },
                _sum: { fileSize: true },
            })
            storageUsedValue = decimalToNumberUtils(usage._sum?.fileSize)
        }

        for (const benefit of benefits) {
            const values = activeByBenefit.get(benefit.id) ?? []

            let totalValue = BigInt(0)
            if (values.length === 0) {
                totalValue = benefit.defaultValue
            } else if (benefit.consumptionMode === 'max') {
                for (const v of values) {
                    if (v > totalValue) totalValue = v
                }
            } else {
                for (const v of values) totalValue += v
            }

            const usedValue = benefit.code === 'storage_space' ? storageUsedValue : 0

            const totalNum = Number(totalValue)
            const remainingValue = Math.max(0, totalNum - usedValue)
            const percentage = totalNum > 0 ? Math.round((usedValue / totalNum) * 100) : 0

            summary.push({
                code: benefit.code,
                name: benefit.name,
                totalValue: totalNum,
                usedValue,
                remainingValue,
                unitType: benefit.unitType,
                formatted: {
                    total: benefit.unitType === 'byte' ? formatByteSize(totalNum) : totalNum.toString(),
                    used: benefit.unitType === 'byte' ? formatByteSize(usedValue) : usedValue.toString(),
                    remaining: benefit.unitType === 'byte' ? formatByteSize(remainingValue) : remainingValue.toString(),
                    percentage,
                },
            })
        }

        // 构建权益记录查询条件
        const recordWhere: Prisma.userBenefitsWhereInput = {
            userId,
            deletedAt: null,
        }
        if (benefitCode) {
            recordWhere.benefit = { code: benefitCode, deletedAt: null }
        }
        if (status !== undefined) {
            recordWhere.status = status
        }

        // 获取用户权益记录
        const userBenefitRecords = await prisma.userBenefits.findMany({
            where: recordWhere,
            include: { benefit: true },
            orderBy: { createdAt: 'desc' },
        })

        const records: UserBenefitRecordAdmin[] = userBenefitRecords.map((record) => ({
            id: record.id,
            benefitId: record.benefitId,
            benefitName: record.benefit.name,
            benefitCode: record.benefit.code,
            benefitValue: record.benefitValue.toString(),
            formattedValue: record.benefit.unitType === 'byte'
                ? formatByteSize(Number(record.benefitValue))
                : record.benefitValue.toString(),
            sourceType: record.sourceType,
            sourceTypeName: BenefitSourceTypeName[record.sourceType] || record.sourceType,
            effectiveAt: record.effectiveAt.toISOString(),
            expiredAt: record.expiredAt.toISOString(),
            status: record.status,
            statusName: UserBenefitStatusNames[record.status] || '未知',
            remark: record.remark,
            createdAt: record.createdAt.toISOString(),
        }))

        return resSuccess(event, '获取用户权益成功', {
            user,
            summary,
            records,
        })
    } catch (error) {
        logger.error('获取用户权益失败：', error)
        return resError(event, 500, '获取用户权益失败')
    }
})
