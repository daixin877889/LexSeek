import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../app/generated/prisma/client'

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
 * 递归处理对象中的所有 Date 字段（写入时转换）
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
 * 递归处理对象中的所有 Date 字段（读取时转换）
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

const prismaClientSingleton = () => {
    const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
    const baseClient = new PrismaClient({ adapter: pool })

    // 使用 $extends 创建带时区转换的客户端
    const client = baseClient.$extends({
        query: {
            $allModels: {
                // 写入操作：转换输入的 Date
                async create({ args, query }) {
                    args.data = convertDatesForWrite(args.data) as typeof args.data
                    const result = await query(args)
                    return convertDatesForRead(result)
                },
                async createMany({ args, query }) {
                    if (Array.isArray(args.data)) {
                        args.data = args.data.map(item => convertDatesForWrite(item)) as typeof args.data
                    } else {
                        args.data = convertDatesForWrite(args.data) as typeof args.data
                    }
                    return query(args)
                },
                async update({ args, query }) {
                    args.data = convertDatesForWrite(args.data) as typeof args.data
                    const result = await query(args)
                    return convertDatesForRead(result)
                },
                async updateMany({ args, query }) {
                    args.data = convertDatesForWrite(args.data) as typeof args.data
                    return query(args)
                },
                async upsert({ args, query }) {
                    args.create = convertDatesForWrite(args.create) as typeof args.create
                    args.update = convertDatesForWrite(args.update) as typeof args.update
                    const result = await query(args)
                    return convertDatesForRead(result)
                },
                // 读取操作：转换返回的 Date
                async findFirst({ args, query }) {
                    const result = await query(args)
                    return convertDatesForRead(result)
                },
                async findUnique({ args, query }) {
                    const result = await query(args)
                    return convertDatesForRead(result)
                },
                async findMany({ args, query }) {
                    const result = await query(args)
                    return convertDatesForRead(result)
                },
                async findFirstOrThrow({ args, query }) {
                    const result = await query(args)
                    return convertDatesForRead(result)
                },
                async findUniqueOrThrow({ args, query }) {
                    const result = await query(args)
                    return convertDatesForRead(result)
                },
            },
        },
    })

    return client
}

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClientSingleton | undefined
}

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
