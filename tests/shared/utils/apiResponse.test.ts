/**
 * apiResponse 工具函数测试
 *
 * 测试 API 响应处理和错误解析功能
 *
 * **Feature: api-response-utils**
 * **Validates: API 响应处理功能**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resSuccess, resError, parseErrorMessage } from '../../../shared/utils/apiResponse'

// Mock H3Event
const createMockEvent = (requestId?: string) =>
    ({
        context: {
            requestId: requestId ?? 'test-request-id',
        },
    }) as any

describe('resSuccess 成功响应', () => {
    let mockEvent: any

    beforeEach(() => {
        mockEvent = createMockEvent()
    })

    it('应返回正确格式的成功响应', () => {
        const result = resSuccess(mockEvent, '操作成功', { id: 1 })
        expect(result.success).toBe(true)
        expect(result.code).toBe(0)
        expect(result.message).toBe('操作成功')
        expect(result.data).toEqual({ id: 1 })
        expect(result.requestId).toBe('test-request-id')
        expect(result.timestamp).toBeDefined()
    })

    it('空消息应使用默认消息', () => {
        const result = resSuccess(mockEvent, '', { data: 'test' })
        // 覆盖 message || '操作成功' 的 || 分支（line 33）
        expect(result.message).toBe('操作成功')
    })

    it('空字符串消息应使用默认消息', () => {
        const result = resSuccess(mockEvent, '', null)
        expect(result.message).toBe('操作成功')
    })

    it('无数据时应不包含 data 字段', () => {
        const result = resSuccess(mockEvent, '完成')
        expect(result.data).toBeUndefined()
    })

    it('无 requestId 时应生成 UUID', () => {
        const eventWithoutRequestId = { context: {} } as any
        const result = resSuccess(eventWithoutRequestId, 'ok')
        expect(result.requestId).toBeDefined()
        expect(result.requestId.length).toBeGreaterThan(0)
    })
})

describe('resError 错误响应', () => {
    let mockEvent: any

    beforeEach(() => {
        mockEvent = createMockEvent('err-req-123')
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('应返回正确格式的错误响应', () => {
        const result = resError(mockEvent, 400, '参数错误')
        expect(result.success).toBe(false)
        expect(result.code).toBe(400)
        expect(result.message).toBe('参数错误')
        expect(result.data).toBeNull()
        expect(result.requestId).toBe('err-req-123')
    })

    it('应使用提供的 requestId', () => {
        const result = resError(mockEvent, 500, '服务器错误')
        expect(result.requestId).toBe('err-req-123')
    })
})

describe('parseErrorMessage 错误信息解析', () => {
    it('非 JSON 字符串错误消息应返回默认消息', () => {
        // "单个错误"（JSON 字符串，非数组）→ msg = "" → 返回默认消息
        expect(parseErrorMessage({ message: '"单个错误"' })).toBe('未知错误')
    })

    it('JSON 字符串数组应正确提取消息', () => {
        // ["第一个错误", "第二个错误"] → join(", ")
        expect(parseErrorMessage({ message: '["第一个错误", "第二个错误"]' })).toBe('第一个错误, 第二个错误')
    })

    it('JSON 对象数组（有 message 属性）应正确提取消息', () => {
        // [{message:"错误1"}, {message:"错误2"}] → 提取每个 .message
        expect(parseErrorMessage({ message: '[{"message":"错误A"},{"message":"错误B"}]' })).toBe('错误A, 错误B')
    })

    it('空 JSON 数组应返回默认消息', () => {
        // [] → Array.isArray([]) = true, [].length = 0 → 返回默认消息
        expect(parseErrorMessage({ message: '[]' })).toBe('未知错误')
    })

    it('空错误消息应返回默认消息', () => {
        expect(parseErrorMessage({ message: '' })).toBe('未知错误')
    })

    it('应正确使用自定义默认消息', () => {
        expect(parseErrorMessage({ message: '' }, '自定义错误')).toBe('自定义错误')
        expect(parseErrorMessage({ message: '[]' }, '自定义错误')).toBe('自定义错误')
    })

    it('无效 JSON 应返回默认消息', () => {
        expect(parseErrorMessage({ message: '普通错误文本' })).toBe('未知错误')
        // JSON.parse 抛出 SyntaxError → catch 块返回 defaultMessage（line 72）
        expect(parseErrorMessage({ message: '{invalid json}' })).toBe('未知错误')
        // 自定义默认消息在 catch 块中仍然生效
        expect(parseErrorMessage({ message: 'broken{{{' }, 'custom error')).toBe('custom error')
    })

    it('无 message 属性应返回默认消息', () => {
        expect(parseErrorMessage({})).toBe('未知错误')
        expect(parseErrorMessage(null)).toBe('未知错误')
        expect(parseErrorMessage(undefined)).toBe('未知错误')
    })

    it('混合类型数组（字符串和对象）应正确处理', () => {
        // 第一项是字符串，判定为字符串数组，join
        expect(parseErrorMessage({ message: '["str", "text"]' })).toBe('str, text')
    })

    it('复杂的多错误 JSON 数组应正确提取', () => {
        const error = { message: '["用户名已存在", "邮箱格式不正确", "密码强度不足"]' }
        expect(parseErrorMessage(error)).toBe('用户名已存在, 邮箱格式不正确, 密码强度不足')
    })

    it('单个字符串元素的 JSON 数组应正确提取', () => {
        expect(parseErrorMessage({ message: '["唯一错误"]' })).toBe('唯一错误')
    })
})
