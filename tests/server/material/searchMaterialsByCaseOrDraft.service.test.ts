/**
 * searchMaterialsByCaseOrDraftService 合并检索单测
 *
 * **Feature: document-case-materials-sync**
 * **Validates: spec §3.2**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { searchMaterialsByCaseOrDraftService, type MaterialSearchToolResult } from '~~/server/services/material/materialPipeline.service'
import { createMaterialDao } from '~~/server/services/material/material.dao'
import { CaseMaterialType } from '#shared/types/case'
import {
    getTestPrisma,
    cleanupAllTestData,
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestOssFile,
} from '~~/tests/server/material/test-db-helper'

/**
 * 清理测试自建的 document drafts/templates，避免 cases 外键阻塞 cleanupAllTestData
 *
 * 顺序：caseMaterials（draftId） → documentDrafts → documentTemplates → cleanupAllTestData
 */
async function cleanupDocumentArtifacts() {
    const prisma = getTestPrisma()
    try {
        await prisma.caseMaterials.deleteMany({ where: { draftId: { not: null } } })
        await prisma.documentDrafts.deleteMany({ where: { sessionId: { startsWith: 's-' } } })
        await prisma.documentTemplates.deleteMany({ where: { name: 'n', scope: 'user' } })
    } catch (err) {
        console.warn('清理测试文书草稿/模板时出错：', err)
    }
}

describe('searchMaterialsByCaseOrDraftService', () => {
    beforeEach(async () => {
        await cleanupDocumentArtifacts()
        await cleanupAllTestData()
    })
    afterEach(async () => {
        await cleanupDocumentArtifacts()
        await cleanupAllTestData()
    })

    async function seed() {
        const prisma = getTestPrisma()
        const user = await createTestUser()
        const ct = await createTestCaseType()
        const caseRow = await createTestCase({ userId: user.id, caseTypeId: ct.id })
        const tplOss = await createTestOssFile({ userId: user.id })
        const tpl = await prisma.documentTemplates.create({
            data: { userId: user.id, name: 'n', scope: 'user', category: 'general', placeholders: [], ossFileId: tplOss.id },
        })
        const draft = await prisma.documentDrafts.create({
            data: {
                userId: user.id, templateId: tpl.id, sessionId: `s-${Date.now()}`,
                status: 'ready', values: {}, sourceRef: null, metadata: null,
                caseId: caseRow.id, title: 't', titleOverridden: false,
            },
        })
        return { prisma, user, caseRow, draft }
    }

    it('caseId + draftId 都传时返回合集，双绑记录去重一次', async () => {
        const { user, caseRow, draft } = await seed()
        const oss1 = await createTestOssFile(user.id)
        const oss2 = await createTestOssFile(user.id)
        const oss3 = await createTestOssFile(user.id)
        // case-only
        await createMaterialDao({ caseId: caseRow.id, ossFileId: oss1.id, name: 'a', type: CaseMaterialType.DOCUMENT })
        // draft-only
        await createMaterialDao({ draftId: draft.id, ossFileId: oss2.id, name: 'b', type: CaseMaterialType.DOCUMENT })
        // 双绑
        await createMaterialDao({ caseId: caseRow.id, draftId: draft.id, ossFileId: oss3.id, name: 'c', type: CaseMaterialType.DOCUMENT })

        // 用 sourceId 精确查，避开 embedding retrieval
        const results: MaterialSearchToolResult[] = []
        for (const oss of [oss1, oss2, oss3]) {
            const r = await searchMaterialsByCaseOrDraftService(
                user.id,
                { caseId: caseRow.id, draftId: draft.id },
                { sourceId: oss.id },
            )
            expect(r).toHaveLength(1)
            results.push(...r)
        }
        // 三条记录各自被查到，无重复
        const idSet = new Set(results.map(r => r.source.sourceId))
        expect(idSet.size).toBe(3)
    })

    it('只传 caseId 时不含 draft-only', async () => {
        const { user, caseRow, draft } = await seed()
        const oss1 = await createTestOssFile(user.id)
        const oss2 = await createTestOssFile(user.id)
        await createMaterialDao({ caseId: caseRow.id, ossFileId: oss1.id, name: 'x', type: CaseMaterialType.DOCUMENT })
        await createMaterialDao({ draftId: draft.id, ossFileId: oss2.id, name: 'y', type: CaseMaterialType.DOCUMENT })

        const r = await searchMaterialsByCaseOrDraftService(
            user.id,
            { caseId: caseRow.id, draftId: null },
            { sourceId: oss1.id },
        )
        expect(r).toHaveLength(1)
        expect(r[0]!.source.sourceId).toBe(oss1.id)
        expect(r.some(x => x.source.sourceId === oss2.id)).toBe(false)
    })

    it('两个 id 都为 null 时返回空', async () => {
        const { user } = await seed()
        const r = await searchMaterialsByCaseOrDraftService(user.id, { caseId: null, draftId: null }, { k: 5 })
        expect(r).toEqual([])
    })
})
