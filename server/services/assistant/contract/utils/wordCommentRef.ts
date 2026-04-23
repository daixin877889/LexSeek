/**
 * Word 批注稳定身份证工具。
 *
 * 原格式 `LEXSEEK-{id}-{rand8}` 写入 `w:initials` 被实测证明不可靠——
 * Microsoft Word 打开保存后会把 `w:initials` 截断到 ~9 字符，并按
 * `people.xml` 规则把同一类作者的 initials 统一成同一值，导致所有
 * 系统批注的 initials 全变成同一个截断值（如 "LEXSEEK-3"），
 * 无法再恢复各条 annotation 的 id。
 *
 * **Phase C 方案**（当前）：ref 写入 `w:author` 末尾的方括号段
 * `w:author = "LS:{authorName} [#{annotationId}-{rand8}]"`，
 * Word 保证每条 comment 的 author 独立保留、不截断。
 *
 * 向后兼容：parseWordCommentRef 依次尝试
 *   1. author 里的 `[#{id}-{rand8}]`（Phase C，主通路）
 *   2. initials 里的 `LEXSEEK-{id}-{rand8}`（Phase B 未被 Word 截断的情况，
 *      如 LibreOffice / WPS 另存）
 * 两种都能识别成功。
 */

/**
 * Phase C：w:author 末尾嵌入的稳定身份证。
 * 允许尾部空白（Word / WPS 保存时有可能在 author 尾追加空格或 NBSP），
 * 否则任何轻微篡改都会让 parser 退到二级兜底。
 */
const AUTHOR_REF_PATTERN = /\[#(\d+)-([a-zA-Z0-9]{8})\][\s\u00A0\u200B\u200C]*$/
/** Phase B：w:initials 里的老格式，仅作 fallback（两个捕获组：id + rand8） */
const INITIALS_REF_PATTERN = /^LEXSEEK-(\d+)-([a-zA-Z0-9]{8})$/

function random8(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

/**
 * 生成新的 wordCommentRef。同一 annotationId 多次调用产生不同 random 段。
 * 沿用 `LEXSEEK-{id}-{rand8}` 字面量便于日志/DB 查询直觉；实际写入位置由
 * commentInjector 决定（当前：`w:author` 后缀 + `w:initials` 冗余）。
 */
export function generateWordCommentRef(annotationId: number): string {
  return `LEXSEEK-${annotationId}-${random8()}`
}

/**
 * 从 wordCommentRef 字面量中提取 random8 段（写入 w:author 后缀用）。
 * 格式不对返回 null。
 */
export function extractRandomFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null
  const m = ref.match(INITIALS_REF_PATTERN)
  return m ? (m[2] ?? null) : null
}

/**
 * 构造 Phase C 的 `w:author` 字段值。
 * 例：buildAuthorField('AI', 'LEXSEEK-3-abc12345') → 'LS:AI [#3-abc12345]'
 */
export function buildAuthorField(authorName: string, ref: string): string {
  const m = ref.match(INITIALS_REF_PATTERN)
  if (!m) return `LS:${authorName}`
  const id = m[1]
  const rand = m[2]
  return `LS:${authorName} [#${id}-${rand}]`
}

/**
 * 从 w:author 字段里剥掉 "LS:" 前缀和 " [#id-rand8]" 技术标识后缀，
 * 得到可落库为 annotation.authorName 的纯人名。
 *
 * **关键**：只在确认 author 里有 Phase C 身份证（方括号段）时才剥 "LS:" 前缀；
 * 否则保留 author 原值。这样：
 *   - 真·系统批注（author 有方括号） → "LS:AI [#101-abc]" → "AI"
 *   - 客户自定义了 displayName="LS:张" 的真·外部批注 → 保留 "LS:张" 不误伤
 *   - 客户 author 为空 → 返回空串（调用方自行用兜底默认名）
 */
export function stripAuthorRef(author: string | null | undefined): string {
  if (!author) return ''
  const tailRe = /\s*\[#\d+-[a-zA-Z0-9]{8}\][\s\u00A0\u200B\u200C]*$/
  const hadSystemRef = tailRe.test(author)
  const withoutTail = author.replace(tailRe, '')
  if (!hadSystemRef) return withoutTail // 非系统批注，保留原 author
  return withoutTail.replace(/^LS:/, '')
}

/** 判断字符串是否为合法 wordCommentRef（LEXSEEK 字面量） */
export function isWordCommentRef(value: string | null | undefined): boolean {
  if (!value) return false
  return INITIALS_REF_PATTERN.test(value)
}

/**
 * 从一条 Word comment 的 author + initials 双字段里提取 annotationId。
 * 优先 author（Phase C，Word 不截断），fallback initials（Phase B 老导出）。
 */
export function parseCommentRef(
  author: string | null | undefined,
  initials: string | null | undefined,
): { annotationId: number } | null {
  if (author) {
    const m = author.match(AUTHOR_REF_PATTERN)
    if (m) return { annotationId: Number(m[1]) }
  }
  if (initials) {
    const m = initials.match(INITIALS_REF_PATTERN)
    if (m) return { annotationId: Number(m[1]) }
  }
  return null
}

/**
 * 兼容老调用签名（仅按 initials 解析 LEXSEEK 字面量）。
 * 仅用于需要单独测试 initials 格式的场景，生产匹配逻辑应走 parseCommentRef。
 */
export function parseWordCommentRef(value: string | null | undefined): { annotationId: number } | null {
  if (!value) return null
  const m = value.match(INITIALS_REF_PATTERN)
  if (!m) return null
  return { annotationId: Number(m[1]) }
}
