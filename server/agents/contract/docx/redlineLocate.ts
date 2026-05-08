/**
 * 在 OOXML 段落数组里定位 quote 字符段对应的「段落区间 + 起止 run + run 内偏移」。
 *
 * 输入约定（PR3 落地）：
 *  - clauseText：完整条款原文，可含 `\n` 表示跨多段（segmentClauses 用 \n 连接 lines）
 *  - quoteCharStart/End：相对 clauseText 的字符 offset（不是文档全文）
 *  - clauseParagraphIndex：clauseText 起始段在 collectNonEmptyParagraphs 数组里的索引
 *
 * 字符等价性（textContent 累加规则，与 docxPreview spec §7.3.2 对齐）：
 *  - <w:t> 文本 → 字面字符
 *  - <w:tab/> → 1 字符（合同 clauseText 里 tab 也是 \t 单字符）
 *  - <w:br/> → 0 字符（不算字符 offset）
 *  - 其它 run 子节点（w:rPr 等）→ 0 字符
 *
 * 失败返回 null：clauseParagraphIndex 越界 / quote 越界 clauseText / 段落 textContent
 * 与 clauseText 不一致（迁移残留）/ 累加未命中。
 */
import {
    childrenOf,
    tagOf,
    textOf,
    type Node,
} from './xmlAst'

export interface RunSplit {
    /** quote 起始 run 在段落 kids 数组里的下标（不计 w:pPr 等头部，但下游用 kids 数组下标） */
    startRunIdx: number
    /** quote 起始 run 内的字符偏移（指向 quote 第一个字符） */
    startRunOffset: number
    /** quote 结尾 run 在段落 kids 数组里的下标 */
    endRunIdx: number
    /** quote 结尾 run 内的字符偏移（exclusive，指向 quote 之后第一个字符） */
    endRunOffset: number
}

export interface QuoteLocation {
    /** quote 起始段在 nonEmptyParagraphs 里的索引 */
    startParaIdx: number
    /** quote 结尾段在 nonEmptyParagraphs 里的索引 */
    endParaIdx: number
    /**
     * 起止段的 run 拆分点：
     *  - 起始段（i==startParaIdx）：runSplit 表示 quote 的"起始 run + offset"，
     *    endRunIdx/endRunOffset 表示该段内 quote 的结束（同段时 == 整 quote 终点；跨段时 == 段落末尾）
     *  - 中间段（startParaIdx < i < endParaIdx）：runSplit==null（整段全删）
     *  - 结尾段（i==endParaIdx）：runSplit.startRunIdx=0/startRunOffset=0，
     *    endRunIdx/endRunOffset 是 quote 的真实终点
     */
    splits: Array<{ paraIdx: number, runSplit: RunSplit | null }>
}

interface RunHit {
    runIdx: number
    runOffset: number
}

/**
 * 段落里按 textContent 累加 charOffset，找 (runIdx, runOffset)。
 *
 * bias='start'（quote 起点）：用严格 `>`——边界处偏向后一个 run（避免落在前一 run 末尾的空段）。
 * bias='end'（quote 终点 exclusive）：用 `>=`——边界处偏向前一个 run（避免落在后一 run 起点的空段）。
 *
 * 越界返回 null。允许 charOffset == paraTextLength（指向段末，作为 endOffset 合法）。
 */
function findRunOffsetInParagraph(paraNode: Node, charOffset: number, bias: 'start' | 'end'): RunHit | null {
    const kids = childrenOf(paraNode)
    let consumed = 0
    for (let runIdx = 0; runIdx < kids.length; runIdx++) {
        const kid = kids[runIdx]!
        if (tagOf(kid) !== 'w:r') continue
        const runLen = computeRunLength(kid)
        const matches = bias === 'start'
            ? consumed + runLen > charOffset
            : consumed + runLen >= charOffset
        if (matches) {
            return { runIdx, runOffset: charOffset - consumed }
        }
        consumed += runLen
    }
    if (charOffset === consumed) {
        // 指向段末（exclusive 结束位置允许落到最后一个 run 的 runLen）
        for (let runIdx = kids.length - 1; runIdx >= 0; runIdx--) {
            if (tagOf(kids[runIdx]!) === 'w:r') {
                return { runIdx, runOffset: computeRunLength(kids[runIdx]!) }
            }
        }
    }
    return null
}

/**
 * 段内按"run 规则"取文本内容（w:t 字面 / w:tab → '\t' / w:br → ''）。
 * 用于 clauseText 与段落 textContent 的一致性校验。
 */
function paragraphTextWithRunRule(paraNode: Node): string {
    let s = ''
    for (const kid of childrenOf(paraNode)) {
        if (tagOf(kid) !== 'w:r') continue
        for (const grand of childrenOf(kid)) {
            const t = tagOf(grand)
            if (t === 'w:t') s += textOf(grand)
            else if (t === 'w:tab') s += '\t'
        }
    }
    return s
}

/**
 * 段内单 run 的字符长度（w:t 字面 / w:tab=1 / w:br=0）。
 * export：redlineInjector「整段删除判定」/「wholeParagraphRunSplit」复用同口径。
 */
export function computeRunLength(runNode: Node): number {
    let len = 0
    for (const kid of childrenOf(runNode)) {
        const t = tagOf(kid)
        if (t === 'w:t') len += textOf(kid).length
        else if (t === 'w:tab') len += 1
        // w:br / w:rPr / 其它子节点 0 字符
    }
    return len
}

