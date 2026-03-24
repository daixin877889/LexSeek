/**
 * 统一对话 API 端点（新版）
 *
 * POST /api/v1/case/analysis/chat
 *
 * 兼容 @langchain/vue FetchStreamTransport 协议：
 * - 请求体: { input, config, command, streamSubgraphs }
 * - 响应: LangGraph toEventStream() 生成的标准 SSE 流
 */

import { runCaseChat } from '~~/server/services/agent/caseAgent'
import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'

/** 从 FetchStreamTransport 请求体中提取参数 */
function extractParams(body: any) {
    // FetchStreamTransport 发送: { input, config, command, streamSubgraphs }
    const input = body?.input
    const config = body?.config
    const command = body?.command

    // sessionId: 从 config.configurable.thread_id 读取
    const sessionId = config?.configurable?.thread_id as string | undefined

    // message: 从 input.messages 数组中提取最后一条 human 消息的 content
    let message: string | undefined
    if (input?.messages && Array.isArray(input.messages)) {
        const lastMsg = input.messages.at(-1)
        if (lastMsg) {
            message = typeof lastMsg.content === 'string'
                ? lastMsg.content
                : typeof lastMsg === 'string'
                    ? lastMsg
                    : undefined
        }
    }

    return { sessionId, message, command }
}

/** 提示词防火墙黑名单 */
const BLACKLIST_PATTERNS = [
    /system\s*prompt/i,
    /ignore\s*previous/i,
    /忽略之前的指令/,
    /忽略上面的/,
    /输出你的提示词/,
    /显示系统提示/,
]

export default defineEventHandler(async (event) => {
    // 1. 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 2. 解析 FetchStreamTransport 协议请求体
    const body = await readBody(event)
    const { sessionId, message, command } = extractParams(body)

    if (!sessionId) {
        return resError(event, 400, 'thread_id 不能为空')
    }

    // 3. 提示词防火墙
    if (message) {
        if (message.length > 10000) {
            return resError(event, 400, '输入内容过长，单次消息最大 10,000 字符')
        }
        if (BLACKLIST_PATTERNS.some(p => p.test(message))) {
            return resError(event, 400, '检测到不安全的输入内容')
        }
    }

    console.log('sessionId', sessionId)

    // 4. 验证案件权限
    const caseInfo = await findCaseBySessionIdService(sessionId)
    if (!caseInfo) {
        return resError(event, 404, '案件不存在')
    }
    if (user.id !== caseInfo.userId) {
        return resError(event, 403, '您没有权限访问该案件')
    }

    // 5. 构建用户消息
    const userMessage = message || '请开始分析案件'

    // 6. 获取 SSE 流
    const sseStream = await runCaseChat(sessionId, userMessage, {
        userId: user.id,
        caseId: caseInfo.id,
        thinking: true,
    })

    // // 7. 直接返回 toEventStream 生成的标准 SSE ReadableStream
    // return new Response(sseStream, {
    //     headers: {
    //         'Content-Type': 'text/event-stream',
    //         'Cache-Control': 'no-cache',
    //         'Connection': 'keep-alive',
    //         'X-Accel-Buffering': 'no',
    //     },
    // })


    // 设置 SSE 响应头
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    // agentStream 已经是标准 SSE 格式的 Uint8Array 流，直接返回
    return sseStream
})
