/**
 * 管理端 Skill 启停 API 测试
 *
 * **Feature: admin-skills**
 * **Validates: T19 - Admin skills status PATCH**
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { upsertSkillDAO, deleteSkillDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { SkillSource, SkillStatus } from '#shared/types/skill'

// 模拟 Nuxt 自动导入的全局函数
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).resError = resError
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = vi.fn()
;(globalThis as any).getRouterParam = vi.fn()
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

/** 构造 mock event，包含 routerParams 与 body */
function mockEvent(params: Record<string, string>, body: any) {
    ;(globalThis as any).getRouterParam = (_event: any, key: string) => params[key]
    ;(globalThis as any).readBody = async () => body
    return { context: { requestId: 'test-request-id' } } as any
}

describe('PATCH /api/v1/admin/skills/status/:name（skill 启停）', () => {
    const testNames: string[] = []

    afterEach(async () => {
        if (testNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: testNames } } })
            testNames.length = 0
        }
    })

    it('handler 模块可加载且 default export 是函数', async () => {
        const { default: handler } = await import('~~/server/api/v1/admin/skills/status/[name].patch')
        expect(typeof handler).toBe('function')
    })

    it('status=0 将 skill 置为 DISABLED', async () => {
        const name = `test_patch_disable_${Date.now()}`
        testNames.push(name)
        await upsertSkillDAO({ name, path: `path/${name}`, source: SkillSource.FILESYSTEM })

        const { default: handler } = await import('~~/server/api/v1/admin/skills/status/[name].patch')
        const event = mockEvent({ name }, { status: 0 })
        const res = await handler(event)

        expect(res.success).toBe(true)
        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.DISABLED)
    })

    it('status=1 将 skill 置为 ENABLED', async () => {
        const name = `test_patch_enable_${Date.now()}`
        testNames.push(name)
        await upsertSkillDAO({ name, path: `path/${name}`, source: SkillSource.FILESYSTEM })
        // 先 disable
        await prisma.skills.update({ where: { name }, data: { status: SkillStatus.DISABLED } })

        const { default: handler } = await import('~~/server/api/v1/admin/skills/status/[name].patch')
        const event = mockEvent({ name }, { status: 1 })
        const res = await handler(event)

        expect(res.success).toBe(true)
        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.ENABLED)
    })

    it('skill 不存在时返回 code=404', async () => {
        const { default: handler } = await import('~~/server/api/v1/admin/skills/status/[name].patch')
        const event = mockEvent({ name: 'non_existent_skill_xyz' }, { status: 0 })
        const res = await handler(event)
        expect(res.success).toBe(false)
        expect(res.code).toBe(404)
    })

    it('body 缺失 status 字段时返回 code=400', async () => {
        const { default: handler } = await import('~~/server/api/v1/admin/skills/status/[name].patch')
        const event = mockEvent({ name: 'any_skill' }, {})
        const res = await handler(event)
        expect(res.success).toBe(false)
        expect(res.code).toBe(400)
    })

    it('name 参数缺失时返回 code=400', async () => {
        const { default: handler } = await import('~~/server/api/v1/admin/skills/status/[name].patch')
        const event = mockEvent({}, { status: 1 })
        const res = await handler(event)
        expect(res.success).toBe(false)
        expect(res.code).toBe(400)
    })
})
