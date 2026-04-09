/**
 * 意图分类服务
 *
 * 使用 LLM 对用户检索查询进行意图分类，
 * 支持精确（exact）、混合（hybrid）、语义（semantic）三种检索策略
 *
 * @see Requirements retrieval/intent-classifier
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { getValidNodeConfig } from '../node/node.service'
import { createChatModel } from '../node/chatModelFactory'
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

1. exact（精确查找）— 用户明确引用了某部法律的某个条文
   示例："民法典第1000条"、"刑法第264条"、"劳动合同法第46条第2款"
   → 提取 legalName + articleRef

2. hybrid（混合检索）— 包含特定法律术语或法律名称，但没有精确条文编号
   示例："劳动合同法关于经济补偿的规定"、"公司法股东权益保护"
   → 提取 legalName + keywords + rewrittenQuery

3. semantic（语义检索）— 自然语言描述法律问题
   示例："员工被无故辞退后如何索赔"、"房屋买卖合同纠纷的赔偿标准"
   → 提取 keywords + rewrittenQuery`

// ============================================================================
// 主服务函数
// ============================================================================

/**
 * 对查询进行意图分类
 *
 * @param query 用户查询
 * @param type 检索类型（law 或 case_material）
 * @returns 意图分类结果，失败时降级返回 semantic
 */
export async function classifyIntentService(
    query: string,
    type: 'law' | 'case_material',
): Promise<IntentClassification> {
    try {
        // 获取节点配置
        const config = await getValidNodeConfig(INTENT_ROUTER_NODE)

        // 创建模型
        const model = createChatModel({
            sdkType: config.modelSdkType,
            modelName: config.modelName,
            apiKey: config.modelApiKeys[0].apiKey,
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
        const result = await structuredModel.invoke(messages) as IntentClassification

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
