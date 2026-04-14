/**
 * 执行 Skill 脚本工具
 *
 * 工作流工具层 - 执行 .deepagents/skills 目录下 skill 的脚本文件
 * 支持 Node.js（.js/.cjs/.mjs）、Python（.py）、Bash（.sh）
 * 使用 execFile 执行（非 exec，不经过 shell），30s 超时
 */

import { tool } from '@langchain/core/tools'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'

const DEFAULT_SKILLS_ROOT = resolve(process.cwd(), '.deepagents/skills')

/** 支持的文件扩展名 → 运行时二进制映射 */
const EXT_TO_RUNTIME: Record<string, string> = {
    js: 'node',
    cjs: 'node',
    mjs: 'node',
    py: 'python3',
    sh: 'bash',
}

const schema = z.object({
    skillName: z.string().describe('Skill 名称，如 lexseek'),
    scriptName: z.string().describe('脚本文件名，如 lexseek.cjs、extract.py、setup.sh'),
    action: z.string().describe('操作名称，如 search, login（作为第一个参数传入脚本）'),
    args: z.record(z.string(), z.string()).optional().describe('参数键值对，如 { query: "关键词" }'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'run_skill_script',
    description: '执行 skill 脚本。示例：skillName=lexseek, scriptName=lexseek.cjs, action=search, args={query: "劳动合同 解除"}',
    schema,
}

/**
 * 创建执行 skill 脚本工具
 *
 * @param context 工具上下文（包含 userId、caseId、sessionId）
 * @param skillsRoot 可选的 skills 根目录（默认 DEFAULT_SKILLS_ROOT，测试时可覆盖）
 */
export function createTool(context: ToolContext, skillsRoot?: string) {
    const SKILLS_ROOT = skillsRoot ?? DEFAULT_SKILLS_ROOT

    return tool(
        async ({ skillName, scriptName, action, args }) => {
            // 禁止路径遍历字符和斜杠，防止目录逃逸
            if ([skillName, scriptName, action].some(s => s.includes('..') || s.includes('/'))) {
                return 'Error: 参数中包含非法字符'
            }

            // 扩展名校验先于路径构造，避免用"文件不存在"掩盖类型错误
            const ext = scriptName.split('.').pop()?.toLowerCase() ?? ''
            const runtimeBin = EXT_TO_RUNTIME[ext]
            if (!runtimeBin) {
                return `Error: 不支持的脚本类型 .${ext}，仅支持 .js/.cjs/.mjs/.py/.sh`
            }

            const scriptsDir = resolve(SKILLS_ROOT, skillName, 'scripts')
            const scriptPath = resolve(scriptsDir, scriptName)

            // startsWith 校验防止 resolve 后路径逃逸至 skills 根之外
            if (!scriptPath.startsWith(SKILLS_ROOT + '/')) {
                return `Error: 脚本不存在 ${skillName}/scripts/${scriptName}`
            }

            const execArgs = [scriptPath, action]
            for (const [key, value] of Object.entries(args ?? {})) {
                execArgs.push(`--${key}`, value)
            }

            const execEnv = {
                PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
                HOME: process.env.HOME || '/tmp',
                LANG: process.env.LANG || 'en_US.UTF-8',
                NODE_ENV: 'production',
                NODE_PATH: process.env.NODE_PATH || '',
            }

            return new Promise<string>((done) => {
                execFile(runtimeBin, execArgs, { timeout: 30_000, cwd: scriptsDir, env: execEnv },
                    (err, stdout, stderr) => {
                        if (err) {
                            // ENOENT（运行时找不到）或 MODULE_NOT_FOUND（node 运行不存在的脚本）均视为脚本不存在
                            const errCode = (err as NodeJS.ErrnoException).code
                            if (errCode === 'ENOENT' || errCode === 'MODULE_NOT_FOUND'
                                || stderr.includes('Cannot find module')) {
                                done(`Error: 脚本不存在 ${skillName}/scripts/${scriptName}`)
                            } else {
                                done(`Error (exit ${err.code}): ${stderr || err.message}`)
                            }
                        } else {
                            done(stderr ? `${stdout}\n[stderr]: ${stderr}` : stdout)
                        }
                    })
            })
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
