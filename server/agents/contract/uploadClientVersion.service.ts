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
import type { contractReviews, contractRisks, Prisma } from '~~/generated/prisma/client'
import type {
    UploadVersionProgressData,
    UploadVersionCompleteData,
    UploadVersionErrorData,
    ClauseSnapshotItem,
    Risk,
    RiskLevel,
    StancePreference,
} from '#shared/types/contract'
import { DEFAULT_AI_RISK_STANCE, CONTRACT_BUSY_STATUSES } from '#shared/types/contract'
import { logger } from '#shared/utils/logger'
import type { ClauseSegment, PlaybookSnapshot, Stance } from '#shared/types/contract'
import { persistAiRisksAsContractRows } from './contractRisk.service'
import { segmentClauses } from './docx/clauseSegmenter'
import { parseContractDocx } from './docx'
import { saveContractReviewVersionService } from './contractReviewVersion.service'
import { analyzeSingleClause } from './analyzeSingleClause'
import { diffClauses } from './utils/clauseDiff'
import { migrateRiskWithDualAnchor, migrateRiskByRedlineRef } from './utils/anchorMigrate'
import { normalizeForMatch } from './utils/textSimilarity'
import { parseWordComments, type ParsedWordComment, type AnnotationRefEntry } from './docx/wordCommentParser'
import { parseRedlineMarks, classifyRedlineDecision, resolveCorpusForRef, resolveFullCorpus, type ParsedRedlineMarks } from './docx/redlineParser'
import { matchCommentsToAnnotations } from './docx/commentContentMatch'
import { ClientRedlineDecision } from '#shared/types/contract'
import { parseCommentRef, generateWordCommentRef, stripAuthorRef } from './utils/wordCommentRef'
import { buildClauseToBodyParagraphMap } from './utils/clauseToParagraph'

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
import { assembleSystemPromptTemplate } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'
import { DOCX_MIME } from '#shared/utils/mime'
import pLimit from 'p-limit'

/** Step 4a 增量审查的 LLM 并发上限：与主路径 ANALYZE_CONCURRENCY 同级。 */
const STEP4A_CONCURRENCY = 8

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
 * M3：Step 4a 对存量风险 in-place 更新写入的字段集（单点定义）。
 *
 * Step 4a 正向更新与失败补偿还原共用此函数构造 update data——新增字段只改这里，
 * 正反两端自动同步，杜绝「补偿漏还原某字段」的字段集漂移。
 */
function buildStep4aExistingRiskUpdate(
    src: Pick<contractRisks, 'level' | 'category' | 'problem' | 'legalBasis'
        | 'analysis' | 'suggestion' | 'clauseText' | 'clauseParagraphIndex' | 'originalClauseText'>,
): Prisma.contractRisksUpdateInput {
    return {
        level: src.level,
        category: src.category,
        problem: src.problem,
        legalBasis: src.legalBasis,
        analysis: src.analysis,
        suggestion: src.suggestion,
        clauseText: src.clauseText,
        clauseParagraphIndex: src.clauseParagraphIndex,
        originalClauseText: src.originalClauseText,
    }
}

/**
 * S4 / M3 / DOCX-H1：补偿式回滚 Step 4a 的全部变更。
 *
 * Step 4a 写库循环抛错、或 Step 5+6 事务失败时调用，避免「风险条目凭空多出 / 存量风险被
 * in-place 覆盖却无版本快照」的数据不一致：
 *  - 新建行（risks/annotations）：删除（先 annotation 再 risk，FK Cascade 也能兜，显式删更清楚）。
 *  - in-place 更新过的存量风险：用更新前快照还原所有被 Step 4a 覆盖的字段。
 */
