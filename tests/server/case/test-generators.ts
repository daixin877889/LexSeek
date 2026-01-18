/**
 * 案件模块测试数据生成器
 *
 * 使用 fast-check 生成随机测试数据，用于属性测试
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 1.1, 2.1**
 */

import * as fc from 'fast-check'
import { CaseStatus, SessionStatus, CaseMaterialType } from '../../../shared/types/case'
import { MaterialStatus } from '../../../shared/types/material'

// ==================== 属性测试配置 ====================

/** 属性测试默认配置 */
export const PBT_CONFIG = { numRuns: 100 }

/** 属性测试快速配置（用于耗时较长的测试） */
export const PBT_CONFIG_FAST = { numRuns: 10 }

// ==================== 基础数据生成器 ====================

/** 生成有效的中文名称 */
export const chineseNameArb = fc.string({ minLength: 2, maxLength: 20 })
    .filter(s => s.trim().length >= 2)
    .map(s => s.trim())

/** 生成有效的描述文本 */
export const descriptionArb = fc.option(
    fc.string({ minLength: 1, maxLength: 200 }).map(s => s.trim()),
    { nil: null }
)

/** 生成正整数 */
export const positiveIntArb = fc.integer({ min: 1, max: 10000 })

/** 生成状态值（0 或 1） */
export const statusArb = fc.constantFrom(0, 1)

/** 生成有效日期 */
export const validDateArb = fc.date({
    min: new Date('2024-01-01'),
    max: new Date('2030-12-31'),
}).filter(d => !isNaN(d.getTime()))

// ==================== 案件类型数据生成器 ====================

/** 案件类型状态生成器 */
export const caseTypeStatusArb = fc.constantFrom(0, 1)

/** 案件类型创建数据生成器 */
export const caseTypeDataArbitrary = fc.record({
    name: fc.string({ minLength: 2, maxLength: 30 }).map(s => `测试类型_${s.trim() || Date.now()}`),
    description: descriptionArb,
    icon: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
    priority: fc.integer({ min: 1, max: 100 }),
    status: caseTypeStatusArb,
})

// ==================== 案件数据生成器 ====================

/** 案件状态生成器 */
export const caseStatusArb = fc.constantFrom(
    CaseStatus.IN_PROGRESS,
    CaseStatus.COMPLETED,
    CaseStatus.CLOSED
)

/** 当事人信息生成器 */
export const partyInfoArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.trim() || '测试当事人'),
    type: fc.option(fc.constantFrom('individual', 'company'), { nil: undefined }),
    contact: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
    address: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
})

/** 当事人列表生成器 */
export const partyListArb = fc.option(
    fc.array(partyInfoArb, { minLength: 1, maxLength: 3 }),
    { nil: null }
)

/** 案件创建数据生成器（不含外键） */
export const caseDataArbitrary = fc.record({
    title: fc.string({ minLength: 2, maxLength: 100 }).map(s => `测试案件_${s.trim() || Date.now()}`),
    content: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: null }),
    plaintiff: partyListArb,
    defendant: partyListArb,
    isDemo: fc.boolean(),
    status: caseStatusArb,
})

/** 案件更新数据生成器 */
export const caseUpdateDataArb = fc.record({
    title: fc.option(fc.string({ minLength: 2, maxLength: 100 }).map(s => `测试案件_${s.trim()}`), { nil: undefined }),
    content: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
    plaintiff: fc.option(partyListArb, { nil: undefined }),
    defendant: fc.option(partyListArb, { nil: undefined }),
    status: fc.option(caseStatusArb, { nil: undefined }),
})

// ==================== 会话数据生成器 ====================

/** 会话状态生成器 */
export const sessionStatusArb = fc.constantFrom(
    SessionStatus.IN_PROGRESS,
    SessionStatus.COMPLETED,
    SessionStatus.INTERRUPTED,
    SessionStatus.FAILED
)

/** 会话创建数据生成器（不含外键） */
export const sessionDataArbitrary = fc.record({
    status: sessionStatusArb,
})

// ==================== 材料数据生成器 ====================

/** 材料类型生成器 */
export const materialTypeArb = fc.constantFrom(
    CaseMaterialType.CASE_CONTENT,
    CaseMaterialType.DOCUMENT,
    CaseMaterialType.IMAGE,
    CaseMaterialType.AUDIO
)

