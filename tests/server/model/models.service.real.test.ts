/**
 * 模型配置服务层真实数据库集成测试
 *
 * 直接调用 server/services/model/models.service.ts 中的全部导出函数，
 * 验证业务逻辑（参数校验、默认模型唯一性、级联清理等）。
 *
 * **Feature: model-management**
 * **Validates: models.service.ts 全部导出函数**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'

import {
    getTestPrisma,
    createTestModelProvider,
    createTestModel,
    cleanupModelTestData,
    createEmptyModelTestIds,
    disconnectTestDb,
    isTestDbAvailable,
    resetModelDatabaseSequences,
    ModelStatus,
    ModelType,
    SdkType,
    TEST_MODEL_NAME_PREFIX,
    type ModelTestIds,
} from './test-db-helper'

// models.service 内部依赖通过 Nuxt/Nitro 自动导入：
// - prisma / logger 已在 tests/server/membership/test-setup.ts 中注入
// - 但 models.service.ts 还引用了 modelProviders.dao 与 models.dao 中的多个 DAO 函数
//   在 vitest 环境下需要显式注入到 globalThis，以模拟自动导入行为
import * as modelsDao from '../../../server/services/model/models.dao'
import * as providersDao from '../../../server/services/model/modelProviders.dao'

;(globalThis as Record<string, unknown>).findModelProviderByIdDao = providersDao.findModelProviderByIdDao
;(globalThis as Record<string, unknown>).createModelDao = modelsDao.createModelDao
;(globalThis as Record<string, unknown>).findModelByIdDao = modelsDao.findModelByIdDao
;(globalThis as Record<string, unknown>).findManyModelsDao = modelsDao.findManyModelsDao
;(globalThis as Record<string, unknown>).findModelsByTypeDao = modelsDao.findModelsByTypeDao
;(globalThis as Record<string, unknown>).findModelsByProviderIdDao = modelsDao.findModelsByProviderIdDao
;(globalThis as Record<string, unknown>).findDefaultModelByTypeDao = modelsDao.findDefaultModelByTypeDao
;(globalThis as Record<string, unknown>).updateModelDao = modelsDao.updateModelDao
;(globalThis as Record<string, unknown>).setDefaultModelDao = modelsDao.setDefaultModelDao
;(globalThis as Record<string, unknown>).softDeleteModelDao = modelsDao.softDeleteModelDao

// 直接导入待测服务函数（必须在 DAO 注入之后，确保 service 内部首次访问全局名时已就绪）
import {
    createModelService,
    getModelByIdService,
    getModelsService,
    getModelsByTypeService,
    getModelsByProviderIdService,
    getDefaultModelByTypeService,
    updateModelService,
    setDefaultModelService,
    deleteModelService,
} from '../../../server/services/model/models.service'

// 用于断言验证的 DAO 函数（直接调用，不依赖全局注入）
const { findModelByIdDao } = modelsDao

// 数据库连接状态
let dbAvailable = false

/** 生成全局唯一的模型名称（避免唯一约束冲突） */
const uniqueModelName = (suffix = ''): string =>
    `${TEST_MODEL_NAME_PREFIX}svc_${randomUUID()}${suffix ? '_' + suffix : ''}`

