/**
 * deleteDraftService 级联 draftId 置空单测
 *
 * 软删 draft 前，先把 case_materials where draftId=Y 的 draftId 置 null：
 * - 双绑 (caseId=X, draftId=Y, ossFileId=Z) → (caseId=X, draftId=null, ossFileId=Z)，案件 Tab 仍可见
 * - draft-only (caseId=null, draftId=Y) → (caseId=null, draftId=null)，spec §3.4 兼容现状允许孤儿
 * - 不影响其他 draft 的材料、不影响已软删的材料
 * - 非 owner 删除失败时，case_materials 不被置空
 *
 * **Feature: document-case-materials-sync**
 * **Validates: spec §3.4, plan Task 7**
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import '../../../server/case/test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestOssFile,
    cleanupAllTestData,
    disconnectTestDb,
    getTestPrisma,
} from '../../../server/case/test-db-helper'
import { createMaterialDao } from '../../../../server/services/material/material.dao'
import { deleteDraftService } from '../../../../server/services/assistant/document/documentDraft.service'
import { CaseMaterialType } from '#shared/types/case'
import { v7 as uuidv7 } from 'uuid'

const prisma = getTestPrisma()

// ==================== 辅助：创建模板 + draft ====================

async function createTemplateAndDraft(
    userId: number,
    caseId: number | null,
): Promise<{ templateId: number; draftId: number }> {
    const tplOss = await createTestOssFile({ userId })
    const tpl = await prisma.documentTemplates.create({
        data: {
            userId,
            name: `tpl_${uuidv7()}`,
            scope: 'personal',
            category: 'general',
            placeholders: [],
            ossFileId: tplOss.id,
        },
    })
    const draft = await prisma.documentDrafts.create({
        data: {
            userId,
            templateId: tpl.id,
            sessionId: `s-${uuidv7()}`,
            status: 'ready',
            values: {},
            sourceRef: undefined,
            metadata: undefined,
            caseId,
            title: 't',
            titleOverridden: false,
        },
    })
    return { templateId: tpl.id, draftId: draft.id }
}

describe('deleteDraftService 级联 draftId 置空', () => {
    beforeEach(async () => {
        await cleanupAllTestData()
    })

    afterEach(async () => {
        await cleanupAllTestData()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    it('场景①：双绑记录 (caseId=X, draftId=Y, ossFileId=Z) → draftId 置 null, caseId 保留, deletedAt 仍为 null', async () => {
        const user = await createTestUser()
        const caseType = await createTestCaseType({ status: 1 })
        const caseRow = await createTestCase({ userId: user.id, caseTypeId: caseType.id })
        const { draftId } = await createTemplateAndDraft(user.id, caseRow.id)
        const oss = await createTestOssFile({ userId: user.id })

        const material = await createMaterialDao({
            caseId: caseRow.id,
            draftId,
            ossFileId: oss.id,
            name: 'dual-bound',
            type: CaseMaterialType.DOCUMENT,
            status: 3,
        })

        const result = await deleteDraftService(user.id, draftId)
        expect(result).toEqual({ ok: true })

        const after = await prisma.caseMaterials.findUnique({ where: { id: material.id } })
        expect(after).not.toBeNull()
        expect(after?.caseId).toBe(caseRow.id)
        expect(after?.draftId).toBeNull()
        expect(after?.ossFileId).toBe(oss.id)
        expect(after?.deletedAt).toBeNull()
    })

    it('场景②：draft-only 记录 (caseId=null, draftId=Y) → draftId 置 null（允许孤儿态，不做额外清理）', async () => {
        const user = await createTestUser()
        const { draftId } = await createTemplateAndDraft(user.id, null)
        const oss = await createTestOssFile({ userId: user.id })

        const material = await createMaterialDao({
            draftId,
            ossFileId: oss.id,
            name: 'draft-only',
            type: CaseMaterialType.DOCUMENT,
            status: 3,
        })

        const result = await deleteDraftService(user.id, draftId)
        expect(result).toEqual({ ok: true })

        const after = await prisma.caseMaterials.findUnique({ where: { id: material.id } })
        expect(after).not.toBeNull()
        expect(after?.caseId).toBeNull()
        expect(after?.draftId).toBeNull()
        expect(after?.deletedAt).toBeNull()
    })

    it('场景③：无关 draft 的 caseMaterials 不被置空', async () => {
        const user = await createTestUser()
        const { draftId: draftToDelete } = await createTemplateAndDraft(user.id, null)
        const { draftId: otherDraftId } = await createTemplateAndDraft(user.id, null)
        const oss = await createTestOssFile({ userId: user.id })

        const otherMaterial = await createMaterialDao({
            draftId: otherDraftId,
            ossFileId: oss.id,
            name: 'other-draft-material',
            type: CaseMaterialType.DOCUMENT,
            status: 3,
        })

        await deleteDraftService(user.id, draftToDelete)

        const after = await prisma.caseMaterials.findUnique({ where: { id: otherMaterial.id } })
        expect(after?.draftId).toBe(otherDraftId)
        expect(after?.deletedAt).toBeNull()
    })

    it('场景④：非 owner 删除失败时，caseMaterials 不被置空', async () => {
        const owner = await createTestUser()
        const intruder = await createTestUser()
        const { draftId } = await createTemplateAndDraft(owner.id, null)
        const oss = await createTestOssFile({ userId: owner.id })

        const material = await createMaterialDao({
            draftId,
            ossFileId: oss.id,
            name: 'owner-material',
            type: CaseMaterialType.DOCUMENT,
            status: 3,
        })

        const result = await deleteDraftService(intruder.id, draftId)
        expect(result).toEqual({ error: '无权删除此草稿', code: 403 })

        const after = await prisma.caseMaterials.findUnique({ where: { id: material.id } })
        expect(after?.draftId).toBe(draftId)
        expect(after?.deletedAt).toBeNull()
    })
})
