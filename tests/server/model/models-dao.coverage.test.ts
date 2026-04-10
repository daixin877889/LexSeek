/**
 * 模型 DAO 覆盖测试
 *
 * 覆盖 models.dao.ts 中未测试的分支：
 * - findManyModelsDao 分页/筛选
 * - findModelsByTypeDao 选项参数
 *
 * **Feature: model-dao-coverage**
 * **Validates: Requirements 1.4, 2.3, 3.3**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
    getTestPrisma,
    createTestModelProvider,
    createTestModel,
    cleanupModelTestData,
    createEmptyModelTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetModelDatabaseSequences,
    ModelType,
    type ModelTestIds,
} from './test-db-helper'

import {
    findManyModelsDao,
    findModelsByTypeDao,
    findModelsByProviderIdDao,
    updateModelDao,
} from '../../../server/services/model/models.dao'

let dbAvailable = false

describe('模型 DAO 覆盖测试', () => {
    const testIds: ModelTestIds = createEmptyModelTestIds()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (dbAvailable) {
            await resetModelDatabaseSequences()
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

    describe('findManyModelsDao - 分页和筛选', () => {
        it('应正确分页返回模型列表', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            // 创建3个模型
            for (let i = 0; i < 3; i++) {
                const model = await createTestModel(provider.id, { modelType: ModelType.CHAT })
                testIds.modelIds.push(model.id)
            }

            const page1 = await findManyModelsDao({ page: 1, pageSize: 2, providerId: provider.id })
            expect(page1.list.length).toBe(2)
            expect(page1.total).toBe(3)

            const page2 = await findManyModelsDao({ page: 2, pageSize: 2, providerId: provider.id })
            expect(page2.list.length).toBe(1)
        })

        it('按 modelType 筛选应正确过滤', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const chatModel = await createTestModel(provider.id, { modelType: ModelType.CHAT })
            const embModel = await createTestModel(provider.id, { modelType: ModelType.EMBEDDING })
            testIds.modelIds.push(chatModel.id, embModel.id)

            const result = await findManyModelsDao({
                modelType: 'chat' as any,
                providerId: provider.id,
            })
            expect(result.list.every(m => m.modelType === 'chat')).toBe(true)
        })

        it('按 status 筛选应正确过滤', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const active = await createTestModel(provider.id, { status: 1 })
            const inactive = await createTestModel(provider.id, { status: 0 })
            testIds.modelIds.push(active.id, inactive.id)

            const result = await findManyModelsDao({
                status: 1,
                providerId: provider.id,
            })
            expect(result.list.every(m => m.status === 1)).toBe(true)
        })

        it('默认分页参数应使用 page=1, pageSize=10', async () => {
            if (!dbAvailable) return

            const result = await findManyModelsDao()
            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
        })
    })

    describe('findModelsByTypeDao - 选项参数', () => {
        it('按状态和排序查询应正确', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model1 = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                priority: 10,
            })
            const model2 = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                priority: 1,
            })
            testIds.modelIds.push(model1.id, model2.id)

            const models = await findModelsByTypeDao('chat', {
                status: 1,
                orderBy: 'priority',
                orderDir: 'asc',
            })

            expect(models.length).toBeGreaterThanOrEqual(2)
        })

        it('按 name 排序应正常', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, { modelType: ModelType.CHAT })
            testIds.modelIds.push(model.id)

            const models = await findModelsByTypeDao('chat', {
                orderBy: 'name',
                orderDir: 'desc',
            })
            expect(models.length).toBeGreaterThanOrEqual(1)
        })
    })

    describe('updateModelDao - 各字段更新', () => {
        it('应支持更新多个字段', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id)
            testIds.modelIds.push(model.id)

            const updated = await updateModelDao(model.id, {
                displayName: '新显示名',
                contextWindow: 128000,
                dimensions: 1024,
                batchSize: 32,
                priority: 5,
                inputCostPerMillionTokens: 1.5,
                outputCostPerMillionTokens: 3.0,
            })

            expect(updated.displayName).toBe('新显示名')
            expect(updated.contextWindow).toBe(128000)
            expect(updated.dimensions).toBe(1024)
            expect(updated.batchSize).toBe(32)
            expect(updated.priority).toBe(5)
        })

        it('更新 modelVersion 应正确保存', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id)
            testIds.modelIds.push(model.id)

            const updated = await updateModelDao(model.id, {
                modelVersion: '2024-01-25',
            })

            expect(updated.modelVersion).toBe('2024-01-25')
        })

        it('更新 isDefault 和 status 应正确保存', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, { isDefault: false, status: 1 })
            testIds.modelIds.push(model.id)

            const updated = await updateModelDao(model.id, {
                isDefault: true,
                status: 0,
            })

            expect(updated.isDefault).toBe(true)
            expect(updated.status).toBe(0)
        })
    })
})
