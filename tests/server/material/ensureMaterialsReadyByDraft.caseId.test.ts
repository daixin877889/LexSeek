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
// T7：waitMaterialsTerminalAndSummary 改为跨表查 summary 双就绪判定（无硬超时），
// 不能让真实 wait 跑（会无限轮询）。下面 mock material.service 的
// getMaterialSummariesByMaterials 让它认为所有材料都已有 summary → wait 立即退出
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

// T7：mock material.service 的两个关键函数（generateMaterialSummary no-op + summaries 全 ready）
vi.mock('~~/server/services/material/material.service', async (orig) => {
    const actual = await orig<any>()
    return {
        ...actual,
        // 跳过真实 LLM 调用
        generateMaterialSummaryService: vi.fn(async () => undefined),
        // 让 snapshot 看到 summary 已存在 → 状态 ready → wait 立即退出
        getMaterialSummariesByMaterials: vi.fn(async (inputs: any[]) => {
            const map = new Map<number, string>()
            for (const m of inputs) map.set(m.id, 'mock-summary')
            return map
        }),
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
