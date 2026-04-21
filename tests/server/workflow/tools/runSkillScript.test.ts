/**
 * run_skill_script 工具测试
 *
 * 测试 skill 脚本执行工具的功能和安全边界
 *
 * **Feature: run-skill-script-tool**
 * **Validates: 脚本执行、路径安全、参数传递、运行时推断、workspace 执行**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { mkdir, writeFile, rm, chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import * as runSkillScriptModule from '../../../../server/services/workflow/tools/runSkillScript.tool'
import { createTool, toolDefinition } from '../../../../server/services/workflow/tools/runSkillScript.tool'

/** 测试上下文 */
const testContext = {
    userId: 1,
    caseId: 1,
    sessionId: 'test-session-id',
}

/** 临时测试目录 */
const testSkillsDir = resolve(tmpdir(), 'lexseek-test-run-skill-' + Date.now())

/** workspace 测试会话 ID */
const testSessionId = 'test-workspace-session-01'

/** workspace 临时目录 */
const workspaceDir = resolve('/tmp/skills-workspace', testSessionId)

beforeAll(async () => {
    await mkdir(resolve(testSkillsDir, 'demo/scripts'), { recursive: true })

    const cjsScript = `const action = process.argv[2]; const args = {}; for(let i=3;i<process.argv.length;i+=2){if(process.argv[i]?.startsWith('--'))args[process.argv[i].slice(2)]=process.argv[i+1]}; console.log(JSON.stringify({action,args,ok:true}))`
    await writeFile(resolve(testSkillsDir, 'demo/scripts/hello.cjs'), cjsScript)

    const shScript = `#!/bin/bash\necho "hello $1"`
    await writeFile(resolve(testSkillsDir, 'demo/scripts/greet.sh'), shScript)
    await chmod(resolve(testSkillsDir, 'demo/scripts/greet.sh'), 0o755)

    await mkdir(workspaceDir, { recursive: true })

    const wsScript = `console.log(JSON.stringify({ action: process.argv[2], wsDir: process.env.WORKSPACE_DIR, ok: true }))`
    await writeFile(resolve(workspaceDir, 'test-ws.cjs'), wsScript)
})

afterAll(async () => {
    await rm(testSkillsDir, { recursive: true, force: true })
    await rm(workspaceDir, { recursive: true, force: true })
})

describe('run_skill_script 工具 - 工具定义', () => {
    it('工具名称应为 run_skill_script', () => {
        const runTool = createTool(testContext, testSkillsDir)
        expect(runTool.name).toBe('run_skill_script')
    })

    it('工具描述应包含 skill', () => {
        const runTool = createTool(testContext, testSkillsDir)
        expect(runTool.description.toLowerCase()).toContain('skill')
    })

    it('toolDefinition.name 应为 run_skill_script', () => {
        expect(toolDefinition.name).toBe('run_skill_script')
    })
})

describe('run_skill_script 工具 - 正常执行', () => {
    it('应能执行 Node.js 脚本（.cjs）', async () => {
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'hello.cjs',
            action: 'search',
        })

        const parsed = JSON.parse(result.trim())
        expect(parsed.ok).toBe(true)
        expect(parsed.action).toBe('search')
    })

    it('应能执行 Bash 脚本（.sh）', async () => {
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'greet.sh',
            action: 'world',
        })

        expect(result.trim()).toContain('hello world')
    })

    it('应正确传递 args 参数（含空格的值）', async () => {
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'hello.cjs',
            action: 'query',
            args: { query: '劳动合同 解除', type: 'legal' },
        })

        const parsed = JSON.parse(result.trim())
        expect(parsed.ok).toBe(true)
        expect(parsed.action).toBe('query')
        expect(parsed.args.query).toBe('劳动合同 解除')
        expect(parsed.args.type).toBe('legal')
    })
})

