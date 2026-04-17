/**
 * payment.service.ts 真实集成测试
 *
 * 覆盖：
 * - createPaymentService（创建支付：含订单不存在/状态错误/过期、复用待支付/切换渠道、prepayId 写入、SDK 失败、异常路径）
 * - handlePaymentCallbackService（验证失败、订单/支付单不存在、幂等、金额不匹配、成功路径）
 * - queryPaymentStatusService
 * - queryPaymentResultService（支付单不存在、已成功、非 PENDING、SDK 失败、SDK SUCCESS 后落库、SDK NOTPAY、异常路径）
 * - handleExpiredPaymentTransactionsService（无过期/有过期/异常路径）
 *
 * 隔离策略：仅 mock `getPaymentAdapter`（避免真实微信 SDK HTTP 调用）
 * 与 `handlePaymentSuccess`（避免对会员/积分等下游表的副作用）。
 * 数据库（orders / paymentTransactions / users / products / membershipLevels）
 * 全部使用真实 Prisma 写入测试库 ls_new_testing。
 *
 * **Feature: payment-service-real**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import {
    getTestPrisma,
    createTestUser,
    createTestProduct,
    createTestMembershipLevel,
    isTestDbAvailable,
    disconnectTestDb,
    type TestIds,
    createEmptyTestIds,
} from '../membership/test-db-helper'
import {
    PaymentChannel,
    PaymentMethod,
    PaymentTransactionStatus,
    OrderStatus,
} from '../../../shared/types/payment'
import type { CallbackData } from '../../../server/lib/payment'

// ============================================================
// Mock：支付适配器与 handlePaymentSuccess
// 使用 vi.hoisted 让 stub 在 vi.mock 提升后仍可被引用
// ============================================================

const { adapterStub, handlePaymentSuccessMock } = vi.hoisted(() => {
    const stub = {
        createPayment: vi.fn(),
        verifyCallback: vi.fn(),
        queryOrder: vi.fn(),
        closeOrder: vi.fn(),
        getChannel: vi.fn(() => 'wechat'),
        getSupportedMethods: vi.fn(() => [
            'mini_program',
            'scan_code',
            'wap',
            'app',
        ]),
    }
    const handler = vi.fn(async () => {})
    return { adapterStub: stub, handlePaymentSuccessMock: handler }
})

vi.mock('../../../server/lib/payment', async () => {
    const actual = await vi.importActual<typeof import('../../../server/lib/payment')>(
        '../../../server/lib/payment'
    )
    return {
        ...actual,
        getPaymentAdapter: vi.fn(() => adapterStub),
    }
})

// 同时 mock factory 模块本身（payment.service.ts 通过 ../../lib/payment 导入，
// 但适配器工厂可能从其它模块直接导入 factory），保证一致返回 adapterStub
vi.mock('../../../server/lib/payment/factory', async () => {
    const actual = await vi.importActual<typeof import('../../../server/lib/payment/factory')>(
        '../../../server/lib/payment/factory'
    )
    return {
        ...actual,
        getPaymentAdapter: vi.fn(() => adapterStub),
    }
})

vi.mock('../../../server/services/payment/handlers/index', async () => {
    const actual = await vi.importActual<
        typeof import('../../../server/services/payment/handlers/index')
    >('../../../server/services/payment/handlers/index')
    return {
        ...actual,
        handlePaymentSuccess: handlePaymentSuccessMock,
    }
})

// 部分 mock paymentTransaction.dao：默认转发到真实实现，
// 用例内可通过 vi.mocked(...).mockImplementationOnce 覆盖特定函数
vi.mock('../../../server/services/payment/paymentTransaction.dao', async () => {
    const actual = await vi.importActual<
        typeof import('../../../server/services/payment/paymentTransaction.dao')
    >('../../../server/services/payment/paymentTransaction.dao')
    return {
        ...actual,
        findExpiredPendingTransactionsDao: vi.fn(
            (...args: Parameters<typeof actual.findExpiredPendingTransactionsDao>) =>
                actual.findExpiredPendingTransactionsDao(...args)
        ),
        findPaymentTransactionByNoDao: vi.fn(
            (...args: Parameters<typeof actual.findPaymentTransactionByNoDao>) =>
                actual.findPaymentTransactionByNoDao(...args)
        ),
        findPendingTransactionByOrderIdDao: vi.fn(
            (...args: Parameters<typeof actual.findPendingTransactionByOrderIdDao>) =>
                actual.findPendingTransactionByOrderIdDao(...args)
        ),
    }
})

// 在 mock 之后再 import 被测模块
import {
    createPaymentService,
    handlePaymentCallbackService,
    queryPaymentStatusService,
    queryPaymentResultService,
    handleExpiredPaymentTransactionsService,
} from '../../../server/services/payment/payment.service'
import {
    createPaymentTransactionDao,
    findExpiredPendingTransactionsDao,
    findPaymentTransactionByNoDao,
    findPendingTransactionByOrderIdDao,
} from '../../../server/services/payment/paymentTransaction.dao'
import { generateOrderNo } from '../../../server/services/payment/order.dao'

// ============================================================
// 测试数据准备
// ============================================================

const prisma = getTestPrisma()
let dbAvailable = false
const testIds: TestIds = createEmptyTestIds()
/** 跟踪所有测试期间产生的 paymentTransactions ID */
const createdTransactionIds: number[] = []

