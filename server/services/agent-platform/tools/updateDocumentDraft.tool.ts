/**
 * update_document_draft 工具
 *
 * Agent 增量更新已存在草稿的字段值。复用 patchDraftService(server/agents/document/
 * documentDraft.service.ts:158-196)的字段过滤+merge+落库逻辑,工具层只负责 SSE
 * 通知和 aiTitle 应用。
 *
 * @see docs/superpowers/specs/2026-05-05-document-agent-tool-refactor-design.md §4.3
 */

import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'
import { createSimpleTool } from './types'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import {
    patchDraftService,
    applyAITitleIfAllowedService,
} from '~~/server/agents/document/documentDraft.service'
import { cleanAIFieldUpdates } from '~~/server/agents/document/aiFieldValueNormalize'

const schema = z.object({
    // documentMain 在 system prompt 里把草稿 ID 渲染成"草稿 ID:90"文本注入，LLM 偶尔会原样
    // 把 "90" 字符串当 draftId 回传，用 coerce 自动转 number 增强鲁棒性（与 reviewContract.tool 对齐）。
    draftId: z.coerce.number().int().positive().describe('要更新的草稿 ID(从 save_document_draft 的返回值取)'),
    fieldUpdates: z.record(z.string(), z.string().nullable()).describe(
        '只传要改的字段(占位符名 → 新值);超出模板字段范围的会被忽略。'
        + '不知道答案的字段**不要传**(留空即可),严禁回传"【待补充:xxx】"/"【未提供】"等'
        + '占位字符串(会被自动丢弃,不会写库)。要清空字段请显式传 null。',
    ),
    suggestions: z.record(z.string(), z.string()).optional().describe(
        '追加/更新建议清单(写到 metadata.suggestions)',
    ),
    aiTitle: z.string().min(1).max(200).optional().describe(
        'AI 推断的新标题,若用户未手动改过则会自动应用',
    ),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'update_document_draft',
    description: '增量更新已有草稿的字段值。'
        + '用户在对话中提出修改请求(如"被告住址改成 XX")时调此工具,只需传要改的字段,'
        + '其余字段保持不变。会发 DRAFT_UPDATED SSE 通知前端刷新字段表单。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async (input, ctx) => {
        const { userId, sessionId, runId = '', caseId } = ctx
        if (!userId || !sessionId) {
            throw new Error('update_document_draft: ToolContext 缺少 userId/sessionId')
        }

        // 0. 兜底过滤 LLM 占位字符串("【待补充:xxx】"等):占位符直接丢弃,保持原值不变
        //    (与 save_document_draft 的 normalizeAIInitialFieldValues 区别:save 是首写,占位转 null;
        //     update 是增量改,占位丢弃以免误清空原值)
        const fieldUpdates = cleanAIFieldUpdates(input.fieldUpdates)

        // 1. 复用 patchDraftService(行 158-196)字段过滤+merge+落库
        const patchResult = await patchDraftService(userId, input.draftId, {
            values: fieldUpdates,
            metadata: input.suggestions ? { suggestions: input.suggestions } : undefined,
        })

        if ('error' in patchResult) {
            return { success: false, error: patchResult.error }
        }

        const updatedDraft = patchResult.draft

        // 2. 计算实际生效的字段(过滤掉模板范围外的 key + 占位符已被丢弃的 key)
        const newValues = (updatedDraft.values ?? {}) as Record<string, unknown>
        const changedFields = Object.keys(fieldUpdates).filter(k => k in newValues)
        const summary = `已更新 ${changedFields.length} 个字段:${changedFields.join('、')}`

        // 3. 应用 AI 标题(若有)
        if (input.aiTitle) {
            try {
                await applyAITitleIfAllowedService(input.draftId, input.aiTitle)
            }
            catch (err) {
                logger.warn('update_document_draft: 应用 AI 标题失败(不阻塞)', { draftId: input.draftId, err })
            }
        }

        // 4. await SSE event(agent-platform.md 铁律)
        try {
            await publishCustomEvent({
                type: 'custom_event',
                runId,
                sessionId,
                name: SSECustomEventType.DRAFT_UPDATED,
                data: { draftId: input.draftId, changedFields, summary },
            })
        }
        catch (err) {
            logger.warn('update_document_draft: publishCustomEvent(DRAFT_UPDATED) 失败(不阻塞)', {
                draftId: input.draftId, err,
            })
        }

        // 跳转链接（与 save_document_draft 保持一致：xiaosuo / assistant from 参数 + sessionId + 可选 caseId）
        const fromParam = caseId ? 'xiaosuo' : 'assistant'
        const href = `/dashboard/document/drafts/${input.draftId}`
            + `?from=${fromParam}&sessionId=${encodeURIComponent(sessionId)}`
            + (caseId ? `&caseId=${caseId}` : '')

        return {
            success: true,
            draftId: input.draftId,
            changedFields,
            summary,
            href,
        }
    },
    { errorLabel: '更新文书草稿' },
)