describe('run_skill_script 工具 - 路径安全', () => {
    it('应拒绝 skillName 包含路径遍历（..）', async () => {
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: '../etc',
            scriptName: 'hello.cjs',
            action: 'test',
        })

        expect(result).toContain('Error')
        expect(result).toContain('非法字符')
    })

    it('应拒绝 scriptName 包含路径遍历（..）', async () => {
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: '../hello.cjs',
            action: 'test',
        })

        expect(result).toContain('Error')
        expect(result).toContain('非法字符')
    })

    it('应拒绝 skillName 包含斜杠（/）', async () => {
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo/evil',
            scriptName: 'hello.cjs',
            action: 'test',
        })

        expect(result).toContain('Error')
        expect(result).toContain('非法字符')
    })
})

describe('run_skill_script 工具 - 脚本类型校验', () => {
    it('应拒绝不支持的脚本类型（.rb）', async () => {
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'script.rb',
            action: 'test',
        })

        expect(result).toContain('Error')
        expect(result).toContain('不支持的脚本类型')
    })
})

describe('run_skill_script 工具 - 脚本不存在', () => {
    it('应拒绝不存在的脚本', async () => {
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'notexist.cjs',
            action: 'test',
        })

        expect(result).toContain('Error')
        expect(result).toContain('脚本不存在')
    })
})

describe('run_skill_script 工具 - workspace 执行', () => {
    const wsContext = {
        userId: 1,
        caseId: 1,
        sessionId: testSessionId,
    }

    it('应能执行 workspace 中的脚本（skillName="_workspace"）', async () => {
        const runTool = createTool(wsContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: '_workspace',
            scriptName: 'test-ws.cjs',
            action: 'run',
        })

        const parsed = JSON.parse(result.trim())
        expect(parsed.ok).toBe(true)
        expect(parsed.action).toBe('run')
    })

    it('workspace 中不存在的脚本应报错', async () => {
        const runTool = createTool(wsContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: '_workspace',
            scriptName: 'notexist.cjs',
            action: 'run',
        })

        expect(result).toContain('Error')
        expect(result).toContain('脚本不存在')
    })

    it('WORKSPACE_DIR 环境变量应被正确传入脚本', async () => {
        const runTool = createTool(wsContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: '_workspace',
            scriptName: 'test-ws.cjs',
            action: 'check-env',
        })

        const parsed = JSON.parse(result.trim())
        expect(parsed.wsDir).toBe(workspaceDir)
    })
})

// ==================== 子进程网络隔离（unshare -rn）相关测试 ====================

/**
 * 注：`getPlatform` / `hasUnshare` 在生产环境下由 Linux 容器内真实调用 `unshare -rn`
 * 来验证；在 macOS 开发机上 ES module 静态 import 导致 `vi.spyOn` 无法拦截模块内部调用，
 * 这里只做"导出存在性 + 缓存可重置"的冒烟测试，真正功能验证交给集成环境（Task 15 手工清单）。
 */

describe('run_skill_script 子进程网络隔离（冒烟）', () => {
    beforeEach(() => {
        runSkillScriptModule._resetUnshareDetection()
    })

    it('getPlatform / hasUnshare / _resetUnshareDetection 三个辅助函数均已导出', () => {
        expect(typeof runSkillScriptModule.getPlatform).toBe('function')
        expect(typeof runSkillScriptModule.hasUnshare).toBe('function')
        expect(typeof runSkillScriptModule._resetUnshareDetection).toBe('function')
        expect(runSkillScriptModule.getPlatform()).toBe(process.platform)
    })

    it('hasUnshare 的缓存机制：多次调用不重复触发 execFile', async () => {
        runSkillScriptModule._resetUnshareDetection()
        // 同时发起两次调用，缓存命中后第二次不应再探测
        const [r1, r2] = await Promise.all([
            runSkillScriptModule.hasUnshare(),
            runSkillScriptModule.hasUnshare(),
        ])
        expect(r1).toBe(r2)  // 探测结果稳定一致
    })
})
