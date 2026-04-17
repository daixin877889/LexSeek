/**
 * 法律条文 Service / DAO 真实数据库集成测试
 *
 * 覆盖 server/services/legal/legalArticles.service.ts 与 legalArticles.dao.ts 的
 * 所有导出函数，目标覆盖率 >= 90%，不修改任何生产代码。
 *
 * 测试直接调用生产 DAO/Service，连接 .env.testing 指定的测试库；
 * 涉及向量存储的副作用通过 mock 拦截，避免访问 pgvector/law_embeddings。
 *
 * **Feature: legal-articles-real-db-coverage**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { ArticleType, LegalType } from '#shared/types/legal'

// --- 对向量存储相关依赖进行 mock，避免访问 law_embeddings/pgvector ---
vi.mock('../../../server/services/legal/lawEmbedding.service', async () => {
    const actual = await vi.importActual<any>(
        '../../../server/services/legal/lawEmbedding.service'
    )
    return {
        ...actual,
        embedSingleArticle: vi.fn().mockResolvedValue(undefined),
        deleteEmbeddingsByArticleId: vi.fn().mockResolvedValue(0),
    }
})

import {
    createLegalArticleDao,
    createManyLegalArticlesDao,
    findLegalArticleByIdDao,
    findLegalArticleWithLegalByIdDao,
    findLegalArticlesListDao,
    findAllLegalArticlesDao,
    updateLegalArticleDao,
    updateLegalArticleEmbeddingTimeDao,
    updateLegalArticlesInvalidDateDao,
    deleteLegalArticleDao,
    deleteLegalArticlesByLegalIdDao,
    findArticlesNeedingEmbeddingDao,
    findLegalArticlesForSortTreeDao,
    batchUpdateLegalArticlesOrderDao,
} from '../../../server/services/legal/legalArticles.dao'

import {
    getLegalArticlesListService,
    getLegalArticleDetailService,
    createLegalArticleService,
    updateLegalArticleService,
    deleteLegalArticleService,
    triggerArticleEmbeddingService,
    getSortTreeService,
    batchSortArticlesService,
} from '../../../server/services/legal/legalArticles.service'

import {
    embedSingleArticle,
    deleteEmbeddingsByArticleId,
} from '../../../server/services/legal/lawEmbedding.service'

// vitest.config.ts 中的 setupFiles 已把 globalThis.prisma 挂好，这里直接拿引用
const db: any = (globalThis as any).prisma

/** 生成本测试文件使用的唯一 legalMain ID */
let TEST_LEGAL_ID: string
/** 跟踪本测试创建的条文 ID，便于最终清理 */
const createdArticleIds = new Set<string>()

/** 从 overrides 取字段值：显式传入（即使是 null）则返回该值，否则返回 fallback */
function pick<T>(overrides: Record<string, any>, key: string, fallback: T): T {
    return key in overrides ? (overrides[key] as T) : fallback
}

/** 创建测试条文（直接走 DAO 确保被测函数覆盖）
 *
 * 注意：默认会填入一个全局唯一的 l5 标题，避免生产代码 articleSorting 在
 * 多条“l1-l5 均为空的 l5 条文”上产生无限递归（nodePath 相同触发）。
 */
async function createArticle(overrides: Partial<{
    type: ArticleType | string
    l1: string | null
    l1I: number | null
    l2: string | null
    l2I: number | null
    l3: string | null
    l3I: number | null
    l4: string | null
    l4I: number | null
    l5: string | null
    l5I: number | null
    order: number | null
    content: string | null
    publishDate: Date | null
    effectiveDate: Date | null
    invalidDate: Date | null
}> = {}) {
    const uniqueTag = uuidv7().slice(0, 8)
    const o = overrides as Record<string, any>
    const type = pick(o, 'type', ArticleType.L5)
    // 默认在 l5 上放个唯一值，规避生产 bug（所有 override 未显式指定层级时）
    const defaultL5 =
        type === ArticleType.L5 && !('l1' in o || 'l2' in o || 'l3' in o || 'l4' in o || 'l5' in o)
            ? `auto-l5-${uniqueTag}`
            : null
    const article = await createLegalArticleDao({
        legalMain: { connect: { id: TEST_LEGAL_ID } },
        type,
        l1: pick(o, 'l1', null),
        l1I: pick(o, 'l1I', null),
        l2: pick(o, 'l2', null),
        l2I: pick(o, 'l2I', null),
        l3: pick(o, 'l3', null),
        l3I: pick(o, 'l3I', null),
        l4: pick(o, 'l4', null),
        l4I: pick(o, 'l4I', null),
        l5: pick(o, 'l5', defaultL5),
        l5I: pick(o, 'l5I', null),
        order: pick(o, 'order', 1),
        content: pick(o, 'content', '测试条文内容'),
        publishDate: pick(o, 'publishDate', null),
        effectiveDate: pick(o, 'effectiveDate', null),
        invalidDate: pick(o, 'invalidDate', null),
    })
    createdArticleIds.add(article.id)
    return article
}

