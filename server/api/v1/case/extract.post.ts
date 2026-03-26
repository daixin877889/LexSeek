/**
 * AI 信息提取 SSE 端点
 *
 * POST /api/v1/case/extract
 *
 * 调用 extractInfo 节点从案件材料中提取结构化信息
 * 支持流式输出和最终结构化结果
 *
 * SSE 事件：
 * - event: streaming, data: { content: "..." }      // 流式文本
 * - event: extracted, data: { ...ExtractedCaseInfo } // 最终结构化结果
 * - event: error, data: { message: "..." }           // 错误
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
        return resError(event, 400, parsed.error.issues[0].message)
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
        streaming: true,
    })

    // 5. 构建提示（注入材料信息）
    const systemPromptConfig = nodeConfig.prompts?.find(
        (p: { type: string; status: number }) => p.type === 'system' && p.status === 1,
    )
    const systemPrompt = systemPromptConfig?.content ?? ''
    const materialContext = materials?.length
        ? `\n\n用户上传的材料：\n${materials.map(m => `- ${m.name} (ossFileId: ${m.ossFileId})`).join('\n')}`
        : ''

    // 6. 设置 SSE 响应头
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    // 7. 创建 SSE 流
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder()
            const abortController = new AbortController()

            event.node.req.on('close', () => {
                abortController.abort()
            })

            try {
                const messages = [
                    new SystemMessage(systemPrompt + materialContext),
                    new HumanMessage(message),
                ]

                // 如果配置了 outputSchema，使用结构化输出
                if (nodeConfig.outputSchema) {
                    const structuredModel = model.withStructuredOutput(nodeConfig.outputSchema)
                    const result = await structuredModel.invoke(messages)
                    controller.enqueue(encoder.encode(
                        `event: extracted\ndata: ${JSON.stringify(result)}\n\n`,
                    ))
                } else {
                    // 流式输出
                    const streamResult = await model.stream(messages, {
                        signal: abortController.signal,
                    })

                    let fullContent = ''
                    for await (const chunk of streamResult) {
                        const content = typeof chunk.content === 'string' ? chunk.content : ''
                        if (content) {
                            fullContent += content
                            controller.enqueue(encoder.encode(
                                `event: streaming\ndata: ${JSON.stringify({ content })}\n\n`,
                            ))
                        }
                    }

                    // 发送完整结果
                    controller.enqueue(encoder.encode(
                        `event: extracted\ndata: ${JSON.stringify({ content: fullContent })}\n\n`,
                    ))
                }
            } catch (err: any) {
                if (!abortController.signal.aborted) {
                    logger.error('信息提取失败:', err)
                    controller.enqueue(encoder.encode(
                        `event: error\ndata: ${JSON.stringify({ message: err.message ?? '提取失败' })}\n\n`,
                    ))
                }
            } finally {
                controller.close()
            }
        },
    })

    return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
    })
})
