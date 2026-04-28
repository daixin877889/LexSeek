/**
 * vitest globalSetup（master 进程，整个测试套件 1 次）
 *
 * 启动顺序：
 *   1. 加载 .env.testing
 *   2. DROP 上次残留的 ls_test_w* worker DB
 *   3. 校验源 DB（默认 ls_new_testing）存在且无活跃连接
 *   4. 并行 CREATE DATABASE ls_test_w<i> TEMPLATE <源 DB>（PG buffer 物理拷贝，~200ms/库）
 *
 * teardown 阶段（return 的回调）：DROP 所有 ls_test_w* worker DB。
 *
 * 如需重建 schema/seed，请按项目正常流程跑 `bun run db:setup`（更新源 DB），
 * 下次 globalSetup 自动把新内容拷贝到 worker DB。
 */
import { Client } from 'pg'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { deriveAdminUrl, getSourceDbName, assertTemplateUsable } from './template-db'

const ROOT = resolve(__dirname, '../..')
config({ path: resolve(ROOT, '.env.testing') })

/** 默认 4 个 worker；可通过 VITEST_MAX_WORKERS 环境变量覆盖 */
function getWorkerCount(): number {
    const fromEnv = process.env.VITEST_MAX_WORKERS
    const n = fromEnv ? Number(fromEnv) : 4
    if (!Number.isInteger(n) || n < 1) {
        throw new Error(`非法的 VITEST_MAX_WORKERS: ${fromEnv}`)
    }
    return n
}

async function dropAllWorkerDbs(admin: Client): Promise<void> {
    const rows = await admin.query(
        `SELECT datname FROM pg_database WHERE datname ~ '^ls_test_w[0-9]+$'`
    )
    for (const row of rows.rows) {
        await admin.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`).catch(err => {
            console.warn(`[globalSetup] drop ${row.datname} failed:`, (err as Error).message)
        })
    }
}

export default async function setup() {
    const baseUrl = process.env.DATABASE_URL
    if (!baseUrl) throw new Error('DATABASE_URL 未在 .env.testing 配置')
    const adminUrl = deriveAdminUrl(baseUrl)
    const sourceDb = getSourceDbName(baseUrl)
    const workerCount = getWorkerCount()

    console.log(`[globalSetup] source DB = ${sourceDb}, worker count = ${workerCount}`)

    // 1. 清理上次残留 worker DB
    {
        const admin = new Client({ connectionString: adminUrl })
        await admin.connect()
        try {
            await dropAllWorkerDbs(admin)
        } finally {
            await admin.end()
        }
    }

    // 2. 校验源 DB 状态（CREATE DATABASE TEMPLATE 要求模板无活跃连接）
    await assertTemplateUsable(adminUrl, sourceDb)

    // 3. 并行创建 N 个 worker DB
    {
        const admin = new Client({ connectionString: adminUrl })
        await admin.connect()
        try {
            await Promise.all(
                Array.from({ length: workerCount }, (_, i) =>
                    admin.query(`CREATE DATABASE "ls_test_w${i + 1}" TEMPLATE "${sourceDb}"`)
                )
            )
            console.log(`[globalSetup] ${workerCount} worker DBs ready (template = ${sourceDb})`)
        } finally {
            await admin.end()
        }
    }

    // teardown：测试套件结束时 DROP 所有 worker DB
    return async function teardown() {
        const admin = new Client({ connectionString: adminUrl })
        try {
            await admin.connect()
            await dropAllWorkerDbs(admin)
            console.log('[globalSetup] worker DBs dropped')
        } catch (err) {
            console.warn('[globalSetup] teardown error:', (err as Error).message)
        } finally {
            try { await admin.end() } catch { /* ignore */ }
        }
    }
}
