/**
 * 材料摘要生成服务 - 补充覆盖率测试
 *
 * 覆盖 materialSummary.service.ts 中已有测试未覆盖的路径：
 * - 超长内容截断
 * - LLM 返回 null/非文本内容
 * - 批量处理超过并发限制
 * - 空摘要结果（trim 后为空）
 *
 * **Feature: material-summary-coverage-extra**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock globals
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

const mockPrisma = {
    caseMaterials: { update: vi.fn() },
    $transaction: vi.fn((updates: any[]) => Promise.all(updates)),
}
vi.stubGlobal('prisma', mockPrisma)

// Mock node 服务
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
}))

// Mock chatModelFactory
vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(),
}))

import { generateAndCacheSummaries } from '~~/server/services/material/materialSummary.service'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { createChatModel } from '~~/server/services/node/chatModelFactory'

/** 创建标准节点配置 mock */
function setupValidNodeConfig() {
    vi.mocked(getValidNodeConfig).mockResolvedValue({
        modelApiKeys: [{ status: 1, apiKey: 'valid-key' }],
        modelSdkType: 'openai',
        modelName: 'gpt-4',
        modelProviderBaseUrl: 'https://api.example.com',
        prompts: [{ type: 'system', status: 1, content: '你是摘要助手' }],
    } as any)
}

describe('材料摘要生成服务 - 补充覆盖率', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('generateAndCacheSummaries - 超长内容截断', () => {
        it('超过 50000 字符的内容应被截断', async () => {
            setupValidNodeConfig()
            const mockModel = {
                invoke: vi.fn().mockResolvedValue({ content: '截断后的摘要' }),
            }
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)
            mockPrisma.caseMaterials.update.mockResolvedValue({})

            const longContent = '测'.repeat(60000) // 超过 50000
            const materials = [{ id: 1, name: '超长材料' }]
            const contentMap = new Map([[1, longContent]])

            const result = await generateAndCacheSummaries(materials, contentMap)

            expect(result.size).toBe(1)
            // 验证传给 LLM 的内容被截断了
            const invokeArgs = mockModel.invoke.mock.calls[0][0]
            const userMessage = invokeArgs.find((m: any) => m.role === 'user')
            expect(userMessage.content).toContain('[内容过长已截断]')
        })
    })

    describe('generateAndCacheSummaries - LLM 返回空/null', () => {
        it('LLM 返回空字符串时不生成摘要', async () => {
            setupValidNodeConfig()
            const mockModel = {
                invoke: vi.fn().mockResolvedValue({ content: '   ' }),
            }
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)

            const materials = [{ id: 1, name: '材料1' }]
            const contentMap = new Map([[1, '内容']])

            const result = await generateAndCacheSummaries(materials, contentMap)

            expect(result.size).toBe(0)
        })

        it('LLM 返回非字符串非数组内容时不生成摘要', async () => {
            setupValidNodeConfig()
            const mockModel = {
                invoke: vi.fn().mockResolvedValue({ content: 12345 }),
            }
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)

            const materials = [{ id: 1, name: '材料1' }]
            const contentMap = new Map([[1, '内容']])

            const result = await generateAndCacheSummaries(materials, contentMap)

            expect(result.size).toBe(0)
        })
    })

    describe('generateAndCacheSummaries - 批量处理超过并发限制', () => {
        it('超过 5 个材料时分批处理', async () => {
            setupValidNodeConfig()
            const mockModel = {
                invoke: vi.fn().mockResolvedValue({ content: '摘要' }),
            }
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)
            mockPrisma.caseMaterials.update.mockResolvedValue({})

            // 7 个材料，超过并发限制 5
            const materials = Array.from({ length: 7 }, (_, i) => ({
                id: i + 1,
                name: `材料${i + 1}`,
            }))
            const contentMap = new Map(materials.map(m => [m.id, `内容${m.id}`]))

            const result = await generateAndCacheSummaries(materials, contentMap)

            expect(result.size).toBe(7)
            // LLM 应被调用 7 次
            expect(mockModel.invoke).toHaveBeenCalledTimes(7)
        })
    })

    describe('generateAndCacheSummaries - 无摘要生成时不写 DB', () => {
        it('所有材料摘要生成失败时不调用 $transaction', async () => {
            setupValidNodeConfig()
            const mockModel = {
                invoke: vi.fn().mockRejectedValue(new Error('全部失败')),
            }
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)

            const materials = [{ id: 1, name: '材料1' }]
            const contentMap = new Map([[1, '内容']])

            const result = await generateAndCacheSummaries(materials, contentMap)

            expect(result.size).toBe(0)
            expect(mockPrisma.$transaction).not.toHaveBeenCalled()
        })
    })

    describe('generateAndCacheSummaries - 数组内容含非 text 类型', () => {
        it('过滤非 text 类型的数组项', async () => {
            setupValidNodeConfig()
            const mockModel = {
                invoke: vi.fn().mockResolvedValue({
                    content: [
                        { type: 'text', text: '有效内容' },
                        { type: 'image', url: 'http://...' },
                    ],
                }),
            }
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)
            mockPrisma.caseMaterials.update.mockResolvedValue({})

            const materials = [{ id: 1, name: '材料1' }]
            const contentMap = new Map([[1, '内容']])

            const result = await generateAndCacheSummaries(materials, contentMap)

            expect(result.get(1)).toBe('有效内容')
        })
    })
})
