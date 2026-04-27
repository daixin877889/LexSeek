import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PaymentChannel, PaymentMethod, PaymentTransactionStatus, OrderStatus } from '#shared/types/payment'
import {
  createPaymentService,
  handlePaymentCallbackService,
  queryPaymentStatusService,
  queryPaymentResultService,
  handleExpiredPaymentTransactionsService,
} from '../../../server/services/payment/payment.service'

// Mock dependencies
vi.mock('../../../server/services/payment/paymentTransaction.dao', () => ({
  createPaymentTransactionDao: vi.fn(),
  findPaymentTransactionByIdDao: vi.fn(),
  findPaymentTransactionByNoDao: vi.fn(),
  findPendingTransactionByOrderIdDao: vi.fn(),
  updatePaymentTransactionDao: vi.fn(),
  findPaymentTransactionByOutTradeNoDao: vi.fn(),
  findExpiredPendingTransactionsDao: vi.fn(),
  expirePaymentTransactionsDao: vi.fn(),
}))

vi.mock('../../../server/services/payment/order.dao', () => ({
  findOrderByIdDao: vi.fn(),
  findOrderByOrderNoDao: vi.fn(),
  updateOrderStatusDao: vi.fn(),
}))

vi.mock('../../../server/services/payment/handlers/index', () => ({
  handlePaymentSuccess: vi.fn(),
}))

vi.mock('../../../server/lib/payment', () => ({
  getPaymentAdapter: vi.fn(),
}))

vi.mock('#shared/utils/decimalToNumber', () => ({
  decimalToNumberUtils: vi.fn((val) => {
    if (typeof val === 'number') return val
    if (val && typeof val === 'object' && 'toNumber' in val) return val.toNumber()
    return Number(val) || 0
  }),
}))

import {
  createPaymentTransactionDao,
  findPaymentTransactionByIdDao,
  findPaymentTransactionByNoDao,
  findPendingTransactionByOrderIdDao,
  updatePaymentTransactionDao,
  findExpiredPendingTransactionsDao,
  expirePaymentTransactionsDao,
} from '../../../server/services/payment/paymentTransaction.dao'

import {
  findOrderByIdDao,
  findOrderByOrderNoDao,
  updateOrderStatusDao,
} from '../../../server/services/payment/order.dao'

import { handlePaymentSuccess } from '../../../server/services/payment/handlers/index'
import { getPaymentAdapter } from '../../../server/lib/payment'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'

