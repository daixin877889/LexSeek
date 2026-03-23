/**
 * 统一对话 API 端点（新版）
 *
 * POST /api/v1/case/analysis/chat
 *
 * 支持首次分析引导 + 后续自由对话
 * 使用 agent.stream() + encoding: "text/event-stream"，
 * 返回 LangGraph 内置 toEventStream() 生成的标准 SSE 流，
 * 前端 @langchain/vue useStream + FetchStreamTransport 直接消费
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

    // 7. 获取 SSE 流（encoding: "text/event-stream" 使 LangGraph 内置
    //    toEventStream() 将 [namespace, streamMode, data] 三元组转为标准 SSE）
    const sseStream = await runCaseChat(sessionId, userMessage, {
        userId: user.id,
        caseId: caseInfo.id,
        thinking,
    })

    // 8. 直接返回 ReadableStream，内容已是标准 SSE 格式
    return new Response(sseStream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    })
})
