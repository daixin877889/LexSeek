/**
 * 法律嵌入记录 DAO 真实数据库测试
 *
 * 直接调用 server/services/legal/lawEmbeddings.dao.ts 中的函数，
 * 使用 .env.testing 指向的测试数据库（ls_new_testing）。
 *
 * 目标：覆盖 DAO 所有公开函数的成功/边界/分页/多条件路径。
 *
 * **Feature: law-embeddings-dao-real-coverage**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import pg from 'pg'

import {
    findEmbeddingsByLegalIdDao,
    findEmbeddingByIdDao,
    updateEmbeddingMetadataDao,
    deleteEmbeddingByIdDao,
    countEmbeddingsByLegalIdDao,
} from '../../../server/services/legal/lawEmbeddings.dao'
import { resetVectorStore } from '../../../server/services/legal/vectorStore.service'

// ==================== 基础设施 ====================

/** 本测试专用 pg pool（用于准备/清理数据） */
const createTestPool = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    return new pg.Pool({ connectionString })
}

const testPool = createTestPool()

// 注入 logger（dao 内部不直接使用 logger，但 vectorStore.service 使用）
const mockLogger = {
    info: (..._args: any[]) => {},
    warn: (..._args: any[]) => {},
    error: (..._args: any[]) => {},
    debug: (..._args: any[]) => {},
}
;(globalThis as any).logger = mockLogger

/** 本轮创建的嵌入 id，用于最终清理 */
const createdIds = new Set<string>()

/** 本测试特有 legal_id 前缀，用于隔离数据 */
const TEST_LEGAL_PREFIX = `__lt_dao_${uuidv7().replace(/-/g, '').slice(0, 8)}__`

/** 生成唯一 legal_id */
const uniqueLegalId = () => `${TEST_LEGAL_PREFIX}${uuidv7()}`

interface InsertEmbeddingInput {
    text?: string
    metadata?: Record<string, unknown>
}

/** 直接向 law_embeddings 表写入一条记录（不走 embedding 流程） */
const insertEmbedding = async (input: InsertEmbeddingInput = {}): Promise<string> => {
    const id = uuidv7()
    const text = input.text ?? '测试条文内容'
    const metadata = input.metadata ?? {}
    // 不写入 embedding 列，avoid pgvector 维度限制（列允许 NULL）
    await testPool.query(
        `INSERT INTO law_embeddings (id, text, metadata) VALUES ($1, $2, $3::jsonb)`,
        [id, text, JSON.stringify(metadata)]
    )
    createdIds.add(id)
    return id
}

/** 清理本测试创建的所有记录 */
const cleanupAll = async () => {
    if (createdIds.size === 0) return
    const ids = Array.from(createdIds)
    try {
        await testPool.query(
            `DELETE FROM law_embeddings WHERE id = ANY($1::uuid[])`,
            [ids]
        )
    } catch {
        // ignore
    }
    createdIds.clear()
}

// ==================== 测试用例 ====================

