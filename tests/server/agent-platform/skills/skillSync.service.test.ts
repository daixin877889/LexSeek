import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
    scanAndSyncSkillsService,
    parseSkillFrontmatterFromMarkdown,
} from '~~/server/services/agent-platform/skills/skillSync.service'
import { SkillSource, SkillStatus } from '#shared/types/skill'

describe('parseSkillFrontmatterFromMarkdown', () => {
    it('解析含 frontmatter 的 SKILL.md', () => {
        const md = `---\nname: docx\ndescription: docx skill\nlicense: Proprietary\nversion: "1.0"\n---\n\n# Body\n`
        const result = parseSkillFrontmatterFromMarkdown(md)
        expect(result).toEqual({ name: 'docx', description: 'docx skill', license: 'Proprietary', version: '1.0' })
    })

    it('frontmatter 缺 name 字段时返回 null', () => {
        const md = `---\ndescription: 无 name\n---\n\nbody\n`
        expect(parseSkillFrontmatterFromMarkdown(md)).toBeNull()
    })

    it('完全无 frontmatter 时返回 null', () => {
        expect(parseSkillFrontmatterFromMarkdown('# Just markdown')).toBeNull()
    })
})

describe('scanAndSyncSkillsService', () => {
    let tempRoot: string
    const cleanupNames: string[] = []

    beforeEach(async () => {
        // 创建临时 skills 根目录
        tempRoot = resolve(tmpdir(), `skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await mkdir(tempRoot, { recursive: true })
    })

    afterEach(async () => {
        // 清理临时目录
        await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
        // 清理数据库测试 skill
        if (cleanupNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: cleanupNames } } })
            cleanupNames.length = 0
        }
    })

    it('扫描含 SKILL.md 的子目录并入库', async () => {
        const skillName = `test_alpha_${Date.now()}`
        cleanupNames.push(skillName)

        const skillDir = resolve(tempRoot, skillName)
        await mkdir(skillDir, { recursive: true })
        await writeFile(
            resolve(skillDir, 'SKILL.md'),
            `---\nname: ${skillName}\ndescription: alpha skill\nversion: 1.2\n---\n\n# Alpha\n`,
        )

        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.added).toContain(skillName)
        expect(result.scanned).toContain(skillName)

        const found = await prisma.skills.findUnique({ where: { name: skillName } })
        expect(found).toBeDefined()
        expect(found?.description).toBe('alpha skill')
        expect(found?.version).toBe('1.2')
        expect(found?.source).toBe(SkillSource.FILESYSTEM)
        expect(found?.status).toBe(SkillStatus.ENABLED)
    })

    it('跳过没有 SKILL.md 的子目录', async () => {
        const otherDir = resolve(tempRoot, `not_a_skill_${Date.now()}`)
        await mkdir(otherDir)
        await writeFile(resolve(otherDir, 'README.md'), '# README')

        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.scanned).toEqual([])
    })

    it('SKILL.md 的 frontmatter 损坏时跳过该 skill 并记录错误', async () => {
        const skillName = `test_broken_${Date.now()}`
        const skillDir = resolve(tempRoot, skillName)
        await mkdir(skillDir)
        await writeFile(
            resolve(skillDir, 'SKILL.md'),
            `# 无 frontmatter\n这是一个有效 markdown 但缺少 frontmatter 的 SKILL.md`,
        )

        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.errors.length).toBeGreaterThanOrEqual(1)
        expect(result.errors[0].name).toBe(skillName)

        const found = await prisma.skills.findUnique({ where: { name: skillName } })
        expect(found).toBeNull()
    })

    it('文件系统已删除的 skill 在二次扫描后被置为 DISABLED', async () => {
        const skillName = `test_will_disable_${Date.now()}`
        cleanupNames.push(skillName)

        const skillDir = resolve(tempRoot, skillName)
        await mkdir(skillDir)
        await writeFile(
            resolve(skillDir, 'SKILL.md'),
            `---\nname: ${skillName}\ndescription: temp\n---\n\n# T\n`,
        )

        await scanAndSyncSkillsService(tempRoot)

        // 删除目录
        await rm(skillDir, { recursive: true })

        // 二次扫描
        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.disabled).toContain(skillName)

        const found = await prisma.skills.findUnique({ where: { name: skillName } })
        expect(found?.status).toBe(SkillStatus.DISABLED)
    })

    it('返回结果对象 shape 符合契约', async () => {
        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result).toHaveProperty('scanned')
        expect(result).toHaveProperty('added')
        expect(result).toHaveProperty('updated')
        expect(result).toHaveProperty('disabled')
        expect(result).toHaveProperty('errors')
    })
})
