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
 * 已对照 LexSeekApi BenefitSourceType 核实：
 * 1=会员额度 2=兑换码 3=直接购买 4=管理员赠送 5=活动奖励 6=试用 99=其他。
 * 新库枚举仅 membership_gift/redemption_code/benefit_package/admin_gift 四值，
 * 旧 5/6/99 无对应，统一回退 admin_gift。
 */
const USER_BENEFIT_SOURCE_TYPE: Record<number, string> = {
  1: 'membership_gift',
  2: 'redemption_code',
  3: 'benefit_package',
  4: 'admin_gift',
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
