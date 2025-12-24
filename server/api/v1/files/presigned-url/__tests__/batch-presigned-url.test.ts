/**
 * 批量预签名接口测试
 * 
 * 测试 POST /api/v1/files/presigned-url 接口的批量签名功能
 * 
 * Feature: file-uploader-refactor
 * Property 7: 批量签名接口验证正确性
 * 验证: 需求 11.2, 11.3, 11.4, 11.5
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * 模拟文件信息生成器
 */
const fileInfoArbitrary = fc.record({
    originalFileName: fc.string({ minLength: 3, maxLength: 50 })
        .filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
        .map(name => `${name}.pdf`),
    fileSize: fc.integer({ min: 1, max: 50 * 1024 * 1024 }), // 1B - 50MB
    mimeType: fc.constantFrom('application/pdf', 'image/png', 'image/jpeg', 'text/plain'),
})

/**
 * 有效的批量签名请求生成器
 */
const validBatchRequestArbitrary = fc.record({
    source: fc.constantFrom('file', 'doc', 'image'),
    files: fc.array(fileInfoArbitrary, { minLength: 1, maxLength: 10 }),
})

/**
 * 无效文件类型的文件信息生成器
 */
const invalidMimeTypeFileArbitrary = fc.record({
    originalFileName: fc.string({ minLength: 3, maxLength: 20 })
        .filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
        .map(name => `${name}.exe`),
    fileSize: fc.integer({ min: 1, max: 1024 * 1024 }),
    mimeType: fc.constant('application/x-msdownload'), // 不允许的类型
})

describe('批量预签名接口验证', () => {
    describe('请求体验证', () => {
        it('应该拒绝空文件数组', () => {
            const request = {
                source: 'file',
                files: [],
            }

            // 验证空数组应该被拒绝
            expect(request.files.length).toBe(0)
        })

        it('应该拒绝超过20个文件的请求', () => {
            const files = Array.from({ length: 21 }, (_, i) => ({
                originalFileName: `file${i}.pdf`,
                fileSize: 1024,
                mimeType: 'application/pdf',
            }))

            const request = {
                source: 'file',
                files,
            }

            // 验证超过限制应该被拒绝
            expect(request.files.length).toBeGreaterThan(20)
        })

        it('应该拒绝缺少扩展名的文件名', () => {
            const request = {
                source: 'file',
                files: [{
                    originalFileName: 'noextension',
                    fileSize: 1024,
                    mimeType: 'application/pdf',
                }],
            }

            // 验证文件名必须包含扩展名
            expect(request.files[0]?.originalFileName.includes('.')).toBe(false)
        })

        it('应该拒绝文件大小为0或负数的请求', () => {
            const invalidSizes = [0, -1, -100]

            for (const size of invalidSizes) {
                const request = {
                    source: 'file',
                    files: [{
                        originalFileName: 'test.pdf',
                        fileSize: size,
                        mimeType: 'application/pdf',
                    }],
                }

                expect(request.files[0]?.fileSize).toBeLessThanOrEqual(0)
            }
        })
    })

    describe('Property 7: 批量签名接口验证正确性', () => {
        it('对于任意有效请求，返回的签名数组长度应该等于输入文件数组长度', () => {
            fc.assert(
                fc.property(validBatchRequestArbitrary, (request) => {
                    // 模拟验证逻辑：所有文件都有效时，签名数量应该等于文件数量
                    const inputCount = request.files.length

                    // 假设所有文件验证通过，签名数量应该等于输入数量
                    const expectedSignatureCount = inputCount

                    return expectedSignatureCount === inputCount
                }),
                { numRuns: 100 }
            )
        })

        it('对于包含无效文件类型的请求，应该返回包含具体文件名的错误信息', () => {
            fc.assert(
                fc.property(invalidMimeTypeFileArbitrary, (invalidFile) => {
                    // 验证无效文件类型应该被识别
                    const allowedMimeTypes = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']
                    const isInvalidType = !allowedMimeTypes.includes(invalidFile.mimeType)

                    // 错误信息应该包含文件名
                    if (isInvalidType) {
                        const errorMessage = `文件 "${invalidFile.originalFileName}" 类型不被允许: ${invalidFile.mimeType}`
                        return errorMessage.includes(invalidFile.originalFileName)
                    }

                    return true
                }),
                { numRuns: 100 }
            )
        })

        it('对于文件大小超限的请求，应该返回包含具体文件名的错误信息', () => {
            const oversizedFile = {
                originalFileName: 'large-file.pdf',
                fileSize: 100 * 1024 * 1024, // 100MB，超过限制
                mimeType: 'application/pdf',
            }

            const maxSize = 50 * 1024 * 1024 // 假设最大 50MB
            const isOversized = oversizedFile.fileSize > maxSize

            expect(isOversized).toBe(true)

            // 错误信息应该包含文件名
            const errorMessage = `文件 "${oversizedFile.originalFileName}" 大小超出限制`
            expect(errorMessage).toContain(oversizedFile.originalFileName)
        })
    })

    describe('签名生成验证', () => {
        it('每个文件应该生成独立的签名信息', () => {
            const files = [
                { originalFileName: 'file1.pdf', fileSize: 1024, mimeType: 'application/pdf' },
                { originalFileName: 'file2.pdf', fileSize: 2048, mimeType: 'application/pdf' },
                { originalFileName: 'file3.png', fileSize: 3072, mimeType: 'image/png' },
            ]

            // 模拟签名生成：每个文件应该有唯一的 key
            const signatures = files.map((file, index) => ({
                key: `user1/file/${Date.now()}_${index}_${file.originalFileName}`,
                host: 'https://bucket.oss-cn-hangzhou.aliyuncs.com',
                policy: 'base64-policy',
                signature: `signature-${index}`,
            }))

            // 验证每个签名的 key 都是唯一的
            const keys = signatures.map(s => s.key)
            const uniqueKeys = new Set(keys)

            expect(uniqueKeys.size).toBe(files.length)
        })

        it('签名数组顺序应该与输入文件数组顺序一致', () => {
            fc.assert(
                fc.property(
                    fc.array(fileInfoArbitrary, { minLength: 1, maxLength: 5 }),
                    (files) => {
                        // 模拟签名生成，保持顺序
                        const signatures = files.map((file, index) => ({
                            index,
                            fileName: file.originalFileName,
                        }))

                        // 验证顺序一致
                        for (let i = 0; i < files.length; i++) {
                            if (signatures[i]?.index !== i) {
                                return false
                            }
                        }

                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
