/**
 * 聊天模型工厂单元测试
 *
 * 测试 chatModelFactory 根据 SDK 类型创建正确的 LangChain 模型实例
 *
 * **Feature: model-sdk-type**
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { ChatOpenAI } from '@langchain/openai'
import { ChatDeepSeek } from '@langchain/deepseek'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatAnthropic } from '@langchain/anthropic'
import {
    createChatModel,
    isValidSdkType,
    getSupportedSdkTypes,
    type ChatModelConfig,
} from '../../../server/services/node/chatModelFactory'
import { SDK_TYPES, type SdkType } from '../../../shared/types/model'
import { sdkTypeArb, invalidSdkTypeArb, PBT_CONFIG_STANDARD } from './test-generators'

describe('聊天模型工厂测试', () => {
    // ==================== Property 1: SDK 类型枚举值验证 ====================

    describe('Property 1: SDK 类型枚举值验证', () => {
        /**
         * **Validates: Requirements 3.3**
         * 对于任意 sdkType 值，如果它是 'openai'、'deepseek'、'gemini'、'anthropic' 之一，
         * 则应该被系统接受；否则应该被拒绝。
         */
        it('有效的 SDK 类型应被接受', () => {
            fc.assert(
                fc.property(sdkTypeArb, (sdkType) => {
                    expect(isValidSdkType(sdkType)).toBe(true)
                    return true
                }),
                PBT_CONFIG_STANDARD
            )
        })

        it('无效的 SDK 类型应被拒绝', () => {
            fc.assert(
                fc.property(invalidSdkTypeArb, (sdkType) => {
                    expect(isValidSdkType(sdkType)).toBe(false)
                    return true
                }),
                PBT_CONFIG_STANDARD
            )
        })

        it('getSupportedSdkTypes 应返回所有支持的类型', () => {
            const supportedTypes = getSupportedSdkTypes()
            expect(supportedTypes).toEqual(SDK_TYPES)
            expect(supportedTypes).toContain('openai')
            expect(supportedTypes).toContain('deepseek')
            expect(supportedTypes).toContain('gemini')
            expect(supportedTypes).toContain('anthropic')
        })
    })

    // ==================== Property 2: 聊天模型工厂正确实例化 ====================

    describe('Property 2: 聊天模型工厂正确实例化', () => {
        const baseConfig = {
            modelName: 'test-model',
            apiKey: 'sk-test-key-12345',
            temperature: 0.7,
            streaming: true,
        }

        /**
         * **Validates: Requirements 5.1**
         * openai → ChatOpenAI
         */
        it('sdkType 为 openai 时应创建 ChatOpenAI 实例', () => {
            const config: ChatModelConfig = {
                ...baseConfig,
                sdkType: 'openai',
            }

            const model = createChatModel(config)
            expect(model).toBeInstanceOf(ChatOpenAI)
        })

        /**
         * **Validates: Requirements 5.2**
         * deepseek → ChatDeepSeek
         */
        it('sdkType 为 deepseek 时应创建 ChatDeepSeek 实例', () => {
            const config: ChatModelConfig = {
                ...baseConfig,
                sdkType: 'deepseek',
            }

            const model = createChatModel(config)
            expect(model).toBeInstanceOf(ChatDeepSeek)
        })

        /**
         * **Validates: Requirements 5.3**
         * gemini → ChatGoogleGenerativeAI
         */
        it('sdkType 为 gemini 时应创建 ChatGoogleGenerativeAI 实例', () => {
            const config: ChatModelConfig = {
                ...baseConfig,
                sdkType: 'gemini',
            }

            const model = createChatModel(config)
            expect(model).toBeInstanceOf(ChatGoogleGenerativeAI)
        })

        /**
         * **Validates: Requirements 5.4**
         * anthropic → ChatAnthropic
         */
        it('sdkType 为 anthropic 时应创建 ChatAnthropic 实例', () => {
            const config: ChatModelConfig = {
                ...baseConfig,
                sdkType: 'anthropic',
            }

            const model = createChatModel(config)
            expect(model).toBeInstanceOf(ChatAnthropic)
        })

        /**
         * **Validates: Requirements 5.5**
         * 不支持的 sdkType 应抛出明确的错误信息
         */
        it('不支持的 sdkType 应抛出错误', () => {
            fc.assert(
                fc.property(invalidSdkTypeArb, (invalidType) => {
                    const config = {
                        ...baseConfig,
                        sdkType: invalidType as SdkType,
                    }

                    expect(() => createChatModel(config)).toThrow(/不支持的 SDK 类型|缺少 sdkType/)
                    return true
                }),
                { numRuns: 20, seed: 42 }
            )
        })

        it('属性测试：所有有效 SDK 类型都应成功创建模型实例', () => {
            fc.assert(
                fc.property(sdkTypeArb, (sdkType) => {
                    const config: ChatModelConfig = {
                        ...baseConfig,
                        sdkType: sdkType as SdkType,
                    }

                    const model = createChatModel(config)
                    expect(model).toBeDefined()
                    return true
                }),
                PBT_CONFIG_STANDARD
            )
        })
    })

    // ==================== 参数验证测试 ====================

    describe('参数验证测试', () => {
        it('缺少 sdkType 应抛出错误', () => {
            const config = {
                modelName: 'test-model',
                apiKey: 'sk-test-key',
            } as ChatModelConfig

            expect(() => createChatModel(config)).toThrow(/缺少 sdkType 参数/)
        })

        it('缺少 modelName 应抛出错误', () => {
            const config = {
                sdkType: 'openai',
                apiKey: 'sk-test-key',
            } as ChatModelConfig

            expect(() => createChatModel(config)).toThrow(/缺少 modelName 参数/)
        })

        it('缺少 apiKey 应抛出错误', () => {
            const config = {
                sdkType: 'openai',
                modelName: 'test-model',
            } as ChatModelConfig

            expect(() => createChatModel(config)).toThrow(/缺少 apiKey 参数/)
        })
    })

    // ==================== 配置传递测试 ====================

    describe('配置传递测试', () => {
        it('baseUrl 应正确传递给 OpenAI 模型', () => {
            const config: ChatModelConfig = {
                sdkType: 'openai',
                modelName: 'gpt-4',
                apiKey: 'sk-test-key',
                baseUrl: 'https://custom.api.com/v1',
            }

            const model = createChatModel(config)
            expect(model).toBeInstanceOf(ChatOpenAI)
        })

        it('temperature 和 streaming 应使用默认值', () => {
            const config: ChatModelConfig = {
                sdkType: 'openai',
                modelName: 'gpt-4',
                apiKey: 'sk-test-key',
            }

            const model = createChatModel(config)
            expect(model).toBeInstanceOf(ChatOpenAI)
        })
    })
})
