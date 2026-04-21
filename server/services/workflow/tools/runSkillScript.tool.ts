/**
 * 执行 Skill 脚本工具
 *
 * 工作流工具层 - 执行 .deepagents/skills 目录下 skill 的脚本文件
 * 支持 Node.js（.js/.cjs/.mjs）、Python（.py）、Bash（.sh）
 * 使用 execFile 执行（非 exec，不经过 shell），30s 超时
 *
 * 特殊 skillName "_workspace"：从会话专属工作目录执行脚本，
 * 工作目录为 WORKSPACE_BASE/{sessionId}，脚本直接放在目录根部。
 */

import { tool } from '@langchain/core/tools'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { z } from 'zod'
import { WORKSPACE_BASE, resolveWorkspaceDir, withTimeout } from './workspace'
import type { ToolContext, ToolDefinition } from './types'

const DEFAULT_SKILLS_ROOT = resolve(process.cwd(), '.deepagents/skills')

/** 项目依赖目录，供子进程 NODE_PATH 使用 */
const PROJECT_NODE_MODULES = resolve(process.cwd(), 'node_modules')

/**
 * 获取当前平台（导出为函数以便 vitest 用 vi.spyOn 替换；
 * 直接 `process.platform` 是 getter 在 Node 中不可 mock）
 */
export function getPlatform(): NodeJS.Platform {
    return process.platform
}

/** unshare 探测缓存（模块级；测试可用 _resetUnshareDetection 清零） */
let _unshareCache: Promise<boolean> | null = null

/**
 * 探测 unshare 命令是否可用（Linux 生产环境依赖）。
 *
 * 用 `unshare -rn echo ok` 尝试创建 user namespace + network namespace，
 * 成功返回 true；失败（命令缺失、权限不足、PSP 拦截）返回 false。
 * 结果缓存在模块级 Promise，启动后只探测一次。
 */
export async function hasUnshare(): Promise<boolean> {
    if (_unshareCache) return _unshareCache
    _unshareCache = new Promise<boolean>((done) => {
        execFile('unshare', ['-rn', 'echo', 'ok'], { timeout: 3000 }, (err) => {
            done(!err)
        })
    })
    return _unshareCache
}

/** 测试用：重置 unshare 探测缓存（仅测试调用；生产不应使用） */
export function _resetUnshareDetection(): void {
    _unshareCache = null
}

/** 支持的文件扩展名 → 运行时二进制映射 */
const EXT_TO_RUNTIME: Record<string, string> = {
    js: 'node',
    cjs: 'node',
    mjs: 'node',
    py: 'python3',
    sh: 'bash',
}

const schema = z.object({
    skillName: z.string().describe('Skill 名称，如 lexseek；特殊值 _workspace 表示从会话工作目录执行脚本'),
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
 * @throws 当 sessionId 格式非法时抛出错误
 */
export function createTool(context: ToolContext, skillsRoot?: string) {
    const SKILLS_ROOT = skillsRoot ?? DEFAULT_SKILLS_ROOT
    const workspaceDir = resolveWorkspaceDir(WORKSPACE_BASE, context.sessionId)

    return tool(
        async ({ skillName, scriptName, action, args }) => {
            // 白名单字符校验：只允许字母、数字、下划线、点、连字符
            const SAFE_NAME = /^[a-zA-Z0-9_.-]+$/
            if (![skillName, scriptName, action].every(s => SAFE_NAME.test(s))) {
                return 'Error: 参数中包含非法字符'
            }

            // args key/value 安全校验
            if (args) {
                const SAFE_ARG_KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
                for (const [key, value] of Object.entries(args)) {
                    if (!SAFE_ARG_KEY.test(key)) {
                        return `Error: 参数名 "${key}" 包含非法字符`
                    }
                    if (value.length > 4096) {
                        return 'Error: 参数值过长（最大 4096 字符）'
                    }
                }
            }

            // 扩展名校验先于路径构造，避免用"文件不存在"掩盖类型错误
            const ext = scriptName.split('.').pop()?.toLowerCase() ?? ''
            const runtimeBin = EXT_TO_RUNTIME[ext]
            if (!runtimeBin) {
                return `Error: 不支持的脚本类型 .${ext}，仅支持 .js/.cjs/.mjs/.py/.sh`
            }

            let scriptsDir: string
            let scriptPath: string
            let errorPrefix: string

            if (skillName === '_workspace') {
                scriptsDir = workspaceDir
                scriptPath = resolve(scriptsDir, scriptName)
                errorPrefix = `_workspace/${scriptName}`

                if (!scriptPath.startsWith(workspaceDir + '/')) {
                    return `Error: 脚本不存在 ${errorPrefix}`
                }
            } else {
                scriptsDir = resolve(SKILLS_ROOT, skillName, 'scripts')
                scriptPath = resolve(scriptsDir, scriptName)
                errorPrefix = `${skillName}/scripts/${scriptName}`

                // startsWith 校验防止 resolve 后路径逃逸至 skills 根之外
                if (!scriptPath.startsWith(SKILLS_ROOT + '/')) {
                    return `Error: 脚本不存在 ${errorPrefix}`
                }
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
                NODE_PATH: PROJECT_NODE_MODULES,
                WORKSPACE_DIR: workspaceDir,
            }

            // 子进程外网隔离：Linux 生产用 `unshare -rn` 包装（切断网卡），
            // macOS 开发环境裸跑并一次性 warn（攻击面限于开发机，可接受）
            const platform = getPlatform()
            let binary = runtimeBin
            let prepended: string[] = []
            if (platform === 'linux') {
                const ok = await hasUnshare()
                if (!ok) {
                    return 'Error: unshare 不可用，请确认 Docker 基础镜像包含 util-linux 且允许 user namespace'
                }
                binary = 'unshare'
                prepended = ['-rn', runtimeBin]
            } else {
                logger.warn('开发环境未启用 skill 子进程外网隔离', { platform })
            }

            try {
                return await withTimeout(
                    new Promise<string>((done) => {
                        execFile(binary, [...prepended, ...execArgs], { timeout: 30_000, cwd: scriptsDir, env: execEnv },
                            (err, stdout, stderr) => {
                                if (err) {
                                    // ENOENT（运行时找不到）或 MODULE_NOT_FOUND（node 运行不存在的脚本）均视为脚本不存在
                                    const errCode = (err as NodeJS.ErrnoException).code
                                    if (errCode === 'ENOENT' || errCode === 'MODULE_NOT_FOUND'
                                        || stderr.includes('Cannot find module')) {
                                        done(`Error: 脚本不存在 ${errorPrefix}`)
                                    } else {
                                        done(`Error (exit ${err.code}): ${stderr || err.message}`)
                                    }
                                } else {
                                    done(stderr ? `${stdout}\n[stderr]: ${stderr}` : stdout)
                                }
                            })
                    }),
                    35_000, // 比 execFile 内置超时多 5s
                    `脚本 ${scriptName}`,
                )
            } catch (timeoutErr) {
                // 保持工具层"永远返回字符串"的约定
                const message = timeoutErr instanceof Error ? timeoutErr.message : '执行超时'
                return `Error: ${message}`
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
