/**
 * 阿里云 OSS 适配器集成测试
 *
 * 测试 AliyunOssAdapter 类的所有方法
 * 需要在 .env 文件中配置阿里云 OSS 相关环境变量
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4**
 */

import { describe, it, expect, beforeAll } from 'vitest'
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

describeIfConfigured('AliyunOssAdapter 集成测试', () => {
    let AliyunOssAdapter: any

    beforeAll(async () => {
        const module = await import('../../../server/lib/storage/adapters/aliyun-oss')
        AliyunOssAdapter = module.AliyunOssAdapter
    })

    describe('适配器创建', () => {
        it('应成功创建适配器实例', () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            expect(adapter).toBeDefined()
            expect(adapter.type).toBe('aliyun_oss')
        })

        it('缺少 accessKeyId 应抛出配置错误', async () => {
            const { StorageConfigError } = await import('../../../server/lib/storage/errors')
            expect(() => {
                new AliyunOssAdapter({
                    ...ossConfig,
                    accessKeyId: ''
                })
            }).toThrow(StorageConfigError)
        })

        it('缺少 accessKeySecret 应抛出配置错误', async () => {
            const { StorageConfigError } = await import('../../../server/lib/storage/errors')
            expect(() => {
                new AliyunOssAdapter({
                    ...ossConfig,
                    accessKeySecret: ''
                })
            }).toThrow(StorageConfigError)
        })

        it('无效的 region 格式应抛出配置错误', async () => {
            const { StorageConfigError } = await import('../../../server/lib/storage/errors')
            expect(() => {
                new AliyunOssAdapter({
                    ...ossConfig,
                    region: 'invalid_region!'
                })
            }).toThrow(StorageConfigError)
        })

        it('无效的 STS roleArn 格式应抛出配置错误', async () => {
            const { StorageConfigError } = await import('../../../server/lib/storage/errors')
            expect(() => {
                new AliyunOssAdapter({
                    ...ossConfig,
                    sts: {
                        roleArn: 'invalid-arn',
                        roleSessionName: 'test'
                    }
                })
            }).toThrow(StorageConfigError)
        })
    })

    describe('连接测试', () => {
        it('应成功测试连接', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const result = await adapter.testConnection()
            expect(result).toBe(true)
        })
    })

    describe('文件上传', () => {
        it('应成功上传文件', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const testPath = `test-adapter/upload-${Date.now()}.txt`
            const testContent = Buffer.from('Adapter upload test')

            try {
                const result = await adapter.upload(testPath, testContent, {
                    contentType: 'text/plain'
                })

                expect(result.name).toBe(testPath)
                expect(result.etag).toBeDefined()
                expect(result.url).toContain(testPath)
            } finally {
                // 清理测试文件
                await adapter.delete(testPath)
            }
        })

        it('应支持自定义元数据', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const testPath = `test-adapter/meta-${Date.now()}.txt`
            const testContent = Buffer.from('Metadata test')

            try {
                const result = await adapter.upload(testPath, testContent, {
                    contentType: 'text/plain',
                    meta: {
                        'custom-key': 'custom-value'
                    }
                })

                expect(result.name).toBe(testPath)
            } finally {
                await adapter.delete(testPath)
            }
        })

        it('应支持 storageClass 选项', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const testPath = `test-adapter/storage-class-${Date.now()}.txt`
            const testContent = Buffer.from('Storage class test')

            try {
                const result = await adapter.upload(testPath, testContent, {
                    contentType: 'text/plain',
                    storageClass: 'Standard'
                })

                expect(result.name).toBe(testPath)
            } finally {
                await adapter.delete(testPath)
            }
        })
    })

    describe('文件下载', () => {
        it('应成功下载文件', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const testPath = `test-adapter/download-${Date.now()}.txt`
            const testContent = 'Download test content'

            await adapter.upload(testPath, Buffer.from(testContent), { contentType: 'text/plain' })

            try {
                const buffer = await adapter.download(testPath)
                expect(buffer.toString('utf-8')).toBe(testContent)
            } finally {
                await adapter.delete(testPath)
            }
        })

        it('下载不存在的文件应抛出错误', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)

            await expect(
                adapter.download('non-existent-file-12345.txt')
            ).rejects.toThrow()
        })

        it('应支持 Range 下载', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const testPath = `test-adapter/range-${Date.now()}.txt`
            const testContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

            await adapter.upload(testPath, Buffer.from(testContent), { contentType: 'text/plain' })

            try {
                const buffer = await adapter.download(testPath, { range: 'bytes=0-4' })
                expect(buffer.toString('utf-8')).toBe('ABCDE')
            } finally {
                await adapter.delete(testPath)
            }
        })
    })

    describe('流式下载', () => {
        it('应成功流式下载文件', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const testPath = `test-adapter/stream-${Date.now()}.txt`
            const testContent = 'Stream download test'

            await adapter.upload(testPath, Buffer.from(testContent), { contentType: 'text/plain' })

            try {
                const stream = await adapter.downloadStream(testPath)
                expect(stream).toBeDefined()

                const chunks: Buffer[] = []
                for await (const chunk of stream) {
                    chunks.push(Buffer.from(chunk))
                }
                const content = Buffer.concat(chunks).toString('utf-8')
                expect(content).toBe(testContent)
            } finally {
                await adapter.delete(testPath)
            }
        })

        it('流式下载不存在的文件应抛出错误', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)

            await expect(
                adapter.downloadStream('non-existent-stream-file-12345.txt')
            ).rejects.toThrow()
        })
    })

    describe('文件删除', () => {
        it('应成功删除单个文件', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const testPath = `test-adapter/delete-${Date.now()}.txt`

            await adapter.upload(testPath, Buffer.from('delete test'), { contentType: 'text/plain' })

            const result = await adapter.delete(testPath)
            expect(result.deleted).toContain(testPath)
        })

        it('应成功批量删除文件', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const testPaths = [
                `test-adapter/batch-${Date.now()}-1.txt`,
                `test-adapter/batch-${Date.now()}-2.txt`
            ]

            for (const path of testPaths) {
                await adapter.upload(path, Buffer.from('batch delete'), { contentType: 'text/plain' })
            }

            const result = await adapter.delete(testPaths)
            expect(result.deleted.length).toBe(testPaths.length)
        })
    })

    describe('签名 URL 生成', () => {
        it('应生成有效的签名 URL', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const url = await adapter.generateSignedUrl('test/file.txt', {
                expires: 3600
            })

            expect(url).toBeDefined()
            expect(url).toContain('test/file.txt')
        })

        it('应支持不同的 HTTP 方法', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)

            const getUrl = await adapter.generateSignedUrl('test/file.txt', {
                expires: 3600,
                method: 'GET'
            })

            const putUrl = await adapter.generateSignedUrl('test/file.txt', {
                expires: 3600,
                method: 'PUT'
            })

            expect(getUrl).not.toBe(putUrl)
        })

        it('应支持 response headers 设置', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)

            const url = await adapter.generateSignedUrl('test/file.txt', {
                expires: 3600,
                response: {
                    contentType: 'application/octet-stream',
                    contentDisposition: 'attachment; filename="test.txt"'
                }
            })

            expect(url).toBeDefined()
        })
    })

    describe('POST 签名生成', () => {
        it('应生成有效的 POST 签名', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const result = await adapter.generatePostSignature({
                dir: 'test/'
            })

            expect(result.host).toBeDefined()
            expect(result.policy).toBeDefined()
            expect(result.signatureVersion).toBe('OSS4-HMAC-SHA256')
            expect(result.credential).toBeDefined()
            expect(result.signature).toBeDefined()
        })

        it('应支持 fileKey 配置', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const result = await adapter.generatePostSignature({
                dir: 'test/',
                fileKey: {
                    originalFileName: 'test.txt',
                    strategy: 'uuid'
                }
            })

            expect(result.key).toBeDefined()
            expect(result.key).toMatch(/^test\/[0-9a-f-]+\.txt$/)
        })

        it('应支持回调配置', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const result = await adapter.generatePostSignature({
                dir: 'test/',
                callback: {
                    callbackUrl: 'https://example.com/callback',
                    callbackBody: 'filename=${object}'
                }
            })

            expect(result.callback).toBeDefined()
        })

        it('应支持条件配置', async () => {
            const adapter = new AliyunOssAdapter(ossConfig)
            const result = await adapter.generatePostSignature({
                dir: 'test/',
                conditions: {
                    contentLengthRange: [0, 10485760],
                    contentType: ['image/jpeg']
                }
            })

            expect(result.policy).toBeDefined()
        })
    })
})

