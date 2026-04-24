/**
 * Word 批注稳定身份证工具。
 *
 * 身份证格式演化：
 *   Phase B（废弃）: `w:initials="LEXSEEK-{id}-{rand8}"` —— Word 会截断 initials 到
 *     9 字符 + 按 people.xml 统一同类作者 initials，导致所有 LS:* 批注的
 *     initials 全变成同一个截断值，完全失效。
 *   Phase C（废弃）: `w:author="LS:{name} [#{annotationId}-{rand8}]"` —— Word 保留
 *     author 不截断，解决了 Phase B 的问题，但无法识别"跨 review 串扰"
 *     （上传了另一份 review 的 docx 时 annotationId 可能恰好存在于当前 review 中）。
 *   **Phase C+（当前）**: `w:author="LS:{name} [#{reviewId}-{annotationId}-{rand8}]"`
 *     在身份证里把 reviewId 一起编进去，上传匹配时 assert reviewId 一致，不一致
 *     直接拒绝跨 review 串扰。
 *
 * 识别优先级（由 wordCommentParser 消费）：
 *   1. `word/customXml/annotationRefs.xml` 权威映射（Word 不篡改）
 *   2. `w:author` 尾 `[#reviewId-annotationId-rand8]`（LibreOffice 清 customXml 时兜底）
 *   3. 不再 fallback 到 w:initials 的 LEXSEEK 字面量——Word 会让它中毒（多条解析
 *      到同一 annotationId），弊大于利。改为纯人类可读的头像缩写（AI/律/客）。
 */
import { randomBytes } from 'node:crypto'

/**
 * Phase C+: `w:author` 末尾嵌入 `[#reviewId-annotationId-rand8]`。
 * 允许尾部空白（Word / WPS 保存时有可能在 author 尾追加空格、NBSP、零宽字符）。
 * 捕获组：1=reviewId, 2=annotationId, 3=rand8。
 */
const AUTHOR_REF_PATTERN = /\[#(\d+)-(\d+)-([a-zA-Z0-9]{8})\][\s\u00A0\u200B\u200C]*$/

/** DB 存的 wordCommentRef 字面量格式：`LEXSEEK-{annotationId}-{rand8}`（不含 reviewId） */
const INITIALS_REF_PATTERN = /^LEXSEEK-(\d+)-([a-zA-Z0-9]{8})$/

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/**
 * 生成 8 位随机字符。用 crypto.randomBytes 避免 Math.random() 的跨进程 / 同 tick 相关性。
 * 62^8 ≈ 2e14 的空间，测试的 deterministic seed 也不会让 rand8 重复触发冲突。
 */
function random8(): string {
    const bytes = randomBytes(8)
    let s = ''
    for (let i = 0; i < 8; i++) s += CHARS[bytes[i]! % CHARS.length]
    return s
}

/**
 * 生成 DB 存储用 wordCommentRef。同一 annotationId 多次调用产生不同 rand8。
 *
 * 注意：DB 里存的 ref 字面量**不含 reviewId**（因为 annotation 已归属于 review，
 * 存冗余没意义且不方便老数据迁移）。reviewId 仅在 export 时动态注入到 docx。
 */
export function generateWordCommentRef(annotationId: number): string {
    return `LEXSEEK-${annotationId}-${random8()}`
}

/**
 * 从 wordCommentRef 字面量中提取 random8 段。格式不对返回 null。
 */
export function extractRandomFromRef(ref: string | null | undefined): string | null {
    if (!ref) return null
    const m = ref.match(INITIALS_REF_PATTERN)
    return m ? (m[2] ?? null) : null
}

/**
 * 构造 Phase C+ 的 `w:author` 字段值。
 * 例：buildAuthorField('AI', 863, 'LEXSEEK-101-abc12345') → 'LS:AI [#863-101-abc12345]'
 *
 * **必须传 reviewId**：跨 review 上传 docx 时用来 assert 身份证归属。
 * ref 格式不合法时告警并退化为 `LS:{name}`（下游会因为解析不出 id 而进入
 * NO_ANNOTATION_MATCH 保护分支）。
 */
export function buildAuthorField(authorName: string, reviewId: number, ref: string): string {
    const m = ref.match(INITIALS_REF_PATTERN)
    if (!m) {
        logger.warn('[wordCommentRef] buildAuthorField: ref 格式异常，身份证将失效', {
            authorName,
            reviewId,
            ref,
        })
        return `LS:${authorName}`
    }
    const annotationId = m[1]
    const rand = m[2]
    return `LS:${authorName} [#${reviewId}-${annotationId}-${rand}]`
}

/**
 * 从 w:author 字段里剥掉 "LS:" 前缀和 " [#reviewId-annotationId-rand8]" 技术标识后缀，
 * 得到可落库为 annotation.authorName 的纯人名。
 *
 * **关键**：只在确认 author 里有 Phase C+ 身份证时才剥 "LS:" 前缀；
 * 否则保留 author 原值。这样：
 *   - 真·系统批注（author 有方括号） → "LS:AI [#863-101-abc]" → "AI"
 *   - 客户自定义了 displayName="LS:张" 的真·外部批注 → 保留 "LS:张" 不误伤
 */
export function stripAuthorRef(author: string | null | undefined): string {
    if (!author) return ''
    // 与 AUTHOR_REF_PATTERN 同正则，只是不锚定开头
    const tailRe = /\s*\[#\d+-\d+-[a-zA-Z0-9]{8}\][\s\u00A0\u200B\u200C]*$/
    const hadSystemRef = tailRe.test(author)
    const withoutTail = author.replace(tailRe, '')
    if (!hadSystemRef) return withoutTail
    return withoutTail.replace(/^LS:/, '')
}

/** 判断字符串是否为合法 wordCommentRef（LEXSEEK 字面量，DB 存储用） */
export function isWordCommentRef(value: string | null | undefined): boolean {
    if (!value) return false
    return INITIALS_REF_PATTERN.test(value)
}

/**
 * 解析 DB 存储的 wordCommentRef 字面量（`LEXSEEK-{id}-{rand8}`），提取 annotationId。
 * 诊断脚本 / 数据 audit 用，不用于 docx 批注匹配（后者走 parseCommentRef）。
 */
export function parseWordCommentRef(value: string | null | undefined): { annotationId: number } | null {
    if (!value) return null
    const m = value.match(INITIALS_REF_PATTERN)
    if (!m) return null
    return { annotationId: Number(m[1]) }
}

/** parseCommentRef 返回结构 */
export interface CommentRefParsed {
    reviewId: number
    annotationId: number
    /** 识别来源：用于日志/审计区分 author 和 initials 路径（customXml 路径由 parser 单独处理） */
    source: 'author'
}

/**
 * 从一条 Word comment 的 author 字段里提取 reviewId + annotationId。
 * 仅识别 Phase C+ 格式（含 reviewId）；老 Phase C 格式（无 reviewId）直接视为无效，
 * 下游会触发 NO_ANNOTATION_MATCH 保护，客户需重新下载最新版 docx。
 *
 * initials 完全不参与识别（Word 会按 people.xml 统一同类作者的 initials，
 * 解析出的 annotationId 全是第一条，是实测证实的中毒源）。
 */
export function parseCommentRef(
    author: string | null | undefined,
    _initials: string | null | undefined,
): CommentRefParsed | null {
    if (!author) return null
    const m = author.match(AUTHOR_REF_PATTERN)
    if (!m) return null
    return {
        reviewId: Number(m[1]),
        annotationId: Number(m[2]),
        source: 'author',
    }
}
