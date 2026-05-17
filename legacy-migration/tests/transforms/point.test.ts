import { describe, expect, it } from 'vitest'
import type { LPointConsumptionRecord, LPointRecord } from '../../src/legacyTypes'
import { transformPointConsumptionRecord, transformPointRecord } from '../../src/transforms/point'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformPointRecord', () => {
  it('直拷字段，新增 transferOut=0、transferToRecordId=null', () => {
    const o = {
      id: 1, userId: 1, pointAmount: 100, used: 0, remaining: 100,
      sourceType: 1, sourceId: null, userMembershipId: null,
      effectiveAt: now, expiredAt: now, settlementAt: null, status: 1, remark: null,
      createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LPointRecord
    const r = transformPointRecord(o)
    expect(r.transferOut).toBe(0)
    expect(r.transferToRecordId).toBeNull()
    expect(r.pointAmount).toBe(100)
  })
})

describe('transformPointConsumptionRecord', () => {
  it('itemId 重映射，新增 batchId=null', () => {
    const o = {
      id: 1, userId: 1, pointRecordId: 2, itemId: 5, pointAmount: 10,
      status: 1, sourceId: null, remark: null, createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LPointConsumptionRecord
    const r = transformPointConsumptionRecord(o, 30)
    expect(r).not.toBeNull()
    expect(r!.itemId).toBe(30)
    expect(r!.batchId).toBeNull()
  })
  it('itemId 重映射失败返回 null', () => {
    expect(transformPointConsumptionRecord({ id: 1, itemId: 5 } as unknown as LPointConsumptionRecord, null)).toBeNull()
  })
})
