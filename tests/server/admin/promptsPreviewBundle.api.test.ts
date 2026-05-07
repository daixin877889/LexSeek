/**
 * Phase I admin/prompts/preview-bundle API 测试
 *
 * **Feature: prompts-multi-node-and-anti-jailbreak (Phase I)**
 *
 * 覆盖：
 * - 401 未登录
 * - 空数组 → systemPromptPreview 为空字符串 + promptCount=0
 * - 多个 promptId 按 displayOrder 升序拼接（验证顺序）
 * - 过滤掉非 system 类型
 * - 过滤掉 status=0
 * - 静默跳过不存在的 promptId
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

    it('body 空数组 → systemPromptPreview 为空 + promptCount=0', async () => {
        const r = await previewBundleHandler(
            makeEvent({ userId: 1, body: { prompts: [] } }) as any,
        )
        const data = expectSuccess(r)
        expect(data.systemPromptPreview).toBe('')
        expect(data.promptCount).toBe(0)
    })

    it('多个 promptId 按 displayOrder 升序拼接', async () => {
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
        expect(data.promptCount).toBe(3)
        expect(data.systemPromptPreview).toBe('BBB\n\nAAA\n\nCCC')
    })

    it('type 非 system 的 promptId 被过滤', async () => {
        const namePrefix = 'p_pb_' + uniqueSuffix()
        const sys = await prisma.prompts.create({
            data: { name: `${namePrefix}_sys`, content: 'SYS', type: 'system', status: 1, version: 'v1' },
        })
        const usr = await prisma.prompts.create({
            data: { name: `${namePrefix}_usr`, content: 'USR', type: 'user', status: 1, version: 'v1' },
        })
        createdPromptIds.push(sys.id, usr.id)

        const r = await previewBundleHandler(
            makeEvent({
                userId: 1,
                body: {
                    prompts: [
                        { promptId: sys.id, displayOrder: 100 },
                        { promptId: usr.id, displayOrder: 200 },
                    ],
                },
            }) as any,
        )
        const data = expectSuccess(r)
        expect(data.promptCount).toBe(1)
        expect(data.systemPromptPreview).toBe('SYS')
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
        expect(data.promptCount).toBe(1)
        expect(data.systemPromptPreview).toBe('ACTIVE')
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
        expect(data.promptCount).toBe(1)
        expect(data.systemPromptPreview).toBe('ONLY')
    })

    it('模板变量 {{caseId}} → 渲染为 <caseId>', async () => {
        const name = 'p_pb_var_' + uniqueSuffix()
        const p = await prisma.prompts.create({
            data: {
                name,
                content: 'hello {{caseId}} module {{moduleName}}',
                type: 'system',
                status: 1,
                version: 'v1',
            },
        })
        createdPromptIds.push(p.id)

        const r = await previewBundleHandler(
            makeEvent({
                userId: 1,
                body: {
                    prompts: [{ promptId: p.id, displayOrder: 100 }],
                },
            }) as any,
        )
        const data = expectSuccess(r)
        expect(data.promptCount).toBe(1)
        expect(data.systemPromptPreview).toBe('hello <caseId> module <moduleName>')
    })
})
