/**
 * 意图分类服务
 *
 * 使用 LLM 对用户检索查询进行意图分类，
 * 支持精确（exact）、混合（hybrid）、语义（semantic）三种检索策略
 *
 * @see Requirements retrieval/intent-classifier
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { createHash } from 'node:crypto'
import { getValidNodeConfig } from '../node/node.service'
import { renderContent } from '../node/prompt.service'
import { createChatModel } from '../node/chatModelFactory'
import { normalizeQuery, tryExactRegex } from './queryNormalizer'
import { getRedisClient } from '../../lib/redis'
import { logContextOverflow } from '../workflow/context/contextErrorLogger'
import type { IntentClassification } from './types'

// ============================================================================
// 常量定义
// ============================================================================

/** 意图分类节点名称 */
const INTENT_ROUTER_NODE = 'search_intent_router'

/** 默认 outputSchema（节点未配置时使用） */
const DEFAULT_OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
        intent: {
            enum: ['exact', 'hybrid', 'semantic'],
            description: '检索意图类型',
        },
        legalName: {
            type: 'string',
            description: '识别到的法律名称',
        },
        articleRef: {
            type: 'string',
            description: '条文编号，如 第一千条',
        },
        keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '提取的法律术语关键词',
        },
        rewrittenQuery: {
            type: 'string',
            description: '改写后的语义查询',
        },
    },
    required: ['intent'],
}

// ============================================================================
// 主服务函数
// ============================================================================

/**
 * 构建 Redis 缓存 key
 *
 * 格式：intent:{type}:{normalizedQuery 的 sha256 前 16 位}
 */
function buildCacheKey(type: 'law' | 'case_material' | 'case_memory' | 'case_analysis', normalizedQuery: string): string {
    const hash = createHash('sha256').update(normalizedQuery).digest('hex').slice(0, 16)
    return `intent:${type}:${hash}`
}

/**
 * 对查询进行意图分类
 *
 * 优先级：正则前置（仅 law） → Redis 缓存 → LLM 调用
 *
 * @param query 用户查询
 * @param type 检索类型（law 或 case_material）
 * @param options 选项（skipCache: 跳过缓存读写）
 * @returns 意图分类结果，失败时降级返回 semantic
 */
