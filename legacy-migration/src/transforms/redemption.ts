import type { LRedemptionCode, LRedemptionRecord } from '../legacyTypes'
import { tsFallback } from './helpers'

/**
 * §8.1 redemption_codes：levelId 重映射；giftPoint>0 → type=3、pointAmount=giftPoint，
 * 否则 type=1、pointAmount=null；丢弃 createdBy。
 */
export function transformRedemptionCode(o: LRedemptionCode, newLevelId: number | null, migratedAt: Date) {
  if (newLevelId === null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  const hasGift = (o.giftPoint ?? 0) > 0
  return {
    id: o.id,
    code: o.code,
    type: hasGift ? 3 : 1,
    levelId: newLevelId,
    duration: o.duration,
    pointAmount: hasGift ? o.giftPoint : null,
    expiredAt: null,
    status: o.status,
    remark: o.remark,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 redemption_records：仅保留 userId/codeId/时间戳 */
export function transformRedemptionRecord(o: LRedemptionRecord, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    codeId: o.codeId,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
