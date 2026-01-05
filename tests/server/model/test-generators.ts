/**
 * 模型管理测试数据生成器
 *
 * 使用 fast-check 生成随机测试数据
 *
 * **Feature: model-management**
 * **Validates: Requirements 1.1, 2.1, 3.1**
 */

import * as fc from 'fast-check'
import { ModelStatus, ModelType } from './test-db-helper'

// ==================== 属性测试配置 ====================

/** 快速属性测试配置（10 次迭代） */
export const PBT_CONFIG_FAST = { numRuns: 10 }

/** 标准属性测试配置（100 次迭代） */
export const PBT_CONFIG_STANDARD = { numRuns: 100 }

// ==================== 数据生成器 ====================

/**
 * 生成有效的提供商名称
 */
export const providerNameArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0)
    .map(s => `测试提供商_${s}_${Date.now()}`)

/**
 * 生成有效的 URL
 */
export const baseUrlArb = fc.webUrl({ withPath: false })

/**
 * 生成提供商描述
 */
export const descriptionArb = fc.option(
    fc.string({ minLength: 0, maxLength: 200 }),
    { nil: null }
)

/**
 * 生成提供商创建数据
 */
export const providerDataArb = fc.record({
    name: providerNameArb,
    baseUrl: baseUrlArb,
    description: descriptionArb,
})

/**
 * 生成有效的 API 密钥名称
 */
export const apiKeyNameArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0)
    .map(s => `测试密钥_${s}_${Date.now()}`)

/**
 * 生成有效的 API 密钥值
 */
export const apiKeyValueArb = fc.string({ minLength: 10, maxLength: 100 })
    .filter(s => s.trim().length >= 10)
    .map(s => `sk-${s}`)

/**
 * 生成 API 密钥创建数据
 */
export const apiKeyDataArb = fc.record({
    name: apiKeyNameArb,
    apiKey: apiKeyValueArb,
    isDefault: fc.boolean(),
    status: fc.constantFrom(ModelStatus.ENABLED, ModelStatus.DISABLED),
    dailyLimit: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: null }),
    monthlyLimit: fc.option(fc.integer({ min: 1, max: 1000000 }), { nil: null }),
})

/**
 * 生成有效的模型名称
 */
export const modelNameArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0)
    .map(s => `测试模型_${s}_${Date.now()}`)

/**
 * 生成模型显示名称
 */
export const displayNameArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0)
    .map(s => `显示名_${s}`)

/**
 * 生成模型类型
 */
export const modelTypeArb = fc.constantFrom(
    ModelType.CHAT,
    ModelType.EMBEDDING,
    ModelType.ASR
)

/**
 * 生成模型创建数据
 */
export const modelDataArb = fc.record({
    name: modelNameArb,
    displayName: displayNameArb,
    modelType: modelTypeArb,
    modelVersion: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
    contextWindow: fc.option(fc.integer({ min: 1024, max: 128000 }), { nil: null }),
    dimensions: fc.option(fc.integer({ min: 128, max: 4096 }), { nil: null }),
    batchSize: fc.option(fc.integer({ min: 1, max: 100 }), { nil: null }),
    isDefault: fc.boolean(),
    status: fc.constantFrom(ModelStatus.ENABLED, ModelStatus.DISABLED),
    priority: fc.integer({ min: 1, max: 100 }),
})

/**
 * 生成嵌入模型创建数据
 */
export const embeddingModelDataArb = fc.record({
    name: modelNameArb,
    displayName: displayNameArb,
    modelType: fc.constant(ModelType.EMBEDDING),
    dimensions: fc.integer({ min: 128, max: 4096 }),
    batchSize: fc.integer({ min: 1, max: 100 }),
    isDefault: fc.boolean(),
    status: fc.constantFrom(ModelStatus.ENABLED, ModelStatus.DISABLED),
    priority: fc.integer({ min: 1, max: 100 }),
})
