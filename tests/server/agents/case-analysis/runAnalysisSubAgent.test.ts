/**
 * runAnalysisSubAgent 单元测试 - 边界守卫
 *
 * 完整功能验证（中间件挂载 / 工具数量 / prompt 构造 / skill 工具自动跟随）
 * 由阶段 8 dev smoke 覆盖：起 dev → init-analysis 7 模块顺序 → 后端日志验证。
 *
 * 此处仅守卫"必填配置缺失抛错"的边界路径。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/agent-platform/nodeConfig/loader', () => ({
    getNodeConfigCached: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/middleware/skills', () => ({
    buildSkillsMiddlewareForNode: vi.fn().mockResolvedValue(null),
}))
// 上下文构造 mock 避免真查 case 表
vi.mock('~~/server/services/agent-platform/context/moduleContextBuilder', () => ({
    buildSystemPromptForAgent: vi.fn(async () => ({
        segments: { roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '' },
        systemMessage: { content: 'mock-system' },
        plainText: 'mock-system-plain',
    })),
}))
// model factory mock —— 不真创建 LLM
vi.mock('~~/server/services/agent-platform/modelFactory', () => ({
    createChatModel: vi.fn(() => ({
        bindTools: vi.fn().mockReturnThis(),
        invoke: vi.fn(),
    })),
}))
// langchain createAgent mock —— 控制 agent.invoke 返回
const mockAgentInvoke = vi.fn()
vi.mock('langchain', async () => {
    const actual = await vi.importActual('langchain') as Record<string, unknown>
    return {
        ...actual,
        createAgent: vi.fn(() => ({ invoke: mockAgentInvoke })),
        summarizationMiddleware: vi.fn(() => ({ name: 'summarizationMw' })),
    }
})

import { runAnalysisSubAgent } from '~~/server/agents/case-analysis/runAnalysisSubAgent'
import { getNodeConfigCached } from '~~/server/services/agent-platform/nodeConfig/loader'
import { buildSkillsMiddlewareForNode } from '~~/server/services/agent-platform/middleware/skills'

const happyNodeConfig = {
    id: 9, name: 'trend',
    prompts: [{ type: 'system', status: 1, content: 'sys' }],
    tools: [],
    modelSdkType: 'anthropic', modelName: 'claude',
    modelApiKeys: [{ status: 1, apiKey: 'sk-ant-real' }],
    modelProviderBaseUrl: '',
    modelMaxOutputTokens: 4096, modelContextWindow: 200000,
}

describe('runAnalysisSubAgent', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(buildSkillsMiddlewareForNode as any).mockResolvedValue(null)
    })

    it('agentName 不存在时抛错', async () => {
        ;(getNodeConfigCached as any).mockResolvedValueOnce(null)

        await expect(
            runAnalysisSubAgent({
                agentName: 'nonexistent',
                moduleTitle: '不存在的模块',
                userId: 1, caseId: 1, sessionId: 's', runId: 'r', thinking: false,
            }),
        ).rejects.toThrow('案件初分节点 nonexistent 未找到')
    })

    it('节点无可用 API 密钥时抛错', async () => {
        ;(getNodeConfigCached as any).mockResolvedValueOnce({
            ...happyNodeConfig,
            modelApiKeys: [{ status: 0, apiKey: 'disabled' }],
        })

        await expect(
            runAnalysisSubAgent({
                agentName: 'trend',
                moduleTitle: '判决趋势预测',
                userId: 1, caseId: 1, sessionId: 's', runId: 'r', thinking: false,
            }),
        ).rejects.toThrow(/案件初分节点 trend 没有可用的 API 密钥/)
    })

    it('happy path（skillsMw=null）：从 lastMsg.content 提取 string resultText', async () => {
        ;(getNodeConfigCached as any).mockResolvedValueOnce(happyNodeConfig)
        mockAgentInvoke.mockResolvedValueOnce({
            messages: [
                { content: '中间消息' },
                { content: '最终分析结果' },
            ],
        })

        const r = await runAnalysisSubAgent({
            agentName: 'trend', moduleTitle: '判决趋势预测',
            userId: 1, caseId: 1, sessionId: 's', runId: 'r', thinking: false,
        })

        expect(r.resultText).toBe('最终分析结果')
        expect(r.nodeId).toBe(9)
        expect(r.messages).toHaveLength(2)
    })

    it('happy path：从 lastMsg.content 数组（Anthropic content blocks）提取 text', async () => {
        ;(getNodeConfigCached as any).mockResolvedValueOnce(happyNodeConfig)
        mockAgentInvoke.mockResolvedValueOnce({
            messages: [
                {
                    content: [
                        { type: 'text', text: '段落1' },
                        { type: 'tool_use', tool: 'search_law' },
                        { type: 'text', text: '段落2' },
                    ],
                },
            ],
        })

        const r = await runAnalysisSubAgent({
            agentName: 'trend', moduleTitle: '判决趋势预测',
            userId: 1, caseId: 1, sessionId: 's', runId: 'r', thinking: true,
        })

        expect(r.resultText).toBe('段落1\n段落2')
    })

    it('skillsMw 非 null 时挂 skills middleware + 4 skill 工具', async () => {
        const mockSkillsMw = { name: 'skillsDiscovery' }
        ;(buildSkillsMiddlewareForNode as any).mockResolvedValueOnce(mockSkillsMw)
        ;(getNodeConfigCached as any).mockResolvedValueOnce(happyNodeConfig)
        mockAgentInvoke.mockResolvedValueOnce({
            messages: [{ content: 'with skill 结果' }],
        })

        const { createAgent } = await import('langchain')
        const r = await runAnalysisSubAgent({
            agentName: 'trend', moduleTitle: '判决趋势预测',
            userId: 1, caseId: 1, sessionId: 's', runId: 'r', thinking: false,
        })

        expect(r.resultText).toBe('with skill 结果')
        // createAgent 被调时 tools 数组应该 = 4 个 skill 工具（节点本身 tools=[]）
        const createAgentCall = (createAgent as any).mock.calls[(createAgent as any).mock.calls.length - 1][0]
        expect(createAgentCall.tools.length).toBe(4)
    })

    it('lastMsg 无 content 时 resultText 为空字符串', async () => {
        ;(getNodeConfigCached as any).mockResolvedValueOnce(happyNodeConfig)
        mockAgentInvoke.mockResolvedValueOnce({ messages: [] })

        const r = await runAnalysisSubAgent({
            agentName: 'trend', moduleTitle: '判决趋势预测',
            userId: 1, caseId: 1, sessionId: 's', runId: 'r', thinking: false,
        })

        expect(r.resultText).toBe('')
        expect(r.messages).toHaveLength(0)
    })
})
