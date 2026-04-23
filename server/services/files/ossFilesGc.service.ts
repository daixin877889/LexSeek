/**
 * OSS 孤儿文件 GC（bug #15）。
 *
 * 场景：业务表删除后对应 oss_files 行常残留，长期累积占用存储 + 扰乱对账。
 * 本服务仅做 **软删（set deleted_at）**，不真的删 OSS 对象；真实对象清理由
 * 另一个更慢的离线任务处理（超出本 bug 范围）。
 *
 * 约束：
 * - 每轮最多处理 100 条，避免单次长事务；定时任务 24h 跑一次即可收敛
 * - 依赖 findOrphanOssFilesDAO 穷举所有 ossFileId 外键引用，漏一个表会误删
 */
import { prisma } from '~~/server/utils/db'
import { findOrphanOssFilesDAO } from './ossFiles.dao'

const ORPHAN_BATCH_SIZE = 100

/**
 * 扫描并软删孤儿 OSS 文件记录。
 * @returns 本轮软删条数
 */
export const gcOrphanOssFilesService = async (): Promise<number> => {
    const orphanIds = await findOrphanOssFilesDAO(ORPHAN_BATCH_SIZE)
    if (orphanIds.length === 0) return 0

    const now = new Date()
    const result = await prisma.ossFiles.updateMany({
        where: { id: { in: orphanIds }, deletedAt: null },
        data: { deletedAt: now, updatedAt: now },
    })

    logger.info(`OSS 孤儿文件软删 ${result.count} 条`, { ids: orphanIds })
    return result.count
}
