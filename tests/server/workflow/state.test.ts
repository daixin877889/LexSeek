/**
 * 工作流状态测试
 *
 * 测试 workflow/state.ts 中的函数，包括：
 * - createInitialState
 * - createInterruptData
 * - isInPhase
 * - isWorkflowComplete
 * - hasWorkflowError
 * - getNextModule
 * - areAllModulesComplete
 *
 * **Feature: workflow-state**
 * **Validates: Requirements 1.1, 1.5, 1.6, 2.2, 2.3**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { WorkflowPhase, InterruptType } from '#shared/types/case'
import {
    createInitialState,
    createInterruptData,
    isInPhase,
    isWorkflowComplete,
    hasWorkflowError,
    getNextModule,
    areAllModulesComplete,
    type CaseAnalysisState,
    type CaseAnalysisStateUpdate,
} from '../../../server/services/workflow/state'

const PBT_CONFIG = { numRuns: 100 }

/** 从部分状态创建完整状态 */
const createFullState = (partial: Partial<CaseAnalysisState> = {}): CaseAnalysisState => ({
    messages: partial.messages ?? [],
    userId: partial.userId ?? 1,
    caseId: partial.caseId ?? 1,
    sessionId: partial.sessionId ?? 'session-1',
    caseTypeId: partial.caseTypeId ?? 1,
    materials: partial.materials ?? [],
    aggregatedContent: partial.aggregatedContent ?? '',
    caseInfoSufficient: partial.caseInfoSufficient ?? false,
    caseInfoCheckResult: partial.caseInfoCheckResult ?? '',
    supplementedCaseInfo: partial.supplementedCaseInfo ?? '',
    title: partial.title ?? '',
    plaintiff: partial.plaintiff ?? [],
    defendant: partial.defendant ?? [],
    caseTypeName: partial.caseTypeName ?? '',
    summary: partial.summary ?? '',
    basicInfoConfirmed: partial.basicInfoConfirmed ?? false,
    extractedInfo: partial.extractedInfo ?? null,
    availableModules: partial.availableModules ?? [],
    selectedModules: partial.selectedModules ?? [],
    currentModuleIndex: partial.currentModuleIndex ?? 0,
    analysisResults: partial.analysisResults ?? [],
    lastExecutedModule: partial.lastExecutedModule ?? '',
    lastExecutedResult: partial.lastExecutedResult ?? '',
    lastExecutedTitle: partial.lastExecutedTitle ?? '',
    currentPhase: partial.currentPhase ?? WorkflowPhase.MATERIAL_PROCESS,
    isComplete: partial.isComplete ?? false,
    error: partial.error ?? null,
})

