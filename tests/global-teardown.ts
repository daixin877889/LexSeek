/**
 * 全局测试清理 - 在所有测试文件结束后运行
 * 使用原生 SQL 按前缀清理所有测试残留数据
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
import pg from 'pg'

config({ path: resolve(__dirname, '.env.testing') })

export async function teardown() {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) return

    const client = new pg.Client({ connectionString })

    try {
        await client.connect()

        // 清理 node 相关
        await client.query(`
            DELETE FROM prompts WHERE node_id IN (SELECT id FROM nodes WHERE name LIKE 'test_node_%' OR name LIKE 'node_test_%');
            DELETE FROM level_node_access WHERE node_id IN (SELECT id FROM nodes WHERE name LIKE 'test_node_%' OR name LIKE 'node_test_%');
            DELETE FROM case_analyses WHERE node_id IN (SELECT id FROM nodes WHERE name LIKE 'test_node_%' OR name LIKE 'node_test_%');
            DELETE FROM nodes WHERE name LIKE 'test_node_%' OR name LIKE 'node_test_%';
            DELETE FROM node_groups WHERE name LIKE 'group_test_%';
        `)

        // 清理 model/provider
        await client.query(`
            DELETE FROM models WHERE name LIKE 'test_model_%';
            DELETE FROM model_api_keys WHERE provider_id IN (SELECT id FROM model_providers WHERE name LIKE 'test_provider_%' OR name LIKE '测试提供商_%');
            DELETE FROM model_providers WHERE name LIKE 'test_provider_%' OR name LIKE '测试提供商_%';
        `)

        // 清理 case 相关
        await client.query(`DELETE FROM case_types WHERE name LIKE '测试类型_%'`)

        // 清理 prompts
        await client.query(`DELETE FROM prompts WHERE name LIKE 'test_%'`)

        console.log('全局测试清理完成')
    } catch (error) {
        console.warn('全局测试清理出错：', error)
    } finally {
        await client.end()
    }
}
