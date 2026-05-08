/**
 * 材料摘要生成服务测试
 *
 * **Feature: material-summary-service**
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

describe('材料摘要生成服务', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== generateAndCacheSummaries ====================
    describe('generateAndCacheSummaries', () => {
        it('空材料数组应返回空 Map', async () => {
            const result = await generateAndCacheSummaries([], new Map())
            expect(result.size).toBe(0)
        })

        it('无可用 API 密钥时应跳过并返回空 Map', async () => {
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ status: 0, apiKey: 'disabled-key' }],
                modelSdkType: 'openai',
                modelName: 'gpt-4',
                modelProviderBaseUrl: 'https://api.example.com',
                prompts: [],
            } as any)

            const materials = [{ id: 1, name: '材料1' }]
            const contentMap = new Map([[1, '内容1']])

            const result = await generateAndCacheSummaries(materials, contentMap)
            expect(result.size).toBe(0)
        })

        it('节点配置获取失败时应跳过并返回空 Map', async () => {
            vi.mocked(getValidNodeConfig).mockRejectedValue(new Error('节点不存在'))

            const materials = [{ id: 1, name: '材料1' }]
            const contentMap = new Map([[1, '内容1']])

            const result = await generateAndCacheSummaries(materials, contentMap)
            expect(result.size).toBe(0)
        })

        it('无系统提示词时应跳过并返回空 Map', async () => {
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ status: 1, apiKey: 'valid-key' }],
                modelSdkType: 'openai',
                modelName: 'gpt-4',
                modelProviderBaseUrl: 'https://api.example.com',
                prompts: [],
            } as any)
            vi.mocked(createChatModel).mockReturnValue({} as any)

            const materials = [{ id: 1, name: '材料1' }]
            const contentMap = new Map([[1, '内容1']])

            const result = await generateAndCacheSummaries(materials, contentMap)
            expect(result.size).toBe(0)
        })

        it('应成功生成摘要并写入数据库', async () => {
            const mockModel = {
                invoke: vi.fn().mockResolvedValue({ content: '这是摘要内容' }),
            }
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ status: 1, apiKey: 'valid-key' }],
                modelSdkType: 'openai',
                modelName: 'gpt-4',
                modelProviderBaseUrl: 'https://api.example.com',
                prompts: [{ type: 'system', status: 1, content: '你是一个摘要助手' }],
            } as any)
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)
            mockPrisma.caseMaterials.update.mockResolvedValue({})

            const materials = [{ id: 1, name: '材料1' }]
            const contentMap = new Map([[1, '这是材料内容']])

            const result = await generateAndCacheSummaries(materials, contentMap)

            expect(result.size).toBe(1)
            expect(result.get(1)).toBe('这是摘要内容')
            expect(mockPrisma.$transaction).toHaveBeenCalled()
        })

        it('材料内容为空时应跳过', async () => {
            const mockModel = {
                invoke: vi.fn().mockResolvedValue({ content: '摘要' }),
            }
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ status: 1, apiKey: 'valid-key' }],
                modelSdkType: 'openai',
                modelName: 'gpt-4',
                modelProviderBaseUrl: 'https://api.example.com',
                prompts: [{ type: 'system', status: 1, content: '系统提示词' }],
            } as any)
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)

            const materials = [{ id: 1, name: '材料1' }, { id: 2, name: '材料2' }]
            // 只有材料2有内容
            const contentMap = new Map([[2, '材料2内容']])

            const result = await generateAndCacheSummaries(materials, contentMap)

            // 只有材料2生成了摘要
            expect(result.size).toBe(1)
            expect(result.has(1)).toBe(false)
            expect(result.has(2)).toBe(true)
        })

        it('单个材料摘要生成失败时不应影响其他材料', async () => {
            const mockModel = {
                invoke: vi.fn()
                    .mockRejectedValueOnce(new Error('API error'))
                    .mockResolvedValueOnce({ content: '材料2摘要' }),
            }
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ status: 1, apiKey: 'valid-key' }],
                modelSdkType: 'openai',
                modelName: 'gpt-4',
                modelProviderBaseUrl: 'https://api.example.com',
                prompts: [{ type: 'system', status: 1, content: '系统提示词' }],
            } as any)
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)
            mockPrisma.caseMaterials.update.mockResolvedValue({})

            const materials = [{ id: 1, name: '材料1' }, { id: 2, name: '材料2' }]
            const contentMap = new Map([[1, '材料1内容'], [2, '材料2内容']])

            const result = await generateAndCacheSummaries(materials, contentMap)

            // 材料1失败，材料2成功
            expect(result.size).toBe(1)
            expect(result.get(2)).toBe('材料2摘要')
        })

        it('LLM 返回数组内容时应正确处理', async () => {
            const mockModel = {
                invoke: vi.fn().mockResolvedValue({
                    content: [
                        { type: 'text', text: '第一段' },
                        { type: 'text', text: '第二段' },
                    ],
                }),
            }
            vi.mocked(getValidNodeConfig).mockResolvedValue({
                modelApiKeys: [{ status: 1, apiKey: 'valid-key' }],
                modelSdkType: 'openai',
                modelName: 'gpt-4',
                modelProviderBaseUrl: 'https://api.example.com',
                prompts: [{ type: 'system', status: 1, content: '系统提示词' }],
            } as any)
            vi.mocked(createChatModel).mockReturnValue(mockModel as any)
            mockPrisma.caseMaterials.update.mockResolvedValue({})

            const materials = [{ id: 1, name: '材料1' }]
            const contentMap = new Map([[1, '内容']])

            const result = await generateAndCacheSummaries(materials, contentMap)

            expect(result.get(1)).toBe('第一段\n第二段')
        })
    })
})
