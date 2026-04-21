/**
 * 合同审查结果持久化中间件（contractReviewMain 专用，末位）
 *
 * beforeAgent: 置 status='reviewing'
 * afterAgent:
 *   - structuredResponse 有值 → 用 riskSchema 校验并走正常流程
 *   - structuredResponse 缺失 → fallback：尝试从最后一条 AIMessage 消息体解析 ```json``` 代码块
 *     （DeepSeek 等 SDK 在未用 toolStrategy 时会把 JSON 写进正文）
 *   - fallback 仍失败 → status='failed'（risks=null，不可 rebuild）
 *   - schema 校验/注入/上传失败 → status='failed'（risks 已落库时用户可通过 rebuild-docx 重试）
 */

import { createMiddleware } from 'langchain'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '~~/generated/prisma/client'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '../../assistant/contract/contractReview.dao'
import { injectComments } from '../../assistant/contract/docx'
import { buildRiskSchema } from '../../assistant/contract/riskSchema.builder'
import {
    downloadFileService,
    uploadFileService,
} from '../../storage/storage.service'
import { getDefaultStorageConfigDao } from '../../storage/storageConfig.dao'
import {
    findOssFileByIdDao,
    createOssFileDao,
} from '../../files/ossFiles.dao'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { DOCX_MIME } from '#shared/utils/mime'
import type { Risk } from '#shared/types/contract'

interface ReviewResultPersistenceOptions {
    reviewId: number
    sessionId: string
}

interface StructuredReviewResult {
    risks: Risk[]
    summary: string
}

/**
 * 从 AI 消息文本里兜底解析 JSON：
 *  1. 优先匹配 ```json ... ``` 代码块（支持多个 fence，取第一个能解析的）
 *  2. 退化匹配首个 `{` 到最后一个 `}` 的子串
 * 解析失败返回 null，让上层走 failed 分支。
 * 与 draftResultPersistence.middleware.ts 的 tryParseStructuredFromText 思路一致。
 */
function tryParseStructuredFromText(text: string): unknown {
    if (!text || typeof text !== 'string') return null

    const candidates: string[] = []
    const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi
    let m: RegExpExecArray | null
    while ((m = fenceRegex.exec(text)) !== null) {
        if (m[1]) candidates.push(m[1])
    }

    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidates.push(text.slice(firstBrace, lastBrace + 1))
    }

    for (const raw of candidates) {
        try {
            return JSON.parse(raw.trim())
        } catch {
            // 继续
        }
    }
    return null
}

/** 从 state.messages 末尾倒序找 AIMessage，提取纯文本后尝试解析 */
function extractStructuredFromMessages(state: any): unknown {
    const messages = Array.isArray(state?.messages) ? state.messages : []
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        const type = msg?.getType?.() ?? msg?._getType?.() ?? msg?.role
        const isAi = type === 'ai' || type === 'assistant'
        if (!isAi) continue
        const content = typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
                ? msg.content.map((c: any) => (typeof c === 'string' ? c : (c?.text ?? ''))).join('')
                : ''
        const parsed = tryParseStructuredFromText(content)
        if (parsed) return parsed
    }
    return null
}

