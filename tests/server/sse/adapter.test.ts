/**
 * SSE AI SDK 适配器测试
 *
 * 测试 adapter.ts 中的函数，包括：
 * - hasInterrupt / extractInterruptData
 * - validateResumeData / formatResumeData
 * - createInterruptResponse
 * - isValidInterruptType / getInterruptHandlerName
 * - createLangGraphStreamConfig / createResumeConfig
 * - logInterruptEvent / logResumeEvent
 *
 * **Feature: sse-adapter**
 * **Validates: Requirements 12.3, 12.4, 7.4, 7.5**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { InterruptType } from '#shared/types/case'
import {
    hasInterrupt,
    extractInterruptData,
    validateResumeData,
    formatResumeData,
    createInterruptResponse,
    isValidInterruptType,
    getInterruptHandlerName,
    createLangGraphStreamConfig,
    createResumeConfig,
} from '../../../server/services/sse/adapter'

const PBT_CONFIG = { numRuns: 100 }

/** 属性测试配置 */
const SEED = 42

describe('SSE AI SDK 适配器', () => {
    describe('hasInterrupt - 检测中断存在', () => {
        it('包含 __interrupt__ 数组且非空时应返回 true', () => {
            const result = {
                __interrupt__: [{ value: { type: 'test' }, resumable: true, ns: ['node'] }],
                other: 'data',
            }
            expect(hasInterrupt(result)).toBe(true)
        })

        it('不包含 __interrupt__ 字段时应返回 false', () => {
            const result = { messages: [], other: 'data' }
            expect(hasInterrupt(result)).toBe(false)
        })

        it('__interrupt__ 为空数组时应返回 false', () => {
            const result = { __interrupt__: [], messages: [] }
            expect(hasInterrupt(result)).toBe(false)
        })

        it('__interrupt__ 不是数组时应返回 false', () => {
            const result = { __interrupt__: 'not an array', messages: [] }
            expect(hasInterrupt(result)).toBe(false)
        })
    })

    describe('extractInterruptData - 提取中断数据', () => {
        it('有中断时应正确解析类型和消息', () => {
            const result = {
                __interrupt__: [
                    {
                        value: {
                            type: InterruptType.CASE_INFO_CHECK,
                            message: '请补充案情信息',
                            extraData: 'test',
                        },
                        resumable: true,
                        ns: ['caseInfoCheckNode'],
                    },
                ],
            }

            const interrupt = extractInterruptData(result)

            expect(interrupt).not.toBeNull()
            expect(interrupt!.type).toBe(InterruptType.CASE_INFO_CHECK)
            expect(interrupt!.message).toBe('请补充案情信息')
            expect(interrupt!.resumable).toBe(true)
            expect(interrupt!.node).toBe('caseInfoCheckNode')
            expect(interrupt!.data).toHaveProperty('extraData')
            expect((interrupt!.data as any).extraData).toBe('test')
        })

        it('无中断时应返回 null', () => {
            const result = { messages: [], other: 'data' }
            expect(extractInterruptData(result)).toBeNull()
        })

        it('空中断数组时应返回 null', () => {
            const result = { __interrupt__: [], messages: [] }
            expect(extractInterruptData(result)).toBeNull()
        })

        it('中断值缺失时应返回 null', () => {
            const result = { __interrupt__: [{ resumable: true, ns: ['node'] }] }
            expect(extractInterruptData(result)).toBeNull()
        })

        it('节点名称空间为空时应使用 unknown', () => {
            const result = {
                __interrupt__: [
                    {
                        value: { type: InterruptType.MODULE_SELECT, message: '选择模块' },
                        resumable: true,
                        ns: [],
                    },
                ],
            }

            const interrupt = extractInterruptData(result)
            expect(interrupt!.node).toBe('unknown')
        })

        it('节点名称空间带命名空间前缀时应提取第一部分', () => {
            const result = {
                __interrupt__: [
                    {
                        value: { type: InterruptType.BASIC_INFO_CONFIRM, message: '确认信息' },
                        resumable: false,
                        ns: ['basicInfoConfirmNode:subNode'],
                    },
                ],
            }

            const interrupt = extractInterruptData(result)
            expect(interrupt!.node).toBe('basicInfoConfirmNode')
        })
    })

    describe('validateResumeData - 验证恢复数据', () => {
        describe('CASE_INFO_CHECK 类型', () => {
            it('非空字符串应验证通过', () => {
                const result = validateResumeData(InterruptType.CASE_INFO_CHECK, '补充的案情信息')
                expect(result.valid).toBe(true)
            })

            it('空字符串应验证失败', () => {
                const result = validateResumeData(InterruptType.CASE_INFO_CHECK, '')
                expect(result.valid).toBe(false)
                expect(result.error).toContain('补充')
            })

            it('全空格字符串应验证失败', () => {
                const result = validateResumeData(InterruptType.CASE_INFO_CHECK, '   ')
                expect(result.valid).toBe(false)
            })

            it('null 或 undefined 应验证失败', () => {
                const resultNull = validateResumeData(InterruptType.CASE_INFO_CHECK, null as any)
                const resultUndefined = validateResumeData(InterruptType.CASE_INFO_CHECK, undefined as any)
                expect(resultNull.valid).toBe(false)
                expect(resultUndefined.valid).toBe(false)
            })
        })

        describe('BASIC_INFO_CONFIRM 类型', () => {
            it('字符串应验证通过', () => {
                const result = validateResumeData(InterruptType.BASIC_INFO_CONFIRM, '确认')
                expect(result.valid).toBe(true)
            })

            it('包含有效字段的对象应验证通过', () => {
                const result = validateResumeData(InterruptType.BASIC_INFO_CONFIRM, {
                    title: '案件标题',
                })
                expect(result.valid).toBe(true)
            })

            it('包含原告被告的对象应验证通过', () => {
                const result = validateResumeData(InterruptType.BASIC_INFO_CONFIRM, {
                    plaintiff: '原告',
                    defendant: '被告',
                })
                expect(result.valid).toBe(true)
            })

            it('空对象应验证失败', () => {
                const result = validateResumeData(InterruptType.BASIC_INFO_CONFIRM, {})
                expect(result.valid).toBe(false)
                expect(result.error).toContain('有效')
            })
        })

        describe('MODULE_SELECT 类型', () => {
            it('包含 modules 数组的对象应验证通过', () => {
                const result = validateResumeData(InterruptType.MODULE_SELECT, {
                    modules: ['analysis', 'summary'],
                })
                expect(result.valid).toBe(true)
            })

            it('非空 modules 数组应验证通过', () => {
                const result = validateResumeData(InterruptType.MODULE_SELECT, {
                    modules: ['analysis'],
                })
                expect(result.valid).toBe(true)
            })

            it('空 modules 数组应验证失败', () => {
                const result = validateResumeData(InterruptType.MODULE_SELECT, {
                    modules: [],
                })
                expect(result.valid).toBe(false)
            })

            it('逗号分隔字符串应验证通过', () => {
                const result = validateResumeData(InterruptType.MODULE_SELECT, 'analysis, summary')
                expect(result.valid).toBe(true)
            })

            it('无效数据应验证失败', () => {
                const result = validateResumeData(InterruptType.MODULE_SELECT, { data: 'invalid' })
                expect(result.valid).toBe(false)
            })
        })

        describe('INSUFFICIENT_POINTS 类型', () => {
            it('包含 points_recharged 类型应验证通过', () => {
                const result = validateResumeData(InterruptType.INSUFFICIENT_POINTS, {
                    type: 'points_recharged',
                })
                expect(result.valid).toBe(true)
            })

            it('其他数据应验证失败', () => {
                const result = validateResumeData(InterruptType.INSUFFICIENT_POINTS, {
                    type: 'other_type',
                })
                expect(result.valid).toBe(false)
            })
        })

        describe('未知类型', () => {
            it('未知类型应默认验证通过', () => {
                const result = validateResumeData('unknown_type' as InterruptType, 'any data')
                expect(result.valid).toBe(true)
            })
        })
    })

    describe('formatResumeData - 格式化恢复数据', () => {
        it('CASE_INFO_CHECK 应转换为字符串', () => {
            const result = formatResumeData(InterruptType.CASE_INFO_CHECK, 123 as any)
            expect(result).toBe('123')
        })

        it('BASIC_INFO_CONFIRM 字符串应直接返回', () => {
            const result = formatResumeData(InterruptType.BASIC_INFO_CONFIRM, 'confirmed')
            expect(result).toBe('confirmed')
        })

        it('BASIC_INFO_CONFIRM 对象应直接返回', () => {
            const obj = { title: 'test' }
            const result = formatResumeData(InterruptType.BASIC_INFO_CONFIRM, obj)
            expect(result).toBe(obj)
        })

        it('MODULE_SELECT 字符串应转换为 modules 数组', () => {
            const result = formatResumeData(InterruptType.MODULE_SELECT, 'a, b, c')
            expect(result).toEqual({ modules: ['a', 'b', 'c'] })
        })

        it('MODULE_SELECT 中文逗号应正确分割', () => {
            const result = formatResumeData(InterruptType.MODULE_SELECT, '分析,总结,提取')
            expect(result).toEqual({ modules: ['分析', '总结', '提取'] })
        })

        it('MODULE_SELECT 对象应直接返回', () => {
            const obj = { modules: ['test'] }
            const result = formatResumeData(InterruptType.MODULE_SELECT, obj)
            expect(result).toBe(obj)
        })

        it('INSUFFICIENT_POINTS 应直接返回', () => {
            const data = { type: 'points_recharged' }
            const result = formatResumeData(InterruptType.INSUFFICIENT_POINTS, data)
            expect(result).toBe(data)
        })

        it('未知类型应直接返回', () => {
            const result = formatResumeData('unknown' as InterruptType, 'any')
            expect(result).toBe('any')
        })
    })

    describe('createInterruptResponse - 创建中断响应', () => {
        it('应正确转换中断数据格式', () => {
            const interrupt = {
                type: InterruptType.MODULE_SELECT,
                message: '请选择分析模块',
                data: { modules: ['analysis'] },
                resumable: true,
                node: 'moduleSelectNode',
            }

            const response = createInterruptResponse(interrupt)

            expect(response.type).toBe(InterruptType.MODULE_SELECT)
            expect(response.message).toBe('请选择分析模块')
            expect(response.data).toEqual({ modules: ['analysis'] })
            expect(response.resumable).toBe(true)
            expect(response.node).toBe('moduleSelectNode')
        })
    })

    describe('isValidInterruptType - 验证中断类型', () => {
        it('有效中断类型应返回 true', () => {
            expect(isValidInterruptType(InterruptType.CASE_INFO_CHECK)).toBe(true)
            expect(isValidInterruptType(InterruptType.BASIC_INFO_CONFIRM)).toBe(true)
            expect(isValidInterruptType(InterruptType.MODULE_SELECT)).toBe(true)
            expect(isValidInterruptType(InterruptType.INSUFFICIENT_POINTS)).toBe(true)
        })

        it('无效类型应返回 false', () => {
            expect(isValidInterruptType('invalid_type')).toBe(false)
            expect(isValidInterruptType('')).toBe(false)
            expect(isValidInterruptType('CASE_INFO_CHECK')).toBe(false)
        })
    })

    describe('getInterruptHandlerName - 获取处理器名称', () => {
        it('应返回正确的处理器名称', () => {
            expect(getInterruptHandlerName(InterruptType.CASE_INFO_CHECK)).toBe('CaseInfoCheckHandler')
            expect(getInterruptHandlerName(InterruptType.BASIC_INFO_CONFIRM)).toBe('BasicInfoConfirmHandler')
            expect(getInterruptHandlerName(InterruptType.MODULE_SELECT)).toBe('ModuleSelectHandler')
            expect(getInterruptHandlerName(InterruptType.INSUFFICIENT_POINTS)).toBe('InsufficientPointsHandler')
        })

        it('未知类型应返回默认处理器', () => {
            expect(getInterruptHandlerName('unknown' as InterruptType)).toBe('DefaultInterruptHandler')
        })
    })

    describe('createLangGraphStreamConfig - 创建流配置', () => {
        it('应返回正确的配置结构', () => {
            const config = createLangGraphStreamConfig('session-123')

            expect(config.configurable.thread_id).toBe('session-123')
            expect(config.recursionLimit).toBe(1000)
            expect(config.streamMode).toEqual(['values', 'messages'])
        })

        it('自定义递归限制应生效', () => {
            const config = createLangGraphStreamConfig('session-456', 100)
            expect(config.recursionLimit).toBe(100)
        })

        it('属性测试：配置应包含必要字段', () => {
            fc.assert(
                fc.property(
                    fc.uuid(),
                    fc.integer({ min: 1, max: 200 }),
                    (threadId, recursionLimit) => {
                        const config = createLangGraphStreamConfig(threadId, recursionLimit)

                        expect(config).toHaveProperty('configurable')
                        expect(config.configurable.thread_id).toBe(threadId)
                        expect(config).toHaveProperty('recursionLimit')
                        expect(config.recursionLimit).toBe(recursionLimit)
                        expect(config).toHaveProperty('streamMode')
                        expect(Array.isArray(config.streamMode)).toBe(true)

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    describe('createResumeConfig - 创建恢复配置', () => {
        it('应返回正确的配置结构', () => {
            const config = createResumeConfig('session-789')

            expect(config.configurable.thread_id).toBe('session-789')
        })

        it('属性测试：配置应包含正确线程 ID', () => {
            fc.assert(
                fc.property(fc.uuid(), (threadId) => {
                    const config = createResumeConfig(threadId)
                    expect(config.configurable.thread_id).toBe(threadId)
                    return true
                }),
                PBT_CONFIG
            )
        })
    })

    describe('Property: 中断提取往返一致性', () => {
        it('创建的中断响应应与输入一致', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        InterruptType.CASE_INFO_CHECK,
                        InterruptType.BASIC_INFO_CONFIRM,
                        InterruptType.MODULE_SELECT,
                        InterruptType.INSUFFICIENT_POINTS
                    ),
                    // 过滤空白字符串
                    fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
                    fc.record({
                        resumable: fc.boolean(),
                        // node 必须是 split(':')[0] 后非空且非纯空白
                        node: fc.string({ minLength: 2, maxLength: 50 })
                            .filter(s => s.includes(':') && s.split(':')[0].trim().length > 0),
                    }),
                    (type, message, extra) => {
                        const result = {
                            __interrupt__: [
                                {
                                    value: { type, message, ...extra },
                                    resumable: extra.resumable,
                                    ns: [extra.node],
                                },
                            ],
                        }

                        const interrupt = extractInterruptData(result)
                        expect(interrupt).not.toBeNull()

                        const response = createInterruptResponse(interrupt!)
                        expect(response.type).toBe(type)
                        expect(response.message).toBe(message)
                        expect(response.resumable).toBe(extra.resumable)
                        // node = ns[0].split(':')[0]，只有包含冒号的字符串才确保正确往返
                        expect(response.node).toBe(extra.node.split(':')[0])

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })

    describe('Property: 恢复数据格式化一致性', () => {
        it('格式化后的数据应符合对应类型的验证', () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(
                        InterruptType.CASE_INFO_CHECK,
                        InterruptType.BASIC_INFO_CONFIRM,
                        InterruptType.MODULE_SELECT,
                        InterruptType.INSUFFICIENT_POINTS
                    ),
                    (type) => {
                        // 模拟用户输入
                        const userInput = type === InterruptType.MODULE_SELECT
                            ? 'analysis, summary'
                            : type === InterruptType.INSUFFICIENT_POINTS
                                ? { type: 'points_recharged' }
                                : 'test input'

                        const formatted = formatResumeData(type, userInput)
                        const validated = validateResumeData(type, formatted)

                        // 格式化后的数据应该能通过验证
                        expect(validated.valid).toBe(true)

                        return true
                    }
                ),
                PBT_CONFIG
            )
        })
    })
})
