/**
 * 检索基础设施初始化脚本
 *
 * 功能：
 * - 启用 pg_trgm 和 zhparser 扩展
 * - 创建中文全文搜索配置
 * - 添加 tsv tsvector 列及自动更新 trigger
 * - 创建 GIN(tsv)、GIN(trgm)、JSONB 和 HNSW 向量索引
 *
 * 幂等设计：所有语句使用 IF NOT EXISTS / DO $$ 检查，可重复执行
 */

import pg from 'pg'

interface Statement {
    label: string
    sql: string
}

// 普通 DDL 语句（串行执行，每条独立）
const ddlStatements: Statement[] = [
    {
        label: '启用 pg_trgm 扩展',
        sql: 'CREATE EXTENSION IF NOT EXISTS pg_trgm',
    },
    {
        label: '启用 zhparser 扩展',
        sql: 'CREATE EXTENSION IF NOT EXISTS zhparser',
    },
    {
        label: '创建 chinese 全文搜索配置',
        sql: `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
    CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR
      n,v,a,i,e,l,j,d,f,r,p,q,m,k,u,s,y,z,x,w,h WITH simple;
  END IF;
END$$`,
    },
    {
        label: '为 law_embeddings 添加 tsv 列',
        sql: 'ALTER TABLE law_embeddings ADD COLUMN IF NOT EXISTS tsv tsvector',
    },
    {
        label: '为 case_material_embeddings 添加 tsv 列',
        sql: 'ALTER TABLE case_material_embeddings ADD COLUMN IF NOT EXISTS tsv tsvector',
    },
    {
        label: '创建 update_tsv_column trigger 函数',
        sql: `CREATE OR REPLACE FUNCTION update_tsv_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.tsv := to_tsvector('chinese', COALESCE(NEW.text, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql`,
    },
    {
        label: '绑定 trg_law_embeddings_tsv trigger',
        sql: `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_law_embeddings_tsv') THEN
    CREATE TRIGGER trg_law_embeddings_tsv
      BEFORE INSERT OR UPDATE OF text ON law_embeddings
      FOR EACH ROW EXECUTE FUNCTION update_tsv_column();
  END IF;
END$$`,
    },
    {
        label: '绑定 trg_case_material_embeddings_tsv trigger',
        sql: `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_case_material_embeddings_tsv') THEN
    CREATE TRIGGER trg_case_material_embeddings_tsv
      BEFORE INSERT OR UPDATE OF text ON case_material_embeddings
      FOR EACH ROW EXECUTE FUNCTION update_tsv_column();
  END IF;
END$$`,
    },
    {
        label: '初始填充 law_embeddings.tsv（仅更新 NULL 行）',
        sql: `UPDATE law_embeddings SET tsv = to_tsvector('chinese', COALESCE(text, '')) WHERE tsv IS NULL`,
    },
    {
        label: '初始填充 case_material_embeddings.tsv（仅更新 NULL 行）',
        sql: `UPDATE case_material_embeddings SET tsv = to_tsvector('chinese', COALESCE(text, '')) WHERE tsv IS NULL`,
    },
    {
        label: '创建 GIN(tsv) 索引 idx_law_embeddings_tsv',
        sql: 'CREATE INDEX IF NOT EXISTS idx_law_embeddings_tsv ON law_embeddings USING GIN(tsv)',
    },
    {
        label: '创建 GIN(tsv) 索引 idx_case_material_tsv',
        sql: 'CREATE INDEX IF NOT EXISTS idx_case_material_tsv ON case_material_embeddings USING GIN(tsv)',
    },
    {
        label: '创建 GIN(trgm) 索引 idx_law_embeddings_text_trgm',
        sql: 'CREATE INDEX IF NOT EXISTS idx_law_embeddings_text_trgm ON law_embeddings USING GIN(text gin_trgm_ops)',
    },
    {
        label: '创建 JSONB 索引 idx_law_emb_legal_id',
        sql: `CREATE INDEX IF NOT EXISTS idx_law_emb_legal_id ON law_embeddings ((metadata->>'legal_id'))`,
    },
    {
        label: '创建 JSONB 索引 idx_law_emb_legal_name',
        sql: `CREATE INDEX IF NOT EXISTS idx_law_emb_legal_name ON law_embeddings ((metadata->>'legal_name'))`,
    },
    {
        label: '创建 JSONB 索引 idx_case_material_emb_userid',
        sql: `CREATE INDEX IF NOT EXISTS idx_case_material_emb_userid ON case_material_embeddings ((metadata->>'userId'))`,
    },
    {
        label: '创建 JSONB 索引 idx_case_material_emb_sourceid',
        sql: `CREATE INDEX IF NOT EXISTS idx_case_material_emb_sourceid ON case_material_embeddings ((metadata->>'sourceId'))`,
    },
]

// HNSW 索引（必须使用 CONCURRENTLY，不能在事务中执行）
const hnswStatements: Statement[] = [
    {
        label: '创建 HNSW 向量索引 idx_law_embeddings_hnsw',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_law_embeddings_hnsw
  ON law_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)`,
    },
    {
        label: '创建 HNSW 向量索引 idx_case_material_hnsw',
        sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_case_material_hnsw
  ON case_material_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)`,
    },
]

async function main() {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL 环境变量未设置')
        process.exit(1)
    }

    const pool = new pg.Pool({ connectionString: databaseUrl })

    try {
        console.log('🚀 开始初始化检索基础设施...')

        // 执行普通 DDL 语句
        for (const { label, sql } of ddlStatements) {
            console.log(`  ▶ ${label}`)
            await pool.query(sql)
            console.log(`  ✅ ${label} 完成`)
        }

        // 执行 HNSW 索引（CONCURRENTLY，可能需要几分钟）
        console.log('  ▶ 创建 HNSW 向量索引（可能需要几分钟）...')
        for (const { label, sql } of hnswStatements) {
            console.log(`  ▶ ${label}`)
            try {
                await pool.query(sql)
                console.log(`  ✅ ${label} 完成`)
            } catch (error: unknown) {
                // CONCURRENTLY 索引创建失败可能留下 INVALID 索引
                // IF NOT EXISTS 会跳过已存在的有效索引，此处处理边缘情况
                const message = error instanceof Error ? error.message : String(error)
                if (message.includes('already exists')) {
                    console.log(`  ⏭ ${label} 已存在，跳过`)
                } else {
                    throw error
                }
            }
        }

        console.log('✅ 检索基础设施初始化完成！')
    } catch (error) {
        console.error('❌ 初始化失败:', error)
        process.exit(1)
    } finally {
        await pool.end()
    }
}

main()
