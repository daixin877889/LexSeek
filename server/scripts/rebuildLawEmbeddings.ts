/**
 * 法律向量全量重建脚本
 *
 * 用于在 embedding 文本格式变更后重建所有法律条文的向量
 * 使用 p-limit 实现滑动窗口并发（默认 concurrency=5），失败项自动重试一轮
 *
 * 用法:
 *   bun run server/scripts/rebuildLawEmbeddings.ts
 *   bun run server/scripts/rebuildLawEmbeddings.ts --start-from=<legalId>
 *   bun run server/scripts/rebuildLawEmbeddings.ts --limit=10
 *   bun run server/scripts/rebuildLawEmbeddings.ts --concurrency=10
 */

// -----------------------------------------------------------------------
// 初始化全局依赖（模拟 Nuxt 自动导入）
// 必须在导入任何服务层模块之前执行，因为它们在模块加载时就引用全局变量
// -----------------------------------------------------------------------

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'
import { logger as sharedLogger } from '../../shared/utils/logger/index'

// 初始化 Prisma 客户端
function createPrismaClient() {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    const adapter = new PrismaPg({
        connectionString: databaseUrl,
        options: '-c TimeZone=UTC',
    })
    return new PrismaClient({ adapter })
}

// 挂载全局依赖（服务层通过全局变量访问）
const g = globalThis as Record<string, unknown>
g.prisma = createPrismaClient()
g.logger = sharedLogger

// mock useRuntimeConfig：从环境变量读取配置，兼容 getEmbeddingConfigWithFallbackService
g.useRuntimeConfig = () => ({
    embedding: {
        apiKey: process.env.NUXT_EMBEDDING_API_KEY || process.env.EMBEDDING_API_KEY,
        baseUrl: process.env.NUXT_EMBEDDING_BASE_URL || process.env.EMBEDDING_BASE_URL,
        model: process.env.NUXT_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || 'text-embedding-v4',
        dimensions: Number(process.env.NUXT_EMBEDDING_DIMENSIONS || process.env.EMBEDDING_DIMENSIONS || 1536),
        batchSize: Number(process.env.NUXT_EMBEDDING_BATCH_SIZE || process.env.EMBEDDING_BATCH_SIZE || 5),
    },
    public: {
        logLevel: process.env.LOG_LEVEL || 'INFO',
    },
})

// -----------------------------------------------------------------------
// 导入服务层（在全局依赖就绪后）
// -----------------------------------------------------------------------

import pLimit from 'p-limit'
import { deleteEmbeddingsByMetadata } from '../services/legal/vectorStore.service'
import { updateLegalEmbeddings } from '../services/legal/lawEmbedding.service'

// -----------------------------------------------------------------------
// 主逻辑
// -----------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 5

interface LegalItem {
    id: string
    name: string
}

interface FailedItem extends LegalItem {
    error: unknown
}

/**
 * 处理单条法律的嵌入重建
 */
async function processLegal(legal: LegalItem): Promise<FailedItem | null> {
    try {
        sharedLogger.info(`处理: ${legal.name} (${legal.id})`)

        const deleted = await deleteEmbeddingsByMetadata('legal_id', legal.id, 'law_embeddings')
        sharedLogger.info(`  删除旧嵌入 ${deleted} 条`)

        await updateLegalEmbeddings(legal.id)
        sharedLogger.info(`  重建完成`)

        return null
    } catch (error) {
        sharedLogger.error(`  重建失败 [${legal.id}]:`, error)
        return { id: legal.id, name: legal.name, error }
    }
}

/**
 * 使用 p-limit 滑动窗口并发执行法律列表
 * 返回失败项列表
 */
async function runWithConcurrency(legals: LegalItem[], concurrency: number): Promise<FailedItem[]> {
    const limit = pLimit(concurrency)
    let completed = 0
    const total = legals.length

    const results = await Promise.all(
        legals.map(legal =>
            limit(async () => {
                const result = await processLegal(legal)
                completed++
                if (completed % 10 === 0 || completed === total) {
                    sharedLogger.info(`当前进度: ${completed}/${total} 已完成`)
                }
                return result
            }),
        ),
    )

    return results.filter((r): r is FailedItem => r !== null)
}

async function main() {
    const args = process.argv.slice(2)
    const startFrom = args.find(a => a.startsWith('--start-from='))?.split('=')[1]
    const limitStr = args.find(a => a.startsWith('--limit='))?.split('=')[1]
    const concurrencyStr = args.find(a => a.startsWith('--concurrency='))?.split('=')[1]
    const concurrency = concurrencyStr ? parseInt(concurrencyStr, 10) : DEFAULT_CONCURRENCY

    const prismaClient = g.prisma as InstanceType<typeof PrismaClient>

    try {
        // 查询待处理的法律列表
        const where: Record<string, unknown> = { deletedAt: null }
        if (startFrom) {
            where['id'] = { gte: startFrom }
        }

        const legals = await prismaClient.legalMain.findMany({
            where,
            select: { id: true, name: true },
            orderBy: { id: 'asc' },
            ...(limitStr ? { take: parseInt(limitStr, 10) } : {}),
        })

        sharedLogger.info(`共 ${legals.length} 部法律需要重建，并发数: ${concurrency}`)
        if (startFrom) {
            sharedLogger.info(`从 ID >= ${startFrom} 开始`)
        }

        // 第一轮：全量并发处理
        sharedLogger.info('--- 第一轮处理 ---')
        const failedItems = await runWithConcurrency(legals, concurrency)
        const firstRoundSuccess = legals.length - failedItems.length

        sharedLogger.info(`第一轮完成: 成功 ${firstRoundSuccess}, 失败 ${failedItems.length}`)

        // 第二轮：重试失败项
        let finalFailedItems: FailedItem[] = []
        if (failedItems.length > 0) {
            sharedLogger.info(`--- 第二轮重试 ${failedItems.length} 项 ---`)
            finalFailedItems = await runWithConcurrency(failedItems, concurrency)

            const retrySuccess = failedItems.length - finalFailedItems.length
            sharedLogger.info(`重试完成: 成功 ${retrySuccess}, 仍失败 ${finalFailedItems.length}`)
        }

        const totalSuccess = legals.length - finalFailedItems.length
        const totalFailed = finalFailedItems.length
        sharedLogger.info(`重建完成！成功 ${totalSuccess} 部，失败 ${totalFailed} 部`)

        if (finalFailedItems.length > 0) {
            sharedLogger.warn(`最终失败的法律 ID 列表：`)
            for (const item of finalFailedItems) {
                sharedLogger.warn(`  ${item.id} - ${item.name}`)
            }
            sharedLogger.warn(`可使用 --start-from=<id> 从指定 ID 重试`)
        }

        process.exit(totalFailed > 0 ? 1 : 0)
    } catch (error) {
        sharedLogger.error('脚本执行失败:', error)
        process.exit(1)
    } finally {
        await prismaClient.$disconnect()
    }
}

main()
