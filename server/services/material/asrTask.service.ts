/**
 * ASR 任务服务层
 *
 * 提供 ASR 音频转录任务的管理功能
 * Requirements: 3.2.1.1-3.2.1.12
 */

import type { asrTasks, Prisma } from '~~/generated/prisma/client'
import {
    createAsrTaskDao,
    findAsrTaskByIdDao,
    findAsrTaskByTaskIdDao,
    findManyAsrTasksDao,
    findAsrTasksByIdsDao,
    updateAsrTaskDao,
    updateAsrTaskByTaskIdDao,
    findPendingAsrTasksDao,
} from './asrTask.dao'

/** ASR 任务状态枚举 */
export enum AsrTaskStatus {
    /** 待处理 */
    PENDING = 0,
    /** 处理中 */
    PROCESSING = 1,
    /** 成功 */
    SUCCESS = 2,
    /** 失败 */
    FAILED = 3,
}

/** ASR 任务状态文本映射 */
export const AsrTaskStatusText: Record<AsrTaskStatus, string> = {
    [AsrTaskStatus.PENDING]: '待处理',
    [AsrTaskStatus.PROCESSING]: '处理中',
    [AsrTaskStatus.SUCCESS]: '成功',
    [AsrTaskStatus.FAILED]: '失败',
}

/** ASR 任务查询参数 */
export interface AsrTaskQueryOptions {
    /** 任务状态 */
    status?: number
    /** 开始时间 */
    startDate?: Date
    /** 结束时间 */
    endDate?: Date
    /** 关键词（搜索任务ID） */
    keyword?: string
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
    /** 排序字段 */
    orderBy?: 'id' | 'status' | 'createdAt'
    /** 排序方向 */
    orderDir?: 'asc' | 'desc'
}

/** 创建 ASR 任务输入 */
export interface CreateAsrTaskInput {
    /** ASR 服务返回的任务ID */
    taskId?: string
    /** 任务状态 */
    status?: number
    /** 任务原始数据（提交参数等） */
    taskRawData?: Record<string, any>
    /** 识别结果 */
    result?: Record<string, any>
}

/** 更新 ASR 任务输入 */
export interface UpdateAsrTaskInput {
    /** ASR 服务返回的任务ID */
    taskId?: string
    /** 任务状态 */
    status?: number
    /** 任务原始数据 */
    taskRawData?: Record<string, any>
    /** 识别结果 */
    result?: Record<string, any>
}

/** ASR 批量查询结果 */
export interface AsrBatchQueryResult {
    /** 总数 */
    total: number
    /** 成功数 */
    success: number
    /** 失败数 */
    failed: number
    /** 状态变更数 */
    changed: number
    /** 详细结果 */
    results: Array<{
        id: number
        status: number
        changed: boolean
        error?: string
    }>
}

/** ASR 任务（包含关联记录信息） */
export interface AsrTaskWithRecords extends asrTasks {
    /** 关联的 ASR 记录数量 */
    recordCount?: number
    /** 关联的文件名列表 */
    fileNames?: string[]
}

// ==================== 服务层 ====================

/**
 * 创建 ASR 任务
 * Requirements: 3.2.1.1
 */
export const createAsrTaskService = async (
    data: CreateAsrTaskInput,
    tx?: Prisma.TransactionClient
): Promise<asrTasks> => {
    return await createAsrTaskDao(data, tx)
}

/**
 * 获取 ASR 任务详情
 * Requirements: 3.2.1.10
 */
