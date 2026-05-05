/**
 * save_document_draft 工具
 *
 * 三个 Agent(caseMain / assistantMain / documentMain)调此工具创建并落库文书草稿。
 * 工具接收已在 Agent 端用 skill + 对话上下文产出的字段值,写到 DB,返回 draftId/href。
 *
 * 不嵌套调用任何 Agent;不依赖 toolStrategy / draftResultPersistence 中间件。
 *
 * @see docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md §4.2
 */

import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'
import { createSimpleTool } from './types'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

const schema = z.object({
    templateId: z.number().int().positive().describe('模板 ID,从 recommend_template 工具的返回值取'),
    fieldValues: z.record(z.string(), z.string().nullable()).describe(
        '占位符名 → 值的映射;不知道的字段填 null,不要编造。至少一个字段非 null。',
    ),
    suggestions: z.record(z.string(), z.string()).optional().describe(
        '建议用户补充的内容(占位符名 → 一句问句),会写入 metadata.suggestions',
    ),
    aiTitle: z.string().min(1).max(200).optional().describe(
        'AI 推断的草稿标题,若用户未手动改过标题则会自动应用',
    ),
    sourceText: z.string().optional().describe(
        '用户原始诉求文字,会写到 draft.sourceRef.text 留档(后续 documentMain 重启会话时可读为初始上下文)',
    ),
    fileIds: z.array(z.number().int().positive()).optional().describe(
        '关联的 OSS 材料文件 ID 列表(若用户上传过材料)',
    ),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'save_document_draft',
    description: '创建文书草稿并写入字段值。需先调 recommend_template 拿 templateId 和字段清单。'
        + '工具会原子化创建 draft + 落库字段 + 写快照 + 关联材料 + 发 SSE 通知,返回 draftId/href 给主 Agent 引导用户跳转。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async (input, ctx) => {
        const { userId, sessionId, runId = '', caseId } = ctx
        if (!userId || !sessionId) {
            throw new Error('save_document_draft: ToolContext 缺少 userId/sessionId')
        }

        // 校验:fieldValues 至少一个非 null
        const hasAnyValue = Object.values(input.fieldValues).some(v => v !== null && v !== '')
        if (!hasAnyValue) {
            return {
                success: false,
                error: 'fieldValues 至少一个非 null:全部为 null 表示 AI 没有产出任何内容,不应创建草稿。'
                    + '若信息不足请向用户提问,等回答后再调本工具。',
            }
        }

        // 1. 创建 draft 记录(enqueueAgentRun: false 表示工具自己写,不入 worker 队列)
        const { createDraftService } = await import('~~/server/agents/document/documentDraft.service')
        const created = await createDraftService({
            userId,
            templateId: input.templateId,
            sourceText: input.sourceText,
            sourceFileIds: input.fileIds,
            caseId: caseId ?? undefined,
            enqueueAgentRun: false,
        })
        if ('error' in created) {
            return { success: false, error: created.error }
        }
        const { draftId, sessionId: subSessionId } = created

        // 2. 立刻写 values + status='ready'(同步事务式)
        const { updateDocumentDraftDAO } = await import('~~/server/agents/document/documentDraft.dao')
        await updateDocumentDraftDAO(draftId, {
            values: input.fieldValues as any,
            metadata: input.suggestions ? { suggestions: input.suggestions } as any : undefined,
            status: 'ready',
        })

        // 3. 创建 'ai-extract' 快照
        try {
            const { createSnapshotService } = await import('~~/server/agents/document/documentDraftSnapshot.service')
            await createSnapshotService(draftId, 'ai-extract', {
                values: input.fieldValues,
                aiTitle: input.aiTitle ?? null,
            })
        }
        catch (err) {
            logger.warn('save_document_draft: 写 ai-extract 快照失败(不阻塞)', { draftId, err })
        }

        // 4. 关联材料(若有 fileIds)
        // 注意:createDraftService 已经处理了 sourceFileIds,这里无需重复

        // 5. 应用 AI 标题(若有 + titleOverridden=false)
        if (input.aiTitle) {
            try {
                const { applyAITitleIfAllowedService } = await import('~~/server/agents/document/documentDraft.service')
                await applyAITitleIfAllowedService(draftId, input.aiTitle)
            }
            catch (err) {
                logger.warn('save_document_draft: 应用 AI 标题失败(不阻塞)', { draftId, err })
            }
        }

        // 6. 计算 summary
        const filledFieldCount = Object.values(input.fieldValues).filter(v => typeof v === 'string' && v.trim()).length
        const totalFields = Object.keys(input.fieldValues).length
        const summary = filledFieldCount > 0
            ? `已自动填写 ${filledFieldCount}/${totalFields} 个字段`
            : '已建好空白草稿,等待用户补充信息'

        // 7. 跳转链接
        const fromParam = caseId ? 'xiaosuo' : 'assistant'
        const href = `/dashboard/document/drafts/${draftId}`
            + `?from=${fromParam}&sessionId=${encodeURIComponent(sessionId)}`
            + (caseId ? `&caseId=${caseId}` : '')

        // 8. 取模板名称用于 summary
        let templateName: string | null = null
        try {
            const { getDocumentTemplateDAO } = await import('~~/server/agents/document/documentTemplate.dao')
            const template = await getDocumentTemplateDAO(input.templateId)
            templateName = template?.name ?? null
        }
        catch { /* 拿不到名字不影响主流程 */ }

        const title = input.aiTitle ?? templateName ?? '未命名文书'

        // 9. await SSE event(agent-platform.md 铁律)
        try {
            await publishCustomEvent({
                type: 'custom_event',
                runId,
                sessionId,
                name: SSECustomEventType.DRAFT_SAVED,
                data: { draftId, summary, title, href },
            })
        }
        catch (err) {
            logger.warn('save_document_draft: publishCustomEvent(DRAFT_SAVED) 失败(不阻塞)', { draftId, err })
        }

        // 10. 返回 JSON 给 LLM(title 字段对齐旧 draft_document 工具卡片渲染)
        return {
            success: true,
            draftId,
            sessionId: subSessionId,
            href,
            title,           // 卡片显示 "已完成起草《{title}》" — 优先 aiTitle 否则 templateName
            templateName,    // 保留供 LLM 引用
            filledFieldCount,
            totalFields,
            summary,
        }
    },
    { errorLabel: '保存文书草稿' },
)
