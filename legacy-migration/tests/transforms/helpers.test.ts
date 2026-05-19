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
  it('按 LexSeekApi BenefitSourceType 对照表映射旧数字码', () => {
    expect(mapUserBenefitSourceType(1)).toBe('membership_gift')
    expect(mapUserBenefitSourceType(2)).toBe('redemption_code')
    expect(mapUserBenefitSourceType(3)).toBe('benefit_package')
    expect(mapUserBenefitSourceType(4)).toBe('admin_gift')
  })
  it('新库无对应的旧值（5 活动/6 试用/99 其他）回退 admin_gift', () => {
    expect(mapUserBenefitSourceType(5)).toBe('admin_gift')
    expect(mapUserBenefitSourceType(6)).toBe('admin_gift')
    expect(mapUserBenefitSourceType(99)).toBe('admin_gift')
  })
})
