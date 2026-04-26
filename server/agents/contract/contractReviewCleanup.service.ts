/**
 * 合同审查僵死状态清理服务（bug #14）。
 *
 * 进程崩溃 / SSE 异常断开可能让 contract_reviews.status 永久停在 reviewing，
 * 导致用户既无法查看结果也无法重试。参考 case.cleanupStaleAnalysesService 的
 * 做法，定时任务（server/plugins/cron-scheduler.ts 注册）每小时兜底一次，
 * 超过 24h 仍处于 reviewing 的记录置为 failed。
 */
import { prisma } from '~~/server/utils/db'
import { findReviewingTimeoutDAO } from './contractReview.dao'

/** 超时阈值：24 小时 */
const REVIEWING_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

/**
 * 清理长时间停留在 reviewing 状态的合同审查记录。
 *
 * - 读取所有 updatedAt 早于 24h 前的 reviewing 记录
 * - 一次 updateMany 批量置 failed（心跳机制尚未引入，不做中间态恢复）
 * - 返回被清理的条数，便于定时任务日志与监控
 */
export const cleanupStaleContractReviewsService = async (): Promise<number> => {
    const staleIds = await findReviewingTimeoutDAO(REVIEWING_STALE_THRESHOLD_MS)
    if (staleIds.length === 0) return 0

    const now = new Date()
    const result = await prisma.contractReviews.updateMany({
        where: { id: { in: staleIds }, status: 'reviewing' },
        data: { status: 'failed', updatedAt: now },
    })

    logger.warn(`清理超时合同审查 ${result.count} 条`, { ids: staleIds })
    return result.count
}
