/**
 * 统一对话 API 端点（新版）
 *
 * POST /api/v1/case/analysis/chat
 *
 * 支持首次分析引导 + 后续自由对话
 * 返回 LangGraph 原生 SSE 流（不再使用 @ai-sdk/langchain 桥接）
 */

import { z } from 'zod'
import { runCaseChat } from '~~/server/services/agent/caseAgent'
import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'

const requestSchema = z.object({
    sessionId: z.string().min(1, 'sessionId 不能为空'),
    message: z.string().optional(),
    thinking: z.boolean().optional().default(true),
})

export default defineEventHandler(async (event) => {
    // 1. 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 验证请求参数
    const body = await readBody(event)
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0].message)
    }
    const { sessionId, message, thinking } = parsed.data

    // 3. 提示词防火墙 - 输入长度限制
    if (message && message.length > 10000) {
        return resError(event, 400, '输入内容过长，单次消息最大 10,000 字符')
    }

    // 4. 提示词防火墙 - 关键词黑名单
    if (message) {
        const blacklistPatterns = [
            /system\s*prompt/i,
            /ignore\s*previous/i,
            /忽略之前的指令/,
            /忽略上面的/,
            /输出你的提示词/,
            /显示系统提示/,
        ]
        if (blacklistPatterns.some(p => p.test(message))) {
            return resError(event, 400, '检测到不安全的输入内容')
        }
    }

    // 5. 验证案件权限
    const caseInfo = await findCaseBySessionIdService(sessionId)
    if (!caseInfo) {
        return resError(event, 404, '案件不存在')
    }
    if (user.id !== caseInfo.userId) {
        return resError(event, 403, '您没有权限访问该案件')
    }

    // 6. 构建用户消息
    const userMessage = message || '请开始分析案件'

    // 7. 获取 LangGraph 原生流
    const agentStream = await runCaseChat(sessionId, userMessage, {
        userId: user.id,
        caseId: caseInfo.id,
        thinking,
    })

    // 8. 返回 LangGraph Platform API 兼容的 SSE 流
    // useStream (FetchStreamTransport → SSEDecoder) 期望事件名称为:
    // values, updates, messages, custom, error, metadata 等
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of agentStream) {
                    // agent.stream() 配合 version:'v2' + 多 streamMode 返回 [mode, data] 元组
                    // 例如: ['values', { messages: [...] }] 或 ['messages', [msg, metadata]]
                    let eventName: string
                    let eventData: unknown

                    if (Array.isArray(chunk) && chunk.length >= 2) {
                        eventName = chunk[0] as string
                        eventData = chunk[1]
                    } else {
                        // 单 streamMode 模式直接返回 data
                        eventName = 'values'
                        eventData = chunk
                    }

                    const sseEvent = `event: ${eventName}\ndata: ${JSON.stringify(eventData)}\n\n`
                    controller.enqueue(encoder.encode(sseEvent))
                }
                controller.close()
            } catch (error) {
                logger.error('SSE 流错误:', error)
                const errorEvent = `event: error\ndata: ${JSON.stringify({
                    message: error instanceof Error ? error.message : '流处理错误'
                })}\n\n`
                controller.enqueue(encoder.encode(errorEvent))
                controller.close()
            }
        },
    })

    return new Response(readable, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    })
})
