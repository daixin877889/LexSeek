/**
 * ensureMaterialsReadyForSessionService / ensureMaterialsReadyBySessionService 集成测
 *
 * **Feature: assistant-file-reading**
 * 验证通用问答会话场景按 sessionId 建 / 扫材料记录。
 *
 * 识别/嵌入/摘要流水线 mock 掉避免真跑（与 ensureMaterialsReadyByDraft.caseId.test.ts 同款）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    ensureMaterialsReadyForSessionService,
    ensureMaterialsReadyBySessionService,
} from '~~/server/services/material/materialPipeline.service'
import { findMaterialsBySessionIdDao } from '~~/server/services/material/material.dao'
import {
    getTestPrisma,
    cleanupAllTestData,
    createTestUser,
    createTestOssFile,
} from '~~/tests/server/material/test-db-helper'

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

vi.mock('~~/server/services/material/material.service', async (orig) => {
    const actual = await orig<any>()
    return {
        ...actual,
        generateMaterialSummaryService: vi.fn(async () => undefined),
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

describe('ensureMaterialsReadyForSessionService', () => {
    beforeEach(async () => { await cleanupAllTestData() })
    afterEach(async () => { await cleanupAllTestData() })

    it('为会话内新文件建立 sessionId 归属的 case_materials 记录', async () => {
        const user = await createTestUser()
        const oss = await createTestOssFile({ userId: user.id })
        const sid = `sess-ensure-${Date.now()}`

        await ensureMaterialsReadyForSessionService(oss.id, sid, user.id)

        const rows = await findMaterialsBySessionIdDao(sid)
        expect(rows).toHaveLength(1)
        expect(rows[0]?.ossFileId).toBe(oss.id)
        expect(rows[0]?.sessionId).toBe(sid)
    })

    it('同一文件重复调用幂等，不产生第二条记录', async () => {
        const user = await createTestUser()
        const oss = await createTestOssFile({ userId: user.id })
        const sid = `sess-idem-${Date.now()}`
        await ensureMaterialsReadyForSessionService(oss.id, sid, user.id)
        await ensureMaterialsReadyForSessionService(oss.id, sid, user.id)
        expect(await findMaterialsBySessionIdDao(sid)).toHaveLength(1)
    })

    it('两个会话引用同一文件时各自都能查到归属自己的材料', async () => {
        const user = await createTestUser()
        const oss = await createTestOssFile({ userId: user.id })
        const sidA = `sess-shareA-${Date.now()}`
        const sidB = `sess-shareB-${Date.now()}`
        await ensureMaterialsReadyForSessionService(oss.id, sidA, user.id)
        await ensureMaterialsReadyForSessionService(oss.id, sidB, user.id)
        // 同一份云盘文件被两个会话各自引用，两个会话都应能查到归属自己的材料记录
        expect(await findMaterialsBySessionIdDao(sidA)).toHaveLength(1)
        expect(await findMaterialsBySessionIdDao(sidB)).toHaveLength(1)
    })
})

describe('ensureMaterialsReadyBySessionService', () => {
    beforeEach(async () => { await cleanupAllTestData() })
    afterEach(async () => { await cleanupAllTestData() })

    it('传 fileIds 时为每个文件建会话材料并返回汇总', async () => {
        const user = await createTestUser()
        const f1 = await createTestOssFile({ userId: user.id })
        const f2 = await createTestOssFile({ userId: user.id })
        const sid = `sess-batch-${Date.now()}`
        const result = await ensureMaterialsReadyBySessionService(sid, user.id, { fileIds: [f1.id, f2.id] })
        expect(result.totalMaterials).toBe(2)
        expect(await findMaterialsBySessionIdDao(sid)).toHaveLength(2)
    })

    it('不传 fileIds 时扫描会话已有材料', async () => {
        const user = await createTestUser()
        const f1 = await createTestOssFile({ userId: user.id })
        const sid = `sess-scan-${Date.now()}`
        await ensureMaterialsReadyForSessionService(f1.id, sid, user.id)
        const result = await ensureMaterialsReadyBySessionService(sid, user.id, {})
        expect(result.totalMaterials).toBe(1)
    })

    it('会话无任何材料时返回空汇总', async () => {
        const user = await createTestUser()
        const result = await ensureMaterialsReadyBySessionService(`sess-empty-${Date.now()}`, user.id, {})
        expect(result.totalMaterials).toBe(0)
    })
})
