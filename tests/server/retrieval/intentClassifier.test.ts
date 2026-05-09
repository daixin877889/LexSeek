/**
 * 意图分类服务单元测试
 *
 * **Feature: retrieval**
 * **Validates: Requirements intentClassifier**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { classifyIntentService, invalidateIntentCacheService } from '../../../server/services/retrieval/intentClassifier.service'

// Mock 节点配置服务
vi.mock('../../../server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
}))

// Mock 聊天模型工厂
vi.mock('../../../server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(),
}))

// Mock logger（服务端自动导入，需在测试中提供）
vi.mock('../../../server/utils/logger', () => ({
    default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// Mock Redis 客户端
vi.mock('../../../server/lib/redis', () => ({
    getRedisClient: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        keys: vi.fn().mockResolvedValue([]),
        // invalidateIntentCacheService 用 SCAN 增量遍历，替代 KEYS（避免 Redis 阻塞）
        scan: vi.fn().mockResolvedValue(['0', []]),
        del: vi.fn().mockResolvedValue(0),
    }),
}))

import { getValidNodeConfig } from '../../../server/services/node/node.service'
import { createChatModel } from '../../../server/services/node/chatModelFactory'
import { getRedisClient } from '../../../server/lib/redis'

// ============================================================================
// 测试辅助
// ============================================================================

/** 构造标准节点配置 mock */
function makeNodeConfig(overrides: Record<string, unknown> = {}) {
    return {
        id: 'node-1',
        name: 'search_intent_router',
        title: '意图分类节点',
        type: 'llm',
        prompts: [{ type: 'system', status: 1, content: '你是意图分类器{{typeHint}}' }],
        modelName: 'gpt-4o-mini',
        modelSdkType: 'openai',
        modelProviderBaseUrl: 'https://api.openai.com/v1',
        modelApiKeys: [{ apiKey: 'sk-test-key' }],
        outputSchema: null,
        modelContextWindow: 128000,
        ...overrides,
    }
}

/** 构造结构化输出 mock 链 */
function makeMockModel(invokeResult: unknown) {
    const mockInvoke = vi.fn().mockResolvedValue(invokeResult)
    const mockWithStructuredOutput = vi.fn().mockReturnValue({ invoke: mockInvoke })
    return {
        model: { withStructuredOutput: mockWithStructuredOutput },
        mockInvoke,
        mockWithStructuredOutput,
    }
}

// ============================================================================
// 测试套件
// ============================================================================

