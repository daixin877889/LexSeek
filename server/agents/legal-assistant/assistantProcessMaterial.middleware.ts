/**
 * 通用问答材料预处理中间件
 *
 * Agent 启动前（beforeAgent）确定性地解析最新用户消息里的 __ATTACHMENTS__ 附件清单，
 * 按 sessionId 建/复用 case_materials 记录并跑识别+嵌入流水线，期间通过
 * PREPARE_MATERIALS SSE 事件推「材料处理」进度卡片。
 *
 * 与案件域的 caseProcessMaterialMiddleware 同构，区别仅在归属维度（sessionId vs caseId）
 * 与材料来源（解析消息附件 vs 扫案件全量）。
 */
import { createMiddleware } from 'langchain'
import { ensureMaterialsReadyBySessionService } from '~~/server/services/material/materialPipeline.service'
import { createMaterialPrepareEmitter } from '~~/server/agents/_shared/material-prepare/materialPrepareProgress'
import { parseAttachmentFileIds } from '#shared/utils/attachmentSentinel'

/**
 * 从 messages 数组取最后一条 human 消息的纯字符串 content。
 *
 * 类型判定：LangChain 消息实例用 `getType()`（当前公开方法）；`_getType()` 是
 * 旧版兜底。不再判 `m.type`——真实 BaseMessage 实例上 `type` 是泛型参数而非运行时
 * 字段，恒为 undefined（属 dead 分支）。
 */
function lastHumanContent(messages: unknown): string {
    if (!Array.isArray(messages)) return ''
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as { getType?: () => string; _getType?: () => string; content?: unknown } | undefined
        if (!m) continue
        const type = typeof m.getType === 'function'
            ? m.getType()
            : typeof m._getType === 'function'
                ? m._getType()
                : ''
        if (type === 'human') {
            return typeof m.content === 'string' ? m.content : ''
        }
    }
    return ''
}

export const assistantProcessMaterialMiddleware = (
    userId: number,
    sessionId: string,
    runId: string | null = null,
) => {
    return createMiddleware({
        name: 'AssistantProcessMaterialMiddleware',
        beforeAgent: {
            hook: async (state: { messages?: unknown }) => {
                const fileIds = parseAttachmentFileIds(lastHumanContent(state.messages))
                if (fileIds.length === 0) return  // 本轮无新附件，零开销返回

                const emitter = createMaterialPrepareEmitter(runId, sessionId)
                try {
                    const result = await ensureMaterialsReadyBySessionService(
                        sessionId,
                        userId,
                        { fileIds },
                        emitter.onProgress,
                    )
                    logger.info('通用问答材料预处理完成', {
                        sessionId,
                        totalMaterials: result.totalMaterials,
                        newlyProcessed: result.newlyProcessed,
                        failedCount: result.failed.length,
                    })
                    if (result.failed.length > 0) {
                        logger.warn('通用问答部分材料处理失败', { sessionId, failed: result.failed })
                    }
                    await emitter.finalize()
                } catch (error) {
                    logger.error('通用问答材料预处理中间件异常，继续启动 Agent', { sessionId, error })
                }
            },
        },
    })
}
