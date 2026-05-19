import { createMiddleware } from "langchain"
import { ensureMaterialsReadyService } from "~~/server/services/material/materialPipeline.service"
import { createMaterialPrepareEmitter } from "~~/server/agents/_shared/material-prepare/materialPrepareProgress"

/**
 * 材料就绪保底中间件
 *
 * 等到所有材料"识别 + 摘要"双就绪才放行 Agent；等待期间通过
 * createMaterialPrepareEmitter 推 PREPARE_MATERIALS SSE 进度（与通用问答
 * 材料预处理中间件共用同一套进度推送辅助）。
 *
 * runId / sessionId 由挂载点显式透传（caseMain 的 ctx.runId、moduleAgent 的
 * 函数入参 runId）。runId 为 null/undefined 时不推送 SSE。
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
                const emitter = createMaterialPrepareEmitter(runId, sessionId)
                try {
                    const result = await ensureMaterialsReadyService(caseId, userId, emitter.onProgress)
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
                    await emitter.finalize()
                } catch (error) {
                    logger.error('材料预处理中间件异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}
