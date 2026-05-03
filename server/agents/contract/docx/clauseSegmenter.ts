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

/**
 * segmentClausesByRegex 的返回结构。
 * normalizedText 是将 \r\n 折成 \n 后的全文，与 segments 的 offsetStart/offsetEnd 同空间。
 * 调用方在写入 snapshot 时必须用 normalizedText 而非原始 fullText，保证 Phase B diff 时
 * docxText.slice(offsetStart, offsetEnd) 能精确还原 segment.text。
 */
export interface SegmentClausesResult {
    segments: ClauseSegment[]
    /** 与 segments offset 同空间的归一化文本（\r\n 已折为 \n） */
    normalizedText: string
}

/** 中文个位数字到阿拉伯数字映射 */
const CN_DIGIT: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/**
 * 将中文数字解析为阿拉伯数字（DOCX-M1：扩展到「九千九百九十九」）。
 *
 * 规则：
 *  - 单字：「一」~「九」→ 1~9，「零」→ 0
 *  - 「十」→ 10，「十X」→ 10+X，「X十」→ X*10，「X十Y」→ X*10+Y
 *  - 「X百」 / 「X百Y」 / 「X百Y十Z」/ 「X百零Y」（"零"占位） / 「百」=100
 *  - 「X千」 / 「X千Y百…」/ 「X千零Y」/ 「千」=1000
 *  - 无法解析返回 null
 *
 * 商事合同长合同条款数过百很常见（"第一百零五条"）。
 */
function cnNumToInt(cn: string): number | null {
    if (!cn) return null
    return parseCnUnder10000(cn)
}

function parseCnUnder10000(cn: string): number | null {
    if (cn === '零') return 0
    // 千位
    const qianIdx = cn.indexOf('千')
    if (qianIdx >= 0) {
        const head = cn.slice(0, qianIdx)
        const tail = cn.slice(qianIdx + 1)
        const thousands = head === '' ? 1 : (CN_DIGIT[head] ?? null)
        if (thousands === null) return null
        if (tail === '') return thousands * 1000
        // tail 可能以"零"开头表示百位为零（如 "一千零五"）
        const tailVal = tail.startsWith('零')
            ? parseCnUnder100(tail.slice(1))
            : parseCnUnder1000(tail)
        if (tailVal === null) return null
        return thousands * 1000 + tailVal
    }
    return parseCnUnder1000(cn)
}

function parseCnUnder1000(cn: string): number | null {
    if (cn === '') return 0
    if (cn === '零') return 0
    // 百位
    const baiIdx = cn.indexOf('百')
    if (baiIdx >= 0) {
        const head = cn.slice(0, baiIdx)
        const tail = cn.slice(baiIdx + 1)
        const hundreds = head === '' ? 1 : (CN_DIGIT[head] ?? null)
        if (hundreds === null) return null
        if (tail === '') return hundreds * 100
        const tailVal = tail.startsWith('零')
            ? parseCnUnder10(tail.slice(1))
            : parseCnUnder100(tail)
        if (tailVal === null) return null
        return hundreds * 100 + tailVal
    }
    return parseCnUnder100(cn)
}

