/**
 * Word 原生批注注入。
 *
 * 实现切换到 fast-xml-parser AST（xmlAst.ts）：
 * - 不再做字符串偏移倒序 slice 替换——改为 AST 层面 childrenOf(body) 插入节点
 * - 不再用正则扫 <w:p> / <w:commentRangeStart>——walk(body, visit) 直接到位
 * - comments.xml / customXml / Content_Types / rels 全部 AST 构造后 stringify
 *
 * 行为保持和原实现一致（所有既有单测必须绿），但彻底消除"同段落多 comment
 * 互相字符串覆盖"这类 bug 的复发通道。
 */
import type {
    Risk,
    RiskLevel,
    AnnotationAuthorType,
    ContractAnnotationEntity,
} from '#shared/types/contract'
import {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
    findMaxSharedIdInDocx,
} from './zipRewriter'
import { generateWordCommentRef } from '../utils/wordCommentRef'
import { normalizeForMatch } from '../utils/textSimilarity'
import {
    parseOoxml,
    stringifyOoxml,
    tagOf,
    childrenOf,
    getAttr,
    walk,
    findFirst,
    findAll,
    makeLeaf,
    makeElement,
    makeText,
    makeXmlDecl,
    appendChildToFirst,
    paragraphText,
    hasRunChild,
    collectNonEmptyParagraphs,
    stripIllegalXmlChars,
    type Node,
    type NodeArray,
} from './xmlAst'
import { REDLINE_REFS_PATH, type RedlineWrapTarget } from './redlineInjector'
import { removeCustomXmlPart } from './customXmlRegistrar'

const LEVEL_LABEL: Record<RiskLevel, string> = {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
}

const COMMENTS_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
const CUSTOMXML_CONTENT_TYPE = 'application/xml'
const REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const REL_CUSTOMXML = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml'
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** 生成五模块批注文本（含问题摘要） */
function buildCommentText(risk: Risk): string {
    const lines: string[] = []
    lines.push(`[${LEVEL_LABEL[risk.level]}] ${risk.category}`)
    lines.push(risk.problem)
    lines.push('')
    if (risk.legalBasis) {
        lines.push(`【法律依据】${risk.legalBasis}`)
        lines.push('')
    }
    lines.push('【条款分析】')
    lines.push(risk.analysis)
    lines.push('')
    lines.push('【法律风险】')
    lines.push(risk.risk)
    lines.push('')
    lines.push('【修改建议】')
    lines.push(risk.suggestion)
    return lines.join('\n')
}

/** 批注文本按换行拆成多个 <w:p> AST 节点 */
function buildCommentParagraphs(text: string): NodeArray {
    return text.split('\n').map(line =>
        makeElement('w:p', {}, [
            makeElement('w:r', {}, [
                makeElement('w:t', { 'xml:space': 'preserve' }, [makeText(line)]),
            ]),
        ]),
    )
}

/**
 * 按 anchorQuote 在非空段落列表中搜索，返回最"合适"的段落索引，找不到时返回 -1。
 *
 * 历史 bug（#20）：原实现最低片段长度 2、总是返回第一个 `.includes()` 命中，导致
 *   - 很短的 quote 首行（如"第三条"/"1.1"/"鉴于"）会命中 TOC 或无关段落
 *   - 文档里多个段落重复出现相同短字串时，所有批注被挤到第一个
 * 结果用户看到"某些没批注的段落被挂上了别条风险的批注"。
 *
 * 修复策略：
 *   - 最低片段长度抬到 8，过滤短 header 误伤
 *   - preferredIdx（= anchorParagraphIndex，若合法）用于多候选 tiebreaker —— 选距离它
 *     最近的命中段落，保留"原索引附近的语义位置"
 *   - 正文若只有很短的标题，额外保留一次 length>=4 的弱匹配兜底
 */
function findParagraphIndexByQuote(
    normalizedParas: string[],
    quote: string,
    preferredIdx: number | null = null,
): number {
    if (!quote) return -1

    // strongLines：>=8 字符，主匹配源（降低"第X条"/"1.1"等 TOC 短串误伤）
    // weakLines：仅 strongLines 为空时兜底，允许 >=2 字符（保留 Phase A 短 quote 语义）
    const allLines = quote.split(/\r?\n/).map(l => normalizeForMatch(l))
    const strongLines = allLines.filter(l => l.length >= 8)
    const weakLines = strongLines.length > 0 ? [] : allLines.filter(l => l.length >= 2)
    const lines = strongLines.length > 0 ? strongLines : weakLines
    if (lines.length === 0) return -1

    const candidates = new Set<number>()
    for (const line of lines.slice(0, 3)) {
        for (let i = 0; i < normalizedParas.length; i++) {
            if (normalizedParas[i]!.includes(line)) candidates.add(i)
        }
    }
    if (candidates.size === 0) return -1
    if (preferredIdx == null) return Math.min(...candidates)
    let best = -1
    let bestDist = Number.POSITIVE_INFINITY
    for (const idx of candidates) {
        const dist = Math.abs(idx - preferredIdx)
        if (dist < bestDist) { best = idx; bestDist = dist }
    }
    return best
}

