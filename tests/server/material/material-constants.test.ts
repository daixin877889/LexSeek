/**
 * 材料识别服务常量和工具函数测试
 *
 * 测试 calculateBackoffDelay 退避延迟计算逻辑
 *
 * **Feature: material-constants**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    calculateBackoffDelay,
    DEFAULT_POLLING_CONFIG,
    EXISTING_TASK_ID,
    type PollingConfig,
} from '../../../server/services/material/materialConstants'

describe('materialConstants 测试', () => {
    describe('DEFAULT_POLLING_CONFIG', () => {
        it('应包含正确的默认配置', () => {
            expect(DEFAULT_POLLING_CONFIG.initialDelay).toBe(1000)
            expect(DEFAULT_POLLING_CONFIG.backoffFactor).toBe(1.5)
            expect(DEFAULT_POLLING_CONFIG.maxDelay).toBe(30000)
            expect(DEFAULT_POLLING_CONFIG.maxRetries).toBe(50)
        })
    })

    describe('EXISTING_TASK_ID', () => {
        it('应为 existing 标记字符串', () => {
            expect(EXISTING_TASK_ID).toBe('existing')
            expect(typeof EXISTING_TASK_ID).toBe('string')
        })
    })

    describe('calculateBackoffDelay', () => {
        it('retryCount 为 0 时应返回 initialDelay', () => {
            const config: PollingConfig = {
                initialDelay: 1000,
                backoffFactor: 2,
                maxDelay: 30000,
                maxRetries: 10,
            }
            expect(calculateBackoffDelay(0, config)).toBe(1000)
        })

        it('retryCount 为 1 时应返回 initialDelay * backoffFactor', () => {
            const config: PollingConfig = {
                initialDelay: 1000,
                backoffFactor: 2,
                maxDelay: 30000,
                maxRetries: 10,
            }
            expect(calculateBackoffDelay(1, config)).toBe(2000)
        })

        it('retryCount 为 2 时应返回 initialDelay * backoffFactor^2', () => {
            const config: PollingConfig = {
                initialDelay: 1000,
                backoffFactor: 2,
                maxDelay: 30000,
                maxRetries: 10,
            }
            expect(calculateBackoffDelay(2, config)).toBe(4000)
        })

        it('应不超过 maxDelay 上限', () => {
            const config: PollingConfig = {
                initialDelay: 1000,
                backoffFactor: 2,
                maxDelay: 5000,
                maxRetries: 10,
            }
            // 2^10 * 1000 = 10240000 > 5000，应被限制
            expect(calculateBackoffDelay(10, config)).toBeLessThanOrEqual(5000)
            expect(calculateBackoffDelay(10, config)).toBe(5000)
        })

        it('应使用默认配置', () => {
            // retryCount = 3: 1000 * 1.5^3 = 3375
            expect(calculateBackoffDelay(3)).toBe(3375)
        })

        // Property: 延迟应为正数
        it('Property: 延迟应始终为正数', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 100 }),
                    fc.nat(),
                    fc.nat(),
                    fc.nat(),
                    (retryCount, initialDelay, backoffFactor, maxDelay) => {
                        // 避免除以零和无效配置
                        if (initialDelay === 0 || backoffFactor === 0) return true
                        const config: PollingConfig = {
                            initialDelay: initialDelay + 1,
                            backoffFactor: 1 + backoffFactor * 0.1,
                            maxDelay: maxDelay + 1,
                            maxRetries: 100,
                        }
                        const delay = calculateBackoffDelay(retryCount, config)
                        return delay > 0 && delay <= config.maxDelay
                    }
                ),
                { numRuns: 50 }
            )
        })

        // Property: 不超过最大延迟
        it('Property: 计算延迟不应超过最大延迟', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 1000 }),
                    (retryCount) => {
                        const delay = calculateBackoffDelay(retryCount, DEFAULT_POLLING_CONFIG)
                        return delay <= DEFAULT_POLLING_CONFIG.maxDelay
                    }
                ),
                { numRuns: 50 }
            )
        })

        // Property: 退避增长验证
        it('Property: 延迟应随重试次数增长（未达到上限前）', () => {
            const config: PollingConfig = {
                initialDelay: 1000,
                backoffFactor: 2,
                maxDelay: 100000,
                maxRetries: 10,
            }
            // 在达到上限前，延迟应严格递增
            let lastDelay = 0
            for (let i = 0; i < 5; i++) {
                const delay = calculateBackoffDelay(i, config)
                if (delay < config.maxDelay) {
                    expect(delay).toBeGreaterThan(lastDelay)
                }
                lastDelay = delay
            }
        })

        // Property: backoffFactor 为 1 时延迟恒定
        it('Property: backoffFactor 为 1 时延迟恒定为 initialDelay', () => {
            const config: PollingConfig = {
                initialDelay: 1000,
                backoffFactor: 1,
                maxDelay: 30000,
                maxRetries: 10,
            }
            for (let i = 0; i < 10; i++) {
                expect(calculateBackoffDelay(i, config)).toBe(1000)
            }
        })

        it('backoffFactor 为 1 时使用默认配置应恒定为 initialDelay', () => {
            const config: PollingConfig = { ...DEFAULT_POLLING_CONFIG, backoffFactor: 1 }
            for (let i = 0; i < 10; i++) {
                expect(calculateBackoffDelay(i, config)).toBe(DEFAULT_POLLING_CONFIG.initialDelay)
            }
        })
    })
})
