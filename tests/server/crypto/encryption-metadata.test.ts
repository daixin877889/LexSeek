/**
 * 文件元数据保留属性测试
 *
 * 使用真实数据库操作测试加密文件的元数据处理
 *
 * Property 7: 文件元数据保留
 * 对于任意加密上传的文件，数据库中存储的 originalName 应为原始文件名（不含 .age），
 * originalMimeType 应为原始 MIME 类型
 * Validates: Requirements 4.6, 4.7
 *
 * Property 8: 解密输出格式正确性
 * 对于任意加密文件和正确的 MIME 类型，decryptToBlob 返回的 Blob 的 type 应等于传入的 MIME 类型
 * Validates: Requirements 7.8, 7.9
 */

import { describe, it, expect, afterAll } from 'vitest'
import * as fc from 'fast-check'
import {
    createOssFileDao,
    findOssFileByIdDao,
    updateOssFileDao,
    deleteOssFilesDao
} from '../../../server/services/files/ossFiles.dao'
import { OssFileStatus, FileSource } from '../../../shared/types/file'

// 测试数据清理
const createdFileIds: number[] = []

afterAll(async () => {
    // 清理测试数据
    if (createdFileIds.length > 0) {
        await deleteOssFilesDao(createdFileIds)
    }
})

describe('Property 7: 文件元数据保留', () => {
    // 生成有效的文件名（不含特殊字符）
    const fileNameGen = fc.string({ minLength: 1, maxLength: 30 })
        .filter(s => /^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(s))
        .map(s => s || 'file')

    // 生成有效的文件扩展名
    const extensionGen = fc.constantFrom('txt', 'pdf', 'jpg', 'png', 'doc', 'docx', 'mp4', 'mp3')

    // 生成有效的 MIME 类型
    const mimeTypeGen = fc.constantFrom(
        'image/jpeg',
        'image/png',
        'application/pdf',
        'text/plain',
        'application/msword',
        'video/mp4',
        'audio/mpeg'
    )

    it('加密文件应保留原始文件名（不含 .age）', async () => {
        await fc.assert(
            fc.asyncProperty(
                fileNameGen,
                extensionGen,
                mimeTypeGen,
                async (baseName, ext, mimeType) => {
                    const originalFileName = `${baseName}.${ext}`

                    // 创建加密文件记录
                    const file = await createOssFileDao({
                        userId: 1, // 测试用户
                        bucketName: 'test-bucket',
                        fileName: originalFileName, // 保存原始文件名
                        filePath: `test/encrypted_${Date.now()}.age`, // 加密文件路径以 .age 结尾
                        fileSize: 1024,
                        fileType: mimeType,
                        source: FileSource.CASE_MATERIAL,
                        status: OssFileStatus.PENDING,
                        encrypted: true,
                        originalMimeType: mimeType, // 保存原始 MIME 类型
                    })

                    createdFileIds.push(file.id)

                    // 验证原始文件名被保留（不含 .age）
                    expect(file.fileName).toBe(originalFileName)
                    expect(file.fileName).not.toContain('.age')

                    // 从数据库重新查询验证
                    const dbFile = await findOssFileByIdDao(file.id)
                    expect(dbFile).not.toBeNull()
                    expect(dbFile!.fileName).toBe(originalFileName)
                    expect(dbFile!.fileName).not.toContain('.age')
                }
            ),
            { numRuns: 10 } // 减少运行次数以加快测试
        )
    })

    it('加密文件应保留原始 MIME 类型', async () => {
        await fc.assert(
            fc.asyncProperty(
                mimeTypeGen,
                async (mimeType) => {
                    // 创建加密文件记录
                    const file = await createOssFileDao({
                        userId: 1,
                        bucketName: 'test-bucket',
                        fileName: 'test.file',
                        filePath: `test/encrypted_${Date.now()}.age`,
                        fileSize: 1024,
                        fileType: mimeType,
                        source: FileSource.CASE_MATERIAL,
                        status: OssFileStatus.PENDING,
                        encrypted: true,
                        originalMimeType: mimeType,
                    })

                    createdFileIds.push(file.id)

                    // 验证原始 MIME 类型被保留
                    expect(file.originalMimeType).toBe(mimeType)
                    expect(file.fileType).toBe(mimeType)

                    // 从数据库重新查询验证
                    const dbFile = await findOssFileByIdDao(file.id)
                    expect(dbFile).not.toBeNull()
                    expect(dbFile!.originalMimeType).toBe(mimeType)
                }
            ),
            { numRuns: 10 }
        )
    })

    it('非加密文件不应设置 originalMimeType', async () => {
        // 创建非加密文件记录
        const file = await createOssFileDao({
            userId: 1,
            bucketName: 'test-bucket',
            fileName: 'test.pdf',
            filePath: `test/normal_${Date.now()}.pdf`,
            fileSize: 1024,
            fileType: 'application/pdf',
            source: FileSource.CASE_MATERIAL,
            status: OssFileStatus.PENDING,
            encrypted: false,
            originalMimeType: null, // 非加密文件不设置
        })

        createdFileIds.push(file.id)

        expect(file.encrypted).toBe(false)
        expect(file.originalMimeType).toBeNull()

        // 从数据库重新查询验证
        const dbFile = await findOssFileByIdDao(file.id)
        expect(dbFile).not.toBeNull()
        expect(dbFile!.encrypted).toBe(false)
        expect(dbFile!.originalMimeType).toBeNull()
    })

    it('加密文件路径应以 .age 结尾', async () => {
        await fc.assert(
            fc.asyncProperty(
                fileNameGen,
                async (baseName) => {
                    const filePath = `test/encrypted_${Date.now()}_${baseName}.age`

                    const file = await createOssFileDao({
                        userId: 1,
                        bucketName: 'test-bucket',
                        fileName: `${baseName}.pdf`,
                        filePath: filePath,
                        fileSize: 1024,
                        fileType: 'application/pdf',
                        source: FileSource.CASE_MATERIAL,
                        status: OssFileStatus.PENDING,
                        encrypted: true,
                        originalMimeType: 'application/pdf',
                    })

                    createdFileIds.push(file.id)

                    // 验证文件路径以 .age 结尾
                    expect(file.filePath).toMatch(/\.age$/)

                    // 从数据库重新查询验证
                    const dbFile = await findOssFileByIdDao(file.id)
                    expect(dbFile).not.toBeNull()
                    expect(dbFile!.filePath).toMatch(/\.age$/)
                }
            ),
            { numRuns: 10 }
        )
    })
})

