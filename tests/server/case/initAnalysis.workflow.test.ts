/**
 * 初始化分析 LangGraph 工作流测试
 *
 * **Feature: case-init-analysis**
 * **Validates: routeAfterExecute 路由逻辑, InitAnalysisAnnotation 状态定义**
 */

import { describe, it, expect } from 'vitest'
import { routeAfterExecute } from '../../../server/services/workflow/initAnalysis.workflow'
import type { InitAnalysisState } from '../../../server/services/workflow/initAnalysis.state'

/**
 * 创建最小化的测试状态
 */
function createTestState(overrides: Partial<InitAnalysisState> = {}): InitAnalysisState {
    return {
        messages: [],
        userId: 1,
        caseId: 1,
        sessionId: 'test-session',
        selectedModules: ['summary', 'chronicle', 'claim'],
        currentModuleIndex: 0,
        completedResults: {},
        failedModules: {},
        currentModule: '',
        isComplete: false,
        error: null,
        ...overrides,
    }
}

describe('初始化分析 LangGraph 工作流', () => {
    // ==================== routeAfterExecute ====================

    describe('routeAfterExecute - 路由逻辑', () => {
        it('当 currentModuleIndex < selectedModules.length 时路由回 execute_module', () => {
            const state = createTestState({
                selectedModules: ['summary', 'chronicle'],
                currentModuleIndex: 1,
            })
            expect(routeAfterExecute(state)).toBe('execute_module')
        })

        it('当 currentModuleIndex >= selectedModules.length 时路由到 __end__', () => {
            const state = createTestState({
                selectedModules: ['summary', 'chronicle'],
                currentModuleIndex: 2,
            })
            expect(routeAfterExecute(state)).toBe('__end__')
        })

        it('当 currentModuleIndex 超过模块总数时路由到 __end__', () => {
            const state = createTestState({
                selectedModules: ['summary'],
                currentModuleIndex: 5,
            })
            expect(routeAfterExecute(state)).toBe('__end__')
        })

        it('当 isComplete 为 true 时路由到 __end__', () => {
            const state = createTestState({
                selectedModules: ['summary', 'chronicle'],
                currentModuleIndex: 0,
                isComplete: true,
            })
            expect(routeAfterExecute(state)).toBe('__end__')
        })

        it('当 isComplete 为 true 且还有未执行模块时仍路由到 __end__', () => {
            const state = createTestState({
                selectedModules: ['summary', 'chronicle', 'claim'],
                currentModuleIndex: 1,
                isComplete: true,
            })
            expect(routeAfterExecute(state)).toBe('__end__')
        })

        it('当 selectedModules 为空时路由到 __end__', () => {
            const state = createTestState({
                selectedModules: [],
                currentModuleIndex: 0,
            })
            expect(routeAfterExecute(state)).toBe('__end__')
        })

        it('单个模块执行完后路由到 __end__', () => {
            const state = createTestState({
                selectedModules: ['summary'],
                currentModuleIndex: 1,
            })
            expect(routeAfterExecute(state)).toBe('__end__')
        })

        it('全部7个模块中间位置继续循环', () => {
            const allModules = ['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence']
            const state = createTestState({
                selectedModules: allModules,
                currentModuleIndex: 3,
            })
            expect(routeAfterExecute(state)).toBe('execute_module')
        })

        it('全部7个模块执行完后路由到 __end__', () => {
            const allModules = ['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence']
            const state = createTestState({
                selectedModules: allModules,
                currentModuleIndex: 7,
            })
            expect(routeAfterExecute(state)).toBe('__end__')
        })
    })

    // ==================== State 类型和结构 ====================

    describe('InitAnalysisState - 状态结构', () => {
        it('默认状态应包含所有必需字段', () => {
            const state = createTestState()
            expect(state).toHaveProperty('messages')
            expect(state).toHaveProperty('userId')
            expect(state).toHaveProperty('caseId')
            expect(state).toHaveProperty('sessionId')
            expect(state).toHaveProperty('selectedModules')
            expect(state).toHaveProperty('currentModuleIndex')
            expect(state).toHaveProperty('completedResults')
            expect(state).toHaveProperty('failedModules')
            expect(state).toHaveProperty('currentModule')
            expect(state).toHaveProperty('isComplete')
            expect(state).toHaveProperty('error')
        })

        it('completedResults 应支持累积合并', () => {
            const state = createTestState({
                completedResults: { summary: '概要结果' },
            })
            // 模拟 reducer 合并
            const newResults = { ...state.completedResults, chronicle: '大事记结果' }
            expect(newResults).toEqual({
                summary: '概要结果',
                chronicle: '大事记结果',
            })
        })

        it('failedModules 应支持累积合并', () => {
            const state = createTestState({
                failedModules: { claim: '节点配置错误' },
            })
            const newFailed = { ...state.failedModules, trend: 'API 密钥不可用' }
            expect(newFailed).toEqual({
                claim: '节点配置错误',
                trend: 'API 密钥不可用',
            })
        })
    })
})