/**
 * 段内全部 w:r 累加文本长度。export 与 computeRunLength 同意图，redlineInjector 复用。
 */
export function paragraphTextLengthByRunRule(paraNode: Node): number {
    let len = 0
    for (const kid of childrenOf(paraNode)) {
        if (tagOf(kid) !== 'w:r') continue
        len += computeRunLength(kid)
    }
    return len
}

export function locateQuoteInParagraphs(input: {
    nonEmptyParagraphs: Node[]
    clauseText: string
    clauseParagraphIndex: number
    quoteCharStart: number
    quoteCharEnd: number
}): QuoteLocation | null {
    const { nonEmptyParagraphs, clauseText, clauseParagraphIndex, quoteCharStart, quoteCharEnd } = input

    // 边界：quote 越界 clauseText
    if (quoteCharStart < 0 || quoteCharEnd > clauseText.length || quoteCharStart >= quoteCharEnd) return null

    // 拆 clauseText 行 + 累加每行起止
    const lines = clauseText.split('\n')
    const linePositions: Array<{ start: number, end: number }> = []
    let cursor = 0
    for (const line of lines) {
        linePositions.push({ start: cursor, end: cursor + line.length })
        cursor += line.length + 1 // +1 是 \n
    }

    // 找 quote 起止落在哪些行 + 行内 offset
    const startHit = locateInLines(linePositions, quoteCharStart)
    const endHitRaw = locateInLines(linePositions, quoteCharEnd)
    if (!startHit || !endHitRaw) return null
    // endHit 落在行起点（即 quote 正好在前一行末尾结束）时，归到前一行末尾以避免空尾段
    let endHit = endHitRaw
    if (endHit.lineIdx > startHit.lineIdx && endHit.lineOffset === 0) {
        endHit = { lineIdx: endHit.lineIdx - 1, lineOffset: lines[endHit.lineIdx - 1]!.length }
    }

    // 起止段在 OOXML 段落里的索引
    const startParaIdx = clauseParagraphIndex + startHit.lineIdx
    const endParaIdx = clauseParagraphIndex + endHit.lineIdx
    if (startParaIdx < 0 || endParaIdx >= nonEmptyParagraphs.length) return null

    const splits: QuoteLocation['splits'] = []

    if (startParaIdx === endParaIdx) {
        // 同段
        const para = nonEmptyParagraphs[startParaIdx]!
        // 严格一致性校验：段落 textContent 必须等于 clauseText 该行（迁移残留 / OCR 漂移时拒绝定位）
        if (paragraphTextWithRunRule(para) !== lines[startHit.lineIdx]) return null
        const startRun = findRunOffsetInParagraph(para, startHit.lineOffset, 'start')
        const endRun = findRunOffsetInParagraph(para, endHit.lineOffset, 'end')
        if (!startRun || !endRun) return null
        splits.push({
            paraIdx: startParaIdx,
            runSplit: {
                startRunIdx: startRun.runIdx,
                startRunOffset: startRun.runOffset,
                endRunIdx: endRun.runIdx,
                endRunOffset: endRun.runOffset,
            },
        })
    }
    else {
        // 跨段：起始段
        const startPara = nonEmptyParagraphs[startParaIdx]!
        if (paragraphTextWithRunRule(startPara) !== lines[startHit.lineIdx]) return null
        const startParaLen = paragraphTextLengthByRunRule(startPara)
        const sStart = findRunOffsetInParagraph(startPara, startHit.lineOffset, 'start')
        const sEnd = findRunOffsetInParagraph(startPara, startParaLen, 'end')
        if (!sStart || !sEnd) return null
        splits.push({
            paraIdx: startParaIdx,
            runSplit: {
                startRunIdx: sStart.runIdx,
                startRunOffset: sStart.runOffset,
                endRunIdx: sEnd.runIdx,
                endRunOffset: sEnd.runOffset,
            },
        })

        // 中间段（全删）
        for (let i = startParaIdx + 1; i < endParaIdx; i++) {
            const midPara = nonEmptyParagraphs[i]!
            const lineIdx = i - clauseParagraphIndex
            if (paragraphTextWithRunRule(midPara) !== lines[lineIdx]) return null
            splits.push({ paraIdx: i, runSplit: null })
        }

        // 结尾段
        const endPara = nonEmptyParagraphs[endParaIdx]!
        if (paragraphTextWithRunRule(endPara) !== lines[endHit.lineIdx]) return null
        const eStart = findRunOffsetInParagraph(endPara, 0, 'start')
        const eEnd = findRunOffsetInParagraph(endPara, endHit.lineOffset, 'end')
        if (!eStart || !eEnd) return null
        splits.push({
            paraIdx: endParaIdx,
            runSplit: {
                startRunIdx: eStart.runIdx,
                startRunOffset: eStart.runOffset,
                endRunIdx: eEnd.runIdx,
                endRunOffset: eEnd.runOffset,
            },
        })
    }

    return { startParaIdx, endParaIdx, splits }
}

function locateInLines(
    linePositions: Array<{ start: number, end: number }>,
    charOffset: number,
): { lineIdx: number, lineOffset: number } | null {
    for (let i = 0; i < linePositions.length; i++) {
        const lp = linePositions[i]!
        // 包含起点（inclusive）+ 包含终点（inclusive，以便 endOffset 落到行末）
        if (charOffset >= lp.start && charOffset <= lp.end) {
            return { lineIdx: i, lineOffset: charOffset - lp.start }
        }
    }
    return null
}
