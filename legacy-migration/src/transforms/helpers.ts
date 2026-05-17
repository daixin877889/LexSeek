/** 时间戳兜底：设计文档 §8 跨表通用规则 */
export function tsFallback(
  createdAt: Date | null | undefined,
  updatedAt: Date | null | undefined,
  migratedAt: Date,
): { createdAt: Date; updatedAt: Date } {
  const c = createdAt ?? updatedAt ?? migratedAt
  const u = updatedAt ?? createdAt ?? migratedAt
  return { createdAt: c, updatedAt: u }
}

/**
 * user_benefits.sourceType：旧 Int → 新 String 枚举。
 * 对照表在演练阶段查旧项目代码核对（设计文档 §9 枚举映射表）；
 * 此处为初版假设，若 preflight/演练发现不符须修正。
 */
const USER_BENEFIT_SOURCE_TYPE: Record<number, string> = {
  1: 'membership_gift',
  2: 'benefit_package',
  3: 'redemption_code',
  99: 'admin_gift',
}
export function mapUserBenefitSourceType(old: number): string {
  return USER_BENEFIT_SOURCE_TYPE[old] ?? 'admin_gift'
}

/**
 * payment_transactions.paymentMethod：旧 paymentWay Int → 新 String。
 * 1-JSAPI→mini_program，2-H5→wap，3-APP→app（演练阶段核对）。
 */
const PAYMENT_METHOD: Record<number, string> = { 1: 'mini_program', 2: 'wap', 3: 'app' }
export function mapPaymentMethod(old: number): string {
  return PAYMENT_METHOD[old] ?? 'mini_program'
}

/** payment paymentType Int → paymentChannel String */
export function mapPaymentChannel(old: number): string {
  return old === 2 ? 'alipay' : 'wechat'
}
