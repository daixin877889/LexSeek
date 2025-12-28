/**
 * 健康检查 API 测试
 *
 * 测试服务器健康检查端点
 *
 * **Feature: api-integration-tests**
 * **Validates: Requirements 13.1**
 */

import { describe, it, expect } from 'vitest'
import { createApiClient } from './test-api-client'

describe('健康检查 API 测试', () => {
    const client = createApiClient()

    describe('GET /api/health', () => {
        it('应返回服务状态信息', async () => {
            const response = await client.get<{ status: string; timestamp: string }>('/api/health')

            // 健康检查端点直接返回数据，不是标准的 ApiResponse 格式
            const fullResponse = client.getLastResponse()
            expect(fullResponse?.status).toBe(200)

            // 验证响应包含必要字段
            const body = fullResponse?.body as { status: string; timestamp: string }
            expect(body.status).toBe('ok')
            expect(body.timestamp).toBeDefined()
            expect(typeof body.timestamp).toBe('string')
        })

        it('应返回有效的 ISO 时间戳', async () => {
            await client.get('/api/health')
            const fullResponse = client.getLastResponse()
            const body = fullResponse?.body as { status: string; timestamp: string }

            // 验证时间戳是有效的 ISO 格式
            const timestamp = new Date(body.timestamp)
            expect(timestamp.getTime()).not.toBeNaN()

            // 验证时间戳是最近的（5分钟内）
            const now = Date.now()
            const diff = Math.abs(now - timestamp.getTime())
            expect(diff).toBeLessThan(5 * 60 * 1000)
        })
    })
})