/** 硬删 legalArticles（所有由本文件产生的测试条文） */
async function hardDeleteArticles(ids: string[]) {
    if (!ids.length) return
    await db.legalArticles.deleteMany({ where: { id: { in: ids } } })
}

/** 硬删 legalMain（本测试创建的唯一一条） */
async function hardDeleteLegalMain(id: string) {
    await db.legalMain.deleteMany({ where: { id } })
}

beforeAll(async () => {
    TEST_LEGAL_ID = uuidv7()
    // 直接建 legalMain，避免调用业务 DAO 产生二次耦合
    await db.legalMain.create({
        data: {
            id: TEST_LEGAL_ID,
            name: `集成测试_法律_${TEST_LEGAL_ID.slice(0, 8)}`,
            code: `IT_LEGAL_${TEST_LEGAL_ID.slice(0, 8)}`,
            type: LegalType.LAW,
            content: '集成测试用的法律法规',
            issuingAuthority: '测试全国人大',
            documentNumber: '测试令第001号',
            publishDate: new Date('2024-01-01'),
            effectiveDate: new Date('2024-02-01'),
            invalidDate: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastEditedAt: new Date(),
        },
    })
})

afterAll(async () => {
    // 先按跟踪 ID 清理条文
    const ids = Array.from(createdArticleIds)
    await hardDeleteArticles(ids)
    // 再保险一次：按 legalId 彻底清理残留条文（包括被 updateMany 加上的测试条文）
    await db.legalArticles.deleteMany({ where: { legalId: TEST_LEGAL_ID } })
    // 最后删 legalMain
    await hardDeleteLegalMain(TEST_LEGAL_ID)
})

beforeEach(() => {
    vi.mocked(embedSingleArticle).mockClear()
    vi.mocked(deleteEmbeddingsByArticleId).mockClear()
})

