/**
 * OOXML Track Changes（修订模式）注入。
 *
 * 输入：每条 risk 的 quote 锚点（PR3 落地）+ suggestedClauseText（risksSchema 已强制单段）。
 * 输出：原 docx 内 quote 范围内所有 run 被 wrap 进 `<w:del>`（保留原 `<w:rPr>` 副本，
 *   `<w:t>` → `<w:delText>`），紧邻插入 `<w:ins>` 包裹 suggestedClauseText（继承 quote
 *   起始 run 的 rPr）。段落标记符（pilcrow）始终保留——每条 redline 必带
 *   suggestedClauseText（属"整段/部分替换"而非"整段删除"），删除段落标记符会让 Word
 *   把该段与下一段合并显示（ECMA-376 §17.13.5.15），下一条款标题被吸进正文末尾。
 *
 * 跳过条件（risk 不参与 redline，记入 skippedRiskIds，调用方可走 comment fallback）：
 *  - problematicQuote == null（无锚点）
 *  - quoteCharStart/End == null（同上）
 *  - suggestedClauseText 为空（low risk 无改写建议）
 *  - clauseParagraphIndex == null
 *  - locateQuoteInParagraphs 返回 null（OOXML 段落 textContent 与 clauseText 不一致等）
 *
 * ID 协调（spec §8.3.1）：
 *  - 入参 idStart 必须 ≥ findMaxSharedId(原 docx) + 1
 *  - 每条 redline 占 2 个 ID（w:del + w:ins）
 *  - 返回 nextIdAfter = idStart + 已分配数，供 both 模式接力 commentInjector
 */
import {
    parseOoxml,
    stringifyOoxml,
    childrenOf,
    tagOf,
    textOf,
    makeElement,
    makeText,
    collectNonEmptyParagraphs,
    stripIllegalXmlChars,
    type Node,
    type NodeArray,
} from './xmlAst'
import {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
} from './zipRewriter'
import {
    locateQuoteInParagraphs,
    computeRunLength,
    type RunSplit,
} from './redlineLocate'

const REDLINE_AUTHOR = 'LexSeek AI'

export interface RedlineRisk {
    /** contractRisks.id（数据库主键），仅用于 skippedRiskIds 回报 */
    id: number
    clauseText: string
    clauseParagraphIndex: number | null
    problematicQuote: string | null
    quoteCharStart: number | null
    quoteCharEnd: number | null
    suggestedClauseText: string | null
}

/**
 * redlineInjector 装填后单条 risk 的修订段坐标（spec §8.3.6）。
 *
 * 跨段 risk 的 paragraphSpans 含多个元素：commentRange 的 Start 在第一段 del 之前、
 * End 在最后段 ins 之后（或最后段 del 之后，无 ins 时）。
 *
 * 类型只在 commentInjector ⇄ redlineInjector 流转，前端不消费 → 放 server 端
 * （非 shared，参考 .claude/rules/types.md）。commentInjector 单向 import，无循环依赖。
 */
export interface RedlineWrapTarget {
    paragraphSpans: Array<{
        /** 段落在 collectNonEmptyParagraphs 数组里的索引 */
        paraIdx: number
        /** 该段内 w:del 节点的 w:id（commentInjector 据此 grep 节点位置） */
        delId: number
        /** 该段内 w:ins 节点的 w:id；null = 跨段非结尾段（无 ins） */
        insId: number | null
    }>
}

export interface InjectRedlineResult {
    buffer: Buffer
    /** 没装 redline 的 risk id 列表（按 spec §8.4 调用方走 comment fallback） */
    skippedRiskIds: number[]
    /**
     * 已成功装填的 risk → redline 段落坐标映射（spec §8.3.6 核心 UX）。
     * both 模式下 commentInjector 据此把 <w:commentRangeStart/End> 精确包到
     * <w:del>+<w:ins> 周围，让律师悬停修订段直接弹气泡。
     */
    spansByRiskId: Map<number, RedlineWrapTarget>
    /** 下一个可用 w:id（供 both 模式接力 commentInjector） */
    nextIdAfter: number
    warnings: string[]
}

