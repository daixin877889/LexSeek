/**
 * 案件材料 DAO 层 - 补充覆盖率测试
 *
 * **Feature: case-material-dao-gap**
 * **Validates: Requirements 7.1, 7.2**
 *
 * 现有 caseMaterial.dao.test.ts 已覆盖 batchAddCaseMaterialsDAO / findByCaseIdDAO，
 * 本文件补齐：
 * - createSingleCaseMaterialDAO（成功 + 使用默认字段 + catch 分支）
 * - findMaterialByIdDAO（存在/不存在/catch 分支）
 * - findMaterialsByOssFileIdDAO（存在/不存在/catch 分支）
 * - batchAddCaseMaterialsDAO / findByCaseIdDAO 的 catch 分支
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestOssFile,
    createTestMaterial,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'
import {
    batchAddCaseMaterialsDAO,
    createSingleCaseMaterialDAO,
    findByCaseIdDAO,
    findMaterialByIdDAO,
    findMaterialsByOssFileIdDAO,
} from '../../../server/services/case/caseMaterial.dao'
import { MaterialStatus } from '../../../shared/types/material'
import { CaseMaterialType } from '../../../shared/types/case'

/**
 * 构造一个故障注入 Proxy：指定操作会抛错，其他调用返回目标字段
 * 用于覆盖 DAO 的 catch 分支（真实 prisma 很难触发）
 */
const makeFaultyClient = (errorFor: {
    createMany?: boolean
    create?: boolean
    findMany?: boolean
    findUnique?: boolean
}) => {
    const caseMaterialsStub: Record<string, unknown> = {
        createMany: errorFor.createMany
            ? async () => { throw new Error('mock createMany 异常') }
            : async () => ({ count: 0 }),
        create: errorFor.create
            ? async () => { throw new Error('mock create 异常') }
            : async () => ({ id: 0 }),
        findMany: errorFor.findMany
            ? async () => { throw new Error('mock findMany 异常') }
            : async () => [],
        findUnique: errorFor.findUnique
            ? async () => { throw new Error('mock findUnique 异常') }
            : async () => null,
    }
    return { caseMaterials: caseMaterialsStub } as any
}

