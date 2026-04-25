import { describe, it, expect } from 'vitest'
import { mulberry32, generateUuidV4 } from './prng'

describe('mulberry32', () => {
  it('同 seed 输出确定序列', () => {
    const r1 = mulberry32(42)
    const v1 = [r1(), r1(), r1()]
    const r2 = mulberry32(42)
    const v2 = [r2(), r2(), r2()]
    expect(v1).toEqual(v2)
  })

  it('值域 [0, 1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('generateUuidV4', () => {
  it('UUID v4 格式', () => {
    const r = mulberry32(1)
    expect(generateUuidV4(r)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('同 PRNG 状态产同 UUID', () => {
    const r1 = mulberry32(42)
    const r2 = mulberry32(42)
    expect(generateUuidV4(r1)).toBe(generateUuidV4(r2))
  })
})