export const getAsrTaskByIdService = async (
    id: number
): Promise<AsrTaskWithRecords | null> => {
    const task = await findAsrTaskByIdDao(id)
    if (!task) {
        return null
    }

    // 获取关联的 ASR 记录信息
    const records = await prisma.asrRecords.findMany({
        where: { asrTasksId: task.id, deletedAt: null },
        select: {
            id: true,
            ossFileId: true,
        },
    })

    // 获取关联的文件名
    let fileNames: string[] = []
    if (records.length > 0) {
        const ossFileIds = records.map((r) => r.ossFileId)
        const ossFiles = await prisma.ossFiles.findMany({
            where: { id: { in: ossFileIds }, deletedAt: null },
            select: { fileName: true },
        })
        fileNames = ossFiles.map((f) => f.fileName)
    }

    return {
        ...task,
        recordCount: records.length,
        fileNames,
    }
}

/**
 * 通过 taskId 获取 ASR 任务
 */
export const getAsrTaskByTaskIdService = async (
    taskId: string
): Promise<asrTasks | null> => {
    return await findAsrTaskByTaskIdDao(taskId)
}

/**
 * 获取 ASR 任务列表（分页）
 * Requirements: 3.2.1.1, 3.2.1.2, 3.2.1.3
 */
export const getAsrTasksService = async (
    options: AsrTaskQueryOptions = {}
): Promise<{ list: AsrTaskWithRecords[]; total: number }> => {
    const { list, total } = await findManyAsrTasksDao(options)

    // 获取所有任务的关联记录数量
    const taskIds = list.map((task) => task.id)
    const recordCounts = await prisma.asrRecords.groupBy({
        by: ['asrTasksId'],
        where: {
            asrTasksId: { in: taskIds },
            deletedAt: null,
        },
        _count: { id: true },
    })

    // 构建记录数量映射
    const countMap = new Map(
        recordCounts.map((r) => [r.asrTasksId, r._count.id])
    )

    // 合并任务和记录数量
    const tasksWithRecords: AsrTaskWithRecords[] = list.map((task) => ({
        ...task,
        recordCount: countMap.get(task.id) || 0,
    }))

    return { list: tasksWithRecords, total }
}


/**
 * 查询单个任务状态（调用 ASR API）
 * Requirements: 3.2.1.4, 3.2.1.5, 3.2.1.6
 */
