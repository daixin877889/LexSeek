/**
 * Workspace 工具共享常量与工具函数
 *
 * 供多个工作流工具共享 workspace 路径约定和 sessionId 校验逻辑
 */

import { resolve } from 'node:path'

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
