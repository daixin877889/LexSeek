/**
 * useTaskList 任务清单管理测试
 *
 * 测试任务列表的状态管理和工作流处理方法
 *
 * **Feature: task-list-composable**
 * **Validates: 任务状态管理和工作流功能**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

// 导入待测试的 composable
const { useTaskList } = await import('~/composables/useTaskList')
const { CHECKPOINT_TASKS } = await import('#shared/types/case')

describe('useTaskList 任务初始化测试', () => {
    it('initTasks 应初始化包含所有 CHECKPOINT_TASKS 的列表', () => {
        const { tasks, initTasks } = useTaskList()
        initTasks()

        expect(tasks.value).toHaveLength(CHECKPOINT_TASKS.length)
        CHECKPOINT_TASKS.forEach((checkpoint, index) => {
            expect(tasks.value[index].id).toBe(checkpoint.id)
            expect(tasks.value[index].name).toBe(checkpoint.name)
            expect(tasks.value[index].type).toBe(checkpoint.type)
            expect(tasks.value[index].order).toBe(checkpoint.order)
            expect(tasks.value[index].status).toBe('pending')
        })
    })

    it('initTasks 应将 activeTaskId 重置为 null', () => {
        const { activeTaskId, initTasks, setTaskStatus } = useTaskList()
        initTasks()
        setTaskStatus('case-info-check', 'active')
        expect(activeTaskId.value).toBe('case-info-check')

        initTasks()
        expect(activeTaskId.value).toBeNull()
    })

    it('initTasks 应将所有任务状态重置为 pending', () => {
        const { tasks, initTasks, setTaskStatus } = useTaskList()
        initTasks()
        setTaskStatus('case-info-check', 'completed')
        setTaskStatus('basic-info-confirm', 'active')

        initTasks()
        tasks.value.forEach(task => {
            expect(task.status).toBe('pending')
        })
    })
})

describe('useTaskList 任务状态管理测试', () => {
    let useTaskListInstance: ReturnType<typeof useTaskList>

    beforeEach(() => {
        useTaskListInstance = useTaskList()
        useTaskListInstance.initTasks()
    })

    describe('setTaskStatus - 设置任务状态', () => {
        it('应更新指定任务的状态', () => {
            const { tasks, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'completed')
            expect(tasks.value.find(t => t.id === 'case-info-check')?.status).toBe('completed')
        })

        it('应忽略不存在任务的状态更新', () => {
            const { tasks, setTaskStatus } = useTaskListInstance
            setTaskStatus('non-existent-task', 'active')
            // 任务列表不应变化
            expect(tasks.value.every(t => t.status === 'pending')).toBe(true)
        })

        it('状态设置为 active 时应更新 activeTaskId', () => {
            const { activeTaskId, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'active')
            expect(activeTaskId.value).toBe('case-info-check')
        })

        it('同一时间只能有一个 active 任务', () => {
            const { activeTaskId, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'active')
            expect(activeTaskId.value).toBe('case-info-check')

            setTaskStatus('basic-info-confirm', 'active')
            expect(activeTaskId.value).toBe('basic-info-confirm')
        })

        it('状态设置为 completed 时如果不是 active 任务不应清除 activeTaskId', () => {
            const { activeTaskId, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'active')
            setTaskStatus('basic-info-confirm', 'completed') // 不是 active 任务
            expect(activeTaskId.value).toBe('case-info-check')
        })

        it('completed 状态应清除对应的 activeTaskId', () => {
            const { activeTaskId, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'active')
            setTaskStatus('case-info-check', 'completed')
            expect(activeTaskId.value).toBeNull()
        })

        it('应支持 pending 状态', () => {
            const { tasks, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'active')
            setTaskStatus('case-info-check', 'pending')
            expect(tasks.value.find(t => t.id === 'case-info-check')?.status).toBe('pending')
            expect(tasks.value.find(t => t.id === 'case-info-check')?.status).not.toBe('active')
        })
    })

    describe('setTaskResultId - 设置任务结果ID', () => {
        it('应设置指定任务的 resultId', () => {
            const { tasks, setTaskResultId } = useTaskListInstance
            setTaskResultId('case-info-check', 123)
            expect(tasks.value.find(t => t.id === 'case-info-check')?.resultId).toBe(123)
        })

        it('应忽略不存在任务的 resultId 设置', () => {
            const { tasks, setTaskResultId } = useTaskListInstance
            setTaskResultId('non-existent', 456)
            expect(tasks.value.every(t => t.resultId === undefined)).toBe(true)
        })

        it('应允许覆盖已有的 resultId', () => {
            const { tasks, setTaskResultId } = useTaskListInstance
            setTaskResultId('case-info-check', 100)
            setTaskResultId('case-info-check', 200)
            expect(tasks.value.find(t => t.id === 'case-info-check')?.resultId).toBe(200)
        })
    })
})

describe('useTaskList 分析模块管理测试', () => {
    let useTaskListInstance: ReturnType<typeof useTaskList>

    beforeEach(() => {
        useTaskListInstance = useTaskList()
        useTaskListInstance.initTasks()
    })

    describe('addAnalysisModules - 添加分析模块', () => {
        it('应添加分析模块到任务列表', () => {
            const { tasks, addAnalysisModules } = useTaskListInstance
            const modules = [
                { id: 1, name: '合同审查', description: '审查合同条款' },
                { id: 2, name: '风险评估', description: '评估法律风险' },
            ]

            addAnalysisModules(modules)

            expect(tasks.value).toHaveLength(CHECKPOINT_TASKS.length + 2)
            expect(tasks.value.find(t => t.id === 'analysis-1')).toBeDefined()
            expect(tasks.value.find(t => t.id === 'analysis-2')).toBeDefined()
        })

        it('分析模块任务应有正确的属性', () => {
            const { tasks, addAnalysisModules } = useTaskListInstance
            const modules = [
                { id: 1, name: '合同审查', description: '审查合同条款' },
            ]

            addAnalysisModules(modules)
            const analysisTask = tasks.value.find(t => t.id === 'analysis-1')!

            expect(analysisTask.name).toBe('合同审查')
            expect(analysisTask.description).toBe('审查合同条款')
            expect(analysisTask.type).toBe('analysis')
            expect(analysisTask.status).toBe('pending')
            expect(analysisTask.nodeId).toBe(1)
            expect(analysisTask.order).toBeGreaterThan(CHECKPOINT_TASKS.length)
        })

        it('不应重复添加已存在的分析模块', () => {
            const { tasks, addAnalysisModules } = useTaskListInstance
            const modules = [{ id: 1, name: '合同审查', description: '' }]

            addAnalysisModules(modules)
            addAnalysisModules(modules)

            expect(tasks.value.filter(t => t.id === 'analysis-1')).toHaveLength(1)
        })

        it('多个模块应按顺序添加', () => {
            const { tasks, addAnalysisModules } = useTaskListInstance
            const modules = [
                { id: 1, name: '模块1', description: '' },
                { id: 2, name: '模块2', description: '' },
                { id: 3, name: '模块3', description: '' },
            ]

            addAnalysisModules(modules)

            const analysisTasks = tasks.value.filter(t => t.type === 'analysis')
            expect(analysisTasks[0].order).toBeLessThan(analysisTasks[1].order)
            expect(analysisTasks[1].order).toBeLessThan(analysisTasks[2].order)
        })

        it('空模块列表不应改变任务列表', () => {
            const { tasks, addAnalysisModules } = useTaskListInstance
            addAnalysisModules([])
            expect(tasks.value).toHaveLength(CHECKPOINT_TASKS.length)
        })
    })

    describe('removeAnalysisModules - 移除分析模块', () => {
        it('应移除所有分析模块任务', () => {
            const { tasks, addAnalysisModules, removeAnalysisModules } = useTaskListInstance
            addAnalysisModules([
                { id: 1, name: '模块1', description: '' },
                { id: 2, name: '模块2', description: '' },
            ])
            expect(tasks.value.some(t => t.type === 'analysis')).toBe(true)

            removeAnalysisModules()
            expect(tasks.value.every(t => t.type === 'checkpoint')).toBe(true)
        })

        it('不应影响中断点任务', () => {
            const { tasks, addAnalysisModules, removeAnalysisModules } = useTaskListInstance
            const initialCheckpointCount = tasks.value.filter(t => t.type === 'checkpoint').length

            addAnalysisModules([{ id: 1, name: '模块1', description: '' }])
            removeAnalysisModules()

            expect(tasks.value.filter(t => t.type === 'checkpoint')).toHaveLength(initialCheckpointCount)
        })
    })
})

describe('useTaskList 任务查询测试', () => {
    let useTaskListInstance: ReturnType<typeof useTaskList>

    beforeEach(() => {
        useTaskListInstance = useTaskList()
        useTaskListInstance.initTasks()
        useTaskListInstance.addAnalysisModules([
            { id: 1, name: '合同审查', description: '' },
            { id: 2, name: '风险评估', description: '' },
        ])
    })

    describe('getTaskByNodeId - 按节点ID获取任务', () => {
        it('应返回匹配节点ID的任务', () => {
            const { getTaskByNodeId } = useTaskListInstance
            const task = getTaskByNodeId(1)
            expect(task?.id).toBe('analysis-1')
            expect(task?.name).toBe('合同审查')
        })

        it('不存在节点ID应返回 undefined', () => {
            const { getTaskByNodeId } = useTaskListInstance
            expect(getTaskByNodeId(999)).toBeUndefined()
        })
    })

    describe('getTaskById - 按任务ID获取任务', () => {
        it('应返回匹配任务ID的任务', () => {
            const { getTaskById } = useTaskListInstance
            const task = getTaskById('case-info-check')
            expect(task?.name).toBe('案情信息检查')
        })

        it('不存在任务ID应返回 undefined', () => {
            const { getTaskById } = useTaskListInstance
            expect(getTaskById('non-existent')).toBeUndefined()
        })
    })

    describe('getNextPendingTask - 获取下一个待处理任务', () => {
        it('初始状态应返回第一个待处理任务', () => {
            const { getNextPendingTask } = useTaskListInstance
            const nextTask = getNextPendingTask()
            expect(nextTask?.id).toBe('case-info-check')
        })

        it('应按 order 排序返回', () => {
            const { getNextPendingTask } = useTaskListInstance
            const nextTask = getNextPendingTask()
            expect(nextTask?.order).toBe(1)
        })

        it('当所有任务完成时应返回 undefined', () => {
            const { setTaskStatus, getNextPendingTask } = useTaskListInstance
            setTaskStatus('case-info-check', 'completed')
            setTaskStatus('basic-info-confirm', 'completed')
            setTaskStatus('module-select', 'completed')
            // 所有 checkpoint 完成后，analysis 模块也是 pending

            const nextTask = getNextPendingTask()
            expect(nextTask?.id).toBe('analysis-1')
        })
    })

    describe('getActiveTask - 获取当前活动任务', () => {
        it('无活动任务时应返回 undefined', () => {
            const { getActiveTask } = useTaskListInstance
            expect(getActiveTask()).toBeUndefined()
        })

        it('应返回当前活动任务', () => {
            const { setTaskStatus, getActiveTask } = useTaskListInstance
            setTaskStatus('basic-info-confirm', 'active')
            const activeTask = getActiveTask()
            expect(activeTask?.id).toBe('basic-info-confirm')
            expect(activeTask?.status).toBe('active')
        })
    })
})

describe('useTaskList 计算属性测试', () => {
    let useTaskListInstance: ReturnType<typeof useTaskList>

    beforeEach(() => {
        useTaskListInstance = useTaskList()
        useTaskListInstance.initTasks()
        useTaskListInstance.addAnalysisModules([
            { id: 1, name: '合同审查', description: '' },
        ])
    })

    describe('isAllCompleted - 是否全部完成', () => {
        it('空任务列表应返回 false', () => {
            const { initTasks, isAllCompleted } = useTaskList()
            initTasks()
            // 初始任务列表不为空
            expect(isAllCompleted.value).toBe(false)
        })

        it('所有任务完成时应返回 true', () => {
            const { isAllCompleted, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'completed')
            setTaskStatus('basic-info-confirm', 'completed')
            setTaskStatus('module-select', 'completed')
            setTaskStatus('analysis-1', 'completed')

            expect(isAllCompleted.value).toBe(true)
        })

        it('有任务未完成时应返回 false', () => {
            const { isAllCompleted, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'completed')
            // 其他任务仍是 pending
            expect(isAllCompleted.value).toBe(false)
        })
    })

    describe('completedCount - 已完成数量', () => {
        it('初始状态应为 0', () => {
            const { completedCount } = useTaskListInstance
            expect(completedCount.value).toBe(0)
        })

        it('应正确计算已完成任务数量', () => {
            const { completedCount, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'completed')
            setTaskStatus('basic-info-confirm', 'completed')
            expect(completedCount.value).toBe(2)
        })
    })

    describe('progressPercent - 进度百分比', () => {
        it('初始状态应为 0', () => {
            const { progressPercent } = useTaskListInstance
            expect(progressPercent.value).toBe(0)
        })

        it('应正确计算进度', () => {
            const { progressPercent, setTaskStatus } = useTaskListInstance
            // 4 个任务中完成 1 个 = 25%
            setTaskStatus('case-info-check', 'completed')
            expect(progressPercent.value).toBe(25)
        })

        it('全部完成应为 100', () => {
            const { progressPercent, setTaskStatus } = useTaskListInstance
            setTaskStatus('case-info-check', 'completed')
            setTaskStatus('basic-info-confirm', 'completed')
            setTaskStatus('module-select', 'completed')
            setTaskStatus('analysis-1', 'completed')
            expect(progressPercent.value).toBe(100)
        })
    })
})

describe('useTaskList 工作流事件处理测试', () => {
    let useTaskListInstance: ReturnType<typeof useTaskList>

    beforeEach(() => {
        useTaskListInstance = useTaskList()
        useTaskListInstance.initTasks()
    })

    describe('handleInterrupt - 中断处理', () => {
        it('case_info_check 应激活 case-info-check 任务', () => {
            const { handleInterrupt, tasks } = useTaskListInstance
            handleInterrupt('case_info_check')
            expect(tasks.value.find(t => t.id === 'case-info-check')?.status).toBe('active')
        })

        it('basic_info_confirm 应完成 case-info-check 并激活 basic-info-confirm', () => {
            const { handleInterrupt, tasks } = useTaskListInstance
            handleInterrupt('basic_info_confirm')

            expect(tasks.value.find(t => t.id === 'case-info-check')?.status).toBe('completed')
            expect(tasks.value.find(t => t.id === 'basic-info-confirm')?.status).toBe('active')
        })

        it('module_select 应完成 basic-info-confirm 并激活 module-select', () => {
            const { handleInterrupt, tasks } = useTaskListInstance
            handleInterrupt('module_select')

            expect(tasks.value.find(t => t.id === 'basic-info-confirm')?.status).toBe('completed')
            expect(tasks.value.find(t => t.id === 'module-select')?.status).toBe('active')
        })

        it('analysis_XXX 应激活对应的分析模块任务', () => {
            const { handleInterrupt, addAnalysisModules, tasks } = useTaskListInstance
            addAnalysisModules([{ id: 10, name: '测试模块', description: '' }])

            handleInterrupt('analysis_10')
            expect(tasks.value.find(t => t.id === 'analysis-10')?.status).toBe('active')
        })

        it('未知中断类型不应改变任何任务状态', () => {
            const { handleInterrupt, tasks } = useTaskListInstance
            const initialStatuses = tasks.value.map(t => t.status)

            handleInterrupt('unknown_interrupt')
            tasks.value.forEach((task, i) => {
                expect(task.status).toBe(initialStatuses[i])
            })
        })
    })

    describe('handleResume - 恢复处理', () => {
        it('basic_info_confirm 应完成 basic-info-confirm', () => {
            const { handleResume, tasks } = useTaskListInstance
            handleResume('basic_info_confirm')
            expect(tasks.value.find(t => t.id === 'basic-info-confirm')?.status).toBe('completed')
        })

        it('module_select 应完成 module-select', () => {
            const { handleResume, tasks } = useTaskListInstance
            handleResume('module_select')
            expect(tasks.value.find(t => t.id === 'module-select')?.status).toBe('completed')
        })

        it('analysis_XXX 应完成对应任务并设置 resultId', () => {
            const { handleResume, addAnalysisModules, tasks } = useTaskListInstance
            addAnalysisModules([{ id: 10, name: '测试模块', description: '' }])

            handleResume('analysis_10', 123)
            const analysisTask = tasks.value.find(t => t.id === 'analysis-10')!
            expect(analysisTask.status).toBe('completed')
            expect(analysisTask.resultId).toBe(123)
        })

        it('未知恢复类型不应改变任何任务状态', () => {
            const { handleResume, tasks } = useTaskListInstance
            const initialStatuses = tasks.value.map(t => t.status)

            handleResume('unknown_resume')
            tasks.value.forEach((task, i) => {
                expect(task.status).toBe(initialStatuses[i])
            })
        })
    })

    describe('handleModuleStart - 模块开始执行', () => {
        it('应将对应任务设为 active', () => {
            const { handleModuleStart, addAnalysisModules, tasks } = useTaskListInstance
            addAnalysisModules([{ id: 5, name: '测试', description: '' }])

            handleModuleStart(5)
            expect(tasks.value.find(t => t.id === 'analysis-5')?.status).toBe('active')
        })

        it('不存在模块不应报错', () => {
            const { handleModuleStart } = useTaskListInstance
            expect(() => handleModuleStart(999)).not.toThrow()
        })
    })

    describe('handleModuleComplete - 模块执行完成', () => {
        it('应将对应任务设为 completed', () => {
            const { handleModuleComplete, addAnalysisModules, tasks } = useTaskListInstance
            addAnalysisModules([{ id: 5, name: '测试', description: '' }])

            handleModuleComplete(5, 999)
            const task = tasks.value.find(t => t.id === 'analysis-5')!
            expect(task.status).toBe('completed')
            expect(task.resultId).toBe(999)
        })

        it('应设置 resultId', () => {
            const { handleModuleComplete, addAnalysisModules, tasks } = useTaskListInstance
            addAnalysisModules([{ id: 5, name: '测试', description: '' }])

            handleModuleComplete(5, 456)
            expect(tasks.value.find(t => t.id === 'analysis-5')?.resultId).toBe(456)
        })

        it('不传 resultId 时应保持 undefined', () => {
            const { handleModuleComplete, addAnalysisModules, tasks } = useTaskListInstance
            addAnalysisModules([{ id: 5, name: '测试', description: '' }])

            handleModuleComplete(5)
            expect(tasks.value.find(t => t.id === 'analysis-5')?.resultId).toBeUndefined()
        })
    })
})

describe('useTaskList 重置测试', () => {
    it('reset 应重新初始化任务列表', () => {
        const { tasks, reset, setTaskStatus, addAnalysisModules } = useTaskList()
        reset()
        setTaskStatus('case-info-check', 'completed')
        addAnalysisModules([{ id: 1, name: '测试', description: '' }])
        expect(tasks.value.some(t => t.status === 'completed')).toBe(true)
        expect(tasks.value.some(t => t.type === 'analysis')).toBe(true)

        reset()
        expect(tasks.value.every(t => t.status === 'pending')).toBe(true)
        expect(tasks.value.filter(t => t.type === 'analysis')).toHaveLength(0)
    })
})
