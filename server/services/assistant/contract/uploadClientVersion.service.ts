/**
 * 客户回传 docx 上传处理链路（6 步）。
 *
 * B1 实现：Step 1 备份 + Step 2 解析 + Step 6 merge 快照（diff 和 AI 步骤占位）。
 * B2 填充：Step 3 diff + Step 5 锚点迁移。
 * B3 填充：Step 4 AI 增量审查 + 全局复核。
 *
 * 编排函数通过 AsyncGenerator 吐出进度事件，handler（Task 1.6）把事件转成 SSE。
 *
 * **Feature: contract-review-versioning-phase-b**
 */
import type { contractReviews, Prisma } from '~~/generated/prisma/client'
import type {
    UploadVersionProgressData,
    UploadVersionCompleteData,
    UploadVersionErrorData,
    ClauseSnapshotItem,
    Risk,
    RiskLevel,
} from '#shared/types/contract'
import { logger } from '#shared/utils/logger'
import type { ClauseSegment, PlaybookSnapshot, Stance } from '#shared/types/contract'
import { segmentClauses } from './docx/clauseSegmenter'
import { parseContractDocx } from './docx'
import { saveContractReviewVersionService } from './contractReviewVersion.service'
import { analyzeSingleClause } from './analyzeSingleClause'
import { diffClauses } from './utils/clauseDiff'
import { migrateAnchor } from './utils/anchorMigrate'
import { parseWordComments, type ParsedWordComment, type AnnotationRefEntry } from './docx/wordCommentParser'
import { parseCommentRef, generateWordCommentRef, stripAuthorRef } from './utils/wordCommentRef'
import { updateContractReviewDAO } from './contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { downloadFileService } from '~~/server/services/storage/storage.service'
import { renderContent } from '~~/server/services/node/prompt.service'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { DOCX_MIME } from '#shared/utils/mime'

/**
 * upload-version 视为"忙任务"的状态集合。
 * 与 server/api/v1/assistant/contract/reviews/[id]/upload-version.post.ts
 * 的 BUSY_STATUSES 保持同步，由 HTTP 层快速失败 + service 层原子锁双重保护。
 */
const UPLOAD_BUSY_STATUSES = ['pending', 'reviewing', 'awaiting_stance', 'rebuilding'] as const

/** ZIP 文件头（PK\x03\x04），docx 本质是 zip，用于二进制层快速校验。 */
function isValidDocxBuffer(buf: Buffer): boolean {
    return buf.length >= 4
        && buf[0] === 0x50 && buf[1] === 0x4B
        && buf[2] === 0x03 && buf[3] === 0x04
}

type UploadEvent =
    | { type: 'progress'; data: UploadVersionProgressData }
    | { type: 'complete'; data: UploadVersionCompleteData }
    | { type: 'error'; data: UploadVersionErrorData }

/**
 * 客户回传 docx 上传六步处理链路。
 *
 * @param params.review    合同审查记录（含 id 和 currentVersionId）
 * @param params.ossFileId 客户回传的 docx 在 OSS 的文件 ID
 * @param params.userId    操作人 userId（owner 校验由 handler 层负责，service 不重复校验）
 */