describe('classifyIntentService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('正常 exact 意图 — LLM 返回精确条文引用时正确解析', async () => {
        const llmResult = { intent: 'exact', legalName: '民法典', articleRef: '第一千条' }
        const { model, mockInvoke } = makeMockModel(llmResult)

        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('民法典第1000条的内容是什么', 'law')

        expect(result.intent).toBe('exact')
        expect(result.legalName).toBe('民法典')
        expect(result.articleRef).toBe('第一千条')
        expect(mockInvoke).toHaveBeenCalledOnce()
    })

    it('正常 hybrid 意图 — LLM 返回混合检索意图时正确解析', async () => {
        const llmResult = {
            intent: 'hybrid',
            legalName: '劳动合同法',
            keywords: ['经济补偿', '解除合同'],
            rewrittenQuery: '劳动合同法经济补偿金规定',
        }
        const { model } = makeMockModel(llmResult)

        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('劳动合同法关于经济补偿的规定', 'law')

        expect(result.intent).toBe('hybrid')
        expect(result.legalName).toBe('劳动合同法')
        expect(result.keywords).toEqual(['经济补偿', '解除合同'])
        expect(result.rewrittenQuery).toBe('劳动合同法经济补偿金规定')
    })

    it('正常 semantic 意图 — LLM 返回语义检索意图时正确解析', async () => {
        const llmResult = {
            intent: 'semantic',
            keywords: ['辞退', '索赔', '赔偿'],
            rewrittenQuery: '员工被无故辞退的法律赔偿途径',
        }
        const { model } = makeMockModel(llmResult)

        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('员工被无故辞退后如何索赔', 'law')

        expect(result.intent).toBe('semantic')
        expect(result.keywords).toContain('辞退')
        expect(result.rewrittenQuery).toBeTruthy()
    })

    it('案件材料强制非 exact — type=case_material 且 LLM 返回 exact 时降级为 hybrid', async () => {
        const llmResult = { intent: 'exact', legalName: '民法典', articleRef: '第一千条' }
        const { model } = makeMockModel(llmResult)

        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('民法典第1000条', 'case_material')

        // exact 降级为 hybrid，其他字段保留
        expect(result.intent).toBe('hybrid')
        expect(result.legalName).toBe('民法典')
        expect(result.articleRef).toBe('第一千条')
    })

    it('案件材料 hybrid 意图 — type=case_material 且 LLM 返回 hybrid 时正常返回', async () => {
        const llmResult = {
            intent: 'hybrid',
            keywords: ['证人证词', '物证'],
            rewrittenQuery: '案件证人证词分析',
        }
        const { model } = makeMockModel(llmResult)

        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('证人证词相关材料', 'case_material')

        expect(result.intent).toBe('hybrid')
    })

    it('LLM 调用失败 — invoke 抛出错误时降级返回 semantic', async () => {
        const mockInvoke = vi.fn().mockRejectedValue(new Error('LLM 服务不可用'))
        const mockWithStructuredOutput = vi.fn().mockReturnValue({ invoke: mockInvoke })
        const mockModel = { withStructuredOutput: mockWithStructuredOutput }

        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(mockModel as never)

        const result = await classifyIntentService('合同违约赔偿问题', 'law')

        expect(result.intent).toBe('semantic')
        expect(result.rewrittenQuery).toBe('合同违约赔偿问题')
    })

    it('节点未配置 — getValidNodeConfig 抛出错误时降级返回 semantic', async () => {
        vi.mocked(getValidNodeConfig).mockRejectedValue(new Error('节点 search_intent_router 未配置'))

        const result = await classifyIntentService('房屋买卖纠纷', 'law')

        expect(result.intent).toBe('semantic')
        expect(result.rewrittenQuery).toBe('房屋买卖纠纷')
        // createChatModel 不应被调用
        expect(createChatModel).not.toHaveBeenCalled()
    })

    it('使用节点配置中的 system prompt — 优先使用节点 prompts 中 type=system 的内容', async () => {
        const customSystemPrompt = '自定义意图分类 system prompt'
        const config = makeNodeConfig({
            prompts: [{ type: 'system', status: 1, content: customSystemPrompt }],
        })
        const llmResult = { intent: 'semantic', rewrittenQuery: '查询' }
        const { model, mockInvoke } = makeMockModel(llmResult)

        vi.mocked(getValidNodeConfig).mockResolvedValue(config as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        await classifyIntentService('测试查询', 'law')

        // 验证 invoke 被调用，且 system message 包含自定义 prompt
        expect(mockInvoke).toHaveBeenCalledOnce()
        const messages = mockInvoke.mock.calls[0][0]
        expect(messages[0].content).toContain(customSystemPrompt)
    })

    it('使用节点配置中的 outputSchema — 优先使用节点配置的 outputSchema', async () => {
        const customSchema = { type: 'object', properties: { intent: { type: 'string' } } }
        const config = makeNodeConfig({ outputSchema: customSchema })
        const llmResult = { intent: 'semantic' }
        const { model, mockWithStructuredOutput } = makeMockModel(llmResult)

        vi.mocked(getValidNodeConfig).mockResolvedValue(config as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        await classifyIntentService('测试查询', 'law')

        expect(mockWithStructuredOutput).toHaveBeenCalledWith(customSchema)
    })

    it('案件材料检索追加 typeHint — system message 包含 case_material 提示', async () => {
        const llmResult = { intent: 'semantic', rewrittenQuery: '案件材料' }
        const { model, mockInvoke } = makeMockModel(llmResult)

        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        await classifyIntentService('案件材料查询', 'case_material')

        const messages = mockInvoke.mock.calls[0][0]
        expect(messages[0].content).toContain('不存在精确通道')
    })
})

