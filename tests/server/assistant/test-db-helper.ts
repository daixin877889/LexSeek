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

// 加载测试环境变量（强制指向 .env.testing，避免误连生产库）
config({ path: resolve(__dirname, '../../../.env.testing') })

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
 * 同时清理这些用户名下的 contractReviews / cases / document_drafts / document_templates
 * （防软删残留 + FK 阻塞影响下一跑）。
 */
export async function cleanupTestData(): Promise<void> {
    if (createdUserIds.length === 0) return
    const p = getPrisma()

    // contract 相关
    const reviews = await p.contractReviews.findMany({
        where: { userId: { in: createdUserIds } },
        select: { id: true },
    })
    if (reviews.length > 0) {
        const reviewIds = reviews.map(r => r.id)
        await p.contractRisks.deleteMany({ where: { reviewId: { in: reviewIds } } })
        await p.contractAnnotations.deleteMany({ where: { reviewId: { in: reviewIds } } })
        await p.contractReviewVersions.deleteMany({ where: { reviewId: { in: reviewIds } } })
    }
    await p.contractAnnotations.deleteMany({ where: { authorUserId: { in: createdUserIds } } })
    await p.contractReviewVersions.deleteMany({ where: { createdById: { in: createdUserIds } } })
    await p.contractReviews.deleteMany({ where: { userId: { in: createdUserIds } } })

    // 案件 + 关联
    const cases = await p.cases.findMany({
        where: { userId: { in: createdUserIds } },
        select: { id: true },
    })
    const caseIds = cases.map(c => c.id)
    if (caseIds.length > 0) {
        await p.caseAnalyses.deleteMany({ where: { caseId: { in: caseIds } } })
        await p.caseMaterials.deleteMany({ where: { caseId: { in: caseIds } } })
        // 双绑 / draft-only 也需要清
        await (p as any).$executeRaw`DELETE FROM case_materials WHERE draft_id IN (SELECT id FROM document_drafts WHERE user_id = ANY(${createdUserIds}::integer[]))`
        await p.caseSessions.deleteMany({ where: { caseId: { in: caseIds } } })
    }

    // document_* 链（snapshots/versions → drafts → templates）
    await (p as any).$executeRaw`DELETE FROM document_draft_snapshots WHERE draft_id IN (SELECT id FROM document_drafts WHERE user_id = ANY(${createdUserIds}::integer[]))`
    await (p as any).$executeRaw`DELETE FROM document_draft_versions WHERE draft_id IN (SELECT id FROM document_drafts WHERE user_id = ANY(${createdUserIds}::integer[]))`
    await (p as any).$executeRaw`DELETE FROM case_materials WHERE draft_id IN (SELECT id FROM document_drafts WHERE user_id = ANY(${createdUserIds}::integer[]))`
    await (p as any).$executeRaw`DELETE FROM document_drafts WHERE user_id = ANY(${createdUserIds}::integer[])`
    await (p as any).$executeRaw`DELETE FROM document_templates WHERE user_id = ANY(${createdUserIds}::integer[])`

    if (caseIds.length > 0) {
        await p.cases.deleteMany({ where: { id: { in: caseIds } } })
    }

    await p.users.deleteMany({ where: { id: { in: createdUserIds } } })
    createdUserIds.length = 0
}
