/**
 * 检索基础设施数据回填脚本
 *
 * 所有 schema 变更（扩展、列、trigger、索引）已纳入 Prisma 迁移：
 * prisma/migrations/20260413000000_retrieval_infra/migration.sql
 *
 * 本脚本仅处理数据操作：
 * - 填充已有数据的 tsv 列（新数据由 trigger 自动维护）
 *
 * 幂等设计：仅更新 tsv 为 NULL 的行，可重复执行
 */

import pg from 'pg'

async function main() {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL 环境变量未设置')
        process.exit(1)
    }

    const pool = new pg.Pool({ connectionString: databaseUrl })

    try {
        console.log('🚀 开始回填 tsv 数据...')

        const tables = ['law_embeddings', 'case_material_embeddings']
        for (const table of tables) {
            console.log(`  ▶ 填充 ${table}.tsv（仅 NULL 行）`)
            const result = await pool.query(
                `UPDATE ${table} SET tsv = to_tsvector('chinese', COALESCE(text, '')) WHERE tsv IS NULL`,
            )
            console.log(`  ✅ ${table} 完成（更新 ${result.rowCount} 行）`)
        }

        console.log('✅ tsv 数据回填完成！')
    } catch (error) {
        console.error('❌ 回填失败:', error)
        process.exit(1)
    } finally {
        await pool.end()
    }
}

main()