// 如果没有配置，输出提示信息
if (!hasValidConfig) {
    describe('AliyunOssAdapter 集成测试', () => {
        it.skip('跳过测试：缺少阿里云 OSS 配置', () => {
            console.log('请在 .env 文件中配置阿里云 OSS 环境变量')
        })
    })
}


describe('AliyunOssAdapter Protected 方法测试', () => {
    let AliyunOssAdapterClass: any

    beforeAll(async () => {
        const module = await import('../../../server/lib/storage/adapters/aliyun-oss')
        AliyunOssAdapterClass = module.AliyunOssAdapter
    })

    // 创建一个测试子类来暴露 protected 方法
    class TestableAliyunOssAdapter {
        private adapter: any

        constructor(config: any, AdapterClass: any) {
            this.adapter = new AdapterClass(config)
        }

        getHost(): string {
            return this.adapter.getHost()
        }

        isNotFoundError(error: unknown): boolean {
            return this.adapter.isNotFoundError(error)
        }

        isPermissionError(error: unknown): boolean {
            return this.adapter.isPermissionError(error)
        }

        isConfigError(error: unknown): boolean {
            return this.adapter.isConfigError(error)
        }

        isNetworkError(error: unknown): boolean {
            return this.adapter.isNetworkError(error)
        }
    }

    describe('getHost - 获取存储主机地址', () => {
        it('无自定义域名时应返回标准 OSS 域名', () => {
            const adapter = new TestableAliyunOssAdapter({
                ...ossConfig,
                customDomain: undefined
            }, AliyunOssAdapterClass)
            const host = adapter.getHost()
            expect(host).toMatch(/^https:\/\/.*\.oss-.*\.aliyuncs\.com$/)
        })

        it('有自定义域名时应使用自定义域名', () => {
            const adapter = new TestableAliyunOssAdapter({
                ...ossConfig,
                customDomain: 'cdn.example.com'
            }, AliyunOssAdapterClass)
            const host = adapter.getHost()
            expect(host).toBe('https://cdn.example.com')
        })

        it('自定义域名已有 https:// 前缀时不应重复添加', () => {
            const adapter = new TestableAliyunOssAdapter({
                ...ossConfig,
                customDomain: 'https://cdn.example.com'
            }, AliyunOssAdapterClass)
            const host = adapter.getHost()
            expect(host).toBe('https://cdn.example.com')
        })

        it('自定义域名有 http:// 前缀时应保留', () => {
            const adapter = new TestableAliyunOssAdapter({
                ...ossConfig,
                customDomain: 'http://cdn.example.com'
            }, AliyunOssAdapterClass)
            const host = adapter.getHost()
            expect(host).toBe('http://cdn.example.com')
        })

        it('应移除自定义域名末尾的斜杠', () => {
            const adapter = new TestableAliyunOssAdapter({
                ...ossConfig,
                customDomain: 'https://cdn.example.com/'
            }, AliyunOssAdapterClass)
            const host = adapter.getHost()
            expect(host).toBe('https://cdn.example.com')
        })
    })

    describe('错误类型检测方法', () => {
        it('isNotFoundError 应识别 NoSuchKey 错误', () => {
            const adapter = new TestableAliyunOssAdapter(ossConfig, AliyunOssAdapterClass)
            expect(adapter.isNotFoundError({ code: 'NoSuchKey' })).toBe(true)
            expect(adapter.isNotFoundError({ status: 404 })).toBe(true)
            expect(adapter.isNotFoundError({ code: 'OtherError' })).toBe(false)
        })

        it('isPermissionError 应识别 AccessDenied 错误', () => {
            const adapter = new TestableAliyunOssAdapter(ossConfig, AliyunOssAdapterClass)
            expect(adapter.isPermissionError({ code: 'AccessDenied' })).toBe(true)
            expect(adapter.isPermissionError({ status: 403 })).toBe(true)
            expect(adapter.isPermissionError({ code: 'OtherError' })).toBe(false)
        })

        it('isConfigError 应识别配置相关错误', () => {
            const adapter = new TestableAliyunOssAdapter(ossConfig, AliyunOssAdapterClass)
            expect(adapter.isConfigError({ code: 'InvalidAccessKeyId' })).toBe(true)
            expect(adapter.isConfigError({ code: 'SignatureDoesNotMatch' })).toBe(true)
            expect(adapter.isConfigError({ code: 'OtherError' })).toBe(false)
        })

        it('isNetworkError 应识别网络相关错误', () => {
            const adapter = new TestableAliyunOssAdapter(ossConfig, AliyunOssAdapterClass)
            expect(adapter.isNetworkError({ code: 'NetworkError' })).toBe(true)
            expect(adapter.isNetworkError({ code: 'ConnectionTimeoutError' })).toBe(true)
            expect(adapter.isNetworkError({ code: 'OtherError' })).toBe(false)
        })

        it('错误检测方法应处理 null 和 undefined', () => {
            const adapter = new TestableAliyunOssAdapter(ossConfig, AliyunOssAdapterClass)
            expect(adapter.isNotFoundError(null)).toBe(false)
            expect(adapter.isPermissionError(undefined)).toBe(false)
            expect(adapter.isConfigError(null)).toBe(false)
            expect(adapter.isNetworkError(undefined)).toBe(false)
        })
    })
})
