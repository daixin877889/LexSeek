import type { LPointConsumptionRecord, LPointRecord } from '../legacyTypes'

/** §8.1 point_records：直拷，新增 transferOut=0、transferToRecordId=null。旧库 createdAt/updatedAt 必填，直拷 */
export function transformPointRecord(o: LPointRecord) {
  return {
    id: o.id,
    userId: o.userId,
    pointAmount: o.pointAmount,
    used: o.used,
    remaining: o.remaining,
    sourceType: o.sourceType,
    sourceId: o.sourceId,
    userMembershipId: o.userMembershipId,
    effectiveAt: o.effectiveAt,
    expiredAt: o.expiredAt,
    settlementAt: o.settlementAt,
    status: o.status,
    transferOut: 0,
    transferToRecordId: null,
    remark: o.remark,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 point_consumption_records：itemId 重映射；新增 batchId=null。旧 createdAt/updatedAt 必填 */
export function transformPointConsumptionRecord(o: LPointConsumptionRecord, newItemId: number | null) {
  if (newItemId === null) return null
  return {
    id: o.id,
    userId: o.userId,
    pointRecordId: o.pointRecordId,
    itemId: newItemId,
    batchId: null,
    pointAmount: o.pointAmount,
    status: o.status,
    sourceId: o.sourceId,
    remark: o.remark,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
