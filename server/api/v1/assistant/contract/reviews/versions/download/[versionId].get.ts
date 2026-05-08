/**
 * GET /api/v1/assistant/contract/reviews/versions/download/:versionId
 *
 * 下载历史版本的批注版 .docx 签名 URL（1 小时有效）。
 *
 * 与 /reviews/:id/download 的区别：
 *  - 数据源：历史版本 snapshotData 的 risks + annotations（冻结于版本创建时刻）
 *  - 基底 docx：版本自己的 docxFileId > review.originalFileId
 *  - 只读：不回写 wordCommentRef，不修改 snapshotData
 *
 * 返回 `{ downloadUrl, filename }`。
 *
 * 错误分支：
 *  - 401 未登录
 *  - 400 versionId 无效
 *  - 403 版本所属审查不属于当前用户
 *  - 404 版本 / snapshotData / 基底文件 缺失
 *  - 500 注入或上传失败
 *
 * **Feature: contract-review-versioning-phase-b（bug #4 历史版本下载）**
 */

import { loadOwnedReviewByVersionId } from '~~/server/services/assistant/contract/reviewGuard'
import { downloadContractReviewVersionService } from '~~/server/services/assistant/contract/contractReviewVersion.service'

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReviewByVersionId(event, { actionLabel: '下载该历史版本' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { review } = guard

    const versionId = guard.subId!

    const result = await downloadContractReviewVersionService(review, versionId)
    if ('error' in result) {
        switch (result.error) {
            case 'version_not_found':
                return resError(event, 404, '版本不存在')
            case 'origin_file_missing':
                return resError(event, 404, '历史版本的合同文件已丢失')
            case 'snapshot_invalid':
                return resError(event, 404, '历史版本快照数据异常')
            case 'inject_failed':
                return resError(event, 500, '生成历史版本批注文件失败，请稍后重试')
        }
    }

    return resSuccess(event, '获取下载地址成功', result.data)
})
