import type { LMembershipUpgradeRecord, LUserMembership } from '../legacyTypes'
import { tsFallback } from './helpers'

/** §8.1 user_memberships：levelId 重映射；sourceType null→99；autoRenew null→false */
export function transformUserMembership(o: LUserMembership, newLevelId: number | null, migratedAt: Date) {
  if (newLevelId === null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    levelId: newLevelId,
    startDate: o.startDate,
    endDate: o.endDate,
    autoRenew: o.autoRenew ?? false,
    status: o.status,
    settlementAt: null,
    sourceType: o.sourceType ?? 99,
    sourceId: o.sourceId,
    remark: null,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.1 membership_upgrade_records：paymentOrderId→orderId；
 * toMembershipId 或 paymentOrderId 为 null 时返回 null（迁移器跳过 + 异常清单）；
 * pointCompensation null→0；丢弃 fromLevelId/toLevelId/originalRemainingDays/status。
 */
export function transformMembershipUpgradeRecord(o: LMembershipUpgradeRecord, migratedAt: Date) {
  if (o.toMembershipId == null || o.paymentOrderId == null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    fromMembershipId: o.fromMembershipId,
    toMembershipId: o.toMembershipId,
    orderId: o.paymentOrderId,
    upgradePrice: o.upgradePrice,
    pointCompensation: o.pointCompensation ?? 0,
    transferPoints: 0,
    details: undefined,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
