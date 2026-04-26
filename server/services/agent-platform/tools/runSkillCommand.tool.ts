/**
 * 执行 Skill 白名单命令工具
 *
 * 工作流工具层 - 在会话 workspace 目录下执行白名单中的外部命令。
 * 用于支持 docx/pptx 等 skill 中"非单文件脚本"的场景：
 *   - `pandoc input.md -o output.docx`           (Markdown ↔ DOCX/HTML)
 *   - `python -m markitdown presentation.pptx`   (PPTX/DOCX/PDF → Markdown)
 *   - `libreoffice --headless --convert-to pdf file.docx`  (DOCX/PPTX → PDF)
 *
 * 与 run_skill_script 的区别：
 *   - run_skill_script：执行 .deepagents/skills/<skill>/scripts/ 下的单文件脚本
 *   - run_skill_command：执行系统 PATH 中的白名单二进制（含 python -m <module>）
 *
 * 安全：
 *   - command 取自固定枚举（无任意命令执行）
 *   - cwd 锁死在 WORKSPACE_BASE/{sessionId}（即使写绝对路径也只在沙箱内）
 *   - Linux 生产环境通过 unshare -rn 切断子进程外网（与 run_skill_script 一致）
 *   - args 数组直接给 execFile，不走 shell（无注入风险）
 *   - 单参数长度上限 4096，参数总数上限 30
 *   - 30s 执行超时 + 35s 兜底超时
 */

import { tool } from '@langchain/core/tools'
import { execFile } from 'node:child_process'
import { z } from 'zod'
import { WORKSPACE_BASE, resolveWorkspaceDir, withTimeout } from './workspace'
import { getPlatform, hasUnshare } from './runSkillScript.tool'
import type { ToolContext, ToolDefinition } from './types'

/** 白名单命令 → execFile 调用的 [binary, prependedArgs] */
const COMMAND_TO_EXEC: Record<string, [string, string[]]> = {
    /** Markdown ↔ DOCX/HTML 转换。需镜像层装 pandoc */
    pandoc: ['pandoc', []],
    /** 文档→Markdown 提取。需镜像层装 python3 + pip install markitdown */
    markitdown: ['python3', ['-m', 'markitdown']],
    /**
     * 任意格式 → PDF / 处理 docx 修订等。需镜像层装 libreoffice + 中文字体。
     * --headless 强制注入；用户的 args 不能再覆写。
     */
    libreoffice: ['libreoffice', ['--headless']],
}

/** 单参数最大长度（防 OOM 和长路径攻击） */
const MAX_ARG_LENGTH = 4096

/** 参数总数上限 */
const MAX_ARG_COUNT = 30

const schema = z.object({
    command: z.enum(['pandoc', 'markitdown', 'libreoffice']).describe(
        '白名单命令：pandoc（MD↔DOCX/HTML）、markitdown（DOC/PPTX/PDF→MD）、libreoffice（任意→PDF/处理修订）',
    ),
    args: z.array(z.string().min(1).max(MAX_ARG_LENGTH))
        .max(MAX_ARG_COUNT)
        .describe('命令参数列表，按位置/标志原样传给二进制；输入输出文件路径需相对 workspace 目录'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'run_skill_command',
    description: '在会话 workspace 目录中运行白名单外部命令（pandoc / markitdown / libreoffice）。'
        + '用于 docx、pptx 等 skill 中需要调用 Python 模块或外部转换器的场景。'
        + '工作目录已锁定为本会话 workspace，文件路径请使用相对路径。'
        + '示例：command="pandoc", args=["input.md", "-o", "output.docx"]',
    schema,
}

/** ENOENT / 找不到二进制时的友好错误前缀 */
const COMMAND_INSTALL_HINT: Record<string, string> = {
    pandoc: 'pandoc 未安装，请联系运维在镜像中加装 pandoc',
    markitdown: 'markitdown 未安装，请联系运维 pip install markitdown',
    libreoffice: 'libreoffice 未安装，请用 WITH_OFFICE=true 重建镜像',
}

/**
 * 创建执行 skill 白名单命令工具
 *
 * @param context 工具上下文（必含 sessionId）
 * @throws 当 sessionId 格式非法时抛出错误
 */
export function createTool(context: ToolContext) {
    const workspaceDir = resolveWorkspaceDir(WORKSPACE_BASE, context.sessionId)

    return tool(
        async ({ command, args }) => {
            // 1. 参数 NULL 字节扫描（防 path traversal via NULL byte）
            for (const arg of args) {
                if (arg.includes('\0')) {
                    return 'Error: 参数包含非法字符（NULL 字节）'
                }
            }

            // 2. 取出二进制和前置参数
            const entry = COMMAND_TO_EXEC[command]
            if (!entry) {
                // schema 已经枚举校验过，理论不会进这里；保留兜底
                return `Error: 未知命令 ${command}`
            }
            const [bin, prefixArgs] = entry

            // 3. 子进程外网隔离（与 run_skill_script 同策略）
            const platform = getPlatform()
            let binary = bin
            let leadingArgs = prefixArgs
            if (platform === 'linux') {
                const ok = await hasUnshare()
                if (!ok) {
                    return 'Error: unshare 不可用，请确认 Docker 基础镜像包含 util-linux 且允许 user namespace'
                }
                binary = 'unshare'
                leadingArgs = ['-rn', bin, ...prefixArgs]
            } else {
                logger.warn('开发环境未启用 skill 子进程外网隔离', { platform, command })
            }

            // 4. 执行环境（与 run_skill_script 对齐：保留必需的 PATH/HOME/LANG，cwd 锁 workspace）
            const execEnv = {
                PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
                HOME: process.env.HOME || '/tmp',
                LANG: process.env.LANG || 'en_US.UTF-8',
                NODE_ENV: 'production',
                WORKSPACE_DIR: workspaceDir,
            }

            try {
                return await withTimeout(
                    new Promise<string>((done) => {
                        execFile(binary, [...leadingArgs, ...args], {
                            timeout: 30_000,
                            cwd: workspaceDir,
                            env: execEnv,
                            // libreoffice / markitdown 输出可能较大，给到 16MB
                            maxBuffer: 16 * 1024 * 1024,
                        }, (err, stdout, stderr) => {
                            if (err) {
                                const errCode = (err as NodeJS.ErrnoException).code
                                if (errCode === 'ENOENT') {
                                    done(`Error: ${COMMAND_INSTALL_HINT[command] ?? `${command} 不在 PATH 中`}`)
                                } else {
                                    done(`Error (exit ${err.code}): ${stderr || err.message}`)
                                }
                            } else {
                                done(stderr ? `${stdout}\n[stderr]: ${stderr}` : stdout)
                            }
                        })
                    }),
                    35_000,
                    `命令 ${command}`,
                )
            } catch (timeoutErr) {
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
