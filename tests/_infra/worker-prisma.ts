/**
 * Worker 级 Prisma 客户端工厂
 *
 * 每个 vitest worker 进程通过 process.env.VITEST_POOL_ID 拿到自己的 worker id（"1"..."N"），
 * 连接到对应的独立数据库 ls_test_w<id>。
 *
 * 关键点：业务代码（server/utils/db.ts）通过 globalForPrisma.prisma ?? prismaClientSingleton()
 * 读取实例。worker-setup.ts 在加载业务代码前先 globalThis.prisma = getWorkerPrisma()，
 * 业务代码 import '~~/server/utils/db' 时拿到的就是 worker 专属客户端。
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../.env.testing') })

/**
 * PG session 选项：
 *  - TimeZone=UTC：与业务 prisma 客户端保持一致（避免双时区偏移 bug）
 *  - synchronous_commit=off：测试场景禁用同步提交，写入吞吐显著提升（崩溃丢失测试数据可接受）
 *  - client_min_messages=warning：减少 NOTICE 输出对测试控制台的干扰
 */
const PG_OPTS = '-c TimeZone=UTC -c synchronous_commit=off -c client_min_messages=warning'

let _prisma: PrismaClient | null = null

/** 返回当前 worker 的 PrismaClient（单例） */
export function getWorkerPrisma(): PrismaClient {
    if (_prisma) return _prisma
    const id = process.env.VITEST_POOL_ID ?? '1'
    const base = process.env.DATABASE_URL
    if (!base) throw new Error('DATABASE_URL 未在 .env.testing 配置')
    const url = base.replace(/\/[^/?]+(\?|$)/, `/ls_test_w${id}$1`)
    const adapter = new PrismaPg({ connectionString: url, options: PG_OPTS })
    _prisma = new PrismaClient({ adapter })
    return _prisma
}

/** 释放当前 worker 的连接池（用于 afterAll 钩子或 worker 退出前） */
export async function disconnectWorkerPrisma(): Promise<void> {
    if (_prisma) {
        await _prisma.$disconnect()
        _prisma = null
    }
}