describe('正则前置 + Redis 缓存', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 重置 Redis mock 默认行为
        vi.mocked(getRedisClient().get).mockResolvedValue(null)
        vi.mocked(getRedisClient().set).mockResolvedValue('OK')
    })

    it('type=law 纯 exact 查询 — 正则命中，跳过 LLM', async () => {
        const result = await classifyIntentService('民法典第100条', 'law')
        expect(result.intent).toBe('exact')
        expect(result.legalName).toBe('民法典')
        expect(createChatModel).not.toHaveBeenCalled()
    })

    it('type=case_material — 正则跳过，走 LLM', async () => {
        const llmResult = { intent: 'hybrid', keywords: ['民法典'] }
        const { model } = makeMockModel(llmResult)
        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('民法典第100条', 'case_material')
        expect(result.intent).toBe('hybrid')
        expect(createChatModel).toHaveBeenCalledOnce()
    })

    it('skipCache=true — 跳过 Redis 缓存，走 LLM', async () => {
        const llmResult = { intent: 'hybrid', keywords: ['合同'] }
        const { model } = makeMockModel(llmResult)
        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('合同解除条件', 'law', { skipCache: true })
        expect(result.intent).toBe('hybrid')
        expect(createChatModel).toHaveBeenCalledOnce()
    })

    it('Redis 连接失败 — 透明降级到 LLM', async () => {
        // 让 Redis get 抛异常
        vi.mocked(getRedisClient().get).mockRejectedValueOnce(new Error('ECONNREFUSED'))

        const llmResult = { intent: 'semantic', rewrittenQuery: '合同纠纷' }
        const { model } = makeMockModel(llmResult)
        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('合同纠纷', 'law')
        expect(result.intent).toBe('semantic')
        expect(createChatModel).toHaveBeenCalledOnce()
    })
})

describe('invalidateIntentCacheService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('不传 type 时清所有 intent:* 缓存', async () => {
        const redis = getRedisClient()
        // SCAN 单批返回全部 3 个 key 即结束（cursor 回到 '0'）
        vi.mocked(redis.scan).mockResolvedValueOnce(['0', [
            'intent:law:abc123',
            'intent:case_material:def456',
            'intent:case_memory:ghi789',
        ]])
        vi.mocked(redis.del).mockResolvedValueOnce(3)

        const cleared = await invalidateIntentCacheService()
        expect(cleared).toBe(3)
        expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'intent:*', 'COUNT', 100)
        expect(redis.del).toHaveBeenCalledWith(
            'intent:law:abc123',
            'intent:case_material:def456',
            'intent:case_memory:ghi789',
        )
    })

    it('传 type 时只清匹配的子集', async () => {
        const redis = getRedisClient()
        vi.mocked(redis.scan).mockResolvedValueOnce(['0', ['intent:law:abc', 'intent:law:def']])
        vi.mocked(redis.del).mockResolvedValueOnce(2)

        const cleared = await invalidateIntentCacheService('law')
        expect(cleared).toBe(2)
        expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'intent:law:*', 'COUNT', 100)
    })

    it('keys 返回空数组时不调 del 直接返回 0', async () => {
        const redis = getRedisClient()
        // SCAN 直接返回空 batch + cursor='0'：业务不应再调 del
        vi.mocked(redis.scan).mockResolvedValueOnce(['0', []])

        const cleared = await invalidateIntentCacheService('case_analysis')
        expect(cleared).toBe(0)
        expect(redis.del).not.toHaveBeenCalled()
    })

    it('Redis 异常时返回 0 不抛错（保护管理端 API）', async () => {
        const redis = getRedisClient()
        vi.mocked(redis.keys).mockRejectedValueOnce(new Error('ECONNREFUSED'))

        const cleared = await invalidateIntentCacheService('law')
        expect(cleared).toBe(0)
    })
})
