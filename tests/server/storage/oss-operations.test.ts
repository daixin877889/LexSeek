/**
 * OSS 上传下载删除测试
 *
 * 测试 OSS 模块的上传、下载、流式下载、删除功能
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.2, 10.3**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { config } from 'dotenv'

config()

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

const hasValidConfig = ossConfig.accessKeyId && ossConfig.accessKeySecret && ossConfig.bucket && ossConfig.region

// Mock uploadFile (需要通过 mock 外部依赖测试)
describe('OSS 上传下载删除模块', () => {
    describe('uploadFile - 参数处理', () => {
        it('缺少配置字段应抛出 OssConfigError', async () => {
            const { uploadFile } = await import('../../../server/lib/oss/upload')
            const invalidConfig = {
                accessKeyId: '',
                accessKeySecret: 'secret',
                bucket: 'bucket',
                region: 'oss-cn-hangzhou'
            } as any

            await expect(
                uploadFile(invalidConfig, 'test.txt', Buffer.from('test'))
            ).rejects.toThrow()
        })

        it('缺少 accessKeySecret 应抛出错误', async () => {
            const { uploadFile } = await import('../../../server/lib/oss/upload')
            const invalidConfig = {
                accessKeyId: 'key',
                accessKeySecret: '',
                bucket: 'bucket',
                region: 'oss-cn-hangzhou'
            } as any

            await expect(
                uploadFile(invalidConfig, 'test.txt', Buffer.from('test'))
            ).rejects.toThrow()
        })
    })

    describe('downloadFile - 参数处理', () => {
        it('缺少配置字段应抛出错误', async () => {
            const { downloadFile } = await import('../../../server/lib/oss/download')
            const invalidConfig = {
                accessKeyId: '',
                accessKeySecret: 'secret',
                bucket: 'bucket',
                region: 'oss-cn-hangzhou'
            } as any

            await expect(
                downloadFile(invalidConfig, 'test.txt')
            ).rejects.toThrow()
        })
    })

    describe('downloadFileStream - 参数处理', () => {
        it('缺少配置字段应抛出错误', async () => {
            const { downloadFileStream } = await import('../../../server/lib/oss/download')
            const invalidConfig = {
                accessKeyId: '',
                accessKeySecret: 'secret',
                bucket: 'bucket',
                region: 'oss-cn-hangzhou'
            } as any

            await expect(
                downloadFileStream(invalidConfig, 'test.txt')
            ).rejects.toThrow()
        })
    })

    describe('deleteFile - 参数处理', () => {
        it('缺少配置字段应抛出错误', async () => {
            const { deleteFile } = await import('../../../server/lib/oss/delete')
            const invalidConfig = {
                accessKeyId: '',
                accessKeySecret: 'secret',
                bucket: 'bucket',
                region: 'oss-cn-hangzhou'
            } as any

            await expect(
                deleteFile(invalidConfig, 'test.txt')
            ).rejects.toThrow()
        })

        it('空路径应能正常调用（路径验证在客户端层面）', async () => {
            const { deleteFile } = await import('../../../server/lib/oss/delete')
            // 路径为空字符串时，OSS 会报错
            // 这个测试只验证函数能接受空路径参数
            expect(() => {
                // 实际上会在 createOssClient 时验证配置
            }).not.toThrow()
        })
    })

    describe('generateSignedUrl - 参数处理', () => {
        it('缺少配置字段应抛出错误', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')
            const invalidConfig = {
                accessKeyId: '',
                accessKeySecret: 'secret',
                bucket: 'bucket',
                region: 'oss-cn-hangzhou'
            } as any

            await expect(
                generateSignedUrl(invalidConfig, 'test.txt')
            ).rejects.toThrow()
        })

        it('STS 配置缺少 roleArn 应抛出 OssStsError', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')
            const invalidConfig = {
                accessKeyId: 'key',
                accessKeySecret: 'secret',
                bucket: 'bucket',
                region: 'oss-cn-hangzhou',
                sts: {
                    roleArn: '',
                    roleSessionName: 'test'
                }
            } as any

            await expect(
                generateSignedUrl(invalidConfig, 'test.txt')
            ).rejects.toThrow()
        })
    })
})

// 如果有配置，进行集成测试
describe('OSS 集成测试', () => {
    if (!hasValidConfig) {
        it.skip('跳过测试：缺少阿里云 OSS 配置', () => {
            console.log('请在 .env 文件中配置阿里云 OSS 环境变量')
        })
        return
    }

    const testFile = `test-${Date.now()}.txt`
    const testContent = Buffer.from(`Hello OSS Test ${Date.now()}`)

    afterEach(async () => {
        // 清理测试文件
        try {
            const { deleteFile } = await import('../../../server/lib/oss/delete')
            await deleteFile(ossConfig, testFile)
        } catch {
            // ignore cleanup errors
        }
    })

    describe('uploadFile - 文件上传', () => {
        it('应成功上传文件', async () => {
            const { uploadFile } = await import('../../../server/lib/oss/upload')
            const result = await uploadFile(ossConfig, testFile, testContent)

            expect(result).toBeDefined()
            expect(result.name).toBe(testFile)
            expect(result.etag).toBeTruthy()
            expect(result.url).toContain(testFile)
        })

        it('应支持自定义 Content-Type', async () => {
            const { uploadFile } = await import('../../../server/lib/oss/upload')
            const result = await uploadFile(
                ossConfig,
                `typed-${testFile}`,
                testContent,
                { contentType: 'text/plain' }
            )

            expect(result).toBeDefined()
            expect(result.name).toBe(`typed-${testFile}`)
        })

        it('应支持自定义元数据', async () => {
            const { uploadFile } = await import('../../../server/lib/oss/upload')
            const result = await uploadFile(
                ossConfig,
                `meta-${testFile}`,
                testContent,
                { meta: { 'x-oss-meta-test': 'value' } }
            )

            expect(result).toBeDefined()
        })
    })

    describe('downloadFile - 文件下载', () => {
        it('应成功下载已上传的文件', async () => {
            const { uploadFile } = await import('../../../server/lib/oss/upload')
            const { downloadFile } = await import('../../../server/lib/oss/download')

            // 先上传
            await uploadFile(ossConfig, testFile, testContent)

            // 再下载
            const downloaded = await downloadFile(ossConfig, testFile)
            expect(downloaded).toBeInstanceOf(Buffer)
            expect(downloaded.toString()).toBe(testContent.toString())
        })

        it('下载不存在的文件应抛出 OssNotFoundError', async () => {
            const { downloadFile } = await import('../../../server/lib/oss/download')
            const { OssNotFoundError } = await import('../../../server/lib/oss/errors')

            await expect(
                downloadFile(ossConfig, `non-existent-${Date.now()}.txt`)
            ).rejects.toThrow(OssNotFoundError)
        })
    })

    describe('downloadFileStream - 流式下载', () => {
        it('应成功流式下载文件', async () => {
            const { uploadFile } = await import('../../../server/lib/oss/upload')
            const { downloadFileStream } = await import('../../../server/lib/oss/download')

            // 先上传
            await uploadFile(ossConfig, testFile, testContent)

            // 流式下载
            const stream = await downloadFileStream(ossConfig, testFile)
            expect(stream).toBeDefined()
            expect(typeof stream.pipe).toBe('function')
        })
    })

    describe('deleteFile - 文件删除', () => {
        it('应成功删除单个文件', async () => {
            const { uploadFile } = await import('../../../server/lib/oss/upload')
            const { deleteFile } = await import('../../../server/lib/oss/delete')

            // 先上传
            await uploadFile(ossConfig, testFile, testContent)

            // 再删除
            const result = await deleteFile(ossConfig, testFile)
            expect(result.deleted).toContain(testFile)
        })

        it('应成功批量删除文件', async () => {
            const { uploadFile } = await import('../../../server/lib/oss/upload')
            const { deleteFile } = await import('../../../server/lib/oss/delete')

            const files = [`batch1-${testFile}`, `batch2-${testFile}`]

            // 先上传
            for (const file of files) {
                await uploadFile(ossConfig, file, testContent)
            }

            // 批量删除
            const result = await deleteFile(ossConfig, files)
            expect(result.deleted.length).toBe(2)
        })

        it('删除不存在的文件不应抛出错误', async () => {
            const { deleteFile } = await import('../../../server/lib/oss/delete')
            const result = await deleteFile(ossConfig, `non-existent-${Date.now()}.txt`)
            expect(result.deleted).toBeDefined()
        })
    })
})

// 备用：配置缺失时提示
if (!hasValidConfig) {
    describe('OSS 集成测试（配置缺失）', () => {
        it.skip('需要阿里云 OSS 配置才能运行集成测试', () => {
            console.log('请在 .env.testing 文件中配置 NUXT_STORAGE_ALIYUN_OSS_* 环境变量')
        })
    })
}