/**
 * 在给定段落节点内插入 commentRangeStart/End/Reference。
 *
 * 同一段落可能承载多条 annotation（AI + 律师答复 + 客户评论），按原顺序
 * 把全部 rangeStart 塞在段首、全部 rangeEnd+reference 塞在段尾——一次性
 * 完成插入，避免"同段多次字符串替换互相覆盖"。
 *
 * PR6 §8.3.6：opts.wrapTarget 命中时，commentRangeStart 精确插到 w:del 之前，
 * commentRangeEnd + commentReference 插到 w:ins 之后（或 w:del 之后，无 ins 时）。
 * 这样律师悬停修订段就直接弹出气泡，而不是悬停整段。
 */
function injectMarkersIntoParagraph(
    paraNode: Node,
    wIds: number[],
    opts?: { wrapTarget?: { delId: number, insId: number | null } },
): void {
    const tag = tagOf(paraNode)
    if (!tag || tag !== 'w:p') return
    const kids = paraNode[tag] as NodeArray
    if (!Array.isArray(kids)) return

    const wrapTarget = opts?.wrapTarget
    const starts = wIds.map(id => makeLeaf('w:commentRangeStart', { 'w:id': String(id) }))
    const ends = wIds.flatMap(id => [
        makeLeaf('w:commentRangeEnd', { 'w:id': String(id) }),
        makeElement('w:r', {}, [
            makeLeaf('w:commentReference', { 'w:id': String(id) }),
        ]),
    ])

    if (wrapTarget) {
        // 精确包裹：找 w:del[w:id=delId] 节点位置插 commentRangeStart；找 w:ins[w:id=insId]
        // （或 delId 节点本身，如 insId==null）位置后插 commentRangeEnd + commentReference run
        const delIdx = kids.findIndex(k => tagOf(k) === 'w:del' && getAttr(k, 'w:id') === String(wrapTarget.delId))
        if (delIdx >= 0) {
            const insIdx = wrapTarget.insId !== null
                ? kids.findIndex(k => tagOf(k) === 'w:ins' && getAttr(k, 'w:id') === String(wrapTarget.insId))
                : delIdx
            if (insIdx >= delIdx) {
                kids.splice(insIdx + 1, 0, ...ends)
                kids.splice(delIdx, 0, ...starts)
                return
            }
        }
        // 未找到目标节点 → 降级到段落级（不应发生但兜底防止 commentRange 丢失）
    }

    // 在段落属性节点（pPr）之后、第一个内容节点之前插入 rangeStart；
    // 若没有 pPr，就插到开头。
    const firstContentIdx = kids.findIndex(k => {
        const t = tagOf(k)
        return t !== null && t !== 'w:pPr'
    })
    const insertAt = firstContentIdx < 0 ? kids.length : firstContentIdx
    kids.splice(insertAt, 0, ...starts)
    // ends + reference 追加到段尾
    kids.push(...ends)
}

export interface InjectCommentsResult {
    buffer: Buffer
    validRisks: Risk[]
    skippedIndices: number[]
}

/**
 * @deprecated Phase A 老 API，不写 LEXSEEK / customXml / [#id-rand8] 身份证，
 * 产出的 docx 回传时**完全无法识别**，会触发"全删+全新增"保护（NO_ANNOTATION_MATCH）。
 * 生产代码请使用 `injectAnnotations`。本函数仅供尚未迁移的历史测试用。
 */
