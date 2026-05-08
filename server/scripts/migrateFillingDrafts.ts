/**
 * 一次性数据修复:把遗留的 filling 状态草稿置 failed
 *
 * 旧架构 documentMain 启动时 draftResultPersistenceMiddleware.beforeAgent 会写
 * status='filling',若 graph 异常退出未跑 afterAgent,会卡在 filling 态。新架构
 * 没有这个中间态,这条数据是历史污染。
 *
 * 用法:`npx tsx server/scripts/migrateFillingDrafts.ts`
 */

import { prisma } from '~~/server/utils/db'
import { logger } from '#shared/utils/logger'

async function main() {
    const stuck = await prisma.documentDrafts.findMany({
        where: { status: 'filling', deletedAt: null },
        select: { id: true, sessionId: true, updatedAt: true },
    })

    logger.info(`Found ${stuck.length} filling drafts to migrate`, {
        ids: stuck.map(d => d.id),
    })

    if (stuck.length === 0) {
        logger.info('No filling drafts to migrate, exiting.')
        return
    }

    const result = await prisma.documentDrafts.updateMany({
        where: { status: 'filling', deletedAt: null },
        data: { status: 'failed' },
    })

    logger.info(`Migrated ${result.count} filling drafts to failed`)
}

main()
    .catch((err) => {
        logger.error('Migration failed', { err })
        process.exit(1)
    })
    .finally(() => process.exit(0))
