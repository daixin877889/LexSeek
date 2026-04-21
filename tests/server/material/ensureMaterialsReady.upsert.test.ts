/**
 * ensureMaterialsReadyForDraftService upsert 四场景单测
 *
 * **Feature: document-case-materials-sync**
 * **Validates: spec §3.1 边界场景表**
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMaterialDao } from '~~/server/services/material/material.dao'
import { CaseMaterialType } from '#shared/types/case'
import { ensureMaterialsReadyForDraftService } from '~~/server/services/material/materialPipeline.service'
import {
    getTestPrisma,
    cleanupAllTestData,
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestOssFile,
} from '~~/tests/server/material/test-db-helper'
import { v7 as uuidv7 } from 'uuid'

// mock processMaterialService：直接把记录置 COMPLETED 避免识别流水线真跑
vi.mock('~~/server/services/material/materialProcess.service', async (orig) => {
    const actual = await orig<any>()
    return {
        ...actual,
        processMaterialService: vi.fn(async (id: number) => {
            const prisma = getTestPrisma()
            await prisma.caseMaterials.update({ where: { id }, data: { status: 3 } })
        }),
        batchCheckMaterialRecognizedService: vi.fn(async () => new Map()),
    }
})

// mock embedding：视为未嵌入，跳过跨 draft 复用分支
vi.mock('~~/server/services/material/materialEmbedding.service', async (orig) => {
    const actual = await orig<any>()
    return {
        ...actual,
        batchCheckMaterialEmbeddedService: vi.fn(async () => new Map()),
    }
})

describe('ensureMaterialsReadyForDraftService upsert', () => {
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
                sourceRef: undefined,
                metadata: undefined,
                caseId: caseRow.id,
                title: 't',
                titleOverridden: false,
            },
        })
        return { prisma, user, caseRow, draft, oss }
    }

    it('场景① case-only + draft 上传 → update 变双绑，不新建第二条', async () => {
        const { prisma, user, caseRow, draft, oss } = await seed()
        const caseMat = await createMaterialDao({
            caseId: caseRow.id, ossFileId: oss.id, name: 'a',
            type: CaseMaterialType.DOCUMENT, status: 3,
        })

        await ensureMaterialsReadyForDraftService(oss.id, draft.id, user.id, caseRow.id)

        const all = await prisma.caseMaterials.findMany({ where: { ossFileId: oss.id, deletedAt: null } })
        expect(all).toHaveLength(1)
        expect(all[0]!.id).toBe(caseMat.id)
        expect(all[0]!.caseId).toBe(caseRow.id)
        expect(all[0]!.draftId).toBe(draft.id)
    })

    it('场景② draft-only + 带 caseId 上传 → 补齐 caseId 变双绑', async () => {
        const { prisma, user, caseRow, draft, oss } = await seed()
        const draftMat = await createMaterialDao({
            draftId: draft.id, ossFileId: oss.id, name: 'a',
            type: CaseMaterialType.DOCUMENT, status: 3,
        })

        await ensureMaterialsReadyForDraftService(oss.id, draft.id, user.id, caseRow.id)

        const after = await prisma.caseMaterials.findUnique({ where: { id: draftMat.id } })
        expect(after?.caseId).toBe(caseRow.id)
        expect(after?.draftId).toBe(draft.id)
    })

    it('场景③ 双绑已存在 + 同一 draft 重复上传 → 幂等，无重复', async () => {
        const { prisma, user, caseRow, draft, oss } = await seed()
        const dual = await createMaterialDao({
            caseId: caseRow.id, draftId: draft.id, ossFileId: oss.id, name: 'a',
            type: CaseMaterialType.DOCUMENT, status: 3,
        })

        await ensureMaterialsReadyForDraftService(oss.id, draft.id, user.id, caseRow.id)

        const all = await prisma.caseMaterials.findMany({ where: { ossFileId: oss.id, deletedAt: null } })
        expect(all).toHaveLength(1)
        expect(all[0]!.id).toBe(dual.id)
    })

    it('场景④ 无活跃记录 + 上传 → 新建双绑记录', async () => {
        const { prisma, user, caseRow, draft, oss } = await seed()

        await ensureMaterialsReadyForDraftService(oss.id, draft.id, user.id, caseRow.id)

        const all = await prisma.caseMaterials.findMany({ where: { ossFileId: oss.id, deletedAt: null } })
        expect(all).toHaveLength(1)
        expect(all[0]!.caseId).toBe(caseRow.id)
        expect(all[0]!.draftId).toBe(draft.id)
    })

    it('不传 caseId 时退化为 draft-only（向后兼容独立文书页）', async () => {
        const { prisma, user, draft, oss } = await seed()
        await ensureMaterialsReadyForDraftService(oss.id, draft.id, user.id)

        const all = await prisma.caseMaterials.findMany({ where: { ossFileId: oss.id, deletedAt: null } })
        expect(all).toHaveLength(1)
        expect(all[0]!.caseId).toBeNull()
        expect(all[0]!.draftId).toBe(draft.id)
    })
})