export async function* uploadClientVersionService(params: {
    review: contractReviews
    ossFileId: number
    userId: number
}): AsyncGenerator<UploadEvent> {
    const { review, ossFileId, userId } = params

    // ============ Step 0: 原子状态锁（bug #10） ============
    // HTTP 层已做过快速预检，但检查→开始之间存在 TOCTOU 窗口，
    // 两个并发请求可能都通过 HTTP 检查。这里用条件 UPDATE 做一次原子转移：
    // 仅当当前状态不在 BUSY 集合时才置为 rebuilding；count === 0 说明被他人抢占。
    const claim = await prisma.contractReviews.updateMany({
        where: {
            id: review.id,
            status: { notIn: UPLOAD_BUSY_STATUSES as unknown as string[] },
        },
        data: { status: 'rebuilding' },
    })
    if (claim.count === 0) {
        yield {
            type: 'error',
            data: { step: 'backup', code: 'CONCURRENT_UPLOAD', message: '已有处理中的任务，请稍候再试' },
        }
        return
    }

    // 原子锁一旦拿到，后续无论成功/失败都必须释放，否则审查会永久卡在 rebuilding。
    // 成功 → completed；任意失败（yield error + return / throw）→ failed。
    let succeeded = false
    try {
        // ============ Step 1: 自动备份当前工作区 ============
        try {
            const hasUnsaved = await detectUnsavedEdits(review.id, review.currentVersionId)
            if (hasUnsaved) {
                await saveContractReviewVersionService({
                    reviewId: review.id,
                    systemLabel: 'auto_backup',
                    createdById: userId,
                })
            }
            yield { type: 'progress', data: { step: 'backup', status: 'done' } }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '备份失败'
            yield { type: 'error', data: { step: 'backup', code: 'BACKUP_FAILED', message: msg } }
            return
        }

        // ============ Step 2: 解析新上传 docx（bug #9 强校验） ============
        let newDocxText: string
        let newClauses: ClauseSnapshotItem[]
        let newComments: ParsedWordComment[] = []
        let annotationRefsByWId = new Map<number, AnnotationRefEntry>()
        try {
            const ossFile = await findOssFileByIdDao(ossFileId)
            if (!ossFile?.filePath) throw new Error('OSS 文件记录不存在或已删除')
            if (ossFile.fileType && ossFile.fileType !== DOCX_MIME) {
                throw new Error(`上传文件类型 ${ossFile.fileType} 不是 docx`)
            }

            const docxBuffer = await downloadFileService(ossFile.filePath)
            if (!isValidDocxBuffer(docxBuffer)) {
                throw new Error('上传文件不是合法 docx（缺少 ZIP 文件头 PK\\x03\\x04）')
            }

            // 用同一份 Buffer 解析段落 + 批注，避免重复下载
            const { paragraphs } = await parseContractDocx(docxBuffer)
            const { segments, normalizedText } = await segmentClauses(paragraphs.join('\n'))
            newDocxText = normalizedText
            newClauses = segments.map((s) => ({
                index: s.index,
                text: s.text,
                offsetStart: s.offsetStart,
                offsetEnd: s.offsetEnd,
            }))

            // bug #9：parseWordComments 失败不再静默降级为空批注，
            // 让上层感知并置 status=failed，避免"批注被当全部删除"的数据误删。
            const parsed = await parseWordComments(docxBuffer)
            newComments = parsed.comments
            annotationRefsByWId = parsed.annotationRefsByWId

            yield { type: 'progress', data: { step: 'parse', status: 'done' } }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '解析失败'
            yield { type: 'error', data: { step: 'parse', code: 'PARSE_FAILED', message: msg } }
            return
        }

    // ============ Step 3: 识别正文差异 + 批注变更 ============
    const [dbAnnotations, dbRisks, currentVersion] = await Promise.all([
        prisma.contractAnnotations.findMany({ where: { reviewId: review.id, deletedAt: null } }),
        prisma.contractRisks.findMany({ where: { reviewId: review.id } }),
        review.currentVersionId
            ? prisma.contractReviewVersions.findUnique({
                where: { id: review.currentVersionId },
                select: { snapshotData: true },
            })
            : Promise.resolve(null),
    ])
    const oldClauses: ClauseSnapshotItem[] =
        ((currentVersion?.snapshotData as { clauses?: ClauseSnapshotItem[] } | null)?.clauses ?? [])

    // 建 annotationId → ParsedWordComment 映射
    // 优先从 customXml annotationRefs 查（Phase B 新导出的 docx），
    // fallback 到 wInitials 正则解析（旧格式或 Word 截断后的降级路径）
    // bug #12：记录命中/失败来源，便于后续监控"系统批注被误升级为 external_new"的情况。
    const annById = new Map(dbAnnotations.map((a) => [a.id, a]))
    const commentByAnnId = new Map<number, ParsedWordComment>()
    let fallbackFail = 0
    // 多条 comment 解析到同一个 annotationId 时的"异常落点"集合：
    // 典型场景——老 docx（Phase C 改造前）在 Word 里被 people.xml 统一 initials，
    // 所有批注的 LEXSEEK 被设成同一个完整值，parser 解析出同一个 annotationId。
    // 这时 commentByAnnId.set 静默覆盖会导致前面所有 comment 被丢失。
    const collidedComments: Array<{ annotationId: number; c: ParsedWordComment }> = []
    for (const c of newComments) {
        const refFromMap = annotationRefsByWId.get(c.wId)
        if (refFromMap) {
            if (annById.has(refFromMap.annotationId)) {
                if (commentByAnnId.has(refFromMap.annotationId)) {
                    // 同 annotationId 已被另一条 comment 匹配 → 本条降级为外部新增
                    // 避免 .set 覆盖让前面那条"消失"（bug: N-1 条 AI 被判已移除）
                    collidedComments.push({ annotationId: refFromMap.annotationId, c })
                    logger.warn('同 annotationId 被多条 comment 解析命中，本条降级为 external_new', {
                        reviewId: review.id,
                        wId: c.wId,
                        author: c.wAuthor,
                        initials: c.wInitials,
                        collidedAnnotationId: refFromMap.annotationId,
                        reason: '可能是 Word 把 people.xml 里同类作者的 initials 统一成一个值',
                    })
                    continue
                }
                commentByAnnId.set(refFromMap.annotationId, c)
                continue
            }
            fallbackFail++
            logger.warn('批注匹配失败被升级为 external_new', {
                reviewId: review.id,
                wId: c.wId,
                initials: c.wInitials,
                author: c.wAuthor,
                attemptedAnnotationId: refFromMap.annotationId,
                reason: '解析出的 annotationId 已不在 DB（可能被硬删或跨 review 串扰）',
            })
            continue
        }
        // 非系统批注（author/initials/customXml 都识别不到）→ 真新批注，交给下面分支处理
    }
    // 诊断快照：author + initials + parse 结果，帮助定位匹配失败原因
    const commentInitialsSnapshot = newComments.map(c => {
        const parsed = parseCommentRef(c.wAuthor, c.wInitials)
        return {
            wId: c.wId,
            author: c.wAuthor,
            initials: c.wInitials,
            parsedAnnotationId: parsed?.annotationId ?? null,
            contentPreview: (c.content ?? '').slice(0, 40),
        }
    })
    const sysCount = commentInitialsSnapshot.filter(c => c.parsedAnnotationId !== null).length
    const nonSysCount = commentInitialsSnapshot.length - sysCount
    logger.info('本次上传批注匹配统计', {
        reviewId: review.id,
        dbAnnotationsCount: dbAnnotations.length,
        totalNewComments: newComments.length,
        matched: commentByAnnId.size,
        fallbackFail,
        systemRefParsed: sysCount,
        noSystemRef: nonSysCount,
        dbAnnotationIds: dbAnnotations.map(a => a.id),
        commentInitialsSnapshot,
    })
    if (commentByAnnId.size === 0 && dbAnnotations.length > 0 && newComments.length > 0) {
        logger.warn(
            '批注 0 命中：所有原 AI 批注将被当成"客户已移除"，新 comment 全进 external_new。'
            + '常见原因：(1) 客户上传的 docx 不是 LexSeek 下载版；'
            + '(2) docx 是 Phase C 改造前的老导出（w:initials 被 Word 截断）；'
            + '(3) 跨 review 文件串扰。',
            { reviewId: review.id },
        )
    }

    /**
     * 判断一个 comment 是否为系统生成（LexSeek 注入）的批注。
     * Phase C：author 里 [#id-rand8] 或 initials 里 LEXSEEK 字面量任一命中即算系统批注。
     */
    function isSystemComment(c: ParsedWordComment): boolean {
        return annotationRefsByWId.has(c.wId) || parseCommentRef(c.wAuthor, c.wInitials) !== null
    }

    /**
     * 获取一个 comment 对应的 annotationId（系统批注专用）。
     * 与 isSystemComment 口径一致：先看 annotationRefsByWId，fallback 到
     * author/initials 混合解析。非系统批注返回 null。
     */
    function getAnnotationId(c: ParsedWordComment): number | null {
        const refFromMap = annotationRefsByWId.get(c.wId)
        if (refFromMap) return refFromMap.annotationId
        const parsed = parseCommentRef(c.wAuthor, c.wInitials)
        return parsed ? parsed.annotationId : null
    }

    // 客户删除：workspace annotation 在 newComments 里找不到命中
    const removedAnnIds: number[] = []
    for (const a of dbAnnotations) {
        if (!commentByAnnId.has(a.id)) removedAnnIds.push(a.id)
    }

    // bug #3：客户在 Word 里改了 AI / 律师批注的文本内容（wId 未变）。
    // 原系统批注必须保留，改动记为一条 external "客户回复" 子 annotation，
    // 避免客户修改被静默丢弃。
    const editedSystemReplies: Array<{ parentAnnId: number; c: ParsedWordComment }> = []
    for (const [annId, c] of commentByAnnId) {
        const dbAnn = annById.get(annId)
        if (!dbAnn) continue
        // external 本身就是客户批注，不适用此场景
        if (dbAnn.authorType === 'external') continue
        if (c.content.trim() === dbAnn.content.trim()) continue
        editedSystemReplies.push({ parentAnnId: annId, c })
    }

    // 客户回复：父 comment 是系统批注，子 comment 不是系统批注
    // 孤儿 reply（parent 找不到或父不是系统批注）降级为 newIndependent，避免静默丢失。
    const replies: Array<{ parentAnnId: number; c: ParsedWordComment }> = []
    const orphanReplies: ParsedWordComment[] = []
    for (const c of newComments) {
        if (c.parentWId == null) continue
        if (isSystemComment(c)) continue // 子 comment 自己是系统批注，不算回复
        const parent = newComments.find((p) => p.wId === c.parentWId)
        if (!parent) {
            // 父 comment 找不到（可能客户删除了父但保留 reply）
            logger.warn('孤儿 reply（父 comment 不存在）降级为 external_new', {
                reviewId: review.id,
                wId: c.wId,
                parentWId: c.parentWId,
            })
            orphanReplies.push(c)
            continue
        }
        const parentAnnId = getAnnotationId(parent)
        if (parentAnnId == null) {
            // 父 comment 不是系统批注 → 整条对话是客户自己的，同等降级为独立外部
            orphanReplies.push(c)
            continue
        }
        replies.push({ parentAnnId, c })
    }

    // 客户新增独立批注：no parent + 非系统批注；加上孤儿 reply + 同 id 冲突降级的 comment
    const newIndependent: ParsedWordComment[] = []
    for (const c of newComments) {
        if (c.parentWId != null) continue
        if (isSystemComment(c)) continue
        newIndependent.push(c)
    }
    for (const c of orphanReplies) newIndependent.push(c)
    for (const { c } of collidedComments) newIndependent.push(c)

    const clauseDiffResult = diffClauses(oldClauses, newClauses)
    const externalChangeCount =
        removedAnnIds.length + replies.length + newIndependent.length + editedSystemReplies.length
    const clauseModifiedCount = clauseDiffResult.modified.length

    yield {
        type: 'progress',
        data: { step: 'diff', status: 'done', externalChangeCount, clauseModifiedCount },
    }

    // ============ Step 4: AI 增量审查 + 全局复核 ============
    let aiReviewCount = 0
    let globalReviewNewRiskCount = 0

    // 4a. 对 diff.modified 的每个条款跑增量 AI 审查
    for (const [i, m] of clauseDiffResult.modified.entries()) {
        const item = newClauses[m.newIndex]!
        const clause: ClauseSegment = {
            index: item.index,
            number: null,
            text: item.text,
            offsetStart: item.offsetStart,
            offsetEnd: item.offsetEnd,
        }
        try {
            const risk = await analyzeSingleClause({
                clause,
                stance: (review.stance ?? 'balanced') as Stance,
                partyA: review.partyA,
                partyB: review.partyB,
                contractType: review.contractType,
                playbookSnapshot: review.playbookSnapshot as PlaybookSnapshot | null,
            })
            if (risk) {
                // 同条款已有未处置 AI 风险 → 只更新 level/suggestion，不改 archivedStatus
                const existingRisk = dbRisks.find(
                    (r) => r.source === 'ai' && r.anchorParagraphIndex === m.oldIndex && r.archivedStatus === null,
                )
                if (existingRisk) {
                    await prisma.contractRisks.update({
                        where: { id: existingRisk.id },
                        data: { level: risk.level, suggestion: risk.suggestion ?? null },
                    })
                } else {
                    const newRisk = await prisma.contractRisks.create({
                        data: {
                            reviewId: review.id,
                            source: 'ai',
                            code: risk.matchedPointCode ?? null,
                            category: risk.category,
                            level: risk.level,
                            stance: review.stance ?? 'balanced',
                            problem: risk.problem,
                            legalBasis: risk.legalBasis ?? null,
                            analysis: risk.analysis ?? null,
                            suggestion: risk.suggestion ?? null,
                            // 与 Phase A 原始 AI risk 保持一致：存条款全文，
                            // 不再截断（bug #11）。截断会导致后续 diff/锚点匹配失真。
                            anchorQuote: clause.text,
                            anchorParagraphIndex: m.newIndex,
                        },
                    })
                    const newAnn = await prisma.contractAnnotations.create({
                        data: {
                            reviewId: review.id,
                            riskId: newRisk.id,
                            authorType: 'ai',
                            authorName: 'AI',
                            content: risk.problem,
                        },
                    })
                    await prisma.contractAnnotations.update({
                        where: { id: newAnn.id },
                        data: { wordCommentRef: generateWordCommentRef(newAnn.id) },
                    })
                }
                aiReviewCount++
            }
        } catch (err) {
            logger.warn(`条款 #${clause.index} 增量 AI 审查失败，跳过`, { err })
        }
        yield {
            type: 'progress',
            data: { step: 'ai', status: 'progress', total: clauseDiffResult.modified.length, current: i + 1 },
        }
    }

    // 4b. 全局复核：对整篇新文本做平衡性检查
    try {
        const globalConfig = await getValidNodeConfig('contractReviewGlobalReview')
        const globalActiveKey = globalConfig.modelApiKeys.find((k) => k.status === 1)
        if (globalActiveKey) {
            const globalTemplate = globalConfig.prompts.find((p) => p.type === 'system' && p.status === 1)?.content
            if (globalTemplate) {
                const globalModel = createChatModel({
                    sdkType: globalConfig.modelSdkType,
                    modelName: globalConfig.modelName,
                    apiKey: globalActiveKey.apiKey,
                    baseUrl: globalConfig.modelProviderBaseUrl,
                    temperature: 0,
                })
                const rendered = renderContent(globalTemplate, {
                    contractType: review.contractType ?? '合同',
                    partyA: review.partyA ?? '甲方',
                    partyB: review.partyB ?? '乙方',
                    contractText: newDocxText,
                })
                const globalResp = await globalModel.invoke(rendered)
                const globalContent = typeof globalResp.content === 'string' ? globalResp.content : ''
                const jsonMatch = globalContent.match(/\[[\s\S]*\]/)
                if (jsonMatch) {
                    const rawRisks = JSON.parse(jsonMatch[0]) as Array<{
                        category: string
                        level: string
                        problem: string
                        legalBasis?: string
                        analysis?: string
                        suggestion?: string
                    }>
                    for (const r of rawRisks) {
                        const validLevel =
                            r.level === 'high' || r.level === 'medium' || r.level === 'low' ? r.level : 'medium'
                        const newRisk = await prisma.contractRisks.create({
                            data: {
                                reviewId: review.id,
                                source: 'global_review',
                                category: r.category ?? '全局复核',
                                level: validLevel,
                                stance: review.stance ?? 'balanced',
                                problem: r.problem ?? '',
                                legalBasis: r.legalBasis ?? null,
                                analysis: r.analysis ?? null,
                                suggestion: r.suggestion ?? null,
                                anchorQuote: (r.problem ?? '').slice(0, 50),
                                anchorParagraphIndex: 0,
                            },
                        })
                        const newAnn = await prisma.contractAnnotations.create({
                            data: {
                                reviewId: review.id,
                                riskId: newRisk.id,
                                authorType: 'ai',
                                authorName: 'AI',
                                content: r.problem ?? '',
                            },
                        })
                        await prisma.contractAnnotations.update({
                            where: { id: newAnn.id },
                            data: { wordCommentRef: generateWordCommentRef(newAnn.id) },
                        })
                        globalReviewNewRiskCount++
                    }
                }
            }
        }
    } catch (err) {
        logger.warn('全局复核失败，跳过', { err })
    }

    yield { type: 'progress', data: { step: 'ai', status: 'done' } }

    // ============ Step 5+6: 一次事务写入 + 保存快照 ============
    try {
        await prisma.$transaction(async (tx) => {
            // 标记客户删除的批注
            if (removedAnnIds.length > 0) {
                await tx.contractAnnotations.updateMany({
                    where: { id: { in: removedAnnIds } },
                    data: { removedByClient: true, suppressInExport: true },
                })
            }

            // 客户回复：升格为 external annotation
            for (const { parentAnnId, c } of replies) {
                const parent = annById.get(parentAnnId)!
                const newAnn = await tx.contractAnnotations.create({
                    data: {
                        reviewId: review.id,
                        riskId: parent.riskId,
                        parentAnnotationId: parentAnnId,
                        authorType: 'external',
                        authorName: stripAuthorRef(c.wAuthor) || '客户',
                        content: c.content,
                    },
                })
                await tx.contractAnnotations.update({
                    where: { id: newAnn.id },
                    data: { wordCommentRef: generateWordCommentRef(newAnn.id) },
                })
            }

            // bug #3：客户改 AI/律师批注文本 → 新增一条 external 子 annotation
            // 保留原 annotation 不动；客户真实诉求以 "客户修改为：..." 回复形式可见。
            for (const { parentAnnId, c } of editedSystemReplies) {
                const parent = annById.get(parentAnnId)!
                const newAnn = await tx.contractAnnotations.create({
                    data: {
                        reviewId: review.id,
                        riskId: parent.riskId,
                        parentAnnotationId: parentAnnId,
                        authorType: 'external',
                        authorName: stripAuthorRef(c.wAuthor) || '客户',
                        content: `客户修改了批注内容为：${c.content}`,
                    },
                })
                await tx.contractAnnotations.update({
                    where: { id: newAnn.id },
                    data: { wordCommentRef: generateWordCommentRef(newAnn.id) },
                })
            }

            // 客户新增独立批注 → external_new risk + external annotation
            for (const c of newIndependent) {
                // 锚点：优先用 comment 实际挂载的段落（parseWordComments 新增字段），
                // 回退到 0 只是兜底——以前硬写 0 会让所有外部批注都挤在文档开头显示"未定位"。
                // 同时用 docx 条款全文做 anchorQuote，前端 locate 才能真找到那段。
                const paraIdx = c.anchorParagraphIndex
                const anchorParagraphIndex = paraIdx !== null && paraIdx >= 0 && paraIdx < newClauses.length
                    ? paraIdx
                    : 0
                const anchorQuote = newClauses[anchorParagraphIndex]?.text ?? c.content.slice(0, 50)
                const risk = await tx.contractRisks.create({
                    data: {
                        reviewId: review.id,
                        source: 'external_new',
                        level: 'medium',
                        stance: 'balanced',
                        category: '外部批注',
                        problem: c.content.slice(0, 100),
                        anchorQuote,
                        anchorParagraphIndex,
                    },
                })
                const newAnn = await tx.contractAnnotations.create({
                    data: {
                        reviewId: review.id,
                        riskId: risk.id,
                        authorType: 'external',
                        authorName: stripAuthorRef(c.wAuthor) || '客户',
                        content: c.content,
                    },
                })
                await tx.contractAnnotations.update({
                    where: { id: newAnn.id },
                    data: { wordCommentRef: generateWordCommentRef(newAnn.id) },
                })
            }

            // 锚点迁移：modified / removed / unchanged 三种情况
            for (const r of dbRisks) {
                if (r.anchorParagraphIndex == null) continue
                const isModified = clauseDiffResult.modified.some((m) => m.oldIndex === r.anchorParagraphIndex)
                const isRemoved = clauseDiffResult.removed.includes(r.anchorParagraphIndex)

                if (isModified || isRemoved) {
                    const result = migrateAnchor({
                        oldAnchorQuote: r.anchorQuote ?? '',
                        oldParagraphIndex: r.anchorParagraphIndex,
                        newClauses,
                    })
                    if (result) {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: {
                                anchorParagraphIndex: result.newClauseIndex,
                                anchorCharStart: result.newCharStart,
                                anchorCharEnd: result.newCharEnd,
                                anchorQuote: newClauses[result.newClauseIndex]!.text.slice(
                                    result.newCharStart,
                                    result.newCharEnd,
                                ),
                                ...(r.originalAnchorQuote ? {} : { originalAnchorQuote: r.anchorQuote }),
                            },
                        })
                    } else {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: {
                                orphaned: true,
                                ...(r.originalAnchorQuote ? {} : { originalAnchorQuote: r.anchorQuote }),
                            },
                        })
                    }
                } else {
                    // unchanged clause：位置可能变化，更新 anchorParagraphIndex
                    const mapping = clauseDiffResult.unchanged.find(
                        (u) => u.oldIndex === r.anchorParagraphIndex,
                    )
                    if (mapping && mapping.newIndex !== r.anchorParagraphIndex) {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: { anchorParagraphIndex: mapping.newIndex },
                        })
                    }
                }
            }
        })

        // bug #13：Phase B 之后 contractRisks 表是权威来源，但 review.risks JSONB
        // 还是 PDF 导出 / 存量迁移 / 管理端列表等老消费方的数据源，
        // 每次上传结束必须把 JSONB 与表同步，避免读到过期快照。
        await syncReviewRisksJsonb(review.id)

        const summary = `本轮变化：${externalChangeCount} 处外部变更 · ${clauseModifiedCount} 处条款修改 · AI 增量重审 ${aiReviewCount} 条 · 全局复核 ${globalReviewNewRiskCount} 条`
        const newVersion = await saveContractReviewVersionService({
            reviewId: review.id,
            systemLabel: 'client_return',
            docxFileId: ossFileId,
            createdById: userId,
            docxText: newDocxText,
            clauses: newClauses,
        })

        yield {
            type: 'progress',
            data: { step: 'merge', status: 'done', newVersionId: newVersion.id },
        }
        yield {
            type: 'complete',
            data: { newVersionId: newVersion.id, summary },
        }
        succeeded = true
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '合并失败'
        yield { type: 'error', data: { step: 'merge', code: 'MERGE_FAILED', message: msg } }
    }
    } finally {
        // bug #9 + #10：原子锁必须释放。成功 → completed；任意失败分支 → failed。
        try {
            await updateContractReviewDAO(review.id, {
                status: succeeded ? 'completed' : 'failed',
            })
        } catch (releaseErr) {
            logger.error('uploadClientVersion: 释放 status 锁失败', {
                reviewId: review.id,
                succeeded,
                err: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
            })
        }
    }
}

