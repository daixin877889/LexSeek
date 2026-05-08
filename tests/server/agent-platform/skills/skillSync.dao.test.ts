/**
 * SkillSync DAO 层测试
 *
 * **Feature: skill-sync**
 * **Validates: Task 6 - SkillSync 数据访问层**
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
    upsertSkillDAO,
    listAllSkillsDAO,
    listSkillsByNodeIdDAO,
    markSkillsDisabledByNamesDAO,
    deleteSkillDAO,
    updateSkillCustomTitleDAO,
    listEnabledSkillLabelsDAO,
} from '~~/server/services/agent-platform/skills/skillSync.dao'
import { SkillSource, SkillStatus } from '#shared/types/skill'
import { prisma } from '~~/server/utils/db'

describe('SkillSync DAO', () => {
    const testSkillNames: string[] = []

    afterEach(async () => {
        // 清理测试创建的 skill
        if (testSkillNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: testSkillNames } } })
            testSkillNames.length = 0
        }
    })

    it('upsertSkillDAO 创建新记录', async () => {
        const name = `test_skill_${Date.now()}_a`
        testSkillNames.push(name)

        const result = await upsertSkillDAO({
            name,
            path: `.deepagents/skills/${name}`,
            source: SkillSource.FILESYSTEM,
            title: '测试 skill',
            description: '测试描述',
            version: '1.0',
        })
        expect(result.name).toBe(name)
        expect(result.status).toBe(SkillStatus.ENABLED)
        expect(result.syncedAt).toBeInstanceOf(Date)
    })

    it('upsertSkillDAO 更新已存在记录（同名重复扫描）', async () => {
        const name = `test_skill_${Date.now()}_b`
        testSkillNames.push(name)

        await upsertSkillDAO({
            name, path: `.deepagents/skills/${name}`,
            source: SkillSource.FILESYSTEM, title: '初次', description: 'v1', version: '1.0',
        })
        const updated = await upsertSkillDAO({
            name, path: `.deepagents/skills/${name}`,
            source: SkillSource.FILESYSTEM, title: '二次', description: 'v2', version: '2.0',
        })
        expect(updated.title).toBe('二次')
        expect(updated.version).toBe('2.0')
    })

    it('listAllSkillsDAO 默认返回 status=1 的记录', async () => {
        const aName = `test_skill_${Date.now()}_c1`
        const bName = `test_skill_${Date.now()}_c2`
        testSkillNames.push(aName, bName)

        await upsertSkillDAO({ name: aName, path: `path/${aName}`, source: SkillSource.FILESYSTEM })
        await upsertSkillDAO({ name: bName, path: `path/${bName}`, source: SkillSource.FILESYSTEM })

        const all = await listAllSkillsDAO()
        expect(all.find(s => s.name === aName)).toBeDefined()
        expect(all.find(s => s.name === bName)).toBeDefined()
    })

    it('markSkillsDisabledByNamesDAO 把指定记录置 status=0', async () => {
        const name = `test_skill_${Date.now()}_d`
        testSkillNames.push(name)
        await upsertSkillDAO({ name, path: `path/${name}`, source: SkillSource.FILESYSTEM })

        const count = await markSkillsDisabledByNamesDAO([name])
        expect(count).toBe(1)

        const found = await prisma.skills.findUnique({ where: { name } })
        expect(found?.status).toBe(SkillStatus.DISABLED)
    })

    it('listSkillsByNodeIdDAO 返回节点关联的所有 ENABLED skill', async () => {
        // 用 -1（不存在的节点）测试空数组返回
        const skills = await listSkillsByNodeIdDAO(-1)
        expect(skills).toEqual([])
    })
})

describe('buildUpsertSkillOp - 扫描不覆盖后台字段', () => {
    const testSkillNames: string[] = []

    afterEach(async () => {
        if (testSkillNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: testSkillNames } } })
            testSkillNames.length = 0
        }
    })

    it('管理员手动停用的 skill 重扫后保持 DISABLED', async () => {
        const name = `test_skill_${Date.now()}_status_keep`
        testSkillNames.push(name)

        // 第一次创建（默认 ENABLED）
        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
        })
        // 管理员手动停用
        await prisma.skills.update({ where: { name }, data: { status: SkillStatus.DISABLED } })

        // 第二次扫描（模拟 resync）
        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
        })

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.DISABLED)
    })

    it('管理员设置的 customTitle 重扫后保持不变', async () => {
        const name = `test_skill_${Date.now()}_ct_keep`
        testSkillNames.push(name)

        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
            title: '代码默认名',
        })
        // 管理员设置 customTitle
        await prisma.skills.update({ where: { name }, data: { customTitle: '后台覆盖名' } })

        // 第二次扫描
        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
            title: '代码默认名 v2',
        })

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.customTitle).toBe('后台覆盖名')
        expect(row?.title).toBe('代码默认名 v2')   // title 跟随代码
    })

    it('新 skill 第一次入库 status 默认 ENABLED', async () => {
        const name = `test_skill_${Date.now()}_new_enabled`
        testSkillNames.push(name)

        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
        })

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.ENABLED)
        expect(row?.customTitle).toBeNull()
    })
})

describe('updateSkillCustomTitleDAO', () => {
    const testSkillNames: string[] = []

    afterEach(async () => {
        if (testSkillNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: testSkillNames } } })
            testSkillNames.length = 0
        }
    })

    it('设置 customTitle 为字符串', async () => {
        const name = `test_skill_${Date.now()}_ct_set`
        testSkillNames.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })

        const row = await updateSkillCustomTitleDAO(name, '我的中文名')
        expect(row.customTitle).toBe('我的中文名')
    })

    it('设置 customTitle 为 null（恢复代码默认）', async () => {
        const name = `test_skill_${Date.now()}_ct_clear`
        testSkillNames.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })
        await updateSkillCustomTitleDAO(name, '先设值')

        const row = await updateSkillCustomTitleDAO(name, null)
        expect(row.customTitle).toBeNull()
    })

    it('skill 不存在抛 P2025', async () => {
        await expect(updateSkillCustomTitleDAO('not_exist_skill_xxx', 'x'))
            .rejects.toMatchObject({ code: 'P2025' })
    })
})

describe('listEnabledSkillLabelsDAO', () => {
    const testSkillNames: string[] = []

    afterEach(async () => {
        if (testSkillNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: testSkillNames } } })
            testSkillNames.length = 0
        }
    })

    it('仅返回 status=ENABLED 的 skill', async () => {
        const enabledName = `test_skill_${Date.now()}_label_e`
        const disabledName = `test_skill_${Date.now()}_label_d`
        testSkillNames.push(enabledName, disabledName)

        await upsertSkillDAO({ name: enabledName, path: `p/${enabledName}`, source: SkillSource.FILESYSTEM, title: 'A 中文' })
        await upsertSkillDAO({ name: disabledName, path: `p/${disabledName}`, source: SkillSource.FILESYSTEM, title: 'B 中文' })
        await prisma.skills.update({ where: { name: disabledName }, data: { status: SkillStatus.DISABLED } })

        const list = await listEnabledSkillLabelsDAO()
        expect(list.find(s => s.name === enabledName)).toBeDefined()
        expect(list.find(s => s.name === disabledName)).toBeUndefined()
    })

    it('label 优先级：customTitle > title > name', async () => {
        const a = `test_skill_${Date.now()}_label_a`   // 仅 title
        const b = `test_skill_${Date.now()}_label_b`   // customTitle 优先
        const c = `test_skill_${Date.now()}_label_c`   // title 也无（清空），兜底 name
        testSkillNames.push(a, b, c)

        await upsertSkillDAO({ name: a, path: `p/${a}`, source: SkillSource.FILESYSTEM, title: 'A 中文' })
        await upsertSkillDAO({ name: b, path: `p/${b}`, source: SkillSource.FILESYSTEM, title: 'B 代码默认' })
        await prisma.skills.update({ where: { name: b }, data: { customTitle: 'B 后台覆盖' } })
        await upsertSkillDAO({ name: c, path: `p/${c}`, source: SkillSource.FILESYSTEM })
        await prisma.skills.update({ where: { name: c }, data: { title: null } })

        const list = await listEnabledSkillLabelsDAO()
        expect(list.find(s => s.name === a)?.label).toBe('A 中文')
        expect(list.find(s => s.name === b)?.label).toBe('B 后台覆盖')
        expect(list.find(s => s.name === c)?.label).toBe(c)
    })
})
