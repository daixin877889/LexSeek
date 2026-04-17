/**
 * 案件材料服务层 - 补充覆盖率测试
 *
 * **Feature: case-material-service-gap**
 * **Validates: Requirements 7.3**
 *
 * 原 caseMaterial.service.test.ts 已被 vitest.config.ts 排除，
 * 本文件用真实 prisma 覆盖 batchAddCaseMaterialsService 的所有分支：
 * - 空列表 early return
 * - 无效材料类型抛错
 * - 文本材料：content 缺失/空串/空白均抛错
 * - 文本材料：成功创建 caseMaterials + textContentRecords
 * - 文本材料：默认 name 回退为"案情描述"
 * - 文件材料：缺失 ossFileId 抛错
 * - 文件材料：OSS 文件不存在抛错
 * - 文件材料：OSS 文件非当前用户所有抛错
 * - 文件材料：type 纠正（前端传错 DOCUMENT 但文件是 image → 纠正为 IMAGE）
 * - 文件材料：ossFile.fileType 为 document 时保留 material.type（detectedType === DOCUMENT 分支）
 * - 文件材料：默认 name 回退为 ossFile.fileName
 * - 事务对象 tx 支持（回滚语义）
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestOssFile,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'
import { batchAddCaseMaterialsService } from '../../../server/services/case/caseMaterial.service'
import { findByCaseIdDAO } from '../../../server/services/case/caseMaterial.dao'
import { CaseMaterialType, type CaseMaterialParam } from '../../../shared/types/case'

/** 清理 textContentRecords 表中指定 caseId 对应的记录 */
const cleanupTextContentsByCaseIds = async (caseIds: number[]) => {
    if (caseIds.length === 0) return
    try {
        await getTestPrisma().textContentRecords.deleteMany({
            where: { caseId: { in: caseIds } },
        })
    } catch (err) {
        console.warn('清理 textContentRecords 失败：', err)
    }
}