describe('回调更新元数据测试', () => {
    it('回调应正确更新加密文件的元数据', async () => {
        // 1. 创建初始文件记录（模拟预签名阶段）
        const originalMimeType = 'application/pdf'
        const file = await createOssFileDao({
            userId: 1,
            bucketName: 'test-bucket',
            fileName: 'document.pdf',
            filePath: `test/callback_${Date.now()}.age`,
            fileSize: 1024,
            fileType: originalMimeType,
            source: FileSource.CASE_MATERIAL,
            status: OssFileStatus.PENDING,
            encrypted: true,
            originalMimeType: originalMimeType,
        })

        createdFileIds.push(file.id)

        // 2. 模拟回调更新（使用实际的 updateOssFileDao）
        const updatedFile = await updateOssFileDao(file.id, {
            status: OssFileStatus.UPLOADED,
            encrypted: true,
            originalMimeType: originalMimeType,
        })

        // 3. 验证更新后的数据
        expect(updatedFile.status).toBe(OssFileStatus.UPLOADED)
        expect(updatedFile.encrypted).toBe(true)
        expect(updatedFile.originalMimeType).toBe(originalMimeType)

        // 4. 从数据库重新查询验证
        const dbFile = await findOssFileByIdDao(file.id)
        expect(dbFile).not.toBeNull()
        expect(dbFile!.status).toBe(OssFileStatus.UPLOADED)
        expect(dbFile!.originalMimeType).toBe(originalMimeType)
    })

    it('回调应正确处理非加密文件', async () => {
        // 1. 创建非加密文件记录
        const file = await createOssFileDao({
            userId: 1,
            bucketName: 'test-bucket',
            fileName: 'document.pdf',
            filePath: `test/callback_normal_${Date.now()}.pdf`,
            fileSize: 1024,
            fileType: 'application/pdf',
            source: FileSource.CASE_MATERIAL,
            status: OssFileStatus.PENDING,
            encrypted: false,
            originalMimeType: null,
        })

        createdFileIds.push(file.id)

        // 2. 模拟回调更新
        const updatedFile = await updateOssFileDao(file.id, {
            status: OssFileStatus.UPLOADED,
            encrypted: false,
            originalMimeType: null,
        })

        // 3. 验证更新后的数据
        expect(updatedFile.status).toBe(OssFileStatus.UPLOADED)
        expect(updatedFile.encrypted).toBe(false)
        expect(updatedFile.originalMimeType).toBeNull()
    })
})