export const queryAsrTaskStatusService = async (
    id: number
): Promise<AsrTaskWithRecords> => {
    // 获取任务
    const task = await findAsrTaskByIdDao(id)
    if (!task) {
        throw new Error('任务不存在')
    }

    // 如果任务已完成或失败，直接返回
    if (task.status === AsrTaskStatus.SUCCESS || task.status === AsrTaskStatus.FAILED) {
        const records = await prisma.asrRecords.findMany({
            where: { asrTasksId: task.id, deletedAt: null },
            select: { id: true, ossFileId: true },
        })
        let fileNames: string[] = []
        if (records.length > 0) {
            const ossFileIds = records.map((r) => r.ossFileId)
            const ossFiles = await prisma.ossFiles.findMany({
                where: { id: { in: ossFileIds }, deletedAt: null },
                select: { fileName: true },
            })
            fileNames = ossFiles.map((f) => f.fileName)
        }
        return {
            ...task,
            recordCount: records.length,
            fileNames,
        }
    }

    // 如果没有 taskId，无法查询
    if (!task.taskId) {
        throw new Error('任务尚未提交到 ASR 服务')
    }

    // 获取 ASR API Token（从环境变量获取）
    const asrToken = process.env.DASHSCOPE_API_KEY
    if (!asrToken) {
        throw new Error('未配置 ASR API Token')
    }

    try {
        // 调用阿里云百炼 ASR API 查询任务状态
        const response = await $fetch<{
            request_id?: string
            output?: {
                task_id: string
                task_status: string
                results?: Array<{
                    file_url: string
                    subtask_status: string
                    transcription_url?: string
                }>
            }
            code?: string
            message?: string
        }>(`https://dashscope.aliyuncs.com/api/v1/tasks/${task.taskId}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${asrToken}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
        })

        if (response.code) {
            throw new Error(response.message || '查询任务状态失败')
        }

        const output = response.output
        if (!output) {
            throw new Error('查询结果为空')
        }

        // 根据 ASR 返回的状态更新本地任务状态
        let newStatus = task.status
        let updateData: UpdateAsrTaskInput = {}

        switch (output.task_status) {
            case 'PENDING':
            case 'RUNNING':
                newStatus = AsrTaskStatus.PROCESSING
                break
            case 'SUCCEEDED':
                newStatus = AsrTaskStatus.SUCCESS
                updateData.result = output
                break
            case 'FAILED':
            case 'UNKNOWN':
                newStatus = AsrTaskStatus.FAILED
                updateData.result = output
                break
        }

        // 更新任务状态
        if (newStatus !== task.status || Object.keys(updateData).length > 0) {
            updateData.status = newStatus
            await updateAsrTaskDao(id, updateData)
        }

        // 返回更新后的任务
        const updatedTask = await findAsrTaskByIdDao(id)
        const records = await prisma.asrRecords.findMany({
            where: { asrTasksId: task.id, deletedAt: null },
            select: { id: true, ossFileId: true },
        })
        let fileNames: string[] = []
        if (records.length > 0) {
            const ossFileIds = records.map((r) => r.ossFileId)
            const ossFiles = await prisma.ossFiles.findMany({
                where: { id: { in: ossFileIds }, deletedAt: null },
                select: { fileName: true },
            })
            fileNames = ossFiles.map((f) => f.fileName)
        }

        return {
            ...updatedTask!,
            recordCount: records.length,
            fileNames,
        }
    } catch (error) {
        logger.error('查询 ASR 任务状态失败：', error)
        throw error
    }
}

/**
 * 批量查询任务状态
 * Requirements: 3.2.1.7, 3.2.1.8, 3.2.1.9
 */
export const queryAsrTaskStatusBatchService = async (
    ids: number[]
): Promise<AsrBatchQueryResult> => {
    const result: AsrBatchQueryResult = {
        total: ids.length,
        success: 0,
        failed: 0,
        changed: 0,
        results: [],
    }

    // 获取所有任务
    const tasks = await findAsrTasksByIdsDao(ids)
    const taskMap = new Map(tasks.map((t) => [t.id, t]))

    // 逐个查询任务状态
    for (const id of ids) {
        const task = taskMap.get(id)
        if (!task) {
            result.failed++
            result.results.push({
                id,
                status: -1,
                changed: false,
                error: '任务不存在',
            })
            continue
        }

        const originalStatus = task.status

        try {
            const updatedTask = await queryAsrTaskStatusService(id)
            const changed = updatedTask.status !== originalStatus
            if (changed) {
                result.changed++
            }
            result.success++
            result.results.push({
                id,
                status: updatedTask.status,
                changed,
            })
        } catch (error) {
            result.failed++
            result.results.push({
                id,
                status: task.status,
                changed: false,
                error: error instanceof Error ? error.message : '查询失败',
            })
        }
    }

    return result
}

/**
 * 重试任务
 * Requirements: 3.2.1.11, 3.2.1.12
 */
export const retryAsrTaskService = async (
    id: number
): Promise<AsrTaskWithRecords> => {
    // 获取任务
    const task = await findAsrTaskByIdDao(id)
    if (!task) {
        throw new Error('任务不存在')
    }

    // 只有失败的任务才能重试
    if (task.status !== AsrTaskStatus.FAILED) {
        throw new Error('只有失败的任务才能重试')
    }

    // 获取 ASR API Token
    const asrToken = process.env.DASHSCOPE_API_KEY
    if (!asrToken) {
        throw new Error('未配置 ASR API Token')
    }

    // 获取关联的 ASR 记录
    const records = await prisma.asrRecords.findMany({
        where: { asrTasksId: task.id, deletedAt: null },
        select: { id: true, ossFileId: true, audioUrl: true },
    })

    if (records.length === 0) {
        throw new Error('没有关联的音频记录')
    }

    // 获取音频 URL 列表
    const audioUrls = records
        .map((r) => r.audioUrl)
        .filter((url): url is string => !!url)

    if (audioUrls.length === 0) {
        throw new Error('没有有效的音频 URL')
    }

    try {
        // 重新提交任务到 ASR 服务
        const response = await $fetch<{
            request_id?: string
            output?: {
                task_id: string
                task_status: string
            }
            code?: string
            message?: string
        }>('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${asrToken}`,
                'Content-Type': 'application/json',
                'X-DashScope-Async': 'enable',
            },
            body: {
                model: 'paraformer-v2',
                input: {
                    file_urls: audioUrls,
                },
                parameters: {
                    timestamp_alignment_enabled: false,
                    language_hints: ['zh', 'en'],
                    disfluency_removal_enabled: false,
                    diarization_enabled: true,
                },
            },
        })

        if (response.code) {
            throw new Error(response.message || '重新提交任务失败')
        }

        const newTaskId = response.output?.task_id
        if (!newTaskId) {
            throw new Error('未获取到新的任务ID')
        }

        // 从 taskRawData 中获取重试次数
        const taskRawData = (task.taskRawData as Record<string, any>) || {}
        const retryCount = (taskRawData.retryCount || 0) + 1

        // 更新任务状态
        const updatedTask = await updateAsrTaskDao(id, {
            taskId: newTaskId,
            status: AsrTaskStatus.PROCESSING,
            taskRawData: {
                ...taskRawData,
                retryCount,
                retryAt: new Date().toISOString(),
                originalResponse: response,
            },
            result: {},
        })

        // 更新关联的 ASR 记录状态
        await prisma.asrRecords.updateMany({
            where: { asrTasksId: task.id, deletedAt: null },
            data: {
                status: AsrTaskStatus.PROCESSING,
                updatedAt: new Date(),
            },
        })

        // 获取文件名
        let fileNames: string[] = []
        if (records.length > 0) {
            const ossFileIds = records.map((r) => r.ossFileId)
            const ossFiles = await prisma.ossFiles.findMany({
                where: { id: { in: ossFileIds }, deletedAt: null },
                select: { fileName: true },
            })
            fileNames = ossFiles.map((f) => f.fileName)
        }

        return {
            ...updatedTask,
            recordCount: records.length,
            fileNames,
        }
    } catch (error) {
        logger.error('重试 ASR 任务失败：', error)
        throw error
    }
}

