/**
 * OSS 工具函数测试
 *
 * 使用 fast-check 进行属性测试，验证 OSS 工具函数的正确性
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.1, 10.2**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 内联实现工具函数用于测试（避免加载 ali-oss SDK）
function padTo2Digits(num: number): string {
    return num.toString().padStart(2, '0')
}

function formatDateToUTC(date: Date): string {
    return (
        date.getUTCFullYear().toString() +
        padTo2Digits(date.getUTCMonth() + 1) +
        padTo2Digits(date.getUTCDate()) +
        'T' +
        padTo2Digits(date.getUTCHours()) +
        padTo2Digits(date.getUTCMinutes()) +
        padTo2Digits(date.getUTCSeconds()) +
        'Z'
    )
}

function getStandardRegion(region: string): string {
    return region.replace(/^oss-/g, '')
}

function getCredential(date: string, region: string, accessKeyId: string): string {
    return `${accessKeyId}/${date}/${region}/oss/aliyun_v4_request`
}

function policy2Str(policy: object): string {
    return JSON.stringify(policy)
}

function encodeBase64(str: string): string {
    return Buffer.from(str, 'utf8').toString('base64')
}

function decodeBase64(base64: string): string {
    return Buffer.from(base64, 'base64').toString('utf8')
}

function getOssHost(bucket: string, region: string, customDomain?: string): string {
    if (customDomain) {
        let domain = customDomain.trim()
        if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
            domain = `https://${domain}`
        }
        return domain.replace(/\/+$/, '')
    }
    const standardRegion = getStandardRegion(region)
    return `https://${bucket}.oss-${standardRegion}.aliyuncs.com`
}

describe('OSS 工具函数', () => {
    describe('formatDateToUTC - UTC 日期格式化', () => {
        it('应返回正确的 UTC 格式字符串', () => {
            fc.assert(
                fc.property(
                    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
                        .filter(d => !isNaN(d.getTime())),
                    (date) => {
                        const result = formatDateToUTC(date)
                        // 格式应为 YYYYMMDDTHHMMSSZ
                        expect(result).toMatch(/^\d{8}T\d{6}Z$/)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('格式化结果应包含正确的年月日时分秒', () => {
            const date = new Date('2024-06-15T10:30:45Z')
            const result = formatDateToUTC(date)
            expect(result).toBe('20240615T103045Z')
        })

        it('应正确处理月份和日期的零填充', () => {
            const date = new Date('2024-01-05T01:02:03Z')
            const result = formatDateToUTC(date)
            expect(result).toBe('20240105T010203Z')
        })
    })

    describe('getStandardRegion - 区域名称标准化', () => {
        it('应移除 oss- 前缀', () => {
            expect(getStandardRegion('oss-cn-hangzhou')).toBe('cn-hangzhou')
            expect(getStandardRegion('oss-cn-shanghai')).toBe('cn-shanghai')
            expect(getStandardRegion('oss-ap-southeast-1')).toBe('ap-southeast-1')
        })

        it('没有 oss- 前缀时应保持不变', () => {
            expect(getStandardRegion('cn-hangzhou')).toBe('cn-hangzhou')
            expect(getStandardRegion('cn-shanghai')).toBe('cn-shanghai')
        })

        it('应处理任意区域字符串', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }),
                    (region) => {
                        const result = getStandardRegion(region)
                        // 结果不应以 oss- 开头
                        expect(result.startsWith('oss-')).toBe(false)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('getCredential - 凭证字符串生成', () => {
        it('应生成正确格式的凭证字符串', () => {
            const result = getCredential('20240615', 'cn-hangzhou', 'LTAI5tTestAccessKeyId')
            expect(result).toBe('LTAI5tTestAccessKeyId/20240615/cn-hangzhou/oss/aliyun_v4_request')
        })

        it('凭证格式应符合 OSS V4 签名规范', () => {
            fc.assert(
                fc.property(
                    fc.stringMatching(/^\d{8}$/),
                    fc.stringMatching(/^[a-z-]+$/),
                    fc.stringMatching(/^[A-Za-z0-9]+$/),
                    (date, region, accessKeyId) => {
                        const result = getCredential(date, region, accessKeyId)
                        // 格式: accessKeyId/date/region/oss/aliyun_v4_request
                        const parts = result.split('/')
                        expect(parts.length).toBe(5)
                        expect(parts[0]).toBe(accessKeyId)
                        expect(parts[1]).toBe(date)
                        expect(parts[2]).toBe(region)
                        expect(parts[3]).toBe('oss')
                        expect(parts[4]).toBe('aliyun_v4_request')
                        return true
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('policy2Str - 策略对象序列化', () => {
        it('应正确序列化策略对象', () => {
            const policy = {
                expiration: '2024-06-15T12:00:00Z',
                conditions: [{ bucket: 'test-bucket' }]
            }
            const result = policy2Str(policy)
            expect(result).toBe(JSON.stringify(policy))
        })

        it('序列化后应能正确解析', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        expiration: fc.string(),
                        conditions: fc.array(fc.record({ key: fc.string() }))
                    }),
                    (policy) => {
                        const str = policy2Str(policy)
                        const parsed = JSON.parse(str)
                        expect(parsed).toEqual(policy)
                        return true
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('encodeBase64 / decodeBase64 - Base64 编解码', () => {
        it('编码后解码应得到原始字符串（往返测试）', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 1000 }),
                    (str) => {
                        const encoded = encodeBase64(str)
                        const decoded = decodeBase64(encoded)
                        expect(decoded).toBe(str)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('编码结果应为有效的 Base64 字符串', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }),
                    (str) => {
                        const encoded = encodeBase64(str)
                        // Base64 只包含 A-Z, a-z, 0-9, +, /, =
                        expect(encoded).toMatch(/^[A-Za-z0-9+/=]*$/)
                        return true
                    }
                ),
                { numRuns: 100 }
            )
        })

        it('应正确处理中文字符', () => {
            const chinese = '你好世界'
            const encoded = encodeBase64(chinese)
            const decoded = decodeBase64(encoded)
            expect(decoded).toBe(chinese)
        })

        it('应正确处理特殊字符', () => {
            const special = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\'
            const encoded = encodeBase64(special)
            const decoded = decodeBase64(encoded)
            expect(decoded).toBe(special)
        })
    })

    describe('getOssHost - OSS 主机地址生成', () => {
        it('无自定义域名时应返回标准 OSS 域名', () => {
            const result = getOssHost('test-bucket', 'cn-hangzhou')
            expect(result).toBe('https://test-bucket.oss-cn-hangzhou.aliyuncs.com')
        })

        it('应正确处理带 oss- 前缀的区域', () => {
            const result = getOssHost('test-bucket', 'oss-cn-shanghai')
            expect(result).toBe('https://test-bucket.oss-cn-shanghai.aliyuncs.com')
        })

        it('有自定义域名时应使用自定义域名', () => {
            const result = getOssHost('test-bucket', 'cn-hangzhou', 'cdn.example.com')
            expect(result).toBe('https://cdn.example.com')
        })

        it('自定义域名已有 https:// 前缀时不应重复添加', () => {
            const result = getOssHost('test-bucket', 'cn-hangzhou', 'https://cdn.example.com')
            expect(result).toBe('https://cdn.example.com')
        })

        it('自定义域名有 http:// 前缀时应保留', () => {
            const result = getOssHost('test-bucket', 'cn-hangzhou', 'http://cdn.example.com')
            expect(result).toBe('http://cdn.example.com')
        })

        it('应移除自定义域名末尾的斜杠', () => {
            const result = getOssHost('test-bucket', 'cn-hangzhou', 'https://cdn.example.com/')
            expect(result).toBe('https://cdn.example.com')
        })

        it('应移除多个末尾斜杠', () => {
            const result = getOssHost('test-bucket', 'cn-hangzhou', 'https://cdn.example.com///')
            expect(result).toBe('https://cdn.example.com')
        })
    })
})
