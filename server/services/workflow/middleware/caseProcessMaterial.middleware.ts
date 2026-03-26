import { createMiddleware } from "langchain"
import { ensureMaterialsReadyService } from "../../material/materialPipeline.service"

/** 材料预处理中间件 */
export const caseProcessMaterialMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: "CaseProcessMaterialMiddleware",
        beforeAgent: {
            hook: async (_state) => {
                try {
                    const result = await ensureMaterialsReadyService(caseId, userId)
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
                } catch (error) {
                    logger.error('材料预处理中间件异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}
