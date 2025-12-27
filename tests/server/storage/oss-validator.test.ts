/**
 * OSS 配置验证器测试
 *
 * 测试 OSS 配置验证功能
 *
 * **Feature: storage-system**
 * **Validates: Requirements 10.1**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { validateConfig } from '../../../server/lib/oss/validator'
import { OssConfigError } from '../../../server/lib/oss/errors'
import type { OssConfig } from '../../../shared/types/oss'

describe('OSS 配置验证器', () => {
    // 有效的基础配置
    const validConfig: OssConfig = {
        accessKeyId: 'LTAI5tKjkmxxxxxxxx',
        accessKeySecret: 'xxxxxxxxxxxxxxxxxxxxxxxx',
        bucket: 'test-bucket',
        region: 'oss-cn-hangzhou'
    }

    describe('必需字段验证', () => {
        it('有效配置应通过验证', () => {
            expect(() => validateConfig(validConfig)).not.toThrow()
        })

        it('缺少 accessKeyId 应抛出错误', () => {
            const config = { ...validConfig, accessKeyId: '' }
            expect(() => validateConfig(config)).toThrow(OssConfigError)
            expect(() => validateConfig(config)).toThrow('Missing required config field')
        })

        it('缺少 accessKeySecret 应抛出错误', () => {
            const config = { ...validConfig, accessKeySecret: '' }
            expect(() => validateConfig(config)).toThrow(OssConfigError)
            expect(() => validateConfig(config)).toThrow('Missing required config field')
        })

        it('缺少 bucket 应抛出错误', () => {
            const config = { ...validConfig, bucket: '' }
            expect(() => validateConfig(config)).toThrow(OssConfigError)
            expect(() => validateConfig(config)).toThrow('Missing required config field')
        })

        it('缺少 region 应抛出错误', () => {
            const config = { ...validConfig, region: '' }
            expect(() => validateConfig(config)).toThrow(OssConfigError)
            expect(() => validateConfig(config)).toThrow('Missing required config field')
        })

        it('缺少多个字段应列出所有缺失字段', () => {
            const config = { accessKeyId: '', accessKeySecret: '', bucket: '', region: '' }
            expect(() => validateConfig(config)).toThrow(OssConfigError)
        })
    })

    describe('region 格式验证', () => {
        it('有效的 region 格式应通过验证', () => {
            const validRegions = [
                'oss-cn-hangzhou',
                'oss-cn-shanghai',
                'oss-cn-beijing',
                'cn-hangzhou',
                'cn-shanghai',
                'cn-beijing'
            ]

            for (const region of validRegions) {
                const config = { ...validConfig, region }
                expect(() => validateConfig(config)).not.toThrow()
            }
        })

        it('无效的 region 格式应抛出错误', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 30 })
                        .filter(s => !/^(oss-)?[a-z]+-[a-z0-9]+$/.test(s)),
                    (invalidRegion) => {
                        const config = { ...validConfig, region: invalidRegion }
                        expect(() => validateConfig(config)).toThrow(OssConfigError)
                        expect(() => validateConfig(config)).toThrow('Invalid region format')
                        return true
                    }
                ),
                { numRuns: 50 }
            )
        })
    })

    describe('STS 配置验证', () => {
        it('有效的 STS roleArn 应通过验证', () => {
            const config: OssConfig = {
                ...validConfig,
                sts: {
                    roleArn: 'acs:ram::1234567890123456:role/test-role',
                    roleSessionName: 'test-session'
                }
            }
            expect(() => validateConfig(config)).not.toThrow()
        })

        it('无效的 STS roleArn 格式应抛出错误', () => {
            const invalidArns = [
                'invalid-arn',
                'acs:ram::abc:role/test',
                'acs:ram::123:role/',
                'arn:aws:iam::123456789012:role/test'
            ]

            for (const roleArn of invalidArns) {
                const config: OssConfig = {
                    ...validConfig,
                    sts: {
                        roleArn,
                        roleSessionName: 'test-session'
                    }
                }
                expect(() => validateConfig(config)).toThrow(OssConfigError)
                expect(() => validateConfig(config)).toThrow('Invalid STS role ARN format')
            }
        })

        it('不提供 STS 配置时不应验证 roleArn', () => {
            const config = { ...validConfig }
            delete (config as any).sts
            expect(() => validateConfig(config)).not.toThrow()
        })
    })

    describe('Property: 配置验证一致性', () => {
        it('任意有效配置都应通过验证', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        accessKeyId: fc.stringMatching(/^[A-Za-z0-9]{10,30}$/),
                        accessKeySecret: fc.stringMatching(/^[A-Za-z0-9]{20,50}$/),
                        bucket: fc.stringMatching(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
                        region: fc.constantFrom(
                            'oss-cn-hangzhou',
                            'oss-cn-shanghai',
                            'cn-hangzhou',
                            'cn-beijing'
                        )
                    }),
                    (config) => {
                        expect(() => validateConfig(config as OssConfig)).not.toThrow()
                        return true
                    }
                ),
                { numRuns: 50 }
            )
        })
    })
})
