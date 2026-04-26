/**
 * 管理端 Skill 列表 API 测试
 *
 * **Feature: admin-skills**
 * **Validates: T19 - Admin skills list GET**
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { upsertSkillDAO, listAllSkillsDAO, deleteSkillDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { SkillSource, SkillStatus } from '#shared/types/skill'

// 模拟 Nuxt 自动导入的全局函数
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).resError = resError
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

describe('GET /api/v1/admin/skills（skill 列表）', () => {
    const testNames: string[] = []

    afterEach(async () => {
        if (testNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: testNames } } })
            testNames.length = 0
        }
    })

    it('handler 模块可加载且 default export 是函数', async () => {
        const { default: handler } = await import('~~/server/api/v1/admin/skills/index.get')
        expect(typeof handler).toBe('function')
    })

    it('handler 调用成功，返回 success=true 且 data 为数组', async () => {
        const { default: handler } = await import('~~/server/api/v1/admin/skills/index.get')
        const mockEvt = { context: { requestId: 'test-id' } } as any
        const res = await handler(mockEvt)
        expect(res.success).toBe(true)
        expect(Array.isArray(res.data)).toBe(true)
    })

    it('新创建的 skill 出现在列表中', async () => {
        const name = `test_list_skill_${Date.now()}`
        testNames.push(name)
        await upsertSkillDAO({ name, path: `path/${name}`, source: SkillSource.FILESYSTEM, title: '列表测试' })

        const all = await listAllSkillsDAO()
        const found = all.find(s => s.name === name)
        expect(found).toBeDefined()
        expect(found?.title).toBe('列表测试')
    })

    it('列表包含 DISABLED 的 skill', async () => {
        const name = `test_list_disabled_${Date.now()}`
        testNames.push(name)
        await upsertSkillDAO({ name, path: `path/${name}`, source: SkillSource.FILESYSTEM })
        // 手动置为 DISABLED
        await prisma.skills.update({ where: { name }, data: { status: SkillStatus.DISABLED } })

        const all = await listAllSkillsDAO()
        const found = all.find(s => s.name === name)
        expect(found).toBeDefined()
        expect(found?.status).toBe(SkillStatus.DISABLED)
    })

    it('列表按 name 升序排列', async () => {
        const prefix = `test_sort_${Date.now()}_`
        const nameA = `${prefix}aaa`
        const nameB = `${prefix}bbb`
        testNames.push(nameA, nameB)
        // 逆序插入
        await upsertSkillDAO({ name: nameB, path: `p/${nameB}`, source: SkillSource.FILESYSTEM })
        await upsertSkillDAO({ name: nameA, path: `p/${nameA}`, source: SkillSource.FILESYSTEM })

        const all = await listAllSkillsDAO()
        const idxA = all.findIndex(s => s.name === nameA)
        const idxB = all.findIndex(s => s.name === nameB)
        expect(idxA).toBeLessThan(idxB)
    })
})