describe('案件材料服务层 - 补充覆盖率', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let otherUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>
    let testCase: Awaited<ReturnType<typeof createTestCase>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        // 确保 phone 唯一，避免与 testUser 偶发冲突
        otherUser = await createTestUser({
            phone: `199${Date.now()}`.slice(0, 11),
            name: `其他用户_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        })
        testIds.userIds.push(otherUser.id)
        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
        testCase = await createTestCase({
            userId: testUser.id,
            caseTypeId: testCaseType.id,
        })
        testIds.caseIds.push(testCase.id)
    })

    afterEach(async () => {
        // 优先清理 textContentRecords（它引用 caseMaterials.id）
        await cleanupTextContentsByCaseIds(testIds.caseIds)

        const materialIdsToClean = [...testIds.materialIds]
        const ossFileIdsToClean = [...testIds.ossFileIds]
        if (materialIdsToClean.length > 0 || ossFileIdsToClean.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                materialIds: materialIdsToClean,
                ossFileIds: ossFileIdsToClean,
            })
        }
        testIds.materialIds = []
        testIds.ossFileIds = []
    })

    afterAll(async () => {
        await cleanupTextContentsByCaseIds(testIds.caseIds)
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    // ==================== 边界：空列表/无效类型 ====================

    describe('边界条件', () => {
        it('空数组应直接返回，不产生任何副作用', async () => {
            await batchAddCaseMaterialsService(testCase.id, testUser.id, [])
            const list = await findByCaseIdDAO(testCase.id)
            expect(list).toHaveLength(0)
        })

        it('null/undefined 材料列表也应直接返回（防御分支）', async () => {
            // 类型系统层面要求数组，这里强转以触发 early return 分支
            await batchAddCaseMaterialsService(
                testCase.id,
                testUser.id,
                null as unknown as CaseMaterialParam[],
            )
            const list = await findByCaseIdDAO(testCase.id)
            expect(list).toHaveLength(0)
        })

        it('无效材料类型应抛出错误', async () => {
            await expect(
                batchAddCaseMaterialsService(testCase.id, testUser.id, [
                    { type: 999 as CaseMaterialType, content: '无所谓' },
                ]),
            ).rejects.toThrow('无效的材料类型')
        })
    })

    // ==================== 文本材料 ====================

    describe('文本材料', () => {
        it('成功创建文本材料并写入 textContentRecords', async () => {
            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                {
                    type: CaseMaterialType.CASE_CONTENT,
                    name: '案情',
                    content: '原告起诉被告违反合同',
                },
            ])

            const list = await findByCaseIdDAO(testCase.id)
            expect(list).toHaveLength(1)
            expect(list[0]!.name).toBe('案情')
            expect(list[0]!.type).toBe(CaseMaterialType.CASE_CONTENT)
            testIds.materialIds.push(list[0]!.id)

            const text = await getTestPrisma().textContentRecords.findFirst({
                where: { materialId: list[0]!.id, deletedAt: null },
            })
            expect(text).not.toBeNull()
            expect(text!.content).toBe('原告起诉被告违反合同')
            expect(text!.htmlContent).toBe('原告起诉被告违反合同')
            expect(text!.userId).toBe(testUser.id)
            expect(text!.caseId).toBe(testCase.id)
        })

        it('未提供 name 时回退为"案情描述"', async () => {
            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                {
                    type: CaseMaterialType.CASE_CONTENT,
                    content: '仅有内容',
                },
            ])
            const list = await findByCaseIdDAO(testCase.id)
            expect(list[0]!.name).toBe('案情描述')
            testIds.materialIds.push(list[0]!.id)
        })

        it('缺失 content 字段时抛出"文本材料必须包含内容"', async () => {
            await expect(
                batchAddCaseMaterialsService(testCase.id, testUser.id, [
                    {
                        type: CaseMaterialType.CASE_CONTENT,
                        name: '缺内容',
                    },
                ]),
            ).rejects.toThrow('文本材料必须包含内容')
        })

        it('content 为空字符串时抛错', async () => {
            await expect(
                batchAddCaseMaterialsService(testCase.id, testUser.id, [
                    {
                        type: CaseMaterialType.CASE_CONTENT,
                        content: '',
                    },
                ]),
            ).rejects.toThrow('文本材料必须包含内容')
        })

        it('content 仅包含空白字符时抛错', async () => {
            await expect(
                batchAddCaseMaterialsService(testCase.id, testUser.id, [
                    {
                        type: CaseMaterialType.CASE_CONTENT,
                        content: '   \n\t  ',
                    },
                ]),
            ).rejects.toThrow('文本材料必须包含内容')
        })
    })

    // ==================== 文件材料 ====================

    describe('文件材料', () => {
        it('缺失 ossFileId 抛出错误', async () => {
            await expect(
                batchAddCaseMaterialsService(testCase.id, testUser.id, [
                    {
                        type: CaseMaterialType.DOCUMENT,
                        name: '缺文件ID',
                    },
                ]),
            ).rejects.toThrow('文件材料必须提供 OSS 文件 ID')
        })

        it('OSS 文件不存在时抛错', async () => {
            await expect(
                batchAddCaseMaterialsService(testCase.id, testUser.id, [
                    {
                        type: CaseMaterialType.DOCUMENT,
                        ossFileId: 999999999,
                    },
                ]),
            ).rejects.toThrow('OSS 文件不存在')
        })

        it('OSS 文件属于他人时抛出权限错误', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'other.pdf',
                userId: otherUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            await expect(
                batchAddCaseMaterialsService(testCase.id, testUser.id, [
                    {
                        type: CaseMaterialType.DOCUMENT,
                        ossFileId: ossFile.id,
                    },
                ]),
            ).rejects.toThrow('无权使用该文件')
        })

        it('成功创建文档材料并写入 caseMaterials', async () => {
            const ossFile = await createTestOssFile({
                fileName: '合同.pdf',
                fileType: 'application/pdf',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                {
                    type: CaseMaterialType.DOCUMENT,
                    name: '合同文件',
                    ossFileId: ossFile.id,
                },
            ])

            const list = await findByCaseIdDAO(testCase.id)
            expect(list).toHaveLength(1)
            expect(list[0]!.name).toBe('合同文件')
            expect(list[0]!.ossFileId).toBe(ossFile.id)
            expect(list[0]!.type).toBe(CaseMaterialType.DOCUMENT)
            testIds.materialIds.push(list[0]!.id)
        })

        it('前端错传 type 为 DOCUMENT 但 ossFile.fileType 是 image/* 时应纠正为 IMAGE', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'photo.png',
                fileType: 'image/png',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                {
                    // 前端误传 DOCUMENT
                    type: CaseMaterialType.DOCUMENT,
                    ossFileId: ossFile.id,
                },
            ])

            const list = await findByCaseIdDAO(testCase.id)
            expect(list).toHaveLength(1)
            // 服务端应根据 MIME 纠正为 IMAGE
            expect(list[0]!.type).toBe(CaseMaterialType.IMAGE)
            testIds.materialIds.push(list[0]!.id)
        })

        it('前端错传 type 为 DOCUMENT 但 ossFile.fileType 是 audio/* 时应纠正为 AUDIO', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'record.mp3',
                fileType: 'audio/mpeg',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                {
                    type: CaseMaterialType.DOCUMENT,
                    ossFileId: ossFile.id,
                },
            ])

            const list = await findByCaseIdDAO(testCase.id)
            expect(list[0]!.type).toBe(CaseMaterialType.AUDIO)
            testIds.materialIds.push(list[0]!.id)
        })

        it('detectedType === DOCUMENT 时保留 material.type（走 else 分支）', async () => {
            // 前端传 IMAGE 但实际文件是 application/pdf（detectedType=DOCUMENT）
            // 此时应保留 material.type=IMAGE，测试该分支
            const ossFile = await createTestOssFile({
                fileName: 'anything.pdf',
                fileType: 'application/pdf',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                {
                    type: CaseMaterialType.IMAGE,
                    ossFileId: ossFile.id,
                },
            ])

            const list = await findByCaseIdDAO(testCase.id)
            expect(list[0]!.type).toBe(CaseMaterialType.IMAGE)
            testIds.materialIds.push(list[0]!.id)
        })

        it('ossFile.fileType 为 null/空 时 detectedType=DOCUMENT，保留 material.type', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'no_mime.bin',
                fileType: '',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                {
                    type: CaseMaterialType.AUDIO,
                    ossFileId: ossFile.id,
                },
            ])

            const list = await findByCaseIdDAO(testCase.id)
            // detectedType=DOCUMENT（因 mime 空），保留 AUDIO
            expect(list[0]!.type).toBe(CaseMaterialType.AUDIO)
            testIds.materialIds.push(list[0]!.id)
        })

        it('未提供 name 时应使用 ossFile.fileName 作为材料名', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'default_name_test.pdf',
                fileType: 'application/pdf',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                {
                    type: CaseMaterialType.DOCUMENT,
                    ossFileId: ossFile.id,
                },
            ])

            const list = await findByCaseIdDAO(testCase.id)
            expect(list[0]!.name).toBe('default_name_test.pdf')
            testIds.materialIds.push(list[0]!.id)
        })

        it('ossFile.encrypted=true 时材料 isEncrypted=true', async () => {
            const ossFile = await getTestPrisma().ossFiles.create({
                data: {
                    fileName: 'secret.pdf',
                    filePath: 'path/secret.pdf',
                    fileSize: 1024,
                    fileType: 'application/pdf',
                    bucketName: 'test-bucket',
                    userId: testUser.id,
                    encrypted: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.ossFileIds.push(ossFile.id)

            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                {
                    type: CaseMaterialType.DOCUMENT,
                    ossFileId: ossFile.id,
                },
            ])

            const list = await findByCaseIdDAO(testCase.id)
            expect(list[0]!.isEncrypted).toBe(true)
            testIds.materialIds.push(list[0]!.id)
        })
    })

    // ==================== 混合 & 事务 ====================

    describe('混合材料 & 事务', () => {
        it('同时处理文本+文件+图片+音频材料', async () => {
            const docFile = await createTestOssFile({
                fileName: '合同.pdf',
                filePath: `test/mix/doc_${Date.now()}_1.pdf`,
                fileType: 'application/pdf',
                userId: testUser.id,
            })
            const imgFile = await createTestOssFile({
                fileName: '截图.jpg',
                filePath: `test/mix/img_${Date.now()}_2.jpg`,
                fileType: 'image/jpeg',
                userId: testUser.id,
            })
            const audFile = await createTestOssFile({
                fileName: '录音.mp3',
                filePath: `test/mix/aud_${Date.now()}_3.mp3`,
                fileType: 'audio/mpeg',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(docFile.id, imgFile.id, audFile.id)

            await batchAddCaseMaterialsService(testCase.id, testUser.id, [
                { type: CaseMaterialType.CASE_CONTENT, content: '案情描述内容' },
                { type: CaseMaterialType.DOCUMENT, ossFileId: docFile.id },
                { type: CaseMaterialType.IMAGE, ossFileId: imgFile.id },
                { type: CaseMaterialType.AUDIO, ossFileId: audFile.id },
            ])

            const list = await findByCaseIdDAO(testCase.id)
            expect(list).toHaveLength(4)
            const types = list.map(m => m.type).sort()
            expect(types).toEqual(
                [
                    CaseMaterialType.CASE_CONTENT,
                    CaseMaterialType.DOCUMENT,
                    CaseMaterialType.IMAGE,
                    CaseMaterialType.AUDIO,
                ].sort(),
            )
            testIds.materialIds.push(...list.map(m => m.id))
        })

        it('在事务对象中调用时，事务回滚后不应留下任何材料或文本记录', async () => {
            const prismaClient = getTestPrisma()
            const beforeMaterials = await findByCaseIdDAO(testCase.id)
            const beforeCount = beforeMaterials.length

            try {
                await prismaClient.$transaction(async (tx) => {
                    await batchAddCaseMaterialsService(
                        testCase.id,
                        testUser.id,
                        [
                            {
                                type: CaseMaterialType.CASE_CONTENT,
                                content: '事务内创建的内容',
                            },
                        ],
                        tx,
                    )
                    throw new Error('rollback_on_purpose')
                })
            } catch (err: any) {
                expect(err.message).toBe('rollback_on_purpose')
            }

            const afterMaterials = await findByCaseIdDAO(testCase.id)
            expect(afterMaterials.length).toBe(beforeCount)

            const leftovers = await prismaClient.textContentRecords.findMany({
                where: {
                    caseId: testCase.id,
                    content: '事务内创建的内容',
                    deletedAt: null,
                },
            })
            expect(leftovers).toHaveLength(0)
        })
    })
})
