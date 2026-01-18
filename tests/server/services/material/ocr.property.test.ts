/**
 * 图片识别服务属性测试
 * 
 * 使用 fast-check 进行基于属性的测试
 * 
 * **Feature: 案件分析系统**
 * **Validates: Requirements 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.9**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fc from 'fast-check'
import { createImageRecognitionByBase64Service } from '../../../../server/services/material/ocr.service'

// 测试用户 ID
const TEST_USER_ID = 1

// 测试数据清理列表
const testOssFileIds: number[] = []
const testRecordIds: number[] = []

// 有效的 20x20 像素 PNG 图片 base64 (满足最小尺寸要求 > 14px)
const VALID_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAAXNSR0IArs4c6QAAAEFJREFUOE9jZKAyYKSyeQyjYfQwjIbxwWEYDZfRwzAlGEbD6GEYDaOHYTQMHobRMHoYRsPoYRgNg4dhNAwehtEwQAQA76YB9WjQ/YoAAAAASUVORK5CYII='

// 支持的图片类型
const SUPPORTED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
]

// 不支持的图片类型
const UNSUPPORTED_MIME_TYPES = [
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
    'application/pdf',
    'text/plain',
]

describe('图片识别服务属性测试', () => {
    let dbAvailable = false

    beforeAll(async () => {
        // 检查数据库是否可用
        try {
            await prisma.$queryRaw`SELECT 1`
            dbAvailable = true
        } catch (error) {
            console.warn('数据库不可用，跳过属性测试')
            dbAvailable = false
        }
    })

    afterAll(async () => {
        if (dbAvailable) {
            // 清理测试数据
            if (testRecordIds.length > 0) {
                await prisma.imageRecognitionRecords.deleteMany({
                    where: { id: { in: testRecordIds } },
                })
            }

            if (testOssFileIds.length > 0) {
                await prisma.ossFiles.deleteMany({
                    where: { id: { in: testOssFileIds } },
                })
            }

            await prisma.$disconnect()
        }
    })

    describe('10.3.1 属性 1：识别成功时创建完整记录', () => {
        it('Property 1: 识别成功时创建完整记录', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // 使用 fast-check 生成随机测试数据
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...SUPPORTED_MIME_TYPES), // 随机选择支持的 MIME 类型
                    fc.string({ minLength: 5, maxLength: 50 }), // 随机文件名
                    async (mimeType, fileName) => {
                        // Arrange: 创建测试 OSS 文件
                        const ossFile = await prisma.ossFiles.create({
                            data: {
                                userId: TEST_USER_ID,
                                bucketName: 'test-bucket',
                                fileName: `${fileName}.${mimeType.split('/')[1]}`,
                                filePath: `test/ocr/${Date.now()}/${fileName}`,
                                fileType: mimeType,
                                fileSize: Buffer.from(VALID_IMAGE_BASE64, 'base64').length,
                                status: 1,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            },
                        })
                        testOssFileIds.push(ossFile.id)

                        // Act: 调用业务方法进行识别
                        const result = await createImageRecognitionByBase64Service(
                            VALID_IMAGE_BASE64,
                            mimeType,
                            ossFile.id,
                            TEST_USER_ID
                        )

                        // Assert: 验证识别成功
                        expect(result.success).toBe(true)
                        expect(result.record).toBeDefined()
                        expect(result.record.id).toBeGreaterThan(0)
                        expect(result.record.status).toBe(2) // COMPLETED
                        expect(result.record.markdownContent).toBeDefined()
                        expect(result.record.markdownContent).not.toBe('')
                        expect(result.record.htmlContent).toBeDefined()
                        expect(result.record.htmlContent).not.toBe('')
                        expect(result.error).toBeUndefined()

                        // 保存记录 ID 用于清理
                        if (result.record) {
                            testRecordIds.push(result.record.id)
                        }
                    }
                ),
                {
                    numRuns: 100, // 至少 100 次迭代
                    verbose: true,
                }
            )
        }, 300000) // 5 分钟超时
    })

    describe('10.3.2 属性 2：识别失败时不创建记录', () => {
        it('Property 2: 识别失败时不创建记录', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // 使用 fast-check 生成随机的无效数据
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...UNSUPPORTED_MIME_TYPES), // 随机选择不支持的 MIME 类型
                    fc.string({ minLength: 5, maxLength: 50 }), // 随机文件名
                    async (mimeType, fileName) => {
                        // Arrange: 创建测试 OSS 文件（不支持的类型）
                        const ossFile = await prisma.ossFiles.create({
                            data: {
                                userId: TEST_USER_ID,
                                bucketName: 'test-bucket',
                                fileName: `${fileName}.${mimeType.split('/')[1] || 'unknown'}`,
                                filePath: `test/ocr/${Date.now()}/${fileName}`,
                                fileType: mimeType,
                                fileSize: 1024,
                                status: 1,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            },
                        })
                        testOssFileIds.push(ossFile.id)

                        // Act: 调用业务方法进行识别
                        const result = await createImageRecognitionByBase64Service(
                            VALID_IMAGE_BASE64,
                            mimeType,
                            ossFile.id,
                            TEST_USER_ID
                        )

                        // Assert: 验证识别失败且不创建记录
                        expect(result.success).toBe(false)
                        expect(result.error).toBeDefined()
                        expect(result.error).toContain('不支持识别')
                        expect(result.record).toBeNull()

                        // 验证数据库中没有创建记录
                        const records = await prisma.imageRecognitionRecords.findMany({
                            where: { ossFileId: ossFile.id, deletedAt: null },
                        })
                        expect(records.length).toBe(0)
                    }
                ),
                {
                    numRuns: 100, // 至少 100 次迭代
                    verbose: true,
                }
            )
        }, 60000) // 1 分钟超时
    })

    describe('10.3.3 属性 3：重复识别的幂等性', () => {
        it('Property 3: 重复识别的幂等性', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // 使用 fast-check 生成随机图片数据
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...SUPPORTED_MIME_TYPES), // 随机选择支持的 MIME 类型
                    fc.string({ minLength: 5, maxLength: 50 }), // 随机文件名
                    fc.integer({ min: 2, max: 5 }), // 随机重复次数
                    async (mimeType, fileName, repeatCount) => {
                        // Arrange: 创建测试 OSS 文件
                        const ossFile = await prisma.ossFiles.create({
                            data: {
                                userId: TEST_USER_ID,
                                bucketName: 'test-bucket',
                                fileName: `${fileName}.${mimeType.split('/')[1]}`,
                                filePath: `test/ocr/${Date.now()}/${fileName}`,
                                fileType: mimeType,
                                fileSize: Buffer.from(VALID_IMAGE_BASE64, 'base64').length,
                                status: 1,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            },
                        })
                        testOssFileIds.push(ossFile.id)

                        // Act: 多次调用识别服务
                        const results = []
                        for (let i = 0; i < repeatCount; i++) {
                            const result = await createImageRecognitionByBase64Service(
                                VALID_IMAGE_BASE64,
                                mimeType,
                                ossFile.id,
                                TEST_USER_ID
                            )
                            results.push(result)
                        }

                        // Assert: 验证所有调用都成功
                        results.forEach(result => {
                            expect(result.success).toBe(true)
                            expect(result.record).toBeDefined()
                        })

                        // 验证所有调用返回相同的记录 ID
                        const firstRecordId = results[0].record.id
                        results.forEach(result => {
                            expect(result.record.id).toBe(firstRecordId)
                        })
                        testRecordIds.push(firstRecordId)

                        // 验证数据库中只有一条有效记录
                        const activeRecords = await prisma.imageRecognitionRecords.findMany({
                            where: { ossFileId: ossFile.id, deletedAt: null },
                        })
                        expect(activeRecords.length).toBe(1)
                        expect(activeRecords[0].id).toBe(firstRecordId)
                    }
                ),
                {
                    numRuns: 100, // 至少 100 次迭代
                    verbose: true,
                }
            )
        }, 300000) // 5 分钟超时
    })

    describe('10.3.4 属性 4：失败记录的重试机制', () => {
        it('Property 4: 失败记录的重试机制', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // 使用 fast-check 生成随机图片数据
            await fc.assert(
                fc.asyncProperty(
                    fc.constantFrom(...SUPPORTED_MIME_TYPES), // 随机选择支持的 MIME 类型
                    fc.string({ minLength: 5, maxLength: 50 }), // 随机文件名
                    async (mimeType, fileName) => {
                        // Arrange: 创建测试 OSS 文件
                        const ossFile = await prisma.ossFiles.create({
                            data: {
                                userId: TEST_USER_ID,
                                bucketName: 'test-bucket',
                                fileName: `${fileName}.${mimeType.split('/')[1]}`,
                                filePath: `test/ocr/${Date.now()}/${fileName}`,
                                fileType: mimeType,
                                fileSize: Buffer.from(VALID_IMAGE_BASE64, 'base64').length,
                                status: 1,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            },
                        })
                        testOssFileIds.push(ossFile.id)

                        // 创建一个失败的识别记录（模拟之前的失败）
                        const failedRecord = await prisma.imageRecognitionRecords.create({
                            data: {
                                userId: TEST_USER_ID,
                                ossFileId: ossFile.id,
                                status: 3, // FAILED
                                imageType: null,
                                markdownContent: null,
                                htmlContent: null,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            },
                        })
                        testRecordIds.push(failedRecord.id)

                        // Act: 重新识别
                        const result = await createImageRecognitionByBase64Service(
                            VALID_IMAGE_BASE64,
                            mimeType,
                            ossFile.id,
                            TEST_USER_ID
                        )

                        // Assert: 验证识别成功
                        expect(result.success).toBe(true)
                        expect(result.record).toBeDefined()
                        expect(result.record.id).not.toBe(failedRecord.id) // 新记录
                        testRecordIds.push(result.record.id)

                        // 验证旧记录被软删除
                        const oldRecord = await prisma.imageRecognitionRecords.findUnique({
                            where: { id: failedRecord.id },
                        })
                        expect(oldRecord).not.toBeNull()
                        expect(oldRecord?.deletedAt).not.toBeNull()

                        // 验证只有一条有效记录
                        const activeRecords = await prisma.imageRecognitionRecords.findMany({
                            where: { ossFileId: ossFile.id, deletedAt: null },
                        })
                        expect(activeRecords.length).toBe(1)
                        expect(activeRecords[0].id).toBe(result.record.id)
                        expect(activeRecords[0].status).toBe(2) // COMPLETED
                    }
                ),
                {
                    numRuns: 100, // 至少 100 次迭代
                    verbose: true,
                }
            )
        }, 300000) // 5 分钟超时
    })
})
