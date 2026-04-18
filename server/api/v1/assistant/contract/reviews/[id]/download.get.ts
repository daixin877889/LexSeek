/**
 * GET /api/v1/assistant/contract/reviews/:id/download
 *
 * 取合同审查已完成的批注版 .docx 的 1 小时签名下载 URL。
 *
 * 返回 `{ downloadUrl }`，由前端直接拼在 `<a download>` 或 window.open 上使用。
 *
 * 分支：
 *  - 401 未登录
 *  - 400 reviewId 无效（非整数 / ≤ 0）
 *  - 404 review 不存在（含软删）
 *  - 403 review 属于他人
 *  - 400 review 尚未完成（reviewedFileId 为空）
 *  - 404 ossFile 记录丢失
 *  - 200 成功，data.downloadUrl 为 https 签名 URL
 *
 * **Feature: contract-review-m4**
 */

import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'

const DOWNLOAD_URL_EXPIRES_SECONDS = 3600

export default defineEventHandler(async (event) => {
    // 1. 鉴权
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 校验 reviewId
    const idParam = getRouterParam(event, 'id')
    const reviewId = Number(idParam)
    if (!Number.isInteger(reviewId) || reviewId <= 0) {
        return resError(event, 400, '合同审查 ID 无效')
    }

    // 3. 查 review + 归属校验
    const review = await getContractReviewDAO(reviewId)
    if (!review) {
        return resError(event, 404, '合同审查不存在')
    }
    if (review.userId !== user.id) {
        return resError(event, 403, '无权访问该合同审查')
    }

    // 4. 校验审查是否已完成（reviewedFileId 是产物 id，未完成为 null）
    const reviewedFileId = review.reviewedFileId
    if (!reviewedFileId) {
        return resError(event, 400, '审查尚未完成，暂无可下载文件')
    }

    // 5. 查 OSS 文件记录
    const ossFile = await findOssFileByIdDao(reviewedFileId)
    if (!ossFile || !ossFile.filePath) {
        return resError(event, 404, '审查结果文件已丢失')
    }

    // 6. 生成 1 小时签名 URL
    const downloadUrl = await generateSignedUrlService(ossFile.filePath, {
        expires: DOWNLOAD_URL_EXPIRES_SECONDS,
        userId: user.id,
    })

    return resSuccess(event, '获取下载地址成功', { downloadUrl })
})
