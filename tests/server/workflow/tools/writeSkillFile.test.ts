/**
 * write_skill_file 工具测试
 *
 * 测试向 per-session workspace 临时目录写入文件的功能和安全边界
 *
 * **Feature: write-skill-file-tool**
 * **Validates: 文件写入、子目录自动创建、覆盖语义、路径安全校验**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createTool, toolDefinition } from '../../../../server/services/workflow/tools/writeSkillFile.tool'

/** 临时 workspace 根目录（替代 WORKSPACE_BASE，隔离测试） */
const testWorkspaceBase = resolve(tmpdir(), 'lexseek-test-write-workspace-' + Date.now())

/** 测试 sessionId */
const testSessionId = 'test-write-session-abc123'

/** workspace 目录（sessionId 子目录） */
const testWorkspaceDir = resolve(testWorkspaceBase, testSessionId)

/** 测试上下文 */
const testContext = {
    userId: 1,
    caseId: 1,
    sessionId: testSessionId,
}

beforeAll(async () => {
    // 提前创建 workspace 根目录（子目录由工具自行创建）
    await mkdir(testWorkspaceBase, { recursive: true })
})

afterAll(async () => {
    // 清理全部临时目录
    await rm(testWorkspaceBase, { recursive: true, force: true })
})

describe('write_skill_file 工具 - 正常写入', () => {
    it('应能写入文件到 workspace', async () => {
        const writeTool = createTool(testContext, testWorkspaceBase)
        const result = await writeTool.invoke({ path: 'output.txt', content: '写入测试内容' })

        expect(result).toContain('文件已写入')
        // 验证文件确实存在且内容正确
        const written = await readFile(resolve(testWorkspaceDir, 'output.txt'), 'utf-8')
        expect(written).toBe('写入测试内容')
    })

    it('应能写入子目录文件（自动创建目录）', async () => {
        const writeTool = createTool(testContext, testWorkspaceBase)
        const result = await writeTool.invoke({ path: 'subdir/nested/result.log', content: '子目录内容' })

        expect(result).toContain('文件已写入')
        const written = await readFile(resolve(testWorkspaceDir, 'subdir/nested/result.log'), 'utf-8')
        expect(written).toBe('子目录内容')
    })

    it('应覆盖已存在的文件', async () => {
        const writeTool = createTool(testContext, testWorkspaceBase)
        // 先写入初始内容
        await writeTool.invoke({ path: 'overwrite.txt', content: '旧内容' })
        // 再次覆盖
        const result = await writeTool.invoke({ path: 'overwrite.txt', content: '新内容' })

        expect(result).toContain('文件已写入')
        const written = await readFile(resolve(testWorkspaceDir, 'overwrite.txt'), 'utf-8')
        expect(written).toBe('新内容')
    })
})

describe('write_skill_file 工具 - 路径安全', () => {
    it('应拒绝路径遍历（包含 ..）', async () => {
        const writeTool = createTool(testContext, testWorkspaceBase)
        const result = await writeTool.invoke({ path: '../../../tmp/evil.txt', content: '恶意内容' })

        expect(result).toContain('Error')
    })

    it('应拒绝绝对路径（以 / 开头）', async () => {
        const writeTool = createTool(testContext, testWorkspaceBase)
        const result = await writeTool.invoke({ path: '/tmp/evil.txt', content: '恶意内容' })

        expect(result).toContain('Error')
    })

    it('应拒绝 NULL 字节路径', async () => {
        const writeTool = createTool(testContext, testWorkspaceBase)
        const result = await writeTool.invoke({ path: 'file\x00.txt', content: '恶意内容' })

        expect(result).toContain('Error')
    })

    it('应拒绝路径段含非法字符（* 通配符）', async () => {
        const writeTool = createTool(testContext, testWorkspaceBase)
        const result = await writeTool.invoke({ path: 'bad*file.txt', content: '内容' })

        expect(result).toContain('Error')
    })

    it('应拒绝路径段含非法字符（? 通配符）', async () => {
        const writeTool = createTool(testContext, testWorkspaceBase)
        const result = await writeTool.invoke({ path: 'bad?file.txt', content: '内容' })

        expect(result).toContain('Error')
    })
})

describe('write_skill_file 工具 - 工具定义', () => {
    it('工具名应为 write_skill_file', () => {
        const writeTool = createTool(testContext, testWorkspaceBase)
        expect(writeTool.name).toBe('write_skill_file')
    })

    it('toolDefinition.name 应为 write_skill_file', () => {
        expect(toolDefinition.name).toBe('write_skill_file')
    })

    it('工具描述应不为空', () => {
        expect(toolDefinition.description.length).toBeGreaterThan(0)
    })
})