export async function injectComments(docxBuffer: Buffer, risks: Risk[]): Promise<InjectCommentsResult> {
    const zip = await loadDocxZip(docxBuffer)

    if (risks.length === 0) {
        zip.remove('word/comments.xml')
        return {
            buffer: await zipToBuffer(zip),
            validRisks: [],
            skippedIndices: [],
        }
    }

    const documentAst = parseOoxml(await readTextFromZip(zip, 'word/document.xml'))
    const nonEmpty = collectNonEmptyParagraphs(documentAst)
    const nonEmptyCount = nonEmpty.length

    const validRisks: Risk[] = []
    const skippedIndices: number[] = []
    for (const r of risks) {
        if (r.clauseIndex >= 0 && r.clauseIndex < nonEmptyCount) validRisks.push(r)
        else skippedIndices.push(r.clauseIndex)
    }
    if (skippedIndices.length > 0) {
        const truncated = skippedIndices.length > 10
        logger.warn('[commentInjector] 跳过越界 risk', {
            total: risks.length,
            skipped: skippedIndices.length,
            indicesPreview: truncated ? skippedIndices.slice(0, 10) : skippedIndices,
            indicesTruncated: truncated,
            nonEmptyCount,
        })
    }
    if (validRisks.length === 0) {
        return {
            buffer: Buffer.from(docxBuffer),
            validRisks: [],
            skippedIndices,
        }
    }

    // 按 clauseIndex 分组 wId（wId 为 validRisks 数组索引）
    const byParaIdx = new Map<number, number[]>()
    validRisks.forEach((r, i) => {
        const ids = byParaIdx.get(r.clauseIndex)
        if (ids) ids.push(i); else byParaIdx.set(r.clauseIndex, [i])
    })
    for (const [paraIdx, wIds] of byParaIdx) {
        injectMarkersIntoParagraph(nonEmpty[paraIdx]!, wIds)
    }

    // 组装 comments.xml（老格式：w:author 固定 "LexSeek 审查助手"，无 initials/parentId）
    const commentsAst: NodeArray = [
        makeXmlDecl(),
        makeElement(
            'w:comments',
            { 'xmlns:w': W_NS },
            validRisks.map((risk, i) =>
                makeElement(
                    'w:comment',
                    {
                        'w:id': String(i),
                        'w:author': 'LexSeek 审查助手',
                        'w:date': new Date().toISOString(),
                    },
                    buildCommentParagraphs(buildCommentText(risk)),
                ),
            ),
        ),
    ]

    writeTextToZip(zip, 'word/document.xml', stringifyOoxml(documentAst))
    writeTextToZip(zip, 'word/comments.xml', stringifyOoxml(commentsAst))
    await ensureContentTypesRegistered(zip, { comments: true, customXml: false })
    await ensureDocumentRelsRegistered(zip, { comments: true, customXml: false })

    return {
        buffer: await zipToBuffer(zip),
        validRisks,
        skippedIndices,
    }
}

// ============================================================
// Phase B：injectAnnotations —— 按 annotation 逐条注入批注
// ============================================================

/**
 * 导出入参：每条 annotation 的导出所需数据。
 *
 * DOCX-R5：从 ContractAnnotationEntity Pick 派生避免字段重复定义。
 * 不直接复用是因为：
 *   - anchorQuote / anchorParagraphIndex 来自关联的 risk，不在 annotation 上
 *   - createdAt 类型从 entity 的 string 收窄为 Date | null（Phase B 写 OOXML 用 Date）
 */
export type ContractAnnotationForExport = Pick<
    ContractAnnotationEntity,
    'id' | 'riskId' | 'authorType' | 'authorName' | 'content' | 'parentAnnotationId' | 'wordCommentRef'
> & {
    anchorQuote: string
    anchorParagraphIndex: number
    /**
     * annotation 创建时间。写入 w:date 让 Word UI 显示批注真实的创建时间，
     * 而不是每次导出都刷新为"现在"。可选：传 null 时用当前时间兜底。
     */
    createdAt?: Date | null
}

export interface InjectAnnotationsResult {
    buffer: Buffer
    /** 每条 annotation 最终使用的 wordCommentRef（供调用方回写 DB） */
    refsByAnnotationId: Map<number, string>
    /**
     * 本次注入分配的 wId 末位 + 1（即"下一个可用 wId"）。
     * 供 both 模式下 redlineInjector 协调时接力 commentInjector 共享 ID 池。
     */
    nextIdAfter: number
}

/**
 * injectAnnotations 选项（PR6 §8.3.1 / §8.3.6）。
 */
export interface InjectAnnotationsOptions {
    /** 起始 w:id；与 redlineInjector 共享 ID 池时由 nextIdAfter 接力 */
    idStart?: number
    /**
     * spec §8.3.6：both 模式下按 riskId 把 commentRange 精确包到 redline 的
     * <w:del>+<w:ins> 周围，让律师悬停修订段直接弹气泡。
     * key=riskId（contractRisks.id），value=redlineInjector 返回的段落坐标。
     * - 命中：在第一段 del 之前插 commentRangeStart，在最后段 ins（或 del）之后插 commentRangeEnd + commentReference run
     * - 未命中：维持现状按 anchorParagraphIndex 在段落首/尾插 commentRange
     */
    wrapTargetByRiskId?: Map<number, RedlineWrapTarget>
    /** AI 批注的作者署名（spec §4.3）；不传时回退 'AI' */
    signature?: string
    /**
     * M15：comment-only 模式导出时，清理 base（可能是客户回传件）残留的陈旧
     * redlineRefs.xml + 其 [Content_Types].xml / rels 登记。
     * both / redline 模式下 injectRedlineMarks 已写好本轮新鲜 redlineRefs，
     * 这些模式**不传**此项（默认 false），避免误删本轮修订身份证。
     */
    purgeRedlineRefs?: boolean
}

