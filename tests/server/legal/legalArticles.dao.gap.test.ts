/**
 * legalArticles.dao 补充覆盖测试
 *
 * 目标：补齐 server/services/legal/legalArticles.dao.ts 的未覆盖行，主要是：
 *  - 各 DAO 函数的 catch 分支（通过注入损坏的事务客户端触发）
 *  - 成功路径中的边界：空结果、可选条件、关键词 OR 等
 *
 * 正常路径使用真实 Prisma（来自 vitest setup 的 globalThis.prisma），
 * catch 分支使用故障注入的 tx 客户端，避免修改生产代码。
 *
 * **Feature: legal-articles-dao-gap-coverage**
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { ArticleType, LegalType } from '#shared/types/legal'

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

const db: any = (globalThis as any).prisma

let TEST_LEGAL_ID: string
const createdArticleIds: string[] = []

beforeAll(async () => {
    TEST_LEGAL_ID = uuidv7()
    await db.legalMain.create({
        data: {
            id: TEST_LEGAL_ID,
            name: `gap_法律_${TEST_LEGAL_ID.slice(0, 8)}`,
            code: `GAP_${TEST_LEGAL_ID.slice(0, 8)}`,
            type: LegalType.LAW,
            content: 'gap test 法律',
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
    if (createdArticleIds.length) {
        await db.legalArticles.deleteMany({ where: { id: { in: createdArticleIds } } })
    }
    // 双保险：按 legalId 兜底清理
    await db.legalArticles.deleteMany({ where: { legalId: TEST_LEGAL_ID } })
    await db.legalMain.deleteMany({ where: { id: TEST_LEGAL_ID } })
})

/** 快速生成一条唯一条文；记录 id 以便 afterAll 清理 */
async function mkArticle(extra: Record<string, any> = {}) {
    const tag = uuidv7().slice(0, 8)
    const a = await createLegalArticleDao({
        legalMain: { connect: { id: TEST_LEGAL_ID } },
        type: ArticleType.L5,
        l5: extra.l5 ?? `gap-l5-${tag}`,
        order: extra.order ?? 1,
        content: extra.content ?? '内容',
        ...extra,
    } as any)
    createdArticleIds.push(a.id)
    return a
}

/** 构造一个仅对特定方法抛错的 tx 客户端，用来覆盖 DAO 的 catch 分支 */
function makeBrokenTx(overrides: Record<string, any> = {}) {
    const defaultErr = () => {
        throw new Error('mock dao error')
    }
    // 每个方法默认抛错；调用方可覆盖需要的部分
    return {
        legalArticles: {
            create: defaultErr,
            createMany: defaultErr,
            findUnique: defaultErr,
            findMany: defaultErr,
            count: defaultErr,
            update: defaultErr,
            updateMany: defaultErr,
            ...overrides,
        },
        $transaction: async () => {
            throw new Error('mock $transaction error')
        },
    } as any
}

describe('legalArticles.dao - catch 分支覆盖', () => {
    it('createLegalArticleDao 异常进入 catch', async () => {
        await expect(
            createLegalArticleDao(
                { legalMain: { connect: { id: TEST_LEGAL_ID } } } as any,
                makeBrokenTx(),
            ),
        ).rejects.toThrow('mock dao error')
    })

    it('createManyLegalArticlesDao 异常进入 catch', async () => {
        await expect(
            createManyLegalArticlesDao(
                [{ legalId: TEST_LEGAL_ID, type: ArticleType.L5 } as any],
                makeBrokenTx(),
            ),
        ).rejects.toThrow('mock dao error')
    })

    it('findLegalArticleByIdDao 异常进入 catch', async () => {
        await expect(
            findLegalArticleByIdDao('any-id', makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('findLegalArticleWithLegalByIdDao 异常进入 catch', async () => {
        await expect(
            findLegalArticleWithLegalByIdDao('any-id', makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('findLegalArticlesListDao 异常进入 catch', async () => {
        await expect(
            findLegalArticlesListDao({ legalId: TEST_LEGAL_ID }, makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('findAllLegalArticlesDao 异常进入 catch', async () => {
        await expect(
            findAllLegalArticlesDao(TEST_LEGAL_ID, makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('updateLegalArticleDao 异常进入 catch', async () => {
        await expect(
            updateLegalArticleDao('any-id', { content: 'x' } as any, makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('updateLegalArticleEmbeddingTimeDao 异常进入 catch', async () => {
        await expect(
            updateLegalArticleEmbeddingTimeDao('any-id', makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('updateLegalArticlesInvalidDateDao 异常进入 catch', async () => {
        await expect(
            updateLegalArticlesInvalidDateDao(TEST_LEGAL_ID, null, makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('deleteLegalArticleDao 异常进入 catch', async () => {
        await expect(
            deleteLegalArticleDao('any-id', makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('deleteLegalArticlesByLegalIdDao 异常进入 catch', async () => {
        await expect(
            deleteLegalArticlesByLegalIdDao(TEST_LEGAL_ID, makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('findArticlesNeedingEmbeddingDao 异常进入 catch', async () => {
        await expect(
            findArticlesNeedingEmbeddingDao(TEST_LEGAL_ID, makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('findLegalArticlesForSortTreeDao 异常进入 catch', async () => {
        await expect(
            findLegalArticlesForSortTreeDao(TEST_LEGAL_ID, makeBrokenTx()),
        ).rejects.toThrow('mock dao error')
    })

    it('batchUpdateLegalArticlesOrderDao 异常进入 catch', async () => {
        // 需要 update 与 $transaction 其中之一抛错。makeBrokenTx 的 update 直接抛错
        await expect(
            batchUpdateLegalArticlesOrderDao(
                [{ id: 'any-id', order: 1 }],
                makeBrokenTx(),
            ),
        ).rejects.toThrow()
    })
})

describe('legalArticles.dao - 补充正常路径分支', () => {
    it('findLegalArticlesListDao 不带任何筛选条件也应工作', async () => {
        await mkArticle({ content: 'gap-no-filter' })
        const { list, total } = await findLegalArticlesListDao({
            legalId: TEST_LEGAL_ID,
        })
        expect(total).toBeGreaterThanOrEqual(1)
        expect(Array.isArray(list)).toBe(true)
    })

    it('findArticlesNeedingEmbeddingDao 无 legalId 时返回全库需要嵌入的条文', async () => {
        const a = await mkArticle({ content: 'gap-embed-null' })
        const list = await findArticlesNeedingEmbeddingDao()
        expect(Array.isArray(list)).toBe(true)
        // 至少新建的这条（lastEmbeddingAt = null）应在其中
        const found = list.find((x: any) => x.id === a.id)
        expect(found).toBeTruthy()
    })

    it('updateLegalArticlesInvalidDateDao 传入 null 表示清空失效日期', async () => {
        const a = await mkArticle({ content: 'gap-invalid-null' })
        // 先设置一个失效日期
        await db.legalArticles.update({
            where: { id: a.id },
            data: { invalidDate: new Date('2099-01-01') },
        })
        const count = await updateLegalArticlesInvalidDateDao(TEST_LEGAL_ID, null)
        expect(count).toBeGreaterThanOrEqual(1)
        const after = await db.legalArticles.findUnique({ where: { id: a.id } })
        expect(after.invalidDate).toBeNull()
    })

    it('deleteLegalArticlesByLegalIdDao 对空集合返回 0', async () => {
        const fakeLegalId = uuidv7()
        const count = await deleteLegalArticlesByLegalIdDao(fakeLegalId)
        expect(count).toBe(0)
    })
})