describe('lawEmbeddings DAO 真实数据库测试', () => {
    beforeAll(async () => {
        // 触发一次 pool 连接
        await testPool.query('SELECT 1')
    })

    afterEach(async () => {
        await cleanupAll()
    })

    afterAll(async () => {
        await cleanupAll()
        await testPool.end()
        // 重置 vectorStore 的 pool 缓存（dao 内部通过 getPool 拿到共享 pool）
        resetVectorStore()
    })

    // -------------------- findEmbeddingsByLegalIdDao --------------------

    describe('findEmbeddingsByLegalIdDao', () => {
        it('应仅返回匹配 legal_id 的记录', async () => {
            const legalIdA = uniqueLegalId()
            const legalIdB = uniqueLegalId()

            const idA1 = await insertEmbedding({
                text: 'A 条文 1',
                metadata: { legal_id: legalIdA, articles_id: uuidv7(), chapter_hierarchy: '01' },
            })
            const idA2 = await insertEmbedding({
                text: 'A 条文 2',
                metadata: { legal_id: legalIdA, articles_id: uuidv7(), chapter_hierarchy: '02' },
            })
            await insertEmbedding({
                text: 'B 条文',
                metadata: { legal_id: legalIdB, articles_id: uuidv7() },
            })

            const result = await findEmbeddingsByLegalIdDao(legalIdA)
            expect(result.total).toBe(2)
            expect(result.list.length).toBe(2)
            const returnedIds = result.list.map(r => r.id)
            expect(returnedIds).toContain(idA1)
            expect(returnedIds).toContain(idA2)
        })

        it('应按 chapter_hierarchy 升序 + id 升序排序', async () => {
            const legalId = uniqueLegalId()
            await insertEmbedding({
                text: 'c',
                metadata: { legal_id: legalId, articles_id: uuidv7(), chapter_hierarchy: '03' },
            })
            await insertEmbedding({
                text: 'a',
                metadata: { legal_id: legalId, articles_id: uuidv7(), chapter_hierarchy: '01' },
            })
            await insertEmbedding({
                text: 'b',
                metadata: { legal_id: legalId, articles_id: uuidv7(), chapter_hierarchy: '02' },
            })

            const result = await findEmbeddingsByLegalIdDao(legalId)
            const hierarchies = result.list.map(r =>
                (r.metadata as any)?.chapter_hierarchy
            )
            expect(hierarchies).toEqual(['01', '02', '03'])
        })

        it('articleId 参数应叠加过滤', async () => {
            const legalId = uniqueLegalId()
            const targetArticleId = uuidv7()
            const otherArticleId = uuidv7()

            const matchedId = await insertEmbedding({
                text: '命中条文',
                metadata: { legal_id: legalId, articles_id: targetArticleId },
            })
            await insertEmbedding({
                text: '其他条文',
                metadata: { legal_id: legalId, articles_id: otherArticleId },
            })

            const result = await findEmbeddingsByLegalIdDao(
                legalId,
                targetArticleId,
                1,
                10
            )
            expect(result.total).toBe(1)
            expect(result.list[0]?.id).toBe(matchedId)
        })

        it('应正确分页（page 与 pageSize）', async () => {
            const legalId = uniqueLegalId()
            for (let i = 0; i < 5; i++) {
                await insertEmbedding({
                    text: `item_${i}`,
                    metadata: {
                        legal_id: legalId,
                        articles_id: uuidv7(),
                        chapter_hierarchy: String(i).padStart(3, '0'),
                    },
                })
            }

            const page1 = await findEmbeddingsByLegalIdDao(legalId, undefined, 1, 2)
            const page2 = await findEmbeddingsByLegalIdDao(legalId, undefined, 2, 2)
            const page3 = await findEmbeddingsByLegalIdDao(legalId, undefined, 3, 2)

            expect(page1.total).toBe(5)
            expect(page1.list.length).toBe(2)
            expect(page2.list.length).toBe(2)
            expect(page3.list.length).toBe(1)

            // 不同页 id 不重复
            const ids = new Set([
                ...page1.list.map(r => r.id),
                ...page2.list.map(r => r.id),
                ...page3.list.map(r => r.id),
            ])
            expect(ids.size).toBe(5)
        })

        it('应使用默认参数（page=1, pageSize=20）', async () => {
            const legalId = uniqueLegalId()
            await insertEmbedding({
                text: 'default',
                metadata: { legal_id: legalId, articles_id: uuidv7() },
            })

            const result = await findEmbeddingsByLegalIdDao(legalId)
            expect(result.total).toBe(1)
            expect(result.list.length).toBe(1)
        })

        it('无匹配数据时应返回空列表 total=0', async () => {
            const legalId = uniqueLegalId()
            const result = await findEmbeddingsByLegalIdDao(legalId)
            expect(result.total).toBe(0)
            expect(result.list).toEqual([])
        })
    })

    // -------------------- findEmbeddingByIdDao --------------------

    describe('findEmbeddingByIdDao', () => {
        it('存在时应返回完整记录', async () => {
            const legalId = uniqueLegalId()
            const id = await insertEmbedding({
                text: '完整内容',
                metadata: { legal_id: legalId, articles_id: uuidv7(), foo: 'bar' },
            })

            const row = await findEmbeddingByIdDao(id)
            expect(row).not.toBeNull()
            expect(row!.id).toBe(id)
            expect(row!.text).toBe('完整内容')
            expect(row!.metadata).toMatchObject({ legal_id: legalId, foo: 'bar' })
        })

        it('不存在时应返回 null', async () => {
            const row = await findEmbeddingByIdDao(uuidv7())
            expect(row).toBeNull()
        })
    })

    // -------------------- updateEmbeddingMetadataDao --------------------

    describe('updateEmbeddingMetadataDao', () => {
        it('应更新指定 metadata 字段而保留其他字段', async () => {
            const legalId = uniqueLegalId()
            const id = await insertEmbedding({
                text: 'meta test',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    invalid_date: null,
                    other_field: '保持不变',
                },
            })

            const updated = await updateEmbeddingMetadataDao(id, {
                invalid_date: '2030-01-01',
            } as any)

            expect(updated).not.toBeNull()
            expect(updated!.metadata).toMatchObject({
                legal_id: legalId,
                invalid_date: '2030-01-01',
                other_field: '保持不变',
            })
        })

        it('更新 null 值应写入 JSON null', async () => {
            const legalId = uniqueLegalId()
            const id = await insertEmbedding({
                text: 'null update',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    invalid_date: '2030-01-01',
                },
            })

            const updated = await updateEmbeddingMetadataDao(id, {
                invalid_date: null,
            } as any)

            expect(updated).not.toBeNull()
            expect((updated!.metadata as any).invalid_date).toBeNull()
        })

        it('忽略值为 undefined 的字段', async () => {
            const legalId = uniqueLegalId()
            const id = await insertEmbedding({
                text: 'partial update',
                metadata: {
                    legal_id: legalId,
                    articles_id: uuidv7(),
                    invalid_date: '2020-01-01',
                },
            })

            const updated = await updateEmbeddingMetadataDao(id, {
                invalid_date: '2040-01-01',
                publish_date: undefined as any,
            } as any)

            expect(updated).not.toBeNull()
            expect((updated!.metadata as any).invalid_date).toBe('2040-01-01')
            expect('publish_date' in (updated!.metadata as any)).toBe(false)
        })

        it('updates 全部为 undefined 时应回退为 findEmbeddingByIdDao', async () => {
            const legalId = uniqueLegalId()
            const id = await insertEmbedding({
                text: 'no changes',
                metadata: { legal_id: legalId, articles_id: uuidv7() },
            })

            const result = await updateEmbeddingMetadataDao(id, {
                invalid_date: undefined as any,
            } as any)

            // 未发生更新，但仍返回原记录
            expect(result).not.toBeNull()
            expect(result!.id).toBe(id)
        })

        it('完全空 updates（无字段）时返回原记录', async () => {
            const legalId = uniqueLegalId()
            const id = await insertEmbedding({
                text: 'empty updates',
                metadata: { legal_id: legalId, articles_id: uuidv7() },
            })

            const result = await updateEmbeddingMetadataDao(id, {} as any)
            expect(result).not.toBeNull()
            expect(result!.id).toBe(id)
        })

        it('id 不存在时应返回 null（即使传入有效 updates）', async () => {
            const result = await updateEmbeddingMetadataDao(uuidv7(), {
                invalid_date: '2030-01-01',
            } as any)
            expect(result).toBeNull()
        })

        it('id 不存在且 updates 为空时应返回 null', async () => {
            const result = await updateEmbeddingMetadataDao(uuidv7(), {} as any)
            expect(result).toBeNull()
        })
    })

    // -------------------- deleteEmbeddingByIdDao --------------------

    describe('deleteEmbeddingByIdDao', () => {
        it('存在时应删除并返回 true', async () => {
            const legalId = uniqueLegalId()
            const id = await insertEmbedding({
                text: 'to delete',
                metadata: { legal_id: legalId, articles_id: uuidv7() },
            })

            const success = await deleteEmbeddingByIdDao(id)
            expect(success).toBe(true)

            const row = await findEmbeddingByIdDao(id)
            expect(row).toBeNull()

            // 已删除，清理集合中去掉
            createdIds.delete(id)
        })

        it('id 不存在时应返回 false', async () => {
            const success = await deleteEmbeddingByIdDao(uuidv7())
            expect(success).toBe(false)
        })
    })

    // -------------------- countEmbeddingsByLegalIdDao --------------------

    describe('countEmbeddingsByLegalIdDao', () => {
        it('应返回匹配 legal_id 的总数', async () => {
            const legalId = uniqueLegalId()
            await insertEmbedding({
                text: '1',
                metadata: { legal_id: legalId, articles_id: uuidv7() },
            })
            await insertEmbedding({
                text: '2',
                metadata: { legal_id: legalId, articles_id: uuidv7() },
            })
            await insertEmbedding({
                text: '3',
                metadata: { legal_id: legalId, articles_id: uuidv7() },
            })

            const count = await countEmbeddingsByLegalIdDao(legalId)
            expect(count).toBe(3)
        })

        it('无匹配时应返回 0', async () => {
            const count = await countEmbeddingsByLegalIdDao(uniqueLegalId())
            expect(count).toBe(0)
        })
    })
})