/**
 * 按 annotation 注入 Word 批注。
 *
 * 规则：
 * - 每条 annotation 生成一个 <w:comment>，w:id 按数组顺序 0,1,2...
 * - w:author = 'LS:{authorName} [#{reviewId}-{annotationId}-{rand8}]'
 *   （Phase C+：稳定身份证含 reviewId，Word 保证不截断 author 字段）
 * - w:initials = 头像缩写（AI/律/客）——不再承载身份证，避免 Word 按
 *   people.xml 统一同类作者 initials 时 fallback parser 被中毒
 * - customXml/annotationRefs.xml 写权威 reviewId/wId→annotationId 映射（主防线）
 * - parentAnnotationId 非空且父在本批次中 → 写 w:parentId 实现"答复批注"
 * - anchorParagraphIndex 越界 → 跳过 document.xml 注入（仍写入 comments.xml + customXml，
 *   以保持 w:id 连续）
 *
 * @param reviewId 必须传入——会被编入 author 尾部 + customXml 的 reviewId 字段，
 *   upload 侧据此 assert 身份证归属，拒绝跨 review 文件串扰。
 */
export async function injectAnnotations(
    docxBuffer: Buffer,
    annotations: ContractAnnotationForExport[],
    reviewId: number,
    opts?: InjectAnnotationsOptions,
): Promise<InjectAnnotationsResult> {
    const wrapTargetByRiskId = opts?.wrapTargetByRiskId ?? new Map<number, RedlineWrapTarget>()
    const signature = opts?.signature?.trim() || 'AI'
    const refsByAnnotationId = new Map<number, string>()

    if (annotations.length === 0) {
        const zip = await loadDocxZip(docxBuffer)
        zip.remove('word/comments.xml')
        zip.remove('word/_rels/comments.xml.rels')
        zip.remove('word/customXml/annotationRefs.xml')
        // DOCX-H6：clean 残留的 customXml part rels 文件（极少存在但理论可能有）
        zip.remove('word/customXml/_rels/annotationRefs.xml.rels')
        // M15：comment-only 导出清理 base 残留的陈旧 redlineRefs.xml
        if (opts?.purgeRedlineRefs) await removeCustomXmlPart(zip, { partPath: REDLINE_REFS_PATH })
        await ensureContentTypesRegistered(zip, { comments: false, customXml: false })
        await ensureDocumentRelsRegistered(zip, { comments: false, customXml: false })
        return { buffer: await zipToBuffer(zip), refsByAnnotationId, nextIdAfter: opts?.idStart ?? 0 }
    }

    for (const a of annotations) {
        refsByAnnotationId.set(a.id, a.wordCommentRef ?? generateWordCommentRef(a.id))
    }

    const zip = await loadDocxZip(docxBuffer)
    // M15：comment-only 导出清理 base（可能是客户回传件）残留的陈旧 redlineRefs.xml
    if (opts?.purgeRedlineRefs) await removeCustomXmlPart(zip, { partPath: REDLINE_REFS_PATH })
    const documentAst = parseOoxml(await readTextFromZip(zip, 'word/document.xml'))
    // S2 + M16：idStart 未显式传入（comment 默认模式）时，扫全文 w:id 共享池取 max+1，
    // 避免注入的 commentRange w:id 从 0 起撞原文档既有 bookmarkStart 等元素 → Word 报损坏。
    const idStart = opts?.idStart ?? (await findMaxSharedIdInDocx(zip)) + 1
    const nextIdAfter = idStart + annotations.length
    // M14：原文档可能带客户原生批注。先记基线——原生 <w:comment> 节点 + document.xml
    // 里原生 commentRange/Reference 计数；注入后保留原生批注、整体计数核对都带上基线。
    const nativeComments = await readNativeComments(zip)
    const nativeMarkers = countCommentMarkers(documentAst)
    const nonEmpty = collectNonEmptyParagraphs(documentAst)
    const nonEmptyCount = nonEmpty.length
    // 段落归一化结果一次算清，下面"精确优先"和 fuzzy 都复用，省 N×M 次 normalize。
    const normalizedParas = nonEmpty.map(p => normalizeForMatch(paragraphText(p)))

    // 按原顺序分配 Word 本地 w:id，从 idStart 起始
    const wordIdByAnnotationId = new Map<number, number>()
    annotations.forEach((a, idx) => wordIdByAnnotationId.set(a.id, idStart + idx))

    // 解析每条 annotation 的最终段落索引（bug #20 修复后的顺序）：
    //   1. anchorParagraphIndex 合法 + 该段落本身包含 quote 片段 → 直接锁定（精确优先）
    //   2. 否则按 quote fuzzy 搜索，以 anchorParagraphIndex 为 preferredIdx 挑最近候选
    //   3. 都不行但 anchorParagraphIndex 合法 → 回退到索引（信任 Phase B 的锚点迁移）
    //   4. 都不行 → 跳过，logger.warn
    //
    // 为什么不再把 quote 放第一位：anchorQuote 前几行常含"第X条"/"1.1"等在 TOC/标题也
    // 会出现的通用片段，优先 quote 会让所有批注被挤到首个命中，撞上没批注的段落。
    const resolvedParagraphIndex = new Map<number, number>()
    const validAnnotations: ContractAnnotationForExport[] = []
    for (const a of annotations) {
        const paraIdx = a.anchorParagraphIndex
        // M9：anchorParagraphIndex 上游可能因越界 clauseIndex 导致 clauseParagraphIndex 落
        // null，再被 `a.risk.clauseParagraphIndex!` 断言成 number 实则 null 传进来。Number.isInteger
        // 兜底——null / undefined / NaN / 非整数一律视为无效段落锚点，退回 quote fuzzy 定位，
        // 避免 normalizedParas[null] 得 undefined → .includes() 抛 TypeError 把整份审查置 failed。
        const paraValid = Number.isInteger(paraIdx) && paraIdx >= 0 && paraIdx < nonEmptyCount

        let resolved = -1
        if (paraValid) {
            // 精确优先：段落本身含 quote 任一 >=8 字符片段 → 锁定
            const paraText = normalizedParas[paraIdx]!
            const quoteLines = (a.anchorQuote ?? '')
                .split(/\r?\n/)
                .map(l => normalizeForMatch(l))
                .filter(l => l.length >= 8)
            if (quoteLines.slice(0, 3).some(l => paraText.includes(l))) {
                resolved = paraIdx
            }
        }
        if (resolved < 0) {
            // 段落自身不含 quote → paraIdx 大概率是错的（历史数据 anchorParagraphIndex
            // 存的是"条款序号"而非"非空段落序号"），完全信任 fuzzy 的结果。
            // 多候选时 findParagraphIndexByQuote 已用 preferredIdx tiebreaker 选最近者，
            // 避免 TOC / 标题里的重复短片段乱命中。
            const fuzzy = findParagraphIndexByQuote(normalizedParas, a.anchorQuote ?? '', paraValid ? paraIdx : null)
            if (fuzzy >= 0) {
                resolved = fuzzy
            } else if (paraValid) {
                resolved = paraIdx
            }
        }

        if (resolved >= 0) {
            resolvedParagraphIndex.set(a.id, resolved)
            validAnnotations.push(a)
        } else {
            logger.warn('[commentInjector] injectAnnotations: anchorQuote 未命中且 anchorParagraphIndex 越界，跳过', {
                annotationId: a.id,
                anchorQuote: a.anchorQuote,
                anchorParagraphIndex: a.anchorParagraphIndex,
                nonEmptyCount,
            })
        }
    }

    if (validAnnotations.length === 0) {
        // M15：purgeRedlineRefs 已就地修改 zip，必须回写 zip 而非返回未改的 docxBuffer
        const buffer = opts?.purgeRedlineRefs ? await zipToBuffer(zip) : Buffer.from(docxBuffer)
        return { buffer, refsByAnnotationId, nextIdAfter }
    }

    // 按段落分组注入 range markers
    const byParaIdx = new Map<number, number[]>()
    for (const a of validAnnotations) {
        const paraIdx = resolvedParagraphIndex.get(a.id)!
        const wId = wordIdByAnnotationId.get(a.id)!
        const ids = byParaIdx.get(paraIdx)
        if (ids) ids.push(wId); else byParaIdx.set(paraIdx, [wId])
    }
    // PR6 §8.3.6：预构反向索引 wId → annotation，O(1) 查 wrapTarget
    const annByWId = new Map<number, ContractAnnotationForExport>(
        validAnnotations.map(a => [wordIdByAnnotationId.get(a.id)!, a] as const),
    )
    for (const [paraIdx, wIds] of byParaIdx) {
        // v1 简化：单 wId + 命中 wrapTarget → 精确包裹；多 wId / 未命中 → 段落级兜底。
        // 同段多 risk 的概率极低（每条 risk 各占一段为常态），简化分支不影响 spec §8.3.6
        // 对常见场景的核心 UX。
        if (wIds.length === 1) {
            const onlyWId = wIds[0]!
            const ann = annByWId.get(onlyWId)
            const span = ann ? wrapTargetByRiskId.get(ann.riskId) : undefined
            const segHere = span?.paragraphSpans.find(s => s.paraIdx === paraIdx)
            if (segHere) {
                injectMarkersIntoParagraph(nonEmpty[paraIdx]!, [onlyWId], { wrapTarget: segHere })
                continue
            }
        }
        // 段落级兜底：与现有 commentInjector 行为一致
        injectMarkersIntoParagraph(nonEmpty[paraIdx]!, wIds)
    }
    writeTextToZip(zip, 'word/document.xml', stringifyOoxml(documentAst))

    // comments.xml：全 annotations（含越界的）以保持 w:id 连续；M14：保留原文档原生批注
    writeTextToZip(zip, 'word/comments.xml',
        buildCommentsXmlFromAnnotations(annotations, wordIdByAnnotationId, signature, nativeComments),
    )
    // 移除原文件残留的 comments.xml.rels（我们生成的 comments 无外部关系；
    // 原 rels 的悬空引用会让 Word 报"文件损坏"）
    zip.remove('word/_rels/comments.xml.rels')

    // customXml：wId → annotationId 权威映射（含 reviewId 防跨 review 串扰）
    writeTextToZip(zip, 'word/customXml/annotationRefs.xml',
        buildAnnotationRefsXml(annotations, refsByAnnotationId, wordIdByAnnotationId, reviewId),
    )

    await ensureContentTypesRegistered(zip, { comments: true, customXml: true })
    await ensureDocumentRelsRegistered(zip, { comments: true, customXml: true })

    // 产物一致性自检（同段落多 comment 孤儿、AST round-trip 意外丢节点都会被抓到）
    await assertCommentIntegrity(zip, validAnnotations.length, annotations.length, nativeComments.length, nativeMarkers)

    return { buffer: await zipToBuffer(zip), refsByAnnotationId, nextIdAfter }
}

