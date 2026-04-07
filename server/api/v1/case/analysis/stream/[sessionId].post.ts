/**
 * SSE 流式分析
 *
 * POST /api/v1/case/analysis/stream/[sessionId]
 *
 * 启动案件分析工作流，通过 SSE 实时返回 AI 分析过程和结果
 * 使用 LangGraph encoding: "text/event-stream" 产出标准 SSE 格式流
 *
 * Requirements: 1.3, 9.1, 9.3, 12.3, 12.4
 */

import { findCaseBySessionIdService } from '~~/server/services/case/caseSession.service'
import { runCaseChat } from '~~/server/services/workflow/agents'
import { getMaterialsByCaseIdService } from '~~/server/services/material/material.service'
import { batchCheckMaterialEmbeddedService } from '~~/server/services/material/materialEmbedding.service'
import { ensureMaterialsEmbeddedService } from '~~/server/services/material/materialProcess.service'

export default defineEventHandler(async (event) => {

    // 验证用户登录
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取路由参数
    const sessionId = getRouterParam(event, 'sessionId')
    if (!sessionId) {
        return resError(event, 400, 'sessionId 不能为空')
    }

    // 先验证（非 SSE 阶段），确保走到这里才设置 SSE 头
    const caseInfo = await findCaseBySessionIdService(sessionId)
    if (!caseInfo) {
        return resError(event, 404, '案件不存在')
    }
    if (user.id !== caseInfo.userId) {
        return resError(event, 403, '您没有权限访问该案件')
    }

    // 并发执行：读取请求体 & 获取案件材料（两者独立）
    const [body, materials] = await Promise.all([
        readBody(event),
        getMaterialsByCaseIdService(caseInfo.id),
    ])
    const thinking = body?.thinking ?? true

    // 使用统一嵌入状态查询替代 embeddingStatus 字段判断
    const embeddedMap = await batchCheckMaterialEmbeddedService(materials.map(m => m.id))
    const noEmbeddedMaterials = materials.filter(m => !embeddedMap.get(m.id))
    if (noEmbeddedMaterials.length > 0) {
        await ensureMaterialsEmbeddedService(noEmbeddedMaterials, user.id)
    }

    // 从 FetchStreamTransport 的 input.messages 中提取用户消息
    // 如果没有 input（兼容旧调用方式），使用案件 content 作为 prompt
    const inputMessages = body?.input?.messages
    const firstUserMessage = Array.isArray(inputMessages) && inputMessages.length > 0
        ? inputMessages[inputMessages.length - 1]?.content
        : null
    const prompt = firstUserMessage || caseInfo.content || '开始分析'

    // 调用 mainAgent 获取 SSE 格式的流（encoding: "text/event-stream"）
    const agentStream = await runCaseChat(sessionId, prompt, {
        thinking,
        userId: user.id,
        caseId: caseInfo.id,
    })

    // 设置 SSE 响应头
    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    })

    // agentStream 已经是标准 SSE 格式的 Uint8Array 流，直接返回
    return agentStream
})
