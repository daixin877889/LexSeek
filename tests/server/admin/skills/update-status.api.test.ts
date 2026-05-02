/**
 * PATCH /api/v1/admin/skills/status/:name 启用前 fs 校验测试
 *
 * **Feature: skills-chinese-name + fs-missing-guard**
 *
 * 策略：直接 import handler default，传入 mock event；
 * 用 mkdtempSync 在临时目录构造/不构造 SKILL.md，并把 skill.path 写成
 * 该临时绝对路径，验证启用时的 fs 校验分支。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upsertSkillDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { prisma } from '~~/server/utils/db'
import { SkillSource, SkillStatus } from '#shared/types/skill'

// 全局 stub：模拟 Nuxt nitro 自动导入的 H3 函数与响应工具
const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const { default: statusHandler } = await import('~~/server/api/v1/admin/skills/status/[name].patch')

function makeEvent(opts: { params?: Record<string, string>; body?: any }) {
    return {
        context: { auth: { user: { id: 1 } } },
        __params: opts.params,
        __body: opts.body,
    }
}

describe('PATCH /api/v1/admin/skills/status/:name 启用 fs 校验', () => {
    let tmpRoot: string
    const created: string[] = []

    beforeEach(() => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'skill-status-'))
    })

    afterEach(async () => {
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
        if (created.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: created } } })
            created.length = 0
        }
    })

    it('启用：目录 + SKILL.md 都在 → 200', async () => {
        const name = `t_status_${Date.now()}_ok`
        created.push(name)
        const dir = join(tmpRoot, name)
        mkdirSync(dir)
        writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`)
        await upsertSkillDAO({ name, path: dir, source: SkillSource.FILESYSTEM })
        await prisma.skills.update({ where: { name }, data: { status: SkillStatus.DISABLED } })

        const r = await statusHandler(makeEvent({ params: { name }, body: { status: 1 } }))
        expect(r.code).toBe(0)

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.ENABLED)
    })

    it('启用：目录已删 → 400 + 中文错误', async () => {
        const name = `t_status_${Date.now()}_no_dir`
        created.push(name)
        const dir = join(tmpRoot, name)
        // 故意不创建 dir
        await upsertSkillDAO({ name, path: dir, source: SkillSource.FILESYSTEM })

        const r = await statusHandler(makeEvent({ params: { name }, body: { status: 1 } }))
        expect(r.code).toBe(400)
        expect(r.message).toContain('文件')

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.ENABLED)   // 未被改动（fresh insert 默认 ENABLED）
    })

    it('启用：目录在但 SKILL.md 没了 → 400', async () => {
        const name = `t_status_${Date.now()}_no_md`
        created.push(name)
        const dir = join(tmpRoot, name)
        mkdirSync(dir)
        // 不写 SKILL.md
        await upsertSkillDAO({ name, path: dir, source: SkillSource.FILESYSTEM })
        await prisma.skills.update({ where: { name }, data: { status: SkillStatus.DISABLED } })

        const r = await statusHandler(makeEvent({ params: { name }, body: { status: 1 } }))
        expect(r.code).toBe(400)
        expect(r.message).toContain('SKILL.md')

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.DISABLED)   // 未被启用
    })

    it('禁用：fs 不存在仍允许 → 200', async () => {
        const name = `t_status_${Date.now()}_disable`
        created.push(name)
        const dir = join(tmpRoot, name)
        // 故意不创建 dir
        await upsertSkillDAO({ name, path: dir, source: SkillSource.FILESYSTEM })
        // fresh insert 默认 ENABLED

        const r = await statusHandler(makeEvent({ params: { name }, body: { status: 0 } }))
        expect(r.code).toBe(0)

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.DISABLED)
    })

    it('skill 不存在 → 404', async () => {
        const r = await statusHandler(makeEvent({ params: { name: '__not_exist__' }, body: { status: 1 } }))
        expect(r.code).toBe(404)
    })
})
