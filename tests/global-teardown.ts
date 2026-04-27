/**
 * 全局测试清理 - 在所有测试文件结束后运行
 * 使用原生 SQL 按前缀清理所有测试残留数据
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
import pg from 'pg'

config({ path: resolve(__dirname, '.env.testing') })

/** 安全执行：单条查询失败不中断后续清理（外键关系复杂时常见，最终 case_types 等清不掉
 *  也不影响测试结果，只是测试库残留多） */
async function safeQuery(client: pg.Client, sql: string): Promise<void> {
    try {
        await client.query(sql)
    } catch (err) {
        // 用 console.log 而非 console.warn 避免 vitest 误判为 unhandledRejection
        console.log('[teardown] 清理查询跳过：', (err as Error).message?.split('\n')[0])
    }
}

export async function teardown() {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) return

    const client = new pg.Client({ connectionString })

    try {
        await client.connect()

        // 子表先于父表清理（避免 FK 阻塞）
        await safeQuery(client, `DELETE FROM document_drafts WHERE case_id IN (SELECT id FROM cases WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '13%'))`)
        await safeQuery(client, `DELETE FROM case_analyses WHERE case_id IN (SELECT id FROM cases WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '13%'))`)
        await safeQuery(client, `DELETE FROM case_sessions WHERE case_id IN (SELECT id FROM cases WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '13%'))`)
        await safeQuery(client, `DELETE FROM case_materials WHERE case_id IN (SELECT id FROM cases WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '13%'))`)
        await safeQuery(client, `DELETE FROM cases WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '13%' AND name LIKE 'test_%')`)

        // 清理 node 相关
        await safeQuery(client, `DELETE FROM prompts WHERE node_id IN (SELECT id FROM nodes WHERE name LIKE 'test_node_%' OR name LIKE 'node_test_%')`)
        await safeQuery(client, `DELETE FROM level_node_access WHERE node_id IN (SELECT id FROM nodes WHERE name LIKE 'test_node_%' OR name LIKE 'node_test_%')`)
        await safeQuery(client, `DELETE FROM case_analyses WHERE node_id IN (SELECT id FROM nodes WHERE name LIKE 'test_node_%' OR name LIKE 'node_test_%')`)
        await safeQuery(client, `DELETE FROM nodes WHERE name LIKE 'test_node_%' OR name LIKE 'node_test_%'`)
        await safeQuery(client, `DELETE FROM node_groups WHERE name LIKE 'group_test_%'`)

        // 清理 model/provider
        await safeQuery(client, `DELETE FROM models WHERE name LIKE 'test_model_%'`)
        await safeQuery(client, `DELETE FROM model_api_keys WHERE provider_id IN (SELECT id FROM model_providers WHERE name LIKE 'test_provider_%' OR name LIKE '测试提供商_%')`)
        await safeQuery(client, `DELETE FROM model_providers WHERE name LIKE 'test_provider_%' OR name LIKE '测试提供商_%'`)

        // 清理 case_types（之前被引用导致残留）
        await safeQuery(client, `DELETE FROM case_types WHERE name LIKE '测试类型_%'`)

        // 清理 prompts
        await safeQuery(client, `DELETE FROM prompts WHERE name LIKE 'test_%'`)

        console.log('全局测试清理完成')
    } catch (error) {
        console.log('全局测试清理出错（已 swallow，不影响 vitest 退出）：', (error as Error).message)
    } finally {
        try {
            await client.end()
        } catch { /* ignore */ }
    }
}
