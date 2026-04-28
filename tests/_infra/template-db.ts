/**
 * Template DB 选取
 *
 * 决策：直接以业务 DATABASE_URL 指向的库（默认 ls_new_testing）作为 PG TEMPLATE 源。
 * 该库已被项目流程（bun run db:setup）维护好完整 schema + seed，开发者改 schema 后
 * 通过 prisma:push / prisma:migrate 同步到此库，是项目里"测试 schema 唯一权威源"。
 *
 * 不再使用 fingerprint + 自动 migrate + seed-runner 重建：
 *   - seedData.sql 含 2 个 DO $$...$$ 块，pg.Client.query(整段) 在 PG 隐式事务下中途出错全部回滚
 *   - 拆分多语句逻辑复杂且脆弱（无法可靠识别 dollar-quote 边界）
 *   - 项目已有 db:setup 流程，再写一遍是重复
 */
import { Client } from 'pg'

/**
 * 把 connection string 里的 dbname 段替换成新值
 * postgresql://user:pwd@host:port/<old>?query → postgresql://user:pwd@host:port/<new>?query
 */
export function withDatabase(url: string, dbName: string): string {
    return url.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
}

/** 从业务 DATABASE_URL 派生 admin URL（连到默认的 postgres 库做 CREATE/DROP DATABASE） */
export function deriveAdminUrl(baseUrl: string): string {
    return withDatabase(baseUrl, 'postgres')
}

/** 从业务 DATABASE_URL 提取源 DB 名 */
export function getSourceDbName(baseUrl: string): string {
    const match = baseUrl.match(/\/([^/?]+)(?:\?|$)/)
    if (!match) throw new Error(`无法从 DATABASE_URL 提取 dbname: ${baseUrl}`)
    return match[1]
}

/**
 * 检查源 DB 是否存在且无活跃连接（CREATE DATABASE TEMPLATE 的前置条件）。
 * 不通过则抛出可读的错误（提示开发者关闭 prisma studio 等占用连接的工具）。
 */
export async function assertTemplateUsable(adminUrl: string, sourceDbName: string): Promise<void> {
    const admin = new Client({ connectionString: adminUrl })
    await admin.connect()
    try {
        const exists = await admin.query(
            `SELECT 1 FROM pg_database WHERE datname = $1`,
            [sourceDbName]
        )
        if (!exists.rowCount) {
            throw new Error(
                `源 DB ${sourceDbName} 不存在。请先跑 'bun run db:setup' 准备测试库。`
            )
        }
        const conns = await admin.query(
            `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [sourceDbName]
        )
        const n = conns.rows[0]?.n ?? 0
        if (n > 0) {
            throw new Error(
                `源 DB ${sourceDbName} 有 ${n} 个活跃连接，CREATE DATABASE TEMPLATE 会失败。` +
                `请关闭连接到该库的工具（如 prisma studio）后重试。`
            )
        }
    } finally {
        await admin.end()
    }
}
