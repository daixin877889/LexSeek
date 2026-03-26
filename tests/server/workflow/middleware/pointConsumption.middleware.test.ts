import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', { warn: vi.fn(), info: vi.fn(), error: vi.fn() })

// Mock 服务层函数
vi.mock('~~/server/services/membership/userMembership.service', () => ({
    getCurrentMembershipService: vi.fn(),
}))
vi.mock('~~/server/services/point/pointConsumption.service', () => ({
    checkPointsService: vi.fn(),
    consumePointsService: vi.fn(),
}))

// Mock langchain dependencies
vi.mock('@langchain/langgraph', () => ({
    interrupt: vi.fn(),
}))
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config) => config),
}))

import { getTokenCount, pointConsumptionMiddleware } from '~~/server/services/workflow/middleware/pointConsumption.middleware'
import { getCurrentMembershipService } from '~~/server/services/membership/userMembership.service'
import { checkPointsService, consumePointsService } from '~~/server/services/point/pointConsumption.service'
import { interrupt } from '@langchain/langgraph'

describe('getTokenCount', () => {
    it('优先使用 usage_metadata.total_tokens', () => {
        const msg = {
            usage_metadata: { total_tokens: 5000, input_tokens: 3000, output_tokens: 2000 },
            content: '短文本',
        }
        expect(getTokenCount(msg as any)).toBe(5000)
    })

    it('usage_metadata 缺失时基于中文内容估算（2字符/token），受 100 保底限制', () => {
        const content = '这是一段中文法律文本内容用于测试保底估算规则' // 22 个字符 → ceil(22/2) = 11，低于 100 保底
        const msg = { content, usage_metadata: undefined }
        expect(getTokenCount(msg as any)).toBe(100)
    })

    it('usage_metadata 缺失 + 长文本时基于内容估算', () => {
        // 创建一段超过 200 字符的文本，使估算值超过 100
        const content = '这是一段非常长的中文法律文本内容'.repeat(10) // 150 个字符 → ceil(150/2) = 75... 还不够
        const longContent = content + content // 300 字符 → ceil(300/2) = 150
        const msg = { content: longContent, usage_metadata: undefined }
        expect(getTokenCount(msg as any)).toBe(Math.ceil(longContent.length / 2))
    })

    it('包含 thinking 内容时计入估算', () => {
        // 需要总估算超过 100
        const content = '这是一段较长的回复内容用于测试估算'.repeat(5) // 90 字符 → 45 tokens
        const thinking = '这是一段很长的思考过程内容用于确保估算值超过保底值'.repeat(5) // 115 字符 → 58 tokens
        const msg = {
            content,
            usage_metadata: undefined,
            additional_kwargs: { thinking: [{ thinking }] },
        }
        const expected = Math.ceil(content.length / 2) + Math.ceil(thinking.length / 2)
        expect(expected).toBeGreaterThan(100)
        expect(getTokenCount(msg as any)).toBe(expected)
    })

    it('包含 tool_calls 时计入估算', () => {
        // 需要总估算超过 100
        const content = '这是一段较长的内容用于测试工具调用估算'.repeat(5) // 95 字符
        const toolCalls = [{ id: 'tc1', name: 'search', args: { query: '法律条文检索测试查询内容'.repeat(5) } }]
        const toolCallsStr = JSON.stringify(toolCalls)
        const msg = {
            content,
            usage_metadata: undefined,
            tool_calls: toolCalls,
        }
        const expected = Math.ceil(content.length / 2) + Math.ceil(toolCallsStr.length / 2)
        expect(expected).toBeGreaterThan(100)
        expect(getTokenCount(msg as any)).toBe(expected)
    })

    it('最低返回 100 tokens', () => {
        const msg = { content: '', usage_metadata: undefined }
        expect(getTokenCount(msg as any)).toBe(100)
    })

    it('usage_metadata.total_tokens 为 0 时使用保底估算', () => {
        const msg = {
            content: '一些内容', // 4 字符
            usage_metadata: { total_tokens: 0 },
        }
        // total_tokens 为 0（falsy），走保底
        expect(getTokenCount(msg as any)).toBe(100)
    })
})

describe('pointConsumptionMiddleware beforeAgent', () => {
    const userId = 1
    const itemKey = 'case_analysis_token'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    function getBeforeAgentHook() {
        const config = pointConsumptionMiddleware(userId, itemKey)
        return config.beforeAgent.hook
    }

    it('会员 + 积分充足 → 正常通过', async () => {
        vi.mocked(getCurrentMembershipService).mockResolvedValue({ levelName: 'Pro' } as any)
        vi.mocked(checkPointsService).mockResolvedValue({
            sufficient: true, available: 100, required: 1, itemId: 1, itemName: 'test', itemUnit: '千tokens',
        })

        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: false, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        await hook(state as any)

        expect(interrupt).not.toHaveBeenCalled()
    })

    it('非会员 → interrupt with reason: no_membership', async () => {
        vi.mocked(getCurrentMembershipService).mockResolvedValue(null)

        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: false, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        await hook(state as any)

        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'insufficient_points',
                data: expect.objectContaining({ reason: 'no_membership', isMember: false }),
            })
        )
    })

    it('会员 + 积分不足 → interrupt with reason: insufficient_points', async () => {
        vi.mocked(getCurrentMembershipService).mockResolvedValue({ levelName: 'Pro' } as any)
        vi.mocked(checkPointsService).mockResolvedValue({
            sufficient: false, available: 0, required: 5, itemId: 1, itemName: 'test', itemUnit: '千tokens',
        })

        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: false, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        await hook(state as any)

        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ reason: 'insufficient_points', isMember: true }),
            })
        )
    })

    it('_resumingFromAfterModel = true → 跳过预检', async () => {
        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: true, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        const result = await hook(state as any)

        expect(getCurrentMembershipService).not.toHaveBeenCalled()
        expect(result).toEqual({ _resumingFromAfterModel: false })
    })

    it('会员查询异常 → interrupt with reason: service_error', async () => {
        vi.mocked(getCurrentMembershipService).mockRejectedValue(new Error('DB error'))

        const hook = getBeforeAgentHook()
        const state = { _resumingFromAfterModel: false, _totalPointsConsumed: 0, _totalTokensConsumed: 0, messages: [] }
        await hook(state as any)

        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ reason: 'service_error' }),
            })
        )
    })
})

