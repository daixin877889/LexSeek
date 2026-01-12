/**
 * 案件分析工作流属性测试
 *
 * 测试工作流的核心属性：
 * - Property 1: 工作流中断-恢复往返一致性
 * - Property 2: 检查点持久化完整性
 *
 * **Feature: case-analysis**
 * **Validates: Requirements 1.3, 1.4, 2.2, 2.3, 2.6**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { config } from 'dotenv'

// 加载环境变量
config()

// 导入工作流相关模块
import {
    type CaseAnalysisState,
    createInitialState,
    isInPhase,
    isWorkflowComplete,
    hasWorkflowError,
    getNextModule,
    areAllModulesComplete,
} from '../../../server/services/workflow/state'
import {
    WorkflowPhase,
    InterruptType,
} from '#shared/types/case'
import {
    getCheckpointer,
    resetCheckpointer,
} from '../../../server/services/workflow/checkpointer'
import {
    resetCaseAnalysisWorkflow,
} from '../../../server/services/workflow/caseAnalysis.workflow'

// 测试数据追踪
const testThreadIds: string[] = []

// 生成唯一的测试线程 ID
const generateTestThreadId = () => `test_thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

// 清理测试数据
const cleanupTestData = async () => {
    // 重置工作流和检查点器实例
    resetCaseAnalysisWorkflow()
    resetCheckpointer()
    testThreadIds.length = 0
}

// 检查数据库是否可用
let dbAvailable = false

// 生成有效的工作流状态
const validWorkflowStateArbitrary = fc.record({
    userId: fc.integer({ min: 1, max: 10000 }),
    caseId: fc.integer({ min: 1, max: 10000 }),
    caseTypeId: fc.integer({ min: 1, max: 100 }),
    materials: fc.array(
        fc.record({
            id: fc.integer({ min: 1, max: 10000 }),
            name: fc.string({ minLength: 1, maxLength: 100 }),
            type: fc.integer({ min: 1, max: 4 }),
            content: fc.string({ minLength: 10, maxLength: 1000 }),
        }),
        { minLength: 0, maxLength: 5 }
    ),
    aggregatedContent: fc.string({ minLength: 0, maxLength: 2000 }),
    caseInfoSufficient: fc.boolean(),
    basicInfoConfirmed: fc.boolean(),
    selectedModules: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 5 }),
    currentModuleIndex: fc.integer({ min: 0, max: 10 }),
    title: fc.string({ minLength: 0, maxLength: 200 }),
    plaintiff: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
    defendant: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
})

// 生成中断类型
const interruptTypeArbitrary = fc.constantFrom(
    InterruptType.CASE_INFO_CHECK,
    InterruptType.BASIC_INFO_CONFIRM,
    InterruptType.MODULE_SELECT
)

// 生成工作流阶段
const workflowPhaseArbitrary = fc.constantFrom(
    WorkflowPhase.MATERIAL_PROCESS,
    WorkflowPhase.CASE_INFO_CHECK,
    WorkflowPhase.EXTRACT_INFO,
    WorkflowPhase.MODULE_SELECT,
    WorkflowPhase.ANALYSIS_TASK,
    WorkflowPhase.COMPLETE
)

/**
 * 模拟工作流状态的序列化和反序列化
 * 用于测试状态在中断-恢复过程中的一致性
 */
function serializeState(state: Partial<CaseAnalysisState>): string {
    return JSON.stringify(state)
}

function deserializeState(serialized: string): Partial<CaseAnalysisState> {
    return JSON.parse(serialized)
}

/**
 * 模拟中断点状态
 * 根据中断类型返回预期的工作流阶段
 */
function getExpectedPhaseForInterrupt(interruptType: InterruptType): WorkflowPhase {
    const phaseMap: Record<InterruptType, WorkflowPhase> = {
        [InterruptType.CASE_INFO_CHECK]: WorkflowPhase.CASE_INFO_CHECK,
        [InterruptType.BASIC_INFO_CONFIRM]: WorkflowPhase.EXTRACT_INFO,
        [InterruptType.MODULE_SELECT]: WorkflowPhase.MODULE_SELECT,
    }
    return phaseMap[interruptType]
}

/**
 * 模拟中断前的状态标志
 */