function parseCnUnder100(cn: string): number | null {
    if (cn === '') return 0
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

function parseCnUnder10(cn: string): number | null {
    if (cn === '') return 0
    return CN_DIGIT[cn] ?? null
}

/** 从「第X条」标号中提取序号（阿拉伯数字）；提取失败返回 null */
function extractDiTiaoIndex(number: string): number | null {
    // 匹配「第一条」「第二条」「第一百零五条」「第一千零一条」等中文序数
    // 字符类必须含「百千」，否则商事长合同（>=100 条）的标号会被识别为标号但无法提取序号——
    // line 78-87 / 109-110 的百/千分支会变成死代码（与文件顶部注释 "（"第一百零五条"）" 设计意图冲突）
    const cnMatch = number.match(/^第([一二三四五六七八九十零百千]+)条$/)
    if (cnMatch?.[1]) {
        const v = cnNumToInt(cnMatch[1])
        if (v !== null) return v
    }
    // 匹配「第1条」「第2条」等阿拉伯数字序数
    const numMatch = number.match(/^第(\d+)条$/)
    if (numMatch?.[1]) return parseInt(numMatch[1], 10)
    return null
}

/**
 * 常用条款编号正则（按优先级组合，每组捕获"标号"）
 * `splitSentences` 也复用这三个正则识别行首子项编号作为切句点（spec §5.1）。
 */
export const RE_DI_TIAO = /(第[一二三四五六七八九十零百千0-9\.]+条)/
export const RE_NUM_DOT = /^(\d+(?:\.\d+)*\.?)\s/
export const RE_CN_COMMA = /^([一二三四五六七八九十百千]+、)/

/**
 * 按正则切分合同全文。每个 segment 包括编号及其到下一个编号（或文末）之间的全部文本。
 *
 * 混合格式处理规则：当文本同时包含「第X条」和「X.X」编号时，「X.X」只有在其整数
 * 前缀对应已识别的「第X条」序号时才被识别为子条款起点；孤立的「X.X」行（如「3.1 首付 40%」
 * 出现在没有「第三条」的文本中）会被忽略，归入上一个条款的正文。
 *
 * @param fullText 合同全文（预处理后的纯文本，允许含 \r\n）
 * @returns SegmentClausesResult，包含 segments 和与之 offset 同空间的 normalizedText
 */
export function segmentClausesByRegex(fullText: string): SegmentClausesResult {
    const lines = fullText.split(/\r?\n/)
    /** \r\n 已折为 \n 的全文，所有 offset 均以此为参照空间 */
    const normalizedText = lines.join('\n')

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
        const text = normalizedText.trim()
        if (!text) return { segments: [], normalizedText }
        // trim() 可能截掉头部空白，offsetStart 需找到 trim 后第一个字符的位置
        const offsetStart = normalizedText.indexOf(text)
        return {
            segments: [{ index: 1, number: null, text, offsetStart, offsetEnd: offsetStart + text.length }],
            normalizedText,
        }
    }

    // 预计算每行在 normalizedText 空间中的起始字符偏移
    // lines[0] 从 0 开始，lines[i] 从 lineStarts[i] 开始，行间分隔符为 1 个 '\n'
    const lineStarts: number[] = []
    let cursor = 0
    for (const line of lines) {
        lineStarts.push(cursor)
        cursor += line.length + 1 // +1 for '\n'
    }

    // 按行号切分：每个 match 到下一个 match 之前（或文末）的所有行拼起来作为 text
    const segments: ClauseSegment[] = []
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i]!.lineIdx
        const end = i + 1 < matches.length ? matches[i + 1]!.lineIdx : lines.length
        const raw = lines.slice(start, end).join('\n')
        const text = raw.trim()
        if (!text) continue

        // raw 在 normalizedText 中的起始位置
        const rawStart = lineStarts[start]!
        // trim() 可能截掉 raw 头部空白，offsetStart 是 raw 内 text 的起始相对位移
        const trimOffset = raw.indexOf(text)
        const offsetStart = rawStart + trimOffset
        segments.push({
            index: segments.length + 1,
            number: matches[i]!.number,
            text,
            offsetStart,
            offsetEnd: offsetStart + text.length,
        })
    }
    return { segments, normalizedText }
}

export interface SegmentOptions {
    /**
     * LLM 兜底策略：当正则命中 0 条或低于阈值时调用。默认不兜底。
     *
     * 要求：返回的 segments 的 offsetStart/offsetEnd 必须以 normalizedText（\r\n→\n）为空间。
     * 若 llmFallback 内部基于原始 fullText 计算 offset，需先在调用方归一化文本或转换 offset。
     */
    llmFallback?: (fullText: string) => Promise<SegmentClausesResult>
    /** 正则命中 <minRegexHits 时认为失败，触发 llmFallback。默认 3 */
    minRegexHits?: number
}

/**
 * 切分入口：正则 → 命中不足走 LLM 兜底（可选）。
 * 上层 workflow 节点应当传入 llmFallback 以提升鲁棒性。
 * 返回 SegmentClausesResult，调用方写入 snapshot 时用 normalizedText 代替原始 fullText。
 */
export async function segmentClauses(
    fullText: string,
    options: SegmentOptions = {},
): Promise<SegmentClausesResult> {
    const regexResult = segmentClausesByRegex(fullText)
    const minHits = options.minRegexHits ?? 3

    const regexHits = regexResult.segments.filter(s => s.number !== null).length
    if (regexHits >= minHits || !options.llmFallback) {
        return regexResult
    }

    logger.info('clauseSegmenter: 正则命中不足，走 LLM 兜底', {
        regexHits,
        minHits,
    })
    try {
        const llmResult = await options.llmFallback(fullText)
        if (llmResult.segments.length > 0) return llmResult
        return regexResult
    } catch (err) {
        logger.warn('clauseSegmenter: LLM 兜底失败，降级返回正则结果', { err })
        return regexResult
    }
}
