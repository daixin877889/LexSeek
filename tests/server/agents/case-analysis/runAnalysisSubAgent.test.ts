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

import { runAnalysisSubAgent } from '~~/server/agents/case-analysis/runAnalysisSubAgent'
import { getNodeConfigCached } from '~~/server/services/agent-platform/nodeConfig/loader'

describe('runAnalysisSubAgent 边界守卫', () => {
    beforeEach(() => vi.clearAllMocks())

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
            id: 9, name: 'trend',
            prompts: [{ type: 'system', status: 1, content: 'sys' }],
            tools: [],
            modelSdkType: 'anthropic', modelName: 'claude',
            modelApiKeys: [{ status: 0, apiKey: 'disabled' }],  // 全部禁用
            modelProviderBaseUrl: '',
            modelMaxOutputTokens: 4096, modelContextWindow: 200000,
        })

        await expect(
            runAnalysisSubAgent({
                agentName: 'trend',
                moduleTitle: '判决趋势预测',
                userId: 1, caseId: 1, sessionId: 's', runId: 'r', thinking: false,
            }),
        ).rejects.toThrow(/案件初分节点 trend 没有可用的 API 密钥/)
    })
})
