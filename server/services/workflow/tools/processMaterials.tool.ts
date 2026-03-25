/**
 * 材料处理工具
 *
 * 检查材料状态、触发识别/嵌入、从各识别记录表获取实际内容、
 * 评估 token 量决定提供模式（全量/摘要）
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from './types'
import {
    ensureMaterialsReadyService,
    getMaterialContextService,
    estimateTokens,
    getSourceId,
    TOKEN_THRESHOLD,
} from '../../material/materialPipeline.service'

const schema = z.object({})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'process_materials',
    description: '检查并处理当前案件的所有材料。检查材料识别和嵌入状态，触发未完成的处理，评估 token 量决定提供模式（全量/摘要）。在开始分析前调用此工具。',
    schema,
}

export function createTool(context: ToolContext) {
    const { userId, caseId } = context

    return tool(
        async () => {
            logger.info('执行材料处理工具', { userId, caseId })

            try {
                // 1. 通过 pipeline 确保材料已识别+嵌入
                const { materials, embeddedMap } = await ensureMaterialsReadyService(caseId, userId)
                if (materials.length === 0) {
                    return JSON.stringify({
                        mode: 'empty',
                        message: '当前案件没有任何材料，请先上传案件材料。',
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
