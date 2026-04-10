import { createMiddleware, HumanMessage } from "langchain";
import { z } from "zod"
import { getMaterialsByCaseIdService } from "../../material/material.service"
import { getSourceId } from "../../material/materialPipeline.service"
import { getMaterialContextService, buildMaterialContextMessage, buildIncrementalMaterialMessage } from "../../material/materialPipeline.service"


/** 材料上下文注入中间件（支持首次全量/增量注入） */
export const caseMaterialContextMiddleware = (userId: number, caseId: number) => {
  return createMiddleware({
    name: "CaseMaterialContextMiddleware",
    stateSchema: z.object({
      _injectedSourceIds: z.array(z.number()).default([]),
    }),
    beforeAgent: {
      hook: async (state) => {
        try {
          // 1. 获取当前材料
          const materials = await getMaterialsByCaseIdService(caseId)
          if (materials.length === 0) return

          // 2. 从 state 读取已注入的 sourceId 列表（自动从 checkpoint 恢复）
          const prevSourceIds: number[] = state._injectedSourceIds ?? []
          const currentSourceIds = materials.map(m => getSourceId(m))

          // 3. 判断是首次注入还是增量（使用 Set 优化大数据量下的去重性能）
          const isFirstInjection = prevSourceIds.length === 0
          const prevSourceIdSet = new Set(prevSourceIds)
          const newSourceIds = currentSourceIds.filter(id => !prevSourceIdSet.has(id))

          // 无变化则跳过
          if (!isFirstInjection && newSourceIds.length === 0) return

          // 4. 获取材料上下文
          if (isFirstInjection) {
            // 首次：按 token 阈值判断 full/summary
            const context = await getMaterialContextService(materials)
            if (context.mode === 'empty') return

            const messageText = buildMaterialContextMessage(context)

            // 在 SystemMessage 之后插入
            const systemIdx = state.messages.findIndex(
              (m: any) => m._getType() === 'system'
            )
            const insertIdx = systemIdx >= 0 ? systemIdx + 1 : 0
            state.messages.splice(insertIdx, 0, new HumanMessage({
              content: messageText,
              response_metadata: {
                injectedBy: 'CaseMaterialContextMiddleware',
                injectedAt: new Date().toISOString(),
              },
            }))

            logger.info('材料上下文已注入（首次）', {
              caseId,
              mode: context.mode,
              materialCount: currentSourceIds.length,
              totalTokens: context.totalTokens,
            })
          } else {
            // 增量：固定 summary 模式
            const newSourceIdSet = new Set(newSourceIds)
            const newMaterials = materials.filter(m => newSourceIdSet.has(getSourceId(m)))
            const context = await getMaterialContextService(newMaterials)
            if (context.mode === 'empty') return

            const messageText = buildIncrementalMaterialMessage(context)

            // 在用户最新消息前插入（倒数第二位）
            const insertIdx = Math.max(0, state.messages.length - 1)
            state.messages.splice(insertIdx, 0, new HumanMessage({
              content: messageText,
              response_metadata: {
                injectedBy: 'CaseMaterialContextMiddleware',
                injectedAt: new Date().toISOString(),
              },
            }))

            logger.info('材料上下文已注入（增量）', {
              caseId,
              newMaterialCount: newSourceIds.length,
            })
          }

          // 5. 返回更新后的 state（自动持久化到 checkpoint）
          return { _injectedSourceIds: currentSourceIds }
        } catch (error) {
          logger.error('材料上下文注入异常，继续启动 Agent', { caseId, error })
        }
      }
    }
  })
}
