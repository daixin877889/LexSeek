import type { TaskItem, TaskStatus, TaskType, AnalysisModule } from '#shared/types/case'
import { CHECKPOINT_TASKS } from '#shared/types/case'

// 注意：AnalysisModule 类型已在 shared/types/case.ts 中定义
// 如需使用请直接从 '#shared/types/case' 导入

/**
 * 任务清单管理 composable
 * 用于管理案件分析流程中的任务状态
 */
export function useTaskList() {
    // 任务列表
    const tasks = ref<TaskItem[]>([])

    // 当前活动任务ID
    const activeTaskId = ref<string | null>(null)

    /**
     * 初始化任务列表（仅包含中断点任务）
     */
    const initTasks = () => {
        tasks.value = CHECKPOINT_TASKS.map(task => ({
            ...task,
            status: 'pending' as TaskStatus,
        }))
        activeTaskId.value = null
    }

    /**
     * 设置任务状态
     * @param taskId 任务ID
     * @param status 新状态
     */
    const setTaskStatus = (taskId: string, status: TaskStatus) => {
        const task = tasks.value.find(t => t.id === taskId)
        if (task) {
            task.status = status

            // 如果设置为进行中，更新当前活动任务
            if (status === 'active') {
                activeTaskId.value = taskId
            }
            // 如果当前活动任务完成，清除活动状态
            else if (status === 'completed' && activeTaskId.value === taskId) {
                activeTaskId.value = null
            }
        }
    }

    /**
     * 设置任务的结果ID（用于跳转）
     * @param taskId 任务ID
     * @param resultId 分析结果ID
     */
    const setTaskResultId = (taskId: string, resultId: number) => {
        const task = tasks.value.find(t => t.id === taskId)
        if (task) {
            task.resultId = resultId
        }
    }

    /**
     * 添加分析模块任务
     * @param modules 分析模块列表
     */
    const addAnalysisModules = (modules: AnalysisModule[]) => {
        // 获取当前最大排序值
        const maxOrder = Math.max(...tasks.value.map(t => t.order), 0)

        // 添加分析模块任务
        modules.forEach((module, index) => {
            const taskId = `analysis-${module.id}`

            // 检查是否已存在
            const exists = tasks.value.some(t => t.id === taskId)
            if (exists) return

            tasks.value.push({
                id: taskId,
                name: module.name,
                description: module.description,
                type: 'analysis' as TaskType,
                status: 'pending' as TaskStatus,
                order: maxOrder + index + 1,
                nodeId: module.id,
            })
        })
    }

    /**
     * 移除所有分析模块任务
     */
    const removeAnalysisModules = () => {
        tasks.value = tasks.value.filter(t => t.type !== 'analysis')
    }

    /**
     * 根据节点ID获取任务
     * @param nodeId 节点ID
     */
    const getTaskByNodeId = (nodeId: number): TaskItem | undefined => {
        return tasks.value.find(t => t.nodeId === nodeId)
    }

    /**
     * 根据任务ID获取任务
     * @param taskId 任务ID
     */
    const getTaskById = (taskId: string): TaskItem | undefined => {
        return tasks.value.find(t => t.id === taskId)
    }

    /**
     * 获取下一个待处理任务
     */
    const getNextPendingTask = (): TaskItem | undefined => {
        return tasks.value
            .filter(t => t.status === 'pending')
            .sort((a, b) => a.order - b.order)[0]
    }

    /**
     * 获取当前活动任务
     */
    const getActiveTask = (): TaskItem | undefined => {
        return tasks.value.find(t => t.status === 'active')
    }

    /**
     * 检查所有任务是否完成
     */
    const isAllCompleted = computed(() => {
        return tasks.value.length > 0 && tasks.value.every(t => t.status === 'completed')
    })

    /**
     * 获取已完成任务数量
     */
    const completedCount = computed(() => {
        return tasks.value.filter(t => t.status === 'completed').length
    })

    /**
     * 获取进度百分比
     */
    const progressPercent = computed(() => {
        if (tasks.value.length === 0) return 0
        return Math.round((completedCount.value / tasks.value.length) * 100)
    })

    /**
     * 重置任务列表
     */
    const reset = () => {
        initTasks()
    }

    /**
     * 处理工作流中断事件
     * 根据中断类型更新对应任务状态
     * @param interruptType 中断类型
     */
    const handleInterrupt = (interruptType: string) => {
        switch (interruptType) {
            case 'case_info_check':
                setTaskStatus('case-info-check', 'active')
                break
            case 'basic_info_confirm':
                setTaskStatus('case-info-check', 'completed')
                setTaskStatus('basic-info-confirm', 'active')
                break
            case 'module_select':
                setTaskStatus('basic-info-confirm', 'completed')
                setTaskStatus('module-select', 'active')
                break
            default:
                // 检查是否是分析模块中断
                if (interruptType.startsWith('analysis_')) {
                    const nodeId = parseInt(interruptType.replace('analysis_', ''), 10)
                    if (!isNaN(nodeId)) {
                        const task = getTaskByNodeId(nodeId)
                        if (task) {
                            setTaskStatus(task.id, 'active')
                        }
                    }
                }
        }
    }

    /**
     * 处理工作流恢复事件
     * 根据恢复类型更新对应任务状态
     * @param resumeType 恢复类型
     * @param resultId 可选的结果ID
     */
    const handleResume = (resumeType: string, resultId?: number) => {
        switch (resumeType) {
            case 'case_info_check':
                // 案情检查完成后，可能需要继续检查或进入下一步
                break
            case 'basic_info_confirm':
                setTaskStatus('basic-info-confirm', 'completed')
                break
            case 'module_select':
                setTaskStatus('module-select', 'completed')
                break
            default:
                // 检查是否是分析模块完成
                if (resumeType.startsWith('analysis_')) {
                    const nodeId = parseInt(resumeType.replace('analysis_', ''), 10)
                    if (!isNaN(nodeId)) {
                        const task = getTaskByNodeId(nodeId)
                        if (task) {
                            setTaskStatus(task.id, 'completed')
                            if (resultId) {
                                setTaskResultId(task.id, resultId)
                            }
                        }
                    }
                }
        }
    }

    /**
     * 处理分析模块开始执行
     * @param nodeId 节点ID
     */
    const handleModuleStart = (nodeId: number) => {
        const task = getTaskByNodeId(nodeId)
        if (task) {
            setTaskStatus(task.id, 'active')
        }
    }

    /**
     * 处理分析模块执行完成
     * @param nodeId 节点ID
     * @param resultId 分析结果ID
     */
    const handleModuleComplete = (nodeId: number, resultId?: number) => {
        const task = getTaskByNodeId(nodeId)
        if (task) {
            setTaskStatus(task.id, 'completed')
            if (resultId) {
                setTaskResultId(task.id, resultId)
            }
        }
    }

    return {
        // 状态
        tasks: readonly(tasks),
        activeTaskId: readonly(activeTaskId),

        // 计算属性
        isAllCompleted,
        completedCount,
        progressPercent,

        // 方法
        initTasks,
        setTaskStatus,
        setTaskResultId,
        addAnalysisModules,
        removeAnalysisModules,
        getTaskByNodeId,
        getTaskById,
        getNextPendingTask,
        getActiveTask,
        reset,

        // 工作流事件处理
        handleInterrupt,
        handleResume,
        handleModuleStart,
        handleModuleComplete,
    }
}