export async function classifyIntentService(
    query: string,
    type: 'law' | 'case_material' | 'case_memory' | 'case_analysis',
    options?: { skipCache?: boolean },
): Promise<IntentClassification> {
    // 步骤 1：查询归一化
    const normalizedQuery = normalizeQuery(query)

    // 步骤 2：正则前置（仅 law 类型，纯 exact 查询直接返回，跳过 LLM）
    if (type === 'law') {
        const regexResult = tryExactRegex(normalizedQuery)
        if (regexResult) return regexResult
    }

    // 步骤 3：Redis 缓存读取
    if (!options?.skipCache) {
        try {
            const cacheKey = buildCacheKey(type, normalizedQuery)
            const raw = await getRedisClient().get(cacheKey)
            if (raw) {
                const parsed = JSON.parse(raw) as IntentClassification
                if (!parsed?.intent || !['exact', 'hybrid', 'semantic'].includes(parsed.intent)) {
                    throw new Error('缓存 intent 无效')
                }
                // 读取端降级：案件材料 / 案件分析不支持 exact
                if ((type === 'case_material' || type === 'case_analysis') && parsed.intent === 'exact') {
                    return { ...parsed, intent: 'hybrid' }
                }
                return parsed
            }
        } catch (e) {
            logger.warn('Redis 缓存读取失败，降级到 LLM:', e)
        }
    }

    // 步骤 4：LLM 调用
    try {
        // 获取节点配置
        const config = await getValidNodeConfig(INTENT_ROUTER_NODE)

        const firstApiKey = config.modelApiKeys[0]
        if (!firstApiKey) {
            throw new Error(`节点 ${INTENT_ROUTER_NODE} 未配置任何 API Key`)
        }

        // 创建模型
        const model = createChatModel({
            sdkType: config.modelSdkType,
            modelName: config.modelName,
            apiKey: firstApiKey.apiKey,
            baseUrl: config.modelProviderBaseUrl,
            temperature: 0,
            streaming: false,
            thinking: false
        })

        // 获取 system prompt（从节点 prompts 中取 type='system' 且 status=1 的）
        const systemTemplate = config.prompts.find(
            (p: { type: string; status: number; content: string }) => p.type === 'system' && p.status === 1,
        )?.content
        if (!systemTemplate) {
            logger.warn('search_intent_router 节点缺少 system prompt（v2），降级为 semantic', { type })
            return { intent: 'semantic', rewrittenQuery: query }
        }

        // 使用 outputSchema
        const outputSchema = config.outputSchema ?? DEFAULT_OUTPUT_SCHEMA
        const structuredModel = model.withStructuredOutput(outputSchema)

        // 案件材料 / 案件分析检索额外提示：不支持 exact 通道
        const typeHint = (type === 'case_material' || type === 'case_analysis')
            ? '\n\n注意：这是案件材料/分析检索，不存在精确通道。只能分类为 hybrid 或 semantic。'
            : ''
        const systemPromptContent = renderContent(systemTemplate, { typeHint })

        const messages = [
            new SystemMessage(systemPromptContent),
            new HumanMessage(query),
        ]

        // 调用模型获取结构化结果
        // tags: ['internal'] 用于 agentWorker 过滤，不将此消息发送到前端消息流
        let result: IntentClassification
        try {
            result = await structuredModel.invoke(messages, {
                tags: ['internal'],
            }) as IntentClassification
        } catch (err) {
            logContextOverflow(err, {
                source: 'intentClassifier',
                modelName: config.modelName,
                sdkType: config.modelSdkType,
                contextWindow: config.modelContextWindow,
                systemPrompt: systemPromptContent,
                extra: { queryLength: query.length, type },
            })
            throw err
        }

        // 校验 intent 合法性，无效时降级为 semantic
        if (!result?.intent || !['exact', 'hybrid', 'semantic'].includes(result.intent)) {
            logger.warn('意图分类结果无效，降级为 semantic:', result)
            return { intent: 'semantic', rewrittenQuery: query }
        }

        // 写入 Redis 缓存（存 LLM 原始结果，不降级）
        if (!options?.skipCache) {
            try {
                const cacheKey = buildCacheKey(type, normalizedQuery)
                await getRedisClient().set(cacheKey, JSON.stringify(result), 'EX', 86400)
            } catch (e) {
                logger.warn('Redis 缓存写入失败:', e)
            }
        }

        // 案件材料 / 案件分析检索不支持 exact，强制降级为 hybrid
        if ((type === 'case_material' || type === 'case_analysis') && result.intent === 'exact') {
            return { ...result, intent: 'hybrid' }
        }

        return result
    } catch (error) {
        // 节点未配置或 LLM 调用失败，降级为 semantic
        logger.warn('意图分类失败，降级为 semantic:', error)
        return {
            intent: 'semantic',
            rewrittenQuery: query,
        }
    }
}

/**
 * 清理意图分类缓存
 *
 * 法条库 / 案件材料 / 案件记忆等数据源发生变更时调用，避免用户拿到陈旧的分类结果。
 *
 * @param type 不传则清所有类型；传则只清单一类型（如 'law' 仅清法条意图缓存）
 * @returns 清理的 key 数量
 */
export async function invalidateIntentCacheService(
    type?: 'law' | 'case_material' | 'case_memory' | 'case_analysis',
): Promise<number> {
    try {
        const redis = getRedisClient()
        const pattern = type ? `intent:${type}:*` : 'intent:*'
        // 用 SCAN 增量遍历替代 KEYS 全量阻塞扫描，避免 Redis 长时间不响应
        let cursor = '0'
        let cleared = 0
        do {
            const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
            if (batch.length > 0) {
                await redis.del(...batch)
                cleared += batch.length
            }
            cursor = next
        } while (cursor !== '0')
        if (cleared > 0) logger.info('意图分类缓存已清', { pattern, cleared })
        return cleared
    } catch (e) {
        logger.warn('意图分类缓存清理失败', { type, error: e })
        return 0
    }
}