async function rollbackStep4Mutations(
    reviewId: number,
    step4CreatedRiskIds: number[],
    step4CreatedAnnIds: number[],
    step4UpdatedExistingRisks: contractRisks[],
): Promise<void> {
    if (
        step4CreatedAnnIds.length === 0
        && step4CreatedRiskIds.length === 0
        && step4UpdatedExistingRisks.length === 0
    ) return
    try {
        await prisma.$transaction(async (tx) => {
            if (step4CreatedAnnIds.length > 0) {
                await tx.contractAnnotations.deleteMany({ where: { id: { in: step4CreatedAnnIds } } })
            }
            if (step4CreatedRiskIds.length > 0) {
                await tx.contractRisks.deleteMany({ where: { id: { in: step4CreatedRiskIds } } })
            }
            // M3：还原 Step 4a in-place 更新过的存量风险——把被覆盖字段写回更新前的值。
            for (const snap of step4UpdatedExistingRisks) {
                await tx.contractRisks.update({
                    where: { id: snap.id },
                    data: buildStep4aExistingRiskUpdate(snap),
                })
            }
        })
        logger.warn('[uploadClientVersion] 失败补偿：已回滚 Step 4 变更', {
            reviewId,
            rolledBackRisks: step4CreatedRiskIds.length,
            rolledBackAnnotations: step4CreatedAnnIds.length,
            restoredExistingRisks: step4UpdatedExistingRisks.length,
        })
    } catch (rollbackErr) {
        logger.error('[uploadClientVersion] 补偿回滚失败，可能留下不一致数据', {
            reviewId,
            rolledBackRiskIds: step4CreatedRiskIds,
            rolledBackAnnIds: step4CreatedAnnIds,
            restoredExistingRiskIds: step4UpdatedExistingRisks.map(r => r.id),
            err: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        })
    }
}

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
    // M1：进入前的原始 status。早期失败（尚未改动工作区数据）时 finally 据此恢复，
    // 避免把原本 completed、可编辑的审查因瞬时错误（OSS 抖动 / 上传文件损坏）永久锁成 failed。
    const originalStatus = review.status

    // ============ Step 0: 原子状态锁（bug #10） ============
    // HTTP 层已做过快速预检，但检查→开始之间存在 TOCTOU 窗口，
    // 两个并发请求可能都通过 HTTP 检查。这里用条件 UPDATE 做一次原子转移：
    // 仅当当前状态不在 BUSY 集合时才置为 rebuilding；count === 0 说明被他人抢占。
    const claim = await prisma.contractReviews.updateMany({
        where: {
            id: review.id,
            status: { notIn: [...CONTRACT_BUSY_STATUSES] },
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
    // 成功 → completed；失败时按是否已进入写库阶段分流（见 finally）。
    let succeeded = false
    // M1：是否已进入 Step 4a 写库阶段。Step 1~3（备份/解析/diff）全程只读、不改风险与批注，
    // 这些早期步骤失败时应把 status 恢复为 originalStatus，而非误锁成 failed。
    let enteredMutationStage = false
    // M4：当前所处步骤，供外层 try 的 catch 按步骤 yield 精确错误码（diff / ai）。
    let progressStep: 'diff' | 'ai' = 'diff'
    try {
        // ============ Step 1: 自动备份当前工作区 ============
        yield { type: 'progress', data: { step: 'backup', status: 'progress' } }
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
        yield { type: 'progress', data: { step: 'parse', status: 'progress' } }
        let newDocxText: string
        let newClauses: ClauseSnapshotItem[]
        let newComments: ParsedWordComment[] = []
        let customXmlRefEntries: AnnotationRefEntry[] = []
        // 修订标记回传解析（spec §6）：纯修订版回传无 comment，靠 redlineRefs.xml + 存活 ins/del id
        let redline: ParsedRedlineMarks | null = null
        // DOCX-C4：external_new 锚点需要用"非空段落序号 + 段落原文"而不是 clauseIndex，
        // 否则 paragraphIndex 可能远大于 newClauses.length 被误兜底为 0（挤到首段）。
        let newParagraphs: string[] = []
        // M8：批注注入口径段落 + 分析口径→注入口径下标映射（见 parseContractDocx）。
        let newBodyParagraphs: string[] = []
        let newBodyParagraphIndex: (number | null)[] = []
        // S5：「拒绝所有修订」视图——Step 5 锚点迁移在定稿态失配时回退用它
        // （还原首轮审查原文，修订稿里原问题片段才能命中）。
        let rejectNewClauses: ClauseSnapshotItem[] = []
        let rejectNewDocxText = ''
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
            const { paragraphs, bodyParagraphs, bodyParagraphIndex } = await parseContractDocx(docxBuffer)
            newParagraphs = paragraphs
            newBodyParagraphs = bodyParagraphs
            newBodyParagraphIndex = bodyParagraphIndex
            const { segments, normalizedText } = await segmentClauses(paragraphs.join('\n'))
            newDocxText = normalizedText
            newClauses = segments.map((s) => ({
                index: s.index,
                text: s.text,
                textWithoutNumber: s.textWithoutNumber,
                offsetStart: s.offsetStart,
                offsetEnd: s.offsetEnd,
                offsetStartWithoutNumber: s.offsetStartWithoutNumber,
            }))

            // S5：额外解析「拒绝所有修订」视图（取 <w:del> 原文、丢 <w:ins>），
            // 供 Step 5 锚点迁移在定稿态失配时回退——还原首轮审查原文，原文锚点才能命中。
            const rejectParsed = await parseContractDocx(docxBuffer, { revisionView: 'reject' })
            const rejectSegmented = await segmentClauses(rejectParsed.paragraphs.join('\n'))
            rejectNewDocxText = rejectSegmented.normalizedText
            rejectNewClauses = rejectSegmented.segments.map((s) => ({
                index: s.index,
                text: s.text,
                textWithoutNumber: s.textWithoutNumber,
                offsetStart: s.offsetStart,
                offsetEnd: s.offsetEnd,
                offsetStartWithoutNumber: s.offsetStartWithoutNumber,
            }))

            // bug #9：parseWordComments 失败不再静默降级为空批注，
            // 让上层感知并置 status=failed，避免"批注被当全部删除"的数据误删。
            const parsed = await parseWordComments(docxBuffer)
            newComments = parsed.comments
            customXmlRefEntries = parsed.customXmlRefEntries

            // 修订标记解析（spec §6.1）：用同一份 Buffer 读 redlineRefs.xml + 存活 ins/del id。
            // redlineRefs.xml 缺失 / 损坏时返回 reviewId=null、refs=[]（纯批注版回传场景）。
            redline = await parseRedlineMarks(docxBuffer)

            yield { type: 'progress', data: { step: 'parse', status: 'done' } }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '解析失败'
            yield { type: 'error', data: { step: 'parse', code: 'PARSE_FAILED', message: msg } }
            return
        }

    // ============ Step 3: 识别正文差异 + 批注变更 ============
    yield { type: 'progress', data: { step: 'diff', status: 'progress' } }
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
                    index: s.index,
                    text: s.text,
                    textWithoutNumber: s.textWithoutNumber,
                    offsetStart: s.offsetStart,
                    offsetEnd: s.offsetEnd,
                    offsetStartWithoutNumber: s.offsetStartWithoutNumber,
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

    // 建 annotationId → ParsedWordComment 映射。
    // Word 兼容性（spec §5）：Word 重存 docx 会重排批注 w:id，导出时写入身份证的
    // wId 主键失效。改用正文内容把回传批注重新关联到系统批注。
    // customXml 身份证文件（含 reviewId）不被 Word 篡改，customXmlRefEntries 取自
    // 它的全部 ref（不经 wId 过滤），用于取「身份证声明的归属 review」做跨审查判定。
    const declaredAnnReviewId = customXmlRefEntries.length > 0 ? customXmlRefEntries[0]!.reviewId : null
    const contentMatchByWId = matchCommentsToAnnotations(
        newComments.map(c => ({ wId: c.wId, content: c.content })),
        dbAnnotations.map(a => ({ id: a.id, content: a.content })),
    )
    // 重建 wId → {reviewId, annotationId}：annotationId 来自内容匹配，reviewId 取
    // 身份证文件声明值（跨审查时 ≠ review.id）。
    const commentRefByWId = new Map<number, { reviewId: number; annotationId: number; source: 'content' | 'authorRef' }>()
    for (const [wId, annotationId] of contentMatchByWId) {
        commentRefByWId.set(wId, {
            reviewId: declaredAnnReviewId ?? review.id,
            annotationId,
            source: 'content',
        })
    }
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
        let refFromMap = commentRefByWId.get(c.wId)
        if (!refFromMap) {
            // M5：内容匹配失败（客户大幅改写系统批注致相似度低于阈值）→ 用作者内嵌的
            // 身份证兜底回收 annotationId（Word 不改写 w:author，[#reviewId-annId-rand]
            // 是可靠标识），避免系统批注被误判「客户删除」、改写内容随之丢失。
            const parsed = parseCommentRef(c.wAuthor, c.wInitials)
            if (parsed) {
                refFromMap = { reviewId: parsed.reviewId, annotationId: parsed.annotationId, source: 'authorRef' }
            }
        }
        if (!refFromMap) continue // 既无内容匹配又无作者身份证 → 真新批注

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
        const fromMap = commentRefByWId.get(c.wId)
        return {
            wId: c.wId,
            author: c.wAuthor,
            source: fromMap ? 'content' : null,
            declaredReviewId: fromMap?.reviewId ?? null,
            declaredAnnotationId: fromMap?.annotationId ?? null,
            contentPreview: (c.content ?? '').slice(0, 40),
        }
    })
    const parsedCount = newComments.filter(c => commentRefByWId.has(c.wId)).length
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
    // redline 非空且确有修订条目 —— redlineCrossReview / redlineUsable / docxHasContent 共用
    const redlineHasRefs = redline != null && redline.refs.length > 0
    // 修订身份证归属判定（spec §9.2）
    const redlineCrossReview =
        redlineHasRefs
        && redline!.reviewId !== null && redline!.reviewId !== review.id
    if (redlineCrossReview) {
        const rl = redline!
        logger.warn('修订身份证跨审查，已忽略该 docx 的修订标记', {
            uploadReviewId: review.id,
            declaredReviewId: rl.reviewId,
            refCount: rl.refs.length,
        })
    }
    const redlineUsable = redlineHasRefs && !redlineCrossReview

    // 统一覆盖率（spec §9.1）：批注命中 ∪ 修订身份证登记 的风险，
    // 占「带 customXml 身份证（wordCommentRef 非空）的风险」的比例。
    // 注：现有 DOCX-H5 注释称「忽略 external」与实际 filter 不符，统一以「带身份证」为口径。
    const systemDbAnnotations = dbAnnotations.filter(a => a.wordCommentRef != null)
    const identifiableRiskIds = new Set(systemDbAnnotations.map(a => a.riskId))
    const coveredRiskIds = new Set<number>()
    for (const annId of commentByAnnId.keys()) {
        const ann = annById.get(annId)
        if (ann) coveredRiskIds.add(ann.riskId)
    }
    if (redlineUsable) {
        for (const ref of redline!.refs) coveredRiskIds.add(ref.riskId)
    }
    let coveredCount = 0
    for (const id of coveredRiskIds) if (identifiableRiskIds.has(id)) coveredCount++
    const coverageRatio = identifiableRiskIds.size > 0 ? coveredCount / identifiableRiskIds.size : 1
    const NO_MATCH_THRESHOLD = 0.2
    // M7：customXmlRefEntries 非空 = 回传 docx 仍带我方身份证（确是本审查导出件），
    // 即便客户工具把 comments.xml 整个剥掉也算「有内容」，否则安全网漏判、
    // 全部已导出批注会被当客户删除。
    const docxHasContent = newComments.length > 0 || redlineHasRefs || customXmlRefEntries.length > 0
    const tripsSafety =
        identifiableRiskIds.size > 0 && docxHasContent && coverageRatio < NO_MATCH_THRESHOLD
    if (tripsSafety) {
        logger.error(
            '统一覆盖率过低：拒绝自动应用"全删+全新增"，保护数据不被误改',
            {
                reviewId: review.id,
                dbAnnotationsCount: dbAnnotations.length,
                identifiableRiskCount: identifiableRiskIds.size,
                coveredCount,
                coverageRatio: Number(coverageRatio.toFixed(3)),
                threshold: NO_MATCH_THRESHOLD,
                newCommentsCount: newComments.length,
                redlineRefCount: redline?.refs.length ?? 0,
                crossReviewRejected,
                redlineCrossReview,
                snapshotSource,
            },
        )
        yield {
            type: 'error',
            data: {
                step: 'diff',
                code: 'NO_CONTENT_MATCH',
                message: (crossReviewRejected > 0 || redlineCrossReview)
                    ? `上传的 docx 属于其他合同审查（文档标识里的审查编号与本次不符），已拒绝处理。请确认上传的是本审查导出的版本。`
                    : '上传的 docx 没能和本次审查的任何批注或修订对应上，已中止处理以免误改。请确认：1) 上传的是本次审查导出的 docx；2) 客户编辑时未使用会破坏文档标识的工具——如不确定，建议重新从系统下载最新版发给客户。',
            },
        }
        return
    }

    /** 判断一个 comment 是否为系统生成（LexSeek 注入）的批注 */
    function isSystemComment(c: ParsedWordComment): boolean {
        return commentRefByWId.has(c.wId) || parseCommentRef(c.wAuthor, c.wInitials) !== null
    }

    /**
     * 获取一个 comment 对应的 annotationId。口径与 isSystemComment 一致：
     * 先看内容匹配结果 commentRefByWId，fallback 单独 parse author。
     * 非系统批注返回 null；跨 review 身份证也返回 null（外层已单独记日志）。
     */
    function getAnnotationId(c: ParsedWordComment): number | null {
        const refFromMap = commentRefByWId.get(c.wId)
        if (refFromMap) {
            return refFromMap.reviewId === review.id ? refFromMap.annotationId : null
        }
        const parsed = parseCommentRef(c.wAuthor, c.wInitials)
        if (!parsed) return null
        return parsed.reviewId === review.id ? parsed.annotationId : null
    }

    // 客户删除：导出时写过批注、回传 docx 里却找不到的 annotation 才算客户删除。
    // customXmlRefEntries 是身份证登记的「本次导出实际写成 docx 批注」的 annotation 全集。
    // 导出修订版（redline 模式）时，带 suggestedClauseText 的风险走 <w:ins>/<w:del>
    // 修订标记、不写批注，其 annotation 不在此集合内——「docx 里没有它」是设计内正常
    // 情况，不能误判成客户删除（否则 redline 回传会把整批走修订标记的风险批注全标删）。
    // customXml 身份证缺失时集合为空 → 一律不判删除（误判会让律师批注丢失，比漏判更严重）。
    const exportedAnnIds = new Set(customXmlRefEntries.map(e => e.annotationId))
    const removedAnnIds: number[] = []
    for (const a of dbAnnotations) {
        if (commentByAnnId.has(a.id)) continue
        if (!exportedAnnIds.has(a.id)) continue
        removedAnnIds.push(a.id)
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
        // 比对用 normalizeForMatch 归一化：Word 重存会改批注的空白/标点/全半角格式，
        // 严格 === 会把"纯格式变化"误判成"客户编辑了批注"（review 8 实测 4 条误判）。
        // 归一化后仍不等才算客户的实质改动。
        if (normalizeForMatch(c.content) === normalizeForMatch(dbAnn.content)) continue
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

    // ===== Step 3b：修订处置识别（spec §6） =====
    // 对 redlineRefs.xml 登记的每条修订，结合存活 ins/del id + 风险所属段落正文，
    // 判定客户接受/拒绝/未处理/需确认。语料按 §6.2 限定在风险所属段落。
    const redlineDecisions = new Map<number, ClientRedlineDecision>()
    const redlineCounts: Record<ClientRedlineDecision, number> = {
        [ClientRedlineDecision.ACCEPTED]: 0,
        [ClientRedlineDecision.REJECTED]: 0,
        [ClientRedlineDecision.UNTOUCHED]: 0,
        [ClientRedlineDecision.AMBIGUOUS]: 0,
    }
    // riskId → risk 行映射：Step 3b 修订识别按 ref.riskId 查 risk 行。
    const riskByIdForRedline = new Map(dbRisks.map(r => [r.id, r]))
    if (redlineUsable) {
        const rl = redline!
        // 全文语料懒计算一次：多个 ref 判出 AMBIGUOUS 时复用，不重复 map+join
        let fullCorpus: { corpusT: string; corpusDel: string; corpusIns: string } | null = null
        for (const ref of rl.refs) {
            const risk = riskByIdForRedline.get(ref.riskId)
            if (!risk || !risk.problematicQuote || !risk.suggestedClauseText) continue
            const { corpusT, corpusDel, corpusIns } = resolveCorpusForRef(rl, ref)
            let decision = classifyRedlineDecision({
                ref,
                survivingInsIds: rl.survivingInsIds,
                survivingDelIds: rl.survivingDelIds,
                corpusT,
                corpusDel,
                corpusIns,
                problematicQuote: risk.problematicQuote,
                suggestedClauseText: risk.suggestedClauseText,
                trustWordIds: rl.trustWordIds,
            })
            // spec §6：按 paraIdxs 取的段落语料判不出（段落序号被 Word 增删段落漂移）
            // 时，用全文语料兜底重判一次。
            if (decision === ClientRedlineDecision.AMBIGUOUS) {
                fullCorpus ??= resolveFullCorpus(rl)
                decision = classifyRedlineDecision({
                    ref,
                    survivingInsIds: rl.survivingInsIds,
                    survivingDelIds: rl.survivingDelIds,
                    corpusT: fullCorpus.corpusT,
                    corpusDel: fullCorpus.corpusDel,
                    corpusIns: fullCorpus.corpusIns,
                    problematicQuote: risk.problematicQuote,
                    suggestedClauseText: risk.suggestedClauseText,
                    trustWordIds: rl.trustWordIds,
                })
            }
            redlineDecisions.set(ref.riskId, decision)
            redlineCounts[decision]++
        }
        logger.info('修订处置识别完成', { reviewId: review.id, ...redlineCounts })
    }

    // ============ Step 4: AI 增量审查 + 全局复核 ============
    progressStep = 'ai'
    yield { type: 'progress', data: { step: 'ai', status: 'progress' } }
    let aiReviewCount = 0
    let globalReviewNewRiskCount = 0
    // DOCX-H1 补偿式回滚：Step 4 在 tx 之外写 risks/annotations（AI 调用耗时较长，
    // 不能长时间持有 pg 连接）。若 Step 5+6 事务失败，需回滚 Step 4 新建行，避免
    // "风险条目凭空多出但无版本快照" 的数据不一致。
    const step4CreatedRiskIds: number[] = []
    const step4CreatedAnnIds: number[] = []
    // M3/M6：Step 4a in-place 更新过的存量风险的「更新前快照」（按 id 去重，首次为准）。
    //   - M3：补偿回滚时据此还原被覆盖字段。
    //   - M6：其 id 集合即「Step 4a 已处理」标记，Step 5 锚点迁移跳过这些风险，避免基于
    //     陈旧 dbRisks 重算覆盖 Step 4a 结果、甚至把刚刷新的风险误判 orphaned。
    const step4UpdatedExistingRisks = new Map<number, contractRisks>()

    // DOCX-C1/C2 + M8：clauseParagraphIndex 必须用「批注注入口径段落序号」
    // （commentInjector 期望的空间），不能用 newClauses 数组下标（条款序号空间）。
    // buildClauseToBodyParagraphMap 经 bodyParagraphIndex 把条款序号换算成该口径。
    const newClauseIdxToParaIdx = buildClauseToBodyParagraphMap(newClauses, newParagraphs, newBodyParagraphIndex)
    /**
     * 把 newClauses 数组下标映射到批注注入口径段落序号。
     * 条款落在表格内 / 数组下标越界时返回 null——该风险批注无法注入 docx（与 global_review 同口径）。
     */
    function newClauseArrayIdxToParaIdx(newArrayIdx: number): number | null {
        const seg = newClauses[newArrayIdx]
        if (!seg) return null
        return newClauseIdxToParaIdx.get(seg.index) ?? null
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
                // PR10：从 ClauseSnapshotItem（optional 字段，旧 snapshot 可能无）兜底到 text
                textWithoutNumber: item.textWithoutNumber ?? item.text,
                offsetStart: item.offsetStart,
                offsetEnd: item.offsetEnd,
                offsetStartWithoutNumber: item.offsetStartWithoutNumber ?? item.offsetStart,
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

    // M1：自此进入 Step 4a 写库阶段，后续失败不再恢复 originalStatus，一律置 failed。
    enteredMutationStage = true
    try {
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
                // 原比较 `r.clauseParagraphIndex === m.oldIndex` 把 DB 里"段落序号空间"
                // 的 clauseParagraphIndex 与 oldClauses 数组下标错配，永不命中；改用
                // clauseText 文本 prefix 匹配 oldClauses[m.oldIndex].text 来识别"老条款下的旧 risk"，
                // 跨"历史 clauseIndex / 现段落 paragraphIndex"两种空间都能识别。
                const oldClauseHead = (oldClauses[m.oldIndex]?.text ?? '').slice(0, 40)
                const existingRisks = oldClauseHead.length >= 4
                    ? dbRisks.filter(
                        (r) =>
                            r.source === 'ai'
                            && r.archivedStatus === null
                            && (r.clauseText ?? '').includes(oldClauseHead),
                    )
                    : []
                // DOCX-C1：写入端 clauseParagraphIndex 用非空段落序号（commentInjector 期望空间）
                const newParaIdx = newClauseArrayIdxToParaIdx(m.newIndex)
                if (existingRisks.length > 0) {
                    for (const existing of existingRisks) {
                        // M3/M6：登记更新前快照（同一风险多次命中以首次为准 = 真原值）。
                        if (!step4UpdatedExistingRisks.has(existing.id)) {
                            step4UpdatedExistingRisks.set(existing.id, existing)
                        }
                        await prisma.contractRisks.update({
                            where: { id: existing.id },
                            data: buildStep4aExistingRiskUpdate({
                                level: risk.level,
                                category: risk.category,
                                problem: risk.problem,
                                legalBasis: risk.legalBasis ?? null,
                                analysis: risk.analysis ?? null,
                                suggestion: risk.suggestion ?? null,
                                // PR10 方案 D：用不含编号字符的文本作 anchor，规避 redlineInjector 严格匹配失败
                                clauseText: clause.textWithoutNumber ?? clause.text,
                                // 锚点迁移到新条款对应的段落序号，避免 Step 5 再扫一次
                                clauseParagraphIndex: newParaIdx,
                                // 首次迁移前回填 originalClauseText（已备份过 → 原值不变 = 无害空写）
                                originalClauseText: existing.originalClauseText || existing.clauseText,
                            }),
                        })
                    }
                } else {
                    // CORE-R2：与 Phase A 主路径共用 persistAiRisksAsContractRows，
                    // 字段映射收口到 contractRisk.service。clauseText 显式传 clause.text，
                    // 与 Phase A 原始 AI risk 一致存条款全文，不再截断（bug #11）。
                    const [newRisk] = await persistAiRisksAsContractRows({
                        reviewId: review.id,
                        rows: [{
                            risk,
                            // PR10 方案 D：理由同上
                            clauseText: clause.textWithoutNumber ?? clause.text,
                            clauseParagraphIndex: newParaIdx,
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
    } catch (e: unknown) {
        // S4：Step 4a 写库循环抛错——回滚已新建行 + yield error，避免前端 ai 步永久转圈，
        // 且不让"凭空多出的风险/批注"残留。
        const msg = e instanceof Error ? e.message : 'AI 增量审查失败'
        logger.error('[uploadClientVersion] Step 4a 写库失败', { reviewId: review.id, err: msg })
        await rollbackStep4Mutations(review.id, step4CreatedRiskIds, step4CreatedAnnIds, [...step4UpdatedExistingRisks.values()])
        yield { type: 'error', data: { step: 'ai', code: 'AI_REVIEW_FAILED', message: msg } }
        return
    }

    // 4b. 全局复核：对整篇新文本做平衡性检查
    try {
        const globalConfig = await getValidNodeConfig('contractReviewGlobalReview')
        const globalActiveKey = globalConfig.modelApiKeys.find((k) => k.status === 1)
        if (globalActiveKey) {
            const globalTemplate = assembleSystemPromptTemplate(globalConfig.prompts)
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
                    // 不对应任何具体段落。clauseParagraphIndex=null 后 rebuildDocxService 会
                    // 过滤、不导出 Word 批注；clauseText 存完整 problem 便于前端展示。
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
                                clauseText: r.problem ?? '（全局复核）',
                                clauseParagraphIndex: null,
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

    // 进入「合并与更新」步：先发 progress 让前端把该步图标切到 loading 转圈。
    // 整个 Step 5（锚点迁移计算 + 事务写入 + 保存快照）耗时较长，需要明确进行中反馈。
    yield { type: 'progress', data: { step: 'merge', status: 'progress' } }

    // ============ Step 5 锚点迁移计算（重 CPU，必须在事务外）============
    // migrateRiskWithDualAnchor 内部是 scanWindowRange 双层窗口扫描 × diff-match-patch
    // Levenshtein，长条款上是几十秒级的重 CPU 计算。放进事务会让事务时钟被纯 JS 计算
    // 占满、触发 "expired transaction" 超时（Prisma 官方亦建议 doing less work in the
    // transaction）。这里事务外先算好每条 risk 的 update payload，事务内只做 DB 写。
    try {
        // DOCX-C3：r.clauseParagraphIndex 是"非空段落序号"空间，clauseDiffResult 里的
        // oldIndex/newIndex 是 oldClauses/newClauses 的"数组下标"空间——两个空间不能直接
        // ===。改成基于 clauseText 推断"老条款数组下标"：拿 r.clauseText 的 head 在
        // oldClauses 里 find 第一个 includes 命中的条款下标；找不到 → migrate 走全局漂移。
        const oldHeadToArrayIdx = new Map<string, number>()
        for (let oi = 0; oi < oldClauses.length; oi++) {
            const head = (oldClauses[oi]?.text ?? '').slice(0, 40)
            if (head.length >= 4 && !oldHeadToArrayIdx.has(head)) {
                oldHeadToArrayIdx.set(head, oi)
            }
        }
        const findOldClauseArrayIdxByAnchor = (anchor: string): number | null => {
            if (!anchor) return null
            for (const [head, oi] of oldHeadToArrayIdx) {
                if (anchor.includes(head)) return oi
            }
            return null
        }

        const migrateStartMs = Date.now()
        const riskMigrateUpdates: Array<{ id: number; data: Prisma.contractRisksUpdateInput }> = []
        for (const r of dbRisks) {
            if (r.clauseParagraphIndex == null) continue
            // M6：Step 4a 已 in-place 更新（重新审查并迁移锚点）的存量风险跳过 Step 5 迁移——
            // 否则基于陈旧 dbRisks 快照重算会覆盖 Step 4a 结果、甚至误标 orphaned。
            if (step4UpdatedExistingRisks.has(r.id)) continue

            // S5：redline-aware 确定性迁移优先。风险在 redlineRefs 登记过时，用 ref.paraIdxs
            // 直接把它定位到回传 docx 的段落、映射到对应 newClauses 条款——绕开「原文锚点 vs
            // 定稿态语料」模糊匹配。修订稿里原问题片段随 <w:del> 丢失，模糊匹配必然失配、
            // 大批风险被误判 orphaned；redline-aware 命中即写库、跳过模糊匹配。
            const redlineResult = migrateRiskByRedlineRef({
                riskId: r.id,
                redline,
                reviewId: review.id,
                newClauses,
            })
            if (redlineResult) {
                const newParaIdx = newClauseArrayIdxToParaIdx(redlineResult.newClauseArrayIdx)
                const oldClauseTextStr = r.clauseText ?? ''
                const clauseTextChanged = oldClauseTextStr.length > 0
                    && oldClauseTextStr !== redlineResult.newClauseText
                const originalUpdate = clauseTextChanged && !r.originalClauseText
                    ? { originalClauseText: oldClauseTextStr }
                    : {}
                riskMigrateUpdates.push({
                    id: r.id,
                    data: {
                        clauseIndex: newClauses[redlineResult.newClauseArrayIdx]!.index,
                        clauseParagraphIndex: newParaIdx,
                        clauseText: redlineResult.newClauseText,
                        clauseCharStart: redlineResult.newClauseCharStart,
                        clauseCharEnd: redlineResult.newClauseCharEnd,
                        orphaned: false,
                        // redline 风险经修订处理后，原问题片段（曾在 <w:del> 内）不再可靠，
                        // 清空 sub-clause quote——风险已确定性定位到条款，不再 orphaned。
                        problematicQuote: null,
                        quoteCharStart: null,
                        quoteCharEnd: null,
                        quoteMatchSource: null,
                        ...originalUpdate,
                    },
                })
                continue
            }

            const oldArrayIdx = findOldClauseArrayIdxByAnchor(r.clauseText ?? '')
            const isModified = oldArrayIdx !== null
                && clauseDiffResult.modified.some((m) => m.oldIndex === oldArrayIdx)
            const isRemoved = oldArrayIdx !== null && clauseDiffResult.removed.includes(oldArrayIdx)
            const unchangedMapping = oldArrayIdx !== null
                ? clauseDiffResult.unchanged.find((u) => u.oldIndex === oldArrayIdx)
                : null

            if (isModified || isRemoved || oldArrayIdx === null) {
                // modified / removed / 完全找不到对应旧条款 → 走双锚点迁移（spec §9.2）
                const preferredNew = isModified
                    ? (clauseDiffResult.modified.find((m) => m.oldIndex === oldArrayIdx)?.newIndex ?? null)
                    : null
                let result = migrateRiskWithDualAnchor({
                    oldClauseText: r.clauseText ?? '',
                    oldProblematicQuote: r.problematicQuote,
                    preferredNewClauseArrayIdx: preferredNew,
                    newClauses,
                    newDocxText,
                })
                // S5 回退：定稿态（接受所有修订）失配——很可能是修订稿，原文锚点对不上
                // 定稿态文本。改用「拒绝所有修订」视图（还原首轮审查原文）重试；命中后把
                // 拒绝视图条款按 index 映射回定稿态条款，并清空 quote（拒绝视图坐标对定稿态无效）。
                if (!result && rejectNewClauses.length > 0) {
                    const rejectResult = migrateRiskWithDualAnchor({
                        oldClauseText: r.clauseText ?? '',
                        oldProblematicQuote: r.problematicQuote,
                        preferredNewClauseArrayIdx: preferredNew,
                        newClauses: rejectNewClauses,
                        newDocxText: rejectNewDocxText,
                    })
                    if (rejectResult) {
                        const rejectSeg = rejectNewClauses[rejectResult.newClauseArrayIdx]
                        const finalIdx = rejectSeg
                            ? newClauses.findIndex((s) => s.index === rejectSeg.index)
                            : -1
                        const finalSeg = finalIdx !== -1 ? newClauses[finalIdx] : undefined
                        if (finalSeg) {
                            result = {
                                matchType: 'clause',
                                newClauseArrayIdx: finalIdx,
                                newClauseText: finalSeg.text,
                                newClauseCharStart: finalSeg.offsetStart,
                                newClauseCharEnd: finalSeg.offsetEnd,
                                newProblematicQuote: null,
                                newQuoteCharStart: null,
                                newQuoteCharEnd: null,
                            }
                        }
                    }
                }
                if (result) {
                    const newParaIdx = newClauseArrayIdxToParaIdx(result.newClauseArrayIdx)
                    // spec §9.3：clauseText 实际变化 + 旧值非空 + 未备份过时才回填 originalClauseText
                    // 旧值非空守护：PR2 schema 给 clauseText `@default("")`，存量行可能是空串，
                    // 备份空串无业务意义反而污染"原文已修改"UI 提示
                    const oldClauseTextStr = r.clauseText ?? ''
                    const clauseTextChanged = oldClauseTextStr.length > 0 && oldClauseTextStr !== result.newClauseText
                    const originalUpdate = clauseTextChanged && !r.originalClauseText
                        ? { originalClauseText: oldClauseTextStr }
                        : {}
                    // 档 1 (matchType=quote)：写双锚点全字段；保留原 quoteMatchSource
                    // 档 2 (matchType=clause)：写 clause 字段 + 清空 quote 字段（含 quoteMatchSource）
                    const quoteUpdate = result.matchType === 'quote'
                        ? {
                            problematicQuote: result.newProblematicQuote,
                            quoteCharStart: result.newQuoteCharStart,
                            quoteCharEnd: result.newQuoteCharEnd,
                            // quoteMatchSource 沿用旧值（迁移不改变首次审查时的命中来源语义）
                        }
                        : {
                            problematicQuote: null,
                            quoteCharStart: null,
                            quoteCharEnd: null,
                            quoteMatchSource: null,
                        }
                    riskMigrateUpdates.push({
                        id: r.id,
                        data: {
                            clauseIndex: newClauses[result.newClauseArrayIdx]!.index,
                            clauseParagraphIndex: newParaIdx,
                            clauseText: result.newClauseText,
                            clauseCharStart: result.newClauseCharStart,
                            clauseCharEnd: result.newClauseCharEnd,
                            orphaned: false, // 之前 orphaned=true 的 risk 重传后又能定位时复活
                            ...quoteUpdate,
                            ...originalUpdate,
                        },
                    })
                } else {
                    // 档 3：两档都失败 → orphaned，保留旧 clauseText / problematicQuote 不动
                    // originalClauseText 仅在旧值非空 + 未备份过时回填（与档 1/2 同口径）
                    const oldClauseTextStr = r.clauseText ?? ''
                    const orphanedOriginalUpdate = oldClauseTextStr.length > 0 && !r.originalClauseText
                        ? { originalClauseText: oldClauseTextStr }
                        : {}
                    riskMigrateUpdates.push({
                        id: r.id,
                        data: {
                            orphaned: true,
                            ...orphanedOriginalUpdate,
                        },
                    })
                }
            } else if (unchangedMapping) {
                // unchanged clause：位置可能变化，更新 clauseParagraphIndex 到新段落序号
                // （quote 字段无需动——clauseText 没变，相对 offset 仍然有效）
                const newParaIdx = newClauseArrayIdxToParaIdx(unchangedMapping.newIndex)
                if (newParaIdx !== r.clauseParagraphIndex) {
                    riskMigrateUpdates.push({
                        id: r.id,
                        data: { clauseParagraphIndex: newParaIdx },
                    })
                }
            }
        }
        logger.info('Step5 锚点迁移计算完成（事务外）', {
            reviewId: review.id,
            riskCount: dbRisks.length,
            updateCount: riskMigrateUpdates.length,
            ms: Date.now() - migrateStartMs,
        })

        // ============ Step 5+6: 一次事务写入 + 保存快照 ============
        // M2：client_return 版本快照纳入同一事务——快照失败时连同 removedAnnIds /
        // 锚点迁移 / redline 处置一并回滚，杜绝「工作区已变更但无 client_return 快照」
        // 的不对称状态。事务回调返回新版本行。
        const txStartMs = Date.now()
        const newVersion = await prisma.$transaction(async (tx) => {
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
                // DOCX-C4 + M8：c.anchorParagraphIndex 是 parseWordComments 的「批注注入
                // 口径段落序号」（与 commentInjector / bodyParagraphs 同口径）。越界校验与
                // clauseText 取段落原文都必须用 newBodyParagraphs（注入口径），不能用
                // newParagraphs（分析口径，含表格段落、下标空间不同）。
                const paraIdx = c.anchorParagraphIndex
                const validPara = paraIdx !== null && paraIdx >= 0 && paraIdx < newBodyParagraphs.length
                const clauseParagraphIndex = validPara ? paraIdx : null
                const clauseText = validPara
                    ? (newBodyParagraphs[paraIdx!] ?? c.content.slice(0, 50))
                    : c.content.slice(0, 50)
                const risk = await tx.contractRisks.create({
                    data: {
                        reviewId: review.id,
                        source: 'external_new',
                        level: 'medium',
                        stance: 'balanced',
                        category: '外部批注',
                        problem: c.content.slice(0, 100),
                        clauseText,
                        clauseParagraphIndex,
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

            // Step 5 锚点迁移写回：payload 已在事务外算好（migrateRiskWithDualAnchor
            // 是几十秒级重 CPU 计算，不能进事务——见事务外注释）。事务内只做 DB 写。
            for (const u of riskMigrateUpdates) {
                await tx.contractRisks.update({ where: { id: u.id }, data: u.data })
            }

            // 写客户修订处置（spec §7）：接受 → 自动解决，但不覆盖律师已有处置。
            // 按 decision 分组 updateMany 批量写，避免逐条 update 在大合同上撑爆事务时长。
            const riskIdsByDecision = new Map<ClientRedlineDecision, number[]>()
            for (const [riskId, decision] of redlineDecisions) {
                const ids = riskIdsByDecision.get(decision)
                if (ids) ids.push(riskId)
                else riskIdsByDecision.set(decision, [riskId])
            }
            for (const [decision, riskIds] of riskIdsByDecision) {
                await tx.contractRisks.updateMany({
                    where: { id: { in: riskIds } },
                    data: { clientRedlineDecision: decision },
                })
            }
            // 接受的修订：风险未被律师处置过（archivedStatus 为空）的自动归档为 handled
            const acceptedRiskIds = riskIdsByDecision.get(ClientRedlineDecision.ACCEPTED) ?? []
            if (acceptedRiskIds.length > 0) {
                await tx.contractRisks.updateMany({
                    where: { id: { in: acceptedRiskIds }, archivedStatus: null },
                    data: { archivedStatus: 'handled', archivedAt: new Date() },
                })
            }

            // DOCX-H3：syncReviewRisksJsonb 必须与 Step 5 锚点迁移在同一事务里，
            // 防止进程在锚点写完之后、JSONB 同步之前被 kill 让 PDF 导出 / 管理端列表
            // 读到过期快照。tx 透传保证同一 pg 连接、同一事务范围。
            await syncReviewRisksJsonb(review.id, tx)

            // M2：client_return 版本快照在同一事务内创建，与上面的工作区写入原子化；
            // 事务回调把新版本行返回给外层。
            return await saveContractReviewVersionService({
                reviewId: review.id,
                systemLabel: 'client_return',
                docxFileId: ossFileId,
                createdById: userId,
                docxText: newDocxText,
                clauses: newClauses,
            }, tx)
        }, {
            // 事务含 DB 写（创建批注 / 写迁移 payload / 写处置 / JSONB 同步 / 版本快照），
            // 重计算已移出事务。30s 阈值对纯 DB 写绰绰有余，留作兜底。
            timeout: 30_000,
        })
        logger.info('Step5 事务完成', { reviewId: review.id, ms: Date.now() - txStartMs })

        let summary = `本轮变化：${externalChangeCount} 处外部变更 · ${clauseModifiedCount} 处条款修改 · AI 增量重审 ${aiReviewCount} 条 · 全局复核 ${globalReviewNewRiskCount} 条`
        if (redlineDecisions.size > 0) {
            summary += ` · 客户修订：接受 ${redlineCounts[ClientRedlineDecision.ACCEPTED]}`
                + ` / 拒绝 ${redlineCounts[ClientRedlineDecision.REJECTED]}`
                + ` / 未处理 ${redlineCounts[ClientRedlineDecision.UNTOUCHED]}`
            if (redlineCounts[ClientRedlineDecision.AMBIGUOUS] > 0) {
                summary += ` / 待确认 ${redlineCounts[ClientRedlineDecision.AMBIGUOUS]}`
            }
        }

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
        // 避免"风险条目凭空多出但无版本快照"的数据不一致。
        await rollbackStep4Mutations(review.id, step4CreatedRiskIds, step4CreatedAnnIds, [...step4UpdatedExistingRisks.values()])
        yield { type: 'error', data: { step: 'merge', code: 'MERGE_FAILED', message: msg } }
    }
    } catch (e: unknown) {
        // M4：Step 3/3b 差异识别、Step 4 预备阶段若抛未捕获异常，原先会穿出到 handler
        // 兜底报 INTERNAL（step 恒为 merge、code 不精确）。这里按当前所处步骤 yield 精确
        // 错误码，让前端把对应步骤标记为失败而非永久转圈。Step 1/2/4a/4b/5 各自有 try/catch，
        // 正常不会落到这里。
        const msg = e instanceof Error ? e.message : '处理失败'
        logger.error('[uploadClientVersion] 未捕获异常', { reviewId: review.id, step: progressStep, err: msg })
        yield {
            type: 'error',
            data: progressStep === 'diff'
                ? { step: 'diff', code: 'DIFF_FAILED', message: msg }
                : { step: 'ai', code: 'AI_REVIEW_FAILED', message: msg },
        }
    } finally {
        // bug #9 + #10：原子锁必须释放。
        // M1：成功 → completed；失败时——已进入写库阶段 → failed；
        //     仍在 Step 1~3 早期阶段（未改动工作区数据）→ 恢复 originalStatus，不误锁成 failed。
        const releaseStatus = succeeded
            ? 'completed'
            : (enteredMutationStage ? 'failed' : originalStatus)
        try {
            await updateContractReviewDAO(review.id, { status: releaseStatus })
        } catch (releaseErr) {
            logger.error('uploadClientVersion: 释放 status 锁失败', {
                reviewId: review.id,
                succeeded,
                releaseStatus,
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
        orderBy: [{ clauseParagraphIndex: 'asc' }, { id: 'asc' }],
    })
    const risksJson: Risk[] = rows.map((r) => ({
        id: String(r.id),
        clauseIndex: r.clauseParagraphIndex ?? 0,
        clauseText: r.clauseText ?? '',
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