export async function injectRedlineMarks(
    docxBuffer: Buffer,
    risks: RedlineRisk[],
    options: { reviewId: number, idStart: number },
): Promise<InjectRedlineResult> {
    const skippedRiskIds: number[] = []
    const warnings: string[] = []
    const spansByRiskId = new Map<number, RedlineWrapTarget>()
    let cursorId = options.idStart

    // 先过滤掉前置 invalid 的 risk（不解 zip 也能判断）
    const candidates: RedlineRisk[] = []
    for (const r of risks) {
        if (
            !r.problematicQuote
            || r.quoteCharStart == null
            || r.quoteCharEnd == null
            || !r.suggestedClauseText
            || r.clauseParagraphIndex == null
        ) {
            skippedRiskIds.push(r.id)
            continue
        }
        candidates.push(r)
    }

    if (candidates.length === 0) {
        return {
            buffer: Buffer.from(docxBuffer),
            skippedRiskIds,
            spansByRiskId,
            nextIdAfter: cursorId,
            warnings,
        }
    }

    const zip = await loadDocxZip(docxBuffer)
    const documentAst = parseOoxml(await readTextFromZip(zip, 'word/document.xml'))
    const nonEmptyParagraphs = collectNonEmptyParagraphs(documentAst)
    const dateIso = new Date().toISOString()

    for (const risk of candidates) {
        const loc = locateQuoteInParagraphs({
            nonEmptyParagraphs,
            clauseText: risk.clauseText,
            clauseParagraphIndex: risk.clauseParagraphIndex!,
            quoteCharStart: risk.quoteCharStart!,
            quoteCharEnd: risk.quoteCharEnd!,
        })
        if (!loc) {
            skippedRiskIds.push(risk.id)
            warnings.push(`risk ${risk.id}: locateQuoteInParagraphs 返回 null（clauseText 与段落 textContent 不一致或越界）`)
            continue
        }

        if (loc.startParaIdx === loc.endParaIdx) {
            const split = loc.splits[0]!.runSplit!
            const delId = cursorId
            const insId = cursorId + 1
            applyRedlineToParagraph({
                paraNode: nonEmptyParagraphs[loc.startParaIdx]!,
                runSplit: split,
                suggestedClauseText: risk.suggestedClauseText,
                delId,
                insId,
                dateIso,
            })
            cursorId += 2
            spansByRiskId.set(risk.id, {
                paragraphSpans: [{ paraIdx: loc.startParaIdx, delId, insId }],
            })
        }
        else {
            // 跨段：每段独立 w:del，结尾段后追加 w:ins
            const paragraphSpans: RedlineWrapTarget['paragraphSpans'] = []
            for (let i = 0; i < loc.splits.length; i++) {
                const seg = loc.splits[i]!
                const para = nonEmptyParagraphs[seg.paraIdx]!
                const isEnd = i === loc.splits.length - 1
                const split = seg.runSplit ?? wholeParagraphRunSplit(para)
                const delId = cursorId
                const insId = isEnd ? cursorId + 1 : null
                applyRedlineToParagraph({
                    paraNode: para,
                    runSplit: split,
                    suggestedClauseText: isEnd ? risk.suggestedClauseText : null,
                    delId,
                    insId,
                    dateIso,
                })
                cursorId += isEnd ? 2 : 1
                paragraphSpans.push({ paraIdx: seg.paraIdx, delId, insId })
            }
            spansByRiskId.set(risk.id, { paragraphSpans })
        }
    }

    writeTextToZip(zip, 'word/document.xml', stringifyOoxml(documentAst))
    return {
        buffer: await zipToBuffer(zip),
        skippedRiskIds,
        spansByRiskId,
        nextIdAfter: cursorId,
        warnings,
    }
}

/**
 * 深克隆 AST 节点。Node 17+ 原生 structuredClone 比 JSON 序列化快 2-3 倍，
 * 跨 run redline + 高 risk 数场景累积可观（实测 1-2s → 300-500ms）。
 */
function deepClone<T>(node: T): T {
    return structuredClone(node)
}

function getRPr(runNode: Node): Node | null {
    return childrenOf(runNode).find(k => tagOf(k) === 'w:rPr') ?? null
}

/**
 * 把单个 <w:r> 在指定 run 内偏移处一刀切两半，保留 rPr 副本。
 * 字符等价规则与 redlineLocate 一致：w:t 字面 / w:tab=1 / w:br=0。
 *
 * 返回 { left, right }；任一边没有内容（仅含 rPr）→ 该侧返回 null。
 */
