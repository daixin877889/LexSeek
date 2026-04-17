/**
 * 法律法规 Service / DAO 真实数据库集成测试
 *
 * 直接调用 server/services/legal/legalMain.service.ts 与 legalMain.dao.ts
 * 中的函数，使用 .env.testing 指向的测试数据库（ls_new_testing）。
 *
 * 目标：
 * - 覆盖 service 中所有公开函数的成功 / 失败 / 边界路径
 * - 单独覆盖 dao 中未被 service 直接调用的函数：
 *   - findLegalMainWithArticlesByIdDao
 *   - updateLegalMainEmbeddingTimeDao
 *   - findInvalidLegalMainIdsDao
 *
 * **Feature: legal-main-real-db-coverage**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'

import {
    getLegalMainListService,
    getLegalMainDetailService,
    createLegalMainService,
    updateLegalMainService,
    deleteLegalMainService,
    syncInvalidStatusService,
    checkLegalCodeExistsService,
    getLegalStatisticsService,
} from '../../../server/services/legal/legalMain.service'
import {
    createLegalMainDao,
    findLegalMainByIdDao,
    findLegalMainByCodeDao,
    findLegalMainListDao,
    updateLegalMainDao,
    deleteLegalMainDao,
    findLegalMainWithArticlesByIdDao,
    updateLegalMainEmbeddingTimeDao,
    findInvalidLegalMainIdsDao,
} from '../../../server/services/legal/legalMain.dao'
import { LegalType, ArticleType } from '../../../shared/types/legal'

// ==================== 测试基础设施 ====================

/** 测试用 prisma 客户端 */
const createTestPrismaClient = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const adapter = new PrismaPg({
        connectionString,
        options: '-c TimeZone=UTC',
    })
    return new PrismaClient({ adapter })
}

const testPrisma = createTestPrismaClient()

// 注入全局变量，供 service / dao 内部自动导入使用
const mockLogger = {
    info: (..._args: any[]) => {},
    warn: (..._args: any[]) => {},
    error: (..._args: any[]) => {},
    debug: (..._args: any[]) => {},
}
;(globalThis as any).logger = mockLogger
;(globalThis as any).prisma = testPrisma

/** 用于跨测试追踪的 ID 列表 */
const createdLegalIds = new Set<string>()

/** 唯一前缀，避免与历史数据冲突 */
const TEST_PREFIX = `__lt_${uuidv7().replace(/-/g, '').slice(0, 8)}__`

/** 生成唯一 code（使用完整 uuid 避免短时间内冲突） */
const uniqueCode = (label: string) => `${TEST_PREFIX}${label}_${uuidv7()}`

/** 生成唯一 name（使用完整 uuid 避免短时间内冲突） */
const uniqueName = (label: string) => `${TEST_PREFIX}${label}_${uuidv7()}`

/** 创建一条法律法规并追踪 ID */
const createTracked = async (overrides: Partial<{
    name: string
    code: string
    type: string
    category: string | null
    content: string
    issuingAuthority: string | null
    documentNumber: string | null
    publishDate: Date | null
    effectiveDate: Date | null
    invalidDate: Date | null
}> = {}) => {
    const legal = await createLegalMainDao({
        name: overrides.name ?? uniqueName('legal'),
        code: overrides.code ?? uniqueCode('code'),
        type: overrides.type ?? LegalType.LAW,
        category: overrides.category ?? null,
        content: overrides.content ?? '测试法律内容',
        issuingAuthority: overrides.issuingAuthority ?? null,
        documentNumber: overrides.documentNumber ?? null,
        publishDate: overrides.publishDate ?? null,
        effectiveDate: overrides.effectiveDate ?? null,
        invalidDate: overrides.invalidDate ?? null,
    })
    createdLegalIds.add(legal.id)
    return legal
}

/** 直接通过 testPrisma 创建一条 article（绕过 service） */
const createTrackedArticle = async (legalId: string, overrides: Partial<{
    type: string
    content: string | null
    l1: string | null
    l2: string | null
    order: number | null
}> = {}) => {
    return testPrisma.legalArticles.create({
        data: {
            legalId,
            type: overrides.type ?? ArticleType.L5,
            content: overrides.content ?? '条文内容',
            l1: overrides.l1 ?? null,
            l2: overrides.l2 ?? null,
            order: overrides.order ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastEditedAt: new Date(),
        },
    })
}