/** 材料状态生成器 */
export const materialStatusArb = fc.constantFrom(
    MaterialStatus.PENDING,
    MaterialStatus.PROCESSING,
    MaterialStatus.COMPLETED,
    MaterialStatus.FAILED
)

/** 材料创建数据生成器（不含外键） */
export const materialDataArbitrary = fc.record({
    name: fc.string({ minLength: 2, maxLength: 100 }).map(s => `测试材料_${s.trim() || Date.now()}`),
    type: materialTypeArb,
    content: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: null }),
    originalContent: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: null }),
    isEncrypted: fc.boolean(),
    status: materialStatusArb,
})

/** 材料更新数据生成器 */
export const materialUpdateDataArb = fc.record({
    name: fc.option(fc.string({ minLength: 2, maxLength: 100 }).map(s => `测试材料_${s.trim()}`), { nil: undefined }),
    content: fc.option(fc.string({ minLength: 1, maxLength: 1000 }), { nil: undefined }),
    status: fc.option(materialStatusArb, { nil: undefined }),
})

// ==================== 分析结果数据生成器 ====================

/** 分析状态生成器 */
export const analysisStatusArb = fc.constantFrom(1, 2, 3) // IN_PROGRESS, COMPLETED, FAILED

/** 分析结果创建数据生成器（不含外键） */
export const analysisDataArbitrary = fc.record({
    analysisType: fc.string({ minLength: 2, maxLength: 50 }).map(s => `test_${s.trim() || 'analysis'}`),
    analysisResult: fc.option(fc.string({ minLength: 1, maxLength: 2000 }), { nil: null }),
    originalResult: fc.option(fc.string({ minLength: 1, maxLength: 2000 }), { nil: null }),
    version: fc.integer({ min: 1, max: 100 }),
    status: analysisStatusArb,
})

// ==================== SSE 消息数据生成器 ====================

/** SSE 消息类型生成器 */
export const sseMessageTypeArb = fc.constantFrom(
    'connected',
    'heartbeat',
    'closed',
    'workflow:start',
    'workflow:complete',
    'workflow:error',
    'interrupt',
    'task:start',
    'task:progress',
    'task:complete',
    'task:error',
    'reasoning',
    'text:delta',
    'text:complete',
    'tool:call',
    'tool:result',
    'info',
    'warning',
    'error'
)

/** SSE 消息数据生成器 */
export const sseMessageArbitrary = fc.record({
    type: sseMessageTypeArb,
    message: fc.string({ minLength: 1, maxLength: 200 }),
    data: fc.option(
        fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !['__proto__', 'constructor', 'prototype'].includes(s)),
            fc.oneof(fc.string(), fc.integer(), fc.boolean())
        ),
        { nil: undefined }
    ),
    timestamp: fc.option(fc.integer({ min: 1704067200000, max: 1893456000000 }), { nil: undefined }),
})

// ==================== 查询参数生成器 ====================

/** 分页参数生成器 */
export const paginationArb = fc.record({
    page: fc.integer({ min: 1, max: 100 }),
    pageSize: fc.integer({ min: 1, max: 100 }),
})

/** 排序方向生成器 */
export const orderDirArb = fc.constantFrom('asc', 'desc')

/** 案件列表查询参数生成器 */
export const caseListParamsArb = fc.record({
    page: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    pageSize: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    status: fc.option(caseStatusArb, { nil: undefined }),
    isDemo: fc.option(fc.boolean(), { nil: undefined }),
    keyword: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    orderBy: fc.option(fc.constantFrom('id', 'title', 'createdAt', 'updatedAt'), { nil: undefined }),
    orderDir: fc.option(orderDirArb, { nil: undefined }),
})

/** 材料列表查询参数生成器 */
export const materialListParamsArb = fc.record({
    page: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    pageSize: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    type: fc.option(materialTypeArb, { nil: undefined }),
    status: fc.option(materialStatusArb, { nil: undefined }),
    orderBy: fc.option(fc.constantFrom('id', 'name', 'type', 'status', 'createdAt'), { nil: undefined }),
    orderDir: fc.option(orderDirArb, { nil: undefined }),
})

// ==================== 辅助函数 ====================

/**
 * 生成唯一的测试标识
 */
export const generateTestId = (): string => {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

/**
 * 过滤掉 undefined 值
 */
export const filterUndefined = <T extends Record<string, any>>(obj: T): Partial<T> => {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => v !== undefined)
    ) as Partial<T>
}
