import { createMiddleware } from "langchain"
import { ensureMaterialsReadyService } from "~~/server/services/material/materialPipeline.service"
import type { MaterialReadinessSnapshot } from "~~/server/services/material/materialPipeline.service"
import { createCustomEventEmitter } from "~~/server/services/agent-platform/sse/customEventEmitter"
import { SSECustomEventType } from "#shared/types/agentEvent"
import type { PrepareMaterialItem, PrepareMaterialsPayload } from "#shared/types/agentEvent"

/**
 * 材料就绪保底中间件
 *
 * 升级版（spec §4.5）：等到所有材料"识别 + 200 字摘要"双就绪才放行 Agent。
 * 等待期间通过 SSE PREPARE_MATERIALS 事件推送进度，前端 useStreamChat
 * 拦截后合成 process_materials 同款 toolCall，复用 MaterialProcessTool.vue 渲染。
 *
 * runId / sessionId 由挂载点显式透传（caseMain 的 ctx.runId、moduleAgent 的
 * 函数入参 runId）。runId 为 null/undefined 时不推送 SSE，行为与升级前一致。
 */
export const caseProcessMaterialMiddleware = (
    userId: number,
    caseId: number,
    runId: string | null = null,
    sessionId: string = '',
) => {
    return createMiddleware({
        name: "CaseProcessMaterialMiddleware",
        beforeAgent: {
            hook: async (_state) => {
                let toolCallId: string | null = null
                let started = false
                let lastSnapshot: MaterialReadinessSnapshot[] = []
                const emit = runId
                    ? createCustomEventEmitter({ runId, sessionId })
                    : null

                const onProgress = async (snapshot: MaterialReadinessSnapshot[]) => {
                    lastSnapshot = snapshot  // 累积，end 阶段直接用
                    if (!emit) return  // 无 runId 不推送（兼容旧调用方）
                    const items: PrepareMaterialItem[] = snapshot.map(s => ({
                        id: s.materialId,
                        name: s.name,
                        status: s.status,
                    }))
                    if (!started) {
                        started = true
                        toolCallId = `prepare-${runId}`
                        const payload: PrepareMaterialsPayload = { phase: 'start', toolCallId, materials: items }
                        await emit({ name: SSECustomEventType.PREPARE_MATERIALS, data: payload })
                    } else {
                        const payload: PrepareMaterialsPayload = { phase: 'progress', toolCallId: toolCallId!, materials: items }
                        await emit({ name: SSECustomEventType.PREPARE_MATERIALS, data: payload })
                    }
                }

                try {
                    const result = await ensureMaterialsReadyService(caseId, userId, onProgress)
                    logger.info('材料预处理完成', {
                        caseId,
                        totalMaterials: result.totalMaterials,
                        alreadyEmbedded: result.alreadyEmbedded,
                        newlyProcessed: result.newlyProcessed,
                        failedCount: result.failed.length,
                    })
                    if (result.failed.length > 0) {
                        logger.warn('部分材料处理失败', { failed: result.failed })
                    }

                    // 发 phase=end（若曾发过 start）
                    if (started && toolCallId && emit) {
                        const items: PrepareMaterialItem[] = lastSnapshot.map(s => ({
                            id: s.materialId,
                            name: s.name,
                            status: s.status,
                        }))
                        const failedCount = lastSnapshot.filter(s => s.status === 'failed').length
                        const payload: PrepareMaterialsPayload = {
                            phase: 'end',
                            toolCallId,
                            materials: items,
                            failedCount,
                        }
                        await emit({ name: SSECustomEventType.PREPARE_MATERIALS, data: payload })
                    }
                } catch (error) {
                    logger.error('材料预处理中间件异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}
