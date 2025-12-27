/**
 * 阿里云 OSS 集成测试
 *
 * 使用真实的阿里云 OSS 服务进行集成测试
 * 需要在 .env 文件中配置阿里云 OSS 相关环境变量
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.1, 10.2, 10.3**
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import { config } from 'dotenv'

// 加载环境变量
config()

// 从环境变量获取配置
const ossConfig = {
    accessKeyId: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET || '',
    bucket: process.env.NUXT_STORAGE_ALIYUN_OSS_BUCKET || '',
    region: process.env.NUXT_STORAGE_ALIYUN_OSS_REGION || '',
    customDomain: process.env.NUXT_STORAGE_ALIYUN_OSS_CUSTOM_DOMAIN,
    sts: process.env.NUXT_STORAGE_ALIYUN_OSS_STS_ROLE_ARN ? {
        roleArn: process.env.NUXT_STORAGE_ALIYUN_OSS_STS_ROLE_ARN,
        roleSessionName: process.env.NUXT_STORAGE_ALIYUN_OSS_STS_ROLE_SESSION_NAME || 'OSS',
        durationSeconds: parseInt(process.env.NUXT_STORAGE_ALIYUN_OSS_STS_DURATION_SECONDS || '3600')
    } : undefined
}

// 检查配置是否完整
const hasValidConfig = ossConfig.accessKeyId && ossConfig.accessKeySecret && ossConfig.bucket && ossConfig.region

// 跳过测试如果没有配置
const describeIfConfigured = hasValidConfig ? describe : describe.skip

describeIfConfigured('阿里云 OSS 集成测试', () => {
    // 动态导入 OSS 模块（避免在没有配置时加载）
    let createOssClient: any
    let generatePostSignature: any
    let generateSignedUrl: any
    let uploadFile: any
    let downloadFile: any
    let deleteFile: any

    beforeAll(async () => {
        // 动态导入模块
        const ossModule = await import('../../../server/lib/oss')
        createOssClient = ossModule.createOssClient
        generatePostSignature = ossModule.generatePostSignature
        generateSignedUrl = ossModule.generateSignedUrl
        uploadFile = ossModule.uploadFile
        downloadFile = ossModule.downloadFile
        deleteFile = ossModule.deleteFile
    })

    describe('OSS 客户端创建', () => {
        it('应成功创建 OSS 客户端', async () => {
            const { client, config: clientConfig } = await createOssClient(ossConfig)
            expect(client).toBeDefined()
            expect(clientConfig.bucket).toBe(ossConfig.bucket)
        })

        it('使用 STS 时应返回临时凭证', async () => {
            if (!ossConfig.sts) {
                return // 跳过如果没有 STS 配置
            }
            const { credentials } = await createOssClient(ossConfig)
            expect(credentials).toBeDefined()
            expect(credentials?.accessKeyId).toBeDefined()
            expect(credentials?.accessKeySecret).toBeDefined()
            expect(credentials?.securityToken).toBeDefined()
            expect(credentials?.expiration).toBeInstanceOf(Date)
        })
    })

    describe('签名生成', () => {
        it('应生成有效的 POST 签名', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                expirationMinutes: 10
            })

            expect(result.host).toBeDefined()
            expect(result.policy).toBeDefined()
            expect(result.signatureVersion).toBe('OSS4-HMAC-SHA256')
            expect(result.credential).toBeDefined()
            expect(result.date).toMatch(/^\d{8}T\d{6}Z$/)
            expect(result.signature).toBeDefined()
            expect(result.dir).toBe('test/')
        })

        it('配置 fileKey 时应生成完整的 key', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                fileKey: {
                    originalFileName: 'test.txt',
                    strategy: 'uuid'
                }
            })

            expect(result.key).toBeDefined()
            expect(result.key).toMatch(/^test\/[0-9a-f-]+\.txt$/)
        })

        it('配置回调时应包含 callback 字段', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                callback: {
                    callbackUrl: 'https://example.com/callback',
                    callbackBody: 'filename=${object}&size=${size}'
                }
            })

            expect(result.callback).toBeDefined()
            // callback 应该是 Base64 编码的字符串
            expect(result.callback).toMatch(/^[A-Za-z0-9+/=]+$/)
        })

        it('配置自定义变量时应包含 callbackVar 字段', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                callback: {
                    callbackUrl: 'https://example.com/callback',
                    callbackBody: 'filename=${object}',
                    callbackVar: {
                        userId: '123',
                        fileType: 'document'
                    }
                }
            })

            expect(result.callbackVar).toBeDefined()
            // 自定义变量应该有 x: 前缀
            expect(result.callbackVar?.['x:userId']).toBe('123')
            expect(result.callbackVar?.['x:fileType']).toBe('document')
        })

        it('应生成有效的签名 URL', async () => {
            const url = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600
            })

            expect(url).toBeDefined()
            expect(url).toContain('test/file.txt')
            expect(url).toContain('Signature=')
        })

        it('签名 URL 应支持 response headers 设置', async () => {
            // 不带 response headers 的 URL
            const urlWithoutHeaders = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600
            })

            // 带 response headers 的 URL
            const urlWithHeaders = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600,
                response: {
                    contentType: 'application/octet-stream',
                    contentDisposition: 'attachment; filename="download.txt"'
                }
            })

            expect(urlWithHeaders).toBeDefined()
            // 带 response headers 的签名应该与不带的不同（因为签名内容不同）
            expect(urlWithHeaders).not.toBe(urlWithoutHeaders)
        })

        it('签名 URL 应支持不同的 HTTP 方法', async () => {
            const getUrl = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600,
                method: 'GET'
            })
            expect(getUrl).toBeDefined()

            const putUrl = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600,
                method: 'PUT'
            })
            expect(putUrl).toBeDefined()
            // PUT 和 GET 的签名应该不同
            expect(getUrl).not.toBe(putUrl)
        })

        it('POST 签名应支持 contentType 条件', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                conditions: {
                    contentType: ['image/jpeg', 'image/png']
                }
            })

            expect(result.policy).toBeDefined()
            // 解码 policy 验证条件
            const policyStr = Buffer.from(result.policy, 'base64').toString('utf-8')
            const policy = JSON.parse(policyStr)
            const hasContentTypeCondition = policy.conditions.some(
                (c: any) => Array.isArray(c) && c[0] === 'starts-with' && c[1] === '$Content-Type'
            )
            expect(hasContentTypeCondition).toBe(true)
        })

        it('POST 签名应支持 contentLengthRange 条件', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                conditions: {
                    contentLengthRange: [0, 10485760] // 0-10MB
                }
            })

            expect(result.policy).toBeDefined()
            const policyStr = Buffer.from(result.policy, 'base64').toString('utf-8')
            const policy = JSON.parse(policyStr)
            const hasLengthCondition = policy.conditions.some(
                (c: any) => Array.isArray(c) && c[0] === 'content-length-range'
            )
            expect(hasLengthCondition).toBe(true)
        })

        it('POST 签名 fileKey 应支持 timestamp 策略', async () => {
            const before = Date.now()
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                fileKey: {
                    originalFileName: 'test.txt',
                    strategy: 'timestamp'
                }
            })
            const after = Date.now()

            expect(result.key).toBeDefined()
            // 提取时间戳部分
            const timestamp = parseInt(result.key!.replace('test/', '').replace('.txt', ''))
            expect(timestamp).toBeGreaterThanOrEqual(before)
            expect(timestamp).toBeLessThanOrEqual(after)
        })

        it('POST 签名 fileKey 应支持 original 策略', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                fileKey: {
                    originalFileName: 'my-original-file.txt',
                    strategy: 'original'
                }
            })

            expect(result.key).toBe('test/my-original-file.txt')
        })

        it('POST 签名 fileKey 应支持 custom 策略', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                fileKey: {
                    originalFileName: 'ignored.txt',
                    strategy: 'custom',
                    customFileName: 'custom-name.txt'
                }
            })

            expect(result.key).toBe('test/custom-name.txt')
        })

        it('POST 签名 fileKey 没有扩展名时应正确处理', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                fileKey: {
                    originalFileName: 'noextension',
                    strategy: 'uuid'
                }
            })

            expect(result.key).toBeDefined()
            // UUID 格式，没有扩展名
            expect(result.key).toMatch(/^test\/[0-9a-f-]{36}$/)
        })

        it('POST 签名 fileKey 默认策略应为 uuid', async () => {
            const result = await generatePostSignature(ossConfig, {
                dir: 'test/',
                fileKey: {
                    originalFileName: 'test.txt'
                    // 不指定 strategy，应该默认使用 uuid
                }
            })

            expect(result.key).toBeDefined()
            expect(result.key).toMatch(/^test\/[0-9a-f-]+\.txt$/)
        })
    })

    describe('OSS 工具函数集成测试', () => {
        let decodeBase64: any

        beforeAll(async () => {
            const utils = await import('../../../server/lib/oss/utils')
            decodeBase64 = utils.decodeBase64
        })

        it('decodeBase64 应正确解码 Base64 字符串', () => {
            const original = 'Hello, World!'
            const encoded = Buffer.from(original, 'utf8').toString('base64')
            const decoded = decodeBase64(encoded)
            expect(decoded).toBe(original)
        })

        it('decodeBase64 应正确处理中文字符', () => {
            const original = '你好世界'
            const encoded = Buffer.from(original, 'utf8').toString('base64')
            const decoded = decodeBase64(encoded)
            expect(decoded).toBe(original)
        })
    })

    describe('文件上传下载', () => {
        const testDir = 'test-integration/'
        let testFilePath: string
        const testContent = 'Hello, OSS Integration Test!'

        it('应成功上传文件', async () => {
            // 每次测试生成唯一文件名
            testFilePath = `${testDir}test-${Date.now()}.txt`
            const result = await uploadFile(
                ossConfig,
                testFilePath,
                Buffer.from(testContent),
                { contentType: 'text/plain' }
            )

            expect(result.name).toBe(testFilePath)
            expect(result.etag).toBeDefined()
            expect(result.url).toContain(testFilePath)
        })

        it('应成功下载文件', async () => {
            const buffer = await downloadFile(ossConfig, testFilePath)
            const content = buffer.toString('utf-8')
            expect(content).toBe(testContent)
        })

        it('下载不存在的文件应抛出错误', async () => {
            await expect(
                downloadFile(ossConfig, 'non-existent-file-12345.txt')
            ).rejects.toThrow()
        })

        it('应支持 Range 下载（部分内容）', async () => {
            // 上传一个较长的文件用于测试 Range 下载
            const longContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
            const rangePath = `${testDir}range-test-${Date.now()}.txt`
            await uploadFile(ossConfig, rangePath, Buffer.from(longContent), { contentType: 'text/plain' })

            try {
                // 下载前 5 个字节
                const buffer = await downloadFile(ossConfig, rangePath, { range: 'bytes=0-4' })
                expect(buffer.toString('utf-8')).toBe('ABCDE')
            } finally {
                await deleteFile(ossConfig, rangePath)
            }
        })
    })

    describe('流式下载', () => {
        let downloadFileStream: any

        beforeAll(async () => {
            const ossModule = await import('../../../server/lib/oss')
            downloadFileStream = ossModule.downloadFileStream
        })

        it('应成功流式下载文件', async () => {
            const testPath = `test-integration/stream-test-${Date.now()}.txt`
            const testContent = 'Stream download test content'
            await uploadFile(ossConfig, testPath, Buffer.from(testContent), { contentType: 'text/plain' })

            try {
                const stream = await downloadFileStream(ossConfig, testPath)
                expect(stream).toBeDefined()
                expect(stream.readable).toBe(true)

                // 读取流内容
                const chunks: Buffer[] = []
                for await (const chunk of stream) {
                    chunks.push(Buffer.from(chunk))
                }
                const content = Buffer.concat(chunks).toString('utf-8')
                expect(content).toBe(testContent)
            } finally {
                await deleteFile(ossConfig, testPath)
            }
        })

        it('流式下载不存在的文件应抛出错误', async () => {
            await expect(
                downloadFileStream(ossConfig, 'non-existent-stream-file-12345.txt')
            ).rejects.toThrow()
        })

        it('流式下载应支持 Range 选项', async () => {
            const testPath = `test-integration/stream-range-${Date.now()}.txt`
            const testContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
            await uploadFile(ossConfig, testPath, Buffer.from(testContent), { contentType: 'text/plain' })

            try {
                const stream = await downloadFileStream(ossConfig, testPath, { range: 'bytes=0-9' })
                const chunks: Buffer[] = []
                for await (const chunk of stream) {
                    chunks.push(Buffer.from(chunk))
                }
                const content = Buffer.concat(chunks).toString('utf-8')
                expect(content).toBe('ABCDEFGHIJ')
            } finally {
                await deleteFile(ossConfig, testPath)
            }
        })
    })

    describe('文件删除', () => {
        it('应成功删除文件', async () => {
            const testPath = `test-integration/delete-test-${Date.now()}.txt`
            await uploadFile(ossConfig, testPath, Buffer.from('test'), { contentType: 'text/plain' })
            const result = await deleteFile(ossConfig, testPath)
            expect(result.deleted).toContain(testPath)
        })

        it('批量删除应返回所有删除的文件路径', async () => {
            const testPaths = [
                `test-integration/batch-delete-${Date.now()}-1.txt`,
                `test-integration/batch-delete-${Date.now()}-2.txt`,
                `test-integration/batch-delete-${Date.now()}-3.txt`
            ]

            for (const path of testPaths) {
                await uploadFile(ossConfig, path, Buffer.from('test'), { contentType: 'text/plain' })
            }

            const result = await deleteFile(ossConfig, testPaths)
            expect(result.deleted.length).toBe(testPaths.length)
            for (const path of testPaths) {
                expect(result.deleted).toContain(path)
            }
        })
    })

    describe('Property: 签名格式一致性', () => {
        it('任意目录的签名结果格式应一致', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 20 })
                        .filter(s => /^[a-z0-9-]+$/.test(s))
                        .map(s => `${s}/`),
                    async (dir) => {
                        const result = await generatePostSignature(ossConfig, { dir })

                        // 验证必需字段
                        expect(result.host).toBeDefined()
                        expect(result.policy).toMatch(/^[A-Za-z0-9+/=]+$/)
                        expect(result.signatureVersion).toBe('OSS4-HMAC-SHA256')
                        // credential 格式：accessKeyId/date/region/oss/aliyun_v4_request
                        // 使用 STS 时 accessKeyId 以 STS. 开头，否则使用原始 accessKeyId
                        expect(result.credential).toMatch(/^(STS\.|LTAI)[^/]+\/\d{8}\/[^/]+\/oss\/aliyun_v4_request$/)
                        expect(result.date).toMatch(/^\d{8}T\d{6}Z$/)
                        expect(result.signature).toBeDefined()
                        expect(result.dir).toBe(dir)

                        return true
                    }
                ),
                { numRuns: 10 }
            )
        })
    })

    describe('Property: 文件上传下载往返一致性', () => {
        it('上传后下载应得到相同内容', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1, maxLength: 1000 }),
                    async (content) => {
                        const testPath = `test-integration/roundtrip-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`

                        try {
                            // 上传
                            await uploadFile(
                                ossConfig,
                                testPath,
                                Buffer.from(content, 'utf-8'),
                                { contentType: 'text/plain' }
                            )

                            // 下载
                            const buffer = await downloadFile(ossConfig, testPath)
                            const downloaded = buffer.toString('utf-8')

                            // 验证内容一致
                            expect(downloaded).toBe(content)

                            return true
                        } finally {
                            // 清理测试文件
                            try {
                                await deleteFile(ossConfig, testPath)
                            } catch {
                                // 忽略删除错误
                            }
                        }
                    }
                ),
                { numRuns: 5 } // 减少运行次数避免过多 API 调用
            )
        })
    })
})

// 如果没有配置，输出提示信息
if (!hasValidConfig) {
    describe('阿里云 OSS 集成测试', () => {
        it.skip('跳过测试：缺少阿里云 OSS 配置', () => {
            console.log('请在 .env 文件中配置以下环境变量：')
            console.log('- NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID')
            console.log('- NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET')
            console.log('- NUXT_STORAGE_ALIYUN_OSS_BUCKET')
            console.log('- NUXT_STORAGE_ALIYUN_OSS_REGION')
        })
    })
}
