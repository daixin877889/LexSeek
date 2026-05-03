/**
 * 文本相似度共享工具。
 *
 * clauseDiff / anchorMigrate 之前各自 new diff_match_patch() 计算 Levenshtein，
 * 此处统一一份共享 dmp 实例（fxp 风格的"全局单例 + 纯函数 API"），避免重复造轮子。
 *
 * 注意：dmp 的 diff_main 不是无副作用的（内部用 Match_Threshold / Match_Distance 等
 * 实例属性），但本模块只读不改这些参数，多调用方共享一个实例是安全的。
 */
import { diff_match_patch } from 'diff-match-patch'

const dmp = new diff_match_patch()

export function getDmp() {
    return dmp
}

/**
 * 基于 Levenshtein 距离计算两段文本的相似度（0~1）。
 *  - 完全相同返回 1
 *  - 都为空返回 1（无内容差异）
 *  - 否则 1 - distance / maxLen
 */
export function calcSimilarity(a: string, b: string): number {
    if (a === b) return 1
    const maxLen = Math.max(a.length, b.length)
    if (maxLen === 0) return 1
    const diffs = dmp.diff_main(a, b)
    dmp.diff_cleanupSemantic(diffs)
    const distance = dmp.diff_levenshtein(diffs)
    return 1 - distance / maxLen
}

/**
 * 中英文标点 / 全角半角归一映射表。
 * 用于锚点匹配时规避"客户端是中文标点、docx 里是英文标点"等等价差异。
 */
export const PUNCT_NORMALIZE_MAP: Record<string, string> = {
    '“': '"', '”': '"', '„': '"', '‟': '"',
    '‘': "'", '’': "'", '‚': "'", '‛': "'",
    '，': ',', '。': '.', '；': ';', '：': ':',
    '（': '(', '）': ')', '【': '[', '】': ']',
    '《': '<', '》': '>',
    '？': '?', '！': '!',
    '、': ',',
    '—': '-', '–': '-', '－': '-', '─': '-',
    '…': '...',
    '　': ' ', // 全角空格
    ' ': ' ', // 非断行空格
}

/**
 * 锚点匹配文本规范化：
 * 1. NFKC Unicode 标准化（半角化字母数字、合成字符拆解）
 * 2. 中英文标点统一为英文标点
 * 3. 多个空白压缩成单个空格
 * 4. trim 首尾空白
 *
 * 注意：仅在锚点匹配时使用；写回 docx / DB 的原文必须用规范化前的字符串，
 * 避免破坏客户原稿的标点风格。
 */
export function normalizeForMatch(text: string): string {
    if (!text) return ''
    const nfkc = text.normalize('NFKC')
    let out = ''
    for (const ch of nfkc) {
        out += PUNCT_NORMALIZE_MAP[ch] ?? ch
    }
    return out.replace(/\s+/g, ' ').trim()
}

/**
 * 用 diff-match-patch 的 Bitap 算法找 pattern 在 text 内最相似 substring 的起点 offset。
 *
 * **关键约束**（diff-match-patch 官方文档 + npm 源码 index.js:1461-1463 / 39 / 43 / 53 核对）：
 *  - `Match_MaxBits = 32`：pattern.length > 32 时 `match_main` **抛 throw `"Pattern too long for this browser."`**
 *    （**不是**返回 -1）；本函数先截前 32 字符做 anchor locate 规避，end 按调用方期望
 *    的 pattern.length 推算回去。
 *  - `Match_Threshold` 默认 0.5；合同场景**硬编**压到 0.3 兼顾精度（YAGNI：当前所有调用点都不需要可配）。
 *  - `Match_Distance` 默认 1000；本函数保持 1000，但先用 `indexOf` 找精确 loc 作为 Bitap 起点提示，
 *    避免 loc=0 时对超长文档末尾产生过高的距离惩罚。直接设为 text.length 在临界值附近有浮点精度问题。
 *  - `match_main` 找到时返回起点 offset（number，0-based），找不到返回 **`-1`**（不是 null）。
 *  - 中文 BMP 字符 1 字 = 1 UTF-16 code unit，offset 即字符 offset。
 *
 * **共享单例参数恢复**：`getDmp()` 是全局单例，`calcSimilarity` / `anchorMigrate.findBestSubstring`
 * 等其他调用方依赖默认 Match_Threshold / Match_Distance；本函数 try/finally 保存/恢复
 * 这两个参数避免污染。
 *
 * **不做标点归一化**：`normalizeForMatch` 含 1→3 字符（如 `…` → `...`）+ 多空白折叠 + trim，
 * 不是 1:1 字符替换；归一化后 offset 与原文不对齐。dmp.match_main 的 Bitap fuzzy 容错本身
 * 已能处理标点小差异（中文逗号 `,` vs 英文 `,` 在 Match_Threshold=0.3 下仍可命中），不再叠归一化。
 *
 * @param text 全文
 * @param pattern 待定位的子串
 * @returns 命中时返回 `{ start, end }`（end = min(start + pattern.length, text.length)）；找不到返回 null
 */
export function fuzzyLocateInText(
    text: string,
    pattern: string,
): { start: number; end: number } | null {
    const MAX_PATTERN = 32
    if (pattern.length === 0 || text.length === 0) return null

    const dmpInst = getDmp()
    const savedThreshold = dmpInst.Match_Threshold
    const savedDistance = dmpInst.Match_Distance
    try {
        dmpInst.Match_Threshold = 0.3
        // Match_Distance 控制 Bitap 算法相对于 loc 的距离惩罚。
        // 固定 1000 配合精确 loc 提示足以覆盖标点小偏移；
        // 不设为 text.length，因为浮点精度在临界值附近会导致命中失败。
        dmpInst.Match_Distance = 1000

        // pattern > 32 会抛 throw → 必须用前 32 字符做 anchor locate，按 pattern.length 推算 end
        const probe = pattern.length <= MAX_PATTERN ? pattern : pattern.slice(0, MAX_PATTERN)

        // 先用 indexOf 快速定位精确命中位置作为 loc 提示，避免 Bitap 距离惩罚跨越超长文档
        const hintLoc = text.indexOf(probe)
        const loc = hintLoc !== -1 ? hintLoc : 0
        const start = dmpInst.match_main(text, probe, loc)
        if (start === -1) return null
        return { start, end: Math.min(start + pattern.length, text.length) }
    }
    finally {
        dmpInst.Match_Threshold = savedThreshold
        dmpInst.Match_Distance = savedDistance
    }
}
