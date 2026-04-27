/**
 * 积分消耗记录 DAO - 真实数据库集成测试
 *
 * 目标：覆盖 server/services/point/pointConsumptionRecords.dao.ts
 * 中所有导出函数的正常路径和 catch 分支。
 *
 * - 使用真实 Prisma 客户端，禁止常态 mock
 * - catch 分支通过 Proxy 故障注入触发
 * - afterAll hard delete 本轮创建的数据
 *
 * **Feature: point-consumption-records-real**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import dayjs from 'dayjs'
import { prisma } from '../../../server/utils/db'
import {
    createPointConsumptionRecordDao,
    findPointConsumptionRecordsByUserIdDao,
    sumConsumptionByPointRecordIdDao,
} from '../../../server/services/point/pointConsumptionRecords.dao'

// ---------------- 测试资源跟踪 ----------------
const createdIds = {
    userIds: [] as number[],
    pointRecordIds: [] as number[],
    pointConsumptionItemIds: [] as number[],
    pointConsumptionRecordIds: [] as number[],
}

const uniqueSuffix = () =>
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

const createIsolatedUser = async () => {
    const tail = Math.floor(Math.random() * 1e9)
        .toString()
        .padStart(9, '0')
        .slice(0, 9)
    const phone = `13${tail}`
    const user = await prisma.users.create({
        data: {
            phone,
            name: `pcr_real_${uniqueSuffix()}`.slice(0, 100),
            password: 'test_password_hash',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    createdIds.userIds.push(user.id)
    return user
}

const createIsolatedPointRecord = async (userId: number, pointAmount = 500) => {
    const record = await prisma.pointRecords.create({
        data: {
            userId,
            pointAmount,
            used: 0,
            remaining: pointAmount,
            sourceType: 2,
            effectiveAt: dayjs().subtract(1, 'day').toDate(),
            expiredAt: dayjs().add(30, 'day').toDate(),
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    createdIds.pointRecordIds.push(record.id)
    return record
}

const createIsolatedConsumptionItem = async (pointAmount = 10) => {
    const item = await prisma.pointConsumptionItems.create({
        data: {
            key: `pcr_item_${uniqueSuffix()}`.slice(0, 50),
            group: 'test',
            name: `测试消耗项_${uniqueSuffix()}`.slice(0, 100),
            unit: 'times',
            pointAmount,
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    createdIds.pointConsumptionItemIds.push(item.id)
    return item
}

const withFaultInjection = async (
    run: () => Promise<void>,
    faultMessage = 'injected-fault'
) => {
    const originalPrisma = (globalThis as any).prisma
    ;(globalThis as any).prisma = new Proxy(
        {},
        {
            get: () => {
                throw new Error(faultMessage)
            },
        }
    )
    try {
        await run()
    } finally {
        ;(globalThis as any).prisma = originalPrisma
    }
}

// ---------------- 测试体 ----------------

describe('积分消耗记录 DAO - 真实数据库集成', () => {
    beforeAll(async () => {
        await prisma.$connect()
        // 全量套件中前序测试可能已消耗 sequence，本套件 beforeAll 局部重置
        await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM users), 0), 1000) + 1, false)`)
        await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('point_records', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM point_records), 0), 1000) + 1, false)`)
        await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('point_consumption_records', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM point_consumption_records), 0), 1000) + 1, false)`)
    })

    afterAll(async () => {
        // 按外键依赖顺序 hard delete
        try {
            if (createdIds.pointConsumptionRecordIds.length > 0) {
                await prisma.pointConsumptionRecords.deleteMany({
                    where: {
                        id: { in: createdIds.pointConsumptionRecordIds },
                    },
                })
            }
            // 清理用户产生的遗留消耗记录
            if (createdIds.userIds.length > 0) {
                await prisma.pointConsumptionRecords.deleteMany({
                    where: { userId: { in: createdIds.userIds } },
                })
            }
            if (createdIds.pointRecordIds.length > 0) {
                await prisma.pointConsumptionRecords.deleteMany({
                    where: {
                        pointRecordId: { in: createdIds.pointRecordIds },
                    },
                })
                await prisma.pointRecords.deleteMany({
                    where: { id: { in: createdIds.pointRecordIds } },
                })
            }
            if (createdIds.pointConsumptionItemIds.length > 0) {
                await prisma.pointConsumptionItems.deleteMany({
                    where: {
                        id: { in: createdIds.pointConsumptionItemIds },
                    },
                })
            }
            if (createdIds.userIds.length > 0) {
                await prisma.users.deleteMany({
                    where: { id: { in: createdIds.userIds } },
                })
            }
        } catch (err) {
            console.warn('[pointConsumptionRecords.dao.real] 清理异常：', err)
        }
    })

    // ==================== 正常路径 ====================

    describe('createPointConsumptionRecordDao', () => {
        it('应创建积分消耗记录（最小字段）', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()

            const record = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 10,
                status: 1,
            } as any)
            createdIds.pointConsumptionRecordIds.push(record.id)

            expect(record.id).toBeDefined()
            expect(record.userId).toBe(user.id)
            expect(record.pointRecordId).toBe(pointRecord.id)
            expect(record.itemId).toBe(item.id)
            expect(record.pointAmount).toBe(10)
            expect(record.status).toBe(1)
            expect(record.createdAt).toBeInstanceOf(Date)
            expect(record.updatedAt).toBeInstanceOf(Date)
        })

        it('应支持 tx 事务参数透传创建', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()

            const record = await prisma.$transaction(async (tx) => {
                return createPointConsumptionRecordDao(
                    {
                        userId: user.id,
                        pointRecordId: pointRecord.id,
                        itemId: item.id,
                        pointAmount: 20,
                        status: 2,
                        batchId: `batch_${uniqueSuffix()}`.slice(0, 36),
                        remark: '事务路径',
                    } as any,
                    tx as any
                )
            })
            createdIds.pointConsumptionRecordIds.push(record.id)

            expect(record.id).toBeDefined()
            expect(record.pointAmount).toBe(20)
            expect(record.status).toBe(2)
            expect(record.remark).toBe('事务路径')
        })
    })

    describe('findPointConsumptionRecordsByUserIdDao', () => {
        it('应返回用户的消耗记录列表（含 pointConsumptionItems 关联）并按创建时间倒序', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()

            const r1 = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 5,
                status: 1,
            } as any)
            createdIds.pointConsumptionRecordIds.push(r1.id)
            // 稍作延时，确保 createdAt 有差异（DB 默认精度即可）
            await new Promise((r) => setTimeout(r, 10))
            const r2 = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 7,
                status: 1,
            } as any)
            createdIds.pointConsumptionRecordIds.push(r2.id)

            const result = await findPointConsumptionRecordsByUserIdDao(
                user.id,
                { page: 1, pageSize: 10 }
            )

            expect(result.total).toBe(2)
            expect(result.list.length).toBe(2)
            // 倒序：r2 比 r1 新
            expect(result.list[0].id).toBe(r2.id)
            expect(result.list[1].id).toBe(r1.id)
            // 包含关联的 pointConsumptionItems
            expect(result.list[0].pointConsumptionItems).toBeDefined()
            expect(result.list[0].pointConsumptionItems.id).toBe(item.id)
        })

        it('应支持分页（pageSize=1 只返回一条）', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()

            const r1 = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 5,
                status: 1,
            } as any)
            const r2 = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 6,
                status: 1,
            } as any)
            createdIds.pointConsumptionRecordIds.push(r1.id, r2.id)

            const page1 = await findPointConsumptionRecordsByUserIdDao(
                user.id,
                { page: 1, pageSize: 1 }
            )
            expect(page1.total).toBe(2)
            expect(page1.list.length).toBe(1)

            const page2 = await findPointConsumptionRecordsByUserIdDao(
                user.id,
                { page: 2, pageSize: 1 }
            )
            expect(page2.list.length).toBe(1)
            expect(page2.list[0].id).not.toBe(page1.list[0].id)
        })

        it('应使用默认分页参数（空 options）', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()
            const r = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 3,
                status: 1,
            } as any)
            createdIds.pointConsumptionRecordIds.push(r.id)

            const result = await findPointConsumptionRecordsByUserIdDao(
                user.id,
                {}
            )
            expect(result.total).toBe(1)
            expect(result.list.length).toBe(1)
        })

        it('软删除的消耗记录不应被返回', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()
            const r = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 4,
                status: 1,
            } as any)
            createdIds.pointConsumptionRecordIds.push(r.id)

            await prisma.pointConsumptionRecords.update({
                where: { id: r.id },
                data: { deletedAt: new Date() },
            })

            const result = await findPointConsumptionRecordsByUserIdDao(
                user.id,
                {}
            )
            expect(result.total).toBe(0)
            expect(result.list.length).toBe(0)
        })

        it('应支持 tx 事务参数透传', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()
            const r = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 4,
                status: 1,
            } as any)
            createdIds.pointConsumptionRecordIds.push(r.id)

            const result = await prisma.$transaction(async (tx) => {
                return findPointConsumptionRecordsByUserIdDao(
                    user.id,
                    { page: 1, pageSize: 5 },
                    tx as any
                )
            })
            expect(result.total).toBe(1)
        })
    })

    describe('sumConsumptionByPointRecordIdDao', () => {
        it('无消耗记录时应返回 0', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)

            const sum = await sumConsumptionByPointRecordIdDao(
                pointRecord.id
            )
            expect(sum).toBe(0)
        })

        it('应汇总关联的消耗数量', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()

            const r1 = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 15,
                status: 1,
            } as any)
            const r2 = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 25,
                status: 2,
            } as any)
            createdIds.pointConsumptionRecordIds.push(r1.id, r2.id)

            const sum = await sumConsumptionByPointRecordIdDao(
                pointRecord.id
            )
            expect(sum).toBe(40)
        })

        it('已软删除的记录不应计入汇总', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()

            const r1 = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 15,
                status: 1,
            } as any)
            const r2 = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 25,
                status: 1,
            } as any)
            createdIds.pointConsumptionRecordIds.push(r1.id, r2.id)

            await prisma.pointConsumptionRecords.update({
                where: { id: r2.id },
                data: { deletedAt: new Date() },
            })

            const sum = await sumConsumptionByPointRecordIdDao(
                pointRecord.id
            )
            expect(sum).toBe(15)
        })

        it('应支持 tx 事务参数透传', async () => {
            const user = await createIsolatedUser()
            const pointRecord = await createIsolatedPointRecord(user.id)
            const item = await createIsolatedConsumptionItem()
            const r = await createPointConsumptionRecordDao({
                userId: user.id,
                pointRecordId: pointRecord.id,
                itemId: item.id,
                pointAmount: 33,
                status: 1,
            } as any)
            createdIds.pointConsumptionRecordIds.push(r.id)

            const sum = await prisma.$transaction(async (tx) => {
                return sumConsumptionByPointRecordIdDao(
                    pointRecord.id,
                    tx as any
                )
            })
            expect(sum).toBe(33)
        })
    })

    // ==================== catch 分支 ====================

    describe('catch 分支 - 故障注入', () => {
        it('createPointConsumptionRecordDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    createPointConsumptionRecordDao({
                        userId: 1,
                        pointRecordId: 1,
                        itemId: 1,
                        pointAmount: 1,
                        status: 1,
                    } as any)
                ).rejects.toThrow('injected-fault')
            })
        })

        it('findPointConsumptionRecordsByUserIdDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    findPointConsumptionRecordsByUserIdDao(1, {})
                ).rejects.toThrow('injected-fault')
            })
        })

        it('sumConsumptionByPointRecordIdDao 异常应抛出', async () => {
            await withFaultInjection(async () => {
                await expect(
                    sumConsumptionByPointRecordIdDao(1)
                ).rejects.toThrow('injected-fault')
            })
        })
    })
})
