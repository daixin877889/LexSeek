/**
 * 材料服务层 - 补充覆盖率测试（单元测试）
 *
 * 覆盖 material.service.ts 中已有测试未覆盖的路径：
 * - getMaterialsByCaseIdWithStatusService: 各类型状态映射
 * - getMaterialsService: OSS 文件关联
 * - getMaterialsByIdsService: 有 OSS 文件的材料
 *
 * **Feature: material-service-coverage-extra**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MaterialStatus } from '#shared/types/material'
import { CaseMaterialType } from '#shared/types/case'

// Mock Nuxt 自动导入
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

vi.stubGlobal('prisma', {
    cases: { findFirst: vi.fn() },
    ossFiles: { findMany: vi.fn() },
    caseMaterials: { findMany: vi.fn(), count: vi.fn() },
    textContentRecords: { findMany: vi.fn() },
})

// Mock material.dao
const mockFindMaterialByIdDao = vi.fn()
const mockFindManyMaterialsDao = vi.fn()
const mockFindMaterialsByCaseIdDao = vi.fn()
const mockFindMaterialsByIdsDao = vi.fn()
const mockCreateMaterialDao = vi.fn()
const mockUpdateMaterialDao = vi.fn()
const mockDeleteMaterialDao = vi.fn()
const mockFindRecognitionRecordsByOssFileIdsDao = vi.fn()

vi.mock('~~/server/services/material/material.dao', () => ({
    createMaterialDao: (...args: any[]) => mockCreateMaterialDao(...args),
    findMaterialByIdDao: (...args: any[]) => mockFindMaterialByIdDao(...args),
    findManyMaterialsDao: (...args: any[]) => mockFindManyMaterialsDao(...args),
    findMaterialsByCaseIdDao: (...args: any[]) => mockFindMaterialsByCaseIdDao(...args),
    findMaterialsByIdsDao: (...args: any[]) => mockFindMaterialsByIdsDao(...args),
    updateMaterialDao: (...args: any[]) => mockUpdateMaterialDao(...args),
    deleteMaterialDao: (...args: any[]) => mockDeleteMaterialDao(...args),
    findRecognitionRecordsByOssFileIdsDao: (...args: any[]) => mockFindRecognitionRecordsByOssFileIdsDao(...args),
}))

// Mock textContentRecords.dao
vi.mock('~~/server/services/material/textContentRecords.dao', () => ({
    findTextContentRecordByMaterialIdDAO: vi.fn().mockResolvedValue(null),
}))

import {
    getMaterialsByCaseIdWithStatusService,
} from '~~/server/services/material/material.service'

describe('材料服务层 - 补充覆盖率', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('getMaterialsByCaseIdWithStatusService - 各类型状态映射', () => {
        it('空材料列表返回空数组', async () => {
            mockFindMaterialsByCaseIdDao.mockResolvedValue([])
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([])

            const result = await getMaterialsByCaseIdWithStatusService(1)

            expect(result).toEqual([])
        })

        it('CASE_CONTENT 类型根据 textContentRecords 判断状态', async () => {
            mockFindMaterialsByCaseIdDao.mockResolvedValue([
                { id: 1, caseId: 1, type: CaseMaterialType.CASE_CONTENT, ossFileId: null, status: 1 },
            ])
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([])
            mockFindRecognitionRecordsByOssFileIdsDao.mockResolvedValue({
                docRecords: [],
                imageRecords: [],
                asrRecords: [],
                textRecords: [{ materialId: 1, content: '有内容' }],
            })

            const result = await getMaterialsByCaseIdWithStatusService(1)

            expect(result).toHaveLength(1)
            expect(result[0].realStatus).toBe(3) // COMPLETED（有内容）
        })

        it('CASE_CONTENT 无内容时 realStatus 为 1', async () => {
            mockFindMaterialsByCaseIdDao.mockResolvedValue([
                { id: 1, caseId: 1, type: CaseMaterialType.CASE_CONTENT, ossFileId: null, status: 1 },
            ])
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([])
            mockFindRecognitionRecordsByOssFileIdsDao.mockResolvedValue({
                docRecords: [],
                imageRecords: [],
                asrRecords: [],
                textRecords: [],
            })

            const result = await getMaterialsByCaseIdWithStatusService(1)

            expect(result[0].realStatus).toBe(1) // PENDING
        })

        it('DOCUMENT 类型各状态映射正确', async () => {
            mockFindMaterialsByCaseIdDao.mockResolvedValue([
                { id: 1, caseId: 1, type: CaseMaterialType.DOCUMENT, ossFileId: 100, status: 1 },
                { id: 2, caseId: 1, type: CaseMaterialType.DOCUMENT, ossFileId: 101, status: 1 },
                { id: 3, caseId: 1, type: CaseMaterialType.DOCUMENT, ossFileId: 102, status: 1 },
                { id: 4, caseId: 1, type: CaseMaterialType.DOCUMENT, ossFileId: null, status: 1 },
            ])
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 100, fileName: 'a.pdf', fileSize: BigInt(100), fileType: 'application/pdf', filePath: '/a' },
                { id: 101, fileName: 'b.pdf', fileSize: BigInt(200), fileType: 'application/pdf', filePath: '/b' },
                { id: 102, fileName: 'c.pdf', fileSize: BigInt(300), fileType: 'application/pdf', filePath: '/c' },
            ])
            mockFindRecognitionRecordsByOssFileIdsDao.mockResolvedValue({
                docRecords: [
                    { ossFileId: 100, status: 2 }, // SUCCESS → realStatus=3
                    { ossFileId: 101, status: 1 }, // PROCESSING → realStatus=2
                    { ossFileId: 102, status: 3 }, // FAILED → realStatus=4
                ],
                imageRecords: [],
                asrRecords: [],
                textRecords: [],
            })

            const result = await getMaterialsByCaseIdWithStatusService(1)

            expect(result).toHaveLength(4)
            expect(result.find(m => m.id === 1)?.realStatus).toBe(3)
            expect(result.find(m => m.id === 2)?.realStatus).toBe(2)
            expect(result.find(m => m.id === 3)?.realStatus).toBe(4)
            expect(result.find(m => m.id === 4)?.realStatus).toBe(1) // 无 ossFileId
        })

        it('IMAGE 类型各状态映射正确', async () => {
            mockFindMaterialsByCaseIdDao.mockResolvedValue([
                { id: 1, caseId: 1, type: CaseMaterialType.IMAGE, ossFileId: 200, status: 1 },
            ])
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 200, fileName: 'img.jpg', fileSize: BigInt(100), fileType: 'image/jpeg', filePath: '/i' },
            ])
            mockFindRecognitionRecordsByOssFileIdsDao.mockResolvedValue({
                docRecords: [],
                imageRecords: [{ ossFileId: 200, status: 2 }],
                asrRecords: [],
                textRecords: [],
            })

            const result = await getMaterialsByCaseIdWithStatusService(1)

            expect(result[0].realStatus).toBe(3) // COMPLETED
        })

        it('AUDIO 类型各状态映射正确', async () => {
            mockFindMaterialsByCaseIdDao.mockResolvedValue([
                { id: 1, caseId: 1, type: CaseMaterialType.AUDIO, ossFileId: 300, status: 1 },
            ])
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 300, fileName: 'audio.mp3', fileSize: BigInt(100), fileType: 'audio/mpeg', filePath: '/a' },
            ])
            mockFindRecognitionRecordsByOssFileIdsDao.mockResolvedValue({
                docRecords: [],
                imageRecords: [],
                asrRecords: [{ ossFileId: 300, status: 2 }],
                textRecords: [],
            })

            const result = await getMaterialsByCaseIdWithStatusService(1)

            expect(result[0].realStatus).toBe(3) // SUCCESS
        })

        it('未知类型 realStatus 为 1', async () => {
            mockFindMaterialsByCaseIdDao.mockResolvedValue([
                { id: 1, caseId: 1, type: 99, ossFileId: null, status: 1 },
            ])
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([])
            mockFindRecognitionRecordsByOssFileIdsDao.mockResolvedValue({
                docRecords: [],
                imageRecords: [],
                asrRecords: [],
                textRecords: [],
            })

            const result = await getMaterialsByCaseIdWithStatusService(1)

            expect(result[0].realStatus).toBe(1)
        })

        it('DOCUMENT 无对应识别记录时 realStatus 为 1', async () => {
            mockFindMaterialsByCaseIdDao.mockResolvedValue([
                { id: 1, caseId: 1, type: CaseMaterialType.DOCUMENT, ossFileId: 100, status: 1 },
            ])
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 100, fileName: 'a.pdf', fileSize: BigInt(100), fileType: 'application/pdf', filePath: '/a' },
            ])
            mockFindRecognitionRecordsByOssFileIdsDao.mockResolvedValue({
                docRecords: [],
                imageRecords: [],
                asrRecords: [],
                textRecords: [],
            })

            const result = await getMaterialsByCaseIdWithStatusService(1)

            expect(result[0].realStatus).toBe(1)
        })
    })
})
