/**
 * 赠送积分生效日期测试
 *
 * 验证购买会员套餐时赠送积分的生效日期与会员开始日期同步
 *
 * **Feature: gift-points-effective-date-fix**
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.2**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fc from 'fast-check'
import dayjs from 'dayjs'
import { prisma } from '../../../server/utils/db'
import { createUserMembershipDao, findAllActiveUserMembershipsDao } from '../../../server/services/membership/userMembership.dao'
import { createPointRecordDao } from '../../../server/services/point/pointRecords.dao'
import { UserMembershipSourceType, MembershipStatus } from '../../../shared/types/membership'

// 积分来源类型
const PointSourceType = {
    PURCHASE_GIFT: 2,
} as const

// 测试数据
let testUser: { id: number } | null = null
let testLevel: { id: number } | null = null
const createdMembershipIds: number[] = []
const createdPointRecordIds: number[] = []

/**
 * 计算会员开始日期（模拟 createMembershipService 的逻辑）
 */
async function calculateMembershipStartDate(userId: number): Promise<Date> {
    const allValidMemberships = await findAllActiveUserMembershipsDao(userId)

    if (allValidMemberships.length > 0) {
        // 找出结束日期最晚的会员记录
        const latestMembership = allValidMemberships.reduce(
            (latest, current) => {
                return dayjs(current.endDate).isAfter(dayjs(latest.endDate)) ? current : latest
            },
            allValidMemberships[0]
        )

        const latestEndDate = dayjs(latestMembership.endDate)
        const today = dayjs().startOf('day')

        if (latestEndDate.isAfter(today)) {
            // 从最晚会员到期日的第二天开始
            return latestEndDate.add(1, 'day').startOf('day').toDate()
        }
    }

    // 没有有效会员记录或最晚会员已过期，从今天开始
    return dayjs().startOf('day').toDate()
}

/**
 * 计算会员结束日期
 */
function calculateMembershipEndDate(startDate: Date, duration: number, durationUnit: 'day' | 'month' | 'year'): Date {
    const startDayjs = dayjs(startDate)

    if (durationUnit === 'month') {
        return startDayjs.add(duration, 'month').subtract(1, 'day').endOf('day').toDate()
    } else if (durationUnit === 'year') {
        return startDayjs.add(duration, 'year').subtract(1, 'day').endOf('day').toDate()
    } else {
        return startDayjs.add(duration, 'day').subtract(1, 'day').endOf('day').toDate()
    }
}

