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
import {
    createDraftService,
    applyAITitleIfAllowedService,
} from '~~/server/agents/document/documentDraft.service'
import { updateDocumentDraftDAO } from '~~/server/agents/document/documentDraft.dao'
import { createSnapshotService } from '~~/server/agents/document/documentDraftSnapshot.service'
import { getDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'
import { normalizeAIInitialFieldValues } from '~~/server/agents/document/aiFieldValueNormalize'

// LLM 偶尔会把数字 ID 当字符串回传（templateId / fileIds 可能从 prompt 上下文或工具返回值取），
// 用 z.coerce.number() 自动转换增强鲁棒性（与 reviewContract.tool / updateDocumentDraft.tool 对齐）。
const schema = z.object({
    templateId: z.coerce.number().int().positive().describe('模板 ID,从 recommend_template 工具的返回值取'),
    fieldValues: z.record(z.string(), z.string().nullable()).describe(
        '占位符名 → 值的映射;**不知道的字段必须传 null**(后端会过滤),'
        + '严禁回传"【待补充:xxx】"/"【未提供】"/"【暂无】"等占位字符串(会被自动转 null)。'
        + '至少一个字段非 null,否则视为没提取到任何信息、应继续向用户提问。',
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
    fileIds: z.array(z.coerce.number().int().positive()).optional().describe(
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

        // 0. 兜底过滤 LLM 输出的占位字符串(「【待补充:xxx】」「【未提供】」等):
        //    转 null 后再走后续流程,避免占位串被当成"已填"算进字段统计、避免渲染到文书正文
        const fieldValues = normalizeAIInitialFieldValues(input.fieldValues)

        // 校验:normalize 后至少一个非 null(占位符已转 null,真值才算)
        const hasAnyValue = Object.values(fieldValues).some(v => v !== null && v !== '')
        if (!hasAnyValue) {
            return {
                success: false,
                error: 'fieldValues 至少一个非 null:全部为 null 表示 AI 没有产出任何内容,不应创建草稿。'
                    + '若信息不足请向用户提问,等回答后再调本工具。',
            }
        }

        // 1. 创建 draft 记录（createDraftService 已处理 sourceFileIds 关联材料；enqueueAgentRun:false 表示工具自己写,不入 worker 队列）
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
        await updateDocumentDraftDAO(draftId, {
            values: fieldValues as any,
            metadata: input.suggestions ? { suggestions: input.suggestions } as any : undefined,
            status: 'ready',
        })

        // 3. 创建 'ai-extract' 快照
        try {
            await createSnapshotService(draftId, 'ai-extract', {
                values: fieldValues,
                aiTitle: input.aiTitle ?? null,
            })
        }
        catch (err) {
            logger.warn('save_document_draft: 写 ai-extract 快照失败(不阻塞)', { draftId, err })
        }

        // 4. 应用 AI 标题(若有 + titleOverridden=false)
        if (input.aiTitle) {
            try {
                await applyAITitleIfAllowedService(draftId, input.aiTitle)
            }
            catch (err) {
                logger.warn('save_document_draft: 应用 AI 标题失败(不阻塞)', { draftId, err })
            }
        }

        // 5. 取模板 placeholders 总数 + 名称（template 字段总数是模板维度，不能用 fieldValues.length——
        // LLM 漏传任意字段都会让分母塌缩，例如 17 个占位符 LLM 只填了 16 个，会算出"16/16"误导用户已全部填完）
        let templateName: string | null = null
        let templatePlaceholdersCount = 0
        try {
            const template = await getDocumentTemplateDAO(input.templateId)
            templateName = template?.name ?? null
            templatePlaceholdersCount = Array.isArray(template?.placeholders) ? template.placeholders.length : 0
        }
        catch { /* 拿不到模板不影响主流程,totalFields 走兜底 */ }

        // 6. 计算 summary——分母用模板 placeholders 总数（来自 DB），分子是本次 fieldValues 里非空的数量
        const filledFieldCount = Object.values(fieldValues).filter(v => typeof v === 'string' && v.trim()).length
        const totalFields = templatePlaceholdersCount || Object.keys(fieldValues).length
        const summary = filledFieldCount > 0
            ? `已自动填写 ${filledFieldCount}/${totalFields} 个字段`
            : '已建好空白草稿,等待用户补充信息'

        // 7. 跳转链接
        const fromParam = caseId ? 'xiaosuo' : 'assistant'
        const href = `/dashboard/document/drafts/${draftId}`
            + `?from=${fromParam}&sessionId=${encodeURIComponent(sessionId)}`
            + (caseId ? `&caseId=${caseId}` : '')

        const title = input.aiTitle ?? templateName ?? '未命名文书'

        // 8. await SSE event(agent-platform.md 铁律)
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

        // 9. 返回 JSON 给 LLM(title 字段对齐旧 draft_document 工具卡片渲染)
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
