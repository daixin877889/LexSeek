/**
 * 系统提示词渲染器测试
 *
 * 验证 renderSystemPrompt 能够正确提取 system prompt、替换模板变量，
 * 以及在存在未替换变量时记录 warn 日志
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger：使用 vi.hoisted 保证 mock 对象在 vi.mock 工厂执行前可见
const { mockLogger } = vi.hoisted(() => {
    return {
        mockLogger: {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        },
    }
})
vi.mock('#shared/utils/logger', () => ({
    logger: mockLogger,
}))

import { renderSystemPrompt } from '~~/server/services/workflow/utils/promptRenderer'
import type { NodeConfig } from '~~/server/services/node/node.service'

/** 构造一个最小化的 NodeConfig 以满足测试需求 */
function buildConfig(systemContent: string | null, extraPrompts: Array<Partial<NodeConfig['prompts'][number]>> = []): NodeConfig {
    const prompts: NodeConfig['prompts'] = []
    if (systemContent !== null) {
        prompts.push({
            id: 1,
            name: 'system',
            content: systemContent,
            version: 'v1',
            type: 'system',
            status: 1,
        })
    }
    for (const extra of extraPrompts) {
        prompts.push({
            id: extra.id ?? 99,
            name: extra.name ?? 'extra',
            content: extra.content ?? '',
            version: extra.version ?? 'v1',
            type: extra.type ?? 'user',
            status: extra.status ?? 0,
        })
    }
    return {
        id: 1,
        name: 'test-node',
        title: '测试节点',
        description: '',
        type: 'analysis',
        prompts,
        modelId: 1,
        modelName: 'gpt-4',
        modelType: 'chat',
        modelStatus: 1,
        modelSdkType: 'openai' as NodeConfig['modelSdkType'],
        modelProviderId: 1,
        modelProviderName: 'OpenAI',
        modelProviderBaseUrl: 'https://api.openai.com',
        modelProviderDescription: '',
        modelApiKeys: [],
        tools: [],
        outputSchema: null,
    }
}

describe('renderSystemPrompt', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('替换已知模板变量', () => {
        const config = buildConfig('分析案件 {{caseId}} 的 {{moduleName}} 模块')
        const result = renderSystemPrompt(config, { caseId: 42, moduleName: '案情概要' })
        expect(result).toBe('分析案件 42 的 案情概要 模块')
        expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('无模板变量时原样返回', () => {
        const config = buildConfig('你是法律分析专家')
        const result = renderSystemPrompt(config)
        expect(result).toBe('你是法律分析专家')
        expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('未替换变量记录 warn 日志', () => {
        const config = buildConfig('{{unknown}} 分析 {{caseId}}')
        const result = renderSystemPrompt(config, { caseId: 7 })
        expect(result).toBe('{{unknown}} 分析 7')
        expect(mockLogger.warn).toHaveBeenCalledWith(
            '系统提示词存在未替换的模板变量',
            expect.objectContaining({ unreplacedVars: ['{{unknown}}'] }),
        )
    })

    it('无 system prompt 时返回空字符串', () => {
        const config = buildConfig(null)
        expect(renderSystemPrompt(config)).toBe('')
        expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('只选择 status=1 且 type=system 的提示词', () => {
        const config: NodeConfig = {
            ...buildConfig(null),
            prompts: [
                { id: 1, name: 'old', content: '旧的系统提示', version: 'v1', type: 'system', status: 0 },
                { id: 2, name: 'user', content: '用户提示', version: 'v1', type: 'user', status: 1 },
                { id: 3, name: 'sys', content: '新的系统提示 {{caseId}}', version: 'v2', type: 'system', status: 1 },
            ],
        }
        const result = renderSystemPrompt(config, { caseId: 100 })
        expect(result).toBe('新的系统提示 100')
    })

    it('支持 caseType 变量渲染', () => {
        const config = buildConfig('案件类型：{{caseType}}')
        const result = renderSystemPrompt(config, { caseType: '民事' })
        expect(result).toBe('案件类型：民事')
    })
})
