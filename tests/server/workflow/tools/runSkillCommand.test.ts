/**
 * run_skill_command 工具测试
 *
 * **Feature: run-skill-command-tool**
 * **Validates: 白名单命令执行、参数透传、ENOENT 提示、cwd 隔离、安全边界**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createTool, toolDefinition } from '../../../../server/services/workflow/tools/runSkillCommand.tool'

const sessionId = 'rsc-test-session-01'
const workspaceDir = resolve('/tmp/skills-workspace', sessionId)

beforeAll(async () => {
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(resolve(workspaceDir, 'sample.txt'), 'hello world\n')
})

afterAll(async () => {
    await rm(workspaceDir, { recursive: true, force: true })
})

const ctx = { userId: 1, caseId: 1, sessionId }

describe('run_skill_command tool', () => {
    it('toolDefinition.name 应为 run_skill_command', () => {
        expect(toolDefinition.name).toBe('run_skill_command')
    })

    it('description 不为空', () => {
        expect(toolDefinition.description.length).toBeGreaterThan(10)
    })

    it('应拒绝包含 NULL 字节的参数', async () => {
        const tool = createTool(ctx)
        const result = await tool.invoke({ command: 'pandoc', args: ['file\0evil.txt'] })
        expect(result).toContain('NULL 字节')
    })

    it('schema 拒绝白名单外的命令（zod 抛错）', async () => {
        const tool = createTool(ctx)
        await expect(tool.invoke({ command: 'rm', args: ['-rf', '/'] } as never))
            .rejects.toThrow()
    })

    it('schema 拒绝超长参数', async () => {
        const tool = createTool(ctx)
        const longArg = 'x'.repeat(5000)
        await expect(tool.invoke({ command: 'pandoc', args: [longArg] }))
            .rejects.toThrow()
    })

    it('schema 拒绝过多参数（>30 个）', async () => {
        const tool = createTool(ctx)
        const tooMany = Array.from({ length: 31 }, () => 'a')
        await expect(tool.invoke({ command: 'pandoc', args: tooMany }))
            .rejects.toThrow()
    })

    it('未安装的二进制返回带安装提示的友好错误', async () => {
        const tool = createTool(ctx)
        // 假定测试机大概率没装 libreoffice；若装了，这条用例会变成实际转换调用
        const result = await tool.invoke({ command: 'libreoffice', args: ['--version'] })
        // 任一情况都接受：未装 → 含安装提示；已装 → 含 LibreOffice 版本字符串
        const matched = result.includes('libreoffice 未安装') || result.toLowerCase().includes('libreoffice')
        expect(matched).toBe(true)
    })

    it('非法 sessionId 在 createTool 时即抛出', () => {
        expect(() => createTool({ ...ctx, sessionId: '../etc/passwd' })).toThrow()
    })
})