describe('pointConsumptionMiddleware afterModel', () => {
    const userId = 1
    const itemKey = 'case_analysis_token'

    beforeEach(() => {
        vi.clearAllMocks()
    })

    function getAfterModelHook() {
        const config = pointConsumptionMiddleware(userId, itemKey)
        return config.afterModel.hook
    }

    it('有 usage_metadata → 正确计算 quantity 并扣减', async () => {
        vi.mocked(consumePointsService).mockResolvedValue({
            consumedAmount: 3,
            consumptionRecords: [],
        })

        const hook = getAfterModelHook()
        const state = {
            messages: [{ usage_metadata: { total_tokens: 2500 }, content: 'test' }],
            _totalTokensConsumed: 0,
            _totalPointsConsumed: 0,
            _pendingDeductQuantity: 0,
        }

        const result = await hook(state as any)

        // ceil(2500 / 1000) = 3
        expect(consumePointsService).toHaveBeenCalledWith(userId, itemKey, 3)
        expect(result).toEqual({
            _totalTokensConsumed: 2500,
            _totalPointsConsumed: 3,
            _pendingDeductQuantity: 0,
            _resumingFromAfterModel: false,
        })
    })

    it('积分不足 → 记录 _pendingDeductQuantity + interrupt', async () => {
        vi.mocked(consumePointsService).mockRejectedValue(new Error('积分不足，需要 3，可用 0'))
        vi.mocked(checkPointsService).mockResolvedValue({
            sufficient: false, available: 0, required: 3, itemId: 1, itemName: 'test', itemUnit: '千tokens',
        })
        vi.mocked(getCurrentMembershipService).mockResolvedValue({ levelName: 'Pro' } as any)

        const hook = getAfterModelHook()
        const state = {
            messages: [{ usage_metadata: { total_tokens: 2500 }, content: 'test' }],
            _totalTokensConsumed: 1000,
            _totalPointsConsumed: 5,
            _pendingDeductQuantity: 0,
        }

        const result = await hook(state as any)

        expect(interrupt).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'insufficient_points',
                data: expect.objectContaining({ reason: 'insufficient_points' }),
            })
        )
        expect(result).toEqual({
            _totalTokensConsumed: 3500,
            _pendingDeductQuantity: 3,
            _resumingFromAfterModel: true,
        })
    })

    it('有待补扣 → 先补扣再处理新消息', async () => {
        vi.mocked(consumePointsService).mockResolvedValue({
            consumedAmount: 2,
            consumptionRecords: [],
        })

        const hook = getAfterModelHook()
        const state = {
            messages: [{ usage_metadata: { total_tokens: 1500 }, content: 'test' }],
            _totalTokensConsumed: 2000,
            _totalPointsConsumed: 5,
            _pendingDeductQuantity: 3,  // 上次失败的待补扣
        }

        const result = await hook(state as any)

        // 第一次调用补扣 3，第二次调用扣减 2（ceil(1500/1000)）
        expect(consumePointsService).toHaveBeenCalledTimes(2)
        expect(consumePointsService).toHaveBeenNthCalledWith(1, userId, itemKey, 3)
        expect(consumePointsService).toHaveBeenNthCalledWith(2, userId, itemKey, 2)
    })

    it('无消息时不扣减', async () => {
        const hook = getAfterModelHook()
        const state = {
            messages: [],
            _totalTokensConsumed: 0,
            _totalPointsConsumed: 0,
            _pendingDeductQuantity: 0,
        }

        const result = await hook(state as any)

        expect(consumePointsService).not.toHaveBeenCalled()
        expect(result).toEqual({ _pendingDeductQuantity: 0 })
    })

    it('非积分不足错误 → 记录日志 + 记入待补扣', async () => {
        vi.mocked(consumePointsService).mockRejectedValue(new Error('数据库连接超时'))

        const hook = getAfterModelHook()
        const state = {
            messages: [{ usage_metadata: { total_tokens: 2000 }, content: 'test' }],
            _totalTokensConsumed: 0,
            _totalPointsConsumed: 0,
            _pendingDeductQuantity: 0,
        }

        const result = await hook(state as any)

        expect(interrupt).not.toHaveBeenCalled()
        expect(result).toEqual({
            _totalTokensConsumed: 2000,
            _pendingDeductQuantity: 2,
        })
    })
})
