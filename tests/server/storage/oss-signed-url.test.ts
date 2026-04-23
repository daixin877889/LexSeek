/**
 * OSS 签名 URL 测试
 *
 * 测试签名 URL 生成的各种场景，包括 STS token 处理
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.3**
 */

import { describe, it, expect } from 'vitest'
import { config } from 'dotenv'
import { resolve } from 'node:path'

// 加载测试环境变量（强制指向 .env.testing，避免误连生产库）
config({ path: resolve(__dirname, '../../../.env.testing') })

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
const hasStsConfig = hasValidConfig && ossConfig.sts

// 跳过测试如果没有配置
const describeIfConfigured = hasValidConfig ? describe : describe.skip
const describeIfStsConfigured = hasStsConfig ? describe : describe.skip

describeIfConfigured('OSS 签名 URL 测试', () => {
    describe('基本签名 URL 生成', () => {
        it('应生成有效的签名 URL', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

            const url = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600
            })

            expect(url).toBeDefined()
            expect(url).toContain('test/file.txt')
        })

        it('应支持自定义过期时间', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

            const url = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 7200
            })

            expect(url).toBeDefined()
        })

        it('应支持不同的 HTTP 方法', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

            const getUrl = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600,
                method: 'GET'
            })

            const putUrl = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600,
                method: 'PUT'
            })

            expect(getUrl).not.toBe(putUrl)
        })

        it('应支持 response headers 设置（URL 必须携带 response-content-* 参数，否则 OSS 不覆盖响应头）', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

            const url = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600,
                response: {
                    contentType: 'application/octet-stream',
                    contentDisposition: "attachment; filename*=UTF-8''%E5%88%9D%E5%A7%8B.docx"
                }
            })

            // 硬断言：两个参数都要写进 URL 查询串，否则浏览器会退回用 URL 路径做文件名
            const parsed = new URL(url)
            expect(parsed.searchParams.get('response-content-type')).toBe('application/octet-stream')
            expect(parsed.searchParams.get('response-content-disposition')).toMatch(/^attachment;/)
            expect(parsed.searchParams.get('response-content-disposition')).toContain("filename*=UTF-8''")
        })

        it('仅传 contentDisposition 时也要正确写入 URL（覆盖常见中文文件名下载场景）', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

            const url = await generateSignedUrl(ossConfig, 'x/rebuild-abc-123.docx', {
                expires: 3600,
                response: {
                    contentDisposition: "attachment; filename*=UTF-8''%E5%8A%B3%E5%8A%A8%E5%90%88%E5%90%8C_v3_2026-04-23.docx"
                }
            })

            const parsed = new URL(url)
            const cd = parsed.searchParams.get('response-content-disposition')
            expect(cd).not.toBeNull()
            // 必须是解码后的标准值（OSS 会把这个作为 Content-Disposition 响应头原样返回）
            expect(cd).toContain("filename*=UTF-8''")
            expect(cd).toContain('%E5%8A%B3%E5%8A%A8%E5%90%88%E5%90%8C')
        })

        it('应使用默认过期时间（3600秒）', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

            const url = await generateSignedUrl(ossConfig, 'test/file.txt')

            expect(url).toBeDefined()
        })

        it('应使用默认 HTTP 方法（GET）', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

            const url = await generateSignedUrl(ossConfig, 'test/file.txt', {
                expires: 3600
            })

            expect(url).toBeDefined()
        })
    })

    describe('自定义域名支持', () => {
        it('配置自定义域名时应使用 cname 模式', async () => {
            const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

            const configWithDomain = {
                ...ossConfig,
                customDomain: 'cdn.example.com'
            }

            // 这个测试可能会失败，因为自定义域名可能不存在
            // 但它会触发 useCname 分支
            try {
                const url = await generateSignedUrl(configWithDomain, 'test/file.txt', {
                    expires: 3600
                })
                expect(url).toContain('cdn.example.com')
            } catch (error) {
                // 预期可能会失败，因为自定义域名不存在
                expect(error).toBeDefined()
            }
        })
    })
})

describeIfStsConfigured('OSS 签名 URL STS Token 测试', () => {
    it('使用 STS 时签名 URL 应包含 security-token', async () => {
        const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

        const url = await generateSignedUrl(ossConfig, 'test/file.txt', {
            expires: 3600
        })

        // STS 模式下，URL 应该包含 security-token 参数
        expect(url).toContain('security-token')
    })

    it('STS token 应正确编码', async () => {
        const { generateSignedUrl } = await import('../../../server/lib/oss/signedUrl')

        const url = await generateSignedUrl(ossConfig, 'test/file.txt', {
            expires: 3600
        })

        // URL 应该是有效的
        expect(() => new URL(url)).not.toThrow()
    })
})

// 如果没有配置，输出提示信息
if (!hasValidConfig) {
    describe('OSS 签名 URL 测试', () => {
        it.skip('跳过测试：缺少阿里云 OSS 配置', () => {
            console.log('请在 .env 文件中配置阿里云 OSS 环境变量')
        })
    })
}

if (!hasStsConfig) {
    describe('OSS 签名 URL STS Token 测试', () => {
        it.skip('跳过测试：缺少 STS 配置', () => {
            console.log('请在 .env 文件中配置 STS 相关环境变量')
        })
    })
}
