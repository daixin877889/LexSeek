/**
 * GET /api/v1/assistant/contract/reviews/:id/download
 *
 * 取合同审查已完成的批注版 .docx 的 1 小时签名下载 URL。
 *
 * 返回 `{ downloadUrl }`，由前端直接拼在 `<a download>` 或 window.open 上使用。
 *
 * 错误分支（6 条）：
 *  - 401 未登录
 *  - 400 reviewId 无效（非整数 / ≤ 0）
 *  - 404 review 不存在（含软删）
 *  - 403 review 属于他人
 *  - 400 review 尚未完成（reviewedFileId 为空）
 *  - 404 ossFile 记录丢失或 filePath 缺失
 *
 * 成功分支（1 条）：
 *  - 200 data.downloadUrl 为 https 签名 URL（1 小时有效）
 *
 * **Feature: contract-review-m4**
 */

import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'

// 与文书导出（documentExport.service.ts）保持 1h 对齐
const DOWNLOAD_URL_EXPIRES_SECONDS = 3600

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '访问该合同审查' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { user, review } = guard

    // 校验审查是否已完成（reviewedFileId 是产物 id，未完成为 null）
    const reviewedFileId = review.reviewedFileId
    if (!reviewedFileId) {
        return resError(event, 400, '审查尚未完成，暂无可下载文件')
    }

    // 查 OSS 文件记录
    const ossFile = await findOssFileByIdDao(reviewedFileId)
    if (!ossFile || !ossFile.filePath) {
        return resError(event, 404, '审查结果文件已丢失')
    }

    // 生成 1 小时签名 URL
    const downloadUrl = await generateSignedUrlService(ossFile.filePath, {
        expires: DOWNLOAD_URL_EXPIRES_SECONDS,
        userId: user.id,
    })

    return resSuccess(event, '获取下载地址成功', { downloadUrl })
})
