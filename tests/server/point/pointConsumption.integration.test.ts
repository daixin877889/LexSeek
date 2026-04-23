/**
 * 统一积分服务集成测试
 *
 * 测试 MinerU 服务和 ASR 服务与统一积分服务的集成
 *
 * **Feature: unified-point-service**
 * **Validates: Requirements 1.1, 3.1**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

// 加载测试环境变量（强制指向 .env.testing，避免误连生产库）
config({ path: resolve(__dirname, '../../../.env.testing') })

// 创建测试数据库连接
const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

const testPrisma = createTestPrisma()

// 在导入服务之前设置全局变量
const mockLogger = {
    info: (...args: any[]) => console.log('[INFO]', ...args),
    warn: (...args: any[]) => console.warn('[WARN]', ...args),
    error: (...args: any[]) => console.error('[ERROR]', ...args),
    debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
}
    ; (globalThis as any).logger = mockLogger
    ; (globalThis as any).prisma = testPrisma
    ; (globalThis as any).PointConsumptionItemStatus = { DISABLED: 0, ENABLED: 1 }
    ; (globalThis as any).PointConsumptionRecordStatus = { INVALID: 0, PRE_DEDUCT: 1, SETTLED: 2 }
    ; (globalThis as any).PointRecordStatus = { VALID: 1, MEMBERSHIP_UPGRADE_SETTLEMENT: 2, CANCELLED: 3 }

// 导入服务函数
import { checkPointsService, consumePointsService } from '../../../server/services/point/pointConsumption.service'
import { PointRecordSourceType, PointRecordStatus, PointConsumptionItemStatus } from '../../../shared/types/point.types'

// 测试数据 ID 追踪
const testIds = {
    userIds: [] as number[],
    pointRecordIds: [] as number[],
}

// 生成唯一的测试标识
const generateTestId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 创建测试用户
const createTestUser = async () => {
    const testId = generateTestId()
    const user = await testPrisma.users.create({
        data: {
            phone: `189${Date.now().toString().slice(-8)}`,
            name: `集成测试用户_${testId}`,
            password: 'test_password_hash',
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    testIds.userIds.push(user.id)
    return user
}

// 创建测试积分记录
const createTestPointRecord = async (userId: number, pointAmount: number) => {
    const now = new Date()
    const record = await testPrisma.pointRecords.create({
        data: {
            userId,
            pointAmount,
            used: 0,
            remaining: pointAmount,
            sourceType: PointRecordSourceType.DIRECT_PURCHASE,
            effectiveAt: now,
            expiredAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
            status: PointRecordStatus.VALID,
            createdAt: now,
            updatedAt: now,
        },
    })
    testIds.pointRecordIds.push(record.id)
    return record
}

// 清理测试数据
const cleanupTestData = async () => {
    if (testIds.userIds.length > 0) {
        await testPrisma.pointConsumptionRecords.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
    }
    if (testIds.pointRecordIds.length > 0) {
        await testPrisma.pointRecords.deleteMany({
            where: { id: { in: testIds.pointRecordIds } },
        })
        testIds.pointRecordIds = []
    }
    if (testIds.userIds.length > 0) {
        await testPrisma.pointRecords.deleteMany({
            where: { userId: { in: testIds.userIds } },
        })
        await testPrisma.users.deleteMany({
            where: { id: { in: testIds.userIds } },
        })
        testIds.userIds = []
    }
}

let dbAvailable = false

describe('统一积分服务集成测试', () => {
    beforeAll(async () => {
        try {
            await testPrisma.$connect()
            await testPrisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 3000))`
            await testPrisma.$executeRaw`SELECT setval('point_records_id_seq', GREATEST((SELECT MAX(id) FROM point_records), 3000))`
            dbAvailable = true
        } catch (error) {
            console.warn('数据库连接失败，跳过测试')
            dbAvailable = false
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupTestData()
        }
    })

    afterAll(async () => {
        await testPrisma.$disconnect()
    })

    describe('MinerU 服务集成测试 (doc_parse)', () => {
        it('应能通过 doc_parse key 检查用户积分', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 100)

            // 检查是否有 doc_parse 消耗项目
            const pdfItem = await testPrisma.pointConsumptionItems.findUnique({
                where: { key: 'doc_parse' },
            })

            if (!pdfItem) {
                console.warn('doc_parse 消耗项目不存在，跳过测试')
                return
            }

            const result = await checkPointsService(user.id, 'doc_parse', 10)

            expect(result.sufficient).toBeDefined()
            expect(result.required).toBeDefined()
            expect(result.available).toBe(100)
            expect(result.itemName).toBeDefined()
        })

        it('应能通过 doc_parse key 扣减用户积分', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 100)

            const pdfItem = await testPrisma.pointConsumptionItems.findUnique({
                where: { key: 'doc_parse' },
            })

            if (!pdfItem) {
                console.warn('doc_parse 消耗项目不存在，跳过测试')
                return
            }

            const pageCount = 5
            const expectedConsume = pdfItem.pointAmount * pageCount

            if (expectedConsume > 100) {
                console.warn('积分不足，跳过测试')
                return
            }

            const result = await consumePointsService(user.id, 'doc_parse', pageCount, {
                remark: 'MinerU PDF 解析测试',
            })

            expect(result.consumedAmount).toBe(expectedConsume)
            expect(result.consumptionRecords.length).toBeGreaterThan(0)

            // 验证积分已扣减
            const records = await testPrisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            const remaining = records.reduce((sum, r) => sum + r.remaining, 0)
            expect(remaining).toBe(100 - expectedConsume)
        })
    })

    describe('ASR 服务集成测试 (asr_transcribe)', () => {
        it('应能通过 asr_transcribe key 检查用户积分', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 100)

            const asrItem = await testPrisma.pointConsumptionItems.findUnique({
                where: { key: 'asr_transcribe' },
            })

            if (!asrItem) {
                console.warn('asr_transcribe 消耗项目不存在，跳过测试')
                return
            }

            const result = await checkPointsService(user.id, 'asr_transcribe', 10)

            expect(result.sufficient).toBeDefined()
            expect(result.required).toBeDefined()
            expect(result.available).toBe(100)
            expect(result.itemName).toBeDefined()
        })

        it('应能通过 asr_transcribe key 扣减用户积分', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 100)

            const asrItem = await testPrisma.pointConsumptionItems.findUnique({
                where: { key: 'asr_transcribe' },
            })

            if (!asrItem) {
                console.warn('asr_transcribe 消耗项目不存在，跳过测试')
                return
            }

            const durationMinutes = 5
            const discount = asrItem.discount ? Number(asrItem.discount) : 1
            const expectedConsume = Math.ceil(asrItem.pointAmount * durationMinutes * discount)

            if (expectedConsume > 100) {
                console.warn('积分不足，跳过测试')
                return
            }

            const result = await consumePointsService(user.id, 'asr_transcribe', durationMinutes, {
                remark: 'ASR 语音转录测试',
            })

            expect(result.consumedAmount).toBe(expectedConsume)
            expect(result.consumptionRecords.length).toBeGreaterThan(0)

            // 验证积分已扣减
            const records = await testPrisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            const remaining = records.reduce((sum, r) => sum + r.remaining, 0)
            expect(remaining).toBe(100 - expectedConsume)
        })
    })

    describe('跨服务积分操作测试', () => {
        it('多次不同服务的积分扣减应正确累计', async () => {
            if (!dbAvailable) return

            const user = await createTestUser()
            await createTestPointRecord(user.id, 500)

            const pdfItem = await testPrisma.pointConsumptionItems.findUnique({
                where: { key: 'doc_parse' },
            })
            const asrItem = await testPrisma.pointConsumptionItems.findUnique({
                where: { key: 'asr_transcribe' },
            })

            if (!pdfItem || !asrItem) {
                console.warn('消耗项目不存在，跳过测试')
                return
            }

            // 第一次扣减：PDF 解析
            const pdfDiscount = pdfItem.discount ? Number(pdfItem.discount) : 1
            const pdfConsume = Math.ceil(pdfItem.pointAmount * 3 * pdfDiscount)
            await consumePointsService(user.id, 'doc_parse', 3)

            // 第二次扣减：ASR 转录
            const asrDiscount = asrItem.discount ? Number(asrItem.discount) : 1
            const asrConsume = Math.ceil(asrItem.pointAmount * 2 * asrDiscount)
            await consumePointsService(user.id, 'asr_transcribe', 2)

            // 验证总扣减
            const records = await testPrisma.pointRecords.findMany({
                where: { userId: user.id },
            })
            const remaining = records.reduce((sum, r) => sum + r.remaining, 0)
            expect(remaining).toBe(500 - pdfConsume - asrConsume)
        })
    })
})
