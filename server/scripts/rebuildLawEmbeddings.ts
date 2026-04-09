/**
 * 法律向量全量重建脚本
 *
 * 用于在 embedding 文本格式变更后重建所有法律条文的向量
 *
 * 用法:
 *   bun run server/scripts/rebuildLawEmbeddings.ts
 *   bun run server/scripts/rebuildLawEmbeddings.ts --start-from=<legalId>
 *   bun run server/scripts/rebuildLawEmbeddings.ts --limit=10
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

import { deleteEmbeddingsByMetadata } from '../services/legal/vectorStore.service'
import { updateLegalEmbeddings } from '../services/legal/lawEmbedding.service'

// -----------------------------------------------------------------------
// 主逻辑
// -----------------------------------------------------------------------

const BATCH_SIZE = 10

async function main() {
    const args = process.argv.slice(2)
    const startFrom = args.find(a => a.startsWith('--start-from='))?.split('=')[1]
    const limitStr = args.find(a => a.startsWith('--limit='))?.split('=')[1]

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

        sharedLogger.info(`共 ${legals.length} 部法律需要重建`)
        if (startFrom) {
            sharedLogger.info(`从 ID >= ${startFrom} 开始`)
        }

        let processed = 0
        let failed = 0
        const failedIds: string[] = []

        // 按批次处理
        const totalBatches = Math.ceil(legals.length / BATCH_SIZE)
        for (let i = 0; i < legals.length; i += BATCH_SIZE) {
            const batch = legals.slice(i, i + BATCH_SIZE)
            const batchNum = Math.floor(i / BATCH_SIZE) + 1
            sharedLogger.info(`批次 ${batchNum}/${totalBatches}`)

            for (const legal of batch) {
                try {
                    sharedLogger.info(`[${processed + failed + 1}/${legals.length}] 处理: ${legal.name} (${legal.id})`)

                    // 删除旧嵌入
                    const deleted = await deleteEmbeddingsByMetadata('legal_id', legal.id, 'law_embeddings')
                    sharedLogger.info(`  删除旧嵌入 ${deleted} 条`)

                    // 重建嵌入（updateLegalEmbeddings 会自行检查哪些条文需要更新）
                    await updateLegalEmbeddings(legal.id)
                    sharedLogger.info(`  重建完成`)

                    processed++
                } catch (error) {
                    sharedLogger.error(`  重建失败 [${legal.id}]:`, error)
                    failedIds.push(legal.id)
                    failed++
                    // 继续处理下一部法律，不中断整体流程
                }
            }

            sharedLogger.info(`批次进度: 成功 ${processed}, 失败 ${failed}, 共 ${processed + failed}/${legals.length}`)
        }

        sharedLogger.info(`重建完成！成功 ${processed} 部，失败 ${failed} 部`)

        if (failedIds.length > 0) {
            sharedLogger.warn(`失败的法律 ID 列表：`)
            for (const id of failedIds) {
                sharedLogger.warn(`  ${id}`)
            }
            sharedLogger.warn(`可使用 --start-from=<id> 从指定 ID 重试`)
        }

        process.exit(failed > 0 ? 1 : 0)
    } catch (error) {
        sharedLogger.error('脚本执行失败:', error)
        process.exit(1)
    } finally {
        await prismaClient.$disconnect()
    }
}

main()