export const reviewResultPersistenceMiddleware = (
    options: ReviewResultPersistenceOptions,
) => createMiddleware({
    name: 'ReviewResultPersistenceMiddleware',

    beforeAgent: {
        hook: async (_state: any) => {
            try {
                await updateContractReviewDAO(options.reviewId, { status: 'reviewing' })
            } catch (err) {
                logger.error('reviewResultPersistence beforeAgent 失败', {
                    reviewId: options.reviewId, err,
                })
            }
        },
    },

    afterAgent: {
        hook: async (state: any) => {
            // 1) 先从 structuredResponse 取，失败再从消息体兜底解析
            let raw: unknown = state?.structuredResponse ?? null
            if (!raw) {
                raw = extractStructuredFromMessages(state)
                if (raw) {
                    logger.info('reviewResultPersistence: 从消息体解析 JSON 兜底成功', {
                        reviewId: options.reviewId,
                    })
                }
            }

            // 2) zod 校验。AI 输出格式不对时直接 failed，避免脏数据落库
            const schema = buildRiskSchema()
            const validation = schema.safeParse(raw)
            if (!validation.success) {
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
                logger.warn('reviewResultPersistence: 结构化结果缺失或校验失败', {
                    reviewId: options.reviewId,
                    hadRaw: !!raw,
                    issue: validation.success ? null : validation.error.issues[0]?.message,
                })
                return
            }
            const structured: StructuredReviewResult = validation.data

            // Step 1: 先落库 risks/summary（失败态 rebuild 的前提）
            // Risk[] 是 POJO 结构，Prisma Json 字段需显式转为 InputJsonValue。
            // M6.1 Task 1.2：LLM 仍输出字符串 summary，为了让前端/PDF 按统一
            // ContractOverview 形态消费，此处把它包装为 { highlights: null, overall }。
            // 子期 3 升级 summarize 节点后再替换为真正的 highlights。
            try {
                await updateContractReviewDAO(options.reviewId, {
                    risks: structured.risks as unknown as Prisma.InputJsonValue,
                    summary: {
                        highlights: null,
                        overall: structured.summary,
                    } as unknown as Prisma.InputJsonValue,
                })
            } catch (err) {
                logger.error('reviewResultPersistence: 写 risks/summary 失败', {
                    reviewId: options.reviewId, err,
                })
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
                return
            }

            // Step 2: 注入批注 + 上传新 .docx
            try {
                const review = await getContractReviewDAO(options.reviewId)
                if (!review) throw new Error(`review ${options.reviewId} not found`)
                const originalOssFile = await findOssFileByIdDao(review.originalFileId)
                if (!originalOssFile) throw new Error(`original oss file ${review.originalFileId} not found`)
                if (!originalOssFile.filePath) throw new Error(`original oss file ${review.originalFileId} has no filePath`)

                const originalBuffer = await downloadFileService(originalOssFile.filePath)
                const injectResult = await injectComments(originalBuffer, structured.risks)

                // OSS 路径与 contractReviewRebuild.service 保持同构：
                // contract-review/<userId>/reviewed-<uuid>.docx
                const ossPath = `contract-review/${review.userId}/reviewed-${randomUUID()}.docx`
                const uploadResult = await uploadFileService(ossPath, injectResult.buffer, {
                    contentType: DOCX_MIME,
                    userId: review.userId,
                })

                const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, review.userId)
                const bucketName = storageConfig?.bucket ?? ''

                const ossFileRow = await createOssFileDao({
                    userId: review.userId,
                    bucketName,
                    fileName: `reviewed-${options.reviewId}.docx`,
                    filePath: uploadResult.name,
                    fileSize: injectResult.buffer.length,
                    fileType: DOCX_MIME,
                    source: FileSource.CASE_ANALYSIS,
                    status: OssFileStatus.UPLOADED,
                    encrypted: false,
                })

                // 若注入时丢掉了越界 risks，DB 只保存有效的 risks，
                // 避免 risks JSON 与 docx 批注不一致（用户看见的风险清单数量与 Word 内批注数量差异）
                const updatePayload: Prisma.contractReviewsUpdateInput = {
                    reviewedFileId: ossFileRow.id,
                    status: 'completed',
                }
                if (injectResult.skippedIndices.length > 0) {
                    updatePayload.risks = injectResult.validRisks as unknown as Prisma.InputJsonValue
                    logger.warn('reviewResultPersistence: clauseIndex 越界的 risks 已从 DB 剔除', {
                        reviewId: options.reviewId,
                        skipped: injectResult.skippedIndices.length,
                        kept: injectResult.validRisks.length,
                    })
                }
                await updateContractReviewDAO(options.reviewId, updatePayload)
            } catch (err) {
                logger.error('reviewResultPersistence: 批注/上传失败', {
                    reviewId: options.reviewId, err,
                })
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
            }
        },
    },
})