/**
 * 产物自检：comments.xml 的 w:comment 数 + document.xml 的 rangeStart/End/reference
 * 数必须与预期严格一致，否则 Word 会报"文件损坏"，拒绝产出。
 */
async function assertCommentIntegrity(
    zip: Awaited<ReturnType<typeof loadDocxZip>>,
    validCount: number,
    totalCount: number,
    nativeCommentCount: number,
    nativeMarkers: { rangeStart: number; rangeEnd: number; reference: number },
): Promise<void> {
    const docAst = parseOoxml(await readTextFromZip(zip, 'word/document.xml'))
    const commentsAst = parseOoxml(await readTextFromZip(zip, 'word/comments.xml'))

    const commentCount = findAll(commentsAst, 'w:comment').length
    const rangeStartCount = findAll(docAst, 'w:commentRangeStart').length
    const rangeEndCount = findAll(docAst, 'w:commentRangeEnd').length
    const referenceCount = findAll(docAst, 'w:commentReference').length

    // M14：保留了原文档原生批注，预期计数 = 我方注入 + 原生基线
    const expectedComment = totalCount + nativeCommentCount
    const expectedRangeStart = validCount + nativeMarkers.rangeStart
    const expectedRangeEnd = validCount + nativeMarkers.rangeEnd
    const expectedReference = validCount + nativeMarkers.reference

    const fail = (reason: string) => {
        throw new Error(
            `[commentInjector] 产物一致性检查失败：${reason}。`
            + ` comments.xml w:comment=${commentCount}，`
            + ` document.xml rangeStart=${rangeStartCount} / rangeEnd=${rangeEndCount} / reference=${referenceCount}，`
            + ` 期望 ${expectedComment} / ${expectedRangeStart} / ${expectedRangeEnd} / ${expectedReference}（已含原生批注基线）。`
            + ' 这会让 Word 报"文件损坏"，拒绝产出。',
        )
    }

    if (commentCount !== expectedComment) fail('comments.xml 的 w:comment 数与 annotations + 原生批注不符')
    if (rangeStartCount !== expectedRangeStart) fail('document.xml 的 commentRangeStart 数与 validAnnotations + 原生不符')
    if (rangeEndCount !== expectedRangeEnd) fail('document.xml 的 commentRangeEnd 数与 validAnnotations + 原生不符')
    if (referenceCount !== expectedReference) fail('document.xml 的 commentReference 数与 validAnnotations + 原生不符')
}

