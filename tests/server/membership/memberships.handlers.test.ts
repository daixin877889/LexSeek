/**
 * server/api/v1/memberships/** handler 单元覆盖（10 个 handler）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/membership/benefit.service', () => ({
    getUserBenefitsService: vi.fn(),
}))
vi.mock('~~/server/services/membership/userMembership.service', () => ({
    getMembershipHistoryService: vi.fn(),
    getCurrentMembershipService: vi.fn(),
}))
vi.mock('~~/server/services/membership/membershipLevel.dao', () => ({
    findMembershipLevelByIdDao: vi.fn(),
    findAllActiveMembershipLevelsDao: vi.fn(),
}))
vi.mock('~~/server/services/membership/membershipUpgrade.service', () => ({
    calculateUpgradePriceService: vi.fn(),
    executeMembershipUpgradeService: vi.fn(),
    getUpgradeOptionsService: vi.fn(),
    getUserUpgradeRecordsService: vi.fn(),
}))
vi.mock('~~/server/services/payment/order.service', () => ({
    createOrderService: vi.fn(),
}))
vi.mock('~~/server/services/payment/payment.service', () => ({
    createPaymentService: vi.fn(),
}))

;(globalThis as any).prisma = {
    $transaction: vi.fn(async (fn: any) => fn({
        orders: { findUnique: vi.fn() },
    })),
}

import { getUserBenefitsService } from '~~/server/services/membership/benefit.service'
import { getMembershipHistoryService, getCurrentMembershipService } from '~~/server/services/membership/userMembership.service'
import { findMembershipLevelByIdDao, findAllActiveMembershipLevelsDao } from '~~/server/services/membership/membershipLevel.dao'
import {
    calculateUpgradePriceService,
    executeMembershipUpgradeService,
    getUpgradeOptionsService,
    getUserUpgradeRecordsService,
} from '~~/server/services/membership/membershipUpgrade.service'
import { createOrderService } from '~~/server/services/payment/order.service'
import { createPaymentService } from '~~/server/services/payment/payment.service'

const mBenefits = vi.mocked(getUserBenefitsService)
const mHistory = vi.mocked(getMembershipHistoryService)
const mCurrent = vi.mocked(getCurrentMembershipService)
const mLevelById = vi.mocked(findMembershipLevelByIdDao)
const mLevels = vi.mocked(findAllActiveMembershipLevelsDao)
const mCalcPrice = vi.mocked(calculateUpgradePriceService)
const mExecuteUpgrade = vi.mocked(executeMembershipUpgradeService)
const mUpgradeOpts = vi.mocked(getUpgradeOptionsService)
const mUpgradeRecords = vi.mocked(getUserUpgradeRecordsService)
const mCreateOrder = vi.mocked(createOrderService)
const mCreatePayment = vi.mocked(createPaymentService)

const { default: benefitsHandler } = await import('../../../server/api/v1/memberships/benefits.get')
const { default: historyHandler } = await import('../../../server/api/v1/memberships/history.get')
const { default: meHandler } = await import('../../../server/api/v1/memberships/me.get')
const { default: levelDetailHandler } = await import('../../../server/api/v1/memberships/levels/[id].get')
const { default: levelsListHandler } = await import('../../../server/api/v1/memberships/levels/index.get')
const { default: calculateHandler } = await import('../../../server/api/v1/memberships/upgrade/calculate.post')
const { default: upgradeHandler } = await import('../../../server/api/v1/memberships/upgrade/index.post')
const { default: optionsHandler } = await import('../../../server/api/v1/memberships/upgrade/options.get')
const { default: payHandler } = await import('../../../server/api/v1/memberships/upgrade/pay.post')
const { default: recordsHandler } = await import('../../../server/api/v1/memberships/upgrade/records.get')

describe('GET /api/v1/memberships/benefits', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mBenefits.mockResolvedValue([{ code: 'B' }] as any)
        // 注：handler 用的是 event.context.auth?.userId（非 user.id）
        const res: any = await benefitsHandler({ context: { auth: { userId: 100 } } } as any)
        expectSuccess(res)
    })

    it('未登录 → 401', async () => {
        const res: any = await benefitsHandler({ context: {} } as any)
        expectError(res, 401)
    })

    it('service 抛错 → 500', async () => {
        mBenefits.mockRejectedValueOnce(new Error('svc'))
        const res: any = await benefitsHandler({ context: { auth: { userId: 100 } } } as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/memberships/history', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mHistory.mockResolvedValue({ list: [], total: 0 } as any)
        const res: any = await historyHandler(makeEvent({ userId: 100, query: { page: '2', pageSize: '5' } }) as any)
        expectSuccess(res, d => expect(d.page).toBe(2))
    })

    it('未登录 → 401', async () => {
        const res: any = await historyHandler(makeEvent({}) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await historyHandler(makeEvent({ userId: 100, query: { page: 'abc' } }) as any)
        expectError(res, 400)
    })

    it('service 抛错 → 500', async () => {
        mHistory.mockRejectedValueOnce(new Error('svc'))
        const res: any = await historyHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/memberships/me', () => {
    beforeEach(() => vi.clearAllMocks())

    it('有有效会员', async () => {
        mCurrent.mockResolvedValue({ levelId: 1, levelName: 'VIP', endDate: '2027-01-01' } as any)
        const res: any = await meHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => expect(d.expiresAt).toBe('2027-01-01'))
    })

    it('无会员', async () => {
        mCurrent.mockResolvedValue(null as any)
        const res: any = await meHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res, d => expect(d).toBeNull())
    })

    it('未登录 → 401', async () => {
        const res: any = await meHandler(makeEvent({}) as any)
        expectError(res, 401)
    })

    it('service 抛错 → 500', async () => {
        mCurrent.mockRejectedValueOnce(new Error('svc'))
        const res: any = await meHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/memberships/levels/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mLevelById.mockResolvedValue({ id: 1, name: 'VIP', description: '', sortOrder: 1, status: 1 } as any)
        const res: any = await levelDetailHandler(makeEvent({ params: { id: '1' } }) as any)
        expectSuccess(res, d => expect(d.id).toBe(1))
    })

    it('id 非数字 → 400', async () => {
        const res: any = await levelDetailHandler(makeEvent({ params: { id: 'abc' } }) as any)
        expectError(res, 400)
    })

    it('级别不存在 → 404', async () => {
        mLevelById.mockResolvedValue(null as any)
        const res: any = await levelDetailHandler(makeEvent({ params: { id: '1' } }) as any)
        expectError(res, 404)
    })

    it('DAO 抛错 → 500', async () => {
        mLevelById.mockRejectedValueOnce(new Error('db'))
        const res: any = await levelDetailHandler(makeEvent({ params: { id: '1' } }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/memberships/levels', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mLevels.mockResolvedValue([
            { id: 1, name: 'V1', description: '', sortOrder: 1, status: 1 },
            { id: 2, name: 'V2', description: '', sortOrder: 2, status: 1 },
        ] as any)
        const res: any = await levelsListHandler(makeEvent({}) as any)
        expectSuccess(res, d => expect(d).toHaveLength(2))
    })

    it('DAO 抛错 → 500', async () => {
        mLevels.mockRejectedValueOnce(new Error('db'))
        const res: any = await levelsListHandler(makeEvent({}) as any)
        expectError(res, 500)
    })
})

describe('POST /api/v1/memberships/upgrade/calculate', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mCalcPrice.mockResolvedValue({ success: true, result: { upgradePrice: 100 } } as any)
        const res: any = await calculateHandler(makeEvent({ userId: 100, body: { targetLevelId: 2 } }) as any)
        expectSuccess(res)
    })

    it('未登录 → 401', async () => {
        const res: any = await calculateHandler(makeEvent({ body: { targetLevelId: 2 } }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await calculateHandler(makeEvent({ userId: 100, body: { targetLevelId: -1 } }) as any)
        expectError(res, 400)
    })

    it('service success=false → 400', async () => {
        mCalcPrice.mockResolvedValue({ success: false, errorMessage: '不支持升级' } as any)
        const res: any = await calculateHandler(makeEvent({ userId: 100, body: { targetLevelId: 2 } }) as any)
        expectError(res, 400, '不支持升级')
    })

    it('service 抛错 → 500', async () => {
        mCalcPrice.mockRejectedValueOnce(new Error('svc'))
        const res: any = await calculateHandler(makeEvent({ userId: 100, body: { targetLevelId: 2 } }) as any)
        expectError(res, 500)
    })
})

describe('POST /api/v1/memberships/upgrade', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma.$transaction.mockImplementation(async (fn: any) => fn({
            orders: { findUnique: vi.fn().mockResolvedValue({ id: 9, userId: 100, status: 1, orderNo: 'ON-1' }) },
        }))
    })

    it('happy path', async () => {
        mExecuteUpgrade.mockResolvedValue({ success: true, newMembership: { id: 222 } } as any)
        const res: any = await upgradeHandler(makeEvent({
            userId: 100, body: { targetLevelId: 2, orderId: 9 },
        }) as any)
        expectSuccess(res, d => expect(d.membershipId).toBe(222))
    })

    it('未登录 → 401', async () => {
        const res: any = await upgradeHandler(makeEvent({ body: { targetLevelId: 2, orderId: 9 } }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await upgradeHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })

    it('订单不存在 → 400', async () => {
        ;(globalThis as any).prisma.$transaction.mockImplementation(async (fn: any) => fn({
            orders: { findUnique: vi.fn().mockResolvedValue(null) },
        }))
        const res: any = await upgradeHandler(makeEvent({ userId: 100, body: { targetLevelId: 2, orderId: 9 } }) as any)
        expectError(res, 400, '订单不存在')
    })

    it('订单非本人 → 400', async () => {
        ;(globalThis as any).prisma.$transaction.mockImplementation(async (fn: any) => fn({
            orders: { findUnique: vi.fn().mockResolvedValue({ id: 9, userId: 999, status: 1, orderNo: 'O' }) },
        }))
        const res: any = await upgradeHandler(makeEvent({ userId: 100, body: { targetLevelId: 2, orderId: 9 } }) as any)
        expectError(res, 400, '不属于')
    })

    it('订单未支付 → 400', async () => {
        ;(globalThis as any).prisma.$transaction.mockImplementation(async (fn: any) => fn({
            orders: { findUnique: vi.fn().mockResolvedValue({ id: 9, userId: 100, status: 0, orderNo: 'O' }) },
        }))
        const res: any = await upgradeHandler(makeEvent({ userId: 100, body: { targetLevelId: 2, orderId: 9 } }) as any)
        expectError(res, 400, '未支付')
    })

    it('execute success=false → 400', async () => {
        mExecuteUpgrade.mockResolvedValue({ success: false, errorMessage: '已经是顶级' } as any)
        const res: any = await upgradeHandler(makeEvent({ userId: 100, body: { targetLevelId: 2, orderId: 9 } }) as any)
        expectError(res, 400, '已经是顶级')
    })

    it('事务抛错 → 500', async () => {
        ;(globalThis as any).prisma.$transaction.mockRejectedValueOnce(new Error('tx'))
        const res: any = await upgradeHandler(makeEvent({ userId: 100, body: { targetLevelId: 2, orderId: 9 } }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/memberships/upgrade/options', () => {
    beforeEach(() => vi.clearAllMocks())

    it('有当前会员', async () => {
        mUpgradeOpts.mockResolvedValue({
            options: [{ levelId: 2, remainingDays: 100 }],
            currentMembership: { id: 1, levelId: 1, level: { name: 'V1' }, endDate: '2027' },
        } as any)
        const res: any = await optionsHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res, d => expect(d.currentMembership.levelName).toBe('V1'))
    })

    it('无当前会员', async () => {
        mUpgradeOpts.mockResolvedValue({ options: [], currentMembership: null } as any)
        const res: any = await optionsHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res, d => expect(d.options).toEqual([]))
    })

    it('未登录 → 401', async () => {
        const res: any = await optionsHandler(makeEvent({ query: {} }) as any)
        expectError(res, 401)
    })

    it('service 抛错 → 500', async () => {
        mUpgradeOpts.mockRejectedValueOnce(new Error('svc'))
        const res: any = await optionsHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectError(res, 500)
    })
})

describe('POST /api/v1/memberships/upgrade/pay', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mCalcPrice.mockResolvedValue({ success: true, result: { upgradePrice: 100, targetProduct: { id: 1, name: 'V2' } } } as any)
        mCreateOrder.mockResolvedValue({ success: true, order: { id: 9, orderNo: 'O' } } as any)
        mCreatePayment.mockResolvedValue({ success: true, transactionNo: 'T' } as any)
    })

    const baseBody = {
        targetLevelId: 2,
        paymentChannel: 'wechat',
        paymentMethod: 'scan_code',
    }

    it('happy path', async () => {
        const res: any = await payHandler(makeEvent({ userId: 100, body: baseBody }) as any)
        expectSuccess(res, d => expect(d.amount).toBe(100))
    })

    it('未登录 → 401', async () => {
        const res: any = await payHandler(makeEvent({ body: baseBody }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await payHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })

    it('小程序无 openid → 400', async () => {
        const res: any = await payHandler(makeEvent({
            userId: 100, body: { ...baseBody, paymentMethod: 'mini_program' },
        }) as any)
        expectError(res, 400, 'openid')
    })

    it('计算失败 → 400', async () => {
        mCalcPrice.mockResolvedValue({ success: false, errorMessage: '不支持' } as any)
        const res: any = await payHandler(makeEvent({ userId: 100, body: baseBody }) as any)
        expectError(res, 400, '不支持')
    })

    it('升级价 0 → 400', async () => {
        mCalcPrice.mockResolvedValue({ success: true, result: { upgradePrice: 0, targetProduct: { id: 1, name: 'V2' } } } as any)
        const res: any = await payHandler(makeEvent({ userId: 100, body: baseBody }) as any)
        expectError(res, 400, '无需支付')
    })

    it('创建订单失败 → 400', async () => {
        mCreateOrder.mockResolvedValue({ success: false, errorMessage: '库存不足' } as any)
        const res: any = await payHandler(makeEvent({ userId: 100, body: baseBody }) as any)
        expectError(res, 400, '库存不足')
    })

    it('创建支付失败 → 400', async () => {
        mCreatePayment.mockResolvedValue({ success: false, errorMessage: '微信失败' } as any)
        const res: any = await payHandler(makeEvent({ userId: 100, body: baseBody }) as any)
        expectError(res, 400, '微信失败')
    })

    it('service 抛错 → 500', async () => {
        mCalcPrice.mockRejectedValueOnce(new Error('svc'))
        const res: any = await payHandler(makeEvent({ userId: 100, body: baseBody }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/memberships/upgrade/records', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        mUpgradeRecords.mockResolvedValue({ list: [], total: 5 } as any)
        const res: any = await recordsHandler(makeEvent({ userId: 100, query: { page: '1', pageSize: '5' } }) as any)
        expectSuccess(res, d => {
            expect(d.pagination.totalPages).toBe(1)
        })
    })

    it('未登录 → 401', async () => {
        const res: any = await recordsHandler(makeEvent({ query: {} }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await recordsHandler(makeEvent({ userId: 100, query: { pageSize: '-1' } }) as any)
        expectError(res, 400)
    })

    it('service 抛错 → 500', async () => {
        mUpgradeRecords.mockRejectedValueOnce(new Error('svc'))
        const res: any = await recordsHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectError(res, 500)
    })
})