/**
 * 把 contractRisks 表的当前行同步回 contractReviews.risks JSONB。
 *
 * Phase B 已不以 JSONB 为权威，但多处旧消费方（contractReviewPdf / migrate 脚本 /
 * 列表统计）仍在读取该字段。每次上传流程结束，按 Phase A Risk schema 序列化一次，
 * 保证二者同步。
 *
 * 只取未被客户删除（archivedStatus != client_removed）的风险；排序与原写入保持
 * 一致：先按锚点段落，再按 id。
 */
async function syncReviewRisksJsonb(reviewId: number): Promise<void> {
    // 读取该 review 下全部 risks（含新增 + 保留的旧 risks，不含 client_removed 彻底剔除的）。
    // 先保守地全量拉出，序列化时下游按 archivedStatus 自行过滤；保持与 Phase A 老消费方兼容。
    const rows = await prisma.contractRisks.findMany({
        where: { reviewId },
        orderBy: [{ anchorParagraphIndex: 'asc' }, { id: 'asc' }],
    })
    const risksJson: Risk[] = rows.map((r) => ({
        id: String(r.id),
        clauseIndex: r.anchorParagraphIndex ?? 0,
        clauseText: r.anchorQuote ?? '',
        level: r.level as RiskLevel,
        category: r.category,
        problem: r.problem,
        legalBasis: r.legalBasis ?? undefined,
        analysis: r.analysis ?? '',
        // Phase A schema 存在独立的 risk 字段；DB 不细分时复用 problem，保留兼容性
        risk: r.problem,
        suggestion: r.suggestion ?? '',
        matchedPointCode: r.code ?? undefined,
    }))
    await prisma.contractReviews.update({
        where: { id: reviewId },
        data: { risks: risksJson as unknown as Prisma.InputJsonValue },
    })
}

