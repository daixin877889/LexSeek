import type { LUserBenefit } from '../legacyTypes'
import { mapUserBenefitSourceType, tsFallback } from './helpers'

/** 长期有效的兜底过期时间（设计文档 §9） */
const FAR_FUTURE = new Date('2099-12-31T00:00:00Z')

/**
 * §8.1 user_benefits：benefitId 重映射；benefitValue Decimal→BigInt 取整；
 * sourceType Int→String；effectiveAt null→createdAt、expiredAt null→2099-12-31；
 * 丢弃 consumedValue/remainingValue/unit。
 */
export function transformUserBenefit(o: LUserBenefit, newBenefitId: number | null, migratedAt: Date) {
  if (newBenefitId === null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    benefitId: newBenefitId,
    benefitValue: BigInt(Math.round(Number(o.benefitValue.toString()))),
    sourceType: mapUserBenefitSourceType(o.sourceType),
    sourceId: o.sourceId,
    effectiveAt: o.effectiveAt ?? ts.createdAt,
    expiredAt: o.expiredAt ?? FAR_FUTURE,
    status: o.status,
    remark: o.remark,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
