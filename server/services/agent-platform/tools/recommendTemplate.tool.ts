/**
 * recommend_template 工具
 *
 * 模板推荐 + interrupt 让用户选择模板。Agent 调此工具后:
 * 1. 工具内部调 recommendDocumentTemplatesService 拿候选
 * 2. interrupt({ type: 'template_select', toolCallId, ... }) 弹卡片
 * 3. 用户在 TemplateSelectCard 选完后,通过 stream.submit 提交 resume value
 * 4. 工具拿到 templateId 后查模板的 placeholders 列表回给 Agent
 * 5. Agent 看到 placeholders 字段清单后用 skill + 对话上下文产出 fieldValues
 *
 * 解包逻辑参考 draftDocument.tool.ts:99-112(spike C3 已验证可复用)。
 *
 * @see docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md §4.1
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { interrupt, isGraphBubbleUp } from '@langchain/langgraph'
import type { ToolContext, ToolDefinition } from './types'
import { DOCUMENT_CATEGORY_KEYS, type DocumentCategoryKey } from '#shared/types/document'
import { recommendDocumentTemplatesService } from '~~/server/agents/document/templateRecommend.service'
import { getDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'

interface TemplateSelectResumeValue {
    templateId: number
    sourceText?: string
}

/**
 * 解开 LangGraph interrupt resume 的双层包装：
 *   { resume: { [toolCallId]: realValue } } → realValue
 * 与 draftDocument.tool.ts / reviewContract.tool.ts 同款机制。
 */
function unpackInterruptResume(resumed: unknown, toolCallId: string): TemplateSelectResumeValue | null {
    if (!resumed || typeof resumed !== 'object') return null
    const layer1 = (resumed as { resume?: unknown }).resume ?? resumed
    if (layer1 && typeof layer1 === 'object' && toolCallId in (layer1 as Record<string, unknown>)) {
        return (layer1 as Record<string, unknown>)[toolCallId] as TemplateSelectResumeValue | null
    }
    return layer1 as TemplateSelectResumeValue | null
}

const schema = z.object({
    intent: z.string().min(1).describe('用户起草意图的简短自然语言描述,例如:"起诉某某拖欠工资"'),
    keywords: z.array(z.string()).optional().describe(
        '从用户表达中抽取的关键词,用于模板召回(1-5 个)。'
        + '**优先抽完整文书名**(带"状/书/函/通知/协议"等后缀)——'
        + '用户说"起草起诉状"应给 ["起诉状"] 而非 ["起诉"];'
        + '"写一份答辩状"应给 ["答辩状"] 而非 ["答辩"]。',
    ),
    category: z.enum(DOCUMENT_CATEGORY_KEYS as unknown as [DocumentCategoryKey, ...DocumentCategoryKey[]])
        .optional()
        .describe('猜测的模板类别(可选);填写后第一层在该分类内召回'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'recommend_template',
    description: '推荐法律文书模板并通过卡片让用户选择。'
        + '调用后会自动弹出"模板选择卡片",用户选完模板后返回 templateId 和该模板的字段清单(placeholders)。'
        + '当用户表达起草意图(如"帮我写起诉状")时第一步调此工具,'
        + '拿到字段清单后再用 save_document_draft 工具落库。',
    schema,
}

export function createTool(context: ToolContext) {
    return tool(
        async (input: z.infer<typeof schema>, cfg): Promise<string> => {
            // 顶层 try/catch:对齐 createSimpleTool 工厂的统一异常处理风格
            // (本工具因要带 cfg 参数读 toolCall.id,无法用 createSimpleTool 工厂,
            // 手动加顶层异常兜底,保证工具返回值始终是有效 JSON 字符串)
            try {
                const toolCallId = (cfg as any)?.toolCall?.id ?? ''
                const { sessionId, userId } = context
                if (!sessionId || !userId) {
                    throw new Error('recommend_template: ToolContext 缺少 sessionId/userId')
                }

                // 1. 模板推荐
                const reco = await recommendDocumentTemplatesService({
                    userId,
                    intent: input.intent,
                    keywords: input.keywords,
                    categoryHint: input.category,
                })

                // 2. interrupt 弹卡片(沿用 TemplateSelectCard 既有 payload 形态)
                const resumed = interrupt({
                    type: 'template_select',
                    toolCallId,
                    intent: input.intent,
                    keywords: reco.usedKeywords,
                    recommendations: reco.items,
                    total: reco.total,
                    fallbackToRecency: reco.fallbackToRecency,
                }) as unknown

                // 3. 双层包装解包(同 draftDocument.tool.ts / reviewContract.tool.ts)
                const unpacked = unpackInterruptResume(resumed, toolCallId)

                // 4. 用户取消(resume 为 null 或缺 templateId):返回 cancelled
                if (!unpacked || typeof unpacked.templateId !== 'number') {
                    return JSON.stringify({
                        success: false,
                        cancelled: true,
                        message: '用户已取消模板选择',
                    })
                }

                // 5. 拉模板的 placeholders 列表回给 LLM
                const template = await getDocumentTemplateDAO(unpacked.templateId)
                if (!template) {
                    return JSON.stringify({
                        success: false,
                        error: `模板 #${unpacked.templateId} 不存在或已删除`,
                    })
                }

                return JSON.stringify({
                    success: true,
                    templateId: unpacked.templateId,
                    templateName: template.name,
                    templateCategory: template.category ?? null,
                    placeholders: template.placeholders, // [{ name, firstContext }, ...]
                    sourceText: unpacked.sourceText ?? null, // 用户在卡片里补充的额外说明
                })
            }
            catch (err) {
                // 关键:LangGraph 的 interrupt() 通过抛 GraphInterrupt 暂停 graph 执行;
                // ParentCommand / 其他 bubble-up 错误必须重抛让调度器接住。
                // 用 LangGraph 官方导出的 isGraphBubbleUp 覆盖 GraphInterrupt / NodeInterrupt
                // / ParentCommand 全部子类。
                if (isGraphBubbleUp(err)) {
                    throw err
                }
                logger.error('recommend_template 执行失败', { err, input, sessionId: context.sessionId })
                return JSON.stringify({
                    success: false,
                    error: err instanceof Error ? err.message : '推荐模板失败',
                })
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