describe('案件材料 DAO 层 - 补充覆盖率', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>
    let testCaseType: Awaited<ReturnType<typeof createTestCaseType>>
    let testCase: Awaited<ReturnType<typeof createTestCase>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
        testCaseType = await createTestCaseType({ status: 1 })
        testIds.caseTypeIds.push(testCaseType.id)
        testCase = await createTestCase({
            userId: testUser.id,
            caseTypeId: testCaseType.id,
        })
        testIds.caseIds.push(testCase.id)
    })

    afterEach(async () => {
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
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    // ==================== createSingleCaseMaterialDAO ====================

    describe('createSingleCaseMaterialDAO', () => {
        it('应成功创建单条材料并返回含 ID 的记录', async () => {
            const created = await createSingleCaseMaterialDAO(testCase.id, {
                name: '单条文本材料',
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.PENDING,
            })
            expect(created.id).toBeGreaterThan(0)
            expect(created.name).toBe('单条文本材料')
            expect(created.type).toBe(CaseMaterialType.CASE_CONTENT)
            expect(created.status).toBe(MaterialStatus.PENDING)
            expect(created.caseId).toBe(testCase.id)
            expect(created.ossFileId).toBeNull()
            expect(created.isEncrypted).toBe(false)

            testIds.materialIds.push(created.id)
        })

        it('未传 ossFileId/isEncrypted/status 时使用默认值', async () => {
            const created = await createSingleCaseMaterialDAO(testCase.id, {
                name: '使用默认值',
                type: CaseMaterialType.DOCUMENT,
            })
            expect(created.ossFileId).toBeNull()
            expect(created.isEncrypted).toBe(false)
            expect(created.status).toBe(1)

            testIds.materialIds.push(created.id)
        })

        it('传入 ossFileId 时应保存到记录', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'single_test.pdf',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            const created = await createSingleCaseMaterialDAO(testCase.id, {
                name: '带文件',
                type: CaseMaterialType.DOCUMENT,
                ossFileId: ossFile.id,
                isEncrypted: true,
                status: MaterialStatus.PROCESSING,
            })
            expect(created.ossFileId).toBe(ossFile.id)
            expect(created.isEncrypted).toBe(true)
            expect(created.status).toBe(MaterialStatus.PROCESSING)

            testIds.materialIds.push(created.id)
        })

        it('传入事务对象 tx 时应使用 tx.caseMaterials.create', async () => {
            // 使用真实事务（会在事务内创建并回滚）
            const prismaClient = getTestPrisma()
            let createdId = 0
            try {
                await prismaClient.$transaction(async (tx) => {
                    const record = await createSingleCaseMaterialDAO(testCase.id, {
                        name: '事务内创建',
                        type: CaseMaterialType.CASE_CONTENT,
                    }, tx)
                    createdId = record.id
                    // 触发回滚
                    throw new Error('rollback_on_purpose')
                })
            } catch (err: any) {
                expect(err.message).toBe('rollback_on_purpose')
            }

            // 回滚后记录不存在
            const fetched = await findMaterialByIdDAO(createdId)
            expect(fetched).toBeNull()
        })

        it('底层抛错时应记录日志并向上抛出（catch 分支）', async () => {
            const faulty = makeFaultyClient({ create: true })
            await expect(
                createSingleCaseMaterialDAO(testCase.id, {
                    name: 'X',
                    type: CaseMaterialType.CASE_CONTENT,
                }, faulty),
            ).rejects.toThrow('mock create 异常')
        })
    })

    // ==================== findMaterialByIdDAO ====================

    describe('findMaterialByIdDAO', () => {
        it('应返回存在的材料', async () => {
            const material = await createTestMaterial({
                caseId: testCase.id,
                name: '查询-存在',
                type: CaseMaterialType.CASE_CONTENT,
            })
            testIds.materialIds.push(material.id)

            const found = await findMaterialByIdDAO(material.id)
            expect(found).not.toBeNull()
            expect(found!.id).toBe(material.id)
            expect(found!.name).toBe('查询-存在')
        })

        it('材料不存在时返回 null', async () => {
            const found = await findMaterialByIdDAO(999999999)
            expect(found).toBeNull()
        })

        it('已软删除的材料不会被返回', async () => {
            const material = await createTestMaterial({
                caseId: testCase.id,
                name: '软删材料',
            })
            testIds.materialIds.push(material.id)

            // 软删除
            await getTestPrisma().caseMaterials.update({
                where: { id: material.id },
                data: { deletedAt: new Date() },
            })

            const found = await findMaterialByIdDAO(material.id)
            expect(found).toBeNull()
        })

        it('支持传入事务对象 tx', async () => {
            const material = await createTestMaterial({
                caseId: testCase.id,
                name: 'tx 查询',
            })
            testIds.materialIds.push(material.id)

            const prismaClient = getTestPrisma()
            const found = await prismaClient.$transaction(async (tx) => {
                return findMaterialByIdDAO(material.id, tx)
            })
            expect(found).not.toBeNull()
            expect(found!.id).toBe(material.id)
        })

        it('底层抛错时应记录日志并向上抛出（catch 分支）', async () => {
            const faulty = makeFaultyClient({ findUnique: true })
            await expect(findMaterialByIdDAO(1, faulty)).rejects.toThrow('mock findUnique 异常')
        })
    })

    // ==================== findMaterialsByOssFileIdDAO ====================

    describe('findMaterialsByOssFileIdDAO', () => {
        it('应返回关联指定 OSS 文件的所有材料', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'shared.pdf',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            const m1 = await createTestMaterial({
                caseId: testCase.id,
                name: '关联材料 1',
                ossFileId: ossFile.id,
            })
            const m2 = await createTestMaterial({
                caseId: testCase.id,
                name: '关联材料 2',
                ossFileId: ossFile.id,
            })
            testIds.materialIds.push(m1.id, m2.id)

            const list = await findMaterialsByOssFileIdDAO(ossFile.id)
            expect(list.length).toBe(2)
            expect(list.map(m => m.id).sort()).toEqual([m1.id, m2.id].sort())
        })

        it('没有材料关联时返回空数组', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'orphan.pdf',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            const list = await findMaterialsByOssFileIdDAO(ossFile.id)
            expect(list).toEqual([])
        })

        it('已软删除的材料不会返回', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'softdel.pdf',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            const m = await createTestMaterial({
                caseId: testCase.id,
                name: '待软删',
                ossFileId: ossFile.id,
            })
            testIds.materialIds.push(m.id)

            // 软删
            await getTestPrisma().caseMaterials.update({
                where: { id: m.id },
                data: { deletedAt: new Date() },
            })

            const list = await findMaterialsByOssFileIdDAO(ossFile.id)
            expect(list).toEqual([])
        })

        it('支持传入事务对象 tx', async () => {
            const ossFile = await createTestOssFile({
                fileName: 'tx_osslist.pdf',
                userId: testUser.id,
            })
            testIds.ossFileIds.push(ossFile.id)

            const m = await createTestMaterial({
                caseId: testCase.id,
                name: 'tx_list',
                ossFileId: ossFile.id,
            })
            testIds.materialIds.push(m.id)

            const prismaClient = getTestPrisma()
            const list = await prismaClient.$transaction(async (tx) => {
                return findMaterialsByOssFileIdDAO(ossFile.id, tx)
            })
            expect(list).toHaveLength(1)
            expect(list[0]!.id).toBe(m.id)
        })

        it('底层抛错时应记录日志并向上抛出（catch 分支）', async () => {
            const faulty = makeFaultyClient({ findMany: true })
            await expect(findMaterialsByOssFileIdDAO(1, faulty)).rejects.toThrow(
                'mock findMany 异常',
            )
        })
    })

    // ==================== 既有 DAO 的 catch 分支补齐 ====================

    describe('既有 DAO - catch 分支补齐', () => {
        it('batchAddCaseMaterialsDAO 底层 createMany 抛错时向上抛出', async () => {
            const faulty = makeFaultyClient({ createMany: true })
            await expect(
                batchAddCaseMaterialsDAO(testCase.id, [
                    {
                        name: 'catch',
                        type: CaseMaterialType.CASE_CONTENT,
                    },
                ], faulty),
            ).rejects.toThrow('mock createMany 异常')
        })

        it('findByCaseIdDAO 底层 findMany 抛错时向上抛出', async () => {
            const faulty = makeFaultyClient({ findMany: true })
            await expect(findByCaseIdDAO(testCase.id, faulty)).rejects.toThrow(
                'mock findMany 异常',
            )
        })
    })
})