function splitRunAtOffset(runNode: Node, offset: number): { left: Node | null, right: Node | null } {
    const kids = childrenOf(runNode)
    const rPr = kids.find(k => tagOf(k) === 'w:rPr') ?? null
    const leftKids: NodeArray = []
    const rightKids: NodeArray = []
    if (rPr) {
        leftKids.push(deepClone(rPr))
        rightKids.push(deepClone(rPr))
    }

    let consumed = 0
    for (const kid of kids) {
        const tag = tagOf(kid)
        if (tag === 'w:rPr') continue
        if (tag === 'w:t') {
            const txt = textOf(kid)
            const len = txt.length
            const startC = consumed
            const endC = consumed + len
            if (endC <= offset) {
                leftKids.push(deepClone(kid))
            }
            else if (startC >= offset) {
                rightKids.push(deepClone(kid))
            }
            else {
                // 横跨切分点
                const cut = offset - startC
                if (cut > 0) {
                    leftKids.push(makeElement('w:t', { 'xml:space': 'preserve' }, [makeText(txt.slice(0, cut))]))
                }
                if (cut < len) {
                    rightKids.push(makeElement('w:t', { 'xml:space': 'preserve' }, [makeText(txt.slice(cut))]))
                }
            }
            consumed += len
        }
        else if (tag === 'w:tab') {
            // 1 字符
            if (consumed < offset) leftKids.push(deepClone(kid))
            else rightKids.push(deepClone(kid))
            consumed += 1
        }
        else if (tag === 'w:br') {
            // 0 字符；按 consumed 与 offset 关系归边
            if (consumed < offset) leftKids.push(deepClone(kid))
            else rightKids.push(deepClone(kid))
        }
        else {
            if (consumed < offset) leftKids.push(deepClone(kid))
            else rightKids.push(deepClone(kid))
        }
    }

    const leftHasContent = leftKids.some(k => tagOf(k) !== 'w:rPr')
    const rightHasContent = rightKids.some(k => tagOf(k) !== 'w:rPr')
    return {
        left: leftHasContent ? makeElement('w:r', {}, leftKids) : null,
        right: rightHasContent ? makeElement('w:r', {}, rightKids) : null,
    }
}

/**
 * 把一个 <w:r> 的 <w:t> 子节点替换为 <w:delText>，rPr 副本保留。
 * 用于 quote 范围内"已切分好的"run（不含 w:tab 等其它子节点的特殊处理；
 * 这些子节点保留原样写入 del 内）。
 */
function convertRunToDeleteRun(runNode: Node): Node {
    const kids = childrenOf(runNode)
    const newKids: NodeArray = []
    for (const kid of kids) {
        const tag = tagOf(kid)
        if (tag === 'w:t') {
            // spec §8.3.8 输入清理：原 docx 文本理论合法，但 round-trip 后再过一道无害
            newKids.push(makeElement('w:delText', { 'xml:space': 'preserve' }, [makeText(stripIllegalXmlChars(textOf(kid)))]))
        }
        else {
            newKids.push(deepClone(kid))
        }
    }
    return makeElement('w:r', {}, newKids)
}

/**
 * 在指定段落内按 RunSplit 应用 redline 拆分：
 *  - quote 范围 run 替换为 w:delText 并 wrap 进 w:del
 *  - 起止 run 在 offset 处拆分（保留 rPr 副本）
 *  - 仅在 insId !== null 时紧邻 ins 段后插入 w:ins 包裹 suggestedClauseText
 *
 * 修改 paraNode 的子节点数组（in-place）。
 */
