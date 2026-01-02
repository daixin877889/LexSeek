/**
 * OSS 文件数据访问层测试
 *
 * 测试 ossFiles.dao.ts 的功能，包括：
 * - 创建文件记录
 * - 批量创建文件记录
 * - 查询文件记录
 * - 软删除文件记录
 * - 获取用户存储用量
 *
 * **Feature: oss-files-dao**
 * **Validates: Requirements 1.1, 1.2, 2.1**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
    getTestPrisma,
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    disconnectTestDb,
    createEmptyTestIds,
    TEST_FILE_PREFIX,
    FileSource,
    OssFileStatus,
    type TestIds,
} from './test-db-helper'

// 测试数据追踪
let testIds: TestIds

describe('OSS 文件数据访问层测试', () => {
    beforeAll(async () => {
        testIds = createEmptyTestIds()
        const prisma = getTestPrisma()
        await prisma.$connect()
        // 重置序列
        await prisma.$executeRaw`SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1000))`
        await prisma.$executeRaw`SELECT setval('oss_files_id_seq', GREATEST((SELECT MAX(id) FROM oss_files), 1000))`
    })

    afterEach(async () => {
        await cleanupTestData(testIds)
        testIds = createEmptyTestIds()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    describe('创建文件记录', () => {
        it('应成功创建单个文件记录', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const file = await createTestOssFile(user.id, {
                fileName: 'test-document.pdf',
                fileSize: 2048,
            })
            testIds.ossFileIds.push(file.id)

            expect(file.id).toBeGreaterThan(0)
            expect(file.userId).toBe(user.id)
            expect(file.fileName).toBe('test-document.pdf')
            expect(Number(file.fileSize)).toBe(2048)
        })

        it('属性测试：创建的文件记录应保留所有输入属性', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        fileName: fc.string({ minLength: 1, maxLength: 50 }).map(s => `${TEST_FILE_PREFIX}${s}.pdf`),
                        fileSize: fc.integer({ min: 1, max: 10000000 }),
                        encrypted: fc.boolean(),
                    }),
                    async (input) => {
                        const file = await createTestOssFile(user.id, input)
                        testIds.ossFileIds.push(file.id)

                        expect(file.fileName).toBe(input.fileName)
                        expect(Number(file.fileSize)).toBe(input.fileSize)
                        expect(file.encrypted).toBe(input.encrypted)
                    }
                ),
                { numRuns: 10 }
            )
        })
    })

    describe('查询文件记录', () => {
        it('应根据 ID 查找文件记录', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const file = await createTestOssFile(user.id)
            testIds.ossFileIds.push(file.id)

            const prisma = getTestPrisma()
            const found = await prisma.ossFiles.findFirst({
                where: { id: file.id, deletedAt: null },
            })

            expect(found).not.toBeNull()
            expect(found!.id).toBe(file.id)
        })

        it('应批量查找文件记录', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const files = await Promise.all([
                createTestOssFile(user.id, { fileName: 'file1.pdf' }),
                createTestOssFile(user.id, { fileName: 'file2.pdf' }),
                createTestOssFile(user.id, { fileName: 'file3.pdf' }),
            ])
            files.forEach(f => testIds.ossFileIds.push(f.id))

            const prisma = getTestPrisma()
            const found = await prisma.ossFiles.findMany({
                where: { id: { in: files.map(f => f.id) }, deletedAt: null },
            })

            expect(found.length).toBe(3)
        })

        it('已删除的文件不应被查询到', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const file = await createTestOssFile(user.id)
            testIds.ossFileIds.push(file.id)

            const prisma = getTestPrisma()
            // 软删除
            await prisma.ossFiles.update({
                where: { id: file.id },
                data: { deletedAt: new Date() },
            })

            const found = await prisma.ossFiles.findFirst({
                where: { id: file.id, deletedAt: null },
            })

            expect(found).toBeNull()
        })
    })

    describe('软删除文件记录', () => {
        it('软删除应设置 deletedAt 字段', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const file = await createTestOssFile(user.id)
            testIds.ossFileIds.push(file.id)

            const prisma = getTestPrisma()
            await prisma.ossFiles.update({
                where: { id: file.id },
                data: { deletedAt: new Date() },
            })

            const deleted = await prisma.ossFiles.findUnique({
                where: { id: file.id },
            })

            expect(deleted).not.toBeNull()
            expect(deleted!.deletedAt).not.toBeNull()
        })

        it('批量软删除应正确处理多个文件', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const files = await Promise.all([
                createTestOssFile(user.id),
                createTestOssFile(user.id),
            ])
            files.forEach(f => testIds.ossFileIds.push(f.id))

            const prisma = getTestPrisma()
            await prisma.ossFiles.updateMany({
                where: { id: { in: files.map(f => f.id) } },
                data: { deletedAt: new Date() },
            })

            const remaining = await prisma.ossFiles.findMany({
                where: { id: { in: files.map(f => f.id) }, deletedAt: null },
            })

            expect(remaining.length).toBe(0)
        })
    })

    describe('用户存储用量统计', () => {
        it('应正确计算用户文件总大小', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const files = await Promise.all([
                createTestOssFile(user.id, { fileSize: 1000 }),
                createTestOssFile(user.id, { fileSize: 2000 }),
                createTestOssFile(user.id, { fileSize: 3000 }),
            ])
            files.forEach(f => testIds.ossFileIds.push(f.id))

            const prisma = getTestPrisma()
            const result = await prisma.ossFiles.aggregate({
                where: { userId: user.id, deletedAt: null },
                _sum: { fileSize: true },
                _count: { id: true },
            })

            expect(Number(result._sum.fileSize)).toBe(6000)
            expect(result._count.id).toBe(3)
        })

        it('属性测试：用量统计应等于所有文件大小之和', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 100, max: 10000 }), { minLength: 1, maxLength: 5 }),
                    async (fileSizes) => {
                        const files = await Promise.all(
                            fileSizes.map(size => createTestOssFile(user.id, { fileSize: size }))
                        )
                        files.forEach(f => testIds.ossFileIds.push(f.id))

                        const prisma = getTestPrisma()
                        const result = await prisma.ossFiles.aggregate({
                            where: { userId: user.id, deletedAt: null },
                            _sum: { fileSize: true },
                        })

                        const expectedTotal = fileSizes.reduce((sum, size) => sum + size, 0)
                        expect(Number(result._sum.fileSize)).toBe(expectedTotal)

                        // 清理本次迭代的文件
                        await prisma.ossFiles.deleteMany({
                            where: { id: { in: files.map(f => f.id) } },
                        })
                        testIds.ossFileIds = testIds.ossFileIds.filter(
                            id => !files.map(f => f.id).includes(id)
                        )
                    }
                ),
                { numRuns: 5 }
            )
        })

        it('已删除文件不应计入用量', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const file1 = await createTestOssFile(user.id, { fileSize: 1000 })
            const file2 = await createTestOssFile(user.id, { fileSize: 2000 })
            testIds.ossFileIds.push(file1.id, file2.id)

            const prisma = getTestPrisma()
            // 软删除 file2
            await prisma.ossFiles.update({
                where: { id: file2.id },
                data: { deletedAt: new Date() },
            })

            const result = await prisma.ossFiles.aggregate({
                where: { userId: user.id, deletedAt: null },
                _sum: { fileSize: true },
            })

            expect(Number(result._sum.fileSize)).toBe(1000)
        })
    })

    describe('分页查询用户文件', () => {
        it('应正确分页返回文件列表', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建 5 个文件
            const files = await Promise.all(
                Array.from({ length: 5 }, (_, i) =>
                    createTestOssFile(user.id, { fileName: `file_${i}.pdf` })
                )
            )
            files.forEach(f => testIds.ossFileIds.push(f.id))

            const prisma = getTestPrisma()
            const page1 = await prisma.ossFiles.findMany({
                where: { userId: user.id, deletedAt: null, status: OssFileStatus.UPLOADED },
                skip: 0,
                take: 2,
                orderBy: { id: 'desc' },
            })

            const page2 = await prisma.ossFiles.findMany({
                where: { userId: user.id, deletedAt: null, status: OssFileStatus.UPLOADED },
                skip: 2,
                take: 2,
                orderBy: { id: 'desc' },
            })

            expect(page1.length).toBe(2)
            expect(page2.length).toBe(2)
            // 确保分页不重复
            const page1Ids = page1.map(f => f.id)
            const page2Ids = page2.map(f => f.id)
            expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false)
        })

        it('应按文件名模糊搜索', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            await createTestOssFile(user.id, { fileName: 'document_report.pdf' })
            await createTestOssFile(user.id, { fileName: 'image_photo.jpg' })
            await createTestOssFile(user.id, { fileName: 'document_invoice.pdf' })

            const files = await getTestPrisma().ossFiles.findMany({
                where: { userId: user.id, deletedAt: null },
            })
            files.forEach(f => testIds.ossFileIds.push(f.id))

            const prisma = getTestPrisma()
            const results = await prisma.ossFiles.findMany({
                where: {
                    userId: user.id,
                    deletedAt: null,
                    fileName: { contains: 'document', mode: 'insensitive' },
                },
            })

            expect(results.length).toBe(2)
            results.forEach(r => {
                expect(r.fileName.toLowerCase()).toContain('document')
            })
        })
    })
})