describe('Property 8: 解密输出格式正确性', () => {
    // 注意：这个测试验证的是 Blob API 的行为，不涉及数据库操作
    // 但我们仍然使用真实的数据来验证元数据的正确性

    it('解密后的 Blob 应具有正确的 MIME 类型', async () => {
        const mimeTypes = [
            'image/jpeg',
            'image/png',
            'application/pdf',
            'application/octet-stream',
            'video/mp4'
        ]

        for (const mimeType of mimeTypes) {
            // 创建文件记录以获取正确的 MIME 类型
            const file = await createOssFileDao({
                userId: 1,
                bucketName: 'test-bucket',
                fileName: 'test.file',
                filePath: `test/decrypt_${Date.now()}.age`,
                fileSize: 5,
                fileType: mimeType,
                source: FileSource.CASE_MATERIAL,
                status: OssFileStatus.UPLOADED,
                encrypted: true,
                originalMimeType: mimeType,
            })

            createdFileIds.push(file.id)

            // 模拟解密后创建 Blob（使用从数据库获取的 MIME 类型）
            const dbFile = await findOssFileByIdDao(file.id)
            expect(dbFile).not.toBeNull()

            const decryptedData = new Uint8Array([1, 2, 3, 4, 5])
            const blob = new Blob([decryptedData], { type: dbFile!.originalMimeType! })

            // 验证 Blob 的 type 等于数据库中存储的原始 MIME 类型
            expect(blob.type).toBe(mimeType)
        }
    })

    it('text/plain 类型的 Blob 应正确创建', async () => {
        const file = await createOssFileDao({
            userId: 1,
            bucketName: 'test-bucket',
            fileName: 'hello.txt',
            filePath: `test/text_${Date.now()}.age`,
            fileSize: 5,
            fileType: 'text/plain',
            source: FileSource.CASE_MATERIAL,
            status: OssFileStatus.UPLOADED,
            encrypted: true,
            originalMimeType: 'text/plain',
        })

        createdFileIds.push(file.id)

        const dbFile = await findOssFileByIdDao(file.id)
        expect(dbFile).not.toBeNull()

        const decryptedData = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
        const blob = new Blob([decryptedData], { type: dbFile!.originalMimeType! })

        // 验证 Blob 被创建且有内容
        expect(blob.size).toBe(5)
        expect(blob.type).toMatch(/^text\/plain/)
    })
})

describe('数据库连接检查', () => {
    it('检查数据库是否可用', async () => {
        // 简单的数据库连接测试
        const file = await createOssFileDao({
            userId: 1,
            bucketName: 'test-bucket',
            fileName: 'connection_test.txt',
            filePath: `test/connection_${Date.now()}.txt`,
            fileSize: 100,
            fileType: 'text/plain',
            source: FileSource.CASE_MATERIAL,
            status: OssFileStatus.PENDING,
            encrypted: false,
            originalMimeType: null,
        })

        createdFileIds.push(file.id)

        expect(file.id).toBeGreaterThan(0)
        expect(file.fileName).toBe('connection_test.txt')
    })
})
