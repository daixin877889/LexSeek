/**
 * 分析结果持久化中间件测试
 *
 * 由于中间件依赖 langchain 运行时和数据库，使用 mock 进行单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 全局变量
const mockPrismaTransaction = vi.fn((fn: any) => fn({}))
vi.stubGlobal('prisma', { $transaction: mockPrismaTransaction })
vi.stubGlobal('logger', { info: vi.fn(), error: vi.fn(), warn: vi.fn() })

// Mock 服务层和 DAO 函数
vi.mock('~~/server/services/case/analysis.dao', () => ({
    createAnalysisDao: vi.fn(),
    updateAnalysisDao: vi.fn(),
    getNextVersionDao: vi.fn(),
    deactivateVersionsDao: vi.fn(),
    AnalysisStatus: {
        IN_PROGRESS: 1,
        COMPLETED: 2,
        FAILED: 3,
    },
}))

vi.mock('~~/server/services/case/analysis.service', () => ({
    failAnalysisService: vi.fn(),
}))

vi.mock('~~/server/services/node/node.service', () => ({
    getNodeByNameService: vi.fn(),
}))

// Mock langchain
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config) => config),
}))

import {
    analysisResultPersistenceMiddleware,
    extractLastAIMessageContent,
    markAnalysisFailedById,
} from '~~/server/services/workflow/middleware/analysisResultPersistence.middleware'
import { createAnalysisDao, updateAnalysisDao, getNextVersionDao, deactivateVersionsDao, AnalysisStatus } from '~~/server/services/case/analysis.dao'
import { failAnalysisService } from '~~/server/services/case/analysis.service'
import { getNodeByNameService } from '~~/server/services/node/node.service'

describe('extractLastAIMessageContent', () => {
    it('应该提取 string 格式的 AIMessage 内容', () => {
        const messages = [
            { _getType: () => 'human', content: '你好' },
            { _getType: () => 'ai', content: '这是分析结果' },
        ]
        expect(extractLastAIMessageContent(messages)).toBe('这是分析结果')
    })

    it('应该提取 ContentPart[] 格式的 AIMessage 内容', () => {
        const messages = [
            { _getType: () => 'human', content: '你好' },
            {
                _getType: () => 'ai',
                content: [
                    { type: 'text', text: '第一段' },
                    { type: 'image', url: 'http://example.com/img.png' },
                    { type: 'text', text: '第二段' },
                ],
            },
        ]
        expect(extractLastAIMessageContent(messages)).toBe('第一段第二段')
    })

    it('应该返回最后一条 AIMessage（跳过中间的）', () => {
        const messages = [
            { _getType: () => 'ai', content: '第一次回复' },
            { _getType: () => 'human', content: '继续分析' },
            { _getType: () => 'ai', content: '最终分析结果' },
        ]
        expect(extractLastAIMessageContent(messages)).toBe('最终分析结果')
    })

    it('没有 AIMessage 时返回 null', () => {
        const messages = [
            { _getType: () => 'human', content: '你好' },
        ]
        expect(extractLastAIMessageContent(messages)).toBeNull()
    })

    it('空消息列表返回 null', () => {
        expect(extractLastAIMessageContent([])).toBeNull()
    })

    it('通过 constructor.name 识别 AIMessage', () => {
        class AIMessage {
            content: string
            constructor(content: string) {
                this.content = content
            }
        }
        const messages = [new AIMessage('通过构造函数识别')]
        expect(extractLastAIMessageContent(messages)).toBe('通过构造函数识别')
    })
})

describe('analysisResultPersistenceMiddleware beforeAgent', () => {
    const options = { agentName: 'case_analyzer', caseId: 1, sessionId: 'session-123' }

    beforeEach(() => {
        vi.clearAllMocks()
        mockPrismaTransaction.mockImplementation((fn: any) => fn({}))
    })

    function getBeforeAgentHook() {
        const config = analysisResultPersistenceMiddleware(options)
        return config.beforeAgent.hook
    }

    it('应该创建 IN_PROGRESS 分析记录并返回 _analysisRecordId', async () => {
        vi.mocked(getNodeByNameService).mockResolvedValue({ id: 10, name: 'case_analyzer' } as any)
        vi.mocked(getNextVersionDao).mockResolvedValue(3)
        vi.mocked(createAnalysisDao).mockResolvedValue({ id: 42, version: 3 } as any)

        const hook = getBeforeAgentHook()
        const result = await hook({})

        expect(getNodeByNameService).toHaveBeenCalledWith('case_analyzer')
        expect(getNextVersionDao).toHaveBeenCalledWith(1, 10, {})
        expect(createAnalysisDao).toHaveBeenCalledWith({
            caseId: 1,
            sessionId: 'session-123',
            nodeId: 10,
            analysisType: 'case_analyzer',
            version: 3,
            status: AnalysisStatus.IN_PROGRESS,
            isActive: false,
        }, {})
        expect(result).toEqual({ _analysisRecordId: 42 })
    })

    it('节点不存在时应该返回 undefined（不阻塞）', async () => {
        vi.mocked(getNodeByNameService).mockResolvedValue(null)

        const hook = getBeforeAgentHook()
        const result = await hook({})

        expect(result).toBeUndefined()
        expect(createAnalysisDao).not.toHaveBeenCalled()
    })

    it('异常时应该不抛出且返回 undefined', async () => {
        vi.mocked(getNodeByNameService).mockRejectedValue(new Error('DB 连接失败'))

        const hook = getBeforeAgentHook()
        const result = await hook({})

        expect(result).toBeUndefined()
        expect(createAnalysisDao).not.toHaveBeenCalled()
    })
})

describe('analysisResultPersistenceMiddleware afterAgent', () => {
    const options = { agentName: 'case_analyzer', caseId: 1, sessionId: 'session-123' }

    beforeEach(() => {
        vi.clearAllMocks()
        mockPrismaTransaction.mockImplementation((fn: any) => fn({}))
    })

    function getAfterAgentHook() {
        const config = analysisResultPersistenceMiddleware(options)
        return config.afterAgent.hook
    }

    it('应该提取 AIMessage 内容并完成分析记录（string 格式）', async () => {
        vi.mocked(getNodeByNameService).mockResolvedValue({ id: 10, name: 'case_analyzer' } as any)
        vi.mocked(deactivateVersionsDao).mockResolvedValue(undefined)
        vi.mocked(updateAnalysisDao).mockResolvedValue({} as any)

        const hook = getAfterAgentHook()
        const state = {
            _analysisRecordId: 42,
            messages: [
                { _getType: () => 'human', content: '请分析' },
                { _getType: () => 'ai', content: '法律分析结果文本' },
            ],
        }

        await hook(state)

        expect(deactivateVersionsDao).toHaveBeenCalledWith(1, 10, {})
        expect(updateAnalysisDao).toHaveBeenCalledWith(42, {
            analysisResult: '法律分析结果文本',
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        }, {})
    })

    it('应该处理 ContentPart[] 格式的消息内容', async () => {
        vi.mocked(getNodeByNameService).mockResolvedValue({ id: 10, name: 'case_analyzer' } as any)
        vi.mocked(deactivateVersionsDao).mockResolvedValue(undefined)
        vi.mocked(updateAnalysisDao).mockResolvedValue({} as any)

        const hook = getAfterAgentHook()
        const state = {
            _analysisRecordId: 42,
            messages: [
                {
                    _getType: () => 'ai',
                    content: [
                        { type: 'text', text: '结论一' },
                        { type: 'text', text: '结论二' },
                    ],
                },
            ],
        }

        await hook(state)

        expect(updateAnalysisDao).toHaveBeenCalledWith(42, {
            analysisResult: '结论一结论二',
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        }, {})
    })

    it('_analysisRecordId 不存在时应跳过', async () => {
        const hook = getAfterAgentHook()
        await hook({ _analysisRecordId: undefined, messages: [] })

        expect(getNodeByNameService).not.toHaveBeenCalled()
        expect(updateAnalysisDao).not.toHaveBeenCalled()
    })

    it('未找到 AIMessage 时应该使用空字符串保存', async () => {
        vi.mocked(getNodeByNameService).mockResolvedValue({ id: 10, name: 'case_analyzer' } as any)
        vi.mocked(deactivateVersionsDao).mockResolvedValue(undefined)
        vi.mocked(updateAnalysisDao).mockResolvedValue({} as any)

        const hook = getAfterAgentHook()
        const state = {
            _analysisRecordId: 42,
            messages: [
                { _getType: () => 'human', content: '请分析' },
            ],
        }

        await hook(state)

        expect(updateAnalysisDao).toHaveBeenCalledWith(42, {
            analysisResult: '',
            status: AnalysisStatus.COMPLETED,
            isActive: true,
        }, {})
    })

    it('异常时应该不抛出', async () => {
        vi.mocked(getNodeByNameService).mockRejectedValue(new Error('DB 异常'))

        const hook = getAfterAgentHook()
        // 不应抛出异常
        await expect(hook({ _analysisRecordId: 42, messages: [] })).resolves.toBeUndefined()
        expect(updateAnalysisDao).not.toHaveBeenCalled()
    })
})

describe('markAnalysisFailedById', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应该调用 failAnalysisService', async () => {
        vi.mocked(failAnalysisService).mockResolvedValue({} as any)

        await markAnalysisFailedById(42)

        expect(failAnalysisService).toHaveBeenCalledWith(42)
    })

    it('异常时应该不抛出', async () => {
        vi.mocked(failAnalysisService).mockRejectedValue(new Error('记录不存在'))

        // 不应抛出异常
        await expect(markAnalysisFailedById(99)).resolves.toBeUndefined()
    })
})
