/**
 * AllowlistedFilesystemBackend 单测
 *
 * **Feature: skills-chinese-name + disabled-skill-blocking**
 *
 * 拦截 ls() 仅在 path 是注册的 skill 父目录时过滤掉非白名单子目录；
 * 其它路径 ls / read / write 等不受影响。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AllowlistedFilesystemBackend } from '~~/server/services/agent-platform/skills/allowlistedFilesystemBackend'

describe('AllowlistedFilesystemBackend', () => {
    let tmpRoot: string
    let skillsParent: string

    beforeEach(() => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'allowlist-be-'))
        skillsParent = join(tmpRoot, 'skills')
        mkdirSync(skillsParent)
        // 建 3 个 skill 子目录
        for (const name of ['allowed_a', 'allowed_b', 'forbidden_c']) {
            mkdirSync(join(skillsParent, name))
            writeFileSync(join(skillsParent, name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
        }
        // 父目录里再放一个普通文件，不应被过滤
        writeFileSync(join(skillsParent, 'README.md'), 'readme')
    })

    afterEach(() => {
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
    })

    it('ls 在 skill 父目录：过滤掉非白名单子目录，文件不动', async () => {
        const backend = new AllowlistedFilesystemBackend({
            rootDir: '/',   // 测试用绝对 path 简化 normalize
            skillParentDirs: new Set([skillsParent]),
            allowedSkillNames: new Set(['allowed_a', 'allowed_b']),
        })

        const result = await backend.ls(skillsParent)
        expect(result.error).toBeFalsy()
        const names = (result.files ?? []).map(f =>
            f.path.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop()
        )
        expect(names).toContain('allowed_a')
        expect(names).toContain('allowed_b')
        expect(names).not.toContain('forbidden_c')
        expect(names).toContain('README.md')   // 文件不受影响
    })

    it('ls 在 skill 父目录 + 末尾斜杠：仍能正确识别父目录并过滤', async () => {
        const backend = new AllowlistedFilesystemBackend({
            rootDir: '/',
            skillParentDirs: new Set([skillsParent]),
            allowedSkillNames: new Set(['allowed_a']),
        })

        const result = await backend.ls(skillsParent + '/')
        const dirNames = (result.files ?? [])
            .filter(f => f.is_dir)
            .map(f => f.path.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop())
        expect(dirNames).toEqual(['allowed_a'])
    })

    it('ls 在非 skill 父目录的路径：不过滤，原样返回', async () => {
        const otherDir = join(tmpRoot, 'other')
        mkdirSync(otherDir)
        mkdirSync(join(otherDir, 'sub_x'))
        const backend = new AllowlistedFilesystemBackend({
            rootDir: '/',
            skillParentDirs: new Set([skillsParent]),   // 只注册 skillsParent
            allowedSkillNames: new Set(['allowed_a']),   // 这个不应影响 other 目录
        })

        const result = await backend.ls(otherDir)
        const names = (result.files ?? []).map(f =>
            f.path.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop()
        )
        expect(names).toEqual(['sub_x'])   // 没被过滤
    })

    it('allowedSkillNames 为空集合时：skill 父目录下所有目录都被过滤', async () => {
        const backend = new AllowlistedFilesystemBackend({
            rootDir: '/',
            skillParentDirs: new Set([skillsParent]),
            allowedSkillNames: new Set([]),
        })

        const result = await backend.ls(skillsParent)
        const dirCount = (result.files ?? []).filter(f => f.is_dir).length
        expect(dirCount).toBe(0)
        // 但文件（README.md）不受影响
        const files = (result.files ?? []).filter(f => !f.is_dir)
        expect(files.length).toBeGreaterThanOrEqual(1)
    })
})
