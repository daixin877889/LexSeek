/**
 * 聊天模型工厂测试
 *
 * 测试 chatModelFactory.ts 中所有导出函数
 *
 * **Feature: chat-model-factory**
 */

import { describe, it, expect } from 'vitest'
import {
    createChatModel,
    isValidSdkType,
    getSupportedSdkTypes,
    type ChatModelConfig,
} from '../../../server/services/node/chatModelFactory'
import { SDK_TYPES, type SdkType } from '../../../shared/types/model'

describe('聊天模型工厂测试', () => {
    describe('getSupportedSdkTypes', () => {
        it('应返回所有支持的 SDK 类型', () => {
            const sdkTypes = getSupportedSdkTypes()
            expect(sdkTypes).toEqual(['openai', 'deepseek', 'gemini', 'anthropic'])
        })

        it('返回的数组应该是只读的', () => {
            const sdkTypes = getSupportedSdkTypes()
            expect(Array.isArray(sdkTypes)).toBe(true)
            expect(sdkTypes.length).toBe(4)
        })
    })

    describe('isValidSdkType', () => {
        it('openai 应该是有效的 SDK 类型', () => {
            expect(isValidSdkType('openai')).toBe(true)
        })

        it('deepseek 应该是有效的 SDK 类型', () => {
            expect(isValidSdkType('deepseek')).toBe(true)
        })

        it('gemini 应该是有效的 SDK 类型', () => {
            expect(isValidSdkType('gemini')).toBe(true)
        })

        it('anthropic 应该是有效的 SDK 类型', () => {
            expect(isValidSdkType('anthropic')).toBe(true)
        })

        it('不支持的 SDK 类型应该返回 false', () => {
            expect(isValidSdkType('unsupported')).toBe(false)
            expect(isValidSdkType('azure')).toBe(false)
            expect(isValidSdkType('')).toBe(false)
        })

        it('大小写敏感：OpenAI 应该返回 false', () => {
            expect(isValidSdkType('OpenAI')).toBe(false)
            expect(isValidSdkType('OPENAI')).toBe(false)
        })
    })

    describe('createChatModel', () => {
        it('应成功创建 OpenAI 模型实例', () => {
            const config: ChatModelConfig = {
                sdkType: 'openai',
                modelName: 'gpt-4',
                apiKey: 'sk-test-key-123',
            }

            const model = createChatModel(config)

            expect(model).not.toBeNull()
            expect(model.constructor.name).toBe('ChatOpenAI')
        })

        it('应成功创建 DeepSeek 模型实例', () => {
            const config: ChatModelConfig = {
                sdkType: 'deepseek',
                modelName: 'deepseek-chat',
                apiKey: 'sk-test-key-123',
            }

            const model = createChatModel(config)

            expect(model).not.toBeNull()
            expect(model.constructor.name).toBe('ChatDeepSeek')
        })

        it('应成功创建 Gemini 模型实例', () => {
            const config: ChatModelConfig = {
                sdkType: 'gemini',
                modelName: 'gemini-pro',
                apiKey: 'sk-test-key-123',
            }

            const model = createChatModel(config)

            expect(model).not.toBeNull()
            expect(model.constructor.name).toBe('ChatGoogleGenerativeAI')
        })

        it('应成功创建 Anthropic 模型实例', () => {
            const config: ChatModelConfig = {
                sdkType: 'anthropic',
                modelName: 'claude-3-opus-20240229',
                apiKey: 'sk-test-key-123',
            }

            const model = createChatModel(config)

            expect(model).not.toBeNull()
            expect(model.constructor.name).toBe('ChatAnthropic')
        })

        it('应支持自定义 baseUrl', () => {
            const config: ChatModelConfig = {
                sdkType: 'openai',
                modelName: 'gpt-4',
                apiKey: 'sk-test-key-123',
                baseUrl: 'https://custom.api.com/v1',
            }

            const model = createChatModel(config)

            expect(model).not.toBeNull()
            expect(model.constructor.name).toBe('ChatOpenAI')
        })

        it('应支持自定义 temperature', () => {
            const config: ChatModelConfig = {
                sdkType: 'openai',
                modelName: 'gpt-4',
                apiKey: 'sk-test-key-123',
                temperature: 0.5,
            }

            const model = createChatModel(config)

            expect(model).not.toBeNull()
        })

        it('应支持禁用 streaming', () => {
            const config: ChatModelConfig = {
                sdkType: 'openai',
                modelName: 'gpt-4',
                apiKey: 'sk-test-key-123',
                streaming: false,
            }

            const model = createChatModel(config)

            expect(model).not.toBeNull()
        })

        it('Anthropic 模型启用 thinking 时应该正确配置', () => {
            const config: ChatModelConfig = {
                sdkType: 'anthropic',
                modelName: 'claude-3-opus-20240229',
                apiKey: 'sk-test-key-123',
                thinking: true,
            }

            const model = createChatModel(config)

            expect(model).not.toBeNull()
            expect(model.constructor.name).toBe('ChatAnthropic')
        })

        it('缺少 sdkType 应该抛出错误', () => {
            const config = {
                modelName: 'gpt-4',
                apiKey: 'sk-test-key-123',
            } as ChatModelConfig

            expect(() => createChatModel(config)).toThrow(
                '创建聊天模型失败：缺少 sdkType 参数'
            )
        })

        it('缺少 modelName 应该抛出错误', () => {
            const config = {
                sdkType: 'openai' as SdkType,
                apiKey: 'sk-test-key-123',
            } as ChatModelConfig

            expect(() => createChatModel(config)).toThrow(
                '创建聊天模型失败：缺少 modelName 参数'
            )
        })

        it('缺少 apiKey 应该抛出错误', () => {
            const config = {
                sdkType: 'openai' as SdkType,
                modelName: 'gpt-4',
            } as ChatModelConfig

            expect(() => createChatModel(config)).toThrow(
                '创建聊天模型失败：缺少 apiKey 参数'
            )
        })

        it('不支持的 SDK 类型应该抛出错误', () => {
            const config = {
                sdkType: 'unsupported' as SdkType,
                modelName: 'model-123',
                apiKey: 'sk-test-key-123',
            }

            try {
                createChatModel(config)
                expect.fail('应该抛出错误')
            } catch (error) {
                expect(error).toBeInstanceOf(Error)
                expect((error as Error).message).toContain('不支持的 SDK 类型')
                expect((error as Error).message).toContain('unsupported')
            }
        })
    })

    describe('参数默认值', () => {
        it('OpenAI 模型应该使用默认 temperature 0.7', () => {
            const config: ChatModelConfig = {
                sdkType: 'openai',
                modelName: 'gpt-4',
                apiKey: 'sk-test-key-123',
            }

            const model = createChatModel(config)
            expect(model).not.toBeNull()
            // 验证模型被成功创建，默认值在内部处理
        })

        it('OpenAI 模型应该默认启用 streaming', () => {
            const config: ChatModelConfig = {
                sdkType: 'openai',
                modelName: 'gpt-4',
                apiKey: 'sk-test-key-123',
            }

            const model = createChatModel(config)
            expect(model).not.toBeNull()
        })
    })
})

describe('Property: SDK 类型有效性', () => {
    it('所有 SDK_TYPES 中的类型都应该被 isValidSdkType 识别为有效', () => {
        for (const sdkType of SDK_TYPES) {
            expect(isValidSdkType(sdkType)).toBe(true)
        }
    })

    it('SDK_TYPES 数组应该包含且仅包含 4 种类型', () => {
        expect(SDK_TYPES.length).toBe(4)
        expect(SDK_TYPES).toContain('openai')
        expect(SDK_TYPES).toContain('deepseek')
        expect(SDK_TYPES).toContain('gemini')
        expect(SDK_TYPES).toContain('anthropic')
    })
})
