/**
 * read_skill_file 工具测试
 *
 * 测试 skill 文件读取工具的功能和安全边界
 *
 * **Feature: read-skill-file-tool**
 * **Validates: 文件读取、路径安全、扩展名过滤**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createTool } from '../../../../server/services/workflow/tools/readSkillFile.tool'

/** 测试上下文 */
const testContext = {
    userId: 1,
    caseId: 1,
    sessionId: 'test-session-id',
}

/** 临时测试目录 */
const testSkillsDir = resolve(tmpdir(), 'lexseek-test-skills-' + Date.now())

beforeAll(async () => {
    // 创建临时目录结构
    await mkdir(resolve(testSkillsDir, 'lexseek'), { recursive: true })
    await mkdir(resolve(testSkillsDir, 'lexseek/references'), { recursive: true })

    // 创建测试文件
    await writeFile(resolve(testSkillsDir, 'lexseek/SKILL.md'), '# LexSeek Skill\n\n这是技能说明文件。')
    await writeFile(resolve(testSkillsDir, 'lexseek/references/legal-analysis.md'), '# 法律分析参考\n\n参考内容。')
    await writeFile(resolve(testSkillsDir, 'lexseek/config.json'), JSON.stringify({ version: '1.0' }))
})

afterAll(async () => {
    // 清理临时目录
    await rm(testSkillsDir, { recursive: true, force: true })
})

describe('read_skill_file 工具 - 正常读取', () => {
    it('应能读取 SKILL.md 文件', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'lexseek/SKILL.md' })

        expect(result).toContain('# LexSeek Skill')
        expect(result).toContain('这是技能说明文件。')
    })

    it('应能通过 .deepagents/skills/ 前缀路径读取（createSkillsMiddleware 注入格式）', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: '.deepagents/skills/lexseek/SKILL.md' })

        expect(result).toContain('# LexSeek Skill')
    })

    it('应能通过 skills/ 前缀路径读取', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'skills/lexseek/SKILL.md' })

        expect(result).toContain('# LexSeek Skill')
    })

    it('应能读取 references 下的 .md 文件', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'lexseek/references/legal-analysis.md' })

        expect(result).toContain('# 法律分析参考')
        expect(result).toContain('参考内容。')
    })

    it('应能读取 JSON 文件', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'lexseek/config.json' })

        expect(result).toContain('"version"')
        expect(result).toContain('"1.0"')
    })
})

describe('read_skill_file 工具 - 路径安全', () => {
    it('应拒绝路径遍历（包含 ..）', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: '../../../etc/passwd' })

        expect(result).toContain('Error')
        expect(result).toContain('非法路径')
    })

    it('应拒绝绝对路径（以 / 开头）', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: '/etc/passwd' })

        expect(result).toContain('Error')
        expect(result).toContain('非法路径')
    })

    it('应拒绝路径遍历变体（中间包含 ..）', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'lexseek/../../../etc/passwd' })

        expect(result).toContain('Error')
    })
})

describe('read_skill_file 工具 - 文件不存在', () => {
    it('应处理不存在的文件', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'lexseek/not-exist.md' })

        expect(result).toContain('Error')
        expect(result).toContain('文件不存在')
    })
})

describe('read_skill_file 工具 - 文件类型过滤', () => {
    it('应拒绝二进制文件扩展名 .png', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'lexseek/image.png' })

        expect(result).toContain('Error')
        expect(result).toContain('不支持读取')
    })

    it('应拒绝 .exe 文件', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'lexseek/binary.exe' })

        expect(result).toContain('Error')
        expect(result).toContain('不支持读取')
    })

    it('应拒绝 .pdf 文件', async () => {
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'lexseek/document.pdf' })

        expect(result).toContain('Error')
        expect(result).toContain('不支持读取')
    })
})

describe('read_skill_file 工具 - 工具定义', () => {
    it('工具名称应为 read_skill_file', () => {
        const readTool = createTool(testContext, testSkillsDir)
        expect(readTool.name).toBe('read_skill_file')
    })

    it('工具描述应包含 skill', () => {
        const readTool = createTool(testContext, testSkillsDir)
        expect(readTool.description.toLowerCase()).toContain('skill')
    })
})

describe('read_skill_file 工具 - workspace 读取', () => {
    /** 使用固定的测试 sessionId，保证与 WORKSPACE_BASE 结合后指向临时目录 */
    const testSessionId = 'test-workspace-session-' + Date.now()

    /** workspace 根目录（与 WORKSPACE_BASE 常量保持一致） */
    const workspaceBase = '/tmp/skills-workspace'

    /** 当前 session 的 workspace 目录 */
    const workspaceDir = resolve(workspaceBase, testSessionId)

    /** workspace 测试上下文 */
    const workspaceContext = {
        userId: 1,
        caseId: 1,
        sessionId: testSessionId,
    }

    beforeAll(async () => {
        // 创建 workspace 目录并写入测试文件
        await mkdir(workspaceDir, { recursive: true })
        await writeFile(resolve(workspaceDir, 'output.log'), '分析完成\n共处理 42 条记录')
    })

    afterAll(async () => {
        // 清理 workspace 临时目录
        await rm(workspaceDir, { recursive: true, force: true })
    })

    it('应能通过 _workspace/output.log 路径读取 workspace 文件', async () => {
        const readTool = createTool(workspaceContext, testSkillsDir)
        const result = await readTool.invoke({ path: '_workspace/output.log' })

        expect(result).toContain('分析完成')
        expect(result).toContain('42')
    })

    it('应拒绝 _workspace/result.pptx（二进制扩展名）', async () => {
        const readTool = createTool(workspaceContext, testSkillsDir)
        const result = await readTool.invoke({ path: '_workspace/result.pptx' })

        expect(result).toContain('Error')
        expect(result).toContain('请使用 upload_workspace_file')
    })

    it('应拒绝 _workspace/../../../etc/passwd（路径遍历）', async () => {
        const readTool = createTool(workspaceContext, testSkillsDir)
        const result = await readTool.invoke({ path: '_workspace/../../../etc/passwd' })

        expect(result).toContain('Error')
    })
})
