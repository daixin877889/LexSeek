import { describe, expect, it } from 'vitest'
import { mapUserBenefitSourceType, tsFallback } from '../../src/transforms/helpers'

describe('tsFallback', () => {
  const now = new Date('2026-05-17T00:00:00Z')
  it('createdAt 为空时回退 updatedAt', () => {
    const r = tsFallback(null, new Date('2025-01-01T00:00:00Z'), now)
    expect(r.createdAt).toEqual(new Date('2025-01-01T00:00:00Z'))
  })
  it('两者都空时回退迁移时刻', () => {
    const r = tsFallback(null, null, now)
    expect(r.createdAt).toEqual(now)
    expect(r.updatedAt).toEqual(now)
  })
  it('updatedAt 为空时回退 createdAt', () => {
    const r = tsFallback(new Date('2025-02-02T00:00:00Z'), null, now)
    expect(r.updatedAt).toEqual(new Date('2025-02-02T00:00:00Z'))
  })
})

describe('mapUserBenefitSourceType', () => {
  it('按对照表把旧数字码映射为新字符串枚举', () => {
    expect(mapUserBenefitSourceType(1)).toBe('membership_gift')
    expect(mapUserBenefitSourceType(99)).toBe('admin_gift')
  })
})
