/**
 * draft_document 子代理工具（阶段 5）
 *
 * 法律助手主 Agent 用此工具调起「文书生成助手」起草一份文书。流程：
 * 1. 用 LLM 给的 intent / keywords / categoryHint 调 templateRecommend 拿候选 + total
 * 2. 原生 `interrupt({ type: 'template_select', toolCallId, ... })` 暂停主 Agent
 *    —— LangGraph 把 interrupt 自然透出到主 agent streamValues `__interrupt__`，
 *    前端 `useStreamChat.interruptData` 现成消费；前端按 type 派发到 TemplateSelectCard。
 * 3. 用户在卡片上选定 templateId 后，前端调 `stream.submit({ command: { resume: data } })`，
 *    LangGraph 把 resume value 直接还给本工具的 `interrupt()` 返回值（无任何外包）。
 * 4. createDraftService 落库（caseId 来自主 ToolContext，可空）
 * 5. 直接调 runDocumentChat 同步执行文书 Agent，runAndDrainStream 消费整个流
 *    （draftResultPersistence 中间件把最终 values + AI 标题写回 DB）
 * 6. publishCustomEvent DRAFT_SAVED 通知前端工具卡片
 * 7. 返回主 Agent 一个 JSON 字符串，含 draftId / title / summary / href
 *
 * 取消（resume value === null / 缺 templateId）：返回 `{ success:false, cancelled:true }`，
 * 不抛错（让 LLM 知道用户主动放弃，可继续对话而不是把工具标 failed）。
 *
 * @see docs/superpowers/plans/2026-04-27-ai-unify-stage-5-assistant-tools.md §Task 3
 */

import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'
import { DOCUMENT_CATEGORY_KEYS, type DocumentCategoryKey } from '#shared/types/document'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import { runAndDrainStream } from '~~/server/services/agent-platform/subAgent/runAndDrain'
import { buildSubAgentCallbacks } from '~~/server/services/agent-platform/subAgent/buildSubAgentCallbacks'
import { publishSubAgentStatus } from '~~/server/services/agent-platform/subAgent/publishSubAgentStatus'

