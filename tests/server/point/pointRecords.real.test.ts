/**
 * 积分记录服务层 + DAO 层 - 真实数据库集成测试
 *
 * 目标：覆盖 server/services/point/pointRecords.service.ts 与
 * server/services/point/pointRecords.dao.ts 中的所有导出函数，
 * 提供 ≥90% 行覆盖率。
 *
 * 设计要点：
 * - 使用真实的 Prisma 客户端（自动导入），禁止 mock
 * - 隔离用户：每个测试套件创建独立用户，并在 afterAll 中硬删除
 * - 隔离会员：创建独立的 userMemberships / membershipLevels，并在 afterAll 中清理
 * - 维护外键关系：先删 pointConsumptionRecords -> pointRecords -> userMemberships ->
 *   membershipLevels -> users
 *
 * **Feature: point-records-real-integration**
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import dayjs from 'dayjs'

// 直接复用 Nuxt 自动导入的 prisma / logger
import { prisma } from '../../../server/utils/db'
import {
    createPointRecordDao,
    findPointRecordByIdDao,
    findPointRecordsByUserIdDao,
    findValidPointRecordsByUserIdDao,
    updatePointRecordDao,
    invalidatePointRecordsDao,
    sumUserValidPointsDao,
    findPointRecordsByMembershipIdDao,
    transferPointRecordsDao,
    findPointRecordsBySourceTypesDao,
    sumPointsByMembershipIdDao,
} from '../../../server/services/point/pointRecords.dao'

// 服务端模块依赖 Nuxt 自动导入的 DAO 函数（如 transferPointRecordsDao），
// 在 vitest 环境下未显式 import，需要手动挂到 globalThis 才能让 service 找到这些函数。
// 这里注入的是真实 DAO 实现，不是 mock。
;(globalThis as any).transferPointRecordsDao = transferPointRecordsDao
;(globalThis as any).sumPointsByMembershipIdDao = sumPointsByMembershipIdDao
;(globalThis as any).findPointRecordsBySourceTypesDao = findPointRecordsBySourceTypesDao

import {
    createPointRecordService,
    createPointRecord,
    getUserPointSummary,
    getUserPointRecords,
    getMembershipPointSummary,
    getPointsBySourceTypes,
    transferPointsToNewMembership,
} from '../../../server/services/point/pointRecords.service'
import {
    PointRecordSourceType,
    PointRecordStatus,
} from '../../../shared/types/point.types'

// ---------------- 测试资源跟踪 ----------------
const createdUserIds: number[] = []
const createdPointRecordIds: number[] = []
const createdMembershipIds: number[] = []
const createdLevelIds: number[] = []

// 生成唯一的测试标识
const uniqueSuffix = () =>
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

// 创建测试用户（隔离 user，避免污染其他用户的积分汇总）
const createIsolatedUser = async (label: string) => {
    // phone 长度限制 11，使用 13 + 时间戳后 9 位 + 随机 1 位
    const tail = Math.floor(Math.random() * 1e9)
        .toString()
        .padStart(9, '0')
        .slice(0, 9)
    const phone = `13${tail}`
    const user = await prisma.users.create({
        data: {
            phone,
            name: `pr_real_${label}_${uniqueSuffix()}`.slice(0, 100),
            password: 'test_password_hash',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    createdUserIds.push(user.id)
    return user
}

// 创建一个简单的会员级别 + 用户会员，用于会员相关用例
const createIsolatedMembership = async (userId: number) => {
    const level = await prisma.membershipLevels.create({
        data: {
            name: `lv_${uniqueSuffix()}`.slice(0, 50),
            sortOrder: 0,
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    createdLevelIds.push(level.id)

    const membership = await prisma.userMemberships.create({
        data: {
            userId,
            levelId: level.id,
            startDate: dayjs().subtract(1, 'day').toDate(),
            endDate: dayjs().add(30, 'day').toDate(),
            sourceType: 2,
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    createdMembershipIds.push(membership.id)
    return { level, membership }
}

// 直接创建一条积分记录（绕过 service 默认逻辑），用于构造特定场景
const insertRecord = async (
    userId: number,
    overrides: {
        pointAmount?: number
        used?: number
        remaining?: number
        sourceType?: number
        sourceId?: number | null
        userMembershipId?: number | null
        effectiveAt?: Date
        expiredAt?: Date
        status?: number
    } = {},
) => {
    const pointAmount = overrides.pointAmount ?? 100
    const record = await prisma.pointRecords.create({
        data: {
            userId,
            pointAmount,
            used: overrides.used ?? 0,
            remaining: overrides.remaining ?? pointAmount,
            sourceType: overrides.sourceType ?? PointRecordSourceType.OTHER,
            sourceId: overrides.sourceId ?? null,
            userMembershipId: overrides.userMembershipId ?? null,
            effectiveAt: overrides.effectiveAt ?? dayjs().subtract(1, 'day').toDate(),
            expiredAt: overrides.expiredAt ?? dayjs().add(30, 'day').toDate(),
            status: overrides.status ?? PointRecordStatus.VALID,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    createdPointRecordIds.push(record.id)
    return record
}

let dbAvailable = false

describe('积分记录 - 真实数据库集成', () => {
    beforeAll(async () => {
        try {
            await prisma.$connect()
            dbAvailable = true
            // 避免 sequence 漂移（测试库已有数据后，sequence 给的下个值已被占用 →
            // Unique constraint failed on (id)）
            await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 0) + 1, false)`)
            await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('point_records', 'id'), COALESCE((SELECT MAX(id) FROM point_records), 0) + 1, false)`)
        } catch (error) {
            console.warn('数据库连接失败，跳过测试：', error)
            dbAvailable = false
        }
    })

    afterAll(async () => {
        if (!dbAvailable) return

        try {
            // 1. 清理积分消耗记录（外键依赖 pointRecords）
            if (createdPointRecordIds.length > 0) {
                await prisma.pointConsumptionRecords.deleteMany({
                    where: { pointRecordId: { in: createdPointRecordIds } },
                })
            }
            if (createdUserIds.length > 0) {
                await prisma.pointConsumptionRecords.deleteMany({
                    where: { userId: { in: createdUserIds } },
                })
            }

            // 2. 清理积分记录（按记录 ID 与用户 ID 双重保险）
            if (createdPointRecordIds.length > 0) {
                await prisma.pointRecords.deleteMany({
                    where: { id: { in: createdPointRecordIds } },
                })
            }
            if (createdUserIds.length > 0) {
                await prisma.pointRecords.deleteMany({
                    where: { userId: { in: createdUserIds } },
                })
            }

            // 3. 清理会员记录（外键依赖 levels / users）
            if (createdMembershipIds.length > 0) {
                await prisma.userMemberships.deleteMany({
                    where: { id: { in: createdMembershipIds } },
                })
            }
            if (createdUserIds.length > 0) {
                await prisma.userMemberships.deleteMany({
                    where: { userId: { in: createdUserIds } },
                })
            }

            // 4. 清理会员级别
            if (createdLevelIds.length > 0) {
                await prisma.membershipLevels.deleteMany({
                    where: { id: { in: createdLevelIds } },
                })
            }

            // 5. 清理用户
            if (createdUserIds.length > 0) {
                await prisma.users.deleteMany({
                    where: { id: { in: createdUserIds } },
                })
            }
        } finally {
            await prisma.$disconnect()
        }
    })

    // ============== DAO 层 ==============

    describe('createPointRecordDao', () => {
        it('应成功创建积分记录并自动写入 createdAt/updatedAt', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_create')

            const record = await createPointRecordDao({
                users: { connect: { id: user.id } },
                pointAmount: 100,
                used: 0,
                remaining: 100,
                sourceType: PointRecordSourceType.OTHER,
                effectiveAt: new Date(),
                expiredAt: dayjs().add(30, 'day').toDate(),
                status: PointRecordStatus.VALID,
            })
            createdPointRecordIds.push(record.id)

            expect(record.id).toBeGreaterThan(0)
            expect(record.userId).toBe(user.id)
            expect(record.pointAmount).toBe(100)
            expect(record.remaining).toBe(100)
            expect(record.createdAt).toBeInstanceOf(Date)
            expect(record.updatedAt).toBeInstanceOf(Date)
        })

        it('支持事务客户端 tx', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_create_tx')

            const record = await prisma.$transaction(async (tx) => {
                return await createPointRecordDao(
                    {
                        users: { connect: { id: user.id } },
                        pointAmount: 50,
                        used: 0,
                        remaining: 50,
                        sourceType: PointRecordSourceType.OTHER,
                        effectiveAt: new Date(),
                        expiredAt: dayjs().add(30, 'day').toDate(),
                        status: PointRecordStatus.VALID,
                    },
                    tx as any,
                )
            })
            createdPointRecordIds.push(record.id)

            expect(record.userId).toBe(user.id)
            expect(record.pointAmount).toBe(50)
        })

        it('创建失败时应抛出错误（用户不存在）', async () => {
            if (!dbAvailable) return
            await expect(
                createPointRecordDao({
                    users: { connect: { id: -1 } },
                    pointAmount: 1,
                    used: 0,
                    remaining: 1,
                    sourceType: PointRecordSourceType.OTHER,
                    effectiveAt: new Date(),
                    expiredAt: dayjs().add(1, 'day').toDate(),
                    status: PointRecordStatus.VALID,
                }),
            ).rejects.toThrow()
        })
    })

    describe('findPointRecordByIdDao', () => {
        it('应返回已存在的记录', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findById')
            const record = await insertRecord(user.id)

            const found = await findPointRecordByIdDao(record.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(record.id)
            expect(found!.userId).toBe(user.id)
        })

        it('查询软删除记录应返回 null', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findById_deleted')
            const record = await insertRecord(user.id)
            await prisma.pointRecords.update({
                where: { id: record.id },
                data: { deletedAt: new Date() },
            })

            const found = await findPointRecordByIdDao(record.id)
            expect(found).toBeNull()
        })

        it('查询不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return
            const found = await findPointRecordByIdDao(-987654)
            expect(found).toBeNull()
        })

        it('支持 tx 客户端', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findById_tx')
            const record = await insertRecord(user.id)

            const found = await prisma.$transaction(async (tx) => {
                return await findPointRecordByIdDao(record.id, tx as any)
            })
            expect(found?.id).toBe(record.id)
        })
    })

    describe('findPointRecordsByUserIdDao', () => {
        it('应支持默认分页参数（page=1, pageSize=10）', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findByUser_default')
            for (let i = 0; i < 3; i++) {
                await insertRecord(user.id, { pointAmount: 10 + i })
            }

            const result = await findPointRecordsByUserIdDao(user.id, {})
            expect(result.list.length).toBe(3)
            expect(result.total).toBe(3)
        })

        it('应正确分页（page=2, pageSize=2）', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findByUser_page')
            for (let i = 0; i < 5; i++) {
                await insertRecord(user.id, { pointAmount: 10 + i })
            }

            const page1 = await findPointRecordsByUserIdDao(user.id, {
                page: 1,
                pageSize: 2,
            })
            const page2 = await findPointRecordsByUserIdDao(user.id, {
                page: 2,
                pageSize: 2,
            })

            expect(page1.list.length).toBe(2)
            expect(page2.list.length).toBe(2)
            expect(page1.total).toBe(5)
            expect(page2.total).toBe(5)
            // page1 与 page2 中的记录 ID 不重复
            const page1Ids = page1.list.map((r) => r.id)
            const page2Ids = page2.list.map((r) => r.id)
            for (const id of page2Ids) {
                expect(page1Ids).not.toContain(id)
            }
        })

        it('应按 sourceType 过滤', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findByUser_filter')
            await insertRecord(user.id, {
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })
            await insertRecord(user.id, {
                sourceType: PointRecordSourceType.ACTIVITY_REWARD,
            })

            const result = await findPointRecordsByUserIdDao(user.id, {
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })
            expect(result.total).toBe(1)
            expect(result.list[0]!.sourceType).toBe(
                PointRecordSourceType.DIRECT_PURCHASE,
            )
        })

        it('应排除已软删除记录', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findByUser_softdel')
            const a = await insertRecord(user.id, { pointAmount: 11 })
            const b = await insertRecord(user.id, { pointAmount: 22 })
            await prisma.pointRecords.update({
                where: { id: b.id },
                data: { deletedAt: new Date() },
            })

            const result = await findPointRecordsByUserIdDao(user.id, {})
            expect(result.total).toBe(1)
            expect(result.list[0]!.id).toBe(a.id)
        })
    })

    describe('findValidPointRecordsByUserIdDao', () => {
        it('应按过期时间升序返回（FIFO）且过滤过期/无效/无余额记录', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findValid')

            // 1. 已过期 -> 排除
            await insertRecord(user.id, {
                pointAmount: 10,
                expiredAt: dayjs().subtract(1, 'day').toDate(),
            })
            // 2. status != VALID -> 排除
            await insertRecord(user.id, {
                pointAmount: 20,
                status: PointRecordStatus.CANCELLED,
            })
            // 3. remaining = 0 -> 排除
            await insertRecord(user.id, {
                pointAmount: 30,
                remaining: 0,
                used: 30,
            })
            // 4. 有效记录：靠后的过期时间
            const later = await insertRecord(user.id, {
                pointAmount: 40,
                expiredAt: dayjs().add(60, 'day').toDate(),
            })
            // 5. 有效记录：靠前的过期时间
            const earlier = await insertRecord(user.id, {
                pointAmount: 50,
                expiredAt: dayjs().add(7, 'day').toDate(),
            })

            const records = await findValidPointRecordsByUserIdDao(user.id)
            expect(records.length).toBe(2)
            expect(records[0]!.id).toBe(earlier.id)
            expect(records[1]!.id).toBe(later.id)
        })

        it('用户没有有效记录时应返回空数组', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findValid_empty')
            const records = await findValidPointRecordsByUserIdDao(user.id)
            expect(records).toEqual([])
        })
    })

    describe('updatePointRecordDao', () => {
        it('应更新 used / remaining 字段', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_update')
            const record = await insertRecord(user.id, { pointAmount: 100 })

            const updated = await updatePointRecordDao(record.id, {
                used: 30,
                remaining: 70,
            })
            expect(updated.used).toBe(30)
            expect(updated.remaining).toBe(70)
            expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
                record.updatedAt.getTime(),
            )
        })

        it('更新不存在的记录应抛出错误', async () => {
            if (!dbAvailable) return
            await expect(
                updatePointRecordDao(-999999, { used: 1 }),
            ).rejects.toThrow()
        })
    })

    describe('invalidatePointRecordsDao', () => {
        it('应将匹配 (userId, sourceType, sourceId) 的记录置为 CANCELLED', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_invalidate')
            const sourceId = Math.floor(Math.random() * 1e8) + 1

            const a = await insertRecord(user.id, {
                sourceType: PointRecordSourceType.OTHER,
                sourceId,
            })
            const b = await insertRecord(user.id, {
                sourceType: PointRecordSourceType.OTHER,
                sourceId,
            })
            // 不同 sourceId 不应被作废
            const c = await insertRecord(user.id, {
                sourceType: PointRecordSourceType.OTHER,
                sourceId: sourceId + 1,
            })

            await invalidatePointRecordsDao(
                user.id,
                PointRecordSourceType.OTHER,
                sourceId,
            )

            const found = await prisma.pointRecords.findMany({
                where: { id: { in: [a.id, b.id, c.id] } },
                orderBy: { id: 'asc' },
            })
            const map = new Map(found.map((r) => [r.id, r]))
            expect(map.get(a.id)!.status).toBe(PointRecordStatus.CANCELLED)
            expect(map.get(b.id)!.status).toBe(PointRecordStatus.CANCELLED)
            expect(map.get(c.id)!.status).toBe(PointRecordStatus.VALID)
        })
    })

    describe('sumUserValidPointsDao', () => {
        it('应正确区分 purchasePoint / otherPoint / pendingPoint', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_sum')

            // purchasePoint：4 种购买相关来源
            await insertRecord(user.id, {
                pointAmount: 100,
                sourceType: PointRecordSourceType.MEMBERSHIP_GIFT,
            })
            await insertRecord(user.id, {
                pointAmount: 200,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })
            await insertRecord(user.id, {
                pointAmount: 50,
                sourceType:
                    PointRecordSourceType.MEMBERSHIP_UPGRADE_COMPENSATION,
            })
            await insertRecord(user.id, {
                pointAmount: 80,
                sourceType: PointRecordSourceType.MEMBERSHIP_UPGRADE_TRANSFER,
            })
            // otherPoint：注册赠送
            await insertRecord(user.id, {
                pointAmount: 30,
                sourceType: PointRecordSourceType.REGISTER_GIFT,
            })
            // pendingPoint：尚未生效
            await insertRecord(user.id, {
                pointAmount: 70,
                sourceType: PointRecordSourceType.OTHER,
                effectiveAt: dayjs().add(7, 'day').toDate(),
                expiredAt: dayjs().add(30, 'day').toDate(),
            })
            // 已过期 -> 完全不计入
            await insertRecord(user.id, {
                pointAmount: 999,
                sourceType: PointRecordSourceType.OTHER,
                effectiveAt: dayjs().subtract(60, 'day').toDate(),
                expiredAt: dayjs().subtract(1, 'day').toDate(),
            })
            // 已部分使用：used=10, remaining=20
            await insertRecord(user.id, {
                pointAmount: 30,
                used: 10,
                remaining: 20,
                sourceType: PointRecordSourceType.OTHER,
            })

            const summary = await sumUserValidPointsDao(user.id)
            // pointAmount 包含未生效但未过期的部分
            expect(summary.pointAmount).toBe(100 + 200 + 50 + 80 + 30 + 70 + 30)
            expect(summary.used).toBe(10)
            // remaining 仅包含已生效部分
            expect(summary.remaining).toBe(100 + 200 + 50 + 80 + 30 + 20)
            expect(summary.purchasePoint).toBe(100 + 200 + 50 + 80)
            expect(summary.otherPoint).toBe(30 + 20)
            expect(summary.pendingPoint).toBe(70)
        })

        it('用户无任何记录时返回全零', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_sum_empty')
            const summary = await sumUserValidPointsDao(user.id)
            expect(summary).toEqual({
                pointAmount: 0,
                used: 0,
                remaining: 0,
                purchasePoint: 0,
                otherPoint: 0,
                pendingPoint: 0,
            })
        })
    })

    describe('findPointRecordsByMembershipIdDao', () => {
        it('应按 membershipId 返回，并支持 status 过滤', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_findByMembership')
            const { membership } = await createIsolatedMembership(user.id)

            const a = await insertRecord(user.id, {
                pointAmount: 100,
                userMembershipId: membership.id,
                expiredAt: dayjs().add(10, 'day').toDate(),
            })
            const b = await insertRecord(user.id, {
                pointAmount: 200,
                userMembershipId: membership.id,
                expiredAt: dayjs().add(30, 'day').toDate(),
                status: PointRecordStatus.CANCELLED,
            })

            const all = await findPointRecordsByMembershipIdDao(membership.id)
            const ids = all.map((r) => r.id).sort()
            expect(ids).toEqual([a.id, b.id].sort())

            // 按状态筛选
            const validOnly = await findPointRecordsByMembershipIdDao(
                membership.id,
                { status: PointRecordStatus.VALID },
            )
            expect(validOnly.length).toBe(1)
            expect(validOnly[0]!.id).toBe(a.id)
        })
    })

    describe('transferPointRecordsDao', () => {
        it('应将原会员关联的记录全部转入新会员', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_transfer')
            const fromMembership = (await createIsolatedMembership(user.id))
                .membership
            const toMembership = (await createIsolatedMembership(user.id))
                .membership

            await insertRecord(user.id, {
                pointAmount: 10,
                userMembershipId: fromMembership.id,
            })
            await insertRecord(user.id, {
                pointAmount: 20,
                userMembershipId: fromMembership.id,
            })

            const count = await transferPointRecordsDao(
                fromMembership.id,
                toMembership.id,
            )
            expect(count).toBe(2)

            const fromAfter = await findPointRecordsByMembershipIdDao(
                fromMembership.id,
            )
            const toAfter = await findPointRecordsByMembershipIdDao(
                toMembership.id,
            )
            expect(fromAfter.length).toBe(0)
            expect(toAfter.length).toBe(2)
        })
    })

    describe('findPointRecordsBySourceTypesDao', () => {
        it('应按多个 sourceType 联合查询，且只返回有效未过期且有余额记录', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_bySourceTypes')

            const a = await insertRecord(user.id, {
                pointAmount: 100,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })
            const b = await insertRecord(user.id, {
                pointAmount: 200,
                sourceType: PointRecordSourceType.ACTIVITY_REWARD,
            })
            // 不在过滤范围内
            await insertRecord(user.id, {
                pointAmount: 99,
                sourceType: PointRecordSourceType.OTHER,
            })
            // remaining = 0 应排除
            await insertRecord(user.id, {
                pointAmount: 50,
                used: 50,
                remaining: 0,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })

            const records = await findPointRecordsBySourceTypesDao(user.id, [
                PointRecordSourceType.DIRECT_PURCHASE,
                PointRecordSourceType.ACTIVITY_REWARD,
            ])
            const ids = records.map((r) => r.id).sort()
            expect(ids).toEqual([a.id, b.id].sort())
        })
    })

    describe('sumPointsByMembershipIdDao', () => {
        it('应对会员关联的记录进行 total / remaining 汇总', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('dao_sumByMembership')
            const { membership } = await createIsolatedMembership(user.id)

            await insertRecord(user.id, {
                pointAmount: 100,
                used: 0,
                remaining: 100,
                userMembershipId: membership.id,
            })
            await insertRecord(user.id, {
                pointAmount: 200,
                used: 50,
                remaining: 150,
                userMembershipId: membership.id,
            })
            // 已过期 -> 不计入
            await insertRecord(user.id, {
                pointAmount: 999,
                userMembershipId: membership.id,
                effectiveAt: dayjs().subtract(60, 'day').toDate(),
                expiredAt: dayjs().subtract(1, 'day').toDate(),
            })

            const summary = await sumPointsByMembershipIdDao(membership.id)
            expect(summary.total).toBe(300)
            expect(summary.remaining).toBe(250)
        })
    })

    // ============== DAO catch 块覆盖 ==============
    // 通过传入 Prisma 不接受的参数（错误类型），触发 prisma 校验抛错，
    // 使得 DAO 内部 try/catch 的 catch 分支被执行，提升覆盖率。
    describe('DAO catch 分支覆盖', () => {
        const invalidId = 'not-a-number' as unknown as number

        it('createPointRecordDao 在 prisma 错误时抛出', async () => {
            await expect(
                createPointRecordDao({
                    users: { connect: { id: invalidId } },
                    pointAmount: 'bad' as unknown as number,
                    used: 0,
                    remaining: 0,
                    sourceType: PointRecordSourceType.OTHER,
                    effectiveAt: new Date(),
                    expiredAt: dayjs().add(1, 'day').toDate(),
                    status: PointRecordStatus.VALID,
                } as any),
            ).rejects.toThrow()
        })

        it('findPointRecordByIdDao 在 prisma 错误时抛出', async () => {
            await expect(findPointRecordByIdDao(invalidId)).rejects.toThrow()
        })

        it('findPointRecordsByUserIdDao 在 prisma 错误时抛出', async () => {
            await expect(
                findPointRecordsByUserIdDao(invalidId, {}),
            ).rejects.toThrow()
        })

        it('findValidPointRecordsByUserIdDao 在 prisma 错误时抛出', async () => {
            await expect(
                findValidPointRecordsByUserIdDao(invalidId),
            ).rejects.toThrow()
        })

        it('invalidatePointRecordsDao 在 prisma 错误时抛出', async () => {
            await expect(
                invalidatePointRecordsDao(invalidId, 1, 1),
            ).rejects.toThrow()
        })

        it('sumUserValidPointsDao 在 prisma 错误时抛出', async () => {
            await expect(sumUserValidPointsDao(invalidId)).rejects.toThrow()
        })

        it('findPointRecordsByMembershipIdDao 在 prisma 错误时抛出', async () => {
            await expect(
                findPointRecordsByMembershipIdDao(invalidId),
            ).rejects.toThrow()
        })

        it('transferPointRecordsDao 在 prisma 错误时抛出', async () => {
            await expect(
                transferPointRecordsDao(invalidId, invalidId),
            ).rejects.toThrow()
        })

        it('findPointRecordsBySourceTypesDao 在 prisma 错误时抛出', async () => {
            await expect(
                findPointRecordsBySourceTypesDao(invalidId, [1]),
            ).rejects.toThrow()
        })

        it('sumPointsByMembershipIdDao 在 prisma 错误时抛出', async () => {
            await expect(
                sumPointsByMembershipIdDao(invalidId),
            ).rejects.toThrow()
        })
    })

    // ============== Service 层 ==============

    describe('createPointRecordService', () => {
        it('默认参数：1 年有效期 + remaining 等于 pointAmount', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_create_default')
            const record = await createPointRecordService({
                userId: user.id,
                pointAmount: 100,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })
            createdPointRecordIds.push(record.id)

            expect(record.userId).toBe(user.id)
            expect(record.pointAmount).toBe(100)
            expect(record.used).toBe(0)
            expect(record.remaining).toBe(100)
            expect(record.status).toBe(PointRecordStatus.VALID)

            const expectedExpire = dayjs().startOf('day').add(1, 'year').subtract(1, 'day')
            expect(
                Math.abs(dayjs(record.expiredAt).diff(expectedExpire, 'day')),
            ).toBeLessThanOrEqual(1)
        })

        it('按 day 计算过期时间', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_create_day')
            const record = await createPointRecordService({
                userId: user.id,
                pointAmount: 10,
                sourceType: PointRecordSourceType.OTHER,
                duration: 30,
                durationUnit: 'day',
            })
            createdPointRecordIds.push(record.id)

            const diffDays = dayjs(record.expiredAt)
                .startOf('day')
                .diff(dayjs(record.effectiveAt).startOf('day'), 'day')
            expect(diffDays).toBe(29)
        })

        it('按 month 计算过期时间', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_create_month')
            const record = await createPointRecordService({
                userId: user.id,
                pointAmount: 10,
                sourceType: PointRecordSourceType.OTHER,
                duration: 2,
                durationUnit: 'month',
            })
            createdPointRecordIds.push(record.id)

            const diffMonths = dayjs(record.expiredAt).diff(
                dayjs(record.effectiveAt),
                'month',
            )
            expect(diffMonths).toBeGreaterThanOrEqual(1)
            expect(diffMonths).toBeLessThanOrEqual(2)
        })

        it('按 year 计算过期时间', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_create_year')
            const record = await createPointRecordService({
                userId: user.id,
                pointAmount: 10,
                sourceType: PointRecordSourceType.OTHER,
                duration: 1,
                durationUnit: 'year',
            })
            createdPointRecordIds.push(record.id)

            const diffDays = dayjs(record.expiredAt).diff(
                dayjs(record.effectiveAt),
                'day',
            )
            expect(diffDays).toBeGreaterThanOrEqual(363)
            expect(diffDays).toBeLessThanOrEqual(366)
        })

        it('显式传入 effectiveAt + expiredAt 时直接使用', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_create_explicit')
            const effectiveAt = dayjs().add(2, 'day').startOf('day').toDate()
            const expiredAt = dayjs().add(45, 'day').endOf('day').toDate()

            const record = await createPointRecordService({
                userId: user.id,
                pointAmount: 10,
                sourceType: PointRecordSourceType.OTHER,
                effectiveAt,
                expiredAt,
            })
            createdPointRecordIds.push(record.id)

            expect(dayjs(record.effectiveAt).startOf('day').valueOf()).toBe(
                dayjs(effectiveAt).startOf('day').valueOf(),
            )
            expect(dayjs(record.expiredAt).startOf('day').valueOf()).toBe(
                dayjs(expiredAt).startOf('day').valueOf(),
            )
        })

        it('userMembershipId 传入时记录关联会员', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_create_member')
            const { membership } = await createIsolatedMembership(user.id)

            const record = await createPointRecordService({
                userId: user.id,
                pointAmount: 100,
                sourceType: PointRecordSourceType.MEMBERSHIP_GIFT,
                userMembershipId: membership.id,
                effectiveAt: dayjs().subtract(1, 'day').toDate(),
                expiredAt: dayjs().add(30, 'day').toDate(),
                remark: '会员赠送',
            })
            createdPointRecordIds.push(record.id)

            expect(record.userMembershipId).toBe(membership.id)
            expect(record.remark).toBe('会员赠送')
        })

        it('支持事务客户端 tx', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_create_tx')
            const record = await prisma.$transaction(async (tx) => {
                return await createPointRecordService(
                    {
                        userId: user.id,
                        pointAmount: 50,
                        sourceType: PointRecordSourceType.OTHER,
                        duration: 7,
                        durationUnit: 'day',
                    },
                    tx as any,
                )
            })
            createdPointRecordIds.push(record.id)

            expect(record.pointAmount).toBe(50)
            const diffDays = dayjs(record.expiredAt)
                .startOf('day')
                .diff(dayjs(record.effectiveAt).startOf('day'), 'day')
            expect(diffDays).toBe(6)
        })
    })

    describe('createPointRecord (legacy)', () => {
        it('应委托到 createPointRecordService 并保留入参', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_legacy_create')
            const effectiveAt = dayjs().startOf('day').toDate()
            const expiredAt = dayjs().add(7, 'day').endOf('day').toDate()

            const record = await createPointRecord({
                userId: user.id,
                pointAmount: 60,
                sourceType: PointRecordSourceType.REGISTER_GIFT,
                sourceId: 12345,
                userMembershipId: null,
                effectiveAt,
                expiredAt,
                remark: 'legacy',
            })
            createdPointRecordIds.push(record.id)

            expect(record.userId).toBe(user.id)
            expect(record.pointAmount).toBe(60)
            expect(record.sourceType).toBe(PointRecordSourceType.REGISTER_GIFT)
            expect(record.sourceId).toBe(12345)
            expect(record.remark).toBe('legacy')
            expect(record.userMembershipId).toBeNull()
        })
    })

    describe('getUserPointSummary', () => {
        it('返回值与 sumUserValidPointsDao 一致（带 page/pageSize 不影响）', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_summary')
            await insertRecord(user.id, {
                pointAmount: 100,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })

            const summary = await getUserPointSummary(user.id)
            expect(summary.pointAmount).toBe(100)
            expect(summary.remaining).toBe(100)
            expect(summary.purchasePoint).toBe(100)
            expect(summary.otherPoint).toBe(0)
        })
    })

    describe('getUserPointRecords', () => {
        it('返回值包含 page / pageSize / total / list 字段', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_list')
            for (let i = 0; i < 3; i++) {
                await insertRecord(user.id, { pointAmount: 10 + i })
            }

            const result = await getUserPointRecords(user.id, {
                page: 1,
                pageSize: 2,
            })
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(2)
            expect(result.total).toBe(3)
            expect(result.list.length).toBe(2)
        })

        it('未传分页参数时使用默认 page=1, pageSize=10', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_list_default')
            await insertRecord(user.id)

            const result = await getUserPointRecords(user.id, {})
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(10)
        })
    })

    describe('transferPointsToNewMembership', () => {
        it('成功转移，返回 success=true 和数量', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_transfer')
            const fromMembership = (await createIsolatedMembership(user.id))
                .membership
            const toMembership = (await createIsolatedMembership(user.id))
                .membership

            await insertRecord(user.id, {
                pointAmount: 11,
                userMembershipId: fromMembership.id,
            })
            await insertRecord(user.id, {
                pointAmount: 22,
                userMembershipId: fromMembership.id,
            })
            await insertRecord(user.id, {
                pointAmount: 33,
                userMembershipId: fromMembership.id,
            })

            const res = await transferPointsToNewMembership(
                fromMembership.id,
                toMembership.id,
            )
            expect(res.success).toBe(true)
            expect(res.transferredCount).toBe(3)

            const after = await findPointRecordsByMembershipIdDao(
                toMembership.id,
            )
            expect(after.length).toBe(3)
        })

        it('支持 tx 客户端', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_transfer_tx')
            const fromMembership = (await createIsolatedMembership(user.id))
                .membership
            const toMembership = (await createIsolatedMembership(user.id))
                .membership

            await insertRecord(user.id, {
                pointAmount: 7,
                userMembershipId: fromMembership.id,
            })

            const res = await prisma.$transaction(async (tx) => {
                return await transferPointsToNewMembership(
                    fromMembership.id,
                    toMembership.id,
                    tx as any,
                )
            })
            expect(res.success).toBe(true)
            expect(res.transferredCount).toBe(1)
        })

        it('转移源会员无记录时 transferredCount=0', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_transfer_empty')
            const fromMembership = (await createIsolatedMembership(user.id))
                .membership
            const toMembership = (await createIsolatedMembership(user.id))
                .membership

            const res = await transferPointsToNewMembership(
                fromMembership.id,
                toMembership.id,
            )
            expect(res.success).toBe(true)
            expect(res.transferredCount).toBe(0)
        })

        it('底层 DAO 抛错时应原样抛出（覆盖 catch 分支）', async () => {
            if (!dbAvailable) return
            await expect(
                transferPointsToNewMembership(
                    'bad' as unknown as number,
                    'bad' as unknown as number,
                ),
            ).rejects.toThrow()
        })
    })

    describe('getMembershipPointSummary', () => {
        it('应按会员维度返回 total / remaining', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_membership_sum')
            const { membership } = await createIsolatedMembership(user.id)

            await insertRecord(user.id, {
                pointAmount: 100,
                used: 0,
                remaining: 100,
                userMembershipId: membership.id,
            })
            await insertRecord(user.id, {
                pointAmount: 200,
                used: 50,
                remaining: 150,
                userMembershipId: membership.id,
            })

            const summary = await getMembershipPointSummary(membership.id)
            expect(summary.total).toBe(300)
            expect(summary.remaining).toBe(250)
        })
    })

    describe('getPointsBySourceTypes', () => {
        it('应同时返回 records / total / remaining', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_bySource')
            await insertRecord(user.id, {
                pointAmount: 100,
                used: 20,
                remaining: 80,
                sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            })
            await insertRecord(user.id, {
                pointAmount: 200,
                used: 0,
                remaining: 200,
                sourceType: PointRecordSourceType.ACTIVITY_REWARD,
            })
            // 不在过滤范围内
            await insertRecord(user.id, {
                pointAmount: 999,
                sourceType: PointRecordSourceType.OTHER,
            })

            const result = await getPointsBySourceTypes(user.id, [
                PointRecordSourceType.DIRECT_PURCHASE,
                PointRecordSourceType.ACTIVITY_REWARD,
            ])
            expect(result.records.length).toBe(2)
            expect(result.total).toBe(300)
            expect(result.remaining).toBe(280)
        })

        it('无匹配记录时返回空数组与 0 汇总', async () => {
            if (!dbAvailable) return
            const user = await createIsolatedUser('svc_bySource_empty')
            const result = await getPointsBySourceTypes(user.id, [
                PointRecordSourceType.DIRECT_PURCHASE,
            ])
            expect(result.records).toEqual([])
            expect(result.total).toBe(0)
            expect(result.remaining).toBe(0)
        })
    })
})
