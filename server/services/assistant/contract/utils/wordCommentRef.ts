/**
 * Word 批注稳定身份证工具。
 *
 * 格式：LEXSEEK-{annotationId}-{random8}
 * - 写入 Word 的 w:initials 字段（不加 LS: 前缀）
 * - 客户端 Word 编辑不破坏此字段，回传时按格式正则匹配识别
 * - w:author 另写 'LS:<authorName>' 供客户主视图可见（见 commentInjector）
 */

const WORD_COMMENT_REF_PATTERN = /^LEXSEEK-(\d+)-[a-zA-Z0-9]{8}$/

function random8(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

/** 生成新的 wordCommentRef。同一 annotationId 多次调用产生不同 random 段 */
export function generateWordCommentRef(annotationId: number): string {
  return `LEXSEEK-${annotationId}-${random8()}`
}

/** 判断字符串是否为合法 wordCommentRef */
export function isWordCommentRef(value: string | null | undefined): boolean {
  if (!value) return false
  return WORD_COMMENT_REF_PATTERN.test(value)
}

/** 解析 wordCommentRef 获取 annotationId；格式不匹配返回 null */
export function parseWordCommentRef(value: string | null | undefined): { annotationId: number } | null {
  if (!value) return null
  const m = value.match(WORD_COMMENT_REF_PATTERN)
  if (!m) return null
  return { annotationId: Number(m[1]) }
}