/**
 * M14：读原文档 comments.xml 里既有的 <w:comment>（客户原生批注）。
 * comment 模式整体覆盖 comments.xml 时，原生批注须保留并合并进新文件，否则丢失客户内容、
 * 且 document.xml 里残留的原生 commentRange 会让 assertCommentIntegrity 计数对不上而抛错。
 */
async function readNativeComments(zip: Awaited<ReturnType<typeof loadDocxZip>>): Promise<NodeArray> {
    const file = zip.file('word/comments.xml')
    if (!file) return []
    try {
        return findAll(parseOoxml(await file.async('string')), 'w:comment')
    } catch {
        return []
    }
}

/** M14：数 document.xml AST 里的原生 commentRange/Reference 标记基线。 */
function countCommentMarkers(docAst: NodeArray): { rangeStart: number; rangeEnd: number; reference: number } {
    return {
        rangeStart: findAll(docAst, 'w:commentRangeStart').length,
        rangeEnd: findAll(docAst, 'w:commentRangeEnd').length,
        reference: findAll(docAst, 'w:commentReference').length,
    }
}

/**
 * 构造 word/customXml/annotationRefs.xml。
 *
 * 结构：
 *   <lexseekAnnotationRefs xmlns="urn:lexseek:contract-review:v1">
 *     <ref wId="0" annotationId="101" rand="abc12345"/>
 *     ...
 *   </lexseekAnnotationRefs>
 */
