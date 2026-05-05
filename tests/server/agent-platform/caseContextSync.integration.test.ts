/**
 * caseContextSyncMiddleware 集成测试
 *
 * 真实集成：不 mock buildContextSegments，让中间件穿透到 prisma 查实际数据。
 * 测试需要 worker 级 DB 隔离基建（vitest globalSetup 自动建 ls_test_w<id> 库），
 * 真实写入 cases / documentDrafts 行后跑中间件验证完整链路。
 *
 * 覆盖 spec §7.2 关键断言：
 * 1. 小索路径：注入消息含真实案件档案
 * 2. 文书路径：用户编辑 draft.values 后下轮 draftLoader 看到最新值
 * 3. 多轮注入位置：每轮新增独立消息且不修改历史
 *
 * ⚠️ 测试无残留铁律（.claude/rules/testing.md 终极规则）：每个 it 创建的 cases /
 * documentDrafts 行必须在 afterEach 反向（叶表 → 父表）按 createdIds 清理，否则
 * 同 worker 跑到下一文件会因 unique 冲突或断言污染失败。
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { v7 as uuidv7 } from 'uuid'
import { caseContextSyncMiddleware } from '~~/server/agents/_shared/case-context/caseContextSync.middleware'
import { prisma } from '~~/server/utils/db'
import {
    createTestUser,
    createTestCaseType,
    createTestOssFile,
    disconnectTestDb,
} from '../case/test-db-helper'

const createdIds = {
    cases: [] as number[],
    drafts: [] as number[],
    templates: [] as number[],
    ossFiles: [] as number[],
    caseTypes: [] as number[],
    users: [] as number[],
}

let sharedUserId: number
let sharedCaseTypeId: number

async function seedCaseFixture() {
    const c = await prisma.cases.create({
        data: {
            userId: sharedUserId,
            caseTypeId: sharedCaseTypeId,
            title: '集成测试案件',
            status: 1,
            plaintiff: ['原告甲'],
            defendant: ['被告乙'],
            summary: '集成测试摘要',
        },
    })
    createdIds.cases.push(c.id)
    return { caseId: c.id, userId: sharedUserId }
}

async function seedTemplate(userId: number) {
    const oss = await createTestOssFile({ userId })
    createdIds.ossFiles.push(oss.id)

    const tpl = await prisma.documentTemplates.create({
        data: {
            userId,
            name: `tpl_it_${uuidv7()}`,
            scope: 'personal',
            category: 'general',
            placeholders: [],
            ossFileId: oss.id,
        },
    })
    createdIds.templates.push(tpl.id)
    return tpl
}

describe('caseContextSyncMiddleware 集成测试（穿透真实 DB）', () => {
    beforeAll(async () => {
        // 共享一个 user / caseType，避免每个 it 都重复创建
        const u = await createTestUser()
        sharedUserId = u.id
        createdIds.users.push(u.id)

        const ct = await createTestCaseType({ status: 1 })
        sharedCaseTypeId = ct.id
        createdIds.caseTypes.push(ct.id)
    })

    // 每个 it 跑完后反向清理（叶表 documentDrafts → 父表 cases）。
    // 类型 C 防 FK 残留 + 类型 B 防 unique 冲突，对齐 testing.md 套路。
    afterEach(async () => {
        if (createdIds.drafts.length) {
            await prisma.documentDrafts.deleteMany({ where: { id: { in: createdIds.drafts } } })
            createdIds.drafts = []
        }
        if (createdIds.cases.length) {
            await prisma.cases.deleteMany({ where: { id: { in: createdIds.cases } } })
            createdIds.cases = []
        }
    })

    afterAll(async () => {
        // 共享 fixture 也要清理：templates / ossFiles / caseTypes / users（叶 → 父）
        if (createdIds.templates.length) {
            await prisma.documentTemplates.deleteMany({ where: { id: { in: createdIds.templates } } })
            createdIds.templates = []
        }
        if (createdIds.ossFiles.length) {
            await prisma.ossFiles.deleteMany({ where: { id: { in: createdIds.ossFiles } } })
            createdIds.ossFiles = []
        }
        if (createdIds.caseTypes.length) {
            await prisma.caseTypes.deleteMany({ where: { id: { in: createdIds.caseTypes } } })
            createdIds.caseTypes = []
        }
        if (createdIds.users.length) {
            await prisma.users.deleteMany({ where: { id: { in: createdIds.users } } })
            createdIds.users = []
        }
        await disconnectTestDb()
    })

    it('小索路径：注入消息含真实案件档案 + injectedBy=CaseContextSyncMiddleware', async () => {
        const { caseId } = await seedCaseFixture()

        const mw = caseContextSyncMiddleware({ caseId, agentName: 'caseMain' })
        const userMsg = new HumanMessage('案件进展')
        const state = { messages: [userMsg] }

        await mw.beforeAgent.hook(state)

        expect(state.messages.length).toBeGreaterThanOrEqual(2)
        const ctx: any = state.messages[0]
        expect(ctx.response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
        expect(ctx.additional_kwargs?.injectedBy).toBe('CaseContextSyncMiddleware')
        expect(ctx.content).toContain('集成测试案件')
        expect(ctx.content).toContain('原告甲')
        // user 消息仍在末尾
        const last = state.messages[state.messages.length - 1] as any
        expect(last.content).toBe('案件进展')
    })

    it('文书路径：用户编辑 draft.values 后下轮 draftLoader 看到最新值（spec §7.2 关键断言）', async () => {
        const { caseId } = await seedCaseFixture()
        const tpl = await seedTemplate(sharedUserId)

        const draft = await prisma.documentDrafts.create({
            data: {
                userId: sharedUserId,
                templateId: tpl.id,
                caseId,
                values: { '原告': '初版' },
                status: 'drafting',
                title: '集成测试草稿',
                sessionId: `draft-it-${uuidv7()}`,
            },
        })
        createdIds.drafts.push(draft.id)

        const draftLoader = async () => ({
            placeholdersWithHints: '- 原告\n- 被告',
            draftValuesJSON: async () => {
                const latest = await prisma.documentDrafts.findFirst({
                    where: { id: draft.id },
                    select: { values: true },
                })
                return JSON.stringify(latest?.values ?? {}, null, 2)
            },
        })

        const mw = caseContextSyncMiddleware({
            caseId,
            agentName: 'documentMain',
            draftLoader,
        })

        // 第一轮：注入消息含 "初版"
        const state1 = { messages: [new HumanMessage('看看草稿')] }
        await mw.beforeAgent.hook(state1)
        expect((state1.messages[0] as any).content).toContain('初版')

        // 用户在 UI 编辑：值改为 "更新后"
        await prisma.documentDrafts.update({
            where: { id: draft.id },
            data: { values: { '原告': '更新后' } },
        })

        // 第二轮：注入消息应含 "更新后"，不含 "初版"（draftLoader 实时查库）
        const state2 = { messages: [new HumanMessage('继续')] }
        await mw.beforeAgent.hook(state2)
        expect((state2.messages[0] as any).content).toContain('更新后')
        expect((state2.messages[0] as any).content).not.toContain('初版')
    })

    it('小索路径多轮：每轮新增独立注入消息（不复用历史 + 不修改历史）', async () => {
        const { caseId } = await seedCaseFixture()

        const mw = caseContextSyncMiddleware({ caseId, agentName: 'caseMain' })
        const state = { messages: [new HumanMessage('q1')] }

        await mw.beforeAgent.hook(state)
        const round1Length = state.messages.length

        // 模拟第二轮：append 新 user
        state.messages.push(new HumanMessage('q2'))
        await mw.beforeAgent.hook(state)

        expect(state.messages.length).toBe(round1Length + 2)
        // 第一轮的注入消息位置不变（不修改历史）
        expect((state.messages[0] as any).response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
        // 第二轮注入消息插在 q2 之前
        const lastIdx = state.messages.length - 1
        expect((state.messages[lastIdx] as any).content).toBe('q2')
        expect((state.messages[lastIdx - 1] as any).response_metadata?.injectedBy).toBe('CaseContextSyncMiddleware')
    })
})
