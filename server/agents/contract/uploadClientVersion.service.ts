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
    StancePreference,
} from '#shared/types/contract'
import { DEFAULT_AI_RISK_STANCE } from '#shared/types/contract'
import { logger } from '#shared/utils/logger'
import type { ClauseSegment, PlaybookSnapshot, Stance } from '#shared/types/contract'
import { persistAiRisksAsContractRows } from './contractRisk.service'
import { segmentClauses } from './docx/clauseSegmenter'
import { parseContractDocx } from './docx'
import { saveContractReviewVersionService } from './contractReviewVersion.service'
import { analyzeSingleClause } from './analyzeSingleClause'
import { diffClauses } from './utils/clauseDiff'
import { migrateAnchor } from './utils/anchorMigrate'
import { parseWordComments, type ParsedWordComment, type AnnotationRefEntry } from './docx/wordCommentParser'
import { parseCommentRef, generateWordCommentRef, stripAuthorRef } from './utils/wordCommentRef'
import { buildClauseToParagraphMap } from './utils/clauseToParagraph'

/** 外部批注作者名落库默认值（stripAuthorRef 后仍为空时兜底）和长度上限。 */
const DEFAULT_EXTERNAL_AUTHOR = '客户'
/** annotation.authorName DB 字段长度 VarChar(100)，超长客户姓名 slice 截断避免 Prisma 报错。 */
const AUTHOR_NAME_MAX_LEN = 100
function safeAuthorName(raw: string | null | undefined): string {
    const stripped = stripAuthorRef(raw) || DEFAULT_EXTERNAL_AUTHOR
    return stripped.slice(0, AUTHOR_NAME_MAX_LEN)
}
import { updateContractReviewDAO } from './contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { downloadFileService } from '~~/server/services/storage/storage.service'
import { renderContent } from '~~/server/services/node/prompt.service'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { DOCX_MIME } from '#shared/utils/mime'
import pLimit from 'p-limit'

/** Step 4a 增量审查的 LLM 并发上限：与主路径 ANALYZE_CONCURRENCY 同级。 */
const STEP4A_CONCURRENCY = 8

/**
 * upload-version 视为"忙任务"的状态集合。
 * 与 server/api/v1/assistant/contract/reviews/upload-version/[id].post.ts
 * 的 BUSY_STATUSES 保持同步，由 HTTP 层快速失败 + service 层原子锁双重保护。
 */
const UPLOAD_BUSY_STATUSES = ['pending', 'reviewing', 'awaiting_stance', 'rebuilding'] as const

/** ZIP 文件头（PK\x03\x04），docx 本质是 zip，用于二进制层快速校验。 */
function isValidDocxBuffer(buf: Buffer): boolean {
    return buf.length >= 4
        && buf[0] === 0x50 && buf[1] === 0x4B
        && buf[2] === 0x03 && buf[3] === 0x04
}

/**
 * DOCX-L1：除 ZIP 头之外，**尝试**加载 zip 检查是否含 word/document.xml。
 *
 * 不强制：JSZip 加载失败 / 异常时退回到只看 PK 头的旧逻辑（避免单测 fake buffer
 * 卡死），让 parseContractDocx 自己抛错暴露真问题；只在能加载 zip 但确实找不到
 * document.xml 时拒绝（普通 zip 文件被改名 .docx 上传的场景）。
 */