function buildAnnotationRefsXml(
    annotations: ContractAnnotationForExport[],
    refs: Map<number, string>,
    wordIds: Map<number, number>,
    reviewId: number,
): string {
    // DOCX-M5：wId 唯一性自检——重复会让 readCustomXmlRefs 静默丢条
    // （第一防线失效）。生产理论不可达（wordIdByAnnotationId 用 Map 保证），
    // 这里 throw 让 bug 早暴露。
    const seenWIds = new Set<number>()
    for (const a of annotations) {
        const wId = wordIds.get(a.id)
        if (wId === undefined) continue
        if (seenWIds.has(wId)) {
            throw new Error(
                `[commentInjector] customXml 构造时检测到重复 wId=${wId}（annotationId=${a.id}）。`
                + ' 上游 wordIds Map 应保证唯一，请检查调用方是否覆盖了同一 wId。',
            )
        }
        seenWIds.add(wId)
    }
    const children = annotations.map(a => {
        const wId = wordIds.get(a.id)!
        const ref = refs.get(a.id)!
        const randMatch = /-([a-zA-Z0-9]{8})$/.exec(ref)
        const rand = randMatch ? randMatch[1]! : ''
        return makeLeaf('ref', {
            wId: String(wId),
            reviewId: String(reviewId),
            annotationId: String(a.id),
            rand,
        })
    })
    const ast: NodeArray = [
        makeXmlDecl(),
        makeElement('lexseekAnnotationRefs', { xmlns: 'urn:lexseek:contract-review:v1' }, children),
    ]
    return stringifyOoxml(ast)
}

/**
 * 构造 Phase C+ comments.xml。spec §4.3：作者名一律去 LS: 前缀；
 * AI 内容用署名，律师/客户用各自姓名。
 *
 * 身份证已移到 customXml/annotationRefs.xml，comments.xml 本身不承载 reviewId。
 */
function buildCommentsXmlFromAnnotations(
    annotations: ContractAnnotationForExport[],
    wordIds: Map<number, number>,
    signature: string,
    nativeComments: NodeArray = [],
): string {
    const fallbackNow = new Date().toISOString()
    const children = annotations.map(a => {
        const wId = wordIds.get(a.id)!
        // spec §4.3：作者名一律去 LS: 前缀；AI 内容用署名，律师/客户用各自姓名
        // S3：作者名 / 缩写统一过 stripIllegalXmlChars——authorName / signature 可能
        // 来自剪贴板粘贴，混入 U+0008 等非法 XML 1.0 字符会让 Word 拒绝打开。
        const author = stripIllegalXmlChars(a.authorType === 'ai' ? signature : a.authorName)
        const initials = stripIllegalXmlChars(initialsFor(a.authorType, signature))
        // M7：优先用 annotation.createdAt，回落到当前时间兜底
        const dateIso = a.createdAt ? a.createdAt.toISOString() : fallbackNow

        const attrs: Record<string, string> = {
            'w:id': String(wId),
            'w:author': author,
            'w:initials': initials,
            'w:date': dateIso,
        }
        if (a.parentAnnotationId !== null && wordIds.has(a.parentAnnotationId)) {
            attrs['w:parentId'] = String(wordIds.get(a.parentAnnotationId))
        }
        // L12：a.content 是多段批注文本（renderRiskAsAnnotationText 用 \n 连接【法律依据】
        // 【条款分析】等段）。塞进单个 <w:t> 时 Word 不渲染 \n 换行、气泡挤成一行；
        // 按行拆成多个 <w:p> 才能正确换行。
        const body: NodeArray = buildCommentParagraphs(stripIllegalXmlChars(a.content))
        return makeElement('w:comment', attrs, body)
    })
    const ast: NodeArray = [
        makeXmlDecl(),
        // M14：原生批注在前、我方批注在后，合并进同一个 <w:comments>
        makeElement('w:comments', { 'xmlns:w': W_NS }, [...nativeComments, ...children]),
    ]
    return stringifyOoxml(ast)
}

