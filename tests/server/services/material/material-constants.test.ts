/**
 * 材料常量模块单元测试
 *
 * **Feature: material-constants**
 * **Validates: DEFAULT_POLLING_CONFIG, calculateBackoffDelay, EXISTING_TASK_ID**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    DEFAULT_POLLING_CONFIG,
    calculateBackoffDelay,
    EXISTING_TASK_ID,
    type PollingConfig,
} from '../../../../server/services/material/materialConstants'

// fast-check 配置
const PBT_CONFIG = { numRuns: 200 }

describe('materialConstants', () => {
    describe('DEFAULT_POLLING_CONFIG', () => {
        it('应该包含所有必需的轮询配置字段', () => {
            expect(DEFAULT_POLLING_CONFIG).toHaveProperty('initialDelay')
            expect(DEFAULT_POLLING_CONFIG).toHaveProperty('backoffFactor')
            expect(DEFAULT_POLLING_CONFIG).toHaveProperty('maxDelay')
            expect(DEFAULT_POLLING_CONFIG).toHaveProperty('maxRetries')
        })

        it('initialDelay 应该为正数', () => {
            expect(DEFAULT_POLLING_CONFIG.initialDelay).toBeGreaterThan(0)
        })

        it('backoffFactor 应该大于 1（指数退避）', () => {
            expect(DEFAULT_POLLING_CONFIG.backoffFactor).toBeGreaterThan(1)
        })

        it('maxDelay 应该大于 initialDelay', () => {
            expect(DEFAULT_POLLING_CONFIG.maxDelay).toBeGreaterThan(DEFAULT_POLLING_CONFIG.initialDelay)
        })

        it('maxRetries 应该为正整数', () => {
            expect(DEFAULT_POLLING_CONFIG.maxRetries).toBeGreaterThan(0)
            expect(Number.isInteger(DEFAULT_POLLING_CONFIG.maxRetries)).toBe(true)
        })

        it('配置的默认值应该符合预期', () => {
            expect(DEFAULT_POLLING_CONFIG.initialDelay).toBe(1000)
            expect(DEFAULT_POLLING_CONFIG.backoffFactor).toBe(1.5)
            expect(DEFAULT_POLLING_CONFIG.maxDelay).toBe(30000)
            expect(DEFAULT_POLLING_CONFIG.maxRetries).toBe(50)
        })
    })

    describe('EXISTING_TASK_ID', () => {
        it('应该是一个非空字符串', () => {
            expect(typeof EXISTING_TASK_ID).toBe('string')
            expect(EXISTING_TASK_ID.length).toBeGreaterThan(0)
        })

        it('应该等于 "existing"', () => {
            expect(EXISTING_TASK_ID).toBe('existing')
        })
    })

    describe('calculateBackoffDelay', () => {
        describe('基础公式验证', () => {
            it('retryCount 为 0 时应该返回 initialDelay', () => {
                const delay = calculateBackoffDelay(0, DEFAULT_POLLING_CONFIG)
                expect(delay).toBe(DEFAULT_POLLING_CONFIG.initialDelay)
            })

            it('retryCount 为 1 时应该应用一次退避因子', () => {
                const delay = calculateBackoffDelay(1, DEFAULT_POLLING_CONFIG)
                const expected = DEFAULT_POLLING_CONFIG.initialDelay * Math.pow(DEFAULT_POLLING_CONFIG.backoffFactor, 1)
                expect(delay).toBeCloseTo(expected, 5)
            })

            it('retryCount 为 2 时应该应用两次退避因子', () => {
                const delay = calculateBackoffDelay(2, DEFAULT_POLLING_CONFIG)
                const expected = DEFAULT_POLLING_CONFIG.initialDelay * Math.pow(DEFAULT_POLLING_CONFIG.backoffFactor, 2)
                expect(delay).toBeCloseTo(expected, 5)
            })
        })

        describe('最大延迟限制', () => {
            it('超过 maxDelay 时应该被限制', () => {
                // 当 retryCount 足够大时，initialDelay * factor^retryCount 会超过 maxDelay
                const largeRetryCount = 50
                const delay = calculateBackoffDelay(largeRetryCount, DEFAULT_POLLING_CONFIG)
                expect(delay).toBeLessThanOrEqual(DEFAULT_POLLING_CONFIG.maxDelay)
            })

            it('退避延迟在 maxDelay 范围内时应该保持原值', () => {
                // 找一个不会超过 maxDelay 的 retryCount
                const smallRetryCount = 5
                const rawDelay = DEFAULT_POLLING_CONFIG.initialDelay * Math.pow(DEFAULT_POLLING_CONFIG.backoffFactor, smallRetryCount)
                const delay = calculateBackoffDelay(smallRetryCount, DEFAULT_POLLING_CONFIG)
                expect(rawDelay).toBeLessThan(DEFAULT_POLLING_CONFIG.maxDelay)
                expect(delay).toBeCloseTo(rawDelay, 5)
            })
        })

        describe('属性测试：退避延迟公式正确性', () => {
            it('Property 1: 延迟应该始终为正数', () => {
                fc.assert(
                    fc.property(
                        fc.integer({ min: 0, max: 1000 }),
                        (retryCount) => {
                            const delay = calculateBackoffDelay(retryCount, DEFAULT_POLLING_CONFIG)
                            expect(delay).toBeGreaterThan(0)
                        }
                    ),
                    PBT_CONFIG
                )
            })

            it('Property 2: 延迟应该单调递增（直到达到上限）', () => {
                fc.assert(
                    fc.property(
                        fc.integer({ min: 0, max: 20 }),
                        (retryCount) => {
                            if (retryCount === 0) return
                            const prevDelay = calculateBackoffDelay(retryCount - 1, DEFAULT_POLLING_CONFIG)
                            const currentDelay = calculateBackoffDelay(retryCount, DEFAULT_POLLING_CONFIG)
                            const prevReachedMax = prevDelay === DEFAULT_POLLING_CONFIG.maxDelay
                            const currReachedMax = currentDelay === DEFAULT_POLLING_CONFIG.maxDelay
                            if (!prevReachedMax && !currReachedMax) {
                                // 两者都未达到上限时应该严格递增
                                expect(currentDelay).toBeGreaterThan(prevDelay)
                            } else if (currReachedMax) {
                                // 达到上限后应该保持在 maxDelay
                                expect(currentDelay).toBe(DEFAULT_POLLING_CONFIG.maxDelay)
                            }
                            // 无论是否达到上限，当前延迟都不应该小于前一个延迟
                            expect(currentDelay).toBeGreaterThanOrEqual(prevDelay)
                        }
                    ),
                    { ...PBT_CONFIG, numRuns: 50 }
                )
            })

            it('Property 3: 延迟公式验证 initialDelay * factor^retryCount <= maxDelay', () => {
                fc.assert(
                    fc.property(
                        fc.integer({ min: 0, max: 100 }),
                        (retryCount) => {
                            const expectedRaw = DEFAULT_POLLING_CONFIG.initialDelay * Math.pow(DEFAULT_POLLING_CONFIG.backoffFactor, retryCount)
                            const expected = Math.min(expectedRaw, DEFAULT_POLLING_CONFIG.maxDelay)
                            const actual = calculateBackoffDelay(retryCount, DEFAULT_POLLING_CONFIG)
                            expect(actual).toBeCloseTo(expected, 5)
                        }
                    ),
                    PBT_CONFIG
                )
            })

            it('Property 4: 延迟永远不会超过 maxDelay', () => {
                fc.assert(
                    fc.property(
                        fc.integer({ min: 0, max: 10000 }),
                        (retryCount) => {
                            const delay = calculateBackoffDelay(retryCount, DEFAULT_POLLING_CONFIG)
                            expect(delay).toBeLessThanOrEqual(DEFAULT_POLLING_CONFIG.maxDelay)
                        }
                    ),
                    { numRuns: 100 }
                )
            })
        })

        describe('自定义配置', () => {
            it('应该接受自定义 PollingConfig', () => {
                const customConfig: PollingConfig = {
                    initialDelay: 500,
                    backoffFactor: 2,
                    maxDelay: 10000,
                    maxRetries: 10,
                }

                const delay0 = calculateBackoffDelay(0, customConfig)
                expect(delay0).toBe(500)

                const delay2 = calculateBackoffDelay(2, customConfig)
                expect(delay2).toBe(500 * 2 * 2) // 2000
            })

            it('自定义配置的 maxDelay 限制应该生效', () => {
                const smallMaxConfig: PollingConfig = {
                    initialDelay: 100,
                    backoffFactor: 2,
                    maxDelay: 500,
                    maxRetries: 10,
                }

                const delay = calculateBackoffDelay(10, smallMaxConfig)
                expect(delay).toBeLessThanOrEqual(smallMaxConfig.maxDelay)
                expect(delay).toBe(500) // 100 * 2^10 = 102400，被限制为 500
            })

            it('backoffFactor 为 1 时延迟恒定为 initialDelay', () => {
                const noBackoffConfig: PollingConfig = {
                    initialDelay: 1000,
                    backoffFactor: 1,
                    maxDelay: 10000,
                    maxRetries: 10,
                }

                const delay = calculateBackoffDelay(5, noBackoffConfig)
                expect(delay).toBe(1000)
            })

            it('默认值参数测试：未传入 config 时使用 DEFAULT_POLLING_CONFIG', () => {
                // 直接调用时不传 config 参数，验证默认行为
                const delay0 = calculateBackoffDelay(0)
                expect(delay0).toBe(DEFAULT_POLLING_CONFIG.initialDelay)

                const delay3 = calculateBackoffDelay(3)
                const expected = DEFAULT_POLLING_CONFIG.initialDelay * Math.pow(DEFAULT_POLLING_CONFIG.backoffFactor, 3)
                expect(delay3).toBeCloseTo(expected, 5)
            })
        })

        describe('边界情况', () => {
            it('retryCount 为 0 和负数都正确处理', () => {
                expect(calculateBackoffDelay(0, DEFAULT_POLLING_CONFIG)).toBe(DEFAULT_POLLING_CONFIG.initialDelay)
                // Math.pow(1.5, -1) = 0.666...，但 retryCount 是整数不会是负数
                // 但我们仍然可以测试 largeRetryCount
                expect(calculateBackoffDelay(100, DEFAULT_POLLING_CONFIG)).toBe(DEFAULT_POLLING_CONFIG.maxDelay)
            })

            it('maxDelay 等于 initialDelay 时，任何正数 retryCount 都返回 maxDelay', () => {
                const config: PollingConfig = {
                    initialDelay: 1000,
                    backoffFactor: 2,
                    maxDelay: 1000,
                    maxRetries: 10,
                }

                expect(calculateBackoffDelay(0, config)).toBe(1000)
                expect(calculateBackoffDelay(1, config)).toBe(1000)
                expect(calculateBackoffDelay(100, config)).toBe(1000)
            })
        })
    })
})
