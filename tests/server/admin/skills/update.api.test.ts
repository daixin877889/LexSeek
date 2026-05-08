/**
 * PATCH /api/v1/admin/skills/:name 接口测试
 *
 * **Feature: skills-chinese-name**
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文 +
 * __params + __body），断言返回 body。绕过 02.auth / 03.permission 中间件——
 * 测试只验证 handler 自身逻辑（zod 校验、404、入库结果）。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { upsertSkillDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { prisma } from '~~/server/utils/db'
import { SkillSource } from '#shared/types/skill'

// 全局 stub：模拟 Nuxt nitro 自动导入的 H3 函数与响应工具
const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const { default: patchHandler } = await import('~~/server/api/v1/admin/skills/[name].patch')

function makeEvent(opts: { params?: Record<string, string>; body?: any }) {
    return {
        context: { auth: { user: { id: 1 } } },
        __params: opts.params,
        __body: opts.body,
    }
}

describe('PATCH /api/v1/admin/skills/:name', () => {
    const created: string[] = []

    afterEach(async () => {
        if (created.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: created } } })
            created.length = 0
        }
    })

    it('设置 customTitle', async () => {
        const name = `t_patch_${Date.now()}_ok`
        created.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })

        const r = await patchHandler(makeEvent({ params: { name }, body: { customTitle: '我的中文名' } }))
        expect(r.code).toBe(0)

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.customTitle).toBe('我的中文名')
    })

    it('空字符串等价 null（恢复代码默认）', async () => {
        const name = `t_patch_${Date.now()}_empty`
        created.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })
        await prisma.skills.update({ where: { name }, data: { customTitle: '先设值' } })

        await patchHandler(makeEvent({ params: { name }, body: { customTitle: '   ' } }))

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.customTitle).toBeNull()
    })

    it('null 直接清空', async () => {
        const name = `t_patch_${Date.now()}_null`
        created.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })
        await prisma.skills.update({ where: { name }, data: { customTitle: '先设值' } })

        await patchHandler(makeEvent({ params: { name }, body: { customTitle: null } }))

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.customTitle).toBeNull()
    })

    it('超长（>200）报 400', async () => {
        const name = `t_patch_${Date.now()}_long`
        created.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })

        const r = await patchHandler(makeEvent({ params: { name }, body: { customTitle: 'x'.repeat(201) } }))
        expect(r.code).toBe(400)
    })

    it('skill 不存在报 404', async () => {
        const r = await patchHandler(makeEvent({ params: { name: '__not_exist__' }, body: { customTitle: 'x' } }))
        expect(r.code).toBe(404)
    })

    it('缺少 name 路径参数报 400', async () => {
        const r = await patchHandler(makeEvent({ params: {}, body: { customTitle: 'x' } }))
        expect(r.code).toBe(400)
    })
})
