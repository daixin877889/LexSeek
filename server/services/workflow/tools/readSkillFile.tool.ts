/**
 * 读取 Skill 文件工具
 *
 * 工作流工具层 - 读取 .deepagents/skills 目录或 workspace 目录下的文件内容
 * 支持 SKILL.md、references 等文本文件，以及 _workspace/ 前缀的 session 工作区文件
 * 拒绝路径遍历和二进制文件
 */

import { tool } from '@langchain/core/tools'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'

/** 默认 skills 根目录 */
const DEFAULT_SKILLS_ROOT = resolve(process.cwd(), '.deepagents/skills')

/** workspace 根目录（各 session 的临时工作区） */
const WORKSPACE_BASE = '/tmp/skills-workspace'

/** sessionId 格式校验：只允许字母、数字、下划线、连字符，最长 128 位 */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

/** 允许读取的文本文件扩展名 */
const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.js', '.ts', '.py', '.sh', '.cjs', '.mjs', '.log'])

/** 检查扩展名是否被允许，空扩展名（无后缀文件）视为允许 */
function isAllowedExtension(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return !ext || ALLOWED_EXTENSIONS.has(ext)
}

/** 参数 schema（唯一数据源） */
const schema = z.object({
    path: z.string().min(1).describe('文件路径，如 lexseek/SKILL.md；或 _workspace/output.log 读取 session 工作区文件'),
})

/** 工具定义（单一数据源） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'read_skill_file',
    description: '读取 skill 文件内容（SKILL.md、references 等）；也可通过 _workspace/ 前缀读取当前 session 工作区文件',
    schema,
}

/**
 * 创建读取 skill 文件工具
 *
 * @param context 工具上下文（包含 userId、caseId、sessionId）
 * @param skillsRoot 可选的 skills 根目录（默认 DEFAULT_SKILLS_ROOT，测试时可覆盖）
 * @returns LangGraph 工具实例
 */
export function createTool(context: ToolContext, skillsRoot?: string) {
    const SKILLS_ROOT = skillsRoot ?? DEFAULT_SKILLS_ROOT

    // 校验 sessionId 格式，防止目录遍历
    if (!SESSION_ID_PATTERN.test(context.sessionId)) {
        throw new Error(`无效的 sessionId 格式: ${context.sessionId}`)
    }

    /** 当前 session 的 workspace 目录 */
    const workspaceDir = resolve(WORKSPACE_BASE, context.sessionId)

    return tool(
        async ({ path: filePath }) => {
            // 拒绝路径遍历和绝对路径
            if (filePath.includes('..') || filePath.startsWith('/')) {
                return 'Error: 非法路径'
            }

            // _workspace/ 前缀：从 session workspace 目录读取
            if (filePath.startsWith('_workspace/')) {
                const relativePath = filePath.slice('_workspace/'.length)
                const fullPath = resolve(workspaceDir, relativePath)

                // 二次确认路径在 workspace 目录内（防止 resolve 后越界）
                if (!fullPath.startsWith(workspaceDir + '/') && fullPath !== workspaceDir) {
                    return 'Error: 只允许读取 workspace 目录内的文件'
                }

                if (!isAllowedExtension(relativePath)) {
                    const ext = extname(relativePath).toLowerCase()
                    return `Error: 不支持读取 ${ext} 文件，请使用 upload_workspace_file`
                }

                try {
                    return await readFile(fullPath, 'utf-8')
                } catch {
                    return `Error: 文件不存在 ${filePath}`
                }
            }

            // 默认分支：从 skills 目录读取
            // 规范化路径：移除 createSkillsMiddleware 注入的各种前缀
            // 可能的格式：.deepagents/skills/x/SKILL.md、skills/x/SKILL.md、./skills/x/SKILL.md、x/SKILL.md
            const normalizedPath = filePath.replace(/^(?:\.?\/?)?(?:\.?deepagents\/)?skills\//, '')
            const fullPath = resolve(SKILLS_ROOT, normalizedPath)

            // 二次确认路径在 skills 目录内（防止 resolve 后越界）
            if (!fullPath.startsWith(SKILLS_ROOT + '/') && fullPath !== SKILLS_ROOT) {
                return 'Error: 只允许读取 skills 目录内的文件'
            }

            if (!isAllowedExtension(filePath)) {
                const ext = extname(filePath).toLowerCase()
                return `Error: 不支持读取 ${ext} 文件，仅支持文本文件`
            }

            try {
                return await readFile(fullPath, 'utf-8')
            } catch {
                return `Error: 文件不存在 ${filePath}`
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}