describe('models.service 真实数据库集成测试', () => {
    const testIds: ModelTestIds = createEmptyModelTestIds()
    const prisma = getTestPrisma()

    beforeAll(async () => {
        dbAvailable = await isTestDbAvailable()
        if (!dbAvailable) {
            console.warn('数据库不可用，跳过 models.service 集成测试')
        } else {
            await resetModelDatabaseSequences()
        }
    })

    afterEach(async () => {
        if (!dbAvailable) return
        await cleanupModelTestData(testIds)
        testIds.providerIds = []
        testIds.apiKeyIds = []
        testIds.modelIds = []
    })

    afterAll(async () => {
        if (dbAvailable) {
            await disconnectTestDb()
        }
    })

    // ==================== createModelService ====================

    describe('createModelService', () => {
        it('应成功创建模型并使用默认 sdkType=openai', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createModelService({
                providerId: provider.id,
                name: uniqueModelName('basic'),
                displayName: '基础测试模型',
                modelType: 'chat',
            })
            testIds.modelIds.push(model.id)

            expect(model.id).toBeGreaterThan(0)
            expect(model.providerId).toBe(provider.id)
            expect(model.modelType).toBe('chat')
            expect(model.sdkType).toBe('openai')
            expect(model.isDefault).toBe(false)
            expect(model.status).toBe(1)
            expect(model.priority).toBe(10)
        })

        it('提供商不存在时应抛出"提供商不存在"', async () => {
            if (!dbAvailable) return

            await expect(
                createModelService({
                    providerId: 99_999_999,
                    name: uniqueModelName('no-provider'),
                    displayName: '不存在的提供商',
                    modelType: 'chat',
                })
            ).rejects.toThrow('提供商不存在')
        })

        it('sdkType 非法时应抛出错误并提示支持的类型', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            await expect(
                createModelService({
                    providerId: provider.id,
                    name: uniqueModelName('bad-sdk'),
                    displayName: '非法 SDK',
                    modelType: 'chat',
                    sdkType: 'invalid-sdk' as never,
                })
            ).rejects.toThrow(/不支持的 SDK 类型/)
        })

        it('支持显式指定合法 sdkType（deepseek）', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createModelService({
                providerId: provider.id,
                name: uniqueModelName('deepseek'),
                displayName: 'DeepSeek 模型',
                modelType: 'chat',
                sdkType: 'deepseek',
            })
            testIds.modelIds.push(model.id)

            expect(model.sdkType).toBe('deepseek')
        })

        it('isDefault=true 时应取消同类型其他默认模型', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            // 先创建一个已是默认的模型
            const oldDefault = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                isDefault: true,
            })
            testIds.modelIds.push(oldDefault.id)

            // 通过 service 创建新的默认模型
            const newDefault = await createModelService({
                providerId: provider.id,
                name: uniqueModelName('new-default'),
                displayName: '新默认模型',
                modelType: 'chat',
                isDefault: true,
            })
            testIds.modelIds.push(newDefault.id)

            // 旧的应不再是默认
            const reloadedOld = await findModelByIdDao(oldDefault.id)
            expect(reloadedOld!.isDefault).toBe(false)
            // 新的应为默认
            const reloadedNew = await findModelByIdDao(newDefault.id)
            expect(reloadedNew!.isDefault).toBe(true)
        })

        it('不同 modelType 的默认模型互不影响', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const chatDefault = await createTestModel(provider.id, {
                modelType: ModelType.CHAT,
                isDefault: true,
            })
            testIds.modelIds.push(chatDefault.id)

            const embDefault = await createModelService({
                providerId: provider.id,
                name: uniqueModelName('emb-default'),
                displayName: '嵌入默认模型',
                modelType: 'embedding',
                isDefault: true,
            })
            testIds.modelIds.push(embDefault.id)

            const reloadedChat = await findModelByIdDao(chatDefault.id)
            // chat 仍然是默认（不被 embedding 影响）
            expect(reloadedChat!.isDefault).toBe(true)
        })
    })

    // ==================== getModelByIdService ====================

    describe('getModelByIdService', () => {
        it('应返回包含 modelProvider 关联的模型', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const created = await createTestModel(provider.id, {
                name: uniqueModelName('get-by-id'),
            })
            testIds.modelIds.push(created.id)

            const found = await getModelByIdService(created.id)

            expect(found).not.toBeNull()
            expect(found!.id).toBe(created.id)
            expect(found!.modelProvider).toBeDefined()
            expect(found!.modelProvider.id).toBe(provider.id)
        })

        it('不存在的 ID 应返回 null', async () => {
            if (!dbAvailable) return

            const found = await getModelByIdService(99_999_999)
            expect(found).toBeNull()
        })

        it('已软删除的模型应返回 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, {
                name: uniqueModelName('soft-del'),
            })
            testIds.modelIds.push(model.id)

            await deleteModelService(model.id)

            const found = await getModelByIdService(model.id)
            expect(found).toBeNull()
        })
    })

    // ==================== getModelsService ====================

    describe('getModelsService', () => {
        it('应支持分页和按 providerId 过滤', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            for (let i = 0; i < 3; i++) {
                const m = await createTestModel(provider.id, {
                    name: uniqueModelName(`page-${i}`),
                })
                testIds.modelIds.push(m.id)
            }

            const page1 = await getModelsService({
                page: 1,
                pageSize: 2,
                providerId: provider.id,
            })
            expect(page1.list.length).toBe(2)
            expect(page1.total).toBe(3)

            const page2 = await getModelsService({
                page: 2,
                pageSize: 2,
                providerId: provider.id,
            })
            expect(page2.list.length).toBe(1)
            expect(page2.total).toBe(3)
        })

        it('无参数时应返回默认分页结果（page=1, pageSize=10）', async () => {
            if (!dbAvailable) return

            const result = await getModelsService()
            expect(result).toHaveProperty('list')
            expect(result).toHaveProperty('total')
            expect(Array.isArray(result.list)).toBe(true)
            expect(result.list.length).toBeLessThanOrEqual(10)
        })

        it('应支持按 modelType + status 联合过滤', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const enabled = await createTestModel(provider.id, {
                name: uniqueModelName('enabled-chat'),
                modelType: ModelType.CHAT,
                status: ModelStatus.ENABLED,
            })
            const disabled = await createTestModel(provider.id, {
                name: uniqueModelName('disabled-chat'),
                modelType: ModelType.CHAT,
                status: ModelStatus.DISABLED,
            })
            const otherType = await createTestModel(provider.id, {
                name: uniqueModelName('enabled-emb'),
                modelType: ModelType.EMBEDDING,
                status: ModelStatus.ENABLED,
            })
            testIds.modelIds.push(enabled.id, disabled.id, otherType.id)

            const result = await getModelsService({
                modelType: 'chat',
                status: ModelStatus.ENABLED,
                providerId: provider.id,
            })

            expect(result.list.some(m => m.id === enabled.id)).toBe(true)
            expect(result.list.some(m => m.id === disabled.id)).toBe(false)
            expect(result.list.some(m => m.id === otherType.id)).toBe(false)
        })
    })

    // ==================== getModelsByTypeService ====================

    describe('getModelsByTypeService', () => {
        it('应只返回指定类型的模型并包含 modelProvider', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const chat = await createTestModel(provider.id, {
                name: uniqueModelName('chat-only'),
                modelType: ModelType.CHAT,
            })
            const emb = await createTestModel(provider.id, {
                name: uniqueModelName('emb-only'),
                modelType: ModelType.EMBEDDING,
            })
            testIds.modelIds.push(chat.id, emb.id)

            const list = await getModelsByTypeService('chat')

            const found = list.find(m => m.id === chat.id)
            expect(found).toBeDefined()
            expect(found!.modelProvider).toBeDefined()
            expect(list.some(m => m.id === emb.id)).toBe(false)
        })

        it('应支持 status 与 orderBy/orderDir 选项', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const lowPriority = await createTestModel(provider.id, {
                name: uniqueModelName('low-pri'),
                modelType: ModelType.CHAT,
                priority: 1,
                status: ModelStatus.ENABLED,
            })
            const highPriority = await createTestModel(provider.id, {
                name: uniqueModelName('high-pri'),
                modelType: ModelType.CHAT,
                priority: 99,
                status: ModelStatus.ENABLED,
            })
            testIds.modelIds.push(lowPriority.id, highPriority.id)

            const list = await getModelsByTypeService('chat', {
                status: ModelStatus.ENABLED,
                orderBy: 'priority',
                orderDir: 'asc',
            })

            const lowIdx = list.findIndex(m => m.id === lowPriority.id)
            const highIdx = list.findIndex(m => m.id === highPriority.id)
            expect(lowIdx).toBeGreaterThanOrEqual(0)
            expect(highIdx).toBeGreaterThanOrEqual(0)
            expect(lowIdx).toBeLessThan(highIdx)
        })
    })

    // ==================== getModelsByProviderIdService ====================

    describe('getModelsByProviderIdService', () => {
        it('应只返回指定提供商的模型', async () => {
            if (!dbAvailable) return

            const providerA = await createTestModelProvider()
            const providerB = await createTestModelProvider()
            testIds.providerIds.push(providerA.id, providerB.id)

            const modelA = await createTestModel(providerA.id, {
                name: uniqueModelName('belongs-to-a'),
            })
            const modelB = await createTestModel(providerB.id, {
                name: uniqueModelName('belongs-to-b'),
            })
            testIds.modelIds.push(modelA.id, modelB.id)

            const list = await getModelsByProviderIdService(providerA.id)
            expect(list.some(m => m.id === modelA.id)).toBe(true)
            expect(list.some(m => m.id === modelB.id)).toBe(false)
        })

        it('提供商无模型时应返回空数组', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const list = await getModelsByProviderIdService(provider.id)
            expect(Array.isArray(list)).toBe(true)
            expect(list.length).toBe(0)
        })
    })

    // ==================== getDefaultModelByTypeService ====================

    describe('getDefaultModelByTypeService', () => {
        it('应返回指定类型的默认且启用的模型', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const def = await createTestModel(provider.id, {
                name: uniqueModelName('rerank-default'),
                modelType: 'rerank',
                isDefault: true,
                status: ModelStatus.ENABLED,
                priority: 1,
            })
            testIds.modelIds.push(def.id)

            const found = await getDefaultModelByTypeService('rerank')
            expect(found).not.toBeNull()
            expect(found!.id).toBe(def.id)
            expect(found!.modelProvider).toBeDefined()
        })

        it('禁用状态的默认模型不应被返回', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            // 先创建禁用的默认模型
            const disabledDefault = await createTestModel(provider.id, {
                name: uniqueModelName('rerank-disabled-default'),
                modelType: 'rerank',
                isDefault: true,
                status: ModelStatus.DISABLED,
            })
            testIds.modelIds.push(disabledDefault.id)

            const found = await getDefaultModelByTypeService('rerank')
            // 由于 status 为 DISABLED，不应返回该模型
            expect(found?.id).not.toBe(disabledDefault.id)
        })
    })

    // ==================== updateModelService ====================

    describe('updateModelService', () => {
        it('模型不存在时应抛出"模型不存在"', async () => {
            if (!dbAvailable) return

            await expect(
                updateModelService(99_999_999, { displayName: 'X' })
            ).rejects.toThrow('模型不存在')
        })

        it('sdkType 非法时应抛出错误', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, {
                name: uniqueModelName('upd-bad-sdk'),
            })
            testIds.modelIds.push(model.id)

            await expect(
                updateModelService(model.id, { sdkType: 'unknown-sdk' as never })
            ).rejects.toThrow(/不支持的 SDK 类型/)
        })

        it('普通字段更新应直接调用 DAO 并返回更新后的模型', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, {
                name: uniqueModelName('upd-basic'),
                displayName: '旧显示名',
                priority: 10,
            })
            testIds.modelIds.push(model.id)

            const updated = await updateModelService(model.id, {
                displayName: '新显示名',
                priority: 5,
                contextWindow: 64_000,
                sdkType: 'anthropic',
            })

            expect(updated).not.toBeNull()
            expect(updated!.displayName).toBe('新显示名')
            expect(updated!.priority).toBe(5)
            expect(updated!.contextWindow).toBe(64_000)
            expect(updated!.sdkType).toBe('anthropic')
        })

        it('isDefault=true 且仅含 isDefault 字段时应仅设置默认并返回最新模型', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const oldDefault = await createTestModel(provider.id, {
                name: uniqueModelName('old-asr-default'),
                modelType: ModelType.ASR,
                isDefault: true,
            })
            const target = await createTestModel(provider.id, {
                name: uniqueModelName('target-asr'),
                modelType: ModelType.ASR,
                isDefault: false,
                priority: 7,
            })
            testIds.modelIds.push(oldDefault.id, target.id)

            const result = await updateModelService(target.id, { isDefault: true })

            // setDefaultModelDao 路径：返回的是 findModelByIdDao 的结果（包含 modelProvider）
            expect(result).not.toBeNull()
            expect(result!.id).toBe(target.id)
            expect(result!.isDefault).toBe(true)
            // priority 未传入，仍保持原值
            expect(result!.priority).toBe(7)
            // 旧默认模型应被取消
            const reloadedOld = await findModelByIdDao(oldDefault.id)
            expect(reloadedOld!.isDefault).toBe(false)
        })

        it('isDefault=true 且包含其他字段时应同时更新其他字段并取消旧默认', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const oldDefault = await createTestModel(provider.id, {
                name: uniqueModelName('old-chat-default-mixed'),
                modelType: ModelType.CHAT,
                isDefault: true,
            })
            const target = await createTestModel(provider.id, {
                name: uniqueModelName('target-chat-mixed'),
                modelType: ModelType.CHAT,
                isDefault: false,
                displayName: '原显示名',
            })
            testIds.modelIds.push(oldDefault.id, target.id)

            const result = await updateModelService(target.id, {
                isDefault: true,
                displayName: '修改后的显示名',
                priority: 3,
            })

            expect(result).not.toBeNull()
            expect(result!.id).toBe(target.id)
            expect(result!.displayName).toBe('修改后的显示名')
            expect(result!.priority).toBe(3)

            // 验证默认状态：因 setDefaultModelDao 在 updateModelDao 之后执行，target 应为默认
            const reloadedTarget = await findModelByIdDao(target.id)
            expect(reloadedTarget!.isDefault).toBe(true)

            const reloadedOld = await findModelByIdDao(oldDefault.id)
            expect(reloadedOld!.isDefault).toBe(false)
        })

        it('isDefault=true 且更换 modelType 时应按新 modelType 取消同类型默认', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            // 现有 embedding 默认模型
            const existingEmbDefault = await createTestModel(provider.id, {
                name: uniqueModelName('exist-emb-default'),
                modelType: ModelType.EMBEDDING,
                isDefault: true,
            })
            // 目标是一个 chat 模型，准备改为 embedding 并设为默认
            const target = await createTestModel(provider.id, {
                name: uniqueModelName('chat-to-emb'),
                modelType: ModelType.CHAT,
                isDefault: false,
            })
            testIds.modelIds.push(existingEmbDefault.id, target.id)

            const result = await updateModelService(target.id, {
                isDefault: true,
                modelType: 'embedding',
            })

            expect(result).not.toBeNull()
            expect(result!.id).toBe(target.id)
            expect(result!.modelType).toBe('embedding')

            // 现有 embedding 默认模型应被取消
            const reloadedExisting = await findModelByIdDao(existingEmbDefault.id)
            expect(reloadedExisting!.isDefault).toBe(false)

            const reloadedTarget = await findModelByIdDao(target.id)
            expect(reloadedTarget!.isDefault).toBe(true)
        })

        it('isDefault=false 时应通过普通 update 路径，不影响其他默认模型', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const otherDefault = await createTestModel(provider.id, {
                name: uniqueModelName('other-chat-default'),
                modelType: ModelType.CHAT,
                isDefault: true,
            })
            const target = await createTestModel(provider.id, {
                name: uniqueModelName('target-no-default'),
                modelType: ModelType.CHAT,
                isDefault: false,
            })
            testIds.modelIds.push(otherDefault.id, target.id)

            const result = await updateModelService(target.id, {
                isDefault: false,
                displayName: '不改默认',
            })

            expect(result!.displayName).toBe('不改默认')
            // 其他默认模型不受影响
            const reloadedOther = await findModelByIdDao(otherDefault.id)
            expect(reloadedOther!.isDefault).toBe(true)
        })
    })

    // ==================== setDefaultModelService ====================

    describe('setDefaultModelService', () => {
        it('应将指定模型设为默认并取消同类型其他默认', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const oldDefault = await createTestModel(provider.id, {
                name: uniqueModelName('set-old-default'),
                modelType: ModelType.CHAT,
                isDefault: true,
            })
            const target = await createTestModel(provider.id, {
                name: uniqueModelName('set-target'),
                modelType: ModelType.CHAT,
                isDefault: false,
            })
            testIds.modelIds.push(oldDefault.id, target.id)

            await setDefaultModelService(target.id)

            const reloadedOld = await findModelByIdDao(oldDefault.id)
            expect(reloadedOld!.isDefault).toBe(false)

            const reloadedTarget = await findModelByIdDao(target.id)
            expect(reloadedTarget!.isDefault).toBe(true)
        })

        it('模型不存在时应抛出"模型不存在"', async () => {
            if (!dbAvailable) return

            await expect(setDefaultModelService(99_999_999)).rejects.toThrow('模型不存在')
        })
    })

    // ==================== deleteModelService ====================

    describe('deleteModelService', () => {
        it('应软删除模型，deletedAt 字段被设置且查询返回 null', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, {
                name: uniqueModelName('to-delete'),
            })
            testIds.modelIds.push(model.id)

            await deleteModelService(model.id)

            // service / DAO 的查询应返回 null
            const found = await getModelByIdService(model.id)
            expect(found).toBeNull()

            // 直接查询底层数据应有 deletedAt
            const raw = await prisma.models.findUnique({ where: { id: model.id } })
            expect(raw).not.toBeNull()
            expect(raw!.deletedAt).not.toBeNull()
        })

        it('模型不存在时应抛出"模型不存在"', async () => {
            if (!dbAvailable) return

            await expect(deleteModelService(99_999_999)).rejects.toThrow('模型不存在')
        })

        it('已软删除的模型再次删除应抛出"模型不存在"', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, {
                name: uniqueModelName('double-delete'),
            })
            testIds.modelIds.push(model.id)

            await deleteModelService(model.id)
            await expect(deleteModelService(model.id)).rejects.toThrow('模型不存在')
        })
    })

    // ==================== SDK_TYPES 边界覆盖 ====================

    describe('SDK 类型边界覆盖', () => {
        it.each([SdkType.OPENAI, SdkType.DEEPSEEK, SdkType.GEMINI, SdkType.ANTHROPIC] as const)(
            '合法 sdkType=%s 应可创建',
            async (sdk) => {
                if (!dbAvailable) return

                const provider = await createTestModelProvider()
                testIds.providerIds.push(provider.id)

                const model = await createModelService({
                    providerId: provider.id,
                    name: uniqueModelName(`sdk-${sdk}`),
                    displayName: `SDK ${sdk}`,
                    modelType: 'chat',
                    sdkType: sdk,
                })
                testIds.modelIds.push(model.id)

                expect(model.sdkType).toBe(sdk)
            }
        )

        it('createModelService 不传 sdkType 时不会触发校验', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createModelService({
                providerId: provider.id,
                name: uniqueModelName('no-sdk'),
                displayName: '不传 sdkType',
                modelType: 'chat',
            })
            testIds.modelIds.push(model.id)

            // DAO 默认填充为 openai
            expect(model.sdkType).toBe('openai')
        })

        it('updateModelService 不传 sdkType 时不会触发校验', async () => {
            if (!dbAvailable) return

            const provider = await createTestModelProvider()
            testIds.providerIds.push(provider.id)

            const model = await createTestModel(provider.id, {
                name: uniqueModelName('upd-no-sdk'),
            })
            testIds.modelIds.push(model.id)

            const updated = await updateModelService(model.id, { displayName: '只改显示名' })
            expect(updated!.displayName).toBe('只改显示名')
        })
    })
})
