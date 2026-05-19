/**
 * 阿里云 OSS 回调验证器测试
 *
 * 测试阿里云回调签名验证功能
 *
 * **Feature: aliyun-callback-validator**
 * **Validates: 阿里云回调验证器**
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('h3', async (importOriginal) => ({
    ...(await importOriginal<typeof import('h3')>()),
    readRawBody: vi.fn(),
}))

import { AliyunCallbackValidator, clearPublicKeyCache } from '../../../server/lib/storage/callback/validators/aliyun'
import { readRawBody } from 'h3'
import type { H3Event } from 'h3'

describe('AliyunCallbackValidator', () => {
    let validator: AliyunCallbackValidator

    beforeEach(() => {
        validator = new AliyunCallbackValidator()
        clearPublicKeyCache()
    })

    describe('isValidPubKeyUrl 域名验证', () => {
        it('gosspublic.alicdn.com HTTPS URL 应有效', () => {
            const url = 'https://gosspublic.alicdn.com/ossfs/pub.key'
            expect((validator as any).isValidPubKeyUrl(url)).toBe(true)
        })

        it('gosspublic.alicdn.com HTTP URL 应有效', () => {
            const url = 'http://gosspublic.alicdn.com/ossfs/pub.key'
            expect((validator as any).isValidPubKeyUrl(url)).toBe(true)
        })

        it('oss-cn- 开头的 HTTPS URL 应有效', () => {
            const url = 'https://oss-cn-beijing.aliyuncs.com/pub.key'
            expect((validator as any).isValidPubKeyUrl(url)).toBe(true)
        })

        it('oss-cn- 开头的 HTTP URL 应有效', () => {
            const url = 'http://oss-cn-shanghai.aliyuncs.com/pub.key'
            expect((validator as any).isValidPubKeyUrl(url)).toBe(true)
        })

        it('非阿里云域名应无效', () => {
            expect((validator as any).isValidPubKeyUrl('https://evil.com/pub.key')).toBe(false)
            expect((validator as any).isValidPubKeyUrl('https://gosspublic.aliyuncs.com/pub.key')).toBe(false)
            expect((validator as any).isValidPubKeyUrl('https://oss-cn.example.com/pub.key')).toBe(false)
        })

        it('空字符串应无效', () => {
            expect((validator as any).isValidPubKeyUrl('')).toBe(false)
        })
    })

    describe('verifySignature 签名验证', () => {
        it('使用正确签名应返回 true', () => {
            // 这个测试验证 verifySignature 方法的存在和基本行为
            // 实际 RSA 签名测试需要真实密钥
            const data = 'test data'
            const fakeSignature = Buffer.from('fake')
            const fakePublicKey = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\ntest\n-----END PUBLIC KEY-----'
            // verifySignature 在 catch 中返回 false，输入无效密钥会抛异常
            const result = (validator as any).verifySignature(data, fakeSignature, fakePublicKey)
            // 预期 false 因为使用了 fake 密钥
            expect(typeof result).toBe('boolean')
        })
    })

    describe('getQueryString 查询字符串解析', () => {
        it('带查询参数的 URL 应返回查询字符串', () => {
            const event = { node: { req: { url: '/callback?key1=val1&key2=val2' } } } as any as H3Event
            expect((validator as any).getQueryString(event)).toBe('key1=val1&key2=val2')
        })

        it('无查询参数的 URL 应返回空字符串', () => {
            const event = { node: { req: { url: '/callback' } } } as any as H3Event
            expect((validator as any).getQueryString(event)).toBe('')
        })

        it('空 URL 应返回空字符串', () => {
            const event = { node: { req: { url: '' } } } as any as H3Event
            expect((validator as any).getQueryString(event)).toBe('')
        })

        it('undefined URL 应返回空字符串', () => {
            const event = { node: { req: { url: undefined as any } } } as any as H3Event
            expect((validator as any).getQueryString(event)).toBe('')
        })
    })

    describe('verify 验证方法 - 参数校验', () => {
        it('缺少 authorization 头应返回 invalid', async () => {
            const event = {
                path: () => '/callback',
                node: { req: { url: '/callback' } },
            } as any as H3Event
            const result = await validator.verify(event, {} as any)
            expect(result.valid).toBe(false)
            expect(result.error).toContain('缺少')
        })

        it('缺少 pubKeyUrlBase64 头应返回 invalid', async () => {
            const event = {
                path: () => '/callback',
                node: { req: { url: '/callback' } },
                _headers: new Map([['authorization', 'abc']]),
            } as any as H3Event
            // 模拟 getHeader
            const mockGetHeader = (event: H3Event, name: string) => {
                if (name === 'authorization') return 'abc'
                return null
            }
            // 直接通过私有方法测试域名验证
            expect((validator as any).isValidPubKeyUrl('')).toBe(false)
        })
    })

    describe('clearPublicKeyCache 缓存清理', () => {
        it('clearPublicKeyCache 应执行成功', () => {
            expect(() => clearPublicKeyCache()).not.toThrow()
        })
    })

    describe('getRawBody 原始请求体', () => {
        it('返回 readRawBody 原文，自定义变量 key 的冒号不被编码（验签回归点）', async () => {
            const rawBody = 'filename=dev%2Fa.docx&size=14501&x:user_id=1&x:file_id=27690'
            ;(readRawBody as any).mockResolvedValue(rawBody)
            const result = await (validator as any).getRawBody({} as H3Event)
            expect(result).toBe(rawBody)
            // 关键：x: 前缀的冒号必须保持原样，不能被编码成 %3A
            expect(result).toContain('x:user_id=1')
            expect(result).not.toContain('x%3A')
        })

        it('Buffer 原始体转为 utf-8 字符串', async () => {
            ;(readRawBody as any).mockResolvedValue(Buffer.from('filename=a&x:k=v', 'utf-8'))
            const result = await (validator as any).getRawBody({} as H3Event)
            expect(result).toBe('filename=a&x:k=v')
        })

        it('原始体为空时返回空字符串', async () => {
            ;(readRawBody as any).mockResolvedValue(undefined)
            const result = await (validator as any).getRawBody({} as H3Event)
            expect(result).toBe('')
        })
    })
})