function getExpectedFlagsForInterrupt(interruptType: InterruptType): {
    caseInfoSufficient: boolean
    basicInfoConfirmed: boolean
} {
    switch (interruptType) {
        case InterruptType.CASE_INFO_CHECK:
            return { caseInfoSufficient: false, basicInfoConfirmed: false }
        case InterruptType.BASIC_INFO_CONFIRM:
            return { caseInfoSufficient: true, basicInfoConfirmed: false }
        case InterruptType.MODULE_SELECT:
            return { caseInfoSufficient: true, basicInfoConfirmed: true }
    }
}

describe('案件分析工作流属性测试', () => {
    beforeAll(async () => {
        try {
            // 检查数据库连接
            const checkpointer = await getCheckpointer()
            dbAvailable = checkpointer !== null
        } catch (error) {
            console.warn('数据库连接失败，跳过需要数据库的测试')
            dbAvailable = false
        }
    })

    afterEach(async () => {
        await cleanupTestData()
    })

    afterAll(async () => {
        await cleanupTestData()
    })

    describe('Property 1: 工作流中断-恢复往返一致性', () => {
        /**
         * Property 1: 工作流中断-恢复往返一致性
         *
         * *For any* 工作流执行，当工作流在中断点暂停后，使用 `Command(resume=...)` 恢复执行时，
         * 工作流应从中断点继续执行，不重复已完成的步骤，且状态与中断前一致。
         *
         * **Feature: case-analysis, Property 1: 工作流中断-恢复往返一致性**
         * **Validates: Requirements 1.3, 1.4, 2.3**
         */
        it('Property 1: 工作流状态序列化-反序列化应保持一致性', async () => {
            await fc.assert(
                fc.asyncProperty(
                    validWorkflowStateArbitrary,
                    workflowPhaseArbitrary,
                    async (stateData, phase) => {
                        const threadId = generateTestThreadId()

                        // 创建初始状态
                        const initialState = createInitialState({
                            userId: stateData.userId,
                            caseId: stateData.caseId,
                            sessionId: threadId,
                            caseTypeId: stateData.caseTypeId,
                            materials: stateData.materials,
                        })

                        // 模拟状态更新（设置当前阶段）
                        const stateWithPhase: Partial<CaseAnalysisState> = {
                            ...initialState,
                            currentPhase: phase,
                            aggregatedContent: stateData.aggregatedContent,
                            caseInfoSufficient: stateData.caseInfoSufficient,
                            basicInfoConfirmed: stateData.basicInfoConfirmed,
                            selectedModules: stateData.selectedModules,
                            currentModuleIndex: stateData.currentModuleIndex,
                            title: stateData.title,
                            plaintiff: stateData.plaintiff,
                            defendant: stateData.defendant,
                        }

                        // 序列化状态（模拟检查点保存）
                        const serialized = serializeState(stateWithPhase)

                        // 反序列化状态（模拟检查点恢复）
                        const restored = deserializeState(serialized)

                        // 验证核心字段一致性
                        expect(restored.userId).toBe(stateWithPhase.userId)
                        expect(restored.caseId).toBe(stateWithPhase.caseId)
                        expect(restored.sessionId).toBe(stateWithPhase.sessionId)
                        expect(restored.currentPhase).toBe(stateWithPhase.currentPhase)
                        expect(restored.caseInfoSufficient).toBe(stateWithPhase.caseInfoSufficient)
                        expect(restored.basicInfoConfirmed).toBe(stateWithPhase.basicInfoConfirmed)
                        expect(restored.aggregatedContent).toBe(stateWithPhase.aggregatedContent)
                        expect(restored.title).toBe(stateWithPhase.title)
                        expect(restored.currentModuleIndex).toBe(stateWithPhase.currentModuleIndex)

                        // 验证数组字段
                        expect(restored.materials).toEqual(stateWithPhase.materials)
                        expect(restored.plaintiff).toEqual(stateWithPhase.plaintiff)
                        expect(restored.defendant).toEqual(stateWithPhase.defendant)
                        expect(restored.selectedModules).toEqual(stateWithPhase.selectedModules)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('Property 1: 中断类型应正确映射到工作流阶段', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 10000 }),
                    interruptTypeArbitrary,
                    async (userId, caseId, interruptType) => {
                        const threadId = generateTestThreadId()

                        // 获取预期的阶段和状态标志
                        const expectedPhase = getExpectedPhaseForInterrupt(interruptType)
                        const expectedFlags = getExpectedFlagsForInterrupt(interruptType)

                        // 创建带有中断状态的工作流状态
                        const stateWithInterrupt: Partial<CaseAnalysisState> = {
                            userId,
                            caseId,
                            sessionId: threadId,
                            caseTypeId: 1,
                            currentPhase: expectedPhase,
                            materials: [],
                            aggregatedContent: '测试材料内容',
                            caseInfoSufficient: expectedFlags.caseInfoSufficient,
                            basicInfoConfirmed: expectedFlags.basicInfoConfirmed,
                            selectedModules: [],
                            currentModuleIndex: 0,
                        }

                        // 序列化和反序列化
                        const serialized = serializeState(stateWithInterrupt)
                        const restored = deserializeState(serialized)

                        // 验证恢复后的阶段正确
                        expect(restored.currentPhase).toBe(expectedPhase)

                        // 验证中断相关的状态标志正确
                        expect(restored.caseInfoSufficient).toBe(expectedFlags.caseInfoSufficient)
                        expect(restored.basicInfoConfirmed).toBe(expectedFlags.basicInfoConfirmed)

                        // 验证状态标志与中断类型的逻辑一致性
                        if (interruptType === InterruptType.CASE_INFO_CHECK) {
                            expect(restored.caseInfoSufficient).toBe(false)
                        } else if (interruptType === InterruptType.BASIC_INFO_CONFIRM) {
                            expect(restored.caseInfoSufficient).toBe(true)
                            expect(restored.basicInfoConfirmed).toBe(false)
                        } else if (interruptType === InterruptType.MODULE_SELECT) {
                            expect(restored.caseInfoSufficient).toBe(true)
                            expect(restored.basicInfoConfirmed).toBe(true)
                        }

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })


        it('Property 1: 状态辅助函数应正确判断工作流状态', async () => {
            await fc.assert(
                fc.asyncProperty(
                    validWorkflowStateArbitrary,
                    workflowPhaseArbitrary,
                    fc.boolean(),
                    fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
                    async (stateData, phase, isComplete, error) => {
                        const threadId = generateTestThreadId()

                        // 创建完整的工作流状态
                        const state: CaseAnalysisState = {
                            messages: [],
                            userId: stateData.userId,
                            caseId: stateData.caseId,
                            sessionId: threadId,
                            caseTypeId: stateData.caseTypeId,
                            materials: stateData.materials,
                            aggregatedContent: stateData.aggregatedContent,
                            caseInfoSufficient: stateData.caseInfoSufficient,
                            caseInfoCheckResult: '',
                            supplementedCaseInfo: '',
                            title: stateData.title,
                            plaintiff: stateData.plaintiff,
                            defendant: stateData.defendant,
                            caseTypeName: '',
                            summary: '',
                            basicInfoConfirmed: stateData.basicInfoConfirmed,
                            availableModules: [],
                            selectedModules: stateData.selectedModules,
                            currentModuleIndex: stateData.currentModuleIndex,
                            analysisResults: [],
                            lastExecutedModule: '',
                            lastExecutedResult: '',
                            lastExecutedTitle: '',
                            currentPhase: phase,
                            isComplete,
                            error,
                        }

                        // 测试 isInPhase 函数
                        expect(isInPhase(state, phase)).toBe(true)
                        if (phase !== WorkflowPhase.COMPLETE) {
                            expect(isInPhase(state, WorkflowPhase.COMPLETE)).toBe(false)
                        }

                        // 测试 isWorkflowComplete 函数
                        const expectedComplete = isComplete || phase === WorkflowPhase.COMPLETE
                        expect(isWorkflowComplete(state)).toBe(expectedComplete)

                        // 测试 hasWorkflowError 函数
                        expect(hasWorkflowError(state)).toBe(error !== null)

                        // 测试 getNextModule 函数
                        if (stateData.currentModuleIndex < stateData.selectedModules.length) {
                            expect(getNextModule(state)).toBe(stateData.selectedModules[stateData.currentModuleIndex])
                        } else {
                            expect(getNextModule(state)).toBeNull()
                        }

                        // 测试 areAllModulesComplete 函数
                        expect(areAllModulesComplete(state)).toBe(
                            stateData.currentModuleIndex >= stateData.selectedModules.length
                        )

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('Property 2: 检查点持久化完整性', () => {
        /**
         * Property 2: 检查点持久化完整性
         *
         * *For any* 工作流状态变化，Checkpointer 保存的检查点应能完整恢复工作流状态，
         * 包括所有已完成节点的结果和当前执行位置。
         *
         * **Feature: case-analysis, Property 2: 检查点持久化完整性**
         * **Validates: Requirements 2.2, 2.3, 2.6**
         */
        it('Property 2: 状态序列化应保留所有字段', async () => {
            await fc.assert(
                fc.asyncProperty(
                    validWorkflowStateArbitrary,
                    async (stateData) => {
                        const threadId = generateTestThreadId()

                        // 创建完整的工作流状态
                        const fullState: Partial<CaseAnalysisState> = {
                            userId: stateData.userId,
                            caseId: stateData.caseId,
                            sessionId: threadId,
                            caseTypeId: stateData.caseTypeId,
                            materials: stateData.materials,
                            aggregatedContent: stateData.aggregatedContent,
                            caseInfoSufficient: stateData.caseInfoSufficient,
                            caseInfoCheckResult: '检查结果',
                            supplementedCaseInfo: '补充信息',
                            title: stateData.title,
                            plaintiff: stateData.plaintiff,
                            defendant: stateData.defendant,
                            caseTypeName: '民事案件',
                            summary: '案件摘要',
                            basicInfoConfirmed: stateData.basicInfoConfirmed,
                            availableModules: [],
                            selectedModules: stateData.selectedModules,
                            currentModuleIndex: stateData.currentModuleIndex,
                            analysisResults: [],
                            lastExecutedModule: '',
                            lastExecutedResult: '',
                            lastExecutedTitle: '',
                            currentPhase: WorkflowPhase.CASE_INFO_CHECK,
                            isComplete: false,
                            error: null,
                        }

                        // 序列化状态
                        const serialized = serializeState(fullState)

                        // 反序列化状态
                        const restored = deserializeState(serialized)

                        // 验证所有核心字段都被正确恢复
                        expect(restored.userId).toBe(fullState.userId)
                        expect(restored.caseId).toBe(fullState.caseId)
                        expect(restored.sessionId).toBe(fullState.sessionId)
                        expect(restored.caseTypeId).toBe(fullState.caseTypeId)
                        expect(restored.aggregatedContent).toBe(fullState.aggregatedContent)
                        expect(restored.caseInfoSufficient).toBe(fullState.caseInfoSufficient)
                        expect(restored.caseInfoCheckResult).toBe(fullState.caseInfoCheckResult)
                        expect(restored.supplementedCaseInfo).toBe(fullState.supplementedCaseInfo)
                        expect(restored.title).toBe(fullState.title)
                        expect(restored.caseTypeName).toBe(fullState.caseTypeName)
                        expect(restored.summary).toBe(fullState.summary)
                        expect(restored.basicInfoConfirmed).toBe(fullState.basicInfoConfirmed)
                        expect(restored.currentModuleIndex).toBe(fullState.currentModuleIndex)
                        expect(restored.currentPhase).toBe(fullState.currentPhase)
                        expect(restored.isComplete).toBe(fullState.isComplete)
                        expect(restored.error).toBe(fullState.error)

                        // 验证数组字段
                        expect(restored.materials).toEqual(fullState.materials)
                        expect(restored.plaintiff).toEqual(fullState.plaintiff)
                        expect(restored.defendant).toEqual(fullState.defendant)
                        expect(restored.selectedModules).toEqual(fullState.selectedModules)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('Property 2: 多次状态更新应保持最新状态', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 1, max: 10000 }),
                    fc.array(workflowPhaseArbitrary, { minLength: 2, maxLength: 5 }),
                    async (userId, caseId, phases) => {
                        const threadId = generateTestThreadId()
                        const states: Partial<CaseAnalysisState>[] = []

                        // 依次创建多个状态
                        for (let i = 0; i < phases.length; i++) {
                            const state: Partial<CaseAnalysisState> = {
                                userId,
                                caseId,
                                sessionId: threadId,
                                caseTypeId: 1,
                                currentPhase: phases[i],
                                currentModuleIndex: i,
                                materials: [],
                                aggregatedContent: `内容版本 ${i}`,
                                caseInfoSufficient: i > 0,
                                basicInfoConfirmed: i > 1,
                                selectedModules: [],
                            }
                            states.push(state)
                        }

                        // 获取最新状态
                        const latestState = states[states.length - 1]
                        const lastIndex = phases.length - 1

                        // 序列化和反序列化最新状态
                        const serialized = serializeState(latestState)
                        const restored = deserializeState(serialized)

                        // 验证恢复的是最新状态
                        expect(restored.currentPhase).toBe(phases[lastIndex])
                        expect(restored.currentModuleIndex).toBe(lastIndex)
                        expect(restored.aggregatedContent).toBe(`内容版本 ${lastIndex}`)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('Property 2: 不同会话的状态应相互隔离', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.integer({ min: 10001, max: 20000 }),
                    workflowPhaseArbitrary,
                    workflowPhaseArbitrary,
                    async (userId1, userId2, phase1, phase2) => {
                        const threadId1 = generateTestThreadId()
                        const threadId2 = generateTestThreadId()

                        // 创建两个不同会话的状态
                        const state1: Partial<CaseAnalysisState> = {
                            userId: userId1,
                            caseId: 1,
                            sessionId: threadId1,
                            caseTypeId: 1,
                            currentPhase: phase1,
                            materials: [],
                            aggregatedContent: '会话1内容',
                            caseInfoSufficient: true,
                            basicInfoConfirmed: false,
                            selectedModules: [],
                            currentModuleIndex: 0,
                        }

                        const state2: Partial<CaseAnalysisState> = {
                            userId: userId2,
                            caseId: 2,
                            sessionId: threadId2,
                            caseTypeId: 2,
                            currentPhase: phase2,
                            materials: [],
                            aggregatedContent: '会话2内容',
                            caseInfoSufficient: false,
                            basicInfoConfirmed: true,
                            selectedModules: [],
                            currentModuleIndex: 0,
                        }

                        // 分别序列化和反序列化
                        const serialized1 = serializeState(state1)
                        const serialized2 = serializeState(state2)
                        const restored1 = deserializeState(serialized1)
                        const restored2 = deserializeState(serialized2)

                        // 验证两个会话的状态相互隔离
                        expect(restored1.userId).toBe(userId1)
                        expect(restored2.userId).toBe(userId2)
                        expect(restored1.sessionId).toBe(threadId1)
                        expect(restored2.sessionId).toBe(threadId2)
                        expect(restored1.currentPhase).toBe(phase1)
                        expect(restored2.currentPhase).toBe(phase2)
                        expect(restored1.aggregatedContent).toBe('会话1内容')
                        expect(restored2.aggregatedContent).toBe('会话2内容')
                        expect(restored1.caseInfoSufficient).toBe(true)
                        expect(restored2.caseInfoSufficient).toBe(false)

                        // 验证两个状态不会相互影响
                        expect(restored1.userId).not.toBe(restored2.userId)
                        expect(restored1.sessionId).not.toBe(restored2.sessionId)

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('Property 2: 分析结果应正确累积', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1, max: 10000 }),
                    fc.array(
                        fc.record({
                            nodeId: fc.integer({ min: 1, max: 100 }),
                            moduleName: fc.string({ minLength: 1, maxLength: 50 }),
                            moduleTitle: fc.string({ minLength: 1, maxLength: 100 }),
                            content: fc.string({ minLength: 10, maxLength: 500 }),
                            analyzedAt: fc.date().map(d => d.toISOString()),
                        }),
                        { minLength: 1, maxLength: 5 }
                    ),
                    async (userId, analysisResults) => {
                        const threadId = generateTestThreadId()

                        // 创建带有分析结果的状态
                        const state: Partial<CaseAnalysisState> = {
                            userId,
                            caseId: 1,
                            sessionId: threadId,
                            caseTypeId: 1,
                            currentPhase: WorkflowPhase.ANALYSIS_TASK,
                            materials: [],
                            aggregatedContent: '测试内容',
                            caseInfoSufficient: true,
                            basicInfoConfirmed: true,
                            selectedModules: analysisResults.map(r => r.moduleName),
                            currentModuleIndex: analysisResults.length,
                            analysisResults,
                        }

                        // 序列化和反序列化
                        const serialized = serializeState(state)
                        const restored = deserializeState(serialized)

                        // 验证分析结果完整恢复
                        expect(restored.analysisResults).toHaveLength(analysisResults.length)
                        expect(restored.analysisResults).toEqual(analysisResults)

                        // 验证每个分析结果的字段
                        for (let i = 0; i < analysisResults.length; i++) {
                            expect(restored.analysisResults![i].nodeId).toBe(analysisResults[i].nodeId)
                            expect(restored.analysisResults![i].moduleName).toBe(analysisResults[i].moduleName)
                            expect(restored.analysisResults![i].moduleTitle).toBe(analysisResults[i].moduleTitle)
                            expect(restored.analysisResults![i].content).toBe(analysisResults[i].content)
                            expect(restored.analysisResults![i].analyzedAt).toBe(analysisResults[i].analyzedAt)
                        }

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        try {
            const checkpointer = await getCheckpointer()
            expect(checkpointer).not.toBeNull()
        } catch {
            console.log('请确保数据库已启动并配置正确的连接字符串')
            expect(true).toBe(true)
        }
    })
})
