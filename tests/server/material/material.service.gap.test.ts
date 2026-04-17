/**
 * 材料服务层 - 覆盖率补齐测试（gap）
 *
 * 目标：覆盖 material.service.ts 中未被现有测试覆盖的路径：
 * - getMaterialsService 关联 OSS 文件（行 100-120）
 * - getMaterialsByCaseIdWithStatusService DOCUMENT/IMAGE/AUDIO 类型 PROCESSING/FAILED 分支
 * - getMaterialsByIdsService 有 OSS 文件的材料（行 353-373）
 * - getCompletedMaterialsContentService 返回带内容的材料（行 431-442）
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 3.1, 3.2, 3.3**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestMaterial,
    createTestOssFile,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'
import {
    getMaterialsService,
    getMaterialsByCaseIdWithStatusService,
    getMaterialsByIdsService,
    getCompletedMaterialsContentService,
} from '../../../server/services/material/material.service'
import { MaterialStatus } from '../../../shared/types/material'
import { CaseMaterialType } from '../../../shared/types/case'

describe('材料服务层 - 覆盖率补齐（gap）', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>
    let testCase: Awaited<ReturnType<typeof createTestCase>>
    const createdTextContentIds: number[] = []

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
        testCase = await createTestCase({ userId: testUser.id, caseTypeId: testCaseType.id })
        testIds.caseIds.push(testCase.id)
    })

    afterEach(async () => {
        // 每个测试后清理本次材料
        if (testIds.materialIds.length > 0) {
            // 先清理 textContentRecords
            if (createdTextContentIds.length > 0) {
                try {
                    await getTestPrisma().textContentRecords.deleteMany({
                        where: { id: { in: createdTextContentIds } },
                    })
                } catch {
                    /* 忽略清理错误 */
                }
                createdTextContentIds.length = 0
            }
            await cleanupTestData({
                ...createEmptyTestIds(),
                materialIds: [...testIds.materialIds],
                ossFileIds: [...testIds.ossFileIds],
            })
            testIds.materialIds = []
            testIds.ossFileIds = []
        }
    })

    afterAll(async () => {
        // 最终 hard delete
        try {
            if (createdTextContentIds.length > 0) {
                await getTestPrisma().textContentRecords.deleteMany({
                    where: { id: { in: createdTextContentIds } },
                })
            }
        } catch {
            /* 忽略 */
        }
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('getMaterialsService - 分页列表带 OSS 文件关联', () => {
        it('应返回带文件信息的材料列表（含 ossFileId）', async () => {
            // 创建一个带 OSS 文件的材料
            const ossFile = await createTestOssFile(
                { userId: testUser.id, fileName: 'gap_list.pdf', fileSize: 2048 },
                testIds
            )
            testIds.ossFileIds.push(ossFile.id)

            const material = await createTestMaterial({
                caseId: testCase.id,
                ossFileId: ossFile.id,
                type: CaseMaterialType.DOCUMENT,
            })
            testIds.materialIds.push(material.id)

            // 同时创建一个无 OSS 文件的材料，验证 map 混合行为
            const materialNoFile = await createTestMaterial({
                caseId: testCase.id,
                ossFileId: null,
            })
            testIds.materialIds.push(materialNoFile.id)

            const result = await getMaterialsService({
                caseId: testCase.id,
                page: 1,
                pageSize: 100,
            })

            expect(result.total).toBeGreaterThanOrEqual(2)
            const found = result.list.find(m => m.id === material.id)
            expect(found).toBeDefined()
            expect(found?.fileName).toBe('gap_list.pdf')
            expect(found?.fileSize).toBe(2048)

            const noFile = result.list.find(m => m.id === materialNoFile.id)
            expect(noFile).toBeDefined()
            expect(noFile?.fileName).toBeUndefined()
        })
    })

    describe('getMaterialsByIdsService - 批量获取带 OSS 文件', () => {
        it('应返回带文件信息的材料列表', async () => {
            const ossFile = await createTestOssFile(
                { userId: testUser.id, fileName: 'gap_batch.pdf', fileSize: 4096 },
                testIds
            )
            testIds.ossFileIds.push(ossFile.id)

            const withFile = await createTestMaterial({
                caseId: testCase.id,
                ossFileId: ossFile.id,
                type: CaseMaterialType.DOCUMENT,
            })
            testIds.materialIds.push(withFile.id)

            const withoutFile = await createTestMaterial({
                caseId: testCase.id,
                ossFileId: null,
            })
            testIds.materialIds.push(withoutFile.id)

            const result = await getMaterialsByIdsService([withFile.id, withoutFile.id])

            expect(result.length).toBe(2)
            const hit = result.find(m => m.id === withFile.id)
            expect(hit?.fileName).toBe('gap_batch.pdf')
            expect(hit?.fileSize).toBe(4096)

            const miss = result.find(m => m.id === withoutFile.id)
            expect(miss?.fileName).toBeUndefined()
        })
    })

    describe('getMaterialsByCaseIdWithStatusService - DOCUMENT/IMAGE/AUDIO 的 PROCESSING/FAILED 分支', () => {
        it('DOCUMENT 类型 PROCESSING 和 FAILED 状态映射正确', async () => {
            const gapCase = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(gapCase.id)

            // 创建 OSS 文件
            const ossFileProcessing = await createTestOssFile(
                { userId: testUser.id, fileName: 'doc_processing.pdf' },
                testIds
            )
            testIds.ossFileIds.push(ossFileProcessing.id)

            const ossFileFailed = await createTestOssFile(
                { userId: testUser.id, fileName: 'doc_failed.pdf' },
                testIds
            )
            testIds.ossFileIds.push(ossFileFailed.id)

            // 创建 DOCUMENT 类型材料
            const matProcessing = await createTestMaterial({
                caseId: gapCase.id,
                type: CaseMaterialType.DOCUMENT,
                ossFileId: ossFileProcessing.id,
            })
            testIds.materialIds.push(matProcessing.id)

            const matFailed = await createTestMaterial({
                caseId: gapCase.id,
                type: CaseMaterialType.DOCUMENT,
                ossFileId: ossFileFailed.id,
            })
            testIds.materialIds.push(matFailed.id)

            // 创建对应的 docRecognitionRecords
            const docProcRec = await getTestPrisma().docRecognitionRecords.create({
                data: {
                    userId: testUser.id,
                    ossFileId: ossFileProcessing.id,
                    status: 1, // PROCESSING
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            const docFailedRec = await getTestPrisma().docRecognitionRecords.create({
                data: {
                    userId: testUser.id,
                    ossFileId: ossFileFailed.id,
                    status: 3, // FAILED
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            try {
                const result = await getMaterialsByCaseIdWithStatusService(gapCase.id)

                const procResult = result.find(r => r.id === matProcessing.id)
                const failedResult = result.find(r => r.id === matFailed.id)

                expect(procResult?.realStatus).toBe(2) // PROCESSING
                expect(failedResult?.realStatus).toBe(4) // FAILED
            } finally {
                await getTestPrisma().docRecognitionRecords.deleteMany({
                    where: { id: { in: [docProcRec.id, docFailedRec.id] } },
                })
            }
        })

        it('IMAGE 类型 PROCESSING 和 FAILED 状态映射正确', async () => {
            const gapCase = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(gapCase.id)

            const ossFileProc = await createTestOssFile(
                { userId: testUser.id, fileName: 'img_proc.jpg' },
                testIds
            )
            testIds.ossFileIds.push(ossFileProc.id)

            const ossFileFail = await createTestOssFile(
                { userId: testUser.id, fileName: 'img_fail.jpg' },
                testIds
            )
            testIds.ossFileIds.push(ossFileFail.id)

            const matProc = await createTestMaterial({
                caseId: gapCase.id,
                type: CaseMaterialType.IMAGE,
                ossFileId: ossFileProc.id,
            })
            testIds.materialIds.push(matProc.id)

            const matFail = await createTestMaterial({
                caseId: gapCase.id,
                type: CaseMaterialType.IMAGE,
                ossFileId: ossFileFail.id,
            })
            testIds.materialIds.push(matFail.id)

            const imgProcRec = await getTestPrisma().imageRecognitionRecords.create({
                data: {
                    userId: testUser.id,
                    ossFileId: ossFileProc.id,
                    status: 1, // PROCESSING
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            const imgFailRec = await getTestPrisma().imageRecognitionRecords.create({
                data: {
                    userId: testUser.id,
                    ossFileId: ossFileFail.id,
                    status: 3, // FAILED
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            try {
                const result = await getMaterialsByCaseIdWithStatusService(gapCase.id)
                expect(result.find(r => r.id === matProc.id)?.realStatus).toBe(2)
                expect(result.find(r => r.id === matFail.id)?.realStatus).toBe(4)
            } finally {
                await getTestPrisma().imageRecognitionRecords.deleteMany({
                    where: { id: { in: [imgProcRec.id, imgFailRec.id] } },
                })
            }
        })

        it('AUDIO 类型 PROCESSING 和 FAILED 状态映射正确', async () => {
            const gapCase = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(gapCase.id)

            const ossFileProc = await createTestOssFile(
                { userId: testUser.id, fileName: 'audio_proc.mp3', filePath: `test/gap/audio_proc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3` },
                testIds
            )
            testIds.ossFileIds.push(ossFileProc.id)

            const ossFileFail = await createTestOssFile(
                { userId: testUser.id, fileName: 'audio_fail.mp3', filePath: `test/gap/audio_fail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3` },
                testIds
            )
            testIds.ossFileIds.push(ossFileFail.id)

            const matProc = await createTestMaterial({
                caseId: gapCase.id,
                type: CaseMaterialType.AUDIO,
                ossFileId: ossFileProc.id,
            })
            testIds.materialIds.push(matProc.id)

            const matFail = await createTestMaterial({
                caseId: gapCase.id,
                type: CaseMaterialType.AUDIO,
                ossFileId: ossFileFail.id,
            })
            testIds.materialIds.push(matFail.id)

            const asrProcRec = await getTestPrisma().asrRecords.create({
                data: {
                    userId: testUser.id,
                    ossFileId: ossFileProc.id,
                    status: 1, // PROCESSING
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            const asrFailRec = await getTestPrisma().asrRecords.create({
                data: {
                    userId: testUser.id,
                    ossFileId: ossFileFail.id,
                    status: 3, // FAILED
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })

            try {
                const result = await getMaterialsByCaseIdWithStatusService(gapCase.id)
                expect(result.find(r => r.id === matProc.id)?.realStatus).toBe(2)
                expect(result.find(r => r.id === matFail.id)?.realStatus).toBe(4)
            } finally {
                await getTestPrisma().asrRecords.deleteMany({
                    where: { id: { in: [asrProcRec.id, asrFailRec.id] } },
                })
            }
        })
    })

    describe('getCompletedMaterialsContentService - 返回已完成且有 textContentRecord 的材料内容', () => {
        it('应返回带 content 的已完成材料', async () => {
            const gapCase = await createTestCase({
                userId: testUser.id,
                caseTypeId: testCaseType.id,
            })
            testIds.caseIds.push(gapCase.id)

            // 创建一个已完成状态材料
            const completed = await createTestMaterial({
                caseId: gapCase.id,
                name: '已完成有内容材料',
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.COMPLETED,
            })
            testIds.materialIds.push(completed.id)

            // 创建一个已完成状态但无 content 的材料（应被过滤）
            const completedNoContent = await createTestMaterial({
                caseId: gapCase.id,
                name: '已完成无内容材料',
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.COMPLETED,
            })
            testIds.materialIds.push(completedNoContent.id)

            // 为第一个材料创建 textContentRecord
            const textRecord = await getTestPrisma().textContentRecords.create({
                data: {
                    userId: testUser.id,
                    caseId: gapCase.id,
                    materialId: completed.id,
                    content: '材料的详细内容正文',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            createdTextContentIds.push(textRecord.id)

            const result = await getCompletedMaterialsContentService(gapCase.id)

            // 只有带 content 的材料被返回
            const hit = result.find(m => m.materialId === completed.id)
            expect(hit).toBeDefined()
            expect(hit?.content).toBe('材料的详细内容正文')
            expect(hit?.name).toBe('已完成有内容材料')

            // 无 content 的材料不应出现
            expect(result.find(m => m.materialId === completedNoContent.id)).toBeUndefined()
        })
    })
})
