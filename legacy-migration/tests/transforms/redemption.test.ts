import { describe, expect, it } from 'vitest'
import type { LRedemptionCode, LRedemptionRecord } from '../../src/legacyTypes'
import { transformRedemptionCode, transformRedemptionRecord } from '../../src/transforms/redemption'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformRedemptionCode', () => {
  it('giftPoint=0 → type=1、pointAmount=null', () => {
    const o = { id: 1, code: 'C1', levelId: 3, duration: 30, status: 1, remark: null, giftPoint: 0, createdBy: 1, createdAt: now, updatedAt: now, deletedAt: null } as unknown as LRedemptionCode
    const r = transformRedemptionCode(o, 8, now)
    expect(r).not.toBeNull()
    expect(r!.type).toBe(1)
    expect(r!.pointAmount).toBeNull()
    expect(r!.levelId).toBe(8)
  })
  it('giftPoint>0 → type=3、pointAmount=giftPoint', () => {
    const o = { id: 2, code: 'C2', levelId: 3, duration: 30, status: 1, remark: null, giftPoint: 500, createdBy: 1, createdAt: now, updatedAt: now, deletedAt: null } as unknown as LRedemptionCode
    const r = transformRedemptionCode(o, 8, now)
    expect(r!.type).toBe(3)
    expect(r!.pointAmount).toBe(500)
  })
})

describe('transformRedemptionRecord', () => {
  it('仅保留 userId/codeId/时间戳', () => {
    const o = { id: 1, userId: 1, codeId: 2, redeemedAt: now, expiresAt: now, status: 1, membershipId: 5, createdAt: null, updatedAt: null, deletedAt: null } as unknown as LRedemptionRecord
    const r = transformRedemptionRecord(o, now)
    expect(r.userId).toBe(1)
    expect(r.codeId).toBe(2)
    expect(r.createdAt).toEqual(now)
    expect('status' in r).toBe(false)
  })
})