describe('工作流状态', () => {
    describe('createInitialState - 创建初始状态', () => {
        it('应返回包含所有必需字段的状态', () => {
            const state = createInitialState({
                userId: 1,
                caseId: 2,
                sessionId: 'session-123',
                caseTypeId: 3,
            })

            expect(state.userId).toBe(1)
            expect(state.caseId).toBe(2)
            expect(state.sessionId).toBe('session-123')
            expect(state.caseTypeId).toBe(3)
            expect(state.materials).toEqual([])
            expect(state.currentPhase).toBe(WorkflowPhase.MATERIAL_PROCESS)
            expect(state.isComplete).toBe(false)
        })

        it('提供材料时应包含在状态中', () => {
            const materials = [
                { id: 1, name: '合同', type: 1, content: '合同内容' },
            ]
            const state = createInitialState({
                userId: 1,
                caseId: 2,
                sessionId: 'session-1',
                caseTypeId: 3,
                materials,
            })

            expect(state.materials).toEqual(materials)
        })

        it('初始状态应设置正确的默认值', () => {
            const state = createInitialState({
                userId: 1,
                caseId: 2,
                sessionId: 'session-1',
                caseTypeId: 3,
            })

            expect(state.caseInfoSufficient).toBe(false)
            expect(state.basicInfoConfirmed).toBe(false)
            expect(state.selectedModules).toEqual([])
            expect(state.availableModules).toEqual([])
            expect(state.currentModuleIndex).toBe(0)
            expect(state.analysisResults).toEqual([])
            expect(state.error).toBeNull()
            expect(state.extractedInfo).toBeNull()
        })

        it('属性测试：初始状态应符合状态约束', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 10000 }),
                    fc.uuid(),
                    fc.integer({ min: 1, max: 100 }),
                    (userId, caseId, sessionId, caseTypeId) => {
                        const state = createInitialState({ userId, caseId, sessionId, caseTypeId })

                        expect(state.userId).toBe(userId)
                        expect(state.caseId).toBe(caseId)
                        expect(state.sessionId).toBe(sessionId)
                        expect(state.caseTypeId).toBe(caseTypeId)
                        expect(state.isComplete).toBe(false)
                        expect(state.currentPhase).toBe(WorkflowPhase.MATERIAL_PROCESS)

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    describe('createInterruptData - 创建中断数据', () => {
        it('应返回正确的中断数据格式', () => {
            const interrupt = createInterruptData(
                InterruptType.CASE_INFO_CHECK,
                '请补充案情信息',
                { required: true }
            )

            expect(interrupt.type).toBe(InterruptType.CASE_INFO_CHECK)
            expect(interrupt.message).toBe('请补充案情信息')
            expect(interrupt.data).toEqual({ required: true })
            expect(interrupt.resumable).toBe(true)
            expect(interrupt.node).toBe('')
        })

        it('默认值参数应生效', () => {
            const interrupt = createInterruptData(
                InterruptType.MODULE_SELECT,
                '请选择模块'
            )

            expect(interrupt.resumable).toBe(true)
            expect(interrupt.node).toBe('')
            expect(interrupt.data).toEqual({})
        })

        it('自定义 resumable 和 node 应生效', () => {
            const interrupt = createInterruptData(
                InterruptType.BASIC_INFO_CONFIRM,
                '确认信息',
                { confirmed: false },
                false,
                'basicInfoConfirmNode'
            )

            expect(interrupt.resumable).toBe(false)
            expect(interrupt.node).toBe('basicInfoConfirmNode')
        })

        it('属性测试：创建的中断数据应包含所有必需字段', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        InterruptType.CASE_INFO_CHECK,
                        InterruptType.BASIC_INFO_CONFIRM,
                        InterruptType.MODULE_SELECT,
                        InterruptType.INSUFFICIENT_POINTS
                    ),
                    fc.string({ minLength: 1, maxLength: 100 }),
                    fc.dictionary(
                        fc.string(),
                        fc.oneof(fc.string(), fc.integer(), fc.boolean()),
                        { maxKeys: 5 }
                    ),
                    fc.boolean(),
                    fc.string({ maxLength: 50 }),
                    (type, message, data, resumable, node) => {
                        const interrupt = createInterruptData(type, message, data, resumable, node)

                        expect(interrupt.type).toBe(type)
                        expect(interrupt.message).toBe(message)
                        expect(interrupt.data).toEqual(data)
                        expect(interrupt.resumable).toBe(resumable)
                        expect(interrupt.node).toBe(node)

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    describe('isInPhase - 阶段检查', () => {
        it('匹配阶段时应返回 true', () => {
            const state = createFullState({ currentPhase: WorkflowPhase.CASE_INFO_CHECK })
            expect(isInPhase(state, WorkflowPhase.CASE_INFO_CHECK)).toBe(true)
        })

        it('不匹配阶段时应返回 false', () => {
            const state = createFullState({ currentPhase: WorkflowPhase.MATERIAL_PROCESS })
            expect(isInPhase(state, WorkflowPhase.CASE_INFO_CHECK)).toBe(false)
        })

        it('所有阶段检查应正确工作', () => {
            const phases = [
                WorkflowPhase.MATERIAL_PROCESS,
                WorkflowPhase.CASE_INFO_CHECK,
                WorkflowPhase.EXTRACT_INFO,
                WorkflowPhase.MODULE_SELECT,
                WorkflowPhase.ANALYSIS_TASK,
                WorkflowPhase.COMPLETE,
            ]

            for (const phase of phases) {
                const state = createFullState({ currentPhase: phase })
                expect(isInPhase(state, phase)).toBe(true)
                const otherPhases = phases.filter(p => p !== phase)
                for (const other of otherPhases) {
                    expect(isInPhase(state, other)).toBe(false)
                }
            }
        })
    })

    describe('isWorkflowComplete - 完成检查', () => {
        it('isComplete 为 true 时应返回 true', () => {
            const state = createFullState({ isComplete: true })
            expect(isWorkflowComplete(state)).toBe(true)
        })

        it('currentPhase 为 COMPLETE 时应返回 true', () => {
            const state = createFullState({ currentPhase: WorkflowPhase.COMPLETE })
            expect(isWorkflowComplete(state)).toBe(true)
        })

        it('两种条件都不满足时应返回 false', () => {
            const state = createFullState({
                isComplete: false,
                currentPhase: WorkflowPhase.MODULE_SELECT,
            })
            expect(isWorkflowComplete(state)).toBe(false)
        })
    })

    describe('hasWorkflowError - 错误检查', () => {
        it('error 不为 null 时应返回 true', () => {
            const state = createFullState({ error: 'Some error occurred' })
            expect(hasWorkflowError(state)).toBe(true)
        })

        it('error 为 null 时应返回 false', () => {
            const state = createFullState({ error: null })
            expect(hasWorkflowError(state)).toBe(false)
        })

        it('不同错误信息应都能检测到', () => {
            const errors = ['Error 1', '材料处理失败', '']
            for (const error of errors) {
                const state = createFullState({ error: error || null })
                expect(hasWorkflowError(state)).toBe(error !== null && error !== '')
            }
        })
    })

    describe('getNextModule - 获取下一个模块', () => {
        it('有下一个模块时应返回模块名', () => {
            const state = createFullState({
                selectedModules: ['summary', 'claim', 'analysis'],
                currentModuleIndex: 0,
            })
            expect(getNextModule(state)).toBe('summary')
        })

        it('索引在中间时应返回对应模块', () => {
            const state = createFullState({
                selectedModules: ['summary', 'claim', 'analysis'],
                currentModuleIndex: 1,
            })
            expect(getNextModule(state)).toBe('claim')
        })

        it('索引达到末尾时应返回 null', () => {
            const state = createFullState({
                selectedModules: ['summary', 'claim'],
                currentModuleIndex: 2,
            })
            expect(getNextModule(state)).toBeNull()
        })

        it('空模块列表时应返回 null', () => {
            const state = createFullState({
                selectedModules: [],
                currentModuleIndex: 0,
            })
            expect(getNextModule(state)).toBeNull()
        })

        it('属性测试：索引在有效范围内应返回正确模块', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
                    fc.integer({ min: 0, max: 10 }),
                    (modules, index) => {
                        const state = createFullState({
                            selectedModules: modules,
                            currentModuleIndex: index,
                        })

                        const result = getNextModule(state)
                        if (index < modules.length) {
                            expect(result).toBe(modules[index])
                        } else {
                            expect(result).toBeNull()
                        }
                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    describe('areAllModulesComplete - 模块完成检查', () => {
        it('索引达到模块数量时应返回 true', () => {
            const state = createFullState({
                selectedModules: ['summary', 'claim'],
                currentModuleIndex: 2,
            })
            expect(areAllModulesComplete(state)).toBe(true)
        })

        it('索引小于模块数量时应返回 false', () => {
            const state = createFullState({
                selectedModules: ['summary', 'claim', 'analysis'],
                currentModuleIndex: 1,
            })
            expect(areAllModulesComplete(state)).toBe(false)
        })

        it('空模块列表且索引为 0 时应返回 true', () => {
            const state = createFullState({
                selectedModules: [],
                currentModuleIndex: 0,
            })
            expect(areAllModulesComplete(state)).toBe(true)
        })

        it('属性测试：完成条件应一致', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
                    fc.integer({ min: 0, max: 10 }),
                    (modules, index) => {
                        const state = createFullState({
                            selectedModules: modules,
                            currentModuleIndex: index,
                        })

                        const allComplete = areAllModulesComplete(state)
                        const hasNext = getNextModule(state) !== null

                        // areAllModulesComplete === !hasNext
                        expect(allComplete).toBe(!hasNext)
                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    describe('Property: 状态函数往返一致性', () => {
        it('完成检查与下一模块应互斥', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
                    fc.integer({ min: 0, max: 10 }),
                    (modules, index) => {
                        const state = createFullState({
                            selectedModules: modules,
                            currentModuleIndex: index,
                        })

                        const isComplete = areAllModulesComplete(state)
                        const nextModule = getNextModule(state)

                        // 如果完成，不应有下一模块
                        // 如果未完成，应有下一模块（除非列表为空）
                        if (modules.length > 0) {
                            expect(isComplete || nextModule !== null).toBe(true)
                        }

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })

        it('工作流完成条件应可推导', () => {
            fc.assert(
                fc.property(
                    fc.boolean(),
                    fc.constantFrom(
                        WorkflowPhase.MATERIAL_PROCESS,
                        WorkflowPhase.CASE_INFO_CHECK,
                        WorkflowPhase.EXTRACT_INFO,
                        WorkflowPhase.MODULE_SELECT,
                        WorkflowPhase.ANALYSIS_TASK,
                        WorkflowPhase.COMPLETE,
                    ),
                    (isComplete, currentPhase) => {
                        const state = createFullState({ isComplete, currentPhase })

                        const workflowComplete = isWorkflowComplete(state)

                        // 两种情况都算完成
                        if (isComplete || currentPhase === WorkflowPhase.COMPLETE) {
                            expect(workflowComplete).toBe(true)
                        } else {
                            expect(workflowComplete).toBe(false)
                        }
                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })
})
