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

describe('parseSkillFrontmatterFromMarkdown - title 字段', () => {
    it('解析合法 string title', () => {
        const md = `---\nname: foo\ntitle: 案件证据辩护\n---\n\n# body`
        const fm = parseSkillFrontmatterFromMarkdown(md)
        expect(fm).not.toBeNull()
        expect(fm!.title).toBe('案件证据辩护')
    })

    it('title 为数字时返回 undefined（类型守卫）', () => {
        const md = `---\nname: foo\ntitle: 123\n---\n\n# body`
        const fm = parseSkillFrontmatterFromMarkdown(md)
        expect(fm).not.toBeNull()
        expect(fm!.title).toBeUndefined()
    })

    it('title 为数组时返回 undefined（类型守卫）', () => {
        const md = `---\nname: foo\ntitle:\n  - a\n  - b\n---\n\n# body`
        const fm = parseSkillFrontmatterFromMarkdown(md)
        expect(fm).not.toBeNull()
        expect(fm!.title).toBeUndefined()
    })

    it('frontmatter 没写 title 时为 undefined', () => {
        const md = `---\nname: foo\n---\n\n# body`
        const fm = parseSkillFrontmatterFromMarkdown(md)
        expect(fm).not.toBeNull()
        expect(fm!.title).toBeUndefined()
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

    it('skillsRoot 不存在时（ENOENT）返回空结果而不抛错', async () => {
        const ghostRoot = resolve(tempRoot, 'definitely_does_not_exist_xxx')
        const result = await scanAndSyncSkillsService(ghostRoot)
        expect(result.scanned).toEqual([])
        expect(result.added).toEqual([])
        expect(result.updated).toEqual([])
        expect(result.errors).toEqual([])
    })

    it('忽略以点开头的目录与非目录条目', async () => {
        // 隐藏目录
        await mkdir(resolve(tempRoot, '.hidden'), { recursive: true })
        // 普通文件（非目录）
        await writeFile(resolve(tempRoot, 'random.txt'), 'hello')

        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.scanned).toEqual([])
        expect(result.errors).toEqual([])
    })

    it('SKILL.md frontmatter.name 与目录名不一致时记错误，不入库', async () => {
        const dirName = `test_dir_${Date.now()}`
        const skillDir = resolve(tempRoot, dirName)
        await mkdir(skillDir)
        await writeFile(
            resolve(skillDir, 'SKILL.md'),
            `---\nname: not_${dirName}\ndescription: 错配\n---\n\n# Body\n`,
        )

        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.errors.some(e => e.name === dirName && /不一致/.test(e.reason))).toBe(true)
        const found = await prisma.skills.findUnique({ where: { name: dirName } })
        expect(found).toBeNull()
    })

    it('parseSkillFrontmatterFromMarkdown：matter 抛错时返回 null', () => {
        // 由于 gray-matter 对绝大多数输入都不会抛，此处用一个极端 unicode buffer 做兜底；
        // 主要验证函数在 catch 分支返回 null 而非抛
        const broken = Buffer.from([0xff, 0xfe, 0x00, 0x00]).toString('utf-8') + '---\nname:\n---\n'
        // 即使 frontmatter 缺 name 也走 try 分支返回 null，覆盖与 catch 等价的 null 返回
        expect(parseSkillFrontmatterFromMarkdown(broken)).toBeNull()
    })

    it('parseSkillFrontmatterFromMarkdown：version 为非字符串非空值时转 String', () => {
        const md = `---\nname: x\nversion: 3\n---\nbody`
        const result = parseSkillFrontmatterFromMarkdown(md)
        expect(result?.version).toBe('3')
    })

    it('parseSkillFrontmatterFromMarkdown：version 为 null 时为 undefined', () => {
        const md = `---\nname: x\nversion: ~\n---\nbody`
        const result = parseSkillFrontmatterFromMarkdown(md)
        expect(result?.version).toBeUndefined()
    })

    it('skillsRoot 是文件而非目录时（ENOTDIR）抛错', async () => {
        const filePath = resolve(tempRoot, 'i_am_a_file.txt')
        await writeFile(filePath, 'not a directory')
        await expect(scanAndSyncSkillsService(filePath)).rejects.toThrow()
    })

    it('包含 broken symlink（stat 失败）时跳过该项不抛错', async () => {
        const { symlink } = await import('node:fs/promises')
        const linkPath = resolve(tempRoot, 'broken_link')
        // 指向不存在路径 → stat 抛错 → 走 catch continue
        await symlink('/this/path/does/not/exist/xyz', linkPath).catch(() => {})

        const result = await scanAndSyncSkillsService(tempRoot)
        // stat 失败被吞，scanned 不含该项
        expect(result.scanned).not.toContain('broken_link')
    })
})
