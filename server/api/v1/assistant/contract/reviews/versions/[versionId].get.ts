/**
 * GET /api/v1/assistant/contract/reviews/versions/:versionId
 *
 * 获取版本完整快照（含 snapshotData），用于只读历史版本查看。
 *
 * 错误码：
 * - 400：versionId 无效
 * - 401：未登录
 * - 403：审查不属于当前用户
 * - 404：版本不存在
 */

import { loadOwnedReviewByVersionId } from '~~/server/services/assistant/contract/reviewGuard'
import { loadContractReviewVersionSnapshotService } from '~~/server/services/assistant/contract/contractReviewVersion.service'

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByVersionId(event, { actionLabel: '查看版本快照' })
    if (!guard.ok) return resError(event, guard.status, guard.message)

    const versionId = guard.subId!
    const result = await loadContractReviewVersionSnapshotService(versionId)

    if ('error' in result) return resError(event, 404, '版本不存在')
    return resSuccess(event, '获取成功', result.data)
})
