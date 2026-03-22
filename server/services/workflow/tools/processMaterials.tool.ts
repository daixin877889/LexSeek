/**
 * 材料处理工具
 *
 * 检查材料状态、触发识别/嵌入、决定提供模式（全量/摘要）
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from './types'
import { getMaterialsByCaseIdService } from '../../material/material.service'
import { batchCheckMaterialEmbeddedService } from '../../material/materialEmbedding.service'
import { ensureMaterialsEmbeddedService } from '../../material/materialProcess.service'

const TOKEN_THRESHOLD = 32000

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
                const materials = await getMaterialsByCaseIdService(caseId)
                if (materials.length === 0) {
                    return JSON.stringify({
                        mode: 'empty',
                        message: '当前案件没有任何材料，请先上传案件材料。',
                        materials: [],
                    })
                }

                const embeddedMap = await batchCheckMaterialEmbeddedService(
                    materials.map(m => m.id)
                )
                const notEmbedded = materials.filter(m => !embeddedMap.get(m.id))

                if (notEmbedded.length > 0) {
                    await ensureMaterialsEmbeddedService(notEmbedded, userId)
                }

                const totalTokens = materials.reduce(
                    (sum, m) => sum + (m.tokenCount || 0), 0
                )

                const isFullMode = totalTokens < TOKEN_THRESHOLD

                const materialList = materials.map(m => ({
                    id: m.id,
                    name: m.name,
                    type: m.type,
                    tokenCount: m.tokenCount || 0,
                    embedded: embeddedMap.get(m.id) ?? false,
                    ...(isFullMode
                        ? { content: m.content }
                        : { summary: m.summary || `[材料: ${m.name}，类型: ${m.type}]` }),
                }))

                const result = {
                    mode: isFullMode ? 'full' : 'summary',
                    totalTokens,
                    threshold: TOKEN_THRESHOLD,
                    materialCount: materials.length,
                    processedCount: materials.length - notEmbedded.length,
                    newlyProcessed: notEmbedded.length,
                    materials: materialList,
                    ...(isFullMode
                        ? {}
                        : {
                            hint: '材料量较大，已提供摘要。需要详细内容时请使用 search_case_materials 工具按需检索。',
                        }),
                }

                logger.info('材料处理完成', {
                    caseId,
                    mode: result.mode,
                    totalTokens,
                    materialCount: materials.length,
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
