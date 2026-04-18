/**
 * POST /api/v1/assistant/contract/reviews/:id/rebuild-docx
 *
 * 根据最新 risks 重生批注 Word，覆盖 reviewedFileId。
 *
 * 流程（对齐 spec §8.4）：
 *   1. 校验 status=completed（用 REVIEW_EDITABLE_STATUSES 统一）
 *   2. atomicSetRebuildingDAO 原子占位；失败 → 429
 *   3. rebuildDocxService（下载 → 注入 → 上传 → 生成 URL → createOssFile → 更新 reviewedFileId + status=completed）
 *   4. 失败 → rollbackRebuildDAO + 500
 *
 * **Feature: contract-review-m5**
 */
import {
    getContractReviewDAO,
    atomicSetRebuildingDAO,
    rollbackRebuildDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { rebuildDocxService } from '~~/server/services/assistant/contract/contractReviewRebuild.service'
import { REVIEW_EDITABLE_STATUSES } from '#shared/types/contract'
import type { ContractReviewStatus } from '#shared/types/contract'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!idStr || !Number.isInteger(id) || id <= 0) {
        return resError(event, 400, 'reviewId 无效')
    }

    const review = await getContractReviewDAO(id)
    if (!review) return resError(event, 404, '合同审查不存在')
    if (review.userId !== user.id) return resError(event, 403, '无权重生批注')
    if (!REVIEW_EDITABLE_STATUSES.includes(review.status as ContractReviewStatus)) {
        return resError(event, 409, `当前状态不允许重生：${review.status}`)
    }

    const occupied = await atomicSetRebuildingDAO(id)
    if (!occupied) return resError(event, 429, '批注正在重新生成中，请稍候')
    logger.info('rebuild-docx 占位成功', { reviewId: id, userId: user.id })

    try {
        const fresh = await getContractReviewDAO(id)
        if (!fresh) throw new Error('review 在占位期间被删除')
        const result = await rebuildDocxService(fresh)
        logger.info('rebuild-docx 完成', {
            reviewId: id,
            userId: user.id,
            newFileId: result.reviewedFileId,
        })
        return resSuccess(event, '重生成功', result)
    } catch (err) {
        logger.error('rebuild-docx 失败', err)
        await rollbackRebuildDAO(id)
        return resError(event, 500, '重生批注失败，请稍后重试')
    }
})
