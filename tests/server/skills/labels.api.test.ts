/**
 * GET /api/v1/skills/labels 接口测试
 *
 * **Feature: skills-chinese-name**
 *
 * 策略：直接 import handler default，验证 401（未登录）和登录后返回的映射；
 * 不走 02.auth / 03.permission 中间件，测试直接 import handler 调。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { upsertSkillDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { prisma } from '~~/server/utils/db'
import { SkillSource, SkillStatus } from '#shared/types/skill'

const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const { default: labelsHandler } = await import('~~/server/api/v1/skills/labels.get')

function makeEvent(opts: { userId?: number } = {}) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
    }
}

describe('GET /api/v1/skills/labels', () => {
    const created: string[] = []

    afterEach(async () => {
        if (created.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: created } } })
            created.length = 0
        }
    })

    it('未登录返回 401', async () => {
        const r = await labelsHandler(makeEvent())
        expect(r.code).toBe(401)
    })

    it('登录后返回启用 skill 的 name→label 映射，DISABLED skill 不出现', async () => {
        const a = `t_label_${Date.now()}_a`
        const b = `t_label_${Date.now()}_b`
        const c = `t_label_${Date.now()}_c`
        created.push(a, b, c)

        await upsertSkillDAO({ name: a, path: `p/${a}`, source: SkillSource.FILESYSTEM, title: 'A 中文' })
        await upsertSkillDAO({ name: b, path: `p/${b}`, source: SkillSource.FILESYSTEM, title: 'B 默认' })
        await prisma.skills.update({ where: { name: b }, data: { customTitle: 'B 覆盖' } })
        await upsertSkillDAO({ name: c, path: `p/${c}`, source: SkillSource.FILESYSTEM, title: 'C 中文' })
        await prisma.skills.update({ where: { name: c }, data: { status: SkillStatus.DISABLED } })

        const r = await labelsHandler(makeEvent({ userId: 1 }))
        expect(r.code).toBe(0)
        const map = Object.fromEntries(r.data.map((x: { name: string; label: string }) => [x.name, x.label]))
        expect(map[a]).toBe('A 中文')
        expect(map[b]).toBe('B 覆盖')
        expect(map[c]).toBeUndefined()   // c 已停用
    })
})
