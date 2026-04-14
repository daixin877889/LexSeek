/**
 * run_skill_script 工具测试
 *
 * 测试 skill 脚本执行工具的功能和安全边界
 *
 * **Feature: run-skill-script-tool**
 * **Validates: 脚本执行、路径安全、参数传递、运行时推断**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm, chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createTool, toolDefinition } from '../../../../server/services/workflow/tools/runSkillScript.tool'

/** 测试上下文 */
const testContext = {
    userId: 1,
    caseId: 1,
    sessionId: 'test-session-id',
}

/** 临时测试目录 */
const testSkillsDir = resolve(tmpdir(), 'lexseek-test-run-skill-' + Date.now())

beforeAll(async () => {
    // 创建临时目录结构
    await mkdir(resolve(testSkillsDir, 'demo/scripts'), { recursive: true })

    // 创建 Node.js 测试脚本（.cjs）
    // 读取 action 和 --key value 形式的参数，输出 JSON
    const cjsScript = `const action = process.argv[2]; const args = {}; for(let i=3;i<process.argv.length;i+=2){if(process.argv[i]?.startsWith('--'))args[process.argv[i].slice(2)]=process.argv[i+1]}; console.log(JSON.stringify({action,args,ok:true}))`
    await writeFile(resolve(testSkillsDir, 'demo/scripts/hello.cjs'), cjsScript)

    // 创建 Bash 测试脚本（.sh）
    const shScript = `#!/bin/bash\necho "hello $1"`
    await writeFile(resolve(testSkillsDir, 'demo/scripts/greet.sh'), shScript)
    await chmod(resolve(testSkillsDir, 'demo/scripts/greet.sh'), 0o755)
})

afterAll(async () => {
    // 清理临时目录
    await rm(testSkillsDir, { recursive: true, force: true })
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
