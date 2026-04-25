/**
 * 合同审查 Service 层
 *
 * `createAndStartContractReviewService` 负责创建合同审查记录并入队 Worker：
 * - upload: 校验 ossFile 归属和 MIME 类型
 * - paste: 调 textToDocxService 生成 .docx → 上传 OSS → 落库 ossFiles
 * 然后显式建 scope='contract' 的 caseSessions 行，创建 contractReviews，
 * 最后入队 enqueueRunService。
 *
 * **Feature: contract-review-m3**
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '~~/server/utils/db'
import { FileSource } from '#shared/types/file'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { textToDocxService } from './textToDocx.service'
import { createContractReviewDAO } from './contractReview.dao'
import { uploadAndRegisterOssFile } from './utils/uploadAndRegisterOssFile'
import { DOCX_MIME } from '#shared/utils/mime'
import type { CreateReviewRequest, CreateReviewResponse } from '#shared/types/contract'

const MAX_PASTE_LENGTH = 50000

/**
 * CORE-M2：从粘贴文本头部抽 ≤20 字 + 当前日期生成 OSS fileName，避免重名。
 * 字段长度服从 ossFiles.file_name 兼容（非 OSS path），仅 UI 列表展示用。
 */
function buildPastedFileName(text: string): string {
    const head = text
        .replace(/[\s\r\n\t]+/g, '')
        // OS 文件名禁字符 + 反引号 + 引号一并清掉
        .replace(/[\\/:*?"<>|`'()\[\]{}]/g, '')
        .slice(0, 20)
        .trim()
    const dateStr = new Date().toISOString().slice(0, 10)
    const safeHead = head.length > 0 ? head : '粘贴'
    return `${safeHead}_${dateStr}.docx`
}

export interface CreateAndStartOptions extends CreateReviewRequest {
    userId: number
}

export type CreateAndStartResult =
    | CreateReviewResponse
    | { error: string; code: number }

/**
 * 创建合同审查并入队 Worker。
 * 按 sourceType 分流取到 originalFileId，再建 session / review / enqueue。
 *
 * caseId（可选）：若传入，需校验案件归属当前用户，否则返回 403。写入 review.caseId 后
 * 列表接口可按 caseId 过滤（案件详情 Tab 复用场景）。
 */
export async function createAndStartContractReviewService(
    options: CreateAndStartOptions,
): Promise<CreateAndStartResult> {
    const { userId, sourceType, ossFileId, text, caseId } = options

    // caseId 归属校验：owner-only，软删的案件视为不可用
    if (caseId !== undefined) {
        const caseRow = await prisma.cases.findFirst({
            where: { id: caseId, userId, deletedAt: null },
            select: { id: true },
        })
        if (!caseRow) {
            return { error: '案件不存在或无权访问', code: 403 }
        }
    }

    let originalFileId: number

    if (sourceType === 'upload') {
        if (!ossFileId) {
            return { error: 'ossFileId 不能为空', code: 400 }
        }
        const ossFile = await findOssFileByIdDao(ossFileId)
        if (!ossFile || ossFile.userId !== userId) {
            return { error: '文件不存在或无权访问', code: 403 }
        }
        if (ossFile.fileType !== DOCX_MIME) {
            return { error: '仅支持 .docx 格式的合同文件', code: 400 }
        }
        originalFileId = ossFile.id
    }
    else if (sourceType === 'paste') {
        if (!text || text.length === 0) {
            return { error: '粘贴文本不能为空', code: 400 }
        }
        if (text.length > MAX_PASTE_LENGTH) {
            return { error: `粘贴文本长度不能超过 ${MAX_PASTE_LENGTH} 字`, code: 413 }
        }

        const docxBuffer = await textToDocxService(text)
        const ossPath = `contract-review/${userId}/${randomUUID()}.docx`

        // CORE-R3：上传 + 落 ossFiles + 失败清孤儿统一走 uploadAndRegisterOssFile。
        // CORE-M2：fileName 仍用粘贴文本头几字 + 时间戳，避免列表里多条粘贴 review
        // 全部叫 pasted-contract.docx 难识别。
        const { ossFileId } = await uploadAndRegisterOssFile({
            ossPath,
            buffer: docxBuffer,
            fileName: buildPastedFileName(text),
            fileType: DOCX_MIME,
            userId,
            source: FileSource.CASE_ANALYSIS,
        })
        originalFileId = ossFileId
    }
    else {
        return { error: '不支持的 sourceType', code: 400 }
    }

    // 显式建 scope='contract' 的 caseSession（不复用 createAssistantSessionDAO，
    // 后者硬编码 scope='assistant' 会让 agentWorker 路由错误）
    const sessionId = randomUUID()
    await prisma.caseSessions.create({
        data: {
            sessionId,
            scope: 'contract',
            userId,
            caseId: null,
            type: 1,
            status: 1,
            title: sourceType === 'paste' ? '合同审查 · 粘贴文本' : '合同审查',
        },
    })

    const review = await createContractReviewDAO({
        userId,
        sessionId,
        originalFileId,
        status: 'pending',
        ...(caseId !== undefined ? { caseId } : {}),
    })

    await enqueueRunService({
        sessionId,
        threadId: sessionId,
        userId,
        caseId: null,
        input: { message: undefined, command: undefined },
    })

    return { reviewId: review.id, sessionId }
}
