/**
 * MinerU 任务服务层
 *
 * 提供 MinerU PDF 转换任务的管理功能
 * Requirements: 3.1.2.1-3.1.2.12
 */

import type { mineruTasks, Prisma } from '~~/generated/prisma/client'
import type { MineruTaskStatus as MineruTaskStatusType } from '#shared/types/recognition'
import { $fetch } from 'ofetch'
import { getActiveTokenValueService } from './mineruToken.service'
import {
    createMineruTaskDao,
    findMineruTaskByIdDao,
    findMineruTaskByTaskIdDao,
    findMineruTaskByOssFileIdDao,
    findManyMineruTasksDao,
    findMineruTasksByIdsDao,
    updateMineruTaskDao,
    updateMineruTaskByTaskIdDao,
    findPendingMineruTasksDao,
} from './mineruTask.dao'
import { MineruTaskStatus } from '#shared/types/recognition'
import type { ossFiles } from '~~/generated/prisma/client'

/** MinerU API 任务状态响应 */
interface MineruTaskStatusResponse {
    code: number
    msg: string
    data?: {
        state: string
        progress?: number
        result?: any
        err_msg?: string
    }
}

/** MinerU 任务查询参数 */
export interface MineruTaskQueryOptions {
    /** 任务状态 */
    status?: number
    /** 开始时间 */
    startDate?: Date
    /** 结束时间 */
    endDate?: Date
    /** 关键词（搜索任务ID或文件名） */
    keyword?: string
    /** 页码 */
    page?: number
    /** 每页数量 */
    pageSize?: number
    /** 排序字段 */
    orderBy?: 'id' | 'status' | 'createdAt' | 'completedAt'
    /** 排序方向 */
    orderDir?: 'asc' | 'desc'
}

/** 创建 MinerU 任务输入 */
export interface CreateMineruTaskInput {
    /** MinerU 服务返回的任务ID */
    taskId?: string
    /** 关联的 OSS 文件ID */
    ossFileId: number
    /** 关联的用户ID */
    userId: number
    /** 任务状态 */
    status?: number
    /** 任务原始数据（提交参数等） */
    taskRawData?: Record<string, any>
    /** 重试来源任务ID（如果是重试任务） */
    retrySourceId?: number
    /** 是否为加密文件（用于判断能否后台重试） */
    isEncrypted?: boolean
}

/** 更新 MinerU 任务输入 */
export interface UpdateMineruTaskInput {
    /** MinerU 服务返回的任务ID */
    taskId?: string
    /** 任务状态 */
    status?: number
    /** 任务原始数据 */
    taskRawData?: Record<string, any>
    /** 转换结果 */
    result?: Record<string, any>
    /** 错误信息 */
    errorMsg?: string
    /** 重试次数 */
    retryCount?: number
    /** 完成时间 */
    completedAt?: Date
    /** 被哪个任务替代（重试后的新任务ID） */
    supersededById?: number
}