const schema = z.object({
    intent: z.string().min(1).describe('用户起草意图的简短自然语言描述，例如："起诉某某拖欠工资"'),
    keywords: z.array(z.string()).optional().describe(
        '从用户表达中抽取的关键词，用于模板召回（1-5 个）。'
        + '**优先抽完整文书名**（带"状/书/函/通知/协议"等后缀）——'
        + '用户说"起草起诉状"应给 ["起诉状"] 而非 ["起诉"]，'
        + '"写一份答辩状"应给 ["答辩状"] 而非 ["答辩"]，'
        + '"上诉状"给 ["上诉状"] 而非 ["上诉"]。完整文书名可避免起诉状/答辩状这类反向文书的子串歧义。'
        + '其次可补充功能/场景词（如 ["劳动合同", "解除"]）。',
    ),
    category: z.enum(DOCUMENT_CATEGORY_KEYS as unknown as [DocumentCategoryKey, ...DocumentCategoryKey[]])
        .optional()
        .describe('猜测的模板类别（可选）；填写后第一层在该分类内召回，召回不足会自动跨类兜底'),
    additionalContext: z.string().optional().describe('其他上下文信息，会写入 draft.sourceRef.text 用于 AI 起草时参考'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'draft_document',
    description:
        '调起文书生成助手起草一份法律文书。会先弹出"模板选择卡片"让用户确认模板，'
        + '随后自动起草并保存草稿；返回 draftId 与跳转链接，主 Agent 可在回复中直接附上跳转入口。'
        + ' 当用户表达了"起草/起诉状/答辩状/帮我写一份..." 等意图时调用。',
    schema,
}

/** Resume 后用户在前端 TemplateSelectCard 提交的 value 形态 */
interface TemplateSelectResumeValue {
    templateId: number
    /** 用户额外补充的起草说明（可选；优先级高于 LLM 给的 additionalContext） */
    sourceText?: string
}

export function createTool(context: ToolContext) {
    return tool(
        async (input: z.infer<typeof schema>, cfg): Promise<string> => {
            const toolCallId = (cfg as any)?.toolCall?.id ?? ''
            const { runId = '', sessionId, userId, caseId } = context
            if (!sessionId || !userId) {
                throw new Error('draft_document: ToolContext 缺少 sessionId/userId')
            }

            // 1. 模板推荐
            const { recommendDocumentTemplatesService } = await import(
                '~~/server/agents/document/templateRecommend.service'
            )
            const reco = await recommendDocumentTemplatesService({
                userId,
                intent: input.intent,
                keywords: input.keywords,
                categoryHint: input.category,
            })

            // 2. 发起 interrupt（LangGraph 自然透出到主 agent streamValues.__interrupt__）
            //    payload 形态约定：{ type, toolCallId, ...payload }，type 顶层
            //    前端按 type 派发到 TemplateSelectCard 渲染
            const resumed = interrupt({
                type: 'template_select',
                toolCallId,
                intent: input.intent,
                keywords: reco.usedKeywords,
                recommendations: reco.items,
                total: reco.total,
                fallbackToRecency: reco.fallbackToRecency,
            }) as unknown

            // LangGraph createAgent + 子工具 interrupt 的特殊性：interrupt() 不会自动解掉
            // 两层包装（外层 command.resume + 内层 toolCallId 路由）。我们手动解：
            //   raw = { resume: { [toolCallId]: realValue } } → realValue
            // 这套约定让多个 pending tool 的 resume 互不串扰。前端在 AssistantChatPanel
            // 的 resolveInterrupt 里负责按 toolCallId 包装。
            const unpacked = ((): TemplateSelectResumeValue | null => {
                if (!resumed || typeof resumed !== 'object') return null
                const layer1 = (resumed as { resume?: unknown }).resume ?? resumed
                if (layer1 && typeof layer1 === 'object' && toolCallId in (layer1 as Record<string, unknown>)) {
                    return (layer1 as Record<string, unknown>)[toolCallId] as TemplateSelectResumeValue | null
                }
                // 无 toolCallId 路由时（如老 interrupt 流），直接当裸 value
                return layer1 as TemplateSelectResumeValue | null
            })()

            // 用户取消（前端 onResolve(null) 把 resume value 写为 null）：返回 cancel 状态
            // 主 Agent 看到 cancelled=true 即可对用户说"已取消"，不会标记工具失败
            if (!unpacked || typeof unpacked.templateId !== 'number') {
                return JSON.stringify({
                    success: false,
                    cancelled: true,
                    message: '用户已取消模板选择',
                })
            }
            const templateId = unpacked.templateId
            const sourceText = (unpacked.sourceText ?? input.additionalContext ?? input.intent).trim()

            // 3. 创建草稿
            // enqueueAgentRun: false —— 关键参数：本工具自己同步调 runDocumentChat 消费整条 SSE 流。
            // 若让 createDraftService 内部继续把任务入队给 agentWorker，会出现「worker + tool 双实例
            // 并发同 thread_id」：两个 LangGraph 实例共享 checkpointer 和 draft.id，afterAgent hook
            // 各自跑一次 updateDocumentDraftDAO，谁后写谁赢；其中一方失败时会把另一方写入的
            // values + ready 状态覆盖回 failed/{}（DraftDocumentCard 显示空白草稿的真实根因）。
            const { createDraftService } = await import(
                '~~/server/agents/document/documentDraft.service'
            )
            const created = await createDraftService({
                userId,
                templateId,
                sourceText,
                caseId: caseId ?? undefined,
                enqueueAgentRun: false,
            })
            if ('error' in created) {
                throw new Error(`draft_document: ${created.error}`)
            }
            const { draftId, sessionId: subSessionId } = created

            // 4. 同步执行 documentMain Agent + 消费流
            const { runDocumentChat } = await import(
                '~~/server/services/workflow/agents/documentMainAgent'
            )
            const callbacks = buildSubAgentCallbacks({
                mainRunId: runId,
                sessionId,
                parentToolCallId: toolCallId,
                agentName: 'documentMain',
                subThreadId: subSessionId,
            })
            const stream = await runDocumentChat(subSessionId, undefined, {
                userId,
                caseId: caseId ?? undefined,
                signal: undefined,
                callbacks,
            })
            const drainResult = await runAndDrainStream(stream)
            const subAgentMeta = {
                agentName: 'documentMain',
                threadId: subSessionId,
                parentToolCallId: toolCallId,
            }
            if (!drainResult.success) {
                await publishSubAgentStatus({
                    runId,
                    sessionId,
                    status: 'failed',
                    error: drainResult.error,
                    ...subAgentMeta,
                })
                // graph 抛错时 afterAgent hook 也没机会跑 → draft.status 仍卡在 'filling'。
                // 主动改成 'failed'，让前端文书页 / 列表显示失败态而非卡死的"生成中"。
                const { updateDocumentDraftDAO } = await import(
                    '~~/server/agents/document/documentDraft.dao'
                )
                await updateDocumentDraftDAO(draftId, { status: 'failed' }).catch(() => { /* 已经在错误路径，吞 */ })
                throw new Error(`draft_document: 文书 Agent 执行失败 - ${drainResult.error ?? '未知错误'}`)
            }
            await publishSubAgentStatus({
                runId,
                sessionId,
                status: 'completed',
                ...subAgentMeta,
            })
            if (drainResult.interrupt) {
                // 文书 Agent 内部不应再 interrupt 主 Agent；如果出现就是配置异常
                logger.warn('draft_document: 子流内出现 interrupt（异常），按未完成处理', {
                    interruptType: drainResult.interrupt.type,
                })
            }

            // 5. 读取已落库的 draft + template 提取 summary 信息
            // runAndDrainStream 返回时 afterAgent hook 已 await 完成，直接读 DB 即可
            const { getDocumentDraftDAO } = await import(
                '~~/server/agents/document/documentDraft.dao'
            )
            const { getDocumentTemplateDAO } = await import(
                '~~/server/agents/document/documentTemplate.dao'
            )
            const [finalDraft, template] = await Promise.all([
                getDocumentDraftDAO(draftId),
                getDocumentTemplateDAO(templateId),
            ])
            if (!finalDraft) {
                throw new Error('draft_document: 草稿落库后查不到')
            }

            // 兜底 1：status 仍是 'drafting'/'filling' → graph 进了 beforeAgent 但
            // afterAgent 没跑（上游某条 error 路径漏过 SSE 帧识别）。
            if (finalDraft.status === 'drafting' || finalDraft.status === 'filling') {
                const { updateDocumentDraftDAO } = await import(
                    '~~/server/agents/document/documentDraft.dao'
                )
                await updateDocumentDraftDAO(draftId, { status: 'failed' }).catch(() => { /* 已经在错误路径，吞 */ })
                throw new Error(
                    `draft_document: afterAgent hook 未把草稿写到终态（当前 status=${finalDraft.status}），`
                    + '可能是子流 graph 异常退出。请重试或联系开发查 documentMain 日志。',
                )
            }

            // 兜底 2：status 已是 'failed' → afterAgent hook 内部走了失败分支
            //   - try 内 `if (!structured)` 命中：LLM 没产生 structuredResponse 也无消息体可解析
            //   - 或 catch 兜底：try 内任意步骤抛错被捕获写 failed
            // 旧版只检查 drafting/filling 漏掉这条路径——hook catch 吞了错误，graph
            // 自然 done，stream 没有 error 帧 → tool 误认为成功 → 主 Agent 显示
            // "已完成起草《...》摘要：已建好空白草稿，等待用户补充信息" 假成功。
            if (finalDraft.status === 'failed') {
                throw new Error(
                    'draft_document: 文书 Agent 起草失败（afterAgent hook 写了 status=failed）。'
                    + '常见原因：LLM 未按 toolStrategy 调结构化输出工具，或返回的 JSON 不符 schema。'
                    + '请重试，若多次失败请检查 documentMain 节点 model 是否支持 tool calling。',
                )
            }

            const draftValues = (finalDraft.values as Record<string, string | null> | null) ?? {}
            const filledFieldCount = Object.values(draftValues).filter(v => typeof v === 'string' && v.trim()).length
            const totalFields = Array.isArray(template?.placeholders) ? template!.placeholders.length : 0

            const title = finalDraft.title || template?.name || '未命名文书'
            const summary = filledFieldCount > 0
                ? `已自动填写 ${filledFieldCount}/${totalFields} 个字段`
                : '已建好空白草稿，等待用户补充信息'

            // from 参数：caseId 非空 = 小索路径（caseMain），caseId 为空 = 法律助手路径（assistantMain）
            // 来源条按此分支决定返回入口与右侧关联状态显示（决策 D2/D3，参见 plan 阶段 6）
            const fromParam = caseId ? 'xiaosuo' : 'assistant'
            const href = `/dashboard/document/drafts/${draftId}`
                + `?from=${fromParam}&sessionId=${encodeURIComponent(sessionId)}`
                + (caseId ? `&caseId=${caseId}` : '')

            // 6. publishCustomEvent DRAFT_SAVED（前端工具卡片更新）
            try {
                await publishCustomEvent({
                    type: 'custom_event',
                    runId,
                    sessionId,
                    name: SSECustomEventType.DRAFT_SAVED,
                    data: { draftId, summary, title, href },
                })
            } catch (err) {
                logger.warn('draft_document: publishCustomEvent(DRAFT_SAVED) 失败，仍返回结果', { err })
            }

            // 7. 返回 LLM 一个紧凑 JSON
            return JSON.stringify({
                success: true,
                draftId,
                title,
                summary,
                href,
                subSessionId,  // documentMain 子 thread_id（loadSubAgentThreads 历史恢复用）
                templateId,
                templateName: template?.name ?? null,
                filledFieldCount,
                totalFields,
            })
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
