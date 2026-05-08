/**
 * Phase M admin/prompts/preview-bundle API 测试
 *
 * **Feature: prompts-multi-node-and-anti-jailbreak (Phase M)**
 *
 * 阶段 M 把返回结构改成 4 类分组（system / user_injection / user / assistant）。
 *
 * 覆盖：
 * - 401 未登录
 * - 空数组 → 4 字段全为 null
 * - 单 system → 仅 system 非空，其余 null
 * - 多个 system 按 displayOrder 升序拼接
 * - status=0 / 不存在 promptId 静默跳过
 * - 混合 4 类 → 各类分桶正确（system / user_injection 拼接，user / assistant 列表）
 * - 仅 user → userItems 列表非空，其余字段 null
 * - user / assistant 列表内按 displayOrder 升序
 * - 模板变量 {{caseId}} → 渲染为 <caseId>
 *
 * 策略：复用 handler-test 全局 stub + 真实数据库
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../_helpers/handler-test'
import { expectSuccess, makeEvent } from '../_helpers/handler-test'
import { prisma } from '~~/server/utils/db'

const { default: previewBundleHandler } = await import(
    '~~/server/api/v1/admin/prompts/preview-bundle.post'
)

const createdPromptIds: number[] = []

const uniqueSuffix = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

beforeEach(() => {})

afterEach(async () => {
    if (createdPromptIds.length > 0) {
        await prisma.prompts.deleteMany({ where: { id: { in: createdPromptIds } } })
        createdPromptIds.length = 0
    }
})

describe('POST /api/v1/admin/prompts/preview-bundle', () => {
    it('未登录 → 401', async () => {
        const r = await previewBundleHandler(
            makeEvent({ body: { prompts: [] } }) as any,
        )
        expect(r.code).toBe(401)
    })

    it('body 空数组 → 4 字段全为 null', async () => {
        const r = await previewBundleHandler(
            makeEvent({ userId: 1, body: { prompts: [] } }) as any,
        )
        const data = expectSuccess(r)
        expect(data.system).toBeNull()
        expect(data.userInjection).toBeNull()
        expect(data.userItems).toBeNull()
        expect(data.assistantItems).toBeNull()
    })

    it('多个 system 按 displayOrder 升序拼接（其余字段为 null）', async () => {
        const namePrefix = 'p_pb_' + uniqueSuffix()
        const p1 = await prisma.prompts.create({
            data: { name: `${namePrefix}_a`, content: 'AAA', type: 'system', status: 1, version: 'v1' },
        })
        const p2 = await prisma.prompts.create({
            data: { name: `${namePrefix}_b`, content: 'BBB', type: 'system', status: 1, version: 'v1' },
        })
        const p3 = await prisma.prompts.create({
            data: { name: `${namePrefix}_c`, content: 'CCC', type: 'system', status: 1, version: 'v1' },
        })
        createdPromptIds.push(p1.id, p2.id, p3.id)

        // 故意打乱入参顺序，期望按 displayOrder 升序拼出 BBB → AAA → CCC
        const r = await previewBundleHandler(
            makeEvent({
                userId: 1,
                body: {
                    prompts: [
                        { promptId: p1.id, displayOrder: 200 },
                        { promptId: p3.id, displayOrder: 300 },
                        { promptId: p2.id, displayOrder: 100 },
                    ],
                },
            }) as any,
        )
        const data = expectSuccess(r)
        expect(data.system).toEqual({ content: 'BBB\n\nAAA\n\nCCC', count: 3 })
        expect(data.userInjection).toBeNull()
        expect(data.userItems).toBeNull()
        expect(data.assistantItems).toBeNull()
    })

    it('status=0 的 promptId 被过滤', async () => {
        const namePrefix = 'p_pb_' + uniqueSuffix()
        const active = await prisma.prompts.create({
            data: { name: `${namePrefix}_active`, content: 'ACTIVE', type: 'system', status: 1, version: 'v1' },
        })
        const inactive = await prisma.prompts.create({
            data: { name: `${namePrefix}_inactive`, content: 'INACTIVE', type: 'system', status: 0, version: 'v1' },
        })
        createdPromptIds.push(active.id, inactive.id)

        const r = await previewBundleHandler(
            makeEvent({
                userId: 1,
                body: {
                    prompts: [
                        { promptId: active.id, displayOrder: 100 },
                        { promptId: inactive.id, displayOrder: 200 },
                    ],
                },
            }) as any,
        )
        const data = expectSuccess(r)
        expect(data.system).toEqual({ content: 'ACTIVE', count: 1 })
        expect(data.userInjection).toBeNull()
        expect(data.userItems).toBeNull()
        expect(data.assistantItems).toBeNull()
    })

    it('不存在的 promptId 被静默跳过', async () => {
        const namePrefix = 'p_pb_' + uniqueSuffix()
        const p = await prisma.prompts.create({
            data: { name: `${namePrefix}_only`, content: 'ONLY', type: 'system', status: 1, version: 'v1' },
        })
        createdPromptIds.push(p.id)

        const r = await previewBundleHandler(
            makeEvent({
                userId: 1,
                body: {
                    prompts: [
                        { promptId: p.id, displayOrder: 100 },
                        { promptId: 99999999, displayOrder: 200 },
                    ],
                },
            }) as any,
        )
        const data = expectSuccess(r)
        expect(data.system).toEqual({ content: 'ONLY', count: 1 })
        expect(data.userInjection).toBeNull()
        expect(data.userItems).toBeNull()
        expect(data.assistantItems).toBeNull()
    })

    it('混合 4 类 → 各类分桶正确（system / user_injection 拼接，user / assistant 列表）', async () => {
        const namePrefix = 'p_pb_mix_' + uniqueSuffix()
        const sys1 = await prisma.prompts.create({
            data: { name: `${namePrefix}_sys1`, title: 'Sys1', content: 'SYS1', type: 'system', status: 1, version: 'v1' },
        })
        const sys2 = await prisma.prompts.create({
            data: { name: `${namePrefix}_sys2`, title: null, content: 'SYS2', type: 'system', status: 1, version: 'v1' },
        })
        const inj = await prisma.prompts.create({
            data: { name: `${namePrefix}_inj`, title: 'Inj', content: 'INJ', type: 'user_injection', status: 1, version: 'v1' },
        })
        const usr = await prisma.prompts.create({
            data: { name: `${namePrefix}_usr`, title: 'Usr', content: 'USR', type: 'user', status: 1, version: 'v1' },
        })
        const ast = await prisma.prompts.create({
            data: { name: `${namePrefix}_ast`, title: null, content: 'AST', type: 'assistant', status: 1, version: 'v1' },
        })
        createdPromptIds.push(sys1.id, sys2.id, inj.id, usr.id, ast.id)

        const r = await previewBundleHandler(
            makeEvent({
                userId: 1,
                body: {
                    prompts: [
                        { promptId: sys2.id, displayOrder: 200 },
                        { promptId: sys1.id, displayOrder: 100 },
                        { promptId: inj.id, displayOrder: 100 },
                        { promptId: usr.id, displayOrder: 100 },
                        { promptId: ast.id, displayOrder: 100 },
                    ],
                },
            }) as any,
        )
        const data = expectSuccess(r)
        // system: 2 段按 displayOrder 升序 → SYS1 → SYS2
        expect(data.system).toEqual({ content: 'SYS1\n\nSYS2', count: 2 })
        // user_injection: 1 段
        expect(data.userInjection).toEqual({ content: 'INJ', count: 1 })
        // user: 列表
        expect(data.userItems).toEqual([
            { name: usr.name, title: 'Usr', content: 'USR' },
        ])
        // assistant: 列表
        expect(data.assistantItems).toEqual([
            { name: ast.name, title: null, content: 'AST' },
        ])
    })

    it('仅 user → userItems 列表非空，system / userInjection / assistantItems 为 null', async () => {
        const namePrefix = 'p_pb_only_user_' + uniqueSuffix()
        const u1 = await prisma.prompts.create({
            data: { name: `${namePrefix}_u1`, title: 'U1', content: 'U1C', type: 'user', status: 1, version: 'v1' },
        })
        const u2 = await prisma.prompts.create({
            data: { name: `${namePrefix}_u2`, title: 'U2', content: 'U2C', type: 'user', status: 1, version: 'v1' },
        })
        createdPromptIds.push(u1.id, u2.id)

        // 入参乱序，期望列表按 displayOrder 升序：U1(100) → U2(200)
        const r = await previewBundleHandler(
            makeEvent({
                userId: 1,
                body: {
                    prompts: [
                        { promptId: u2.id, displayOrder: 200 },
                        { promptId: u1.id, displayOrder: 100 },
                    ],
                },
            }) as any,
        )
        const data = expectSuccess(r)
        expect(data.system).toBeNull()
        expect(data.userInjection).toBeNull()
        expect(data.assistantItems).toBeNull()
        expect(data.userItems).toEqual([
            { name: u1.name, title: 'U1', content: 'U1C' },
            { name: u2.name, title: 'U2', content: 'U2C' },
        ])
    })

    it('user / assistant 列表内按 displayOrder 升序', async () => {
        const namePrefix = 'p_pb_order_' + uniqueSuffix()
        const a1 = await prisma.prompts.create({
            data: { name: `${namePrefix}_a1`, title: 'A1', content: 'A1C', type: 'assistant', status: 1, version: 'v1' },
        })
        const a2 = await prisma.prompts.create({
            data: { name: `${namePrefix}_a2`, title: 'A2', content: 'A2C', type: 'assistant', status: 1, version: 'v1' },
        })
        const a3 = await prisma.prompts.create({
            data: { name: `${namePrefix}_a3`, title: 'A3', content: 'A3C', type: 'assistant', status: 1, version: 'v1' },
        })
        createdPromptIds.push(a1.id, a2.id, a3.id)

        const r = await previewBundleHandler(
            makeEvent({
                userId: 1,
                body: {
                    prompts: [
                        { promptId: a3.id, displayOrder: 300 },
                        { promptId: a1.id, displayOrder: 100 },
                        { promptId: a2.id, displayOrder: 200 },
                    ],
                },
            }) as any,
        )
        const data = expectSuccess(r)
        expect(data.assistantItems).toEqual([
            { name: a1.name, title: 'A1', content: 'A1C' },
            { name: a2.name, title: 'A2', content: 'A2C' },
            { name: a3.name, title: 'A3', content: 'A3C' },
        ])
    })

    it('模板变量 {{caseId}} → 渲染为 <caseId>（system 与 user 分桶各自渲染）', async () => {
        const namePrefix = 'p_pb_var_' + uniqueSuffix()
        const sys = await prisma.prompts.create({
            data: {
                name: `${namePrefix}_sys`,
                content: 'hello {{caseId}} module {{moduleName}}',
                type: 'system',
                status: 1,
                version: 'v1',
            },
        })
        const usr = await prisma.prompts.create({
            data: {
                name: `${namePrefix}_usr`,
                title: 'UserVar',
                content: 'user view {{caseId}}',
                type: 'user',
                status: 1,
                version: 'v1',
            },
        })
        createdPromptIds.push(sys.id, usr.id)

        const r = await previewBundleHandler(
            makeEvent({
                userId: 1,
                body: {
                    prompts: [
                        { promptId: sys.id, displayOrder: 100 },
                        { promptId: usr.id, displayOrder: 100 },
                    ],
                },
            }) as any,
        )
        const data = expectSuccess(r)
        expect(data.system).toEqual({ content: 'hello <caseId> module <moduleName>', count: 1 })
        expect(data.userItems).toEqual([
            { name: usr.name, title: 'UserVar', content: 'user view <caseId>' },
        ])
    })
})
