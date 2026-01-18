/**
 * ASR 任务 DAO 层
 *
 * 提供 ASR 音频转录任务的数据访问功能
 * Requirements: 3.2.1.1-3.2.1.12
 */

import type { asrTasks, Prisma } from '~~/generated/prisma/client'
import type { AsrTaskQueryOptions, CreateAsrTaskInput, UpdateAsrTaskInput } from './asrTask.service'

/**
 * 创建 ASR 任务
 */
export const createAsrTaskDao = async (
    data: CreateAsrTaskInput,
    tx?: Prisma.TransactionClient
): Promise<asrTasks> => {
    try {
        const task = await (tx || prisma).asrTasks.create({
            data: {
                taskId: data.taskId,
                status: data.status ?? AsrTaskStatus.PENDING,
                taskRawData: data.taskRawData ?? {},
                result: data.result ?? {},
                retrySourceId: data.retrySourceId,
                isEncrypted: data.isEncrypted ?? false,
            },
        })
        return task
    } catch (error) {
        logger.error('创建 ASR 任务失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询 ASR 任务
 */
export const findAsrTaskByIdDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<asrTasks | null> => {
    try {
        const task = await (tx || prisma).asrTasks.findFirst({
            where: { id, deletedAt: null },
        })
        return task
    } catch (error) {
        logger.error('通过 ID 查询 ASR 任务失败：', error)
        throw error
    }
}

/**
 * 通过 taskId 查询 ASR 任务
 */
export const findAsrTaskByTaskIdDao = async (
    taskId: string,
    tx?: Prisma.TransactionClient
): Promise<asrTasks | null> => {
    try {
        const task = await (tx || prisma).asrTasks.findFirst({
            where: { taskId, deletedAt: null },
        })
        return task
    } catch (error) {
        logger.error('通过 taskId 查询 ASR 任务失败：', error)
        throw error
    }
}

/**
 * 查询 ASR 任务列表（分页）
 */
export const findManyAsrTasksDao = async (
    options: AsrTaskQueryOptions = {},
    tx?: Prisma.TransactionClient
): Promise<{ list: asrTasks[]; total: number }> => {
    const {
        page = 1,
        pageSize = 20,
        status,
        startDate,
        endDate,
        keyword,
        orderBy = 'createdAt',
        orderDir = 'desc',
    } = options

    try {
        const where: Prisma.asrTasksWhereInput = {
            deletedAt: null,
            // 默认不显示已被替代的任务
            status: { not: AsrTaskStatus.SUPERSEDED },
        }

        // 状态筛选（如果明确指定了状态，则覆盖默认过滤）
        if (status !== undefined) {
            where.status = status
        }

        // 时间范围筛选
        if (startDate || endDate) {
            where.createdAt = {}
            if (startDate) {
                where.createdAt.gte = startDate
            }
            if (endDate) {
                where.createdAt.lte = endDate
            }
        }

        // 关键词搜索（搜索任务ID）
        if (keyword) {
            where.taskId = { contains: keyword, mode: 'insensitive' }
        }

        const [list, total] = await Promise.all([
            (tx || prisma).asrTasks.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
            }),
            (tx || prisma).asrTasks.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询 ASR 任务列表失败：', error)
        throw error
    }
}

/**
 * 通过 ID 列表查询 ASR 任务
 */
export const findAsrTasksByIdsDao = async (
    ids: number[],
    tx?: Prisma.TransactionClient
): Promise<asrTasks[]> => {
    try {
        const tasks = await (tx || prisma).asrTasks.findMany({
            where: {
                id: { in: ids },
                deletedAt: null,
            },
        })
        return tasks
    } catch (error) {
        logger.error('通过 ID 列表查询 ASR 任务失败：', error)
        throw error
    }
}

/**
 * 更新 ASR 任务
 */
export const updateAsrTaskDao = async (
    id: number,
    data: UpdateAsrTaskInput,
    tx?: Prisma.TransactionClient
): Promise<asrTasks> => {
    try {
        const task = await (tx || prisma).asrTasks.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return task
    } catch (error) {
        logger.error('更新 ASR 任务失败：', error)
        throw error
    }
}

/**
 * 通过 taskId 更新 ASR 任务
 */
export const updateAsrTaskByTaskIdDao = async (
    taskId: string,
    data: UpdateAsrTaskInput,
    tx?: Prisma.TransactionClient
): Promise<asrTasks | null> => {
    try {
        // 先查找任务
        const existing = await findAsrTaskByTaskIdDao(taskId, tx)
        if (!existing) {
            return null
        }

        const task = await (tx || prisma).asrTasks.update({
            where: { id: existing.id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return task
    } catch (error) {
        logger.error('通过 taskId 更新 ASR 任务失败：', error)
        throw error
    }
}

/**
 * 获取待处理或处理中的任务列表
 */
export const findPendingAsrTasksDao = async (
    limit: number = 100,
    tx?: Prisma.TransactionClient
): Promise<asrTasks[]> => {
    try {
        const tasks = await (tx || prisma).asrTasks.findMany({
            where: {
                deletedAt: null,
                status: {
                    in: [AsrTaskStatus.PENDING, AsrTaskStatus.PROCESSING],
                },
                taskId: { not: null },
            },
            orderBy: { createdAt: 'asc' },
            take: limit,
        })
        return tasks
    } catch (error) {
        logger.error('获取待处理任务列表失败：', error)
        throw error
    }
}
