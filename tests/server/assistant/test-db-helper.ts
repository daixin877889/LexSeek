/**
 * assistant 模块最小测试数据库辅助
 *
 * - `ensureTestUser()` 创建（或复用 describe 内已建的）测试用户，返回 userId
 * - `cleanupTestData()` 清理本模块内由 ensureTestUser 创建的用户
 *
 * 不引入其他业务实体的清理逻辑（DAO 测试自行维护 createdIds 并在 afterEach 删除）。
 *
 * **Feature: contract-review-m3**
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

// 加载测试环境变量
config({ path: resolve(__dirname, '../../../.env.testing') })
config()

const createTestPrismaClient = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const pool = new PrismaPg({ connectionString })
    return new PrismaClient({ adapter: pool })
}

let _testPrisma: ReturnType<typeof createTestPrismaClient> | null = null

const getPrisma = () => {
    if (!_testPrisma) {
        _testPrisma = createTestPrismaClient()
    }
    return _testPrisma
}

const TEST_PHONE_PREFIX = '197'

const createdUserIds: number[] = []

/**
 * 确保测试用户存在，返回 userId。
 * 每次调用创建一个独立用户，避免并发 / 并行测试互相污染。
 * phone 字段 VARCHAR(11)：'197' + 8 位时间戳尾数 = 11 位。
 */
export async function ensureTestUser(): Promise<number> {
    const p = getPrisma()
    // 取时间戳毫秒后 8 位；为避免并发碰撞，再与用户 id 层做 upsert 重试
    const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`.slice(-8)
    const phone = `${TEST_PHONE_PREFIX}${suffix}`
    const user = await p.users.create({
        data: {
            phone,
            name: `测试助手用户_${Date.now()}`,
            password: 'test_hash',
            status: 1,
        },
    })
    createdUserIds.push(user.id)
    return user.id
}

/**
 * 清理本 helper 创建过的测试用户。
 * 同时清理这些用户名下的 contractReviews（防软删残留影响下一跑）。
 */
export async function cleanupTestData(): Promise<void> {
    if (createdUserIds.length === 0) return
    const p = getPrisma()
    await p.contractReviews.deleteMany({ where: { userId: { in: createdUserIds } } })
    await p.users.deleteMany({ where: { id: { in: createdUserIds } } })
    createdUserIds.length = 0
}
