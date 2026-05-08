/**
 * 聊天模型工厂
 *
 * 根据 SDK 类型动态创建对应的 LangChain 聊天模型实例
 * 支持 OpenAI、DeepSeek、Gemini、Anthropic 四种 SDK 类型
 *
 * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 * @see design.md - 聊天模型工厂接口设计
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatOpenAI } from '@langchain/openai'
import { ChatDeepSeek } from '@langchain/deepseek'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatAnthropic } from '@langchain/anthropic'
import type { SdkType } from '#shared/types/model'
import { SDK_TYPES } from '#shared/types/model'
import type { CachedPrompt } from '#shared/types/prompt'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 聊天模型创建配置
 * 包含创建模型实例所需的所有参数
 */
export interface ChatModelConfig {
    /** LangChain SDK 类型 */
    sdkType: SdkType
    /** 模型名称（如 gpt-4、deepseek-chat 等） */
    modelName: string
    /** API 密钥 */
    apiKey: string
    /** API 基础 URL（可选，用于自定义端点） */
    baseUrl?: string
    /** 温度参数（可选，控制输出随机性，默认 0.7） */
    temperature?: number
    /** 是否启用流式输出（可选，默认 true） */
    streaming?: boolean
    /** 是否启用 extended thinking（仅 anthropic SDK 生效） */
    thinking?: boolean
    /**
     * 单次调用输出 tokens 上限（max_tokens）。
     *
     * 不传时使用各 SDK 合理默认值（8192），避免默认 4096 导致证据清单、辩护思路等
     * 长报告模块被硬截断在 stop_reason='max_tokens'。
     */
    maxTokens?: number
}

/** 各 SDK 的 output tokens 默认上限（取各厂商 API 支持的较大合理值） */
const DEFAULT_MAX_TOKENS = 8192

// ============================================================================
// 模型创建器映射
// ============================================================================

/**
 * SDK 类型到模型创建函数的映射
 * 每个创建函数负责实例化对应的 LangChain 聊天模型
 */
