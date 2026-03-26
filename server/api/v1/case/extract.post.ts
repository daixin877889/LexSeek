/**
 * AI 信息提取端点
 *
 * POST /api/v1/case/extract
 *
 * 调用 extractInfo 节点从案件描述中提取结构化信息
 * 返回 JSON 格式的 ExtractedCaseInfo
 */

import { z } from 'zod'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

const EXTRACT_NODE_NAME = 'extractInfo'

const schema = z.object({
    message: z.string().min(1),
    materials: z.array(z.object({
        ossFileId: z.number().int().positive(),
        name: z.string(),
    })).optional(),
})

export default defineEventHandler(async (event) => {
    // 1. 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 解析请求体
    const body = await readBody(event)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数校验失败')
    }

    const { message, materials } = parsed.data

    // 3. 加载 extractInfo 节点配置
    let nodeConfig
    try {
        nodeConfig = await getValidNodeConfig(EXTRACT_NODE_NAME, '信息提取')
    } catch (err: any) {
        return resError(event, 500, err.message)
    }

    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        return resError(event, 500, '信息提取节点无可用 API 密钥')
    }

    // 4. 创建模型（提取任务用低温度）
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.3,
        streaming: false,
    })

    // 5. 构建提示
    const systemPromptConfig = nodeConfig.prompts?.find(
        (p: { type: string; status: number }) => p.type === 'system' && p.status === 1,
    )
    const systemPrompt = systemPromptConfig?.content ?? ''
    const materialContext = materials?.length
        ? `\n\n用户上传的材料：\n${materials.map(m => `- ${m.name} (ossFileId: ${m.ossFileId})`).join('\n')}`
        : ''

    try {
        const messages = [
            new SystemMessage(systemPrompt + materialContext),
            new HumanMessage(message),
        ]

        // 6. 调用模型（结构化输出或普通文本）
        if (nodeConfig.outputSchema) {
            const structuredModel = model.withStructuredOutput(nodeConfig.outputSchema)
            const result = await structuredModel.invoke(messages)
            return resSuccess(event, '提取成功', {
                message: '已为您提取案件信息，请确认以下内容：',
                extractedInfo: result,
            })
        } else {
            const result = await model.invoke(messages)
            const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
            return resSuccess(event, '提取成功', {
                message: content,
                extractedInfo: null,
            })
        }
    } catch (err: any) {
        logger.error('信息提取失败:', err)
        return resError(event, 500, '信息提取失败，请重试')
    }
})
