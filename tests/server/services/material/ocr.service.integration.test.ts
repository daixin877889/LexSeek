/**
 * 图片识别服务集成测试
 * 
 * 使用真实的 AI 服务和数据库进行测试
 * 
 * **Feature: 案件分析系统**
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9**
 * 
 * **注意**：
 * - 豆包 AI 服务要求图片最小尺寸为 14x14 像素
 * - 成功场景的测试需要使用真实的、足够大的图片
 * - 当前测试使用的是 10x10 像素的测试图片，会触发 AI 服务的尺寸限制
 * - 失败场景的测试不依赖 AI 服务，可以正常运行
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createImageRecognitionByBase64Service } from '../../../../server/services/material/ocr.service'

// 测试用户 ID
const TEST_USER_ID = 1

// 测试数据清理列表
const testOssFileIds: number[] = []
const testRecordIds: number[] = []

// 测试图片 base64 数据（20x20 像素的有效 PNG 图片，满足 AI 服务最小 14x14 的限制）
const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAAXNSR0IArs4c6QAAAB1JREFUOE9j/P///38GPgMqZiQ0o2E4GkajYTAaBgA2bQ/1f4GqzwAAAABJRU5ErkJggg=='
const TEST_IMAGE_MIME_TYPE = 'image/png'

describe('图片识别服务集成测试', () => {
    let dbAvailable = false

    // 增加测试超时时间，因为 AI 服务响应可能较慢
    const TEST_TIMEOUT = 120000

    beforeAll(async () => {
        // 检查数据库是否可用
        try {
            await prisma.$queryRaw`SELECT 1`
            dbAvailable = true
        } catch (error) {
            console.warn('数据库不可用，跳过集成测试')
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

    describe('10.2.1 测试识别成功场景', () => {
        it('识别成功时应创建记录', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // Arrange: 准备测试 OSS 文件
            const ossFile = await prisma.ossFiles.create({
                data: {
                    userId: TEST_USER_ID,
                    bucketName: 'test-bucket',
                    fileName: 'test-success.png',
                    filePath: `test/ocr/${Date.now()}/test-success.png`,
                    fileType: TEST_IMAGE_MIME_TYPE,
                    fileSize: Buffer.from(TEST_IMAGE_BASE64, 'base64').length,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testOssFileIds.push(ossFile.id)

            // Act: 调用业务方法进行识别
            const result = await createImageRecognitionByBase64Service(
                TEST_IMAGE_BASE64,
                TEST_IMAGE_MIME_TYPE,
                ossFile.id,
                TEST_USER_ID
            )

            // Assert: 验证识别成功
            expect(result.success).toBe(true)
            expect(result.record).toBeDefined()
            expect(result.record.id).toBeGreaterThan(0)
            expect(result.error).toBeUndefined()

            // 保存记录 ID 用于清理
            if (result.record) {
                testRecordIds.push(result.record.id)
            }
        }, TEST_TIMEOUT)

        it('识别成功时记录的 status 应为 COMPLETED', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // Arrange: 准备测试 OSS 文件
            const ossFile = await prisma.ossFiles.create({
                data: {
                    userId: TEST_USER_ID,
                    bucketName: 'test-bucket',
                    fileName: 'test-status.png',
                    filePath: `test/ocr/${Date.now()}/test-status.png`,
                    fileType: TEST_IMAGE_MIME_TYPE,
                    fileSize: Buffer.from(TEST_IMAGE_BASE64, 'base64').length,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testOssFileIds.push(ossFile.id)

            // Act: 调用业务方法进行识别
            const result = await createImageRecognitionByBase64Service(
                TEST_IMAGE_BASE64,
                TEST_IMAGE_MIME_TYPE,
                ossFile.id,
                TEST_USER_ID
            )

            // Assert: 验证记录状态为 COMPLETED (2)
            expect(result.success).toBe(true)
            expect(result.record).toBeDefined()
            expect(result.record.status).toBe(2) // ImageRecognitionStatus.COMPLETED

            if (result.record) {
                testRecordIds.push(result.record.id)
            }
        }, TEST_TIMEOUT)

        it('识别成功时记录应包含 markdownContent 和 htmlContent', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // Arrange: 准备测试 OSS 文件
            const ossFile = await prisma.ossFiles.create({
                data: {
                    userId: TEST_USER_ID,
                    bucketName: 'test-bucket',
                    fileName: 'test-content.png',
                    filePath: `test/ocr/${Date.now()}/test-content.png`,
                    fileType: TEST_IMAGE_MIME_TYPE,
                    fileSize: Buffer.from(TEST_IMAGE_BASE64, 'base64').length,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testOssFileIds.push(ossFile.id)

            // Act: 调用业务方法进行识别
            const result = await createImageRecognitionByBase64Service(
                TEST_IMAGE_BASE64,
                TEST_IMAGE_MIME_TYPE,
                ossFile.id,
                TEST_USER_ID
            )

            // Assert: 验证记录包含内容
            expect(result.success).toBe(true)
            expect(result.record).toBeDefined()
            expect(result.record.markdownContent).toBeDefined()
            expect(result.record.markdownContent).not.toBe('')
            expect(result.record.htmlContent).toBeDefined()
            expect(result.record.htmlContent).not.toBe('')

            if (result.record) {
                testRecordIds.push(result.record.id)
            }
        }, TEST_TIMEOUT)
    })

    describe('10.2.2 测试识别失败场景', () => {
        it('图片类型不支持时不应创建记录', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // Arrange: 准备测试 OSS 文件（不支持的类型）
            const ossFile = await prisma.ossFiles.create({
                data: {
                    userId: TEST_USER_ID,
                    bucketName: 'test-bucket',
                    fileName: 'test-unsupported.bmp',
                    filePath: `test/ocr/${Date.now()}/test-unsupported.bmp`,
                    fileType: 'image/bmp', // 不支持的类型
                    fileSize: 1024,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testOssFileIds.push(ossFile.id)

            // Act: 调用业务方法进行识别
            const result = await createImageRecognitionByBase64Service(
                TEST_IMAGE_BASE64,
                'image/bmp', // 不支持的类型
                ossFile.id,
                TEST_USER_ID
            )

            // Assert: 验证识别失败且不创建记录
            expect(result.success).toBe(false)
            expect(result.error).toContain('不支持识别')
            expect(result.record).toBeNull()

            // 验证数据库中没有创建记录
            const records = await prisma.imageRecognitionRecords.findMany({
                where: { ossFileId: ossFile.id, deletedAt: null },
            })
            expect(records.length).toBe(0)
        })

        it('OSS 文件不存在时不应创建记录', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // Act: 使用不存在的 OSS 文件 ID
            const nonExistentOssFileId = 999999999
            const result = await createImageRecognitionByBase64Service(
                TEST_IMAGE_BASE64,
                TEST_IMAGE_MIME_TYPE,
                nonExistentOssFileId,
                TEST_USER_ID
            )

            // Assert: 验证识别失败且不创建记录
            expect(result.success).toBe(false)
            expect(result.error).toBe('OSS 文件不存在')
            expect(result.record).toBeNull()

            // 验证数据库中没有创建记录
            const records = await prisma.imageRecognitionRecords.findMany({
                where: { ossFileId: nonExistentOssFileId, deletedAt: null },
            })
            expect(records.length).toBe(0)
        })
    })

    describe('10.2.3 测试重复识别场景', () => {
        it('已有成功记录时应直接返回现有记录', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // Arrange: 准备测试 OSS 文件
            const ossFile = await prisma.ossFiles.create({
                data: {
                    userId: TEST_USER_ID,
                    bucketName: 'test-bucket',
                    fileName: 'test-duplicate.png',
                    filePath: `test/ocr/${Date.now()}/test-duplicate.png`,
                    fileType: TEST_IMAGE_MIME_TYPE,
                    fileSize: Buffer.from(TEST_IMAGE_BASE64, 'base64').length,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testOssFileIds.push(ossFile.id)

            // Act: 第一次识别
            const firstResult = await createImageRecognitionByBase64Service(
                TEST_IMAGE_BASE64,
                TEST_IMAGE_MIME_TYPE,
                ossFile.id,
                TEST_USER_ID
            )

            expect(firstResult.success).toBe(true)
            expect(firstResult.record).toBeDefined()
            const firstRecordId = firstResult.record.id
            testRecordIds.push(firstRecordId)

            // Act: 第二次识别（重复）
            const secondResult = await createImageRecognitionByBase64Service(
                TEST_IMAGE_BASE64,
                TEST_IMAGE_MIME_TYPE,
                ossFile.id,
                TEST_USER_ID
            )

            // Assert: 验证返回相同的记录
            expect(secondResult.success).toBe(true)
            expect(secondResult.record).toBeDefined()
            expect(secondResult.record.id).toBe(firstRecordId)

            // 验证数据库中只有一条记录
            const records = await prisma.imageRecognitionRecords.findMany({
                where: { ossFileId: ossFile.id, deletedAt: null },
            })
            expect(records.length).toBe(1)
            expect(records[0].id).toBe(firstRecordId)
        })

        it('已有失败记录时应软删除旧记录并重新识别', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // Arrange: 准备测试 OSS 文件
            const ossFile = await prisma.ossFiles.create({
                data: {
                    userId: TEST_USER_ID,
                    bucketName: 'test-bucket',
                    fileName: 'test-retry.png',
                    filePath: `test/ocr/${Date.now()}/test-retry.png`,
                    fileType: TEST_IMAGE_MIME_TYPE,
                    fileSize: Buffer.from(TEST_IMAGE_BASE64, 'base64').length,
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
                TEST_IMAGE_BASE64,
                TEST_IMAGE_MIME_TYPE,
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
        })

        it('验证不创建重复记录 - 同一文件只有一条有效记录', async () => {
            if (!dbAvailable) {
                console.warn('跳过测试：数据库不可用')
                return
            }

            // Arrange: 准备测试 OSS 文件
            const ossFile = await prisma.ossFiles.create({
                data: {
                    userId: TEST_USER_ID,
                    bucketName: 'test-bucket',
                    fileName: 'test-unique.png',
                    filePath: `test/ocr/${Date.now()}/test-unique.png`,
                    fileType: TEST_IMAGE_MIME_TYPE,
                    fileSize: Buffer.from(TEST_IMAGE_BASE64, 'base64').length,
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testOssFileIds.push(ossFile.id)

            // Act: 多次调用识别服务
            const results = []
            for (let i = 0; i < 3; i++) {
                const result = await createImageRecognitionByBase64Service(
                    TEST_IMAGE_BASE64,
                    TEST_IMAGE_MIME_TYPE,
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
        })
    })
})