async function isLegitDocxZip(buf: Buffer): Promise<boolean> {
    if (!isValidDocxBuffer(buf)) return false
    try {
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(buf)
        return !!zip.file('word/document.xml')
    } catch {
        // 加载失败：很可能是测试 fixture 不是合法 zip，但 PK 头已通过；
        // 不阻断，让下游 parseContractDocx 自己抛具体错误。
        return true
    }
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
        // DOCX-C4：external_new 锚点需要用"非空段落序号 + 段落原文"而不是 clauseIndex，
        // 否则 paragraphIndex 可能远大于 newClauses.length 被误兜底为 0（挤到首段）。
        let newParagraphs: string[] = []
        try {
            const ossFile = await findOssFileByIdDao(ossFileId)
            if (!ossFile?.filePath) throw new Error('OSS 文件记录不存在或已删除')
            if (ossFile.fileType && ossFile.fileType !== DOCX_MIME) {
                throw new Error(`上传文件类型 ${ossFile.fileType} 不是 docx`)
            }

            const docxBuffer = await downloadFileService(ossFile.filePath)
            if (!await isLegitDocxZip(docxBuffer)) {
                throw new Error('上传文件不是合法 docx（缺少 ZIP 文件头或 word/document.xml）')
            }

            // 用同一份 Buffer 解析段落 + 批注，避免重复下载
            const { paragraphs } = await parseContractDocx(docxBuffer)
            newParagraphs = paragraphs
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
    // DOCX-C2 兜底：Phase A 存量 snapshot 可能没有 clauses 字段（Phase B 才加），
    // 直接用空数组会让 diffClauses 把新版所有条款都判成"新增"、锚点迁移完全失效。
    // 兜底：snapshot 里还有 docxText，用 segmentClauses 即时切一次作为 oldClauses。
    // 新建的 snapshot（Phase B 起）都含 clauses，此兜底只覆盖历史数据。
    let oldClauses: ClauseSnapshotItem[] =
        ((currentVersion?.snapshotData as { clauses?: ClauseSnapshotItem[] } | null)?.clauses ?? [])
    if (oldClauses.length === 0) {
        const oldDocxText = (currentVersion?.snapshotData as { docxText?: string } | null)?.docxText
        if (oldDocxText && oldDocxText.length > 0) {
            try {
                const { segments } = await segmentClauses(oldDocxText)
                oldClauses = segments.map(s => ({
                    index: s.index, text: s.text,
                    offsetStart: s.offsetStart, offsetEnd: s.offsetEnd,
                }))
                logger.info('[uploadClientVersion] 对 Phase A 存量 snapshot 重切 clauses', {
                    reviewId: review.id,
                    versionId: review.currentVersionId,
                    reconstructedCount: oldClauses.length,
                })
            } catch (err) {
                logger.warn('[uploadClientVersion] 重切 oldClauses 失败，继续走空数组', {
                    reviewId: review.id,
                    errMessage: err instanceof Error ? err.message : String(err),
                })
            }
        }
    }

    // 建 annotationId → ParsedWordComment 映射
    // 优先从 customXml annotationRefs 查（Phase B 新导出的 docx），
    // fallback 到 wInitials 正则解析（旧格式或 Word 截断后的降级路径）
    // bug #12：记录命中/失败来源，便于后续监控"系统批注被误升级为 external_new"的情况。
    const annById = new Map(dbAnnotations.map((a) => [a.id, a]))
    const commentByAnnId = new Map<number, ParsedWordComment>()
    let fallbackFail = 0
    let crossReviewRejected = 0
    // 多条 comment 解析到同一个 annotationId 时的"异常落点"集合
    const collidedComments: Array<{ annotationId: number; c: ParsedWordComment }> = []
    // 跨 review 串扰：身份证里的 reviewId 不等于当前 review.id
    const crossReviewComments: Array<{ c: ParsedWordComment; declaredReviewId: number }> = []
    // DOCX-H4：身份证命中但 annotationId 已不在 DB（律师硬删后客户又回复过），
    // 原实现只打 warn 静默丢弃；现在降级为 external_new，避免数据悄无声息消失。
    const fallbackFailComments: ParsedWordComment[] = []

    for (const c of newComments) {
        const refFromMap = annotationRefsByWId.get(c.wId)
        if (!refFromMap) continue // 非系统批注 → 真新批注

        // H7：身份证声明的 review 必须等于当前 review，否则拒绝（跨 review 文件串扰保护）
        if (refFromMap.reviewId !== review.id) {
            crossReviewRejected++
            crossReviewComments.push({ c, declaredReviewId: refFromMap.reviewId })
            logger.warn('跨 review 身份证被拒绝，降级为 external_new', {
                uploadReviewId: review.id,
                declaredReviewId: refFromMap.reviewId,
                declaredAnnotationId: refFromMap.annotationId,
                wId: c.wId,
                source: refFromMap.source,
            })
            continue
        }

        if (!annById.has(refFromMap.annotationId)) {
            fallbackFail++
            fallbackFailComments.push(c)
            logger.warn('批注匹配失败被升级为 external_new', {
                reviewId: review.id,
                wId: c.wId,
                initials: c.wInitials,
                author: c.wAuthor,
                attemptedAnnotationId: refFromMap.annotationId,
                source: refFromMap.source,
                reason: '解析出的 annotationId 已不在 DB（可能被硬删）',
            })
            continue
        }

        if (commentByAnnId.has(refFromMap.annotationId)) {
            // 同 annotationId 已被另一条 comment 匹配 → 本条降级为外部新增
            // 避免 .set 覆盖让前面那条"消失"
            collidedComments.push({ annotationId: refFromMap.annotationId, c })
            logger.warn('同 annotationId 被多条 comment 解析命中，本条降级为 external_new', {
                reviewId: review.id,
                wId: c.wId,
                author: c.wAuthor,
                source: refFromMap.source,
                collidedAnnotationId: refFromMap.annotationId,
            })
            continue
        }
        commentByAnnId.set(refFromMap.annotationId, c)
    }
    // 诊断快照：帮助定位匹配失败原因。大合同时（>50 条）只打前 50 条避免日志爆炸。
    const SNAPSHOT_LIMIT = 50
    const snapshotSource = newComments.slice(0, SNAPSHOT_LIMIT).map(c => {
        const fromMap = annotationRefsByWId.get(c.wId)
        return {
            wId: c.wId,
            author: c.wAuthor,
            source: fromMap?.source ?? null,
            declaredReviewId: fromMap?.reviewId ?? null,
            declaredAnnotationId: fromMap?.annotationId ?? null,
            contentPreview: (c.content ?? '').slice(0, 40),
        }
    })
    const parsedCount = newComments.filter(c => annotationRefsByWId.has(c.wId)).length
    logger.info('本次上传批注匹配统计', {
        reviewId: review.id,
        dbAnnotationsCount: dbAnnotations.length,
        totalNewComments: newComments.length,
        matched: commentByAnnId.size,
        fallbackFail,
        crossReviewRejected,
        systemRefParsed: parsedCount,
        noSystemRef: newComments.length - parsedCount,
        dbAnnotationIds: dbAnnotations.length > SNAPSHOT_LIMIT
            ? [...dbAnnotations.slice(0, SNAPSHOT_LIMIT).map(a => a.id), '...']
            : dbAnnotations.map(a => a.id),
        commentSnapshot: snapshotSource,
        snapshotTruncated: newComments.length > SNAPSHOT_LIMIT,
    })
    // 业务安全底线：如果 DB 里有系统批注、上传 docx 里也有批注，但一条都匹配不上，
    // 那"把所有 AI 标 removed + 把所有 comment 建 external_new"几乎 100% 是错的决定
    // （863 事故正是如此被静默执行）。此时中止流程，让用户判断：
    //   - 上传错了文件？（比如另一份合同的 docx）
    //   - 客户用了会破坏身份证的工具？（强烈建议重新从 LexSeek 下载）
    //   - 确实是全新版本，AI 批注全删了？（极少见，如需继续需走另一个 "force" 入口）
    //
    // DOCX-H5 收紧：仅统计带 wordCommentRef 的系统批注（AI/lawyer），忽略 external
    // （external 不参与身份证绑定）；命中比例 <20% 也触发保护——避免"10 条系统批注
    // 只对上 1 条"也被放行导致 9 条被误删。
    const systemDbAnnotations = dbAnnotations.filter(a => a.wordCommentRef != null)
    const matchRatio = systemDbAnnotations.length > 0
        ? commentByAnnId.size / systemDbAnnotations.length
        : 1
    const NO_MATCH_THRESHOLD = 0.2
    const tripsSafety =
        newComments.length > 0 && systemDbAnnotations.length > 0
        && (commentByAnnId.size === 0 || matchRatio < NO_MATCH_THRESHOLD)
    if (tripsSafety) {
        logger.error(
            '批注命中率过低：拒绝自动应用"全删+全新增"，保护数据不被误改',
            {
                reviewId: review.id,
                dbAnnotationsCount: dbAnnotations.length,
                systemDbAnnotationsCount: systemDbAnnotations.length,
                matched: commentByAnnId.size,
                matchRatio: Number(matchRatio.toFixed(3)),
                threshold: NO_MATCH_THRESHOLD,
                newCommentsCount: newComments.length,
                crossReviewRejected,
                snapshotSource,
            },
        )
        yield {
            type: 'error',
            data: {
                step: 'diff',
                code: 'NO_ANNOTATION_MATCH',
                message: crossReviewRejected > 0
                    ? `上传的 docx 属于其他合同审查（身份证声明 reviewId 不匹配本审查），已拒绝处理。请确认上传的是 review #${review.id} 的最新导出版本。`
                    : '上传 docx 中的批注与系统中任何一条都对不上，已中止处理以免误删。可能原因：1) 上传了非本次审查的 docx；2) 客户使用了会破坏批注标识的工具编辑；3) 当前 docx 是改造前的老导出，请重新从系统下载最新版发给客户。',
            },
        }
        return
    }

    /** 判断一个 comment 是否为系统生成（LexSeek 注入）的批注 */
    function isSystemComment(c: ParsedWordComment): boolean {
        return annotationRefsByWId.has(c.wId) || parseCommentRef(c.wAuthor, c.wInitials) !== null
    }

    /**
     * 获取一个 comment 对应的 annotationId。口径与 isSystemComment 一致：
     * 先看 annotationRefsByWId（customXml 或 author），fallback 单独 parse author。
     * 非系统批注返回 null；跨 review 身份证也返回 null（外层已单独记日志）。
     */
    function getAnnotationId(c: ParsedWordComment): number | null {
        const refFromMap = annotationRefsByWId.get(c.wId)
        if (refFromMap) {
            return refFromMap.reviewId === review.id ? refFromMap.annotationId : null
        }
        const parsed = parseCommentRef(c.wAuthor, c.wInitials)
        if (!parsed) return null
        return parsed.reviewId === review.id ? parsed.annotationId : null
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
    const newCommentByWId = new Map(newComments.map((c) => [c.wId, c]))
    for (const c of newComments) {
        if (c.parentWId == null) continue
        if (isSystemComment(c)) continue // 子 comment 自己是系统批注，不算回复
        const parent = newCommentByWId.get(c.parentWId)
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
    for (const { c } of crossReviewComments) newIndependent.push(c)
    for (const c of fallbackFailComments) newIndependent.push(c) // DOCX-H4

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
    // DOCX-H1 补偿式回滚：Step 4 在 tx 之外写 risks/annotations（AI 调用耗时较长，
    // 不能长时间持有 pg 连接）。若 Step 5+6 事务失败，需回滚 Step 4 新建行，避免
    // "风险条目凭空多出但无版本快照" 的数据不一致。
    const step4CreatedRiskIds: number[] = []
    const step4CreatedAnnIds: number[] = []

    // DOCX-C1/C2：anchorParagraphIndex 必须用"非空段落序号"（commentInjector 期望的空间），
    // 不能用 newClauses 数组下标（条款序号空间）。这里建 newClauses → newParagraphs 映射，
    // 写入新 risk 时把 newClauses[m.newIndex].index 转换成非空段落序号。
    const newClauseIdxToParaIdx = buildClauseToParagraphMap(newClauses, newParagraphs)
    /** 把 newClauses 数组下标安全映射到非空段落序号；找不到时回落到 0（首段，避免 null 让批注挂不到） */
    function newClauseArrayIdxToParaIdx(newArrayIdx: number): number {
        const seg = newClauses[newArrayIdx]
        if (!seg) return 0
        const para = newClauseIdxToParaIdx.get(seg.index)
        return para ?? 0
    }

    // 4a. 对 diff.modified 的每个条款跑增量 AI 审查
    //   阶段 1：并发跑 LLM（pLimit STEP4A_CONCURRENCY）— 主耗时
    //   阶段 2：按原顺序（newIndex 升序）写 DB + yield 进度，保证 step4CreatedRiskIds/AnnIds
    //          顺序稳定 + 进度事件按 newIndex 单调
    type LlmResult =
        | { ok: true; i: number; m: typeof clauseDiffResult.modified[number]; clause: ClauseSegment; risk: Risk | null }
        | { ok: false; i: number; m: typeof clauseDiffResult.modified[number]; clause: ClauseSegment; err: unknown }

    const stage1Limit = pLimit(STEP4A_CONCURRENCY)
    const llmResults: LlmResult[] = await Promise.all(
        clauseDiffResult.modified.map((m, i) => stage1Limit(async () => {
            const item = newClauses[m.newIndex]!
            const clause: ClauseSegment = {
                index: item.index,
                number: null,
                text: item.text,
                offsetStart: item.offsetStart,
                offsetEnd: item.offsetEnd,
            }
            try {
                // analyzeSingleClause 现返回 Risk[]；Phase B 增量审查的旧 vs 新 多对多
                // 配对 v1 暂不重写，取首条与历史行为一致（多 risk 拆分为单条款多卡片是
                // Phase A 主路径的改进；Phase B 配对逻辑留 backlog）
                const segRisks = await analyzeSingleClause({
                    clause,
                    stance: (review.stance ?? 'balanced') as Stance,
                    partyA: review.partyA,
                    partyB: review.partyB,
                    contractType: review.contractType,
                    playbookSnapshot: review.playbookSnapshot as PlaybookSnapshot | null,
                })
                const risk = segRisks[0] ?? null
                return { ok: true, i, m, clause, risk } as LlmResult
            } catch (err) {
                return { ok: false, i, m, clause, err } as LlmResult
            }
        })),
    )

    for (const result of llmResults) {
        const { i, m, clause } = result
        if (!result.ok) {
            logger.warn(`条款 #${clause.index} 增量 AI 审查失败，跳过`, { err: result.err })
            yield {
                type: 'progress',
                data: { step: 'ai', status: 'progress', total: clauseDiffResult.modified.length, current: i + 1 },
            }
            continue
        }
        const risk = result.risk
        if (risk) {
            // DOCX-H2 + C2：同条款可能有多条未处置 AI 风险。
            // 原比较 `r.anchorParagraphIndex === m.oldIndex` 把 DB 里"段落序号空间"
            // 的 anchorParagraphIndex 与 oldClauses 数组下标错配，永不命中；改用
            // anchorQuote 文本 prefix 匹配 oldClauses[m.oldIndex].text 来识别"老条款下的旧 risk"，
            // 跨"历史 clauseIndex / 现段落 paragraphIndex"两种空间都能识别。
            const oldClauseHead = (oldClauses[m.oldIndex]?.text ?? '').slice(0, 40)
            const existingRisks = oldClauseHead.length >= 4
                ? dbRisks.filter(
                    (r) =>
                        r.source === 'ai'
                        && r.archivedStatus === null
                        && (r.anchorQuote ?? '').includes(oldClauseHead),
                )
                : []
            // DOCX-C1：写入端 anchorParagraphIndex 用非空段落序号（commentInjector 期望空间）
            const newParaIdx = newClauseArrayIdxToParaIdx(m.newIndex)
            if (existingRisks.length > 0) {
                for (const existing of existingRisks) {
                    await prisma.contractRisks.update({
                        where: { id: existing.id },
                        data: {
                            level: risk.level,
                            category: risk.category,
                            problem: risk.problem,
                            legalBasis: risk.legalBasis ?? null,
                            analysis: risk.analysis ?? null,
                            suggestion: risk.suggestion ?? null,
                            anchorQuote: clause.text,
                            // 锚点迁移到新条款对应的段落序号，避免 Step 5 再扫一次
                            anchorParagraphIndex: newParaIdx,
                            ...(existing.originalAnchorQuote ? {} : { originalAnchorQuote: existing.anchorQuote }),
                        },
                    })
                }
            } else {
                // CORE-R2：与 Phase A 主路径共用 persistAiRisksAsContractRows，
                // 字段映射收口到 contractRisk.service。anchorQuote 显式传 clause.text，
                // 与 Phase A 原始 AI risk 一致存条款全文，不再截断（bug #11）。
                const [newRisk] = await persistAiRisksAsContractRows({
                    reviewId: review.id,
                    rows: [{
                        risk,
                        anchorQuote: clause.text,
                        anchorParagraphIndex: newParaIdx,
                    }],
                    stance: ((review.stance ?? DEFAULT_AI_RISK_STANCE) as unknown) as StancePreference,
                })
                if (!newRisk) throw new Error('persistAiRisksAsContractRows 未返回新风险')
                step4CreatedRiskIds.push(newRisk.id)
                const newAnn = await prisma.contractAnnotations.create({
                    data: {
                        reviewId: review.id,
                        riskId: newRisk.id,
                        authorType: 'ai',
                        authorName: 'AI',
                        content: risk.problem,
                    },
                })
                step4CreatedAnnIds.push(newAnn.id)
                await prisma.contractAnnotations.update({
                    where: { id: newAnn.id },
                    data: { wordCommentRef: generateWordCommentRef(newAnn.id) },
                })
            }
            aiReviewCount++
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
                    // DOCX-C3：global_review 是整篇合同的"条款平衡性/连锁风险"（spec §9.2），
                    // 不对应任何具体段落。anchorParagraphIndex=null 后 rebuildDocxService 会
                    // 过滤、不导出 Word 批注；anchorQuote 存完整 problem 便于前端展示。
                    // CORE-R2：与 Phase A/B 主路径共用 persistAiRisksAsContractRows，
                    // global_review 在 Risk 类型上无 id/clauseIndex/clauseText/risk 概念，
                    // service 也不会写入这些字段，仅做类型占位。
                    const stance = ((review.stance ?? DEFAULT_AI_RISK_STANCE) as unknown) as StancePreference
                    const createdRisks = await persistAiRisksAsContractRows({
                        reviewId: review.id,
                        stance,
                        rows: rawRisks.map((r) => {
                            const level: RiskLevel =
                                r.level === 'high' || r.level === 'medium' || r.level === 'low' ? r.level : 'medium'
                            const placeholder: Risk = {
                                id: '',
                                clauseIndex: -1,
                                clauseText: '',
                                level,
                                category: r.category ?? '全局复核',
                                problem: r.problem ?? '',
                                legalBasis: r.legalBasis,
                                analysis: r.analysis ?? '',
                                risk: r.problem ?? '',
                                suggestion: r.suggestion ?? '',
                            }
                            return {
                                risk: placeholder,
                                source: 'global_review',
                                anchorQuote: r.problem ?? '（全局复核）',
                                anchorParagraphIndex: null,
                            }
                        }),
                    })
                    for (let i = 0; i < createdRisks.length; i++) {
                        const created = createdRisks[i]!
                        const raw = rawRisks[i]!
                        step4CreatedRiskIds.push(created.id)
                        const newAnn = await prisma.contractAnnotations.create({
                            data: {
                                reviewId: review.id,
                                riskId: created.id,
                                authorType: 'ai',
                                authorName: 'AI',
                                content: raw.problem ?? '',
                            },
                        })
                        step4CreatedAnnIds.push(newAnn.id)
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
                        authorName: safeAuthorName(c.wAuthor),
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
                        authorName: safeAuthorName(c.wAuthor),
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
                // DOCX-C4：锚点是"非空段落序号"（parseWordComments 返回的 anchorParagraphIndex
                // 和 commentInjector scanNonEmptyParagraphs 同口径）。越界校验必须用
                // newParagraphs.length（非空段落总数）而不是 newClauses.length（条款总数，
                // 通常远小于段落数）；anchorQuote 用段落原文（不是条款文本），与 parseWordComments
                // 语义对齐，后续 rebuildDocxService 注入时 findParagraphIndexByQuote 能
                // 字符串匹配兜底定位。
                const paraIdx = c.anchorParagraphIndex
                const validPara = paraIdx !== null && paraIdx >= 0 && paraIdx < newParagraphs.length
                const anchorParagraphIndex = validPara ? paraIdx : null
                const anchorQuote = validPara
                    ? (newParagraphs[paraIdx!] ?? c.content.slice(0, 50))
                    : c.content.slice(0, 50)
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
                        authorName: safeAuthorName(c.wAuthor),
                        content: c.content,
                    },
                })
                await tx.contractAnnotations.update({
                    where: { id: newAnn.id },
                    data: { wordCommentRef: generateWordCommentRef(newAnn.id) },
                })
            }

            // DOCX-C3：锚点迁移路径里 r.anchorParagraphIndex 是"非空段落序号"空间，
            // clauseDiffResult.modified/removed/unchanged 里的 oldIndex/newIndex 是
            // oldClauses/newClauses 的"数组下标"空间——两个空间不能直接 ===。
            // 改成基于 anchorQuote 推断"老条款数组下标"：拿 r.anchorQuote 的 head
            // 在 oldClauses 里 find 第一个 startsWith / includes 命中的条款下标。
            // - 找到 → 用 modified/removed/unchanged 决定路径
            // - 找不到（anchorQuote 与 oldClauses 都对不上）→ migrate 走全局漂移搜索
            const oldHeadToArrayIdx = new Map<string, number>()
            for (let oi = 0; oi < oldClauses.length; oi++) {
                const head = (oldClauses[oi]?.text ?? '').slice(0, 40)
                if (head.length >= 4 && !oldHeadToArrayIdx.has(head)) {
                    oldHeadToArrayIdx.set(head, oi)
                }
            }
            function findOldClauseArrayIdxByAnchor(anchor: string): number | null {
                if (!anchor) return null
                for (const [head, oi] of oldHeadToArrayIdx) {
                    if (anchor.includes(head)) return oi
                }
                return null
            }

            for (const r of dbRisks) {
                if (r.anchorParagraphIndex == null) continue
                const oldArrayIdx = findOldClauseArrayIdxByAnchor(r.anchorQuote ?? '')
                const isModified = oldArrayIdx !== null
                    && clauseDiffResult.modified.some((m) => m.oldIndex === oldArrayIdx)
                const isRemoved = oldArrayIdx !== null && clauseDiffResult.removed.includes(oldArrayIdx)
                const unchangedMapping = oldArrayIdx !== null
                    ? clauseDiffResult.unchanged.find((u) => u.oldIndex === oldArrayIdx)
                    : null

                if (isModified || isRemoved || oldArrayIdx === null) {
                    // modified / removed / 完全找不到对应旧条款 → 都走全局漂移迁移
                    const preferredNew = isModified
                        ? (clauseDiffResult.modified.find((m) => m.oldIndex === oldArrayIdx)?.newIndex ?? null)
                        : null
                    const result = migrateAnchor({
                        oldAnchorQuote: r.anchorQuote ?? '',
                        preferredNewClauseArrayIdx: preferredNew,
                        newClauses,
                    })
                    if (result) {
                        // newClauses[result.newClauseIndex] 是数组下标 → 转段落序号
                        const newParaIdx = newClauseArrayIdxToParaIdx(result.newClauseIndex)
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: {
                                anchorParagraphIndex: newParaIdx,
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
                } else if (unchangedMapping) {
                    // unchanged clause：位置可能变化，更新 anchorParagraphIndex 到新段落序号
                    const newParaIdx = newClauseArrayIdxToParaIdx(unchangedMapping.newIndex)
                    if (newParaIdx !== r.anchorParagraphIndex) {
                        await tx.contractRisks.update({
                            where: { id: r.id },
                            data: { anchorParagraphIndex: newParaIdx },
                        })
                    }
                }
            }

            // DOCX-H3：syncReviewRisksJsonb 必须与 Step 5 锚点迁移在同一事务里，
            // 防止进程在锚点写完之后、JSONB 同步之前被 kill 让 PDF 导出 / 管理端列表
            // 读到过期快照。tx 透传保证同一 pg 连接、同一事务范围。
            await syncReviewRisksJsonb(review.id, tx)
        })

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
        // DOCX-H1：Step 5+6 事务失败时回滚 Step 4 新建的 risks/annotations，
        // 避免"风险条目凭空多出但无版本快照"的数据不一致（律师下次刷新工作区会看到
        // 来历不明的新增条目）。删除顺序：先 annotation 再 risk（FK onDelete: Cascade 也能兜住，
        // 但显式删更清楚）。
        if (step4CreatedAnnIds.length > 0 || step4CreatedRiskIds.length > 0) {
            try {
                await prisma.$transaction(async (tx) => {
                    if (step4CreatedAnnIds.length > 0) {
                        await tx.contractAnnotations.deleteMany({
                            where: { id: { in: step4CreatedAnnIds } },
                        })
                    }
                    if (step4CreatedRiskIds.length > 0) {
                        await tx.contractRisks.deleteMany({
                            where: { id: { in: step4CreatedRiskIds } },
                        })
                    }
                })
                logger.warn('[uploadClientVersion] 合并失败，已回滚 Step 4 新建行', {
                    reviewId: review.id,
                    rolledBackRisks: step4CreatedRiskIds.length,
                    rolledBackAnnotations: step4CreatedAnnIds.length,
                })
            } catch (rollbackErr) {
                logger.error('[uploadClientVersion] 补偿回滚失败，可能留下孤立新风险', {
                    reviewId: review.id,
                    rolledBackRiskIds: step4CreatedRiskIds,
                    rolledBackAnnIds: step4CreatedAnnIds,
                    err: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
                })
            }
        }
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
async function syncReviewRisksJsonb(
    reviewId: number,
    tx: Prisma.TransactionClient = prisma,
): Promise<void> {
    // DOCX-H3：可选传入 tx 让事务里复用同一连接；事务外调用回退到全局 prisma。
    const rows = await tx.contractRisks.findMany({
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
    await tx.contractReviews.update({
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

    // DOCX-M2：排除系统自身写的 removedByClient / suppressInExport 状态变更，
    // 否则每次 upload 完成后都会把 status 标记成"未保存编辑"，下次 upload 触发
    // 多余的 auto_backup。仅律师真实编辑（content/archivedStatus/手动标记）才计。
    const [latestRisk, latestAnn, currentVer] = await Promise.all([
        prisma.contractRisks.findFirst({
            where: { reviewId },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
        }),
        prisma.contractAnnotations.findFirst({
            where: {
                reviewId,
                removedByClient: false,
                suppressInExport: false,
            },
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
