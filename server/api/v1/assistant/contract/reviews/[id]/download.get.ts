/**
 * GET /api/v1/assistant/contract/reviews/:id/download
 *
 * 返回 review.reviewedFileId 对应的 .docx 1 小时签名下载 URL。
 *
 * **按 spec §8.5 设计**：本端点只做"取签名 URL"，不再触发 rebuild。
 * 如果律师编辑过 risks 但还没手动"重生批注"，`hasUnsavedDocxChanges=true`，
 * 前端 UI 会提示并引导律师先点"重新生成批注"按钮；显式的重生入口是
 * POST /reviews/:id/rebuild-docx（见 RiskListPanel 的 @rebuild 事件）。
 *
 * 历史：早期曾在本端点里每次都跑 rebuildDocxService（Phase B 改造时为了
 * 给"老 Phase A 产物补 LEXSEEK ref"做兼容）。现在 Phase C+ 三重身份证防线
 * 已上线，那个兼容理由消失，"每次下载都全量 rebuild"会：
 *   - 与 POST /rebuild-docx 的 atomicSetRebuildingDAO 占位锁撞
 *   - 并发下载产生多个 OSS 孤儿文件
 *   - 把 hasUnsavedDocxChanges 静默改为 false，让律师误以为"已保存"
 * 回到 spec 后这些副作用都消失。
 *
 * 返回 `{ downloadUrl, filename }`，filename 格式见 spec §4.4。
 *
 * 错误分支：
 *  - 401 未登录
 *  - 400 reviewId 无效
 *  - 404 review 不存在 / 属于他人（403）
 *  - 400 review 尚未完成（reviewedFileId 为空）
 *  - 404 reviewedFileId 指向的 OSS 文件已丢失
 *
 * **Feature: contract-review-m4**
 * **Feature: contract-review-versioning-phase-a（文件名带版本号）**
 */

import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { generateSignedUrlService } from '~~/server/services/storage/storage.service'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import {
    buildContractReviewFilename,
    buildContentDispositionForFilename,
} from '~~/server/services/assistant/contract/contractReviewFilename'

// 与文书导出（documentExport.service.ts）保持 1h 对齐
const DOWNLOAD_URL_EXPIRES_SECONDS = 3600

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '访问该合同审查' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { user, review } = guard

    // 未完成：reviewedFileId 尚未就绪
    if (!review.reviewedFileId) {
        return resError(event, 400, '审查尚未完成，暂无可下载文件')
    }

    // 直接取 reviewedFileId 指向的 OSS 产物
    const ossFile = await findOssFileByIdDao(review.reviewedFileId)
    if (!ossFile || !ossFile.filePath) {
        return resError(event, 404, '审查结果文件已丢失')
    }

    // 文件名：{原合同名}_{版本号或"工作区"}_{日期}.docx
    const originalOssFile = await findOssFileByIdDao(review.originalFileId)
    const filename = buildContractReviewFilename({
        originalFileName: originalOssFile?.fileName,
        versionNumber: review.maxVersionNo,
    })
    const contentDisposition = buildContentDispositionForFilename(filename)

    const downloadUrl = await generateSignedUrlService(ossFile.filePath, {
        expires: DOWNLOAD_URL_EXPIRES_SECONDS,
        userId: user.id,
        response: { contentDisposition },
    })

    return resSuccess(event, '获取下载地址成功', { downloadUrl, filename })
})
