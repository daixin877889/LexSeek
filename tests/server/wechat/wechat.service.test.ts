/**
 * 微信服务测试
 *
 * 测试 wechat.service.ts 的功能，包括：
 * - getMpOpenidService
 *
 * **Feature: wechat-service**
 * **Validates: Requirements 2.3, 2.4, 2.5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock logger
vi.mock('#shared/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}))

// Mock useRuntimeConfig
vi.mock('nuxt/app', () => ({
    useRuntimeConfig: vi.fn(() => ({
        public: {
            wechatAppId: 'test_app_id',
        },
        wechat: {
            mpSecret: 'test_secret',
        },
    })),
}))

// Mock $fetch
const mockFetch = vi.fn()
vi.stubGlobal('$fetch', mockFetch)

describe('微信服务测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('getMpOpenidService - 获取用户 OpenID', () => {
        it('成功获取 OpenID 时应返回正确的数据结构', async () => {
            mockFetch.mockResolvedValueOnce({
                access_token: 'test_access_token',
                expires_in: 7200,
                openid: 'test_openid_12345',
                scope: 'snsapi_base',
                unionid: 'test_unionid',
            })

            const { getMpOpenidService } = await import('../../../server/services/wechat/wechat.service')

            const result = await getMpOpenidService('authorization_code')

            expect(result.openid).toBe('test_openid_12345')
            expect(result.unionid).toBe('test_unionid')
        })

        it('返回结果无 unionid 时应返回 undefined', async () => {
            mockFetch.mockResolvedValueOnce({
                access_token: 'test_access_token',
                expires_in: 7200,
                openid: 'test_openid_no_union',
                scope: 'snsapi_base',
            })

            const { getMpOpenidService } = await import('../../../server/services/wechat/wechat.service')

            const result = await getMpOpenidService('code_without_union')

            expect(result.openid).toBe('test_openid_no_union')
            expect(result.unionid).toBeUndefined()
        })

        it('微信返回错误时应抛出错误', async () => {
            mockFetch.mockResolvedValueOnce({
                errcode: 40029,
                errmsg: 'invalid code',
            })

            const { getMpOpenidService } = await import('../../../server/services/wechat/wechat.service')

            await expect(getMpOpenidService('invalid_code')).rejects.toThrow('获取 OpenID 失败')
        })

        it('微信返回缺少 openid 字段时应抛出错误', async () => {
            mockFetch.mockResolvedValueOnce({
                access_token: 'test_token',
                expires_in: 7200,
            })

            const { getMpOpenidService } = await import('../../../server/services/wechat/wechat.service')

            // openid 缺失时，catch 块会抛出通用错误（因为消息中不含"获取 OpenID 失败"）
            await expect(getMpOpenidService('test_code')).rejects.toThrow('获取微信 OpenID 失败，请重新授权')
        })

        it('API 返回字符串时应正确解析 JSON', async () => {
            mockFetch.mockResolvedValueOnce(
                JSON.stringify({
                    access_token: 'test_token_json_string',
                    expires_in: 7200,
                    openid: 'test_openid_from_string',
                    scope: 'snsapi_base',
                    unionid: 'test_unionid_string',
                })
            )

            const { getMpOpenidService } = await import('../../../server/services/wechat/wechat.service')

            const result = await getMpOpenidService('test_code')

            expect(result.openid).toBe('test_openid_from_string')
            expect(result.unionid).toBe('test_unionid_string')
        })

        it('API 返回无效 JSON 字符串时应抛出通用错误', async () => {
            mockFetch.mockResolvedValueOnce('not valid json')

            const { getMpOpenidService } = await import('../../../server/services/wechat/wechat.service')

            await expect(getMpOpenidService('test_code')).rejects.toThrow('获取微信 OpenID 失败，请重新授权')
        })

        it('fetch 抛出错误时应抛出通用错误', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'))

            const { getMpOpenidService } = await import('../../../server/services/wechat/wechat.service')

            await expect(getMpOpenidService('test_code')).rejects.toThrow('获取微信 OpenID 失败，请重新授权')
        })

        it('已知的错误应直接抛出', async () => {
            mockFetch.mockResolvedValueOnce({
                errcode: 40013,
                errmsg: 'invalid appid',
            })

            const { getMpOpenidService } = await import('../../../server/services/wechat/wechat.service')

            await expect(getMpOpenidService('test_code')).rejects.toThrow('获取 OpenID 失败')
        })
    })
})
