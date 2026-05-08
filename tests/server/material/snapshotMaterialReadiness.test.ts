/**
 * snapshotMaterialReadiness 跨表兜底测试
 *
 * 验证：识别记录表权威。case_materials.status 落后于真实识别状态时，
 * snapshot 仍能正确判定 'ready' / 'summarizing'，避免轮询死锁。
 *
 * 历史 bug：caseMaterials.status=PENDING + docRecognitionRecords.status=2（实际已识别）
 * 时，原实现只看 caseMaterials.status，返回 'pending'，
 * waitMaterialsTerminalAndSummary 永远等不到终态。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapshotMaterialReadiness } from '~~/server/services/material/materialPipeline.service'
import { MaterialStatus } from '#shared/types/material'
import { CaseMaterialType } from '#shared/types/case'
import {
    createEmptyTestIds,
    cleanupTestData,
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestOssFile,
    createTestMaterial,
    type CaseTestIds,
} from './test-db-helper'
import { prisma } from '~~/server/utils/db'

describe('snapshotMaterialReadiness 跨表兜底', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCase: Awaited<ReturnType<typeof createTestCase>>

    beforeEach(async () => {
        testIds = createEmptyTestIds()
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        const ct = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(ct.id)
        testCase = await createTestCase({ userId: testUser.id, caseTypeId: ct.id })
        testIds.caseIds.push(testCase.id)
    })

    afterEach(async () => {
        await cleanupTestData(testIds)
    })

    it('caseMaterials.status=PENDING 但识别记录表 status=2 + summary 有 → ready', async () => {
        const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
        const mat = await createTestMaterial({
            caseId: testCase.id,
            type: CaseMaterialType.DOCUMENT,
            ossFileId: ossFile.id,
        })
        // 关键：故意把 case_materials.status 留成 PENDING（=1）
        await prisma.caseMaterials.update({
            where: { id: mat.id },
            data: { status: MaterialStatus.PENDING },
        })
        testIds.materialIds.push(mat.id)
        await prisma.docRecognitionRecords.create({
            data: {
                userId: testUser.id,
                ossFileId: ossFile.id,
                status: 2,                  // 识别成功
                summary: '本案是合同纠纷',
                markdownContent: 'doc text',
            },
        })

        const fresh = await prisma.caseMaterials.findUnique({ where: { id: mat.id } })
        const snapshot = await snapshotMaterialReadiness([
            { ...fresh!, ossFileId: ossFile.id, type: CaseMaterialType.DOCUMENT } as any,
        ])

        expect(snapshot).toHaveLength(1)
        expect(snapshot[0]!.status).toBe('ready')
    })

    it('caseMaterials.status=PENDING 但识别记录表 status=2 + summary 无 → summarizing', async () => {
        const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
        const mat = await createTestMaterial({
            caseId: testCase.id,
            type: CaseMaterialType.DOCUMENT,
            ossFileId: ossFile.id,
        })
        await prisma.caseMaterials.update({
            where: { id: mat.id },
            data: { status: MaterialStatus.PENDING },
        })
        testIds.materialIds.push(mat.id)
        await prisma.docRecognitionRecords.create({
            data: {
                userId: testUser.id,
                ossFileId: ossFile.id,
                status: 2,
                summary: null,
                markdownContent: 'doc text',
            },
        })

        const fresh = await prisma.caseMaterials.findUnique({ where: { id: mat.id } })
        const snapshot = await snapshotMaterialReadiness([
            { ...fresh!, ossFileId: ossFile.id, type: CaseMaterialType.DOCUMENT } as any,
        ])

        expect(snapshot[0]!.status).toBe('summarizing')
    })

    it('case_materials.status=FAILED 优先：即使识别记录表显示成功也是 failed', async () => {
        const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
        const mat = await createTestMaterial({
            caseId: testCase.id,
            type: CaseMaterialType.DOCUMENT,
            ossFileId: ossFile.id,
        })
        await prisma.caseMaterials.update({
            where: { id: mat.id },
            data: { status: MaterialStatus.FAILED },
        })
        testIds.materialIds.push(mat.id)
        await prisma.docRecognitionRecords.create({
            data: {
                userId: testUser.id,
                ossFileId: ossFile.id,
                status: 2,
                summary: 'x',
                markdownContent: 'x',
            },
        })

        const fresh = await prisma.caseMaterials.findUnique({ where: { id: mat.id } })
        const snapshot = await snapshotMaterialReadiness([
            { ...fresh!, ossFileId: ossFile.id, type: CaseMaterialType.DOCUMENT } as any,
        ])

        expect(snapshot[0]!.status).toBe('failed')
    })

    it('ASR 旧逐字稿残留（>600 字符）：识别成功但摘要无效 → summarizing', async () => {
        const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
        const mat = await createTestMaterial({
            caseId: testCase.id,
            type: CaseMaterialType.AUDIO,
            ossFileId: ossFile.id,
        })
        await prisma.caseMaterials.update({
            where: { id: mat.id },
            data: { status: MaterialStatus.PENDING },
        })
        testIds.materialIds.push(mat.id)
        const longLegacy = '说话人：'.repeat(200) // 800 字符
        await prisma.asrRecords.create({
            data: { userId: testUser.id, ossFileId: ossFile.id, status: 2, summary: longLegacy, result: {} },
        })

        const fresh = await prisma.caseMaterials.findUnique({ where: { id: mat.id } })
        const snapshot = await snapshotMaterialReadiness([
            { ...fresh!, ossFileId: ossFile.id, type: CaseMaterialType.AUDIO } as any,
        ])

        // 识别记录表 status=2 → 视为已识别，但旧逐字稿被过滤掉视为无摘要 → summarizing
        expect(snapshot[0]!.status).toBe('summarizing')
    })

    it('全 PENDING + 无识别记录：返回 pending', async () => {
        const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
        const mat = await createTestMaterial({
            caseId: testCase.id,
            type: CaseMaterialType.DOCUMENT,
            ossFileId: ossFile.id,
        })
        await prisma.caseMaterials.update({
            where: { id: mat.id },
            data: { status: MaterialStatus.PENDING },
        })
        testIds.materialIds.push(mat.id)

        const fresh = await prisma.caseMaterials.findUnique({ where: { id: mat.id } })
        const snapshot = await snapshotMaterialReadiness([
            { ...fresh!, ossFileId: ossFile.id, type: CaseMaterialType.DOCUMENT } as any,
        ])

        expect(snapshot[0]!.status).toBe('pending')
    })

    it('case_materials.status=PROCESSING 且识别记录表无成功：返回 recognizing', async () => {
        const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
        const mat = await createTestMaterial({
            caseId: testCase.id,
            type: CaseMaterialType.DOCUMENT,
            ossFileId: ossFile.id,
        })
        await prisma.caseMaterials.update({
            where: { id: mat.id },
            data: { status: MaterialStatus.PROCESSING },
        })
        testIds.materialIds.push(mat.id)

        const fresh = await prisma.caseMaterials.findUnique({ where: { id: mat.id } })
        const snapshot = await snapshotMaterialReadiness([
            { ...fresh!, ossFileId: ossFile.id, type: CaseMaterialType.DOCUMENT } as any,
        ])

        expect(snapshot[0]!.status).toBe('recognizing')
    })

    it('空数组：返回空', async () => {
        const snapshot = await snapshotMaterialReadiness([])
        expect(snapshot).toEqual([])
    })
})
