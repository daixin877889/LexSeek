/**
 * server/api/v1/payments/** handler 单元覆盖（6 文件）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/payment/order.service', () => ({
    createOrderService: vi.fn(),
    cancelOrderService: vi.fn(),
    checkOrderPayableService: vi.fn(),
    getOrderDetailService: vi.fn(),
    getUserOrdersService: vi.fn(),
}))
vi.mock('~~/server/services/payment/payment.service', () => ({
    createPaymentService: vi.fn(),
    queryPaymentResultService: vi.fn(),
    queryPaymentStatusService: vi.fn(),
    handlePaymentCallbackService: vi.fn(),
}))

import {
    createOrderService,
    cancelOrderService,
    checkOrderPayableService,
    getOrderDetailService,
    getUserOrdersService,
} from '~~/server/services/payment/order.service'
import {
    createPaymentService,
    queryPaymentResultService,
    queryPaymentStatusService,
    handlePaymentCallbackService,
} from '~~/server/services/payment/payment.service'

const mCreateOrder = vi.mocked(createOrderService)
const mCancelOrder = vi.mocked(cancelOrderService)
const mCheckPayable = vi.mocked(checkOrderPayableService)
const mGetDetail = vi.mocked(getOrderDetailService)
const mGetUserOrders = vi.mocked(getUserOrdersService)
const mCreatePayment = vi.mocked(createPaymentService)
const mQueryResult = vi.mocked(queryPaymentResultService)
const mQueryStatus = vi.mocked(queryPaymentStatusService)
const mCallback = vi.mocked(handlePaymentCallbackService)

const { default: createHandler } = await import('../../../server/api/v1/payments/create.post')
const { default: ordersHandler } = await import('../../../server/api/v1/payments/orders.get')
const { default: queryHandler } = await import('../../../server/api/v1/payments/query.get')
const { default: callbackHandler } = await import('../../../server/api/v1/payments/callback/wechat.post')
const { default: cancelHandler } = await import('../../../server/api/v1/payments/orders/cancel/[id].post')
const { default: payHandler } = await import('../../../server/api/v1/payments/orders/pay/[id].post')

describe('POST /api/v1/payments/create', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mCreateOrder.mockResolvedValue({ success: true, order: { id: 1, orderNo: 'O', amount: '100' } } as any)
        mCreatePayment.mockResolvedValue({ success: true, transactionNo: 'T' } as any)
    })

    const baseBody = {
        productId: 1,
        duration: 1,
        durationUnit: 'month',
        paymentChannel: 'wechat',
        paymentMethod: 'scan_code',
    }

    it('happy path', async () => {
        const res: any = await createHandler(makeEvent({ userId: 100, body: baseBody }) as any)
        expectSuccess(res, d => expect(d.amount).toBe(100))
    })

    it('未登录 → 401', async () => {
        const res: any = await createHandler(makeEvent({ body: baseBody }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await createHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })

    it('小程序无 openid → 400', async () => {
        const res: any = await createHandler(makeEvent({
            userId: 100, body: { ...baseBody, paymentMethod: 'mini_program' },
        }) as any)
        expectError(res, 400, 'openid')
    })

    it('创建订单失败 → 400', async () => {
        mCreateOrder.mockResolvedValue({ success: false, errorMessage: '商品下架' } as any)
        const res: any = await createHandler(makeEvent({ userId: 100, body: baseBody }) as any)
        expectError(res, 400, '商品下架')
    })

    it('创建支付失败 → 400', async () => {
        mCreatePayment.mockResolvedValue({ success: false, errorMessage: '微信失败' } as any)
        const res: any = await createHandler(makeEvent({ userId: 100, body: baseBody }) as any)
        expectError(res, 400, '微信失败')
    })
})

describe('GET /api/v1/payments/orders', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mGetUserOrders.mockResolvedValue({
            list: [{
                id: 1, orderNo: 'O', product: { name: 'P', type: 1 },
                amount: '99.5', duration: 1, durationUnit: 'month', status: 1,
                paidAt: null, expiredAt: null, createdAt: new Date(),
            }],
            total: 1,
        } as any)
        const res: any = await ordersHandler(makeEvent({ userId: 100, query: { page: '1', pageSize: '10' } }) as any)
        expectSuccess(res, d => {
            expect(d.list[0].productName).toBe('P')
            expect(d.list[0].amount).toBe(99.5)
        })
    })

    it('product 缺失走兜底', async () => {
        mGetUserOrders.mockResolvedValue({
            list: [{ id: 1, orderNo: 'O', product: null, amount: '0', duration: 1, durationUnit: 'm', status: 0, paidAt: null, expiredAt: null, createdAt: new Date() }],
            total: 1,
        } as any)
        const res: any = await ordersHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res, d => expect(d.list[0].productName).toBe('未知商品'))
    })

    it('未登录 → 401', async () => {
        const res: any = await ordersHandler(makeEvent({ query: {} }) as any)
        expectError(res, 401)
    })

    it('status undefined 字符串 → 跳过过滤', async () => {
        mGetUserOrders.mockResolvedValue({ list: [], total: 0 } as any)
        await ordersHandler(makeEvent({ userId: 100, query: { status: 'undefined' } }) as any)
        expect(mGetUserOrders).toHaveBeenCalledWith(100, expect.objectContaining({ status: undefined }))
    })

    it('status 非数字 → 跳过过滤', async () => {
        mGetUserOrders.mockResolvedValue({ list: [], total: 0 } as any)
        await ordersHandler(makeEvent({ userId: 100, query: { status: 'abc' } }) as any)
        expect(mGetUserOrders).toHaveBeenCalledWith(100, expect.objectContaining({ status: undefined }))
    })
})

describe('GET /api/v1/payments/query', () => {
    beforeEach(() => vi.clearAllMocks())

    it('未登录 → 401', async () => {
        const res: any = await queryHandler(makeEvent({ query: {} }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await queryHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectError(res, 400)
    })

    it('sync=true 主动查询成功', async () => {
        mQueryResult.mockResolvedValue({ success: true, paid: true } as any)
        const res: any = await queryHandler(makeEvent({
            userId: 100, query: { transactionNo: 'T', sync: 'true' },
        }) as any)
        expectSuccess(res, d => expect(d.paid).toBe(true))
    })

    it('sync=true 失败 → 400', async () => {
        mQueryResult.mockResolvedValue({ success: false, errorMessage: 'X' } as any)
        const res: any = await queryHandler(makeEvent({
            userId: 100, query: { transactionNo: 'T', sync: 'true' },
        }) as any)
        expectError(res, 400)
    })

    it('支付单不存在 → 404', async () => {
        mQueryStatus.mockResolvedValue(null as any)
        const res: any = await queryHandler(makeEvent({
            userId: 100, query: { transactionNo: 'T' },
        }) as any)
        expectError(res, 404)
    })

    it('支付单非本人 → 403', async () => {
        mQueryStatus.mockResolvedValue({
            transactionNo: 'T', orderId: 1, amount: '100',
            paymentChannel: 'wechat', paymentMethod: 'scan_code',
            status: 0, paidAt: null, expiredAt: null,
            order: { userId: 999 },
        } as any)
        const res: any = await queryHandler(makeEvent({
            userId: 100, query: { transactionNo: 'T' },
        }) as any)
        expectError(res, 403)
    })

    it('happy path: 状态文本随状态变化', async () => {
        mQueryStatus.mockResolvedValue({
            transactionNo: 'T', orderId: 1, amount: '100',
            paymentChannel: 'wechat', paymentMethod: 'scan_code',
            status: 1, paidAt: new Date(), expiredAt: null,
            order: { userId: 100 },
        } as any)
        const res: any = await queryHandler(makeEvent({
            userId: 100, query: { transactionNo: 'T' },
        }) as any)
        expectSuccess(res, d => expect(d.statusText).toBe('支付成功'))
    })

    it('未知 status → 状态文本兜底', async () => {
        mQueryStatus.mockResolvedValue({
            transactionNo: 'T', orderId: 1, amount: '100',
            paymentChannel: 'w', paymentMethod: 'sc',
            status: 99, paidAt: null, expiredAt: null,
            order: { userId: 100 },
        } as any)
        const res: any = await queryHandler(makeEvent({
            userId: 100, query: { transactionNo: 'T' },
        }) as any)
        expectSuccess(res, d => expect(d.statusText).toBe('未知状态'))
    })
})

describe('POST /api/v1/payments/callback/wechat', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mCallback.mockResolvedValue({ success: true } as any)
        const res: any = await callbackHandler({
            __rawBody: '{"x":1}',
            __headers: {
                'wechatpay-signature': 'sig',
                'wechatpay-timestamp': '123',
                'wechatpay-nonce': 'n',
                'wechatpay-serial': 's',
            },
        } as any)
        expect(res.code).toBe('SUCCESS')
    })

    it('请求体为空 → FAIL', async () => {
        const res: any = await callbackHandler({
            __headers: {},
        } as any)
        expect(res.code).toBe('FAIL')
    })

    it('service 失败 → FAIL', async () => {
        mCallback.mockResolvedValue({ success: false, errorMessage: 'sig invalid' } as any)
        const res: any = await callbackHandler({
            __rawBody: '{}',
            __headers: {},
        } as any)
        expect(res.code).toBe('FAIL')
    })

    it('service 抛错 → FAIL', async () => {
        mCallback.mockRejectedValueOnce(new Error('boom'))
        const res: any = await callbackHandler({
            __rawBody: '{}',
            __headers: {},
        } as any)
        expect(res.code).toBe('FAIL')
    })
})

describe('POST /api/v1/payments/orders/cancel/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mCancelOrder.mockResolvedValue({ success: true } as any)
        const res: any = await cancelHandler(makeEvent({ userId: 100, params: { id: '5' } }) as any)
        expectSuccess(res)
    })

    it('未登录 → 401', async () => {
        const res: any = await cancelHandler(makeEvent({ params: { id: '5' } }) as any)
        expectError(res, 401)
    })

    it('id 非数字 → 400', async () => {
        const res: any = await cancelHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any)
        expectError(res, 400)
    })

    it('service 失败 → 400', async () => {
        mCancelOrder.mockResolvedValue({ success: false, errorMessage: '已支付' } as any)
        const res: any = await cancelHandler(makeEvent({ userId: 100, params: { id: '5' } }) as any)
        expectError(res, 400, '已支付')
    })
})

describe('POST /api/v1/payments/orders/pay/:id', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mCheckPayable.mockResolvedValue({ payable: true } as any)
        mGetDetail.mockResolvedValue({ id: 5, orderNo: 'O', amount: '100' } as any)
        mCreatePayment.mockResolvedValue({ success: true, transactionNo: 'T' } as any)
    })

    const baseBody = { paymentChannel: 'wechat', paymentMethod: 'scan_code' }

    it('happy path', async () => {
        const res: any = await payHandler(makeEvent({
            userId: 100, params: { id: '5' }, body: baseBody,
        }) as any)
        expectSuccess(res, d => expect(d.amount).toBe(100))
    })

    it('未登录 → 401', async () => {
        const res: any = await payHandler(makeEvent({ params: { id: '5' }, body: baseBody }) as any)
        expectError(res, 401)
    })

    it('id 非法 → 400', async () => {
        const res: any = await payHandler(makeEvent({ userId: 100, params: { id: '0' }, body: baseBody }) as any)
        expectError(res, 400)
    })

    it('参数非法 → 400', async () => {
        const res: any = await payHandler(makeEvent({ userId: 100, params: { id: '5' }, body: {} }) as any)
        expectError(res, 400)
    })

    it('小程序无 openid → 400', async () => {
        const res: any = await payHandler(makeEvent({
            userId: 100, params: { id: '5' }, body: { ...baseBody, paymentMethod: 'mini_program' },
        }) as any)
        expectError(res, 400, 'openid')
    })

    it('订单不可支付 → 400', async () => {
        mCheckPayable.mockResolvedValue({ payable: false, errorMessage: '已过期' } as any)
        const res: any = await payHandler(makeEvent({
            userId: 100, params: { id: '5' }, body: baseBody,
        }) as any)
        expectError(res, 400, '已过期')
    })

    it('订单不存在 / 非本人 → 404', async () => {
        mGetDetail.mockResolvedValue(null as any)
        const res: any = await payHandler(makeEvent({
            userId: 100, params: { id: '5' }, body: baseBody,
        }) as any)
        expectError(res, 404)
    })

    it('支付服务失败 → 400', async () => {
        mCreatePayment.mockResolvedValue({ success: false, errorMessage: '签名错' } as any)
        const res: any = await payHandler(makeEvent({
            userId: 100, params: { id: '5' }, body: baseBody,
        }) as any)
        expectError(res, 400, '签名')
    })
})
