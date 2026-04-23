/**
 * GET /api/v1/assistant/contract/reviews/:id/download
 *
 * 下载批注版 .docx 的 1 小时签名 URL。
 * 每次调用都实时调用 rebuildDocxService 重新注入 Phase B 格式批注，
 * 确保下载产物的 wordCommentRef 符合 LEXSEEK-xxx 格式，避免客户回传
 * 后被 uploadClientVersion 误判为外部新增（external_new）。
 *
 * 返回 `{ downloadUrl, filename }`，由前端直接拼在 `<a download>` 上。
 * filename 格式：`{原文件名}_v{版本号}_{YYYY-MM-DD}.docx`
 *
 * 错误分支：
 *  - 401 未登录
 *  - 400 reviewId 无效（非整数 / ≤ 0）
 *  - 404 review 不存在（含软删）
 *  - 403 review 属于他人
 *  - 400 review 尚未完成（reviewedFileId 为空）
 *  - 500 重生批注失败
 *  - 404 新产物 ossFile 丢失
 *
 * **Feature: contract-review-m4**
 * **Feature: contract-review-versioning-phase-a（Phase A Task 4.3 文件名带版本号）**
 * **Phase B 改造**：切换到实时 injectAnnotations，修复旧产物无 wordCommentRef 问题
 */

import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { rebuildDocxService } from '~~/server/services/assistant/contract/contractReviewRebuild.service'

// 与文书导出（documentExport.service.ts）保持 1h 对齐
const DOWNLOAD_URL_EXPIRES_SECONDS = 3600

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '访问该合同审查' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { user, review } = guard

    // 校验审查是否已完成（reviewedFileId 是产物 id，未完成为 null）
    if (!review.reviewedFileId) {
        return resError(event, 400, '审查尚未完成，暂无可下载文件')
    }

    // 实时重注入 Phase B 批注：下载原件 → 注入 → 上传 → 更新 reviewedFileId + wordCommentRef
    let newReviewedFileId: number
    try {
        const result = await rebuildDocxService(review)
        newReviewedFileId = result.reviewedFileId
    } catch (err) {
        logger.error('[contract download] 重生批注失败', { reviewId: review.id, err })
        return resError(event, 500, '生成批注文件失败，请稍后重试')
    }

    // 查新产物 OSS 文件记录（rebuildDocxService 已写入 DB）
    const ossFile = await findOssFileByIdDao(newReviewedFileId)
    if (!ossFile || !ossFile.filePath) {
        return resError(event, 404, '审查结果文件已丢失')
    }

    // 文件名：取原始合同文件名（非重建产物名）+ 版本号/工作区 + 日期
    // 规则见 spec §4.4：{合同名}_{版本号或"工作区"}_{日期}.docx
    const originalOssFile = await findOssFileByIdDao(review.originalFileId)
    const versionLabel = review.maxVersionNo > 0 ? `v${review.maxVersionNo}` : '工作区'
    const dateStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const baseName = (originalOssFile?.fileName ?? '合同审查').replace(/\.docx$/i, '')
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
