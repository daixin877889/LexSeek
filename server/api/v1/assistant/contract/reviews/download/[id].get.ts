/**
 * GET /api/v1/assistant/contract/reviews/download/:id
 *
 * 每次调用都按当前 DB 里最新的 risks + annotations 重新生成批注 docx，
 * 切换 reviewedFileId 指向新产物，再返回 1 小时签名下载 URL。
 *
 * 产品诉求（客户 2026-04-24 明确）：
 *   "每次下载都下载最新的并切换 OSS 中对应的版本，不要'重新生成批注 Word'
 *   这种独立按钮，引入新概念会增加用户心智负担"。
 *
 * 前端不再有"重新生成"按钮；律师改完 risks/annotations 后直接点下载即可
 * 拿到同步了最新批注的 docx。
 *
 * 并发保护：
 *   - atomicSetRebuildingDAO 原子 CAS（completed → rebuilding）抢锁，抢不到
 *     的请求直接返回 409 由前端 toast 让用户稍候重试
 *   - rebuildDocxService 内部 setCompletedAfterRebuildDAO 把 status 回到
 *     completed；异常路径 rollbackRebuildDAO 保证不把 review 锁死
 *
 * 返回 `{ downloadUrl, filename }`，filename 格式见 spec §4.4
 * （`{合同名}_{v版本号|"工作区"}_{日期}.docx`）。
 *
 * 错误分支：
 *  - 401 未登录
 *  - 400 reviewId 无效
 *  - 404 review 不存在 / 属于他人（403）
 *  - 400 review 尚未完成（reviewedFileId 为空，还未走完首次审查）
 *  - 409 正有另一个 rebuild / download 在跑
 *
 * **Feature: contract-review-m4**
 * **Feature: contract-review-versioning-phase-a（文件名带版本号）**
 */

import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { rebuildDocxService } from '~~/server/services/assistant/contract/contractReviewRebuild.service'
import {
    atomicSetRebuildingDAO,
    rollbackRebuildDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { z } from 'zod'
import { CONTRACT_EXPORT_MODES, DEFAULT_CONTRACT_EXPORT_MODE } from '#shared/types/contract'
import type { ContractExportMode } from '#shared/types/contract'

const ModeQuery = z.object({
    mode: z.enum(CONTRACT_EXPORT_MODES).optional(),
})

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '访问该合同审查' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { review } = guard

    if (!review.reviewedFileId) {
        return resError(event, 400, '审查尚未完成，暂无可下载文件')
    }

    const queryParse = ModeQuery.safeParse(getQuery(event))
    if (!queryParse.success) {
        return resError(event, 400, '导出模式参数无效')
    }
    const mode: ContractExportMode = queryParse.data.mode ?? DEFAULT_CONTRACT_EXPORT_MODE

    // 原子锁：completed → rebuilding；抢不到说明正有并发 rebuild 在进行
    const claimed = await atomicSetRebuildingDAO(review.id)
    if (!claimed) {
        return resError(event, 409, '正在生成最新批注，请稍后再试')
    }

    try {
        const result = await rebuildDocxService(review, { mode })
        return resSuccess(event, '获取下载地址成功', {
            downloadUrl: result.downloadUrl,
            filename: result.filename,
        })
    } catch (err) {
        // rebuildDocxService 在 setCompletedAfterRebuildDAO 之前抛错时 status 仍是
        // rebuilding，回滚保证 review 不被锁死；已走到 setCompleted 之后的错误
        // （极少）rollback 为 no-op，幂等。
        await rollbackRebuildDAO(review.id).catch(() => {})
        logger.error('[contract download] 每次下载重新生成失败', {
            reviewId: review.id,
            mode,
            err: err instanceof Error ? err.message : String(err),
        })
        return resError(event, 500, '生成批注 docx 失败，请稍后重试')
    }
})
