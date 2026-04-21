/**
 * 合同条款切分器
 *
 * 功能：把合同全文按条款编号切分成 ClauseSegment[]。
 * 策略：先正则（覆盖 90%+ 场景），再 LLM 兜底（由调用方决定是否兜底，参见 segmentClauses）。
 *
 * 正则覆盖的编号格式：
 *  - 「第X条」/「第X.X条」，X 为阿拉伯数字或中文数字
 *  - 「1.」/「1.1」/「1.1.1」多级层级编号
 *  - 「一、」/「二、」中文序号
 *
 * 返回结果 index 从 1 开始连续编号。若识别失败（零个编号匹配），整篇文本作为 number=null 的单段返回。
 */
import type { ClauseSegment } from '#shared/types/contract'

/** 中文个位数字到阿拉伯数字映射 */
const CN_DIGIT: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/**
 * 将中文数字解析为阿拉伯数字，支持到九十九。
 * 规则：
 *  - 单字：「一」~「九」→ 1~9，「零」→ 0
 *  - 「十」→ 10，「十X」→ 10+X，「X十」→ X*10，「X十Y」→ X*10+Y
 *  - 无法解析返回 null
 */
function cnNumToInt(cn: string): number | null {
    if (!cn) return null
    if (cn === '十') return 10
    const tenIdx = cn.indexOf('十')
    if (tenIdx >= 0) {
        const head = cn.slice(0, tenIdx)
        const tail = cn.slice(tenIdx + 1)
        const tens = head === '' ? 1 : (CN_DIGIT[head] ?? null)
        if (tens === null) return null
        const units = tail === '' ? 0 : (CN_DIGIT[tail] ?? null)
        if (units === null) return null
        return tens * 10 + units
    }
    return CN_DIGIT[cn] ?? null
}

/** 从「第X条」标号中提取序号（阿拉伯数字）；提取失败返回 null */
function extractDiTiaoIndex(number: string): number | null {
    // 匹配「第一条」「第二条」等中文序数
    const cnMatch = number.match(/^第([一二三四五六七八九十零]+)条$/)
    if (cnMatch?.[1]) {
        const v = cnNumToInt(cnMatch[1])
        if (v !== null) return v
    }
    // 匹配「第1条」「第2条」等阿拉伯数字序数
    const numMatch = number.match(/^第(\d+)条$/)
    if (numMatch?.[1]) return parseInt(numMatch[1], 10)
    return null
}

/** 常用条款编号正则（按优先级组合，每组捕获"标号"） */
const RE_DI_TIAO = /(第[一二三四五六七八九十零百千0-9\.]+条)/
const RE_NUM_DOT = /^(\d+(?:\.\d+)*\.?)\s/
const RE_CN_COMMA = /^([一二三四五六七八九十百千]+、)/

/**
 * 按正则切分合同全文。每个 segment 包括编号及其到下一个编号（或文末）之间的全部文本。
 *
 * 混合格式处理规则：当文本同时包含「第X条」和「X.X」编号时，「X.X」只有在其整数
 * 前缀对应已识别的「第X条」序号时才被识别为子条款起点；孤立的「X.X」行（如「3.1 首付 40%」
 * 出现在没有「第三条」的文本中）会被忽略，归入上一个条款的正文。
 *
 * @param fullText 合同全文（预处理后的纯文本）
 * @returns ClauseSegment 数组；若无任何编号被匹配，返回单个 null-number 兜底段
 */
export function segmentClausesByRegex(fullText: string): ClauseSegment[] {
    const lines = fullText.split(/\r?\n/)

    // 第一遍：判断文本是否包含「第X条」格式
    let hasDiTiao = false
    for (const line of lines) {
        if ((line?.trim() ?? '').match(RE_DI_TIAO)) {
            hasDiTiao = true
            break
        }
    }

    // 第二遍：收集所有条款起点。
    // 混合格式处理：在「第X条」文本中，「X.X」只有当其整数前缀等于当前已见到的
    // 最新「第X条」序号时才识别为子条款起点（即子条款必须在父条之后出现）。
    const matches: Array<{ lineIdx: number; number: string }> = []
    let currentDiTiaoIdx: number | null = null

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim() ?? ''
        if (!line) continue

        // 「第X条」优先
        const m0 = line.match(RE_DI_TIAO)
        if (m0?.[1]) {
            currentDiTiaoIdx = extractDiTiaoIndex(m0[1])
            matches.push({ lineIdx: i, number: m0[1] })
            continue
        }

        // 「X.X」级编号：若存在「第X条」格式，则要求整数前缀等于当前父级序号
        const m1 = line.match(RE_NUM_DOT)
        if (m1?.[1]) {
            const intPrefix = parseInt(m1[1].split('.')[0]!, 10)
            if (!hasDiTiao || currentDiTiaoIdx === intPrefix) {
                matches.push({ lineIdx: i, number: m1[1].replace(/\s+$/, '') })
                continue
            }
        }

        // 「一、」中文序号
        const m2 = line.match(RE_CN_COMMA)
        if (m2?.[1]) {
            matches.push({ lineIdx: i, number: m2[1] })
        }
    }

    if (matches.length === 0) {
        // 无标号散段：整篇视为一个 segment
        const text = fullText.trim()
        if (!text) return []
        return [{ index: 1, number: null, text }]
    }

    // 按行号切分：每个 match 到下一个 match 之前（或文末）的所有行拼起来作为 text
    const segments: ClauseSegment[] = []
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i]!.lineIdx
        const end = i + 1 < matches.length ? matches[i + 1]!.lineIdx : lines.length
        const text = lines.slice(start, end).join('\n').trim()
        if (!text) continue
        segments.push({
            index: segments.length + 1,
            number: matches[i]!.number,
            text,
        })
    }
    return segments
}

export interface SegmentOptions {
    /** LLM 兜底策略：当正则命中 0 条或低于阈值时调用。默认不兜底。 */
    llmFallback?: (fullText: string) => Promise<ClauseSegment[]>
    /** 正则命中 <minRegexHits 时认为失败，触发 llmFallback。默认 3 */
    minRegexHits?: number
}

/**
 * 切分入口：正则 → 命中不足走 LLM 兜底（可选）。
 * 上层 workflow 节点应当传入 llmFallback 以提升鲁棒性。
 */
export async function segmentClauses(
    fullText: string,
    options: SegmentOptions = {},
): Promise<ClauseSegment[]> {
    const regexSegments = segmentClausesByRegex(fullText)
    const minHits = options.minRegexHits ?? 3

    const regexHits = regexSegments.filter(s => s.number !== null).length
    if (regexHits >= minHits || !options.llmFallback) {
        return regexSegments
    }

    logger.info('clauseSegmenter: 正则命中不足，走 LLM 兜底', {
        regexHits,
        minHits,
    })
    try {
        const llmSegments = await options.llmFallback(fullText)
        if (llmSegments.length > 0) return llmSegments
        return regexSegments
    } catch (err) {
        logger.warn('clauseSegmenter: LLM 兜底失败，降级返回正则结果', { err })
        return regexSegments
    }
}
