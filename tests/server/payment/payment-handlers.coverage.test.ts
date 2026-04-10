/**
 * 支付成功处理器覆盖测试
 *
 * 覆盖 membershipHandler.ts 和 pointsHandler.ts 的逻辑分支
 *
 * **Feature: payment-handlers-coverage**
 * **Validates: Requirements 10.7, 10.8**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { membershipHandler } from '../../../server/services/payment/handlers/membershipHandler'
import { pointsHandler } from '../../../server/services/payment/handlers/pointsHandler'
import { ProductType } from '../../../shared/types/product'
import { OrderType } from '../../../shared/types/payment'

// Mock 依赖
vi.mock('../../../server/services/membership/userMembership.service', () => ({
    createMembershipService: vi.fn().mockResolvedValue({
        id: 1,
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }),
}))

vi.mock('../../../server/services/point/pointRecords.service', () => ({
    createPointRecordService: vi.fn().mockResolvedValue({ id: 1 }),
}))

vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// 辅助函数
const createMockOrder = (overrides: Record<string, any> = {}) => ({
    id: 1,
    userId: 100,
    orderNo: 'LSD20240101000001',
    productId: 1,
    amount: 999,
    duration: 1,
    durationUnit: 'year',
    orderType: OrderType.PURCHASE,
    status: 2,
    expiredAt: new Date(),
    paidAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    remark: null,
    product: {
        id: 1,
        name: '测试商品',
        type: ProductType.MEMBERSHIP,
        levelId: 1,
        giftPoint: 100,
        pointAmount: null,
        status: 1,
        ...overrides.product,
    },
    ...overrides,
})

describe('membershipHandler 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('canHandle', () => {
        it('会员商品 + 新购订单应返回 true', () => {
            const order = createMockOrder()
            expect(membershipHandler.canHandle(order as any)).toBe(true)
        })

        it('会员商品 + 升级订单应返回 false', () => {
            const order = createMockOrder({ orderType: OrderType.UPGRADE })
            expect(membershipHandler.canHandle(order as any)).toBe(false)
        })

        it('积分商品应返回 false', () => {
            const order = createMockOrder({
                product: { type: ProductType.POINTS },
            })
            expect(membershipHandler.canHandle(order as any)).toBe(false)
        })

        it('product 为 null 应返回 false', () => {
            const order = createMockOrder({ product: null })
            expect(membershipHandler.canHandle(order as any)).toBe(false)
        })
    })

    describe('handle', () => {
        it('商品未关联会员级别应抛出错误', async () => {
            const order = createMockOrder({
                product: { type: ProductType.MEMBERSHIP, levelId: null, giftPoint: 0 },
            })

            await expect(
                membershipHandler.handle(order as any, {} as any)
            ).rejects.toThrow('会员商品未关联会员级别')
        })

        it('有赠送积分时应创建积分记录', async () => {
            const { createPointRecordService } = await import(
                '../../../server/services/point/pointRecords.service'
            )

            const order = createMockOrder({
                product: {
                    type: ProductType.MEMBERSHIP,
                    levelId: 1,
                    name: '测试会员',
                    giftPoint: 200,
                },
            })

            await membershipHandler.handle(order as any, {} as any)

            expect(createPointRecordService).toHaveBeenCalled()
        })

        it('无赠送积分时不应创建积分记录', async () => {
            const { createPointRecordService } = await import(
                '../../../server/services/point/pointRecords.service'
            )
            vi.mocked(createPointRecordService).mockClear()

            const order = createMockOrder({
                product: {
                    type: ProductType.MEMBERSHIP,
                    levelId: 1,
                    name: '测试会员',
                    giftPoint: 0,
                },
            })

            await membershipHandler.handle(order as any, {} as any)

            expect(createPointRecordService).not.toHaveBeenCalled()
        })

        it('giftPoint 为 null 时不应创建积分记录', async () => {
            const { createPointRecordService } = await import(
                '../../../server/services/point/pointRecords.service'
            )
            vi.mocked(createPointRecordService).mockClear()

            const order = createMockOrder({
                product: {
                    type: ProductType.MEMBERSHIP,
                    levelId: 1,
                    name: '测试会员',
                    giftPoint: null,
                },
            })

            await membershipHandler.handle(order as any, {} as any)

            expect(createPointRecordService).not.toHaveBeenCalled()
        })
    })
})

describe('pointsHandler 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('canHandle', () => {
        it('积分商品应返回 true', () => {
            const order = createMockOrder({
                product: { type: ProductType.POINTS, pointAmount: 100 },
            })
            expect(pointsHandler.canHandle(order as any)).toBe(true)
        })

        it('会员商品应返回 false', () => {
            const order = createMockOrder({
                product: { type: ProductType.MEMBERSHIP },
            })
            expect(pointsHandler.canHandle(order as any)).toBe(false)
        })

        it('product 为 null 应返回 false', () => {
            const order = createMockOrder({ product: null })
            expect(pointsHandler.canHandle(order as any)).toBe(false)
        })
    })

    describe('handle', () => {
        it('积分商品未设置积分数量应抛出错误', async () => {
            const order = createMockOrder({
                product: { type: ProductType.POINTS, pointAmount: null, name: '测试' },
            })

            await expect(
                pointsHandler.handle(order as any, {} as any)
            ).rejects.toThrow('积分商品未设置积分数量')
        })

        it('应正确计算总积分（pointAmount * duration）', async () => {
            const { createPointRecordService } = await import(
                '../../../server/services/point/pointRecords.service'
            )

            const order = createMockOrder({
                duration: 5,
                product: { type: ProductType.POINTS, pointAmount: 100, name: '积分包' },
            })

            await pointsHandler.handle(order as any, {} as any)

            expect(createPointRecordService).toHaveBeenCalledWith(
                expect.objectContaining({
                    pointAmount: 500, // 100 * 5
                }),
                expect.anything()
            )
        })

        it('pointAmount 为 0 时应抛出错误', async () => {
            const order = createMockOrder({
                product: { type: ProductType.POINTS, pointAmount: 0, name: '测试' },
            })

            await expect(
                pointsHandler.handle(order as any, {} as any)
            ).rejects.toThrow('积分商品未设置积分数量')
        })
    })
})
