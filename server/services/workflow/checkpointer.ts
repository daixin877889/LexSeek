/**
 * LangGraph 检查点器服务
 *
 * 使用 PostgresSaver 作为 LangGraph 工作流的检查点器
 * 支持工作流状态持久化、中断恢复和故障恢复
 *
 * PostgresSaver 会创建以下表（已在 prisma/models/checkpoint.prisma 中定义）：
 * - checkpoint_migrations: 迁移版本记录
 * - checkpoints: 检查点主表
 * - checkpoint_blobs: 检查点数据块
 * - checkpoint_writes: 检查点写入记录
 *
 * @see Requirements 2.1, 2.2, 11.3
 * @see prisma/models/checkpoint.prisma
 */

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { logger } from '#shared/utils/logger'

// 全局检查点器实例（单例模式）
let checkpointerInstance: PostgresSaver | null = null

// 初始化状态标记
let isInitialized = false
let isInitializing = false

/**
 * 获取数据库连接字符串
 * @returns 数据库连接字符串
 * @throws 如果 DATABASE_URL 未配置
 */
function getDatabaseUrl(): string {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
        throw new Error('DATABASE_URL 环境变量未设置')
    }
    return databaseUrl
}

/**
 * 获取 PostgresSaver 检查点器实例
 *
 * 使用单例模式，确保整个应用只有一个检查点器实例
 * 首次调用时会自动初始化数据库表结构
 *
 * @returns PostgresSaver 实例
 * @throws 如果数据库连接失败
 *
 * @example
 * ```typescript
 * const checkpointer = await getCheckpointer()
 * const graph = builder.compile({ checkpointer })
 * ```
 */
export async function getCheckpointer(): Promise<PostgresSaver> {
    // 如果已有实例且已初始化，直接返回
    if (checkpointerInstance && isInitialized) {
        return checkpointerInstance
    }

    // 如果正在初始化，等待初始化完成
    if (isInitializing) {
        while (isInitializing) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        if (checkpointerInstance && isInitialized) {
            return checkpointerInstance
        }
    }

    try {
        isInitializing = true
        logger.info('初始化 LangGraph PostgresSaver 检查点器...')

        const databaseUrl = getDatabaseUrl()

        // 使用连接字符串创建 PostgresSaver 实例
        checkpointerInstance = PostgresSaver.fromConnString(databaseUrl)

        // 首次使用时初始化数据库表结构
        // setup() 会创建必要的检查点表（如果不存在）
        await checkpointerInstance.setup()

        isInitialized = true
        logger.info('LangGraph PostgresSaver 检查点器初始化完成')

        return checkpointerInstance
    } catch (error) {
        logger.error('LangGraph PostgresSaver 检查点器初始化失败:', error)
        // 重置状态，允许重试
        checkpointerInstance = null
        isInitialized = false
        throw error
    } finally {
        isInitializing = false
    }
}

/**
 * 重置检查点器实例
 *
 * 用于测试或需要重新初始化的场景
 * 注意：这不会删除数据库中的检查点数据
 */
export function resetCheckpointer(): void {
    logger.info('重置 LangGraph PostgresSaver 检查点器实例')
    checkpointerInstance = null
    isInitialized = false
    isInitializing = false
}

/**
 * 获取检查点器状态
 *
 * @returns 检查点器状态信息
 */
export function getCheckpointerStatus(): {
    initialized: boolean
    initializing: boolean
    hasInstance: boolean
} {
    return {
        initialized: isInitialized,
        initializing: isInitializing,
        hasInstance: checkpointerInstance !== null,
    }
}

/**
 * 检查检查点器是否已初始化
 *
 * @returns 是否已初始化
 */
export function isCheckpointerInitialized(): boolean {
    return isInitialized && checkpointerInstance !== null
}
