/**
 * OSS 文件 DAO 单元测试
 *
 * Mock prisma 客户端，测试所有 DAO 函数的逻辑分支
 *
 * **Feature: oss-files-dao-coverage**
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest'

// Mock Nuxt 自动导入的全局变量
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock prisma
const mockCreate = vi.fn()
const mockCreateManyAndReturn = vi.fn()
const mockFindFirst = vi.fn()
const mockFindUnique = vi.fn()
const mockFindMany = vi.fn()
const mockUpdate = vi.fn()
const mockUpdateMany = vi.fn()
const mockAggregate = vi.fn()
const mockCount = vi.fn()

vi.stubGlobal('prisma', {
    ossFiles: {
        create: mockCreate,
        createManyAndReturn: mockCreateManyAndReturn,
        findFirst: mockFindFirst,
        findUnique: mockFindUnique,
        findMany: mockFindMany,
        update: mockUpdate,
        updateMany: mockUpdateMany,
        aggregate: mockAggregate,
        count: mockCount,
    },
})

// Mock auto-imported enums and types
vi.stubGlobal('OssFileStatus', { PENDING: 0, UPLOADED: 1, FAILED: 2 })
vi.stubGlobal('FileSource', { FILE: 'FILE', ASR: 'ASR', DOC: 'DOC' })
vi.stubGlobal('FileSizeUnit', { BYTE: 'BYTE' })
vi.stubGlobal('FileType', { DOC: 'DOC', AUDIO: 'AUDIO', IMAGE: 'IMAGE', VIDEO: 'VIDEO', JSON: 'JSON', OTHER: 'OTHER' })
vi.stubGlobal('FileSortField', { createdAt: 'createdAt', fileSize: 'fileSize' })
vi.stubGlobal('SortOrder', { ASC: 'asc', DESC: 'desc' })
vi.stubGlobal('decimalToNumberUtils', (val: any) => val ? Number(val) : 0)

// 导入被测模块
import {
    createOssFileDao,
    createOssFilesDao,
    findOssFileByIdDao,
    findOssFileByIdIncludeDeletedDao,
    findOssFileByIdsDao,
    deleteFileDao,
    deleteOssFilesDao,
    ossUsageDao,
    updateOssFileDao,
    findOssFilesByUserIdDao,
    markOssFileUploadedByVerifyDao,
} from '~~/server/services/files/ossFiles.dao'
import { OssFileStatus } from '#shared/types/file'
import {
    getTestPrisma,
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    createEmptyTestIds,
} from './test-db-helper'

describe('OSS 文件 DAO 单元测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('createOssFileDao - 创建文件记录', () => {
        it('成功创建文件记录', async () => {
            const mockResult = { id: 1, fileName: 'test.pdf', source: 'FILE', fileSize: 1024 }
            mockCreate.mockResolvedValue(mockResult)

            const result = await createOssFileDao({ fileName: 'test.pdf' } as any)

            expect(result.id).toBe(1)
            expect(result.source).toBe('FILE')
        })

        it('创建失败时抛出错误', async () => {
            mockCreate.mockRejectedValue(new Error('数据库错误'))

            await expect(createOssFileDao({} as any)).rejects.toThrow('数据库错误')
        })

        it('支持事务客户端', async () => {
            const txCreate = vi.fn().mockResolvedValue({ id: 2, source: 'FILE', fileSize: 100 })
            const tx = { ossFiles: { create: txCreate } }

            await createOssFileDao({} as any, tx as any)

            expect(txCreate).toHaveBeenCalled()
            expect(mockCreate).not.toHaveBeenCalled()
        })
    })

    describe('createOssFilesDao - 批量创建文件记录', () => {
        it('成功批量创建', async () => {
            const mockResults = [
                { id: 1, fileName: 'a.pdf' },
                { id: 2, fileName: 'b.pdf' },
            ]
            mockCreateManyAndReturn.mockResolvedValue(mockResults)

            const result = await createOssFilesDao([{}, {}] as any)

            expect(result).toHaveLength(2)
        })

        it('批量创建失败时抛出错误', async () => {
            mockCreateManyAndReturn.mockRejectedValue(new Error('批量失败'))

            await expect(createOssFilesDao([{}] as any)).rejects.toThrow('批量失败')
        })
    })

    describe('findOssFileByIdDao - 根据 ID 查找文件', () => {
        it('找到文件时返回文件记录', async () => {
            mockFindFirst.mockResolvedValue({ id: 1, source: 'ASR' })

            const result = await findOssFileByIdDao(1)

            expect(result).not.toBeNull()
            expect(result!.id).toBe(1)
            expect(result!.source).toBe('ASR')
        })

        it('未找到文件时返回 null', async () => {
            mockFindFirst.mockResolvedValue(null)

            const result = await findOssFileByIdDao(999)

            expect(result).toBeNull()
        })

        it('查询失败时抛出错误', async () => {
            mockFindFirst.mockRejectedValue(new Error('查询失败'))

            await expect(findOssFileByIdDao(1)).rejects.toThrow('查询失败')
        })
    })

    describe('findOssFileByIdIncludeDeletedDao - 查找文件（包含已删除）', () => {
        it('找到文件时返回文件记录', async () => {
            mockFindUnique.mockResolvedValue({ id: 1, source: 'FILE', deletedAt: new Date() })

            const result = await findOssFileByIdIncludeDeletedDao(1)

            expect(result).not.toBeNull()
        })

        it('未找到文件时返回 null', async () => {
            mockFindUnique.mockResolvedValue(null)

            const result = await findOssFileByIdIncludeDeletedDao(999)

            expect(result).toBeNull()
        })
    })

    describe('findOssFileByIdsDao - 批量查找文件', () => {
        it('返回匹配的文件列表', async () => {
            mockFindMany.mockResolvedValue([
                { id: 1, source: 'FILE' },
                { id: 2, source: 'DOC' },
            ])

            const result = await findOssFileByIdsDao([1, 2])

            expect(result).toHaveLength(2)
            expect(result[0].source).toBe('FILE')
        })
    })

    describe('deleteFileDao - 软删除文件', () => {
        it('成功软删除文件', async () => {
            mockUpdate.mockResolvedValue({ id: 1 })

            const result = await deleteFileDao(1)

            expect(result).toBe(true)
            expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 1, deletedAt: null },
            }))
        })

        it('删除失败时抛出错误', async () => {
            mockUpdate.mockRejectedValue(new Error('删除失败'))

            await expect(deleteFileDao(999)).rejects.toThrow('删除失败')
        })
    })

    describe('deleteOssFilesDao - 批量软删除文件', () => {
        it('成功批量软删除', async () => {
            mockUpdateMany.mockResolvedValue({ count: 3 })

            const result = await deleteOssFilesDao([1, 2, 3])

            expect(result).toBe(true)
        })

        it('批量删除失败时抛出错误', async () => {
            mockUpdateMany.mockRejectedValue(new Error('批量删除失败'))

            await expect(deleteOssFilesDao([1])).rejects.toThrow('批量删除失败')
        })
    })

    describe('ossUsageDao - 获取用户 OSS 用量', () => {
        it('返回用户存储用量', async () => {
            mockAggregate.mockResolvedValue({
                _sum: { fileSize: 10240 },
                _count: { id: 5 },
            })

            const result = await ossUsageDao(1)

            expect(result.fileSize).toBe(10240)
            expect(result.count).toBe(5)
            expect(result.unit).toBe('Byte')
        })

        it('includeAllStatus 为 true 时不过滤状态', async () => {
            mockAggregate.mockResolvedValue({
                _sum: { fileSize: 0 },
                _count: { id: 0 },
            })

            await ossUsageDao(1, true)

            // 验证 aggregate 调用的 where 不包含 status
            const callArgs = mockAggregate.mock.calls[0][0]
            expect(callArgs.where.status).toBeUndefined()
        })

        it('fileSize 为 null 时返回 0', async () => {
            mockAggregate.mockResolvedValue({
                _sum: { fileSize: null },
                _count: { id: 0 },
            })

            const result = await ossUsageDao(1)

            expect(result.fileSize).toBe(0)
        })
    })

    describe('updateOssFileDao - 更新文件记录', () => {
        it('成功更新文件记录', async () => {
            const mockResult = { id: 1, fileName: 'updated.pdf', source: 'FILE', fileSize: 2048 }
            mockUpdate.mockResolvedValue(mockResult)

            const result = await updateOssFileDao(1, { fileName: 'updated.pdf' })

            expect(result.fileName).toBe('updated.pdf')
        })

        it('更新失败时抛出错误', async () => {
            mockUpdate.mockRejectedValue(new Error('更新失败'))

            await expect(updateOssFileDao(999, {})).rejects.toThrow('更新失败')
        })
    })

    describe('findOssFilesByUserIdDao - 获取用户文件列表', () => {
        it('返回分页文件列表', async () => {
            mockFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
            mockCount.mockResolvedValue(10)

            const result = await findOssFilesByUserIdDao(1, {
                page: 1,
                pageSize: 10,
            })

            expect(result.files).toHaveLength(2)
            expect(result.total).toBe(10)
        })

        it('支持文件类型筛选', async () => {
            mockFindMany.mockResolvedValue([])
            mockCount.mockResolvedValue(0)

            await findOssFilesByUserIdDao(1, {
                page: 1,
                pageSize: 10,
                fileType: 'DOC' as any,
            })

            // 验证 where 条件中包含 fileType
            const callArgs = mockFindMany.mock.calls[0][0]
            expect(callArgs.where.fileType).toBeDefined()
        })

        it('支持文件名模糊搜索', async () => {
            mockFindMany.mockResolvedValue([])
            mockCount.mockResolvedValue(0)

            await findOssFilesByUserIdDao(1, {
                page: 1,
                pageSize: 10,
                fileName: '合同',
            })

            const callArgs = mockFindMany.mock.calls[0][0]
            expect(callArgs.where.fileName).toEqual({
                contains: '合同',
                mode: 'insensitive',
            })
        })

        it('支持来源筛选', async () => {
            mockFindMany.mockResolvedValue([])
            mockCount.mockResolvedValue(0)

            await findOssFilesByUserIdDao(1, {
                page: 1,
                pageSize: 10,
                source: 'ASR' as any,
            })

            const callArgs = mockFindMany.mock.calls[0][0]
            expect(callArgs.where.source).toBe('ASR')
        })

        it('支持自定义排序', async () => {
            mockFindMany.mockResolvedValue([])
            mockCount.mockResolvedValue(0)

            await findOssFilesByUserIdDao(1, {
                page: 1,
                pageSize: 10,
                sortField: 'fileSize' as any,
                sortOrder: 'asc' as any,
            })

            const callArgs = mockFindMany.mock.calls[0][0]
            expect(callArgs.orderBy).toEqual({ fileSize: 'asc' })
        })

        it('默认按 ID 降序排列', async () => {
            mockFindMany.mockResolvedValue([])
            mockCount.mockResolvedValue(0)

            await findOssFilesByUserIdDao(1, {
                page: 1,
                pageSize: 10,
            })

            const callArgs = mockFindMany.mock.calls[0][0]
            expect(callArgs.orderBy).toEqual({ id: 'desc' })
        })

        it('查询失败时抛出错误', async () => {
            mockFindMany.mockRejectedValue(new Error('查询失败'))

            await expect(
                findOssFilesByUserIdDao(1, { page: 1, pageSize: 10 })
            ).rejects.toThrow('查询失败')
        })
    })
})

// ──────────────────────────────────────────────────────────────────────────────
// 集成测试：markOssFileUploadedByVerifyDao（使用真实 worker DB）
// ──────────────────────────────────────────────────────────────────────────────
describe('markOssFileUploadedByVerifyDao', () => {
    const testIds = createEmptyTestIds()
    let userId: number

    beforeAll(async () => {
        // 将全局 prisma 还原为真实的 worker DB，覆盖上方 mock-only 测试的 stub
        vi.stubGlobal('prisma', getTestPrisma())
        const user = await createTestUser()
        userId = user.id
        testIds.userIds.push(user.id)
    })

    afterEach(async () => {
        if (testIds.ossFileIds.length) {
            await getTestPrisma().ossFiles.deleteMany({
                where: { id: { in: testIds.ossFileIds } },
            })
            testIds.ossFileIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
    })

    async function makeRow(status: number, deletedAt: Date | null = null) {
        const file = await createTestOssFile(userId, { status })
        testIds.ossFileIds.push(file.id)
        if (deletedAt) {
            await getTestPrisma().ossFiles.update({
                where: { id: file.id },
                data: { deletedAt },
            })
        }
        return file
    }

    it('PENDING 时改成 UPLOADED 且 count=1', async () => {
        const row = await makeRow(OssFileStatus.PENDING)
        const count = await markOssFileUploadedByVerifyDao(row.id)
        expect(count).toBe(1)
        const fresh = await getTestPrisma().ossFiles.findUnique({ where: { id: row.id } })
        expect(fresh!.status).toBe(OssFileStatus.UPLOADED)
    })

    it('已 UPLOADED 不改 且 count=0', async () => {
        const row = await makeRow(OssFileStatus.UPLOADED)
        const count = await markOssFileUploadedByVerifyDao(row.id)
        expect(count).toBe(0)
    })

    it('FAILED 不改 且 count=0', async () => {
        const row = await makeRow(OssFileStatus.FAILED)
        const count = await markOssFileUploadedByVerifyDao(row.id)
        expect(count).toBe(0)
    })

    it('deletedAt 非 null 不改 且 count=0', async () => {
        const row = await makeRow(OssFileStatus.PENDING, new Date())
        const count = await markOssFileUploadedByVerifyDao(row.id)
        expect(count).toBe(0)
    })

    it('并发两次：只有一次 count=1', async () => {
        const row = await makeRow(OssFileStatus.PENDING)
        const [a, b] = await Promise.all([
            markOssFileUploadedByVerifyDao(row.id),
            markOssFileUploadedByVerifyDao(row.id),
        ])
        expect(a + b).toBe(1)
    })
})
