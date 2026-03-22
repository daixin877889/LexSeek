/**
 * 案件信息提取工具
 *
 * 从材料中提取案件基础信息，结果需用户确认
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from './types'

const schema = z.object({
    materials: z.string().describe('案件材料内容文本，用于提取基础信息'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'extract_case_info',
    description: '从案件材料中提取基础信息（案件名称、原告、被告、案件类型、案号等）。提取结果需经用户确认后才能用于后续分析。返回结构化的案件基础信息 JSON。',
    schema,
}

export function createTool(context: ToolContext) {
    const { caseId } = context

    return tool(
        async (input) => {
            const { materials } = input

            logger.info('执行案件信息提取', { caseId })

            try {
                const extractionGuide = {
                    instruction: '请根据以下材料提取案件基础信息',
                    materialPreview: materials.substring(0, 2000),
                    requiredFields: {
                        title: '案件名称（如：张三与李四买卖合同纠纷）',
                        plaintiff: '原告（数组，可能多个）',
                        defendant: '被告（数组，可能多个）',
                        caseType: '案件类型（民事/刑事/行政）',
                        summary: '案件简要概述（100字以内）',
                    },
                    optionalFields: {
                        caseNumber: '案号',
                        court: '受理法院',
                        causeOfAction: '案由',
                        amount: '涉案金额',
                        caseDate: '案件发生日期',
                        caseLocation: '案件发生地点',
                    },
                    caseId,
                }

                return JSON.stringify(extractionGuide)
            } catch (error) {
                logger.error('案件信息提取失败:', error)
                return JSON.stringify({
                    error: '信息提取失败',
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