function applyRedlineToParagraph(input: {
    paraNode: Node
    runSplit: RunSplit
    suggestedClauseText: string | null
    delId: number
    insId: number | null
    dateIso: string
}): void {
    const { paraNode, runSplit, suggestedClauseText, delId, insId, dateIso } = input
    const tag = tagOf(paraNode)
    if (!tag) return
    const kids = paraNode[tag] as NodeArray
    if (!Array.isArray(kids)) return

    // 1. 把起始 run 拆成 [前段(外)] + [起段(内 = quote 起始)]
    const startRunNode = kids[runSplit.startRunIdx]!
    const startSplit = splitRunAtOffset(startRunNode, runSplit.startRunOffset)

    // 2. 把结尾 run 拆成 [止段(内 = quote 结尾)] + [后段(外)]
    const endRunNode = kids[runSplit.endRunIdx]!
    const endSplit = splitRunAtOffset(endRunNode, runSplit.endRunOffset)

    // 3. 收集 quote 范围内的"内"run：startSplit.right + 中间 run + endSplit.left
    //    若 startRunIdx == endRunIdx：起止同 run；正确切法是先按 endRunOffset 切，再按 startRunOffset 切左半部分
    if (runSplit.startRunIdx === runSplit.endRunIdx) {
        // 同 run：先取 [..endOffset] 再切其内 [startOffset..]
        const sameRun = startRunNode
        const upToEnd = splitRunAtOffset(sameRun, runSplit.endRunOffset)
        // upToEnd.left = 前段 + quote ；upToEnd.right = 后段
        if (upToEnd.left) {
            const inner = splitRunAtOffset(upToEnd.left, runSplit.startRunOffset)
            // inner.left = 前段；inner.right = quote
            const before = inner.left // 起始 run 之前段（外）
            const inner2 = inner.right // quote 内
            const after = upToEnd.right // 结尾 run 之后段（外）

            const newRuns: NodeArray = []
            if (before) newRuns.push(before)
            const delChildren: NodeArray = []
            if (inner2) delChildren.push(convertRunToDeleteRun(inner2))
            if (delChildren.length > 0) {
                newRuns.push(makeElement('w:del', {
                    'w:id': String(delId),
                    'w:author': REDLINE_AUTHOR,
                    'w:date': dateIso,
                }, delChildren))
            }
            if (insId != null && suggestedClauseText) {
                // 继承 quote 起始 run 的 rPr 副本作 ins 内 run 的 rPr
                const inheritRpr = inner2 ? getRPr(inner2) : null
                newRuns.push(buildInsertNode({
                    text: suggestedClauseText,
                    inheritedRpr: inheritRpr ? deepClone(inheritRpr) : null,
                    insId,
                    dateIso,
                }))
            }
            if (after) newRuns.push(after)

            kids.splice(runSplit.startRunIdx, 1, ...newRuns)
            return
        }
    }

    // 跨 run（startRunIdx < endRunIdx）
    const beforeStartRun = startSplit.left // 外
    const startInnerRun = startSplit.right // quote 起始
    const middleRuns = kids.slice(runSplit.startRunIdx + 1, runSplit.endRunIdx)
        .filter(k => tagOf(k) === 'w:r')
        .map(k => deepClone(k))
    const endInnerRun = endSplit.left // quote 结尾
    const afterEndRun = endSplit.right // 外

    const delChildren: NodeArray = []
    if (startInnerRun) delChildren.push(convertRunToDeleteRun(startInnerRun))
    for (const m of middleRuns) delChildren.push(convertRunToDeleteRun(m))
    if (endInnerRun) delChildren.push(convertRunToDeleteRun(endInnerRun))

    const newRuns: NodeArray = []
    if (beforeStartRun) newRuns.push(beforeStartRun)
    if (delChildren.length > 0) {
        newRuns.push(makeElement('w:del', {
            'w:id': String(delId),
            'w:author': REDLINE_AUTHOR,
            'w:date': dateIso,
        }, delChildren))
    }
    if (insId != null && suggestedClauseText) {
        const inheritRpr = startInnerRun ? getRPr(startInnerRun) : null
        newRuns.push(buildInsertNode({
            text: suggestedClauseText,
            inheritedRpr: inheritRpr ? deepClone(inheritRpr) : null,
            insId,
            dateIso,
        }))
    }
    if (afterEndRun) newRuns.push(afterEndRun)

    // 替换 [startRunIdx..endRunIdx] 区间为 newRuns
    kids.splice(runSplit.startRunIdx, runSplit.endRunIdx - runSplit.startRunIdx + 1, ...newRuns)
}

function buildInsertNode(input: {
    text: string
    inheritedRpr: Node | null
    insId: number
    dateIso: string
}): Node {
    const { text, inheritedRpr, insId, dateIso } = input
    // spec §8.3.8：LLM 输出可能含 U+0008 等非法 XML 控制字符，写入 OOXML 前过滤
    const safeText = stripIllegalXmlChars(text)
    const runChildren: NodeArray = []
    if (inheritedRpr) runChildren.push(inheritedRpr)
    runChildren.push(makeElement('w:t', { 'xml:space': 'preserve' }, [makeText(safeText)]))
    return makeElement('w:ins', {
        'w:id': String(insId),
        'w:author': REDLINE_AUTHOR,
        'w:date': dateIso,
    }, [makeElement('w:r', {}, runChildren)])
}

function firstRunIdx(paraNode: Node): number {
    const kids = childrenOf(paraNode)
    return kids.findIndex(k => tagOf(k) === 'w:r')
}

function lastRunIdx(paraNode: Node): number {
    const kids = childrenOf(paraNode)
    for (let i = kids.length - 1; i >= 0; i--) {
        if (tagOf(kids[i]!) === 'w:r') return i
    }
    return -1
}

function wholeParagraphRunSplit(paraNode: Node): RunSplit {
    const kids = childrenOf(paraNode)
    const startIdx = firstRunIdx(paraNode)
    const endIdx = lastRunIdx(paraNode)
    return {
        startRunIdx: startIdx,
        startRunOffset: 0,
        endRunIdx: endIdx,
        endRunOffset: computeRunLength(kids[endIdx]!),
    }
}
