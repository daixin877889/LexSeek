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
import { FileSource, OssFileStatus } from '#shared/types/file'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { createOssFileDao, findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { textToDocxService } from './textToDocx.service'
import { createContractReviewDAO } from './contractReview.dao'
import type { CreateReviewRequest, CreateReviewResponse } from '#shared/types/contract'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_PASTE_LENGTH = 50000

export interface CreateAndStartOptions extends CreateReviewRequest {
    userId: number
}

export type CreateAndStartResult =
    | CreateReviewResponse
    | { error: string; code: number }

/**
 * 创建合同审查并入队 Worker。
 * 按 sourceType 分流取到 originalFileId，再建 session / review / enqueue。
 */
export async function createAndStartContractReviewService(
    options: CreateAndStartOptions,
): Promise<CreateAndStartResult> {
    const { userId, sourceType, ossFileId, text } = options

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

        const [uploadResult, storageConfig] = await Promise.all([
            uploadFileService(ossPath, docxBuffer, {
                contentType: DOCX_MIME,
                userId,
            }),
            getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userId),
        ])
        const bucketName = storageConfig?.bucket ?? ''

        const ossFileRow = await createOssFileDao({
            userId,
            bucketName,
            fileName: 'pasted-contract.docx',
            filePath: uploadResult.name,
            fileSize: docxBuffer.length,
            fileType: DOCX_MIME,
            source: FileSource.CASE_ANALYSIS,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        })
        originalFileId = ossFileRow.id
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
