/**
 * MinerU 任务 DAO 层
 *
 * 提供 MinerU PDF 转换任务的数据访问功能
 * Requirements: 3.1.2.1-3.1.2.12
 */

import type { mineruTasks, Prisma } from '~~/generated/prisma/client'
import type { MineruTaskQueryOptions, CreateMineruTaskInput, UpdateMineruTaskInput } from './mineruTask.service'

/**
 * 创建 MinerU 任务
 */
export const createMineruTaskDao = async (
    data: CreateMineruTaskInput,
    tx?: Prisma.TransactionClient
): Promise<mineruTasks> => {
    try {
        const task = await (tx || prisma).mineruTasks.create({
            data: {
                taskId: data.taskId,
                ossFileId: data.ossFileId,
                userId: data.userId,
                status: data.status ?? MineruTaskStatus.PENDING,
                taskRawData: data.taskRawData ?? {},
                isEncrypted: data.isEncrypted ?? false,
            },
        })
        return task
    } catch (error) {
        logger.error('创建 MinerU 任务失败：', error)
        throw error
    }
}

/**
 * 通过 ID 查询 MinerU 任务
 */
export const findMineruTaskByIdDao = async (
    id: number,
    tx?: Prisma.TransactionClient
): Promise<mineruTasks | null> => {
    try {
        const task = await (tx || prisma).mineruTasks.findFirst({
            where: { id, deletedAt: null },
        })
        return task
    } catch (error) {
        logger.error('通过 ID 查询 MinerU 任务失败：', error)
        throw error
    }
}

/**
 * 通过 taskId 查询 MinerU 任务
 */
export const findMineruTaskByTaskIdDao = async (
    taskId: string,
    tx?: Prisma.TransactionClient
): Promise<mineruTasks | null> => {
    try {
        const task = await (tx || prisma).mineruTasks.findFirst({
            where: { taskId, deletedAt: null },
        })
        return task
    } catch (error) {
        logger.error('通过 taskId 查询 MinerU 任务失败：', error)
        throw error
    }
}

/**
 * 通过 ossFileId 查询最新的 MinerU 任务
 */
export const findMineruTaskByOssFileIdDao = async (
    ossFileId: number,
    tx?: Prisma.TransactionClient
): Promise<mineruTasks | null> => {
    try {
        const task = await (tx || prisma).mineruTasks.findFirst({
            where: { ossFileId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        })
        return task
    } catch (error) {
        logger.error('通过 ossFileId 查询 MinerU 任务失败：', error)
        throw error
    }
}

/**
 * 查询 MinerU 任务列表（分页）
 */
export const findManyMineruTasksDao = async (
    options: MineruTaskQueryOptions = {},
    tx?: Prisma.TransactionClient
): Promise<{ list: mineruTasks[]; total: number }> => {
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
        const where: Prisma.mineruTasksWhereInput = {
            deletedAt: null,
            // 默认不显示已被替代的任务
            status: { not: MineruTaskStatus.SUPERSEDED },
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
            (tx || prisma).mineruTasks.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: { [orderBy]: orderDir },
            }),
            (tx || prisma).mineruTasks.count({ where }),
        ])

        return { list, total }
    } catch (error) {
        logger.error('查询 MinerU 任务列表失败：', error)
        throw error
    }
}

/**
 * 通过 ID 列表查询 MinerU 任务
 */
export const findMineruTasksByIdsDao = async (
    ids: number[],
    tx?: Prisma.TransactionClient
): Promise<mineruTasks[]> => {
    try {
        const tasks = await (tx || prisma).mineruTasks.findMany({
            where: {
                id: { in: ids },
                deletedAt: null,
            },
        })
        return tasks
    } catch (error) {
        logger.error('通过 ID 列表查询 MinerU 任务失败：', error)
        throw error
    }
}

/**
 * 更新 MinerU 任务
 */
export const updateMineruTaskDao = async (
    id: number,
    data: UpdateMineruTaskInput,
    tx?: Prisma.TransactionClient
): Promise<mineruTasks> => {
    try {
        const task = await (tx || prisma).mineruTasks.update({
            where: { id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return task
    } catch (error) {
        logger.error('更新 MinerU 任务失败：', error)
        throw error
    }
}

/**
 * 通过 taskId 更新 MinerU 任务
 */
export const updateMineruTaskByTaskIdDao = async (
    taskId: string,
    data: UpdateMineruTaskInput,
    tx?: Prisma.TransactionClient
): Promise<mineruTasks | null> => {
    try {
        // 先查找任务
        const existing = await findMineruTaskByTaskIdDao(taskId, tx)
        if (!existing) {
            return null
        }

        const task = await (tx || prisma).mineruTasks.update({
            where: { id: existing.id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        })
        return task
    } catch (error) {
        logger.error('通过 taskId 更新 MinerU 任务失败：', error)
        throw error
    }
}

/**
 * 获取待处理或处理中的任务列表
 */
export const findPendingMineruTasksDao = async (
    limit: number = 100,
    tx?: Prisma.TransactionClient
): Promise<mineruTasks[]> => {
    try {
        const tasks = await (tx || prisma).mineruTasks.findMany({
            where: {
                deletedAt: null,
                status: {
                    in: [MineruTaskStatus.PENDING, MineruTaskStatus.PROCESSING],
                },
                // 过滤掉 taskId 为 null 或 'existing' 的记录
                taskId: {
                    not: null,
                    notIn: ['existing'],
                },
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
