import { PrismaClient } from '../../generated/prisma/client'

// Asia/Shanghai 时区偏移量（毫秒）
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 将 Date 对象转换为适合 Asia/Shanghai 时区数据库存储的格式（写入时使用）
 * 
 * 问题：Node.js 的 Date 对象内部存储 UTC 时间戳，当 PostgreSQL（时区为 Asia/Shanghai）
 * 接收到这个时间时，会将其解释为 UTC 并添加 +08 偏移，导致时间多了 8 小时。
 * 
 * 解决方案：创建一个 Date 对象，其 UTC 时间值等于 Asia/Shanghai 的本地时间值。
 */
function toShanghaiDate(date: Date): Date {
    const shanghaiTime = date.getTime() + SHANGHAI_OFFSET_MS
    return new Date(shanghaiTime)
}

/**
 * 将数据库读取的 Date 对象转换回正确的 UTC 时间（读取时使用）
 * 
 * 数据库返回的时间已经被加了 8 小时偏移，需要减回来才能得到正确的 UTC 时间
 */
function fromShanghaiDate(date: Date): Date {
    const utcTime = date.getTime() - SHANGHAI_OFFSET_MS
    return new Date(utcTime)
}

/**
 * 递归处理对象中的所有 Date 字段（写入/查询时转换为上海时区）
 * 用于：data、where、cursor 等所有需要发送到数据库的日期
 */
function convertDatesForWrite(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj
    }

    if (obj instanceof Date) {
        return toShanghaiDate(obj)
    }

    if (Array.isArray(obj)) {
        return obj.map(item => convertDatesForWrite(item))
    }

    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {}
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = convertDatesForWrite((obj as Record<string, unknown>)[key])
            }
        }
        return result
    }

    return obj
}

/**
 * 递归处理对象中的所有 Date 字段（读取时转换回 UTC）
 */
function convertDatesForRead(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj
    }

    if (obj instanceof Date) {
        return fromShanghaiDate(obj)
    }

    if (Array.isArray(obj)) {
        return obj.map(item => convertDatesForRead(item))
    }

    if (typeof obj === 'object') {
        const result: Record<string, unknown> = {}
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                result[key] = convertDatesForRead((obj as Record<string, unknown>)[key])
            }
        }
        return result
    }

    return obj
}

/**
 * 转换查询参数中的所有日期字段
 * 处理 where、cursor、having 等查询条件中的日期
 */
function convertQueryArgs(args: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...args }

    // 需要转换日期的查询参数字段
    const fieldsToConvert = ['where', 'cursor', 'having', 'data', 'create', 'update']

    for (const field of fieldsToConvert) {
        if (result[field] !== undefined) {
            result[field] = convertDatesForWrite(result[field])
        }
    }

    return result
}

const prismaClientSingleton = () => {
    // 确保 DATABASE_URL 存在
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
        console.error('[Prisma] DATABASE_URL environment variable is not set')
        throw new Error('DATABASE_URL environment variable is not set')
    }

    try {
        // 使用标准 Prisma 客户端，不使用 adapter
        const baseClient = new PrismaClient()

        // 使用 $extends 创建带时区转换的客户端
        const client = baseClient.$extends({
            query: {
                $allModels: {
                    // 写入操作：转换 data 和 where 中的 Date
                    async create({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async createMany({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        return query(convertedArgs as typeof args)
                    },
                    async createManyAndReturn({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async update({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async updateMany({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        return query(convertedArgs as typeof args)
                    },
                    async updateManyAndReturn({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async upsert({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    // 删除操作：转换 where 中的 Date
                    async delete({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async deleteMany({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        return query(convertedArgs as typeof args)
                    },
                    // 读取操作：转换 where、cursor 中的 Date，并转换返回结果
                    async findFirst({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async findUnique({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async findMany({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async findFirstOrThrow({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async findUniqueOrThrow({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    // 聚合操作：转换 where、cursor、having 中的 Date
                    async count({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        return query(convertedArgs as typeof args)
                    },
                    async aggregate({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                    async groupBy({ args, query }) {
                        const convertedArgs = convertQueryArgs(args as Record<string, unknown>)
                        const result = await query(convertedArgs as typeof args)
                        return convertDatesForRead(result)
                    },
                },
            },
        })

        return client
    } catch (error) {
        console.error('[Prisma] Failed to initialize Prisma client:', error)
        throw error
    }
}

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClientSingleton | undefined
}

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
