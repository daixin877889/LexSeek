/**
 * 写入 Skill 文件工具
 *
 * 工作流工具层 - 向 per-session workspace 临时目录写入文件
 * 供 Agent 动态创建脚本和输出文件，支持自动创建子目录
 * 拒绝路径遍历、绝对路径、NULL 字节及非法路径段字符
 */

import { tool } from '@langchain/core/tools'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'

/** workspace 根目录（各 session 的临时工作区） */
const WORKSPACE_BASE = '/tmp/skills-workspace'

/** sessionId 格式校验：只允许字母、数字、下划线、连字符，最长 128 位 */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

/** 路径段白名单：字母、数字、下划线、连字符、点、中文 */
const SAFE_PATH_SEGMENT = /^[\w.\-\u4e00-\u9fff]+$/

/**
 * 校验路径安全性
 *
 * @param filePath 待校验的相对路径
 * @returns 错误描述字符串（无错误则返回 null）
 */
function validatePath(filePath: string): string | null {
    if (filePath.includes('\0')) {
        return 'Error: 路径包含非法字符（NULL 字节）'
    }
    if (filePath.startsWith('/')) {
        return 'Error: 不允许使用绝对路径'
    }
    if (filePath.includes('..')) {
        return 'Error: 不允许路径遍历（..）'
    }
    const segments = filePath.split('/')
    for (const segment of segments) {
        if (!segment) continue
        if (!SAFE_PATH_SEGMENT.test(segment)) {
            return `Error: 路径段 "${segment}" 包含非法字符`
        }
    }
    return null
}

/** 参数 schema（唯一数据源） */
const schema = z.object({
    path: z.string().min(1).describe('目标文件路径（相对于 session workspace 目录），支持子目录，如 output.txt 或 subdir/result.log'),
    content: z.string().max(10 * 1024 * 1024).describe('要写入的文件内容，最大 10MB'),
})

/** 工具定义（单一数据源） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'write_skill_file',
    description: '向当前 session 的 workspace 临时目录写入文件。支持自动创建子目录，已存在的文件将被覆盖。',
    schema,
}

/**
 * 创建写入 skill 文件工具
 *
 * @param context 工具上下文（包含 userId、caseId、sessionId）
 * @param workspaceBase 可选的 workspace 根目录（默认 WORKSPACE_BASE，测试时可覆盖）
 * @returns LangGraph 工具实例
 */
export function createTool(context: ToolContext, workspaceBase?: string) {
    const base = workspaceBase ?? WORKSPACE_BASE

    if (!SESSION_ID_PATTERN.test(context.sessionId)) {
        throw new Error(`无效的 sessionId 格式: ${context.sessionId}`)
    }

    const workspaceDir = resolve(base, context.sessionId)

    return tool(
        async ({ path: filePath, content }) => {
            const pathError = validatePath(filePath)
            if (pathError) {
                return pathError
            }

            const fullPath = resolve(workspaceDir, filePath)

            // resolve 后二次边界检查，防止意外越界
            if (!fullPath.startsWith(workspaceDir + '/')) {
                return 'Error: 路径不在 workspace 目录内'
            }

            try {
                await mkdir(dirname(fullPath), { recursive: true })
                await writeFile(fullPath, content, 'utf-8')
                return `文件已写入: ${fullPath}`
            } catch (error) {
                logger.error('写入 workspace 文件失败:', error)
                return `Error: 写入文件失败 - ${error instanceof Error ? error.message : '未知错误'}`
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