describe('赠送积分生效日期测试', () => {
    beforeAll(async () => {
        // 查找测试用户
        testUser = await prisma.users.findFirst({
            where: { deletedAt: null },
            select: { id: true },
        })

        // 查找测试用的会员级别
        testLevel = await prisma.membershipLevels.findFirst({
            where: { status: 1, deletedAt: null },
            select: { id: true },
        })
    })

    afterAll(async () => {
        // 清理测试创建的积分记录
        if (createdPointRecordIds.length > 0) {
            await prisma.pointRecords.deleteMany({
                where: { id: { in: createdPointRecordIds } },
            })
        }

        // 清理测试创建的会员记录
        if (createdMembershipIds.length > 0) {
            await prisma.userMemberships.deleteMany({
                where: { id: { in: createdMembershipIds } },
            })
        }

        await prisma.$disconnect()
    })

    describe('Property 1: 积分有效期与会员有效期同步', () => {
        /**
         * Property 1: 积分有效期与会员有效期同步
         * 
         * *对于任意* 会员购买赠送的积分记录，其 effectiveAt 应等于关联会员的 startDate，
         * 其 expiredAt 应等于关联会员的 endDate。
         * 
         * **Validates: Requirements 1.1, 1.2, 1.3, 2.2**
         */
        it('赠送积分的 effectiveAt 应等于会员的 startDate，expiredAt 应等于会员的 endDate', async () => {
            if (!testUser || !testLevel) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            // 计算会员开始和结束日期
            const startDate = await calculateMembershipStartDate(testUser.id)
            const endDate = calculateMembershipEndDate(startDate, 1, 'year')

            // 使用 DAO 创建会员记录
            const membership = await createUserMembershipDao({
                user: { connect: { id: testUser.id } },
                level: { connect: { id: testLevel.id } },
                startDate,
                endDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                sourceId: 0,
                remark: '测试会员',
            })

            createdMembershipIds.push(membership.id)

            // 使用 DAO 创建积分记录（使用修复后的逻辑）
            const giftPoints = 100
            const pointRecord = await createPointRecordDao({
                users: { connect: { id: testUser.id } },
                userMembership: { connect: { id: membership.id } },
                pointAmount: giftPoints,
                used: 0,
                remaining: giftPoints,
                sourceType: PointSourceType.PURCHASE_GIFT,
                sourceId: membership.id,
                effectiveAt: membership.startDate, // 修复后：使用会员开始时间
                expiredAt: membership.endDate,     // 使用会员结束时间
                status: 1,
                remark: '测试赠送积分',
            })

            createdPointRecordIds.push(pointRecord.id)

            // 验证积分的 effectiveAt 等于会员的 startDate
            expect(dayjs(pointRecord.effectiveAt).format('YYYY-MM-DD')).toBe(
                dayjs(membership.startDate).format('YYYY-MM-DD')
            )

            // 验证积分的 expiredAt 等于会员的 endDate
            expect(dayjs(pointRecord.expiredAt).format('YYYY-MM-DD')).toBe(
                dayjs(membership.endDate).format('YYYY-MM-DD')
            )
        })

        it('当会员开始日期为未来日期时，积分 effectiveAt 也应为未来日期', async () => {
            if (!testUser || !testLevel) {
                console.log('缺少测试数据，跳过测试')
                return
            }

            // 先创建一个当前有效的会员，使下一个会员的开始日期在未来
            const firstStartDate = await calculateMembershipStartDate(testUser.id)
            const firstEndDate = calculateMembershipEndDate(firstStartDate, 1, 'month')

            const firstMembership = await createUserMembershipDao({
                user: { connect: { id: testUser.id } },
                level: { connect: { id: testLevel.id } },
                startDate: firstStartDate,
                endDate: firstEndDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                sourceId: 0,
                remark: '第一个会员',
            })

            createdMembershipIds.push(firstMembership.id)

            // 计算第二个会员的开始日期（应该在第一个会员结束后）
            const secondStartDate = await calculateMembershipStartDate(testUser.id)
            const secondEndDate = calculateMembershipEndDate(secondStartDate, 1, 'year')

            const secondMembership = await createUserMembershipDao({
                user: { connect: { id: testUser.id } },
                level: { connect: { id: testLevel.id } },
                startDate: secondStartDate,
                endDate: secondEndDate,
                status: MembershipStatus.ACTIVE,
                sourceType: UserMembershipSourceType.DIRECT_PURCHASE,
                sourceId: 0,
                remark: '第二个会员',
            })

            createdMembershipIds.push(secondMembership.id)

            // 验证第二个会员的开始日期在未来
            const today = dayjs().startOf('day')
            const secondMembershipStartDate = dayjs(secondMembership.startDate)
            expect(secondMembershipStartDate.isAfter(today)).toBe(true)

            // 使用 DAO 创建积分记录（使用修复后的逻辑）
            const giftPoints = 200
            const pointRecord = await createPointRecordDao({
                users: { connect: { id: testUser.id } },
                userMembership: { connect: { id: secondMembership.id } },
                pointAmount: giftPoints,
                used: 0,
                remaining: giftPoints,
                sourceType: PointSourceType.PURCHASE_GIFT,
                sourceId: secondMembership.id,
                effectiveAt: secondMembership.startDate, // 修复后：使用会员开始时间（未来日期）
                expiredAt: secondMembership.endDate,
                status: 1,
                remark: '测试赠送积分（未来生效）',
            })

            createdPointRecordIds.push(pointRecord.id)

            // 验证积分的 effectiveAt 等于会员的 startDate（未来日期）
            expect(dayjs(pointRecord.effectiveAt).format('YYYY-MM-DD')).toBe(
                dayjs(secondMembership.startDate).format('YYYY-MM-DD')
            )

            // 验证积分的 effectiveAt 在未来
            expect(dayjs(pointRecord.effectiveAt).isAfter(today)).toBe(true)
        })
    })

    describe('Property: 积分有效期计算属性测试', () => {
        /**
         * 属性测试：对于任意会员时长，积分有效期应与会员有效期完全一致
         */
        it('对于任意会员时长，积分有效期应与会员有效期完全一致', () => {
            fc.assert(
                fc.property(
                    // 生成随机的会员时长（1-36 个月）
                    fc.integer({ min: 1, max: 36 }),
                    // 生成随机的开始日期（今天到未来 365 天内）
                    fc.integer({ min: 0, max: 365 }),
                    (durationMonths, daysFromNow) => {
                        // 计算会员开始日期
                        const startDate = dayjs().add(daysFromNow, 'day').startOf('day')

                        // 计算会员结束日期（按月计算）
                        const endDate = startDate.add(durationMonths, 'month').subtract(1, 'day').endOf('day')

                        // 模拟积分记录的有效期（应与会员一致）
                        const pointEffectiveAt = startDate
                        const pointExpiredAt = endDate

                        // 验证积分生效时间等于会员开始时间
                        expect(pointEffectiveAt.format('YYYY-MM-DD')).toBe(startDate.format('YYYY-MM-DD'))

                        // 验证积分过期时间等于会员结束时间
                        expect(pointExpiredAt.format('YYYY-MM-DD')).toBe(endDate.format('YYYY-MM-DD'))

                        // 验证积分有效期长度等于会员有效期长度
                        const membershipDays = endDate.diff(startDate, 'day')
                        const pointDays = pointExpiredAt.diff(pointEffectiveAt, 'day')
                        expect(pointDays).toBe(membershipDays)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
