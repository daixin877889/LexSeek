/**
 * 中文合同条款内部断句（spec §5.1）。
 *
 * 在一个 segment 内部继续切成 [Sn] 编号的子句视图，给 LLM 看 / 给服务端解析
 * problemSentenceIds → charStart/charEnd。1-based id 与 LLM prompt 视图对齐。
 *
 * 切分点：
 *  - 标点：。！？；和换行符 \n
 *  - 行首子项编号：复用 clauseSegmenter.ts 的 RE_DI_TIAO / RE_NUM_DOT / RE_CN_COMMA
 *
 * 不切：中文逗号，顿号、；引号内（中文双引号 / 中文单引号 / ASCII 单引号）
 *       括号 ()（）内的标点
 *
 * 边角：
 *  - 空字符串 → []
 *  - 整段无切分点 → 整段作 1 个 sentence
 *  - 仅 1 个标点（如 "。"）→ 切出 1 个空 text 的 sentence
 */
import { RE_DI_TIAO, RE_NUM_DOT, RE_CN_COMMA } from '../docx/clauseSegmenter'

export interface SentenceSpan {
    /** 1-based ID，给 LLM prompt 用 */
    id: number
    /** 句子文本（已 trim 首尾空白；可能为空字符串，例如仅含切分标点的边角） */
    text: string
    /** 在 segmentText 内的 0-based offset（含切分标点本身） */
    charStart: number
    /** exclusive */
    charEnd: number
}

/** 句子切分标点（不含逗号、顿号） */
const SENTENCE_TERMINATORS = new Set(['。', '！', '？', '；', '\n'])

/**
 * 开括号/引号 → 对应的关闭符。
 * 注意：esbuild/vitest 在处理 TS 文件时，\u 转义序列在某些上下文会被解析为 ASCII 对应字符，
 * 必须用 String.fromCodePoint() 显式构造 unicode 字符，确保运行时正确匹配。
 */
const QUOTE_OPEN_TO_CLOSE = new Map<string, string>([
    [String.fromCodePoint(0x201c), String.fromCodePoint(0x201d)], // " → "  中文左右双引号
    [String.fromCodePoint(0x2018), String.fromCodePoint(0x2019)], // ' → '  中文左右单引号
    ["'", "'"],           // ' → '  ASCII 单引号（对称）
    ['"', '"'],           // " → "  ASCII 双引号（对称）
    [String.fromCodePoint(0x300c), String.fromCodePoint(0x300d)], // 「 → 」 日文引号
    ['(', ')'],
    [String.fromCodePoint(0xff08), String.fromCodePoint(0xff09)],  // （ → ）全角括号
])

/**
 * 判断 segmentText 在 lineStart 位置是否以行首子项编号开头。
 * 匹配成功返回该编号字符串长度（含尾部空格），失败返回 0。
 * 复用 clauseSegmenter 三个正则，保证识别规则一致。
 */
function detectLeadingNumberLength(segmentText: string, lineStart: number): number {
    const tail = segmentText.slice(lineStart)
    // 「X.X 」/ 「X.X.X 」数字序号
    const numDot = tail.match(RE_NUM_DOT)
    if (numDot?.[1]) return numDot[0]!.length
    // 「一、」中文序号
    const cnComma = tail.match(RE_CN_COMMA)
    if (cnComma?.[1]) return cnComma[0]!.length
    // 「第X条」——正则自身不锚定行首，手动判断 tail 是否以匹配开头
    const diTiao = tail.match(RE_DI_TIAO)
    if (diTiao && tail.startsWith(diTiao[0]!)) return diTiao[0]!.length
    return 0
}

export function splitSentences(segmentText: string): SentenceSpan[] {
    if (segmentText.length === 0) return []

    const result: SentenceSpan[] = []
    /** 当前句子的起始 offset */
    let cursor = 0
    /** 嵌套引号 / 括号栈，存关闭符 */
    const quoteStack: string[] = []
    /** 标记下一个字符是否在行首（\n 之后或 i=0） */
    let atLineStart = true

    /** 将 [cursor, charEnd) 区间 flush 成一个 SentenceSpan */
    const flush = (charEnd: number) => {
        const slice = segmentText.slice(cursor, charEnd)
        // text：去掉首尾空白 + 末尾切分标点（保留 charEnd 仍含标点，使 offset 连续可还原）
        const trimmed = slice.replace(/^\s+|[。！？；\n\s]+$/g, '')
        result.push({ id: result.length + 1, text: trimmed, charStart: cursor, charEnd })
        cursor = charEnd
    }

    for (let i = 0; i < segmentText.length; i++) {
        const ch = segmentText[i]!

        // 1. 引号 / 括号：关闭符弹栈
        if (quoteStack.length > 0 && ch === quoteStack[quoteStack.length - 1]) {
            quoteStack.pop()
            if (ch === '\n') atLineStart = true
            else atLineStart = false
            continue
        }

        // 2. 引号 / 括号：开符压栈
        const closeChar = QUOTE_OPEN_TO_CLOSE.get(ch)
        if (closeChar !== undefined) {
            quoteStack.push(closeChar)
            atLineStart = false
            continue
        }

        // 3. 在引号 / 括号内：所有标点都不切
        if (quoteStack.length > 0) {
            if (ch === '\n') atLineStart = true
            else atLineStart = false
            continue
        }

        // 4. 行首子项编号：作为新句子的起点（把前面的内容先 flush）
        if (atLineStart && i > cursor) {
            const len = detectLeadingNumberLength(segmentText, i)
            if (len > 0) {
                flush(i)
                atLineStart = false
                continue
            }
        }

        // 5. 切分标点
        if (SENTENCE_TERMINATORS.has(ch)) {
            flush(i + 1)          // charEnd 含切分标点本身
            atLineStart = ch === '\n'
            continue
        }

        atLineStart = false
    }

    // 兜底：剩余尾部内容
    if (cursor < segmentText.length) {
        flush(segmentText.length)
    }

    return result
}