/**
 * 更新任务状态
 * 用于回调接口或定时任务更新任务状态
 */
export const updateAsrTaskStatusService = async (
    taskId: string,
    status: number,
    result?: Record<string, any>
): Promise<asrTasks | null> => {
    const updateData: UpdateAsrTaskInput = {
        status,
    }

    if (result) {
        updateData.result = result
    }

    return await updateAsrTaskByTaskIdDao(taskId, updateData)
}

/**
 * 更新任务（通过 ID）
 */
export const updateAsrTaskService = async (
    id: number,
    data: UpdateAsrTaskInput,
    tx?: Prisma.TransactionClient
): Promise<asrTasks> => {
    // 检查任务是否存在
    const existing = await findAsrTaskByIdDao(id, tx)
    if (!existing) {
        throw new Error('任务不存在')
    }

    return await updateAsrTaskDao(id, data, tx)
}

/**
 * 获取待处理或处理中的任务列表
 * 用于轮询保底机制
 */
export const getPendingAsrTasksService = async (
    limit: number = 100
): Promise<asrTasks[]> => {
    return await findPendingAsrTasksDao(limit)
}

/**
 * 检查 ASR 任务是否已处理（幂等检查）
 * 用于回调接口避免重复处理
 */
export const isAsrTaskProcessedService = async (taskId: string): Promise<boolean> => {
    const task = await findAsrTaskByTaskIdDao(taskId)
    if (!task) {
        return false
    }
    return task.status === AsrTaskStatus.SUCCESS || task.status === AsrTaskStatus.FAILED
}