const modelCreators: Record<SdkType, (config: ChatModelConfig) => BaseChatModel> = {
    /**
     * 创建 OpenAI 聊天模型实例
     * 使用 @langchain/openai 包的 ChatOpenAI 类
     * @see Requirements 5.1
     */
    openai: (config: ChatModelConfig): BaseChatModel => {
        return new ChatOpenAI({
            model: config.modelName,
            apiKey: config.apiKey,
            configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
            temperature: config.temperature ?? 0.7,
            streaming: config.streaming ?? true,
            maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
        })
    },

    /**
     * 创建 DeepSeek 聊天模型实例
     * 使用 @langchain/deepseek 包的 ChatDeepSeek 类
     * @see Requirements 5.2
     */
    deepseek: (config: ChatModelConfig): BaseChatModel => {
        return new ChatDeepSeek({
            model: config.modelName,
            apiKey: config.apiKey,
            configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
            temperature: config.temperature ?? 0.7,
            streaming: config.streaming ?? true,
            maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
        })
    },

    /**
     * 创建 Google Gemini 聊天模型实例
     * 使用 @langchain/google-genai 包的 ChatGoogleGenerativeAI 类
     * 注意：Gemini 模型的配置方式与 OpenAI 兼容模型略有不同
     * @see Requirements 5.3
     */
    gemini: (config: ChatModelConfig): BaseChatModel => {
        return new ChatGoogleGenerativeAI({
            model: config.modelName,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            temperature: config.temperature ?? 0.7,
            streaming: config.streaming ?? true,
            maxOutputTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(config.thinking && {
                thinkingConfig: { thinkingBudget: 10_000 },
            }),
        })
    },

    /**
     * 创建 Anthropic Claude 聊天模型实例
     * 使用 @langchain/anthropic 包的 ChatAnthropic 类
     * @see Requirements 5.4
     */
    anthropic: (config: ChatModelConfig): BaseChatModel => {
        return new ChatAnthropic({
            model: config.modelName,
            apiKey: config.apiKey,
            anthropicApiUrl: config.baseUrl,
            temperature: config.thinking ? 1 : (config.temperature ?? 0.7),
            streaming: config.streaming ?? true,
            maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
            // 防止 Anthropic SDK 从 ANTHROPIC_AUTH_TOKEN 环境变量读取 Bearer token
            // 并同时发送 X-Api-Key + Authorization: Bearer，导致 DeepSeek 等兼容接口 401
            clientOptions: { authToken: null },
            ...(config.thinking && {
                thinking: { type: 'enabled' as const, budget_tokens: 10_000 },
            }),
        })
    },
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 根据 SDK 类型创建对应的聊天模型实例
 *
 * 该函数是聊天模型工厂的核心入口，根据配置中的 sdkType 字段
 * 动态选择对应的 LangChain SDK 包创建模型实例
 *
 * @param config 模型创建配置
 * @returns 聊天模型实例（BaseChatModel 类型）
 * @throws Error 当 sdkType 不支持时抛出明确的错误信息
 *
 * @example
 * ```typescript
 * // 创建 OpenAI 模型
 * const openaiModel = createChatModel({
 *     sdkType: 'openai',
 *     modelName: 'gpt-4',
 *     apiKey: 'sk-xxx',
 *     baseUrl: 'https://api.openai.com/v1',
 * })
 *
 * // 创建 DeepSeek 模型
 * const deepseekModel = createChatModel({
 *     sdkType: 'deepseek',
 *     modelName: 'deepseek-chat',
 *     apiKey: 'sk-xxx',
 * })
 * ```
 *
 * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */
/**
 * 根据 apiKey 前缀软校验 sdkType：不匹配时 logger.warn，不抛错。
 *
 * 为什么只 warn：
 *   - DeepSeek / OpenAI / OpenAI 兼容网关（Azure / SiliconFlow / 硅基流动等）都用 `sk-...` 前缀，无法严格区分
 *   - 用户可能通过自定义 baseUrl 让任意 key 走 openai SDK（OpenAI 兼容协议）
 *   - 但 Anthropic 和 Gemini 的 key 有独特前缀，错配几乎肯定是运营配错
 *
 * 触发场景（线上）：
 *   - contractReviewMain 节点的 sdkType='anthropic' 但 apiKey 形如 'sk-...'
 *     → 走 ChatAnthropic，实际请求 /v1/messages，用 deepseek key 必然 401
 */
function warnIfSdkKeyMismatch(sdkType: SdkType, apiKey: string): void {
    const isAnthropicKey = apiKey.startsWith('sk-ant-')
    const isGeminiKey = apiKey.startsWith('AIza')

    if (sdkType === 'anthropic' && !isAnthropicKey) {
        logger.warn('[chatModelFactory] sdkType=anthropic 但 apiKey 不像 Anthropic key（通常以 sk-ant- 开头）', {
            sdkType,
            apiKeyPrefix: apiKey.slice(0, 8) + '***',
        })
    } else if (sdkType !== 'anthropic' && isAnthropicKey) {
        logger.warn('[chatModelFactory] apiKey 像 Anthropic key 但 sdkType 是其它值', {
            sdkType,
            apiKeyPrefix: apiKey.slice(0, 8) + '***',
        })
    } else if (sdkType === 'gemini' && !isGeminiKey) {
        logger.warn('[chatModelFactory] sdkType=gemini 但 apiKey 不像 Gemini key（通常以 AIza 开头）', {
            sdkType,
            apiKeyPrefix: apiKey.slice(0, 8) + '***',
        })
    }
}

export function createChatModel(config: ChatModelConfig): BaseChatModel {
    // 验证配置参数
    if (!config.sdkType) {
        throw new Error('创建聊天模型失败：缺少 sdkType 参数')
    }

    if (!config.modelName) {
        throw new Error('创建聊天模型失败：缺少 modelName 参数')
    }

    if (!config.apiKey) {
        throw new Error('创建聊天模型失败：缺少 apiKey 参数')
    }

    warnIfSdkKeyMismatch(config.sdkType, config.apiKey)

    // 获取对应的模型创建器
    const creator = modelCreators[config.sdkType]

    // 验证 SDK 类型是否支持
    // @see Requirements 5.5
    if (!creator) {
        const supportedTypes = SDK_TYPES.join('、')
        throw new Error(
            `不支持的 SDK 类型: ${config.sdkType}，支持的类型: ${supportedTypes}`
        )
    }

    // 创建并返回模型实例
    return creator(config)
}

/**
 * 验证 SDK 类型是否有效
 *
 * @param sdkType 待验证的 SDK 类型
 * @returns 如果有效返回 true，否则返回 false
 */
export function isValidSdkType(sdkType: string): sdkType is SdkType {
    return SDK_TYPES.includes(sdkType as SdkType)
}

/**
 * 获取所有支持的 SDK 类型列表
 *
 * @returns SDK 类型数组
 */
export function getSupportedSdkTypes(): readonly SdkType[] {
    return SDK_TYPES
}

/**
 * 把 CachedPrompt → Anthropic 风格的 content block 数组
 * 用于构建 SystemMessage({ content: [...blocks] }) 传给 Anthropic 模型
 *
 * Anthropic cache_control 规则：
 * - 1h TTL：{ type: 'ephemeral', ttl: '1h' }（显式传 ttl）
 * - 5m TTL：{ type: 'ephemeral' }（不传 ttl，Anthropic 默认 5m）
 * - 无 cache：只有 { type: 'text', text: '...' }
 */
export function cachedPromptToAnthropicContent(
    segments: CachedPrompt,
): Array<Record<string, unknown>> {
    return segments.map((seg) => {
        const block: Record<string, unknown> = { type: 'text', text: seg.text }
        if (seg.cache) {
            if (seg.cache.ttl === '1h') {
                block.cache_control = { type: 'ephemeral', ttl: '1h' }
            } else {
                block.cache_control = { type: 'ephemeral' }
            }
        }
        return block
    })
}

/**
 * 把 CachedPrompt → 纯字符串（OpenAI / DeepSeek 用）
 * cache 字段被忽略，只要前缀稳定即可自动命中
 */
export function cachedPromptToPlainText(segments: CachedPrompt): string {
    return segments.map((seg) => seg.text).join('\n\n')
}

/**
 * 统一记录 prompt cache 命中率日志（Anthropic/OpenAI/DeepSeek 字段名不同）
 */
export function logPromptCacheMetrics(provider: string, model: string, usage: any): void {
    let hit = 0
    let total = 0
    if (provider === 'anthropic') {
        hit = usage?.cache_read_input_tokens ?? 0
        total = (usage?.input_tokens ?? 0) + hit
    } else if (provider === 'openai') {
        hit = usage?.prompt_tokens_details?.cached_tokens ?? 0
        total = usage?.prompt_tokens ?? 0
    } else if (provider === 'deepseek') {
        hit = usage?.prompt_cache_hit_tokens ?? 0
        total = usage?.prompt_tokens ?? 0
    }
    logger.info('prompt_cache', { provider, model, hit, total, hitRate: total ? hit / total : 0 })
}