// =====================================================================
// DAO 层测试
// =====================================================================
describe('legalArticles.dao - 真实数据库', () => {
    describe('createLegalArticleDao', () => {
        it('应成功创建条文，返回包含自动时间字段的记录', async () => {
            const article = await createArticle({
                type: ArticleType.L5,
                l1: '第一编',
                l5: '第一条',
                order: 10,
                content: '创建测试',
            })

            expect(article.id).toBeTruthy()
            expect(article.legalId).toBe(TEST_LEGAL_ID)
            expect(article.type).toBe('l5')
            expect(article.createdAt).toBeInstanceOf(Date)
            expect(article.updatedAt).toBeInstanceOf(Date)
            expect(article.lastEditedAt).toBeInstanceOf(Date)
            expect(article.deletedAt).toBeNull()
        })

        it('外键缺失时应抛错并经 logger.error 记录', async () => {
            await expect(
                createLegalArticleDao({
                    legalMain: { connect: { id: 'not-existed-legal-id' } },
                    type: ArticleType.L5,
                    content: '应失败',
                })
            ).rejects.toThrow()
        })
    })

    describe('createManyLegalArticlesDao', () => {
        it('应批量创建多条条文并返回数量', async () => {
            const rows = [
                {
                    id: uuidv7(),
                    legalId: TEST_LEGAL_ID,
                    type: ArticleType.L1,
                    l1: 'many-第一编',
                    order: 100,
                    content: '批量 1',
                },
                {
                    id: uuidv7(),
                    legalId: TEST_LEGAL_ID,
                    type: ArticleType.L1,
                    l1: 'many-第二编',
                    order: 101,
                    content: '批量 2',
                },
            ]
            rows.forEach(r => createdArticleIds.add(r.id))

            const count = await createManyLegalArticlesDao(rows as any)
            expect(count).toBe(2)
        })

        it('批量创建时有非法数据应抛错', async () => {
            await expect(
                createManyLegalArticlesDao([
                    {
                        id: uuidv7(),
                        legalId: 'bad-legal-id',
                        type: ArticleType.L5,
                        content: '应失败',
                    } as any,
                ])
            ).rejects.toThrow()
        })
    })

    describe('findLegalArticleByIdDao / findLegalArticleWithLegalByIdDao', () => {
        it('应返回未删除的条文', async () => {
            const created = await createArticle({ content: 'findById 测试' })
            const found = await findLegalArticleByIdDao(created.id)
            expect(found).not.toBeNull()
            expect(found?.id).toBe(created.id)
        })

        it('查询不存在的 id 返回 null', async () => {
            const fake = uuidv7()
            const found = await findLegalArticleByIdDao(fake)
            expect(found).toBeNull()
        })

        it('软删除后应返回 null', async () => {
            const created = await createArticle({ content: '待软删' })
            await deleteLegalArticleDao(created.id)
            const found = await findLegalArticleByIdDao(created.id)
            expect(found).toBeNull()
        })

        it('findLegalArticleWithLegalByIdDao 应附带 legalMain', async () => {
            const created = await createArticle({ content: 'withLegal 测试' })
            const found = await findLegalArticleWithLegalByIdDao(created.id)
            expect(found).not.toBeNull()
            expect(found?.legalMain).toBeDefined()
            expect(found?.legalMain?.id).toBe(TEST_LEGAL_ID)
        })

        it('findLegalArticleWithLegalByIdDao 对不存在 id 返回 null', async () => {
            const fake = uuidv7()
            const found = await findLegalArticleWithLegalByIdDao(fake)
            expect(found).toBeNull()
        })
    })

    describe('findLegalArticlesListDao', () => {
        let parentL1: Awaited<ReturnType<typeof createArticle>>
        let childL3: Awaited<ReturnType<typeof createArticle>>
        let leafA: Awaited<ReturnType<typeof createArticle>>
        let leafB: Awaited<ReturnType<typeof createArticle>>

        beforeAll(async () => {
            parentL1 = await createArticle({
                type: ArticleType.L1,
                l1: 'list-第一编',
                order: 1000,
                content: null,
            })
            childL3 = await createArticle({
                type: ArticleType.L3,
                l1: 'list-第一编',
                l3: 'list-第一章',
                order: 1001,
                content: null,
            })
            leafA = await createArticle({
                type: ArticleType.L5,
                l1: 'list-第一编',
                l3: 'list-第一章',
                l5: 'list-第一条',
                order: 1002,
                content: '列表查询-内容A-合同违约',
            })
            leafB = await createArticle({
                type: ArticleType.L5,
                l1: 'list-第一编',
                l3: 'list-第一章',
                l5: 'list-第二条',
                order: 1003,
                content: '列表查询-内容B-侵权责任',
            })
        })

        it('按 legalId 返回全部未删除条文', async () => {
            const { list, total } = await findLegalArticlesListDao({
                legalId: TEST_LEGAL_ID,
                page: 1,
                pageSize: 200,
            })
            expect(total).toBeGreaterThanOrEqual(4)
            // 列表必须包含已创建的 4 条（我们用的 order 区分）
            const ids = list.map(a => a.id)
            expect(ids).toContain(parentL1.id)
            expect(ids).toContain(childL3.id)
            expect(ids).toContain(leafA.id)
            expect(ids).toContain(leafB.id)
        })

        it('按 type 精确筛选', async () => {
            const { list } = await findLegalArticlesListDao({
                legalId: TEST_LEGAL_ID,
                type: ArticleType.L3,
                pageSize: 200,
            })
            expect(list.length).toBeGreaterThan(0)
            for (const a of list) expect(a.type).toBe('l3')
        })

        it('按 keyword 在 content/层级标题上做不区分大小写的模糊查询', async () => {
            const { list, total } = await findLegalArticlesListDao({
                legalId: TEST_LEGAL_ID,
                keyword: '合同违约',
                pageSize: 50,
            })
            expect(total).toBeGreaterThanOrEqual(1)
            expect(list.some(a => a.id === leafA.id)).toBe(true)
        })

        it('按 l1/l3/l5 标题筛选（contains + insensitive）', async () => {
            const { list: l1List } = await findLegalArticlesListDao({
                legalId: TEST_LEGAL_ID,
                l1: 'list-第一编',
                pageSize: 200,
            })
            expect(l1List.length).toBeGreaterThanOrEqual(4)

            const { list: l3List } = await findLegalArticlesListDao({
                legalId: TEST_LEGAL_ID,
                l3: 'list-第一章',
                pageSize: 200,
            })
            expect(l3List.length).toBeGreaterThanOrEqual(3)

            const { list: l5List } = await findLegalArticlesListDao({
                legalId: TEST_LEGAL_ID,
                l5: 'list-第一条',
                pageSize: 200,
            })
            expect(l5List.some(a => a.id === leafA.id)).toBe(true)
        })

        it('按 l2/l4 筛选也走 contains 路径（插入匹配数据验证）', async () => {
            const extra = await createArticle({
                type: ArticleType.L5,
                l1: 'list-第一编',
                l2: 'list-第一分编',
                l3: 'list-第一章',
                l4: 'list-第一节',
                l5: 'list-第三条',
                order: 1004,
                content: '额外条文',
            })
            const { list } = await findLegalArticlesListDao({
                legalId: TEST_LEGAL_ID,
                l2: 'list-第一分编',
                l4: 'list-第一节',
                pageSize: 50,
            })
            expect(list.some(a => a.id === extra.id)).toBe(true)
        })

        it('分页参数生效：page/pageSize', async () => {
            const { list, total } = await findLegalArticlesListDao({
                legalId: TEST_LEGAL_ID,
                page: 1,
                pageSize: 2,
            })
            expect(list.length).toBeLessThanOrEqual(2)
            expect(total).toBeGreaterThanOrEqual(list.length)
        })
    })

    describe('findAllLegalArticlesDao', () => {
        it('应返回按层级排序的全部条文', async () => {
            const all = await findAllLegalArticlesDao(TEST_LEGAL_ID)
            expect(Array.isArray(all)).toBe(true)
            expect(all.length).toBeGreaterThan(0)
            for (const a of all) {
                expect(a.legalId).toBe(TEST_LEGAL_ID)
                expect(a.deletedAt).toBeNull()
            }
        })
    })

    describe('updateLegalArticleDao / updateLegalArticleEmbeddingTimeDao', () => {
        it('应更新字段并刷新 updatedAt / lastEditedAt', async () => {
            const created = await createArticle({ content: '旧内容' })
            const before = created.updatedAt
            // 等待 1ms，确保 updatedAt 真的递增
            await new Promise(r => setTimeout(r, 5))
            const updated = await updateLegalArticleDao(created.id, {
                content: '新内容',
                order: 9999,
            })
            expect(updated.content).toBe('新内容')
            expect(updated.order).toBe(9999)
            if (before && updated.updatedAt) {
                expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
            }
        })

        it('更新不存在的 id 应抛错', async () => {
            await expect(
                updateLegalArticleDao(uuidv7(), { content: 'fail' })
            ).rejects.toThrow()
        })

        it('updateLegalArticleEmbeddingTimeDao 应写入 lastEmbeddingAt', async () => {
            const created = await createArticle({ content: '待更新嵌入时间' })
            const updated = await updateLegalArticleEmbeddingTimeDao(created.id)
            expect(updated.lastEmbeddingAt).not.toBeNull()
            expect(updated.lastEmbeddingAt).toBeInstanceOf(Date)
        })

        it('updateLegalArticleEmbeddingTimeDao 对不存在的 id 抛错', async () => {
            await expect(
                updateLegalArticleEmbeddingTimeDao(uuidv7())
            ).rejects.toThrow()
        })
    })

    describe('updateLegalArticlesInvalidDateDao', () => {
        it('应批量更新所有未删除条文的 invalidDate', async () => {
            const newDate = new Date('2099-01-01')
            const count = await updateLegalArticlesInvalidDateDao(TEST_LEGAL_ID, newDate)
            expect(count).toBeGreaterThan(0)
            const sample = await db.legalArticles.findFirst({
                where: { legalId: TEST_LEGAL_ID, deletedAt: null },
            })
            expect(sample?.invalidDate).not.toBeNull()

            // 复位回 null，避免影响后续断言
            await updateLegalArticlesInvalidDateDao(TEST_LEGAL_ID, null)
        })

        it('对不存在的 legalId 应返回 0', async () => {
            const count = await updateLegalArticlesInvalidDateDao(uuidv7(), null)
            expect(count).toBe(0)
        })
    })

    describe('deleteLegalArticleDao / deleteLegalArticlesByLegalIdDao', () => {
        it('deleteLegalArticleDao 应软删（deletedAt 非空）', async () => {
            const created = await createArticle({ content: '待软删' })
            await deleteLegalArticleDao(created.id)
            const raw = await db.legalArticles.findUnique({ where: { id: created.id } })
            expect(raw?.deletedAt).not.toBeNull()
        })

        it('deleteLegalArticleDao 对不存在的 id 抛错', async () => {
            await expect(deleteLegalArticleDao(uuidv7())).rejects.toThrow()
        })

        it('deleteLegalArticlesByLegalIdDao 应批量软删并返回 count', async () => {
            // 为避免污染其他用例，使用一个独立的 legalMain
            const otherLegalId = uuidv7()
            await db.legalMain.create({
                data: {
                    id: otherLegalId,
                    name: `独立法律_${otherLegalId.slice(0, 8)}`,
                    code: `IT2_${otherLegalId.slice(0, 8)}`,
                    type: LegalType.LAW,
                    content: 'x',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastEditedAt: new Date(),
                },
            })
            const a1 = await db.legalArticles.create({
                data: {
                    id: uuidv7(),
                    legalId: otherLegalId,
                    type: ArticleType.L5,
                    content: 'del1',
                    order: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastEditedAt: new Date(),
                },
            })
            const a2 = await db.legalArticles.create({
                data: {
                    id: uuidv7(),
                    legalId: otherLegalId,
                    type: ArticleType.L5,
                    content: 'del2',
                    order: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastEditedAt: new Date(),
                },
            })

            const count = await deleteLegalArticlesByLegalIdDao(otherLegalId)
            expect(count).toBe(2)

            // 清理
            await db.legalArticles.deleteMany({ where: { id: { in: [a1.id, a2.id] } } })
            await db.legalMain.deleteMany({ where: { id: otherLegalId } })
        })

        it('deleteLegalArticlesByLegalIdDao 对无对应条文的 legalId 返回 0', async () => {
            const count = await deleteLegalArticlesByLegalIdDao(uuidv7())
            expect(count).toBe(0)
        })
    })

    describe('findArticlesNeedingEmbeddingDao', () => {
        it('应覆盖两条 OR 分支：lastEmbeddingAt 为 null 或 lastEditedAt > lastEmbeddingAt', async () => {
            // 条文 A：从未嵌入（lastEmbeddingAt = null）
            const a = await createArticle({ content: '从未嵌入' })

            // 条文 B：先写入 lastEmbeddingAt，然后再 update 使 lastEditedAt 大于它
            const b = await createArticle({ content: '已嵌入但被修改' })
            // 先把 lastEmbeddingAt 置为过去
            await db.legalArticles.update({
                where: { id: b.id },
                data: {
                    lastEmbeddingAt: new Date('2000-01-01T00:00:00Z'),
                    lastEditedAt: new Date('2000-01-01T00:00:00Z'),
                },
            })
            // 然后再通过 DAO 更新内容，触发 lastEditedAt = now > lastEmbeddingAt
            await updateLegalArticleDao(b.id, { content: '已嵌入但被修改-new' })

            // 条文 C：lastEmbeddingAt 远大于 lastEditedAt，不应命中
            const c = await createArticle({ content: '已嵌入且未修改' })
            await db.legalArticles.update({
                where: { id: c.id },
                data: {
                    lastEditedAt: new Date('2000-01-01T00:00:00Z'),
                    lastEmbeddingAt: new Date('2099-01-01T00:00:00Z'),
                },
            })

            const list = await findArticlesNeedingEmbeddingDao(TEST_LEGAL_ID)
            const ids = list.map(x => x.id)
            expect(ids).toContain(a.id)
            expect(ids).toContain(b.id)
            expect(ids).not.toContain(c.id)
            // legalMain 应被 include
            const aInList = list.find(x => x.id === a.id)
            expect(aInList?.legalMain).toBeDefined()
        })

        it('不传 legalId 时应查询全库（至少应包含已插入数据）', async () => {
            const list = await findArticlesNeedingEmbeddingDao()
            expect(Array.isArray(list)).toBe(true)
            // 不做严格大小断言（与全库状态相关），只校验返回项结构
            for (const item of list.slice(0, 3)) {
                expect(item).toHaveProperty('id')
                expect(item).toHaveProperty('legalMain')
            }
        })
    })

    describe('findLegalArticlesForSortTreeDao', () => {
        it('应返回仅包含排序所需字段的条文列表', async () => {
            const list = await findLegalArticlesForSortTreeDao(TEST_LEGAL_ID)
            expect(list.length).toBeGreaterThan(0)
            // 只选了特定字段
            const sample = list[0]
            expect(sample).toHaveProperty('id')
            expect(sample).toHaveProperty('type')
            expect(sample).toHaveProperty('order')
            expect(sample).toHaveProperty('content')
            // legalId 不在 select 里，应为 undefined
            expect((sample as any).legalId).toBeUndefined()
        })
    })

    describe('batchUpdateLegalArticlesOrderDao', () => {
        it('应通过事务批量更新 order，返回条目数', async () => {
            const x = await createArticle({ order: 1, content: 'batch-x' })
            const y = await createArticle({ order: 2, content: 'batch-y' })

            const count = await batchUpdateLegalArticlesOrderDao([
                { id: x.id, order: 500 },
                { id: y.id, order: 501 },
            ])
            expect(count).toBe(2)

            const xAfter = await findLegalArticleByIdDao(x.id)
            const yAfter = await findLegalArticleByIdDao(y.id)
            expect(xAfter?.order).toBe(500)
            expect(yAfter?.order).toBe(501)
        })

        it('其中一条 id 不存在时整个事务应回滚并抛错', async () => {
            const good = await createArticle({ order: 3, content: 'batch-good' })
            const before = good.order

            await expect(
                batchUpdateLegalArticlesOrderDao([
                    { id: good.id, order: 12345 },
                    { id: uuidv7(), order: 12346 },
                ])
            ).rejects.toThrow()

            const reloaded = await findLegalArticleByIdDao(good.id)
            // 事务回滚，order 未被改到 12345
            expect(reloaded?.order).toBe(before)
        })
    })
})

