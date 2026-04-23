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

/** 默认 system prompt */
const DEFAULT_SYSTEM_PROMPT = `你是法律检索意图分类器。根据用户的查询，判断最佳检索策略，以 JSON 格式输出结果。

## 判断优先级（按顺序判断，命中即停）

1. exact（精确查找）— 查询中包含"法律名称 + 条文编号"
   条文编号支持中文和阿拉伯数字（第264条 = 第二百六十四条）
   示例："民法典第1000条"、"刑法第264条"、"劳动合同法第46条第2款"、"民法典第一千零七十九条"
   → 提取 legalName + articleRef（articleRef 统一转为中文数字格式）

2. hybrid（混合检索）— 以专业视角提问，包含专业法律术语或法律名称，但没有条文编号
   不要求必须出现法律名称，只要查询整体是专业化表达即可
   专业法律术语举例：格式条款、诉讼时效、违约金、不当得利、善意取得、行政复议、正当防卫、缓刑、数罪并罚
   示例（含法律名称）："劳动合同法关于经济补偿的规定"、"公司法股东权益保护"、"民法典侵权责任编归责原则"
   示例（不含法律名称，但有专业术语）："合同解除的法定条件"、"违约金调整规则"、"格式条款的效力"、"正当防卫的构成要件"、"诉讼时效中断的情形"、"行政复议申请条件"
   → 提取 keywords + rewrittenQuery（如有法律名称也提取 legalName）

3. semantic（语义检索）— 以普通人视角用口语化方式描述法律问题
   即使提到了"继承"、"犯罪"、"股东"等日常化的法律概念词，只要整体是口语化表达就属于 semantic
   示例："员工被公司无故辞退后能获得什么赔偿"、"租的房子到期房东不退押金怎么办"、"网上买的东西质量有问题可以退货吗"、"未成年人犯罪会被判刑吗"、"遗产继承的顺序是什么"、"公司股东之间发生矛盾怎么解决"
   → 提取 keywords + rewrittenQuery`

// ============================================================================
// 主服务函数
// ============================================================================

/**
 * 构建 Redis 缓存 key
 *
 * 格式：intent:{type}:{normalizedQuery 的 sha256 前 16 位}
 */
function buildCacheKey(type: 'law' | 'case_material' | 'case_memory', normalizedQuery: string): string {
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
    type: 'law' | 'case_material' | 'case_memory',
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
                // 读取端降级：案件材料不支持 exact
                if (type === 'case_material' && parsed.intent === 'exact') {
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

        // 获取 system prompt（从节点 prompts 中取 type='system' 的）
        const systemPromptContent =
            config.prompts.find((p: { type: string; content: string }) => p.type === 'system')?.content
            ?? DEFAULT_SYSTEM_PROMPT

        // 使用 outputSchema
        const outputSchema = config.outputSchema ?? DEFAULT_OUTPUT_SCHEMA
        const structuredModel = model.withStructuredOutput(outputSchema)

        // 案件材料检索额外提示：不支持 exact 通道
        const typeHint = type === 'case_material'
            ? '\n\n注意：这是案件材料检索，不存在精确通道。只能分类为 hybrid 或 semantic。'
            : ''

        const messages = [
            new SystemMessage(systemPromptContent + typeHint),
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
                systemPrompt: systemPromptContent + typeHint,
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

        // 案件材料检索不支持 exact，强制降级为 hybrid
        if (type === 'case_material' && result.intent === 'exact') {
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