/**
 * 判断工作区相对 currentVersion 是否有未保存编辑。
 *
 * 判断依据（Phase A §4.3.1 自动备份幂等规则）：
 * - 取工作区最新 risk.updatedAt 和最新 annotation.updatedAt 中的较大值
 * - 若大于 currentVersion.createdAt，则认为有未保存编辑
 *
 * 注意：annotation 不过滤 deletedAt——软删（deletedAt 被设置）也属于律师"编辑"，
 * 应触发 auto_backup，避免丢失该编辑动作。
 *
 * 当 currentVersionId 为 null（尚未创建过快照）时，保守返回 false，
 * 不触发备份（此场景本就没有可备份的基线版本）。
 */
async function detectUnsavedEdits(
    reviewId: number,
    currentVersionId: number | null,
): Promise<boolean> {
    if (currentVersionId == null) return false

    const [latestRisk, latestAnn, currentVer] = await Promise.all([
        prisma.contractRisks.findFirst({
            where: { reviewId },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
        }),
        prisma.contractAnnotations.findFirst({
            where: { reviewId },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
        }),
        prisma.contractReviewVersions.findUnique({
            where: { id: currentVersionId },
            select: { createdAt: true },
        }),
    ])

    if (!currentVer) return false

    const latestEditMs = Math.max(
        latestRisk?.updatedAt?.getTime() ?? 0,
        latestAnn?.updatedAt?.getTime() ?? 0,
    )
    return latestEditMs > currentVer.createdAt.getTime()
}
