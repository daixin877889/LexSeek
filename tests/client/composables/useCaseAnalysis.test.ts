/**
 * useCaseAnalysis 案件分析 Composable 测试
 *
 * 测试案件分析 SSE 消息处理功能
 *
 * **Feature: case-analysis**
 * **Validates: 案件分析 SSE 消息解析**
 */

import { describe, it, expect } from 'vitest'
import { createInitialState, parseSSEMessage } from '~/composables/useCaseAnalysis'

describe('createInitialState 初始状态创建', () => {
    it('应返回正确的初始状态', () => {
        const state = createInitialState()
        expect(state.isConnected).toBe(false)
        expect(state.isLoading).toBe(false)
        expect(state.isInterrupted).toBe(false)
        expect(state.isComplete).toBe(false)
        expect(state.currentPhase).toBeNull()
        expect(state.currentInterrupt).toBeNull()
        expect(state.error).toBeNull()
        expect(state.messages).toEqual([])
        expect(state.streamingText).toBe('')
        expect(state.reasoningText).toBe('')
        expect(state.toolCalls).toEqual([])
        expect(state.tasks).toEqual([])
        expect(state.analysisResults).toEqual([])
    })

    it('每次调用应返回新对象', () => {
        const state1 = createInitialState()
        const state2 = createInitialState()
        expect(state1).not.toBe(state2)
        expect(state1.messages).not.toBe(state2.messages)
    })

    it('初始状态各字段类型正确', () => {
        const state = createInitialState()
        expect(typeof state.isConnected).toBe('boolean')
        expect(typeof state.isLoading).toBe('boolean')
        expect(typeof state.isInterrupted).toBe('boolean')
        expect(typeof state.isComplete).toBe('boolean')
        expect(state.messages).toBeInstanceOf(Array)
        expect(state.toolCalls).toBeInstanceOf(Array)
        expect(state.tasks).toBeInstanceOf(Array)
        expect(state.analysisResults).toBeInstanceOf(Array)
    })
})

describe('parseSSEMessage SSE 消息解析', () => {
    it('应解析标准 JSON 对象', () => {
        const result = parseSSEMessage('{"type":"connected","message":"hello"}')
        expect(result).toEqual({ type: 'connected', message: 'hello' })
    })

    it('应解析 data: 前缀的 SSE 消息', () => {
        const result = parseSSEMessage('data: {"type":"connected","message":"hello"}')
        expect(result).toEqual({ type: 'connected', message: 'hello' })
    })

    it('应正确处理 data: 后只有空白字符', () => {
        const result = parseSSEMessage('data:   ')
        expect(result).toBeNull()
    })

    it('空字符串应返回 null', () => {
        expect(parseSSEMessage('')).toBeNull()
    })

    it('[DONE] 应返回 null', () => {
        expect(parseSSEMessage('[DONE]')).toBeNull()
    })

    it('无效 JSON 应返回 null 并记录警告', () => {
        expect(parseSSEMessage('not valid json')).toBeNull()
        expect(parseSSEMessage('{broken json}')).toBeNull()
    })

    it('data:[DONE] 应返回 null', () => {
        expect(parseSSEMessage('data:[DONE]')).toBeNull()
    })

    it('data: 后面是 [DONE] 应返回 null', () => {
        expect(parseSSEMessage('data: [DONE]')).toBeNull()
    })

    it('复杂对象应正确解析', () => {
        const obj = {
            type: 'workflow_complete',
            data: { currentPhase: 'MATERIAL_PROCESS', analysisResults: [] },
            message: 'complete',
        }
        const result = parseSSEMessage(JSON.stringify(obj))
        expect(result).toEqual(obj)
    })

    it('应处理 SSE 消息 data: 前缀带多余空白', () => {
        const result = parseSSEMessage('data:   {"type":"test"}   ')
        expect(result).toEqual({ type: 'test' })
    })

    it('嵌套 JSON 应正确解析', () => {
        const obj = {
            type: 'interrupt',
            data: {
                __interrupt__: {
                    type: 'case_info_check',
                    message: '请补充信息',
                },
            },
        }
        const result = parseSSEMessage(JSON.stringify(obj))
        expect(result).toEqual(obj)
        expect(result?.data?.__interrupt__?.type).toBe('case_info_check')
    })
})
