/**
 * 材料处理工具
 *
 * 检查材料状态、触发识别/嵌入、从各识别记录表获取实际内容、
 * 评估 token 量决定提供模式（全量/摘要）
 *
 * 两种上下文模式：
 * - caseId（小索/案件分析）：扫案件下全部材料。行为保持不变。
 * - draftId（文书生成）：扫 draft 下关联材料；可传 fileIds 仅处理本次新加的文件。
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from './types'
import {
    ensureMaterialsReadyService,
    ensureMaterialsReadyByDraftService,
    getMaterialContextService,
    estimateTokens,
    getSourceId,
    TOKEN_THRESHOLD,
} from '../../material/materialPipeline.service'

const schema = z.object({
    fileIds: z.array(z.number().int().positive()).optional().describe('可选：仅处理这些 OSS 文件 ID（不传则处理当前上下文下的全部材料）'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'process_materials',
    description: '检查并处理当前案件或文书草稿的材料。触发未完成的识别和嵌入，评估 token 量决定提供模式（全量/摘要）。在开始分析或回填字段前调用此工具；文书生成场景可传 fileIds 精确处理本轮新增文件。',
    schema,
}

export function createTool(context: ToolContext) {
    const { userId, caseId, draftId } = context

    return tool(
        async (input) => {
            const fileIds = input?.fileIds
            logger.info('执行材料处理工具', { userId, caseId, draftId, fileIds })

            try {
                if (caseId == null && draftId == null) {
                    throw new Error('process_materials 工具需要 caseId 或 draftId，当前上下文均缺失')
                }

                // 1. 按优先级选择批处理入口（draftId 优先，保持小索/案件路径原样）
                const ready = draftId != null
                    ? await ensureMaterialsReadyByDraftService(draftId, userId, { fileIds, caseId: caseId ?? null })
                    : await ensureMaterialsReadyService(caseId!, userId)
                const { materials, embeddedMap } = ready

                if (materials.length === 0) {
                    return JSON.stringify({
                        mode: 'empty',
                        message: draftId != null
                            ? '当前文书草稿还没有材料，请先在输入框里上传/选择文件。'
                            : '当前案件没有任何材料，请先上传案件材料。',
                        materials: [],
                    })
                }

                // 2. 获取材料上下文（自动判断 full/summary 模式）
                const materialContext = await getMaterialContextService(materials)

                // 3. 在 context.materialList 基础上补充 tool 特有字段
                const materialList = materialContext.materialList.map(m => {
                    // 反向映射 sourceId→materialId 以查找 embeddedMap
                    const material = materials.find(mat => getSourceId(mat) === m.sourceId)
                    return {
                        ...m,
                        id: material?.id,
                        tokenCount: m.content ? estimateTokens(m.content) : 0,
                        embedded: material ? (embeddedMap.get(material.id) ?? false) : false,
                    }
                })

                const result = {
                    mode: materialContext.mode,
                    totalTokens: materialContext.totalTokens,
                    threshold: TOKEN_THRESHOLD,
                    materialCount: materials.length,
                    materialsWithContent: materialList.filter(m => m.hasContent).length,
                    materials: materialList,
                    ...(materialContext.mode !== 'full'
                        ? {
                            hint: '材料量较大，已提供摘要。需要详细内容时请使用 search_case_materials 工具按需检索。',
                        }
                        : {}),
                }

                logger.info('材料处理完成', {
                    caseId,
                    draftId,
                    mode: result.mode,
                    totalTokens: materialContext.totalTokens,
                    materialCount: materials.length,
                    materialsWithContent: result.materialsWithContent,
                })

                return JSON.stringify(result)
            } catch (error) {
                logger.error('材料处理失败:', error)
                return JSON.stringify({
                    error: '材料处理失败',
                    message: error instanceof Error ? error.message : '未知错误',
                })
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema: toolDefinition.schema,
        }
    )
}
