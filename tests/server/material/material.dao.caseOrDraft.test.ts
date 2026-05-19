/**
 * caseOrDraft 材料查询 DAO 单测
 *
 * **Feature: document-case-materials-sync**
 * **Validates: spec §3.2, §5.1**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    findActiveMaterialByOssFileIdDao,
    findMaterialsByCaseOrDraftIdDao,
    createMaterialDao,
} from '../../../server/services/material/material.dao'
import { CaseMaterialType } from '../../../shared/types/case'
import {
    cleanupAllTestData,
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestOssFile,
    getTestPrisma,
} from './test-db-helper'
import { v7 as uuidv7 } from 'uuid'

const createTemplateOssFile = async (userId: number) =>
    createTestOssFile({
        userId,
        fileName: 'tpl.docx',
        fileType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

async function setupUserCaseDraft() {
    const user = await createTestUser()
    const caseType = await createTestCaseType({ status: 1 })
    const caseRow = await createTestCase({ userId: user.id, caseTypeId: caseType.id })
    const tplOss = await createTemplateOssFile(user.id)
    const tpl = await getTestPrisma().documentTemplates.create({
        data: {
            userId: user.id,
            name: `测试模板_${Date.now()}`,
            scope: 'personal',
            category: 'general',
            placeholders: [],
            ossFileId: tplOss.id,
        },
    })
    const draft = await getTestPrisma().documentDrafts.create({
        data: {
            userId: user.id,
            templateId: tpl.id,
            sessionId: `test_${uuidv7()}`,
            status: 'drafting',
            values: {},
            sourceRef: undefined,
            metadata: undefined,
            caseId: caseRow.id,
            title: 'draft-t',
            titleOverridden: false,
        },
    })
    return { user, caseRow, draft }
}

describe('findActiveMaterialByOssFileIdDao', () => {
    beforeEach(async () => {
        await cleanupAllTestData()
    })
    afterEach(async () => {
        await cleanupAllTestData()
    })

    it('无活跃记录时返回 null', async () => {
        const user = await createTestUser()
        const oss = await createTestOssFile({ userId: user.id })
        const r = await findActiveMaterialByOssFileIdDao(oss.id)
        expect(r).toBeNull()
    })

    it('命中同 ossFileId 的活跃记录', async () => {
        const user = await createTestUser()
        const caseType = await createTestCaseType({ status: 1 })
        const caseRow = await createTestCase({ userId: user.id, caseTypeId: caseType.id })
        const oss = await createTestOssFile({ userId: user.id })
        const m = await createMaterialDao({
            caseId: caseRow.id,
            ossFileId: oss.id,
            name: 'a.pdf',
            type: CaseMaterialType.DOCUMENT,
        })
        const r = await findActiveMaterialByOssFileIdDao(oss.id)
        expect(r?.id).toBe(m.id)
    })

    it('软删记录不返回', async () => {
        const user = await createTestUser()
        const caseType = await createTestCaseType({ status: 1 })
        const caseRow = await createTestCase({ userId: user.id, caseTypeId: caseType.id })
        const oss = await createTestOssFile({ userId: user.id })
        const m = await createMaterialDao({
            caseId: caseRow.id,
            ossFileId: oss.id,
            name: 'a.pdf',
            type: CaseMaterialType.DOCUMENT,
        })
        await getTestPrisma().caseMaterials.update({
            where: { id: m.id },
            data: { deletedAt: new Date() },
        })
        const r = await findActiveMaterialByOssFileIdDao(oss.id)
        expect(r).toBeNull()
    })

    it('会话归属的材料不被按 ossFileId 的案件/草稿查重命中', async () => {
        const user = await createTestUser()
        const oss = await createTestOssFile({ userId: user.id })
        await createMaterialDao({
            sessionId: `sess-${Date.now()}`,
            ossFileId: oss.id,
            name: 's.pdf',
            type: CaseMaterialType.DOCUMENT,
        })
        // 会话归属行不应被案件/草稿全局查重命中，避免案件/草稿误借用会话材料行
        const r = await findActiveMaterialByOssFileIdDao(oss.id)
        expect(r).toBeNull()
    })
})

describe('findMaterialsByCaseOrDraftIdDao', () => {
    beforeEach(async () => {
        await cleanupAllTestData()
    })
    afterEach(async () => {
        await cleanupAllTestData()
    })

    it('两者都无时返回空数组', async () => {
        const r = await findMaterialsByCaseOrDraftIdDao({ caseId: null, draftId: null })
        expect(r).toEqual([])
    })

    it('只 caseId 时只返回匹配 caseId 的记录', async () => {
        const { user, caseRow, draft } = await setupUserCaseDraft()
        const oss1 = await createTestOssFile({ userId: user.id })
        const oss2 = await createTestOssFile({ userId: user.id })
        await createMaterialDao({
            caseId: caseRow.id,
            ossFileId: oss1.id,
            name: 'a',
            type: CaseMaterialType.DOCUMENT,
        })
        await createMaterialDao({
            draftId: draft.id,
            ossFileId: oss2.id,
            name: 'b',
            type: CaseMaterialType.DOCUMENT,
        })
        const r = await findMaterialsByCaseOrDraftIdDao({ caseId: caseRow.id, draftId: null })
        expect(r).toHaveLength(1)
        expect(r[0]!.ossFileId).toBe(oss1.id)
    })

    it('双 id 时合并去重（双绑记录只出现一次）', async () => {
        const { user, caseRow, draft } = await setupUserCaseDraft()
        const oss = await createTestOssFile({ userId: user.id })
        await createMaterialDao({
            caseId: caseRow.id,
            draftId: draft.id,
            ossFileId: oss.id,
            name: 'dual',
            type: CaseMaterialType.DOCUMENT,
        })
        const r = await findMaterialsByCaseOrDraftIdDao({ caseId: caseRow.id, draftId: draft.id })
        expect(r).toHaveLength(1)
    })

    it('软删记录不返回', async () => {
        const { user, caseRow } = await setupUserCaseDraft()
        const oss = await createTestOssFile({ userId: user.id })
        const m = await createMaterialDao({
            caseId: caseRow.id,
            ossFileId: oss.id,
            name: 'x',
            type: CaseMaterialType.DOCUMENT,
        })
        await getTestPrisma().caseMaterials.update({
            where: { id: m.id },
            data: { deletedAt: new Date() },
        })
        const r = await findMaterialsByCaseOrDraftIdDao({ caseId: caseRow.id, draftId: null })
        expect(r).toEqual([])
    })
})
