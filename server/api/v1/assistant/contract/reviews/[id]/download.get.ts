/**
 * GET /api/v1/assistant/contract/reviews/:id/download
 *
 * 取合同审查已完成的批注版 .docx 的 1 小时签名下载 URL。
 *
 * 返回 `{ downloadUrl, filename }`，由前端直接拼在 `<a download>` 或 window.open 上使用。
 * filename 格式：`{原文件名}_v{版本号}_{YYYY-MM-DD}.docx`（Phase A 简化：永远用 maxVersionNo）
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
 *  - 200 data.downloadUrl 为 https 签名 URL（1 小时有效），data.filename 为建议文件名
 *
 * **Feature: contract-review-m4**
 * **Feature: contract-review-versioning-phase-a（Phase A Task 4.3 文件名带版本号）**
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

    // Phase A Task 4.3：文件名带版本号
    // 版本标识：Phase A 简化规则 —— 永远用 v{maxVersionNo}（当前总是指向最新快照）
    const versionLabel = `v${review.maxVersionNo || 1}`
    const dateStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const baseName = (ossFile.fileName ?? '合同审查').replace(/\.docx$/i, '')
    const filename = `${baseName}_${versionLabel}_${dateStr}.docx`

    // RFC 5987 编码，让 OSS 通过 response-content-disposition 返回正确文件名
    const encodedFilename = encodeURIComponent(filename)
    const contentDisposition = `attachment; filename*=UTF-8''${encodedFilename}`

    // 生成 1 小时签名 URL（含 Content-Disposition 参数）
    const downloadUrl = await generateSignedUrlService(ossFile.filePath, {
        expires: DOWNLOAD_URL_EXPIRES_SECONDS,
        userId: user.id,
        response: { contentDisposition },
    })

    return resSuccess(event, '获取下载地址成功', { downloadUrl, filename })
})
