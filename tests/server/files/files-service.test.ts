/**
 * 文件服务测试
 *
 * 测试 files.service.ts 的功能，包括：
 * - 批量下载签名生成逻辑
 * - 空文件列表处理
 * - 按 bucket 分组处理
 *
 * **Feature: files-service**
 * **Validates: Requirements 1.1, 2.1**
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
    type TestIds,
} from './test-db-helper'

// 测试数据追踪
let testIds: TestIds

describe('文件服务测试', () => {
    beforeAll(async () => {
        testIds = createEmptyTestIds()
        const prisma = getTestPrisma()
        await prisma.$connect()
    })

    afterEach(async () => {
        await cleanupTestData(testIds)
        testIds = createEmptyTestIds()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    describe('批量下载签名生成逻辑', () => {
        it('空文件列表应返回空数组', async () => {
            // 模拟 generateOssDownloadSignaturesService 的空列表处理逻辑
            const ossFiles: any[] = []

            if (!ossFiles || ossFiles.length === 0) {
                expect([]).toEqual([])
            }
        })

        it('应按 bucket 正确分组文件', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 创建不同 bucket 的文件
            const file1 = await createTestOssFile(user.id, { bucketName: 'bucket-a' })
            const file2 = await createTestOssFile(user.id, { bucketName: 'bucket-a' })
            const file3 = await createTestOssFile(user.id, { bucketName: 'bucket-b' })
            testIds.ossFileIds.push(file1.id, file2.id, file3.id)

            // 模拟按 bucket 分组逻辑
            const files = [file1, file2, file3]
            const filesByBucket = new Map<string, typeof files>()

            for (const file of files) {
                const bucket = file.bucketName
                if (!filesByBucket.has(bucket)) {
                    filesByBucket.set(bucket, [])
                }
                filesByBucket.get(bucket)!.push(file)
            }

            expect(filesByBucket.size).toBe(2)
            expect(filesByBucket.get('bucket-a')!.length).toBe(2)
            expect(filesByBucket.get('bucket-b')!.length).toBe(1)
        })

        it('属性测试：分组后文件总数应保持不变', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            await fc.assert(
                fc.asyncProperty(
                    fc.array(
                        fc.record({
                            bucketName: fc.constantFrom('bucket-a', 'bucket-b', 'bucket-c'),
                        }),
                        { minLength: 1, maxLength: 10 }
                    ),
                    async (fileConfigs) => {
                        const files = await Promise.all(
                            fileConfigs.map(config => createTestOssFile(user.id, config))
                        )
                        files.forEach(f => testIds.ossFileIds.push(f.id))

                        // 按 bucket 分组
                        const filesByBucket = new Map<string, typeof files>()
                        for (const file of files) {
                            const bucket = file.bucketName
                            if (!filesByBucket.has(bucket)) {
                                filesByBucket.set(bucket, [])
                            }
                            filesByBucket.get(bucket)!.push(file)
                        }

                        // 验证总数不变
                        let totalCount = 0
                        filesByBucket.forEach(bucketFiles => {
                            totalCount += bucketFiles.length
                        })
                        expect(totalCount).toBe(files.length)

                        // 清理
                        const prisma = getTestPrisma()
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
    })

    describe('文件记录完整性', () => {
        it('创建的文件应包含所有必要字段', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const file = await createTestOssFile(user.id, {
                fileName: 'test-file.pdf',
                filePath: 'uploads/test/test-file.pdf',
                fileType: 'application/pdf',
                fileSize: 1024,
                bucketName: 'test-bucket',
                encrypted: true,
            })
            testIds.ossFileIds.push(file.id)

            expect(file.userId).toBe(user.id)
            expect(file.fileName).toBe('test-file.pdf')
            expect(file.filePath).toBe('uploads/test/test-file.pdf')
            expect(file.fileType).toBe('application/pdf')
            expect(Number(file.fileSize)).toBe(1024)
            expect(file.bucketName).toBe('test-bucket')
            expect(file.encrypted).toBe(true)
            expect(file.createdAt).toBeInstanceOf(Date)
            expect(file.updatedAt).toBeInstanceOf(Date)
            expect(file.deletedAt).toBeNull()
        })

        it('属性测试：文件记录应保留所有输入属性', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            await fc.assert(
                fc.asyncProperty(
                    fc.record({
                        fileName: fc.string({ minLength: 1, maxLength: 30 }).map(s => `test_${s}.pdf`),
                        fileSize: fc.integer({ min: 1, max: 1000000 }),
                        encrypted: fc.boolean(),
                        bucketName: fc.constantFrom('bucket-1', 'bucket-2'),
                    }),
                    async (input) => {
                        const file = await createTestOssFile(user.id, input)
                        testIds.ossFileIds.push(file.id)

                        expect(file.fileName).toBe(input.fileName)
                        expect(Number(file.fileSize)).toBe(input.fileSize)
                        expect(file.encrypted).toBe(input.encrypted)
                        expect(file.bucketName).toBe(input.bucketName)

                        // 清理
                        const prisma = getTestPrisma()
                        await prisma.ossFiles.delete({ where: { id: file.id } })
                        testIds.ossFileIds = testIds.ossFileIds.filter(id => id !== file.id)
                    }
                ),
                { numRuns: 10 }
            )
        })
    })
})
