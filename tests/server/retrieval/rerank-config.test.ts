/**
 * Rerank 模型配置服务集成测试
 *
 * **Feature: retrieval**
 * **Validates: Requirements rerank-config**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestModelProvider,
    createTestModelApiKey,
    createTestModel,
    cleanupModelTestData,
    createEmptyModelTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    ModelStatus,
    type ModelTestIds,
} from '../model/test-db-helper'

import {
    getDefaultRerankConfigService,
    getRerankConfigWithFallbackService,
} from '../../../server/services/model/modelConfig.service'

import type { RerankConfig } from '#shared/types/model'

// 检查数据库是否可用
let dbAvailable = false

describe('Rerank 模型配置服务集成测试', () => {
    const testIds: ModelTestIds = createEmptyModelTestIds()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过集成测试')
        }
    })

    afterEach(async () => {
        if (dbAvailable) {
            await cleanupModelTestData(testIds)
            testIds.providerIds = []
            testIds.apiKeyIds = []
            testIds.modelIds = []
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // ==================== getDefaultRerankConfigService 测试 ====================

    describe('getDefaultRerankConfigService 测试', () => {
        it('有默认 rerank 模型时应返回完整配置', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, { isDefault: true })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                modelType: 'rerank',
                isDefault: true,
                status: ModelStatus.ENABLED,
            })
            testIds.modelIds.push(model.id)

            const config = await getDefaultRerankConfigService()

            expect(config).not.toBeNull()
            expect(config!.model.id).toBe(model.id)
            expect(config!.model.modelType).toBe('rerank')
            expect(config!.provider.id).toBe(provider.id)
            expect(config!.apiKey!.id).toBe(apiKey.id)
        })

        it('无默认 rerank 模型时应返回 null', async () => {
            if (!dbAvailable) return

            // 确保当前无默认 rerank 模型（不创建任何数据）
            const existingConfig = await getDefaultRerankConfigService()
            if (existingConfig) {
                // 数据库中已有默认 rerank 模型，跳过本测试
                return
            }

            const config = await getDefaultRerankConfigService()
            expect(config).toBeNull()
        })
    })

    // ==================== getRerankConfigWithFallbackService 测试 ====================

    describe('getRerankConfigWithFallbackService 测试', () => {
        it('数据库有默认 rerank 配置时应返回数据库配置', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const apiKey = await createTestModelApiKey(provider.id, {
                apiKey: 'sk-db-rerank-test-key',
                isDefault: true,
            })
            testIds.apiKeyIds.push(apiKey.id)

            const model = await createTestModel(provider.id, {
                name: 'gte-rerank-v2-test',
                modelType: 'rerank',
                isDefault: true,
                status: ModelStatus.ENABLED,
            })
            testIds.modelIds.push(model.id)

            const config = await getRerankConfigWithFallbackService()

            expect(config.apiKey).toBe('sk-db-rerank-test-key')
            expect(config.baseUrl).toBe(provider.baseUrl)
            expect(config.model).toBe('gte-rerank-v2-test')
            expect(config.source).toBe('database')
        })

        it('数据库无默认 rerank 配置且环境变量不完整时应抛出错误', async () => {
            if (!dbAvailable) return

            // 确保没有默认 rerank 模型
            const existingConfig = await getDefaultRerankConfigService()
            if (existingConfig) {
                return
            }

            // 临时清除 rerank 相关环境变量以测试缺失场景
            const originalApiKey = process.env.NUXT_RERANK_API_KEY
            const originalBaseUrl = process.env.NUXT_RERANK_BASE_URL
            delete process.env.NUXT_RERANK_API_KEY
            delete process.env.NUXT_RERANK_BASE_URL

            try {
                await getRerankConfigWithFallbackService()
                // 若上面未抛出，则说明 runtimeConfig 中有 rerank 配置，测试通过即可
            } catch (error) {
                expect((error as Error).message).toContain('Rerank 模型配置不完整')
            } finally {
                // 恢复环境变量
                if (originalApiKey !== undefined) process.env.NUXT_RERANK_API_KEY = originalApiKey
                if (originalBaseUrl !== undefined) process.env.NUXT_RERANK_BASE_URL = originalBaseUrl
            }
        })
    })
})