/** 硬清理本测试创建的所有数据 */
const cleanupAll = async () => {
    if (createdLegalIds.size === 0) return
    const ids = Array.from(createdLegalIds)
    try {
        await testPrisma.legalArticles.deleteMany({
            where: { legalId: { in: ids } },
        })
    } catch {
        // ignore
    }
    try {
        await testPrisma.legalMain.deleteMany({
            where: { id: { in: ids } },
        })
    } catch {
        // ignore
    }
    createdLegalIds.clear()
}

// ==================== 测试用例 ====================

describe('legalMain Service / DAO 真实数据库测试', () => {
    beforeAll(async () => {
        await testPrisma.$connect()
    })

    afterEach(async () => {
        await cleanupAll()
    })

    afterAll(async () => {
        await cleanupAll()
        await testPrisma.$disconnect()
    })

    // -------------------- createLegalMainService --------------------

    describe('createLegalMainService', () => {
        it('应成功创建法律法规并返回格式化字段', async () => {
            const code = uniqueCode('create_ok')
            const result = await createLegalMainService({
                name: uniqueName('民法典'),
                code,
                type: LegalType.LAW,
                category: '民法',
                content: '法律全文',
                issuingAuthority: '全国人大',
                documentNumber: '主席令第N号',
                publishDate: '2020-05-28',
                effectiveDate: '2021-01-01',
                invalidDate: null,
            })
            createdLegalIds.add(result.id)

            expect(result.id).toBeTruthy()
            expect(result.code).toBe(code)
            expect(result.publishDate).toBe('2020-05-28')
            expect(result.effectiveDate).toBe('2021-01-01')
            expect(result.invalidDate).toBeNull()
            expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        })

        it('应在创建时支持空可选字段', async () => {
            const result = await createLegalMainService({
                name: uniqueName('简单法'),
                code: uniqueCode('simple'),
                type: LegalType.REGULATION,
                content: '内容',
            } as any)
            createdLegalIds.add(result.id)

            expect(result.publishDate).toBeNull()
            expect(result.effectiveDate).toBeNull()
            expect(result.invalidDate).toBeNull()
            expect(result.category).toBeNull()
        })

        it('应在 code 已存在时抛错', async () => {
            const code = uniqueCode('dup')
            const first = await createTracked({ code })
            expect(first.code).toBe(code)

            await expect(
                createLegalMainService({
                    name: uniqueName('其他法'),
                    code,
                    type: LegalType.LAW,
                    content: '内容',
                } as any)
            ).rejects.toThrow(/已存在/)
        })
    })

    // -------------------- getLegalMainDetailService --------------------

    describe('getLegalMainDetailService', () => {
        it('存在时应返回完整详情', async () => {
            const legal = await createTracked({
                publishDate: new Date('2022-01-01'),
                effectiveDate: new Date('2022-06-01'),
                invalidDate: new Date('2099-12-31'),
            })

            const detail = await getLegalMainDetailService(legal.id)
            expect(detail).not.toBeNull()
            expect(detail!.id).toBe(legal.id)
            expect(detail!.publishDate).toBe('2022-01-01')
            expect(detail!.effectiveDate).toBe('2022-06-01')
            expect(detail!.invalidDate).toBe('2099-12-31')
            expect(detail!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}/)
        })

        it('不存在时应返回 null', async () => {
            const detail = await getLegalMainDetailService(uuidv7())
            expect(detail).toBeNull()
        })
    })

    // -------------------- updateLegalMainService --------------------

    describe('updateLegalMainService', () => {
        it('应成功更新基本字段', async () => {
            const legal = await createTracked()
            const newName = uniqueName('updated')

            const updated = await updateLegalMainService(legal.id, {
                name: newName,
                category: '新分类',
                issuingAuthority: '新机关',
                documentNumber: '新文号',
                publishDate: '2024-01-01',
                effectiveDate: '2024-06-01',
                content: '新内容',
            } as any)

            expect(updated.name).toBe(newName)
            expect(updated.category).toBe('新分类')
            expect(updated.publishDate).toBe('2024-01-01')
            expect(updated.effectiveDate).toBe('2024-06-01')
        })

        it('应在 id 不存在时抛错', async () => {
            await expect(
                updateLegalMainService(uuidv7(), { name: 'x' } as any)
            ).rejects.toThrow(/不存在/)
        })

        it('应在 code 与其他记录冲突时抛错', async () => {
            const legalA = await createTracked()
            const legalB = await createTracked()

            await expect(
                updateLegalMainService(legalB.id, { code: legalA.code } as any)
            ).rejects.toThrow(/已存在/)
        })

        it('应允许将 code 更新为相同值（不触发冲突检查）', async () => {
            const legal = await createTracked()
            const updated = await updateLegalMainService(legal.id, {
                code: legal.code,
                name: uniqueName('same_code'),
            } as any)
            expect(updated.code).toBe(legal.code)
        })

        it('从 null → 有值 时应触发 syncInvalidStatusService', async () => {
            const legal = await createTracked({ invalidDate: null })
            const article = await createTrackedArticle(legal.id, {
                content: '原条文',
            })
            expect(article.invalidDate).toBeNull()

            await updateLegalMainService(legal.id, {
                invalidDate: '2030-01-01',
            } as any)

            const refreshed = await testPrisma.legalArticles.findUnique({
                where: { id: article.id },
            })
            expect(refreshed?.invalidDate).not.toBeNull()
        })

        it('从有值 → null 时应触发 syncInvalidStatusService', async () => {
            const oldDate = new Date('2030-01-01')
            const legal = await createTracked({ invalidDate: oldDate })
            const article = await createTrackedArticle(legal.id, {
                content: '原条文',
            })
            // 先把 article 的 invalidDate 设上
            await testPrisma.legalArticles.update({
                where: { id: article.id },
                data: { invalidDate: oldDate },
            })

            await updateLegalMainService(legal.id, {
                invalidDate: null,
            } as any)

            const refreshed = await testPrisma.legalArticles.findUnique({
                where: { id: article.id },
            })
            expect(refreshed?.invalidDate).toBeNull()
        })

        it('从一个日期 → 另一个不同日期 时应触发同步', async () => {
            const legal = await createTracked({
                invalidDate: new Date('2030-01-01'),
            })
            const article = await createTrackedArticle(legal.id)
            await testPrisma.legalArticles.update({
                where: { id: article.id },
                data: { invalidDate: new Date('2030-01-01') },
            })

            await updateLegalMainService(legal.id, {
                invalidDate: '2040-12-31',
            } as any)

            const refreshed = await testPrisma.legalArticles.findUnique({
                where: { id: article.id },
            })
            expect(refreshed?.invalidDate?.toISOString().slice(0, 10)).toBe('2040-12-31')
        })

        it('当 invalidDate 未变更时不应触发同步（条文 invalidDate 保持原值）', async () => {
            const legal = await createTracked({
                invalidDate: new Date('2030-01-01'),
            })
            const article = await createTrackedArticle(legal.id)
            // 故意把 article 的 invalidDate 留空，验证未被改动
            const before = await testPrisma.legalArticles.findUnique({
                where: { id: article.id },
            })
            expect(before?.invalidDate).toBeNull()

            await updateLegalMainService(legal.id, {
                name: uniqueName('only_name'),
            } as any)

            const after = await testPrisma.legalArticles.findUnique({
                where: { id: article.id },
            })
            expect(after?.invalidDate).toBeNull()
        })
    })

    // -------------------- deleteLegalMainService --------------------

    describe('deleteLegalMainService', () => {
        it('应能软删除并级联软删除关联条文', async () => {
            const legal = await createTracked()
            const article = await createTrackedArticle(legal.id)

            await deleteLegalMainService(legal.id)

            const refreshedLegal = await testPrisma.legalMain.findUnique({
                where: { id: legal.id },
            })
            expect(refreshedLegal?.deletedAt).not.toBeNull()

            const refreshedArticle = await testPrisma.legalArticles.findUnique({
                where: { id: article.id },
            })
            expect(refreshedArticle?.deletedAt).not.toBeNull()
        })

        it('id 不存在时应抛错', async () => {
            await expect(
                deleteLegalMainService(uuidv7())
            ).rejects.toThrow(/不存在/)
        })
    })

    // -------------------- syncInvalidStatusService --------------------

    describe('syncInvalidStatusService', () => {
        it('应批量更新条文 invalidDate 字段（写库生效）', async () => {
            const legal = await createTracked()
            const a1 = await createTrackedArticle(legal.id, { order: 1 })
            const a2 = await createTrackedArticle(legal.id, { order: 2 })

            const newDate = new Date('2050-06-15')
            await syncInvalidStatusService(legal.id, newDate)

            const refreshed1 = await testPrisma.legalArticles.findUnique({
                where: { id: a1.id },
            })
            const refreshed2 = await testPrisma.legalArticles.findUnique({
                where: { id: a2.id },
            })
            expect(refreshed1?.invalidDate?.toISOString().slice(0, 10)).toBe('2050-06-15')
            expect(refreshed2?.invalidDate?.toISOString().slice(0, 10)).toBe('2050-06-15')
        })

        it('传 null 时应清空条文 invalidDate', async () => {
            const legal = await createTracked()
            const article = await createTrackedArticle(legal.id)
            await testPrisma.legalArticles.update({
                where: { id: article.id },
                data: { invalidDate: new Date('2030-01-01') },
            })

            await syncInvalidStatusService(legal.id, null)

            const refreshed = await testPrisma.legalArticles.findUnique({
                where: { id: article.id },
            })
            expect(refreshed?.invalidDate).toBeNull()
        })
    })

    // -------------------- checkLegalCodeExistsService --------------------

    describe('checkLegalCodeExistsService', () => {
        it('不存在的 code 应返回 false', async () => {
            const exists = await checkLegalCodeExistsService(uniqueCode('nope'))
            expect(exists).toBe(false)
        })

        it('存在的 code 应返回 true', async () => {
            const legal = await createTracked()
            const exists = await checkLegalCodeExistsService(legal.code)
            expect(exists).toBe(true)
        })

        it('使用 excludeId 自身时应返回 false', async () => {
            const legal = await createTracked()
            const exists = await checkLegalCodeExistsService(legal.code, legal.id)
            expect(exists).toBe(false)
        })

        it('excludeId 与命中的不一致时仍返回 true', async () => {
            const legal = await createTracked()
            const exists = await checkLegalCodeExistsService(legal.code, uuidv7())
            expect(exists).toBe(true)
        })
    })

    // -------------------- getLegalStatisticsService --------------------

    describe('getLegalStatisticsService', () => {
        it('id 不存在时应返回 null', async () => {
            const stats = await getLegalStatisticsService(uuidv7())
            expect(stats).toBeNull()
        })

        it('应返回总条文数与 articlesByType 分布', async () => {
            const legal = await createTracked()
            await createTrackedArticle(legal.id, { type: ArticleType.L1, order: 1 })
            await createTrackedArticle(legal.id, { type: ArticleType.L1, order: 2 })
            await createTrackedArticle(legal.id, { type: ArticleType.L2, order: 3 })
            await createTrackedArticle(legal.id, { type: ArticleType.L5, order: 4 })
            await createTrackedArticle(legal.id, { type: ArticleType.NOTICE, order: 5 })

            const stats = await getLegalStatisticsService(legal.id)
            expect(stats).not.toBeNull()
            expect(stats!.totalArticles).toBe(5)
            expect(stats!.articlesByType.l1).toBe(2)
            expect(stats!.articlesByType.l2).toBe(1)
            expect(stats!.articlesByType.l5).toBe(1)
            expect(stats!.articlesByType.notice).toBe(1)
            // 没有创建过 embedding，应为 0
            expect(stats!.embeddedArticles).toBe(0)
            expect(stats!.notEmbeddedArticles).toBe(5)
        })

        it('未知 type 不应计入 articlesByType（不在白名单的 type 被忽略）', async () => {
            const legal = await createTracked()
            // 使用一个非枚举的 type 字符串，模拟旧数据
            await createTrackedArticle(legal.id, { type: 'unknown_type' as any })

            const stats = await getLegalStatisticsService(legal.id)
            expect(stats!.totalArticles).toBe(1)
            // 所有已知 type 都应为 0
            expect(stats!.articlesByType.l1).toBe(0)
            expect(stats!.articlesByType.l5).toBe(0)
        })

        it('无条文时应返回全 0 分布', async () => {
            const legal = await createTracked()
            const stats = await getLegalStatisticsService(legal.id)
            expect(stats!.totalArticles).toBe(0)
            expect(stats!.embeddedArticles).toBe(0)
            expect(stats!.notEmbeddedArticles).toBe(0)
            for (const v of Object.values(stats!.articlesByType)) {
                expect(v).toBe(0)
            }
        })
    })

    // -------------------- getLegalMainListService --------------------

    describe('getLegalMainListService', () => {
        it('应支持 keyword 模糊搜索（按 name）', async () => {
            const uniqueLabel = uniqueName('keyword_search_target')
            const target = await createTracked({ name: uniqueLabel })
            // 制造一条噪声
            await createTracked()

            const result = await getLegalMainListService({
                page: 1,
                pageSize: 10,
                keyword: uniqueLabel,
            } as any)

            expect(result.total).toBe(1)
            expect(result.items[0]?.id).toBe(target.id)
            expect(result.totalPages).toBe(1)
        })

        it('应支持按 documentNumber 搜索', async () => {
            const docNo = `__lt_doc_${uuidv7().slice(0, 8)}`
            const target = await createTracked({ documentNumber: docNo })
            await createTracked()

            const result = await getLegalMainListService({
                keyword: docNo,
            } as any)
            expect(result.items.find(i => i.id === target.id)).toBeTruthy()
        })

        it('应支持按 type 精确筛选', async () => {
            const targetType = LegalType.JUDICIAL_INTERP
            const target = await createTracked({
                type: targetType,
                name: uniqueName('judicial'),
            })
            await createTracked({ type: LegalType.LAW })

            const result = await getLegalMainListService({
                type: targetType,
                keyword: target.name,
            } as any)
            expect(result.items.length).toBeGreaterThanOrEqual(1)
            expect(result.items.every(i => i.type === targetType)).toBe(true)
        })

        it('应支持按 issuingAuthority 模糊筛选', async () => {
            const authority = `__lt_auth_${uuidv7().slice(0, 8)}`
            const target = await createTracked({ issuingAuthority: authority })

            const result = await getLegalMainListService({
                issuingAuthority: authority,
            } as any)
            expect(result.items.find(i => i.id === target.id)).toBeTruthy()
        })

        it('应支持 status=valid 过滤', async () => {
            const validLegal = await createTracked({
                name: uniqueName('valid_target'),
                effectiveDate: new Date('2000-01-01'),
                invalidDate: null,
            })
            const invalidLegal = await createTracked({
                name: uniqueName('invalid_target'),
                effectiveDate: new Date('2000-01-01'),
                invalidDate: new Date('2001-01-01'),
            })
            const pendingLegal = await createTracked({
                name: uniqueName('pending_target'),
                effectiveDate: new Date('2999-01-01'),
                invalidDate: null,
            })

            // valid 列表应包含 validLegal，但不包含 invalidLegal / pendingLegal
            const validResult = await getLegalMainListService({
                status: 'valid',
                keyword: TEST_PREFIX,
                pageSize: 100,
            } as any)
            const validIds = validResult.items.map(i => i.id)
            expect(validIds).toContain(validLegal.id)
            expect(validIds).not.toContain(invalidLegal.id)
            expect(validIds).not.toContain(pendingLegal.id)
        })

        it('应支持 status=invalid 过滤', async () => {
            const invalidLegal = await createTracked({
                name: uniqueName('inv'),
                invalidDate: new Date('2001-01-01'),
            })
            const validLegal = await createTracked({
                name: uniqueName('val'),
                invalidDate: null,
            })

            const result = await getLegalMainListService({
                status: 'invalid',
                keyword: TEST_PREFIX,
                pageSize: 100,
            } as any)
            const ids = result.items.map(i => i.id)
            expect(ids).toContain(invalidLegal.id)
            expect(ids).not.toContain(validLegal.id)
        })

        it('应支持 status=pending 过滤', async () => {
            const pendingLegal = await createTracked({
                name: uniqueName('pending'),
                effectiveDate: new Date('2999-01-01'),
            })
            const validLegal = await createTracked({
                name: uniqueName('val2'),
                effectiveDate: new Date('2000-01-01'),
            })

            const result = await getLegalMainListService({
                status: 'pending',
                keyword: TEST_PREFIX,
                pageSize: 100,
            } as any)
            const ids = result.items.map(i => i.id)
            expect(ids).toContain(pendingLegal.id)
            expect(ids).not.toContain(validLegal.id)
        })

        it('应支持分页（page 与 pageSize）', async () => {
            const namePrefix = uniqueName('paging')
            for (let i = 0; i < 3; i++) {
                await createTracked({ name: `${namePrefix}_${i}` })
            }

            const page1 = await getLegalMainListService({
                page: 1,
                pageSize: 2,
                keyword: namePrefix,
            } as any)
            const page2 = await getLegalMainListService({
                page: 2,
                pageSize: 2,
                keyword: namePrefix,
            } as any)

            expect(page1.total).toBe(3)
            expect(page1.items.length).toBe(2)
            expect(page1.totalPages).toBe(2)
            expect(page2.items.length).toBe(1)

            // 两页之间不重复
            const page1Ids = new Set(page1.items.map(i => i.id))
            for (const item of page2.items) {
                expect(page1Ids.has(item.id)).toBe(false)
            }
        })

        it('应支持按 name 升序排序', async () => {
            const namePrefix = uniqueName('order_test')
            await createTracked({ name: `${namePrefix}_C` })
            await createTracked({ name: `${namePrefix}_A` })
            await createTracked({ name: `${namePrefix}_B` })

            const result = await getLegalMainListService({
                page: 1,
                pageSize: 10,
                keyword: namePrefix,
                sortBy: 'name',
                sortOrder: 'asc',
            } as any)

            const names = result.items.map(i => i.name)
            const sorted = [...names].sort()
            expect(names).toEqual(sorted)
        })

        it('未指定 query 时应使用默认 page=1 / pageSize=10', async () => {
            const result = await getLegalMainListService({} as any)
            expect(result.page).toBe(1)
            expect(result.pageSize).toBe(10)
            expect(result.totalPages).toBeGreaterThanOrEqual(0)
        })
    })

    // -------------------- DAO 单独覆盖 --------------------

    describe('findLegalMainWithArticlesByIdDao', () => {
        it('应返回包含已排序条文的法律法规', async () => {
            const legal = await createTracked()
            await createTrackedArticle(legal.id, { order: 3, content: 'A' })
            await createTrackedArticle(legal.id, { order: 1, content: 'B' })
            await createTrackedArticle(legal.id, { order: 2, content: 'C' })

            const found = await findLegalMainWithArticlesByIdDao(legal.id)
            expect(found).not.toBeNull()
            expect(found!.legalArticles.length).toBe(3)
            // 按 order 升序
            const orders = found!.legalArticles.map(a => a.order)
            expect(orders).toEqual([1, 2, 3])
        })

        it('id 不存在时应返回 null', async () => {
            const found = await findLegalMainWithArticlesByIdDao(uuidv7())
            expect(found).toBeNull()
        })

        it('已删除的法律应返回 null', async () => {
            const legal = await createTracked()
            await deleteLegalMainDao(legal.id)
            const found = await findLegalMainWithArticlesByIdDao(legal.id)
            expect(found).toBeNull()
        })
    })

    describe('updateLegalMainEmbeddingTimeDao', () => {
        it('应将 lastEmbeddingAt 更新为当前时间', async () => {
            const legal = await createTracked()
            expect(legal.lastEmbeddingAt).toBeNull()

            const before = Date.now()
            const updated = await updateLegalMainEmbeddingTimeDao(legal.id)
            const after = Date.now()

            expect(updated.lastEmbeddingAt).not.toBeNull()
            const ts = updated.lastEmbeddingAt!.getTime()
            // 容许 5 秒误差
            expect(ts).toBeGreaterThanOrEqual(before - 5000)
            expect(ts).toBeLessThanOrEqual(after + 5000)
        })
    })

    describe('findInvalidLegalMainIdsDao', () => {
        it('应返回 invalidDate <= now 的法律 id 列表', async () => {
            const past = await createTracked({
                invalidDate: new Date('2000-01-01'),
            })
            const future = await createTracked({
                invalidDate: new Date('2999-01-01'),
            })
            const noInvalid = await createTracked({ invalidDate: null })

            const ids = await findInvalidLegalMainIdsDao()
            expect(ids).toContain(past.id)
            expect(ids).not.toContain(future.id)
            expect(ids).not.toContain(noInvalid.id)
        })
    })

    // -------------------- 直接覆盖 DAO 错误分支 --------------------

    describe('DAO 错误分支', () => {
        it('updateLegalMainDao 在 id 不存在时应抛错', async () => {
            await expect(
                updateLegalMainDao(uuidv7(), { name: 'x' })
            ).rejects.toThrow()
        })

        it('deleteLegalMainDao 在 id 不存在时应抛错', async () => {
            await expect(
                deleteLegalMainDao(uuidv7())
            ).rejects.toThrow()
        })

        it('updateLegalMainEmbeddingTimeDao 在 id 不存在时应抛错', async () => {
            await expect(
                updateLegalMainEmbeddingTimeDao(uuidv7())
            ).rejects.toThrow()
        })

        it('findLegalMainByIdDao / findLegalMainByCodeDao 不存在时应返回 null', async () => {
            expect(await findLegalMainByIdDao(uuidv7())).toBeNull()
            expect(await findLegalMainByCodeDao(uniqueCode('not_found'))).toBeNull()
        })

        it('findLegalMainListDao 默认参数与无匹配时返回空列表', async () => {
            const result = await findLegalMainListDao({
                keyword: `__no_such_prefix_${uuidv7()}`,
            })
            expect(result.list.length).toBe(0)
            expect(result.total).toBe(0)
        })

        // 通过临时替换全局 prisma 为会抛错的客户端，覆盖 catch 分支
        it('findLegalMainListDao 在 prisma 失败时应记录并重抛错误', async () => {
            const originalPrisma = (globalThis as any).prisma
            const failingPrisma = {
                legalMain: {
                    findMany: () => Promise.reject(new Error('boom-find-many')),
                    count: () => Promise.reject(new Error('boom-count')),
                },
            }
            ;(globalThis as any).prisma = failingPrisma
            try {
                await expect(
                    findLegalMainListDao({ page: 1, pageSize: 5 })
                ).rejects.toThrow(/boom-/)
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('findInvalidLegalMainIdsDao 在 prisma 失败时应记录并重抛错误', async () => {
            const originalPrisma = (globalThis as any).prisma
            const failingPrisma = {
                legalMain: {
                    findMany: () => Promise.reject(new Error('boom-invalid-ids')),
                },
            }
            ;(globalThis as any).prisma = failingPrisma
            try {
                await expect(
                    findInvalidLegalMainIdsDao()
                ).rejects.toThrow(/boom-invalid-ids/)
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('createLegalMainDao 在 prisma 失败时应记录并重抛错误', async () => {
            const originalPrisma = (globalThis as any).prisma
            const failingPrisma = {
                legalMain: {
                    create: () => Promise.reject(new Error('boom-create')),
                },
            }
            ;(globalThis as any).prisma = failingPrisma
            try {
                await expect(
                    createLegalMainDao({
                        name: 'x',
                        code: 'y',
                        type: LegalType.LAW,
                        content: 'z',
                    } as any)
                ).rejects.toThrow(/boom-create/)
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('findLegalMainByIdDao 在 prisma 失败时应记录并重抛错误', async () => {
            const originalPrisma = (globalThis as any).prisma
            const failingPrisma = {
                legalMain: {
                    findUnique: () => Promise.reject(new Error('boom-find-id')),
                },
            }
            ;(globalThis as any).prisma = failingPrisma
            try {
                await expect(
                    findLegalMainByIdDao(uuidv7())
                ).rejects.toThrow(/boom-find-id/)
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('findLegalMainByCodeDao 在 prisma 失败时应记录并重抛错误', async () => {
            const originalPrisma = (globalThis as any).prisma
            const failingPrisma = {
                legalMain: {
                    findFirst: () => Promise.reject(new Error('boom-find-code')),
                },
            }
            ;(globalThis as any).prisma = failingPrisma
            try {
                await expect(
                    findLegalMainByCodeDao('any-code')
                ).rejects.toThrow(/boom-find-code/)
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })

        it('findLegalMainWithArticlesByIdDao 在 prisma 失败时应记录并重抛错误', async () => {
            const originalPrisma = (globalThis as any).prisma
            const failingPrisma = {
                legalMain: {
                    findUnique: () => Promise.reject(new Error('boom-find-with-articles')),
                },
            }
            ;(globalThis as any).prisma = failingPrisma
            try {
                await expect(
                    findLegalMainWithArticlesByIdDao(uuidv7())
                ).rejects.toThrow(/boom-find-with-articles/)
            } finally {
                ;(globalThis as any).prisma = originalPrisma
            }
        })
    })
})
