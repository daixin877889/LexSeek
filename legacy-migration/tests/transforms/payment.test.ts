import { describe, expect, it } from 'vitest'
import type { LPaymentOrder, LPaymentTransaction } from '../../src/legacyTypes'
import { mapOrder, mapPaymentTransaction, synthesizeTransaction } from '../../src/transforms/payment'

const now = new Date('2026-05-17T00:00:00Z')
const order = {
  id: 100, orderNo: 'ORD100', userId: 1, levelId: 3, amount: '99.00',
  paymentType: 1, paymentWay: 1, status: 1, prepayId: 'pp', paymentTime: now,
  duration: 12, paymentUnit: 1, description: '会员', productId: 9, quantity: 1,
  createdAt: null, updatedAt: null, deletedAt: null,
} as unknown as LPaymentOrder

describe('mapOrder', () => {
  it('productId 重映射、paymentUnit→durationUnit、expiredAt=createdAt、orderType 推断', () => {
    const r = mapOrder(order, 20, false, now)
    expect(r).not.toBeNull()
    expect(r!.productId).toBe(20)
    expect(r!.durationUnit).toBe('month')
    expect(r!.expiredAt).toEqual(now)
    expect(r!.orderType).toBe('purchase')
    expect(r!.paidAt).toEqual(now)
    expect(r!.remark).toBe('会员')
  })
  it('出现在升级记录中 → orderType=upgrade', () => {
    expect(mapOrder(order, 20, true, now)!.orderType).toBe('upgrade')
  })
  it('productId 重映射失败返回 null', () => {
    expect(mapOrder(order, null, false, now)).toBeNull()
  })
})

describe('mapPaymentTransaction', () => {
  it('生成 transactionNo、字段渠道/方式映射、expiredAt=createdAt', () => {
    const tx = {
      id: 5, orderId: 100, transactionId: 'WX123', paymentType: 1, paymentWay: 2,
      amount: '99.00', status: 1, tradeState: 'SUCCESS', bankType: 'ICBC',
      payerInfo: {}, rawData: { raw: 1 }, notifyTime: now, successTime: now,
      createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LPaymentTransaction
    const r = mapPaymentTransaction(tx)
    expect(r.transactionNo).toBe('LEGACY5')
    expect(r.outTradeNo).toBe('WX123')
    expect(r.paymentChannel).toBe('wechat')
    expect(r.paymentMethod).toBe('wap')
    expect(r.expiredAt).toEqual(now)
    expect(r.paidAt).toEqual(now)
    expect(r.callbackData).toEqual({
      rawData: { raw: 1 },
      tradeState: 'SUCCESS',
      bankType: 'ICBC',
      payerInfo: {},
      notifyTime: now.toISOString(),
    })
  })
})

describe('synthesizeTransaction', () => {
  it('用订单自身支付字段合成交易，transactionNo=LEGACY-ORD+orderId', () => {
    const r = synthesizeTransaction(order, now)
    expect(r.transactionNo).toBe('LEGACY-ORD100')
    expect(r.orderId).toBe(100)
    expect(r.paymentChannel).toBe('wechat')
    expect(r.status).toBe(1)
  })
})
