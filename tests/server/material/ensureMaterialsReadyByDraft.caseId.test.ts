/**
 * ensureMaterialsReadyByDraftService: options.caseId 透传集成测
 *
 * **Feature: document-case-materials-sync**
 * **Task 5**: 批量入口把 caseId 传进内部 per-file pipeline，最终落库到 case_materials.caseId
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ensureMaterialsReadyByDraftService } from '~~/server/services/material/materialPipeline.service'
import {
    getTestPrisma,
    cleanupAllTestData,
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestOssFile,
} from '~~/tests/server/material/test-db-helper'
import { v7 as uuidv7 } from 'uuid'

// 同 Task 2：mock 识别流水线避免真跑
// (caseMaterials.summary 字段已删/迁出，T9 阶段 waitMaterialsTerminalAndSummary 暂时只看 status；
//  T7 会重写为跨表查 summary 的双就绪判定)
vi.mock('~~/server/services/material/materialProcess.service', async (orig) => {
    const actual = await orig<any>()
    return {
        ...actual,
        processMaterialService: vi.fn(async (id: number) => {
            const prisma = getTestPrisma()
            await prisma.caseMaterials.update({
                where: { id },
                data: { status: 3 },
            })
        }),
        batchCheckMaterialRecognizedService: vi.fn(async () => new Map()),
    }
})

vi.mock('~~/server/services/material/materialEmbedding.service', async (orig) => {
    const actual = await orig<any>()
    return {
        ...actual,
        batchCheckMaterialEmbeddedService: vi.fn(async () => new Map()),
    }
})

describe('ensureMaterialsReadyByDraftService 透传 caseId', () => {
    beforeEach(async () => { await cleanupAllTestData() })
    afterEach(async () => { await cleanupAllTestData() })

    async function seed() {
        const prisma = getTestPrisma()
        const user = await createTestUser()
        const ct = await createTestCaseType({ status: 1 })
        const caseRow = await createTestCase({ userId: user.id, caseTypeId: ct.id })
        const oss = await createTestOssFile({ userId: user.id })
        const tplOss = await createTestOssFile({ userId: user.id })
        const tpl = await prisma.documentTemplates.create({
            data: {
                userId: user.id,
                name: `tpl_${Date.now()}`,
                scope: 'personal',
                category: 'general',
                placeholders: [],
                ossFileId: tplOss.id,
            },
        })
        const draft = await prisma.documentDrafts.create({
            data: {
                userId: user.id,
                templateId: tpl.id,
                sessionId: `s-${uuidv7()}`,
                status: 'drafting',
                values: {},
                caseId: caseRow.id,
                title: 't',
                titleOverridden: false,
            },
        })
        return { prisma, user, caseRow, draft, oss }
    }

    it('options.caseId 传入时新建记录应同时写入 caseId 和 draftId（双绑）', async () => {
        const { prisma, user, caseRow, draft, oss } = await seed()

        await ensureMaterialsReadyByDraftService(draft.id, user.id, {
            fileIds: [oss.id],
            caseId: caseRow.id,
        })

        const all = await prisma.caseMaterials.findMany({
            where: { ossFileId: oss.id, deletedAt: null },
        })
        expect(all).toHaveLength(1)
        expect(all[0]!.caseId).toBe(caseRow.id)
        expect(all[0]!.draftId).toBe(draft.id)
    })

    it('options.caseId 为 null 时仍 draft-only（向后兼容独立文书页）', async () => {
        const { prisma, user, draft, oss } = await seed()

        await ensureMaterialsReadyByDraftService(draft.id, user.id, {
            fileIds: [oss.id],
            caseId: null,
        })

        const all = await prisma.caseMaterials.findMany({
            where: { ossFileId: oss.id, deletedAt: null },
        })
        expect(all).toHaveLength(1)
        expect(all[0]!.caseId).toBeNull()
        expect(all[0]!.draftId).toBe(draft.id)
    })

    it('不传 caseId 选项时退化为 draft-only', async () => {
        const { prisma, user, draft, oss } = await seed()

        await ensureMaterialsReadyByDraftService(draft.id, user.id, {
            fileIds: [oss.id],
        })

        const all = await prisma.caseMaterials.findMany({
            where: { ossFileId: oss.id, deletedAt: null },
        })
        expect(all).toHaveLength(1)
        expect(all[0]!.caseId).toBeNull()
        expect(all[0]!.draftId).toBe(draft.id)
    })
})
