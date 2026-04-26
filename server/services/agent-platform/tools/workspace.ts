/**
 * Workspace 工具共享常量与工具函数
 *
 * 供多个工作流工具共享 workspace 路径约定和 sessionId 校验逻辑
 */

import { resolve } from 'node:path'
import { readdir, stat, rm } from 'node:fs/promises'

/** workspace 根目录（各 session 的临时工作区） */
export const WORKSPACE_BASE = '/tmp/skills-workspace'

/** sessionId 格式校验：只允许字母、数字、下划线、连字符，最长 128 位 */
export const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

/**
 * 解析 session workspace 目录路径
 *
 * @param base workspace 根目录
 * @param sessionId 会话 ID
 * @returns session 专属目录绝对路径
 * @throws 如果 sessionId 格式非法
 */
export function resolveWorkspaceDir(base: string, sessionId: string): string {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
        throw new Error(`无效的 sessionId 格式: ${sessionId}`)
    }
    return resolve(base, sessionId)
}

/** workspace 最大存活时间（24 小时） */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * 清理超过 24 小时无活动的 workspace 目录
 *
 * 由 cron-scheduler 每小时调用一次作为兜底清理
 */
export async function cleanExpiredWorkspacesService(): Promise<void> {
    try {
        const entries = await readdir(WORKSPACE_BASE, { withFileTypes: true })
        const now = Date.now()

        for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const dirPath = resolve(WORKSPACE_BASE, entry.name)
            const dirStat = await stat(dirPath)

            if (now - dirStat.mtimeMs > MAX_AGE_MS) {
                await rm(dirPath, { recursive: true, force: true })
                logger.info('清理过期 skills workspace', { dir: entry.name })
            }
        }
    } catch (err) {
        // WORKSPACE_BASE 不存在时静默跳过（正常情况，没有 workspace 被创建）
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.warn('skills workspace 清理失败', { error: err })
        }
    }
}

/**
 * Promise 级兜底超时包装器
 *
 * 防止 execFile 等异步调用在极端情况下 callback 不触发导致 Promise 永远 pending。
 * 超时后立即 reject，让 agent 收到错误字符串继续推进。
 */
export function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${label} 执行超时（${ms / 1000}s）`)),
            ms,
        )
        promise
            .then(resolve, reject)
            .finally(() => clearTimeout(timer))
    })
}
