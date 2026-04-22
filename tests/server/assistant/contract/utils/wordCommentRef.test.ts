import { describe, it, expect } from 'vitest'
import {
  generateWordCommentRef,
  parseWordCommentRef,
  isWordCommentRef,
} from '~~/server/services/assistant/contract/utils/wordCommentRef'

describe('wordCommentRef utils', () => {
  it('generateWordCommentRef 返回 LEXSEEK-{id}-{random8} 格式', () => {
    const ref = generateWordCommentRef(42)
    expect(ref).toMatch(/^LEXSEEK-42-[a-zA-Z0-9]{8}$/)
  })

  it('parseWordCommentRef 解析出 annotationId', () => {
    expect(parseWordCommentRef('LEXSEEK-42-abc12345')).toEqual({ annotationId: 42 })
    expect(parseWordCommentRef('invalid')).toBeNull()
    expect(parseWordCommentRef('')).toBeNull()
    expect(parseWordCommentRef(null)).toBeNull()
  })

  it('isWordCommentRef 判断是否为系统格式', () => {
    expect(isWordCommentRef('LEXSEEK-42-abc12345')).toBe(true)
    expect(isWordCommentRef('张三')).toBe(false)
    expect(isWordCommentRef('')).toBe(false)
  })

  it('同一 annotationId 每次生成 random 段不同', () => {
    const a = generateWordCommentRef(1)
    const b = generateWordCommentRef(1)
    expect(a).not.toBe(b)
  })
})