/** MinerU 批量查询结果 */
export interface MineruBatchQueryResult {
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

/** MinerU 任务（包含文件信息） */
export interface MineruTaskWithFile extends mineruTasks {
    /** 文件名 */
    fileName?: string
    /** 文件大小 */
    fileSize?: number
}

// ==================== 服务层 ====================

/**
 * 创建 MinerU 任务
 * Requirements: 3.1.2.1
 */
export const createMineruTaskService = async (
    data: CreateMineruTaskInput,
    tx?: Prisma.TransactionClient
): Promise<mineruTasks> => {
    return await createMineruTaskDao(data, tx)
}

/**
 * 获取 MinerU 任务详情
 * Requirements: 3.1.2.10
 */
export const getMineruTaskByIdService = async (
    id: number
): Promise<MineruTaskWithFile | null> => {
    const task = await findMineruTaskByIdDao(id)
    if (!task) {
        return null
    }

    // 获取关联的文件信息
    const ossFile = await prisma.ossFiles.findFirst({
        where: { id: task.ossFileId, deletedAt: null },
        select: { fileName: true, fileSize: true },
    })

    return {
        ...task,
        fileName: ossFile?.fileName,
        fileSize: ossFile?.fileSize ? Number(ossFile.fileSize) : undefined,
    }
}

/**
 * 通过 taskId 获取 MinerU 任务
 */
export const getMineruTaskByTaskIdService = async (
    taskId: string
): Promise<mineruTasks | null> => {
    return await findMineruTaskByTaskIdDao(taskId)
}

/**
 * 通过 ossFileId 获取最新的 MinerU 任务
 */
export const getMineruTaskByOssFileIdService = async (
    ossFileId: number
): Promise<mineruTasks | null> => {
    return await findMineruTaskByOssFileIdDao(ossFileId)
}

/**
 * 获取 MinerU 任务列表（分页）
 * Requirements: 3.1.2.1, 3.1.2.2, 3.1.2.3
 */
export const getMineruTasksService = async (
    options: MineruTaskQueryOptions = {}
): Promise<{ list: MineruTaskWithFile[]; total: number }> => {
    const { list, total } = await findManyMineruTasksDao(options)

    // 获取所有关联的文件信息
    const ossFileIds = list.map((task) => task.ossFileId)
    const ossFiles = await prisma.ossFiles.findMany({
        where: { id: { in: ossFileIds }, deletedAt: null },
        select: { id: true, fileName: true, fileSize: true },
    })

    // 构建文件信息映射
    const fileMap = new Map(
        ossFiles.map((file) => [
            file.id,
            { fileName: file.fileName, fileSize: Number(file.fileSize) },
        ])
    )

    // 合并任务和文件信息
    const tasksWithFile: MineruTaskWithFile[] = list.map((task) => {
        const fileInfo = fileMap.get(task.ossFileId)
        return {
            ...task,
            fileName: fileInfo?.fileName,
            fileSize: fileInfo?.fileSize,
        }
    })

    return { list: tasksWithFile, total }
}

/**
 * 查询单个任务状态（调用 MinerU API）
 * Requirements: 3.1.2.4, 3.1.2.5, 3.1.2.6
 */
export const queryMineruTaskStatusService = async (
    id: number
): Promise<MineruTaskWithFile> => {
    // 获取任务
    const task = await findMineruTaskByIdDao(id)
    if (!task) {
        throw new Error('任务不存在')
    }

    // 如果任务已完成或失败，直接返回
    if (task.status === MineruTaskStatus.SUCCESS || task.status === MineruTaskStatus.FAILED) {
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: task.ossFileId, deletedAt: null },
            select: { fileName: true, fileSize: true },
        })
        return {
            ...task,
            fileName: ossFile?.fileName,
            fileSize: ossFile?.fileSize ? Number(ossFile.fileSize) : undefined,
        }
    }

    // 如果没有 taskId，无法查询
    if (!task.taskId) {
        throw new Error('任务尚未提交到 MinerU 服务')
    }

    // 获取当前启用的 Token
    const token = await getActiveTokenValueService()
    if (!token) {
        throw new Error('没有可用的 MinerU Token')
    }

    try {
        // 调用 MinerU API 查询任务状态
        // 使用类型断言避免 $fetch 类型实例化过深的问题
        const response = (await $fetch(
            `https://mineru.net/api/v4/extract/task/${task.taskId}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            },
        )) as MineruTaskStatusResponse

        if (response.code !== 0) {
            throw new Error(response.msg || '查询任务状态失败')
        }

        const data = response.data
        if (!data) {
            throw new Error('查询结果为空')
        }

        // 根据 MinerU 返回的状态更新本地任务状态
        let newStatus = task.status
        let updateData: UpdateMineruTaskInput = {}

        switch (data.state) {
            case 'pending':
            case 'running':
                newStatus = MineruTaskStatus.PROCESSING
                break
            case 'done':
                newStatus = MineruTaskStatus.SUCCESS
                updateData.result = data.result
                updateData.completedAt = new Date()
                break
            case 'failed':
                newStatus = MineruTaskStatus.FAILED
                updateData.errorMsg = data.err_msg || '转换失败'
                updateData.completedAt = new Date()
                break
        }

        // 更新任务状态
        if (newStatus !== task.status || Object.keys(updateData).length > 0) {
            updateData.status = newStatus
            await updateMineruTaskDao(id, updateData)
        }

        // 返回更新后的任务
        const updatedTask = await findMineruTaskByIdDao(id)
        const ossFile = await prisma.ossFiles.findFirst({
            where: { id: task.ossFileId, deletedAt: null },
            select: { fileName: true, fileSize: true },
        })

        return {
            ...updatedTask!,
            fileName: ossFile?.fileName,
            fileSize: ossFile?.fileSize ? Number(ossFile.fileSize) : undefined,
        }
    } catch (error) {
        logger.error('查询 MinerU 任务状态失败：', error)
        throw error
    }
}

/**
 * 批量查询任务状态
 * Requirements: 3.1.2.7, 3.1.2.8, 3.1.2.9
 */
export const queryMineruTaskStatusBatchService = async (
    ids: number[]
): Promise<MineruBatchQueryResult> => {
    const result: MineruBatchQueryResult = {
        total: ids.length,
        success: 0,
        failed: 0,
        changed: 0,
        results: [],
    }

    // 获取所有任务
    const tasks = await findMineruTasksByIdsDao(ids)
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
            const updatedTask = await queryMineruTaskStatusService(id)
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
 * Requirements: 3.1.2.11, 3.1.2.12
 * 
 * 注意：MinerU 任务无法在后台重试，因为文件是前端直传到 MinerU 服务的，
 * 后台没有文件内容，无法重新生成文件 URL。
 * 如需重试，请在前端重新提交识别任务。
 */
export const retryMineruTaskService = async (
    id: number
): Promise<MineruTaskWithFile> => {
    throw new Error('MinerU 任务无法在后台重试。原因：文件是前端直传到 MinerU 服务的，后台没有文件内容。请在前端重新提交识别任务。')
}

/**
 * 更新任务状态
 * 用于回调接口更新任务状态
 */
export const updateMineruTaskStatusService = async (
    taskId: string,
    status: number,
    result?: Record<string, any>,
    errorMsg?: string
): Promise<mineruTasks | null> => {
    const updateData: UpdateMineruTaskInput = {
        status,
    }

    if (result) {
        updateData.result = result
    }

    if (errorMsg) {
        updateData.errorMsg = errorMsg
    }

    if (status === MineruTaskStatus.SUCCESS || status === MineruTaskStatus.FAILED) {
        updateData.completedAt = new Date()
    }

    return await updateMineruTaskByTaskIdDao(taskId, updateData)
}

/**
 * 更新任务（通过 ID）
 */
export const updateMineruTaskService = async (
    id: number,
    data: UpdateMineruTaskInput,
    tx?: Prisma.TransactionClient
): Promise<mineruTasks> => {
    // 检查任务是否存在
    const existing = await findMineruTaskByIdDao(id, tx)
    if (!existing) {
        throw new Error('任务不存在')
    }

    return await updateMineruTaskDao(id, data, tx)
}

/**
 * 获取待处理或处理中的任务列表
 * 用于轮询保底机制
 */
export const getPendingMineruTasksService = async (
    limit: number = 100
): Promise<mineruTasks[]> => {
    return await findPendingMineruTasksDao(limit)
}

/**
 * 检查 MinerU 任务是否已处理（幂等检查）
 * 用于回调接口避免重复处理
 */
export const isMineruTaskProcessedService = async (taskId: string): Promise<boolean> => {
    const task = await findMineruTaskByTaskIdDao(taskId)
    if (!task) {
        return false
    }
    return task.status === MineruTaskStatus.SUCCESS || task.status === MineruTaskStatus.FAILED
}
