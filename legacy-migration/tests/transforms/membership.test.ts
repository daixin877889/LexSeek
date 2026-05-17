import { describe, expect, it } from 'vitest'
import type { LMembershipUpgradeRecord, LUserMembership } from '../../src/legacyTypes'
import { transformMembershipUpgradeRecord, transformUserMembership } from '../../src/transforms/membership'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformUserMembership', () => {
  it('levelId 重映射，sourceType 为 null 兜底 99，autoRenew 为 null 兜底 false', () => {
    const o = {
      id: 1, userId: 1, levelId: 3, startDate: now, endDate: now,
      autoRenew: null, status: 1, sourceType: null, sourceId: null,
      createdAt: null, updatedAt: null, deletedAt: null,
      upgradedFromId: null, upgradedToId: null, upgradePrice: null, isUpgrade: false,
    } as unknown as LUserMembership
    const r = transformUserMembership(o, 8, now)
    expect(r).not.toBeNull()
    expect(r!.levelId).toBe(8)
    expect(r!.sourceType).toBe(99)
    expect(r!.autoRenew).toBe(false)
    expect(r!.createdAt).toEqual(now)
  })
  it('levelId 重映射失败返回 null', () => {
    const o = { id: 1, levelId: 3 } as unknown as LUserMembership
    expect(transformUserMembership(o, null, now)).toBeNull()
  })
})

describe('transformMembershipUpgradeRecord', () => {
  it('toMembershipId / paymentOrderId 任一为 null 返回 null（跳过）', () => {
    const o = { id: 1, toMembershipId: null, paymentOrderId: 5 } as unknown as LMembershipUpgradeRecord
    expect(transformMembershipUpgradeRecord(o, now)).toBeNull()
  })
  it('pointCompensation 为 null 兜底 0，paymentOrderId→orderId', () => {
    const o = {
      id: 1, userId: 1, fromMembershipId: 2, toMembershipId: 3,
      paymentOrderId: 9, upgradePrice: '10.00', pointCompensation: null,
      createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LMembershipUpgradeRecord
    const r = transformMembershipUpgradeRecord(o, now)
    expect(r).not.toBeNull()
    expect(r!.orderId).toBe(9)
    expect(r!.pointCompensation).toBe(0)
    expect(r!.transferPoints).toBe(0)
  })
})