/** 批注头像缩写：AI 用署名前 2 字，律师/客户用角色字 */
function initialsFor(authorType: AnnotationAuthorType, signature: string): string {
    switch (authorType) {
        case 'ai': return signature.slice(0, 2) || 'AI'
        case 'lawyer': return '律'
        case 'external': return '客'
        default: return 'LS'
    }
}

/**
 * 幂等更新 [Content_Types].xml：按需注册 / 取消注册 comments + customXml 的 Override。
 */
async function ensureContentTypesRegistered(
    zip: Awaited<ReturnType<typeof loadDocxZip>>,
    opts: { comments: boolean; customXml: boolean },
): Promise<void> {
    const xml = await readTextFromZip(zip, '[Content_Types].xml')
    const ast = parseOoxml(xml)
    const types = findFirst(ast, 'Types')
    if (!types) return
    const typesKids = types['Types'] as NodeArray

    const hasComments = hasOverride(ast, '/word/comments.xml')
    const hasCustomXml = hasOverride(ast, '/word/customXml/annotationRefs.xml')

    let changed = false
    // comments 注册
    if (opts.comments && !hasComments) {
        typesKids.push(makeLeaf('Override', {
            PartName: '/word/comments.xml',
            ContentType: COMMENTS_CONTENT_TYPE,
        }))
        changed = true
    } else if (!opts.comments && hasComments) {
        removeOverride(typesKids, '/word/comments.xml')
        changed = true
    }
    // customXml 注册
    if (opts.customXml && !hasCustomXml) {
        typesKids.push(makeLeaf('Override', {
            PartName: '/word/customXml/annotationRefs.xml',
            ContentType: CUSTOMXML_CONTENT_TYPE,
        }))
        changed = true
    } else if (!opts.customXml && hasCustomXml) {
        removeOverride(typesKids, '/word/customXml/annotationRefs.xml')
        changed = true
    }

    if (changed) writeTextToZip(zip, '[Content_Types].xml', stringifyOoxml(ast))
}

function hasOverride(ast: NodeArray, partName: string): boolean {
    for (const node of findAll(ast, 'Override')) {
        if (getAttr(node, 'PartName') === partName) return true
    }
    return false
}

function removeOverride(typesKids: NodeArray, partName: string): void {
    for (let i = typesKids.length - 1; i >= 0; i--) {
        const n = typesKids[i]!
        if (tagOf(n) !== 'Override') continue
        if (getAttr(n, 'PartName') === partName) typesKids.splice(i, 1)
    }
}

/**
 * 幂等更新 word/_rels/document.xml.rels：按需注册 / 取消注册 comments + customXml 关系。
 */
async function ensureDocumentRelsRegistered(
    zip: Awaited<ReturnType<typeof loadDocxZip>>,
    opts: { comments: boolean; customXml: boolean },
): Promise<void> {
    const xml = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
    const ast = parseOoxml(xml)
    const rels = findFirst(ast, 'Relationships')
    if (!rels) return
    const relsKids = rels['Relationships'] as NodeArray

    const hasComments = hasRelWithTarget(ast, 'comments.xml')
    const hasCustomXml = hasRelWithTarget(ast, 'customXml/annotationRefs.xml')

    let changed = false
    if (opts.comments && !hasComments) {
        appendChildToFirst(ast, 'Relationships', makeLeaf('Relationship', {
            Id: 'rIdComments',
            Type: REL_COMMENTS,
            Target: 'comments.xml',
        }))
        changed = true
    } else if (!opts.comments && hasComments) {
        removeRelWithTarget(relsKids, 'comments.xml')
        changed = true
    }
    if (opts.customXml && !hasCustomXml) {
        appendChildToFirst(ast, 'Relationships', makeLeaf('Relationship', {
            Id: 'rIdLexseekRefs',
            Type: REL_CUSTOMXML,
            Target: 'customXml/annotationRefs.xml',
        }))
        changed = true
    } else if (!opts.customXml && hasCustomXml) {
        removeRelWithTarget(relsKids, 'customXml/annotationRefs.xml')
        changed = true
    }

    if (changed) writeTextToZip(zip, 'word/_rels/document.xml.rels', stringifyOoxml(ast))
}

function hasRelWithTarget(ast: NodeArray, target: string): boolean {
    for (const node of findAll(ast, 'Relationship')) {
        if (getAttr(node, 'Target') === target) return true
    }
    return false
}

function removeRelWithTarget(relsKids: NodeArray, target: string): void {
    for (let i = relsKids.length - 1; i >= 0; i--) {
        const n = relsKids[i]!
        if (tagOf(n) !== 'Relationship') continue
        if (getAttr(n, 'Target') === target) relsKids.splice(i, 1)
    }
}
