/**
 * 存储回调处理器测试
 *
 * 测试回调处理器的分发、注册和解析功能
 *
 * **Feature: storage-system**
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    verifyCallback,
    parseCallback,
    registerCallbackHandler,
} from '../../../server/lib/storage/callback/handler'
import { StorageProviderType } from '../../../server/lib/storage/types'
import { StorageConfigError } from '../../../server/lib/storage/errors'
import type { CallbackHandler, CallbackData } from '../../../server/lib/storage/callback/handler'

// Mock 自定义回调处理器
const mockHandler: CallbackHandler = {
    async verify(event: any, _config: any) {
        const auth = event.headers?.['authorization']
        if (!auth) {
            return { valid: false, error: '缺少 authorization' }
        }
        return { valid: true }
    },
    async parse(event: any): Promise<CallbackData> {
        return {
            filePath: 'test/file.txt',
            fileSize: 1024,
            mimeType: 'text/plain',
            customVars: {},
            rawData: event._body,
        }
    },
}

describe('存储回调处理器', () => {
    describe('verifyCallback - 验证回调请求', () => {
        it('不支持的存储类型应抛出 StorageConfigError', async () => {
            const config: any = {
                type: 'unknown_provider' as any,
                bucket: 'test-bucket',
                region: 'oss-cn-hangzhou',
            }

            // 创建一个最小化的 mock event（只包含 path 和 node.req）
            const event = {
                path: '/callback',
                node: { req: { url: '/callback' } },
                headers: {},
            } as any

            await expect(verifyCallback(event, config)).rejects.toThrow(StorageConfigError)
        })
    })

    describe('registerCallbackHandler - 注册自定义处理器', () => {
        it('应能注册自定义回调处理器', async () => {
            // 注册一个测试用的自定义处理器
            registerCallbackHandler('custom_provider' as any, mockHandler)

            const event = {
                path: '/callback',
                node: { req: { url: '/callback' } },
                headers: { authorization: 'test-token' },
            } as any

            const result = await verifyCallback(event, { type: 'custom_provider' } as any)
            expect(result.valid).toBe(true)
        })
    })
})
