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
} from '~~/server/services/agent-platform/skills/skillSync.dao'
import { SkillSource, SkillStatus } from '#shared/types/skill'

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
