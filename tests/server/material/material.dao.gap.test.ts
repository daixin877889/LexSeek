/**
 * 材料 DAO 层 catch 分支覆盖测试
 *
 * 补充 material.dao.ts 中各函数 catch 分支（Proxy 故障注入），
 * 以及 findMaterialsByIdsDao 正常路径、findRecognitionRecordsByOssFileIdsDao 分支。
 *
 * **Feature: server-test-coverage**
 * **Validates: material.dao.ts catch 分支完整覆盖**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import './test-setup'
import {
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestMaterial,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    type CaseTestIds,
} from './test-db-helper'
import {
    createMaterialDao,
    findMaterialByIdDao,
    findManyMaterialsDao,
    findMaterialsByCaseIdDao,
    findMaterialsByIdsDao,
    updateMaterialDao,
    deleteMaterialDao,
    findRecognitionRecordsByOssFileIdsDao,
} from '../../../server/services/material/material.dao'
import { CaseMaterialType } from '../../../shared/types/case'
import { MaterialStatus } from '../../../shared/types/material'

/** 故障注入 */
const withFaultyPrisma = async (fn: () => Promise<void>) => {
    const original = (globalThis as any).prisma
    ; (globalThis as any).prisma = new Proxy({}, {
        get: () => {
            throw new Error('injected-fault')
        },
    })
    try {
        await fn()
    } finally {
        ; (globalThis as any).prisma = original
    }
}

describe('材料 DAO - catch 分支与边界覆盖', () => {
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
        testCase = await createTestCase({ userId: testUser.id, caseTypeId: testCaseType.id })
        testIds.caseIds.push(testCase.id)
    })

    afterEach(async () => {
        if (testIds.materialIds.length > 0) {
            await cleanupTestData({
                ...createEmptyTestIds(),
                materialIds: [...testIds.materialIds],
            })
            testIds.materialIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    describe('findMaterialsByIdsDao - 正常路径', () => {
        it('应返回指定 ID 列表的材料', async () => {
            const m1 = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.CASE_CONTENT })
            const m2 = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.CASE_CONTENT })
            testIds.materialIds.push(m1.id, m2.id)

            const list = await findMaterialsByIdsDao([m1.id, m2.id])
            const ids = list.map(x => x.id).sort()
            expect(ids).toEqual([m1.id, m2.id].sort())
        })

        it('已软删除的材料不会被返回', async () => {
            const m = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(m.id)
            await deleteMaterialDao(m.id)
            const list = await findMaterialsByIdsDao([m.id])
            expect(list.length).toBe(0)
        })
    })

    describe('findRecognitionRecordsByOssFileIdsDao', () => {
        it('ossFileIds 和 materialIds 都为空时应返回空数组', async () => {
            const result = await findRecognitionRecordsByOssFileIdsDao([], [])
            expect(result.docRecords).toEqual([])
            expect(result.imageRecords).toEqual([])
            expect(result.asrRecords).toEqual([])
            expect(result.textRecords).toEqual([])
        })

        it('仅传入 materialIds 应只查询 textRecords', async () => {
            const m = await createTestMaterial({ caseId: testCase.id })
            testIds.materialIds.push(m.id)
            const result = await findRecognitionRecordsByOssFileIdsDao([], [m.id])
            expect(Array.isArray(result.docRecords)).toBe(true)
            expect(Array.isArray(result.imageRecords)).toBe(true)
            expect(Array.isArray(result.asrRecords)).toBe(true)
            expect(Array.isArray(result.textRecords)).toBe(true)
            // 可能 textRecords 为空（未插入记录），但结构应正确
        })

        it('仅传入 ossFileIds 应只查询三个识别表', async () => {
            const result = await findRecognitionRecordsByOssFileIdsDao([999999], [])
            // 对不存在的 ossFileId，三个识别表都应返回空数组，textRecords 也为空
            expect(result.docRecords).toEqual([])
            expect(result.imageRecords).toEqual([])
            expect(result.asrRecords).toEqual([])
            expect(result.textRecords).toEqual([])
        })
    })

    describe('catch 分支 - prisma 抛错应透传', () => {
        it('createMaterialDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    createMaterialDao({
                        caseId: testCase.id,
                        name: 'x',
                        type: CaseMaterialType.CASE_CONTENT,
                    })
                ).rejects.toThrow('injected-fault')
            })
        })

        it('findMaterialByIdDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findMaterialByIdDao(1)).rejects.toThrow('injected-fault')
            })
        })

        it('findManyMaterialsDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findManyMaterialsDao({})).rejects.toThrow('injected-fault')
            })
        })

        it('findMaterialsByCaseIdDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findMaterialsByCaseIdDao(1)).rejects.toThrow('injected-fault')
            })
        })

        it('findMaterialsByIdsDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(findMaterialsByIdsDao([1])).rejects.toThrow('injected-fault')
            })
        })

        it('updateMaterialDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(
                    updateMaterialDao(1, { name: 'x', status: MaterialStatus.COMPLETED })
                ).rejects.toThrow('injected-fault')
            })
        })

        it('deleteMaterialDao', async () => {
            await withFaultyPrisma(async () => {
                await expect(deleteMaterialDao(1)).rejects.toThrow('injected-fault')
            })
        })
    })
})
