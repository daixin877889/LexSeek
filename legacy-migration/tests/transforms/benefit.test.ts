import { describe, expect, it } from 'vitest'
import type { LUserBenefit } from '../../src/legacyTypes'
import { transformUserBenefit } from '../../src/transforms/benefit'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformUserBenefit', () => {
  it('benefitValue Decimal→BigInt 取整，sourceType Int→String，effectiveAt/expiredAt 兜底', () => {
    const o = {
      id: 1, userId: 1, benefitId: 2, benefitValue: { toString: () => '1024.50' },
      unit: 'MB', consumedValue: 0, remainingValue: 0, status: 1,
      sourceType: 1, sourceId: null, effectiveAt: null, expiredAt: null, remark: null,
      createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LUserBenefit
    const r = transformUserBenefit(o, 9, now)
    expect(r).not.toBeNull()
    expect(r!.benefitId).toBe(9)
    expect(r!.benefitValue).toBe(1025n)
    expect(r!.sourceType).toBe('membership_gift')
    expect(r!.effectiveAt).toEqual(now)
    expect(r!.expiredAt).toEqual(new Date('2099-12-31T00:00:00Z'))
  })
})