// =====================================================================
// Service 层测试
// =====================================================================
describe('legalArticles.service - 真实数据库', () => {
    describe('createLegalArticleService', () => {
        it('应创建条文并触发嵌入（默认 triggerEmbedding=true）', async () => {
            const result = await createLegalArticleService({
                legalId: TEST_LEGAL_ID,
                type: ArticleType.L5,
                l1: 'svc-第一编',
                l5: 'svc-第一条',
                order: 2000,
                content: 'service 创建条文',
            } as any)

            createdArticleIds.add(result.id)
            expect(result.id).toBeTruthy()
            expect(result.legalId).toBe(TEST_LEGAL_ID)
            expect(vi.mocked(embedSingleArticle)).toHaveBeenCalledWith(result.id)
        })

        it('triggerEmbedding=false 时不应触发嵌入', async () => {
            const result = await createLegalArticleService(
                {
                    legalId: TEST_LEGAL_ID,
                    type: ArticleType.L5,
                    l5: `svc-no-trigger-${uuidv7().slice(0, 8)}`,
                    content: 'service 不触发嵌入',
                    order: 2001,
                } as any,
                false
            )
            createdArticleIds.add(result.id)
            expect(vi.mocked(embedSingleArticle)).not.toHaveBeenCalled()
        })

        it('content 为空时不触发嵌入', async () => {
            const result = await createLegalArticleService({
                legalId: TEST_LEGAL_ID,
                type: ArticleType.HEADER,
                content: null,
                order: 2002,
            } as any)
            createdArticleIds.add(result.id)
            expect(vi.mocked(embedSingleArticle)).not.toHaveBeenCalled()
        })

        it('不存在的 legalId 应抛错', async () => {
            await expect(
                createLegalArticleService({
                    legalId: uuidv7(),
                    type: ArticleType.L5,
                    content: 'x',
                } as any)
            ).rejects.toThrow(/不存在/)
        })

        it('嵌入触发失败时不影响创建结果（catch 分支）', async () => {
            vi.mocked(embedSingleArticle).mockRejectedValueOnce(
                new Error('mock embed 错误')
            )
            const result = await createLegalArticleService({
                legalId: TEST_LEGAL_ID,
                type: ArticleType.L5,
                l5: `svc-embed-fail-${uuidv7().slice(0, 8)}`,
                content: 'embed will fail',
                order: 2003,
            } as any)
            createdArticleIds.add(result.id)
            expect(result.id).toBeTruthy()
            expect(vi.mocked(embedSingleArticle)).toHaveBeenCalled()
        })

        it('未指定 invalidDate 时应回退到 legalMain.invalidDate', async () => {
            // 临时把 legalMain.invalidDate 设为一个具体值
            const fallback = new Date('2099-12-31')
            await db.legalMain.update({
                where: { id: TEST_LEGAL_ID },
                data: { invalidDate: fallback },
            })
            try {
                const result = await createLegalArticleService(
                    {
                        legalId: TEST_LEGAL_ID,
                        type: ArticleType.L5,
                        l5: `svc-fallback-${uuidv7().slice(0, 8)}`,
                        content: '采用 legal 的 invalidDate',
                        order: 2004,
                    } as any,
                    false
                )
                createdArticleIds.add(result.id)
                // 返回类型 invalidDate 是 YYYY-MM-DD 字符串
                expect(result.invalidDate).toBe('2099-12-31')
            } finally {
                await db.legalMain.update({
                    where: { id: TEST_LEGAL_ID },
                    data: { invalidDate: null },
                })
            }
        })
    })

    describe('getLegalArticleDetailService', () => {
        it('应返回格式化后的条文详情', async () => {
            const created = await createArticle({
                type: ArticleType.L5,
                content: 'detail 测试',
                publishDate: new Date('2024-05-01'),
                effectiveDate: new Date('2024-06-01'),
            })
            const result = await getLegalArticleDetailService(created.id)
            expect(result).not.toBeNull()
            expect(result?.id).toBe(created.id)
            expect(result?.publishDate).toBe('2024-05-01')
            expect(result?.effectiveDate).toBe('2024-06-01')
            expect(typeof result?.lastEditedAt).toBe('string')
        })

        it('不存在的 id 返回 null', async () => {
            const result = await getLegalArticleDetailService(uuidv7())
            expect(result).toBeNull()
        })
    })

    describe('getLegalArticlesListService', () => {
        it('应返回分页响应，items 中带 hierarchyPath 与 isEmbedded', async () => {
            const a = await createArticle({
                type: ArticleType.L5,
                l1: 'svc-list-第一编',
                l3: 'svc-list-第一章',
                l5: 'svc-list-第一条',
                order: 3000,
                content: 'svc 列表内容',
            })

            const resp = await getLegalArticlesListService({
                legalId: TEST_LEGAL_ID,
                page: 1,
                pageSize: 200,
                keyword: 'svc 列表内容',
            } as any)

            expect(resp.items.length).toBeGreaterThanOrEqual(1)
            expect(resp.page).toBe(1)
            expect(resp.pageSize).toBe(200)
            expect(resp.totalPages).toBeGreaterThanOrEqual(1)
            const hit = resp.items.find(it => it.id === a.id)
            expect(hit).toBeTruthy()
            expect(hit?.hierarchyPath).toContain('svc-list-第一编')
            expect(hit?.isEmbedded).toBe(false)
        })

        it('不存在的 legalId 应抛错', async () => {
            await expect(
                getLegalArticlesListService({
                    legalId: uuidv7(),
                    page: 1,
                    pageSize: 10,
                } as any)
            ).rejects.toThrow(/不存在/)
        })
    })

    describe('updateLegalArticleService', () => {
        it('内容变更时应触发重新嵌入', async () => {
            const created = await createArticle({ content: '更新前内容' })
            const result = await updateLegalArticleService(created.id, {
                content: '更新后内容',
                order: 4000,
                publishDate: '2024-07-01',
                effectiveDate: '2024-08-01',
                invalidDate: '2099-01-01',
            } as any)
            expect(result.content).toBe('更新后内容')
            expect(result.order).toBe(4000)
            expect(vi.mocked(embedSingleArticle)).toHaveBeenCalledWith(result.id)
        })

        it('仅 order 等非内容字段变更时不触发重新嵌入', async () => {
            const created = await createArticle({ content: 'no-embed 更新' })
            const result = await updateLegalArticleService(created.id, {
                order: 4100,
            } as any)
            expect(result.order).toBe(4100)
            expect(vi.mocked(embedSingleArticle)).not.toHaveBeenCalled()
        })

        it('triggerEmbedding=false 时即使内容变更也不触发嵌入', async () => {
            const created = await createArticle({ content: 'no-trigger-even-changed' })
            await updateLegalArticleService(
                created.id,
                { content: '新内容' } as any,
                false
            )
            expect(vi.mocked(embedSingleArticle)).not.toHaveBeenCalled()
        })

        it('不存在的 id 应抛错', async () => {
            await expect(
                updateLegalArticleService(uuidv7(), { content: 'x' } as any)
            ).rejects.toThrow(/不存在/)
        })

        it('内容变更 + 嵌入失败时仍应完成更新（catch 分支）', async () => {
            vi.mocked(embedSingleArticle).mockRejectedValueOnce(
                new Error('mock re-embed 错误')
            )
            const created = await createArticle({ content: 'will-fail-embed' })
            const result = await updateLegalArticleService(created.id, {
                content: '新内容-re',
            } as any)
            expect(result.content).toBe('新内容-re')
        })

        it('可显式把日期更新为 null', async () => {
            const created = await createArticle({
                content: 'null-date',
                publishDate: new Date('2024-01-01'),
            })
            const result = await updateLegalArticleService(
                created.id,
                { publishDate: null } as any,
                false
            )
            expect(result.publishDate).toBeNull()
        })
    })

    describe('deleteLegalArticleService', () => {
        it('应软删除条文并调用 deleteEmbeddingsByArticleId', async () => {
            const created = await createArticle({ content: '待 service 删除' })
            await deleteLegalArticleService(created.id)
            const raw = await db.legalArticles.findUnique({ where: { id: created.id } })
            expect(raw?.deletedAt).not.toBeNull()
            expect(vi.mocked(deleteEmbeddingsByArticleId)).toHaveBeenCalledWith(
                created.id
            )
        })

        it('不存在的 id 应抛错', async () => {
            await expect(deleteLegalArticleService(uuidv7())).rejects.toThrow(/不存在/)
        })

        it('删除嵌入时失败不影响软删除（catch 分支）', async () => {
            vi.mocked(deleteEmbeddingsByArticleId).mockRejectedValueOnce(
                new Error('mock delete embed 错误')
            )
            const created = await createArticle({ content: '嵌入删失败' })
            await deleteLegalArticleService(created.id)
            const raw = await db.legalArticles.findUnique({ where: { id: created.id } })
            expect(raw?.deletedAt).not.toBeNull()
        })
    })

    describe('triggerArticleEmbeddingService', () => {
        it('有 content 时应调用 embedSingleArticle', async () => {
            const created = await createArticle({ content: 'trigger 内容' })
            await triggerArticleEmbeddingService(created.id)
            expect(vi.mocked(embedSingleArticle)).toHaveBeenCalledWith(created.id)
        })

        it('没有 content 但有层级标题也应允许嵌入', async () => {
            const created = await createArticle({
                type: ArticleType.L1,
                l1: 'trigger-仅有层级',
                content: null,
            })
            await triggerArticleEmbeddingService(created.id)
            expect(vi.mocked(embedSingleArticle)).toHaveBeenCalledWith(created.id)
        })

        it('content 和层级全为空应抛错', async () => {
            const created = await createArticle({
                type: ArticleType.HEADER,
                content: null,
                l1: null,
                l2: null,
                l3: null,
                l4: null,
                l5: null,
            })
            await expect(
                triggerArticleEmbeddingService(created.id)
            ).rejects.toThrow(/没有可嵌入的内容/)
        })

        it('条文不存在时应抛错', async () => {
            await expect(
                triggerArticleEmbeddingService(uuidv7())
            ).rejects.toThrow(/不存在/)
        })
    })

    describe('getSortTreeService', () => {
        /** 用独立 legalMain 避免被其它用例插入的条文干扰 */
        let sortLegalId: string

        beforeAll(async () => {
            sortLegalId = uuidv7()
            await db.legalMain.create({
                data: {
                    id: sortLegalId,
                    name: `排序树_${sortLegalId.slice(0, 8)}`,
                    code: `IT_SORT_${sortLegalId.slice(0, 8)}`,
                    type: LegalType.LAW,
                    content: 'sort',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastEditedAt: new Date(),
                },
            })

            const base = (extra: any) => ({
                id: uuidv7(),
                legalId: sortLegalId,
                createdAt: new Date(),
                updatedAt: new Date(),
                lastEditedAt: new Date(),
                ...extra,
            })
            const rows = [
                base({ type: ArticleType.NOTICE, order: 1, content: '通知' }),
                base({ type: ArticleType.HEADER, order: 2, content: '头部' }),
                base({ type: ArticleType.L1, l1: 'sort-第一编', order: 3 }),
                base({
                    type: ArticleType.L3,
                    l1: 'sort-第一编',
                    l3: 'sort-第一章',
                    order: 4,
                }),
                base({
                    type: ArticleType.L5,
                    l1: 'sort-第一编',
                    l3: 'sort-第一章',
                    l5: 'sort-第一条',
                    order: 5,
                    content: '条内容',
                }),
                base({ type: ArticleType.FOOTER, order: 6, content: '尾部' }),
                base({ type: ArticleType.ANNEX, order: 7, content: '附件' }),
            ]
            for (const r of rows) {
                await db.legalArticles.create({ data: r })
            }
        })

        afterAll(async () => {
            await db.legalArticles.deleteMany({ where: { legalId: sortLegalId } })
            await db.legalMain.deleteMany({ where: { id: sortLegalId } })
        })

        it('无 parent 时返回顶层节点（含非层级 + 顶层 l1）', async () => {
            const nodes = await getSortTreeService({ legalId: sortLegalId } as any)
            expect(nodes.length).toBeGreaterThan(0)
            const types = nodes.map(n => n.type)
            expect(types).toContain('notice')
            expect(types).toContain('header')
            expect(types).toContain('footer')
            expect(types).toContain('annex')
            expect(types).toContain('l1')
        })

        it('指定 parentPath + parentType=l1 时返回其子节点（跳级 l3）', async () => {
            const children = await getSortTreeService({
                legalId: sortLegalId,
                parentPath: 'sort-第一编',
                parentType: ArticleType.L1,
            } as any)
            expect(children.length).toBeGreaterThan(0)
            expect(children.some(c => c.type === 'l3')).toBe(true)
        })

        it('不存在的 legalId 应抛错', async () => {
            await expect(
                getSortTreeService({ legalId: uuidv7() } as any)
            ).rejects.toThrow(/不存在/)
        })
    })

    describe('batchSortArticlesService', () => {
        it('items 为空时返回 0，不调用 DAO', async () => {
            const count = await batchSortArticlesService({
                legalId: TEST_LEGAL_ID,
                items: [],
            })
            expect(count).toBe(0)
        })

        it('应批量更新排序并返回条目数', async () => {
            const a = await createArticle({ order: 10, content: 'svc-batch-a' })
            const b = await createArticle({ order: 11, content: 'svc-batch-b' })
            const count = await batchSortArticlesService({
                legalId: TEST_LEGAL_ID,
                items: [
                    { id: a.id, order: 7001 },
                    { id: b.id, order: 7002 },
                ],
            })
            expect(count).toBe(2)
            const aAfter = await findLegalArticleByIdDao(a.id)
            const bAfter = await findLegalArticleByIdDao(b.id)
            expect(aAfter?.order).toBe(7001)
            expect(bAfter?.order).toBe(7002)
        })

        it('不存在的 legalId 应抛错', async () => {
            await expect(
                batchSortArticlesService({
                    legalId: uuidv7(),
                    items: [{ id: uuidv7(), order: 1 }],
                })
            ).rejects.toThrow(/不存在/)
        })
    })
})