let testUser: { id: number } | null = null
let testLevelId: number | null = null
let testProduct: { id: number; name: string } | null = null

const NOTIFY_URL = 'https://example.com/notify'

/**
 * 在 testIds 中追踪订单 ID
 */
const trackOrderId = (orderId: number) => {
    if (!testIds.orderIds.includes(orderId)) {
        testIds.orderIds.push(orderId)
    }
}

/**
 * 直接构造一个真实的待支付订单（绕过 order.service，避免引入额外副作用）
 */
const createPendingOrder = async (overrides: {
    expiredAt?: Date
    status?: number
    amount?: number
    productId?: number
} = {}) => {
    if (!testUser || !testProduct) throw new Error('测试基础数据未就绪')
    const order = await prisma.orders.create({
        data: {
            orderNo: generateOrderNo(),
            userId: testUser.id,
            productId: overrides.productId ?? testProduct.id,
            amount: overrides.amount ?? 9.99,
            duration: 1,
            durationUnit: 'year',
            orderType: 'purchase',
            status: overrides.status ?? OrderStatus.PENDING,
            expiredAt: overrides.expiredAt ?? new Date(Date.now() + 30 * 60 * 1000),
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    trackOrderId(order.id)
    return order
}

describe('payment.service.ts 真实测试', () => {
    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) return

        // setupFiles 在后台异步运行 cleanupAllTestData，会按"测试产品_"前缀 DELETE，
        // 可能与本测试创建的数据竞争。直接 await 一次清理，再创建独有前缀的数据避开冲突。
        const { cleanupAllTestData } = await import('../membership/test-db-helper')
        await cleanupAllTestData()

        // 准备会员级别 + 用户 + 商品（使用独有前缀避开后台清理）
        const level = await prisma.membershipLevels.create({
            data: {
                name: `LSPS_LVL_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
                description: 'payment.service.real test level',
                sortOrder: 1,
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.membershipLevelIds.push(level.id)
        testLevelId = level.id

        const user = await createTestUser({
            // 使用 188 开头的手机号，避开 199 前缀的后台清理
            phone: `188${String(Date.now()).slice(-8)}`,
        })
        testIds.userIds.push(user.id)
        testUser = { id: user.id }

        // 直接用 prisma.products.create 而非 createTestProduct，避免命中清理前缀
        const product = await prisma.products.create({
            data: {
                name: `LSPS_payment_service_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
                type: 1,
                levelId: level.id,
                priceMonthly: 9.99,
                priceYearly: 99,
                giftPoint: 0,
                status: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        testIds.productIds.push(product.id)
        testProduct = { id: product.id, name: product.name }
    })

    afterAll(async () => {
        if (!dbAvailable) return

        try {
            // 1. 删除所有创建的支付单
            if (createdTransactionIds.length > 0) {
                await prisma.paymentTransactions.deleteMany({
                    where: { id: { in: createdTransactionIds } },
                })
            }
            // 兜底：删除测试订单关联的所有支付单
            if (testIds.orderIds.length > 0) {
                await prisma.paymentTransactions.deleteMany({
                    where: { orderId: { in: testIds.orderIds } },
                })
            }
            // 2. 删除订单
            if (testIds.orderIds.length > 0) {
                await prisma.orders.deleteMany({
                    where: { id: { in: testIds.orderIds } },
                })
            }
            // 3. 删除产品
            if (testIds.productIds.length > 0) {
                await prisma.products.deleteMany({
                    where: { id: { in: testIds.productIds } },
                })
            }
            // 4. 删除会员级别
            if (testIds.membershipLevelIds.length > 0) {
                await prisma.membershipLevels.deleteMany({
                    where: { id: { in: testIds.membershipLevelIds } },
                })
            }
            // 5. 删除用户
            if (testIds.userIds.length > 0) {
                await prisma.users.deleteMany({
                    where: { id: { in: testIds.userIds } },
                })
            }
        } catch (err) {
            console.warn('清理测试数据失败：', err)
        }

        await disconnectTestDb()
    })

    beforeEach(async () => {
        // 重置所有 stub，避免跨用例污染
        adapterStub.createPayment.mockReset()
        adapterStub.verifyCallback.mockReset()
        adapterStub.queryOrder.mockReset()
        adapterStub.closeOrder.mockReset()
        handlePaymentSuccessMock.mockReset()
        handlePaymentSuccessMock.mockResolvedValue(undefined)

        // 还原 dao partial mock 为默认转发到真实实现
        const actualDao = await vi.importActual<
            typeof import('../../../server/services/payment/paymentTransaction.dao')
        >('../../../server/services/payment/paymentTransaction.dao')
        vi.mocked(findExpiredPendingTransactionsDao).mockReset()
        vi.mocked(findExpiredPendingTransactionsDao).mockImplementation(
            (...args: any[]) =>
                (actualDao.findExpiredPendingTransactionsDao as any)(...args)
        )
        vi.mocked(findPaymentTransactionByNoDao).mockReset()
        vi.mocked(findPaymentTransactionByNoDao).mockImplementation(
            (...args: any[]) =>
                (actualDao.findPaymentTransactionByNoDao as any)(...args)
        )
        vi.mocked(findPendingTransactionByOrderIdDao).mockReset()
        vi.mocked(findPendingTransactionByOrderIdDao).mockImplementation(
            (...args: any[]) =>
                (actualDao.findPendingTransactionByOrderIdDao as any)(...args)
        )
    })

    // ============================================================
    // createPaymentService
    // ============================================================
    describe('createPaymentService', () => {
        it('订单不存在时应返回错误', async () => {
            if (!dbAvailable) return
            const result = await createPaymentService({
                orderId: 999_999_999,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('订单不存在')
        })

        it('订单状态非 PENDING 时应返回错误', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder({ status: OrderStatus.PAID })
            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('订单状态不允许支付')
        })

        it('订单已过期应返回错误', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder({
                expiredAt: new Date(Date.now() - 60 * 1000),
            })
            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('订单已过期')
        })

        it('正常路径：应创建支付单，并写入 prepayId', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            adapterStub.createPayment.mockResolvedValueOnce({
                success: true,
                prepayId: 'prepay_test_123',
                codeUrl: 'weixin://wxpay/test',
                paymentParams: { foo: 'bar' },
            })

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })

            expect(result.success).toBe(true)
            expect(result.transactionNo).toBeTruthy()
            expect(result.codeUrl).toBe('weixin://wxpay/test')
            expect(result.paymentParams).toEqual({ foo: 'bar' })

            // 校验适配器被以正确参数调用（amount 转分、orderNo 用 LSD 开头的订单号）
            expect(adapterStub.createPayment).toHaveBeenCalledTimes(1)
            const callArg = adapterStub.createPayment.mock.calls[0][0]
            expect(callArg.orderNo).toBe(order.orderNo)
            expect(callArg.amount).toBe(Math.round(Number(order.amount) * 100))
            expect(callArg.expireMinutes).toBe(30)

            // 数据库中应存在该支付单且 prepayId 已写入
            const tx = await prisma.paymentTransactions.findUnique({
                where: { transactionNo: result.transactionNo! },
            })
            expect(tx).not.toBeNull()
            expect(tx!.prepayId).toBe('prepay_test_123')
            expect(tx!.status).toBe(PaymentTransactionStatus.PENDING)
            createdTransactionIds.push(tx!.id)
        })

        it('正常路径（无 prepayId 分支）：不会触发更新 prepayId 的额外调用', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            adapterStub.createPayment.mockResolvedValueOnce({
                success: true,
                paymentParams: { sign: 'abc' },
                h5Url: 'https://h5.example.com/pay',
            })

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.WAP,
                notifyUrl: NOTIFY_URL,
            })

            expect(result.success).toBe(true)
            expect(result.h5Url).toBe('https://h5.example.com/pay')

            const tx = await prisma.paymentTransactions.findUnique({
                where: { transactionNo: result.transactionNo! },
            })
            expect(tx!.prepayId).toBeNull()
            createdTransactionIds.push(tx!.id)
        })

        it('SDK 创建支付失败时应将支付单置为 FAILED 并返回错误', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            adapterStub.createPayment.mockResolvedValueOnce({
                success: false,
                errorMessage: 'mock SDK 失败',
            })

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('mock SDK 失败')

            // 数据库里应有一个 FAILED 状态的支付单
            const failed = await prisma.paymentTransactions.findFirst({
                where: { orderId: order.id, status: PaymentTransactionStatus.FAILED },
            })
            expect(failed).not.toBeNull()
            expect(failed!.errorMessage).toBe('mock SDK 失败')
            createdTransactionIds.push(failed!.id)
        })

        it('SDK 失败但未提供 errorMessage 时应使用默认提示', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            adapterStub.createPayment.mockResolvedValueOnce({ success: false })

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('创建支付失败')

            // 收集创建的失败支付单以便清理
            const failed = await prisma.paymentTransactions.findFirst({
                where: { orderId: order.id, status: PaymentTransactionStatus.FAILED },
            })
            if (failed) createdTransactionIds.push(failed.id)
        })

        it('已存在同渠道+同方式的待支付支付单时应复用该支付单', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            // 预先创建一个待支付支付单
            const existing = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(existing.id)

            adapterStub.createPayment.mockResolvedValueOnce({
                success: true,
                codeUrl: 'weixin://wxpay/reuse',
                paymentParams: { reused: true },
            })

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })

            expect(result.success).toBe(true)
            expect(result.transactionNo).toBe(existing.transactionNo)
            expect(result.codeUrl).toBe('weixin://wxpay/reuse')

            // 应当只有一个支付单（没有新建）
            const all = await prisma.paymentTransactions.findMany({
                where: { orderId: order.id },
            })
            expect(all.length).toBe(1)
        })

        it('复用支付单但 SDK 重新获取参数失败时应返回错误', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const existing = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(existing.id)

            adapterStub.createPayment.mockResolvedValueOnce({
                success: false,
                errorMessage: '重新获取失败',
            })

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })

            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('重新获取失败')
        })

        it('复用支付单但 SDK 失败且未提供错误信息时使用默认文案', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const existing = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(existing.id)

            adapterStub.createPayment.mockResolvedValueOnce({ success: false })

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('获取支付参数失败')
        })

        it('支付方式与已存在的待支付支付单不一致时：应将旧支付单设为 EXPIRED 并新建', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const old = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(old.id)

            adapterStub.createPayment.mockResolvedValueOnce({
                success: true,
                prepayId: 'prepay_new',
                paymentParams: { ok: 1 },
            })

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.MINI_PROGRAM, // 不同的方式
                notifyUrl: NOTIFY_URL,
            })

            expect(result.success).toBe(true)
            expect(result.transactionNo).not.toBe(old.transactionNo)

            // 旧的应已 EXPIRED
            const oldRefreshed = await prisma.paymentTransactions.findUnique({
                where: { id: old.id },
            })
            expect(oldRefreshed!.status).toBe(PaymentTransactionStatus.EXPIRED)

            // 新的应为 PENDING + 已写入 prepayId
            const fresh = await prisma.paymentTransactions.findUnique({
                where: { transactionNo: result.transactionNo! },
            })
            expect(fresh!.status).toBe(PaymentTransactionStatus.PENDING)
            expect(fresh!.prepayId).toBe('prepay_new')
            createdTransactionIds.push(fresh!.id)
        })

        it('适配器抛出异常时应在 catch 中返回 success=false', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            adapterStub.createPayment.mockRejectedValueOnce(new Error('boom'))

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('boom')

            // 抛出异常前已新建的待支付支付单需收集以清理
            const tx = await prisma.paymentTransactions.findFirst({
                where: { orderId: order.id },
            })
            if (tx) createdTransactionIds.push(tx.id)
        })

        it('非 Error 异常应回退到默认错误信息', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            adapterStub.createPayment.mockImplementationOnce(() => {
                throw 'string error'
            })

            const result = await createPaymentService({
                orderId: order.id,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                notifyUrl: NOTIFY_URL,
            })
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('创建支付失败')

            const tx = await prisma.paymentTransactions.findFirst({
                where: { orderId: order.id },
            })
            if (tx) createdTransactionIds.push(tx.id)
        })
    })

    // ============================================================
    // handlePaymentCallbackService
    // ============================================================
    describe('handlePaymentCallbackService', () => {
        const buildCallback = (raw: Record<string, unknown> = {}): CallbackData => ({
            raw,
            signature: 'sig',
            timestamp: '0',
            nonce: 'n',
            serial: 's',
        })

        it('适配器验签失败时应返回错误', async () => {
            if (!dbAvailable) return
            adapterStub.verifyCallback.mockResolvedValueOnce({
                success: false,
                errorMessage: '签名错误',
            })
            const result = await handlePaymentCallbackService(
                PaymentChannel.WECHAT,
                buildCallback()
            )
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('签名错误')
        })

        it('订单不存在时应返回错误', async () => {
            if (!dbAvailable) return
            adapterStub.verifyCallback.mockResolvedValueOnce({
                success: true,
                orderNo: 'NON_EXIST_ORDER',
                transactionId: 'wx_tx_001',
                amount: 100,
                paidAt: new Date(),
            })
            const result = await handlePaymentCallbackService(
                PaymentChannel.WECHAT,
                buildCallback()
            )
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('订单不存在')
        })

        it('找不到待支付支付单时应返回错误', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            // 故意不创建支付单
            adapterStub.verifyCallback.mockResolvedValueOnce({
                success: true,
                orderNo: order.orderNo,
                transactionId: 'wx_tx_002',
                amount: Math.round(Number(order.amount) * 100),
                paidAt: new Date(),
            })
            const result = await handlePaymentCallbackService(
                PaymentChannel.WECHAT,
                buildCallback()
            )
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('支付单不存在')
        })

        // 事务内幂等分支：service 在事务外查到 PENDING（通过 mock dao 转发返回 PENDING 副本），
        // 进入事务后真实 prisma 查询 DB 拿到 SUCCESS（提前在 DB 中置为 SUCCESS），
        // 触发 service 内 transaction 内的幂等跳过分支。
        it('支付单已 SUCCESS 时应直接返回 success=true（事务内幂等分支）', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            adapterStub.verifyCallback.mockResolvedValueOnce({
                success: true,
                orderNo: order.orderNo,
                transactionId: 'wx_tx_dup_callback',
                amount: Math.round(Number(order.amount) * 100),
                paidAt: new Date(),
            })

            // 让事务外的 findPendingTransactionByOrderIdDao 返回 PENDING 状态副本，
            // 让 service 进入 prisma.$transaction
            const pendingSnapshot = { ...tx, status: PaymentTransactionStatus.PENDING }
            vi.mocked(findPendingTransactionByOrderIdDao).mockResolvedValueOnce(
                pendingSnapshot as any
            )

            // 此时把 DB 真实状态改为 SUCCESS，事务内 findUnique 会真实查询并触发幂等跳过
            await prisma.paymentTransactions.update({
                where: { id: tx.id },
                data: { status: PaymentTransactionStatus.SUCCESS },
            })

            const result = await handlePaymentCallbackService(
                PaymentChannel.WECHAT,
                buildCallback()
            )
            expect(result.success).toBe(true)
            // 事务内 findUnique 发现已 SUCCESS，handlePaymentSuccess 不应被调用
            expect(handlePaymentSuccessMock).not.toHaveBeenCalled()
        })

        it('回调金额与支付单金额不匹配时应返回错误', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            adapterStub.verifyCallback.mockResolvedValueOnce({
                success: true,
                orderNo: order.orderNo,
                transactionId: 'wx_tx_004',
                amount: 99999, // 故意错的金额
                paidAt: new Date(),
            })

            const result = await handlePaymentCallbackService(
                PaymentChannel.WECHAT,
                buildCallback()
            )
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('支付金额不匹配')
        })

        it('正常路径：应在事务中更新支付单 + 订单状态并调用 handlePaymentSuccess', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            const paidAt = new Date()
            adapterStub.verifyCallback.mockResolvedValueOnce({
                success: true,
                orderNo: order.orderNo,
                transactionId: 'wx_tx_OK',
                amount: Math.round(Number(order.amount) * 100),
                paidAt,
            })

            const result = await handlePaymentCallbackService(
                PaymentChannel.WECHAT,
                buildCallback({ raw: 'data' })
            )
            expect(result.success).toBe(true)

            const updatedTx = await prisma.paymentTransactions.findUnique({
                where: { id: tx.id },
            })
            expect(updatedTx!.status).toBe(PaymentTransactionStatus.SUCCESS)
            expect(updatedTx!.outTradeNo).toBe('wx_tx_OK')

            const updatedOrder = await prisma.orders.findUnique({
                where: { id: order.id },
            })
            expect(updatedOrder!.status).toBe(OrderStatus.PAID)

            expect(handlePaymentSuccessMock).toHaveBeenCalledTimes(1)
        })

        it('正常路径：verifyCallback 未返回 paidAt 时应使用当前时间', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            adapterStub.verifyCallback.mockResolvedValueOnce({
                success: true,
                orderNo: order.orderNo,
                transactionId: 'wx_tx_no_paid_at',
                amount: Math.round(Number(order.amount) * 100),
                // paidAt 缺失
            })

            const before = Date.now()
            const result = await handlePaymentCallbackService(
                PaymentChannel.WECHAT,
                buildCallback()
            )
            expect(result.success).toBe(true)

            const updated = await prisma.paymentTransactions.findUnique({
                where: { id: tx.id },
            })
            expect(updated!.status).toBe(PaymentTransactionStatus.SUCCESS)
            expect(updated!.paidAt).not.toBeNull()
            expect(updated!.paidAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
        })

        it('适配器异常时应返回错误', async () => {
            if (!dbAvailable) return
            adapterStub.verifyCallback.mockRejectedValueOnce(new Error('verify boom'))
            const result = await handlePaymentCallbackService(
                PaymentChannel.WECHAT,
                buildCallback()
            )
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('verify boom')
        })

        it('非 Error 异常应回退默认错误', async () => {
            if (!dbAvailable) return
            adapterStub.verifyCallback.mockImplementationOnce(() => {
                throw 'oops'
            })
            const result = await handlePaymentCallbackService(
                PaymentChannel.WECHAT,
                buildCallback()
            )
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('处理回调失败')
        })
    })

    // ============================================================
    // queryPaymentStatusService
    // ============================================================
    describe('queryPaymentStatusService', () => {
        it('应返回数据库中的支付单（含 order + product）', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            const result = await queryPaymentStatusService(tx.transactionNo)
            expect(result).not.toBeNull()
            expect(result!.id).toBe(tx.id)
            expect(result!.order).toBeDefined()
            expect(result!.order.product).toBeDefined()
        })

        it('支付单不存在时应返回 null', async () => {
            if (!dbAvailable) return
            const result = await queryPaymentStatusService('NON_EXIST_PAY_NO')
            expect(result).toBeNull()
        })
    })

    // ============================================================
    // queryPaymentResultService
    // ============================================================
    describe('queryPaymentResultService', () => {
        it('支付单不存在时应返回 paid=false 与错误', async () => {
            if (!dbAvailable) return
            const result = await queryPaymentResultService('NON_EXIST_PAY_NO')
            expect(result.success).toBe(false)
            expect(result.paid).toBe(false)
            expect(result.errorMessage).toBe('支付单不存在')
        })

        it('支付单已 SUCCESS 时应直接返回 paid=true', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)
            await prisma.paymentTransactions.update({
                where: { id: tx.id },
                data: { status: PaymentTransactionStatus.SUCCESS },
            })

            const result = await queryPaymentResultService(tx.transactionNo)
            expect(result.success).toBe(true)
            expect(result.paid).toBe(true)
            // 不应触发 SDK 查询
            expect(adapterStub.queryOrder).not.toHaveBeenCalled()
        })

        it('支付单为 FAILED/EXPIRED 等非 PENDING 状态时返回 paid=false', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)
            await prisma.paymentTransactions.update({
                where: { id: tx.id },
                data: { status: PaymentTransactionStatus.FAILED },
            })

            const result = await queryPaymentResultService(tx.transactionNo)
            expect(result.success).toBe(true)
            expect(result.paid).toBe(false)
            expect(adapterStub.queryOrder).not.toHaveBeenCalled()
        })

        it('SDK 查询失败时应返回错误', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            adapterStub.queryOrder.mockResolvedValueOnce({
                success: false,
                errorMessage: '查询失败',
            })

            const result = await queryPaymentResultService(tx.transactionNo)
            expect(result.success).toBe(false)
            expect(result.paid).toBe(false)
            expect(result.errorMessage).toBe('查询失败')
        })

        it('SDK 返回 SUCCESS 时应在事务内更新支付单+订单并调用 handlePaymentSuccess', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            adapterStub.queryOrder.mockResolvedValueOnce({
                success: true,
                tradeState: 'SUCCESS',
                transactionId: 'wx_query_OK',
                paidAt: new Date(),
            })

            const result = await queryPaymentResultService(tx.transactionNo)
            expect(result.success).toBe(true)
            expect(result.paid).toBe(true)

            const updated = await prisma.paymentTransactions.findUnique({
                where: { id: tx.id },
            })
            expect(updated!.status).toBe(PaymentTransactionStatus.SUCCESS)
            expect(updated!.outTradeNo).toBe('wx_query_OK')

            const updatedOrder = await prisma.orders.findUnique({
                where: { id: order.id },
            })
            expect(updatedOrder!.status).toBe(OrderStatus.PAID)
            expect(handlePaymentSuccessMock).toHaveBeenCalledTimes(1)
        })

        it('SDK 返回 SUCCESS 但 paidAt 缺失时应使用当前时间', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            adapterStub.queryOrder.mockResolvedValueOnce({
                success: true,
                tradeState: 'SUCCESS',
                transactionId: 'wx_query_no_paidAt',
            })

            const before = Date.now()
            const result = await queryPaymentResultService(tx.transactionNo)
            expect(result.paid).toBe(true)

            const updated = await prisma.paymentTransactions.findUnique({
                where: { id: tx.id },
            })
            expect(updated!.paidAt).not.toBeNull()
            expect(updated!.paidAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
        })

        // 同上：mock 事务外的 findPaymentTransactionByNoDao 返回 PENDING 副本，
        // 让 service 进入事务；DB 真实状态预先置为 SUCCESS，触发事务内幂等分支
        it('SDK 返回 SUCCESS，但事务内发现已 SUCCESS 时应跳过', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            adapterStub.queryOrder.mockResolvedValueOnce({
                success: true,
                tradeState: 'SUCCESS',
                transactionId: 'wx_query_dup',
                paidAt: new Date(),
            })

            // 真实从 DB 查到完整记录（含 order + product），保证 service 内 transaction.order 可访问
            const realRecord = await prisma.paymentTransactions.findUnique({
                where: { id: tx.id },
                include: { order: { include: { product: true } } },
            })
            // 让 service 在事务外查到 PENDING（实际 DB 已是 SUCCESS）
            vi.mocked(findPaymentTransactionByNoDao).mockResolvedValueOnce({
                ...(realRecord as any),
                status: PaymentTransactionStatus.PENDING,
            })

            // 把 DB 真实状态改为 SUCCESS，事务内 findUnique 真实查询会触发幂等跳过
            await prisma.paymentTransactions.update({
                where: { id: tx.id },
                data: { status: PaymentTransactionStatus.SUCCESS },
            })

            const result = await queryPaymentResultService(tx.transactionNo)
            expect(result.success).toBe(true)
            expect(result.paid).toBe(true)
            // 因为幂等分支提前 return，handlePaymentSuccess 不应被调用
            expect(handlePaymentSuccessMock).not.toHaveBeenCalled()
        })

        it('SDK 返回非 SUCCESS（NOTPAY）时应返回 paid=false', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            adapterStub.queryOrder.mockResolvedValueOnce({
                success: true,
                tradeState: 'NOTPAY',
            })

            const result = await queryPaymentResultService(tx.transactionNo)
            expect(result.success).toBe(true)
            expect(result.paid).toBe(false)
        })

        it('适配器抛异常时应在 catch 中返回 paid=false', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)

            adapterStub.queryOrder.mockRejectedValueOnce(new Error('query boom'))

            const result = await queryPaymentResultService(tx.transactionNo)
            expect(result.success).toBe(false)
            expect(result.paid).toBe(false)
            expect(result.errorMessage).toBe('query boom')
        })

        it('非 Error 异常应回退默认错误', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            const tx = await createPaymentTransactionDao({
                orderId: order.id,
                amount: Number(order.amount),
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            })
            createdTransactionIds.push(tx.id)
            adapterStub.queryOrder.mockImplementationOnce(() => {
                throw 'plain'
            })
            const result = await queryPaymentResultService(tx.transactionNo)
            expect(result.success).toBe(false)
            expect(result.errorMessage).toBe('查询失败')
        })
    })

    // ============================================================
    // handleExpiredPaymentTransactionsService
    // ============================================================
    describe('handleExpiredPaymentTransactionsService', () => {
        it('当前没有过期的支付单时应返回 0', async () => {
            if (!dbAvailable) return
            // 先把任何残余的 PENDING 全部置为 EXPIRED 以避免噪声（不影响其它用例）
            await prisma.paymentTransactions.updateMany({
                where: {
                    status: PaymentTransactionStatus.PENDING,
                    expiredAt: { lt: new Date() },
                },
                data: { status: PaymentTransactionStatus.EXPIRED },
            })

            const count = await handleExpiredPaymentTransactionsService()
            expect(count).toBe(0)
        })

        it('应将过期且 PENDING 的支付单置为 EXPIRED 并返回数量', async () => {
            if (!dbAvailable) return
            const order = await createPendingOrder()
            // 直接构造一条已过期的 PENDING 支付单
            const expiredAt = new Date(Date.now() - 60 * 1000)
            const stale = await prisma.paymentTransactions.create({
                data: {
                    transactionNo: `PAY_TEST_EXP_${Date.now()}`,
                    order: { connect: { id: order.id } },
                    amount: Number(order.amount),
                    paymentChannel: PaymentChannel.WECHAT,
                    paymentMethod: PaymentMethod.SCAN_CODE,
                    status: PaymentTransactionStatus.PENDING,
                    expiredAt,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdTransactionIds.push(stale.id)

            const count = await handleExpiredPaymentTransactionsService()
            expect(count).toBeGreaterThanOrEqual(1)

            const refreshed = await prisma.paymentTransactions.findUnique({
                where: { id: stale.id },
            })
            expect(refreshed!.status).toBe(PaymentTransactionStatus.EXPIRED)
        })

        it('查询出错时应抛出异常', async () => {
            if (!dbAvailable) return
            // 让 findExpiredPendingTransactionsDao 抛出异常一次，验证 service 不吞错而是 throw
            vi.mocked(findExpiredPendingTransactionsDao).mockRejectedValueOnce(
                new Error('db down')
            )
            await expect(
                handleExpiredPaymentTransactionsService()
            ).rejects.toThrow('db down')
        })
    })
})