describe('payment.service · 支付服务', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createPaymentService · 创建支付', () => {
    it('应该成功创建支付并返回支付参数', async () => {
      const mockOrder = {
        id: 1,
        orderNo: 'LSD-001',
        status: OrderStatus.PENDING,
        amount: 100,
        product: { name: '高级会员' },
        expiredAt: new Date(Date.now() + 3600000),
      }

      const mockAdapter = {
        createPayment: vi.fn().mockResolvedValue({
          success: true,
          paymentParams: { key: 'value' },
          codeUrl: 'https://qr.code',
        }),
      }

      const mockTransaction = {
        id: 1,
        transactionNo: 'TXN-001',
        orderId: 1,
        status: PaymentTransactionStatus.PENDING,
      }

      vi.mocked(findOrderByIdDao).mockResolvedValue(mockOrder as any)
      vi.mocked(findPendingTransactionByOrderIdDao).mockResolvedValue(null)
      vi.mocked(decimalToNumberUtils).mockReturnValue(100)
      vi.mocked(getPaymentAdapter).mockReturnValue(mockAdapter as any)
      vi.mocked(createPaymentTransactionDao).mockResolvedValue(mockTransaction as any)

      const result = await createPaymentService({
        orderId: 1,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.NATIVE,
        notifyUrl: 'https://notify.url',
      })

      expect(result.success).toBe(true)
      expect(result.transactionNo).toBe('TXN-001')
      expect(result.codeUrl).toBe('https://qr.code')
      expect(createPaymentTransactionDao).toHaveBeenCalled()
    })

    it('应该返回错误当订单不存在', async () => {
      vi.mocked(findOrderByIdDao).mockResolvedValue(null)

      const result = await createPaymentService({
        orderId: 999,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.NATIVE,
        notifyUrl: 'https://notify.url',
      })

      expect(result.success).toBe(false)
      expect(result.errorMessage).toBe('订单不存在')
    })

    it('应该返回错误当订单状态不允许支付', async () => {
      const mockOrder = {
        id: 1,
        status: OrderStatus.PAID,
        amount: 100,
        expiredAt: new Date(Date.now() + 3600000),
      }

      vi.mocked(findOrderByIdDao).mockResolvedValue(mockOrder as any)

      const result = await createPaymentService({
        orderId: 1,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.NATIVE,
        notifyUrl: 'https://notify.url',
      })

      expect(result.success).toBe(false)
      expect(result.errorMessage).toBe('订单状态不允许支付')
    })

    it('应该返回错误当订单已过期', async () => {
      const mockOrder = {
        id: 1,
        status: OrderStatus.PENDING,
        amount: 100,
        expiredAt: new Date(Date.now() - 1000),
      }

      vi.mocked(findOrderByIdDao).mockResolvedValue(mockOrder as any)

      const result = await createPaymentService({
        orderId: 1,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.NATIVE,
        notifyUrl: 'https://notify.url',
      })

      expect(result.success).toBe(false)
      expect(result.errorMessage).toBe('订单已过期')
    })

    it('应该重用已有的待支付交易如果渠道和方式相同', async () => {
      const mockOrder = {
        id: 1,
        orderNo: 'LSD-001',
        status: OrderStatus.PENDING,
        amount: 100,
        product: { name: '高级会员' },
        expiredAt: new Date(Date.now() + 3600000),
      }

      const mockPendingTransaction = {
        id: 1,
        transactionNo: 'TXN-OLD',
        orderId: 1,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.NATIVE,
        status: PaymentTransactionStatus.PENDING,
      }

      const mockAdapter = {
        createPayment: vi.fn().mockResolvedValue({
          success: true,
          paymentParams: { key: 'value' },
          codeUrl: 'https://qr.code',
        }),
      }

      vi.mocked(findOrderByIdDao).mockResolvedValue(mockOrder as any)
      vi.mocked(findPendingTransactionByOrderIdDao).mockResolvedValue(mockPendingTransaction as any)
      vi.mocked(decimalToNumberUtils).mockReturnValue(100)
      vi.mocked(getPaymentAdapter).mockReturnValue(mockAdapter as any)

      const result = await createPaymentService({
        orderId: 1,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.NATIVE,
        notifyUrl: 'https://notify.url',
      })

      expect(result.success).toBe(true)
      expect(result.transactionNo).toBe('TXN-OLD')
    })

    it('应该处理支付适配器返回的错误', async () => {
      const mockOrder = {
        id: 1,
        orderNo: 'LSD-001',
        status: OrderStatus.PENDING,
        amount: 100,
        product: { name: '高级会员' },
        expiredAt: new Date(Date.now() + 3600000),
      }

      const mockAdapter = {
        createPayment: vi.fn().mockResolvedValue({
          success: false,
          errorMessage: '创建支付参数失败',
        }),
      }

      const mockTransaction = {
        id: 1,
        transactionNo: 'TXN-001',
      }

      vi.mocked(findOrderByIdDao).mockResolvedValue(mockOrder as any)
      vi.mocked(findPendingTransactionByOrderIdDao).mockResolvedValue(null)
      vi.mocked(decimalToNumberUtils).mockReturnValue(100)
      vi.mocked(getPaymentAdapter).mockReturnValue(mockAdapter as any)
      vi.mocked(createPaymentTransactionDao).mockResolvedValue(mockTransaction as any)

      const result = await createPaymentService({
        orderId: 1,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.NATIVE,
        notifyUrl: 'https://notify.url',
      })

      expect(result.success).toBe(false)
      expect(updatePaymentTransactionDao).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: PaymentTransactionStatus.FAILED })
      )
    })
  })

  describe('queryPaymentStatusService · 查询支付状态', () => {
    it('应该返回支付单信息', async () => {
      const mockTransaction = {
        id: 1,
        transactionNo: 'TXN-001',
        status: PaymentTransactionStatus.PENDING,
      }

      vi.mocked(findPaymentTransactionByNoDao).mockResolvedValue(mockTransaction as any)

      const result = await queryPaymentStatusService('TXN-001')

      expect(result).toEqual(mockTransaction)
      expect(findPaymentTransactionByNoDao).toHaveBeenCalledWith('TXN-001')
    })

    it('应该返回 null 当支付单不存在', async () => {
      vi.mocked(findPaymentTransactionByNoDao).mockResolvedValue(null)

      const result = await queryPaymentStatusService('TXN-NOTEXIST')

      expect(result).toBeNull()
    })
  })

  describe('queryPaymentResultService · 查询支付结果', () => {
    it('应该返回已支付状态当支付单已成功', async () => {
      const mockTransaction = {
        id: 1,
        transactionNo: 'TXN-001',
        status: PaymentTransactionStatus.SUCCESS,
      }

      vi.mocked(findPaymentTransactionByNoDao).mockResolvedValue(mockTransaction as any)

      const result = await queryPaymentResultService('TXN-001')

      expect(result.success).toBe(true)
      expect(result.paid).toBe(true)
    })

    it('应该返回错误当支付单不存在', async () => {
      vi.mocked(findPaymentTransactionByNoDao).mockResolvedValue(null)

      const result = await queryPaymentResultService('TXN-NOTEXIST')

      expect(result.success).toBe(false)
      expect(result.paid).toBe(false)
      expect(result.errorMessage).toBe('支付单不存在')
    })

    it('应该返回未支付状态当支付单状态不是待支付', async () => {
      const mockTransaction = {
        id: 1,
        transactionNo: 'TXN-001',
        status: PaymentTransactionStatus.FAILED,
      }

      vi.mocked(findPaymentTransactionByNoDao).mockResolvedValue(mockTransaction as any)

      const result = await queryPaymentResultService('TXN-001')

      expect(result.success).toBe(true)
      expect(result.paid).toBe(false)
    })
  })

  describe('handleExpiredPaymentTransactionsService · 处理过期支付单', () => {
    it('应该返回 0 当没有过期的支付单', async () => {
      vi.mocked(findExpiredPendingTransactionsDao).mockResolvedValue([])

      const result = await handleExpiredPaymentTransactionsService()

      expect(result).toBe(0)
      expect(expirePaymentTransactionsDao).not.toHaveBeenCalled()
    })

    it('应该更新过期的支付单并返回数量', async () => {
      const mockExpiredTransactions = [
        { id: 1, transactionNo: 'TXN-001' },
        { id: 2, transactionNo: 'TXN-002' },
      ]

      vi.mocked(findExpiredPendingTransactionsDao).mockResolvedValue(mockExpiredTransactions as any)
      vi.mocked(expirePaymentTransactionsDao).mockResolvedValue(2)

      const result = await handleExpiredPaymentTransactionsService()

      expect(result).toBe(2)
      expect(expirePaymentTransactionsDao).toHaveBeenCalledWith([1, 2])
    })

    it('应该处理错误并抛出异常', async () => {
      const error = new Error('数据库错误')
      vi.mocked(findExpiredPendingTransactionsDao).mockRejectedValue(error)

      await expect(handleExpiredPaymentTransactionsService()).rejects.toThrow('数据库错误')
    })
  })

  describe('handlePaymentCallbackService · 处理支付回调', () => {
    it('应该成功处理支付回调', async () => {
      const mockOrder = {
        id: 1,
        orderNo: 'LSD-001',
        status: OrderStatus.PENDING,
      }

      const mockTransaction = {
        id: 1,
        transactionNo: 'TXN-001',
        orderId: 1,
        amount: 100,
        paymentChannel: PaymentChannel.WECHAT,
        status: PaymentTransactionStatus.PENDING,
        order: mockOrder,
      }

      const mockAdapter = {
        verifyCallback: vi.fn().mockResolvedValue({
          success: true,
          orderNo: 'LSD-001',
          transactionId: 'WX-123',
          amount: 10000,
          paidAt: new Date(),
        }),
      }

      // Mock prisma transaction
      global.prisma = {
        $transaction: vi.fn().mockImplementation(async (cb) => {
          await cb({
            paymentTransactions: {
              findUnique: vi.fn().mockResolvedValue({
                status: PaymentTransactionStatus.PENDING,
              }),
            },
          })
        }),
      } as any

      vi.mocked(findOrderByOrderNoDao).mockResolvedValue(mockOrder as any)
      vi.mocked(findPendingTransactionByOrderIdDao).mockResolvedValue(mockTransaction as any)
      vi.mocked(decimalToNumberUtils).mockReturnValue(100)
      vi.mocked(getPaymentAdapter).mockReturnValue(mockAdapter as any)

      const result = await handlePaymentCallbackService(PaymentChannel.WECHAT, {
        raw: { some: 'data' },
      } as any)

      expect(result.success).toBe(true)
    })

    it('应该返回错误当回调验证失败', async () => {
      const mockAdapter = {
        verifyCallback: vi.fn().mockResolvedValue({
          success: false,
          errorMessage: '验证失败',
        }),
      }

      vi.mocked(getPaymentAdapter).mockReturnValue(mockAdapter as any)

      const result = await handlePaymentCallbackService(PaymentChannel.WECHAT, {} as any)

      expect(result.success).toBe(false)
      expect(result.errorMessage).toBe('验证失败')
    })

    it('应该返回错误当订单不存在', async () => {
      const mockAdapter = {
        verifyCallback: vi.fn().mockResolvedValue({
          success: true,
          orderNo: 'LSD-NOTEXIST',
          transactionId: 'WX-123',
          amount: 10000,
        }),
      }

      vi.mocked(getPaymentAdapter).mockReturnValue(mockAdapter as any)
      vi.mocked(findOrderByOrderNoDao).mockResolvedValue(null)

      const result = await handlePaymentCallbackService(PaymentChannel.WECHAT, {} as any)

      expect(result.success).toBe(false)
      expect(result.errorMessage).toBe('订单不存在')
    })

    it('应该跳过已处理的支付单', async () => {
      const mockOrder = {
        id: 1,
        orderNo: 'LSD-001',
      }

      const mockTransaction = {
        id: 1,
        transactionNo: 'TXN-001',
        orderId: 1,
        status: PaymentTransactionStatus.SUCCESS,
      }

      const mockAdapter = {
        verifyCallback: vi.fn().mockResolvedValue({
          success: true,
          orderNo: 'LSD-001',
          transactionId: 'WX-123',
          amount: 10000,
        }),
      }

      vi.mocked(getPaymentAdapter).mockReturnValue(mockAdapter as any)
      vi.mocked(findOrderByOrderNoDao).mockResolvedValue(mockOrder as any)
      vi.mocked(findPendingTransactionByOrderIdDao).mockResolvedValue(mockTransaction as any)

      const result = await handlePaymentCallbackService(PaymentChannel.WECHAT, {} as any)

      expect(result.success).toBe(true)
      expect(updatePaymentTransactionDao).not.toHaveBeenCalled()
    })

    it('应该返回错误当金额不匹配', async () => {
      const mockOrder = {
        id: 1,
        orderNo: 'LSD-001',
      }

      const mockTransaction = {
        id: 1,
        transactionNo: 'TXN-001',
        orderId: 1,
        amount: 100,
        paymentChannel: PaymentChannel.WECHAT,
        status: PaymentTransactionStatus.PENDING,
      }

      const mockAdapter = {
        verifyCallback: vi.fn().mockResolvedValue({
          success: true,
          orderNo: 'LSD-001',
          transactionId: 'WX-123',
          amount: 5000, // 不匹配的金额
        }),
      }

      vi.mocked(getPaymentAdapter).mockReturnValue(mockAdapter as any)
      vi.mocked(findOrderByOrderNoDao).mockResolvedValue(mockOrder as any)
      vi.mocked(findPendingTransactionByOrderIdDao).mockResolvedValue(mockTransaction as any)
      vi.mocked(decimalToNumberUtils).mockReturnValue(100)

      const result = await handlePaymentCallbackService(PaymentChannel.WECHAT, {} as any)

      expect(result.success).toBe(false)
      expect(result.errorMessage).toBe('支付金额不匹配')
    })

    it('应该处理异常并返回错误', async () => {
      const error = new Error('验证异常')
      const mockAdapter = {
        verifyCallback: vi.fn().mockRejectedValue(error),
      }

      vi.mocked(getPaymentAdapter).mockReturnValue(mockAdapter as any)

      const result = await handlePaymentCallbackService(PaymentChannel.WECHAT, {} as any)

      expect(result.success).toBe(false)
      expect(result.errorMessage).toBe('验证异常')
    })
  })
})
