import type { LPaymentOrder, LPaymentTransaction } from '../legacyTypes'
import { mapPaymentChannel, mapPaymentMethod, tsFallback } from './helpers'

/**
 * §8.2 B-3：旧 payment_orders → 新 orders。
 * productId 重映射后由迁移器传入（newProductId）；isUpgrade 由迁移器判断该 order 是否出现在
 * membership_upgrade_records.paymentOrderId 中后传入。
 * paymentUnit 1→'month'/2→'year'；expiredAt=createdAt；description→remark；
 * 丢弃 paymentType/paymentWay/prepayId/levelId/quantity。
 */
export function mapOrder(o: LPaymentOrder, newProductId: number | null, isUpgrade: boolean, migratedAt: Date) {
  if (newProductId === null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    orderNo: o.orderNo,
    userId: o.userId,
    productId: newProductId,
    amount: o.amount,
    duration: o.duration,
    durationUnit: o.paymentUnit === 2 ? 'year' : 'month',
    orderType: isUpgrade ? 'upgrade' : 'purchase',
    status: o.status,
    paidAt: o.paymentTime,
    expiredAt: ts.createdAt,
    remark: o.description,
    adminRemark: null,
    adminRemarkUpdatedBy: null,
    adminRemarkUpdatedAt: null,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.2 B-3：旧 payment_transactions → 新 payment_transactions。
 * 生成必填 transactionNo='LEGACY'+id；transactionId→outTradeNo；rawData→callbackData；
 * successTime→paidAt；paymentType→paymentChannel、paymentWay→paymentMethod；expiredAt=createdAt；
 * tradeState/bankType/payerInfo/notifyTime 新库无独立列，并入 callbackData JSON 保留。旧 createdAt/updatedAt 为 NOT NULL。
 */
export function mapPaymentTransaction(o: LPaymentTransaction) {
  return {
    id: o.id,
    transactionNo: `LEGACY${o.id}`,
    orderId: o.orderId,
    amount: o.amount,
    paymentChannel: mapPaymentChannel(o.paymentType),
    paymentMethod: mapPaymentMethod(o.paymentWay),
    outTradeNo: o.transactionId,
    prepayId: null,
    status: o.status,
    paidAt: o.successTime,
    expiredAt: o.createdAt,
    // 旧库回调明细拆成独立列，新库无对应列，并入 callbackData JSON 保留
    callbackData: {
      rawData: o.rawData ?? null,
      tradeState: o.tradeState ?? null,
      bankType: o.bankType ?? null,
      payerInfo: o.payerInfo ?? null,
      notifyTime: o.notifyTime ? o.notifyTime.toISOString() : null,
    },
    errorMessage: null,
    remark: null,
    adminRemark: null,
    adminRemarkUpdatedBy: null,
    adminRemarkUpdatedAt: null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.2 B-3：为"已支付却无对应旧交易记录"的订单合成一条 payment_transactions。
 * id 自增（不带旧 ID）；transactionNo='LEGACY-ORD'+orderId；幂等由迁移器按 transactionNo 去重。
 */
export function synthesizeTransaction(o: LPaymentOrder, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    transactionNo: `LEGACY-ORD${o.id}`,
    orderId: o.id,
    amount: o.amount,
    paymentChannel: mapPaymentChannel(o.paymentType),
    paymentMethod: mapPaymentMethod(o.paymentWay),
    outTradeNo: null,
    prepayId: o.prepayId,
    status: o.status,
    paidAt: o.paymentTime,
    expiredAt: ts.createdAt,
    callbackData: undefined,
    errorMessage: null,
    remark: null,
    adminRemark: null,
    adminRemarkUpdatedBy: null,
    adminRemarkUpdatedAt: null,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
