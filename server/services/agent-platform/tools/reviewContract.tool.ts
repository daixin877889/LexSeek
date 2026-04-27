/**
 * review_contract 子代理工具（阶段 5）
 *
 * 法律助手主 Agent 用此工具调起「合同审查助手」分析一份合同。流程：
 * 1. 校验 ossFileId 归属当前用户、文件类型为 .docx
 * 2. 创建 contractReview 记录 + 关联 caseSession（scope=contract）
 * 3. 加载合同段落 → detectParties 识别甲乙方 + 合同类型（写入 review）
 * 4. 原生 `interrupt({ type: 'stance_select', toolCallId, ... })` 暂停主 Agent
 *    —— LangGraph 把 interrupt 自然透出到主 agent streamValues.__interrupt__，
 *    前端 useStreamChat.interruptData 现成消费；前端按 type 派发到 StanceSelectCard。
 * 5. 用户在卡片上选定 `{stance, partyA?, partyB?}` 提交后，前端调
 *    `stream.submit({ command: { resume: data } })`，LangGraph 把 resume value
 *    直接还给本工具的 interrupt() 返回值（无任何外包）。
 * 6. 写入 review.stance / partyA / partyB / status='reviewing'
 * 7. 调 runContractReviewChat(sessionId, { skipStanceInterrupt: true, ... })
 *    —— 跳过 createAgent + parseAndAskStance interrupt，直接走 resume 分支
 *    （runAnalyzeLoop + persistRisks + saveContractReviewVersion v1 initial_upload）
 * 8. runAndDrainStream 消费整个流
 * 9. 读取 contractRisks 取 Top 3 + 风险等级统计
 * 10. publishCustomEvent CONTRACT_REVIEW_SAVED
 * 11. 返回 LLM 紧凑 JSON
 *
 * 取消（resume value === null / 缺 stance）：软删 review 记录（写 deletedAt），
 * 返回 `{ success:false, cancelled:true }`，不抛错。
 *
 * @see docs/superpowers/plans/2026-04-27-ai-unify-stage-5-assistant-tools.md §Task 4
 */

import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { ToolContext, ToolDefinition } from './types'
import type { Stance } from '#shared/types/contract'
import { SSECustomEventType } from '#shared/types/agentEvent'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'
import { runAndDrainStream } from '~~/server/services/agent-platform/subAgent/runAndDrain'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const VALID_STANCES: readonly Stance[] = ['partyA', 'partyB', 'neutral']

function isValidStance(value: unknown): value is Stance {
    return typeof value === 'string' && (VALID_STANCES as readonly string[]).includes(value)
}

const schema = z.object({
    // LLM 偶尔会把数字传成字符串（如 "1012"），用 coerce 自动转 number 增强鲁棒性
    ossFileId: z.coerce.number().int().positive().describe('用户已上传的合同 docx 文件 ossFiles.id'),
    partyAHint: z.string().optional().describe('甲方名称提示，可选；前端 StanceSelectCard 默认填入'),
    partyBHint: z.string().optional().describe('乙方名称提示，可选；前端 StanceSelectCard 默认填入'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'review_contract',
    description:
        '调起合同审查助手分析一份 .docx 合同，识别风险点。会先弹出"立场选择卡片"让用户确认审查立场（甲方/乙方/中立）'
        + '与甲乙双方名称，随后自动跑完整审查流程并保存结果；返回 reviewId / Top 风险摘要 / 跳转链接。'
        + ' 当用户带着合同 docx 文件并表达"审一下/分析这份合同/帮我看看合同条款" 等意图时调用。',
    schema,
}

interface StanceSelectResumeValue {
    stance: Stance
    partyA?: string
    partyB?: string
}

export function createTool(context: ToolContext) {
    return tool(
        async (input: z.infer<typeof schema>, cfg): Promise<string> => {
            const toolCallId = (cfg as any)?.toolCall?.id ?? ''
            const { runId = '', sessionId, userId, caseId } = context
            if (!sessionId || !userId) {
                throw new Error('review_contract: ToolContext 缺少 sessionId/userId')
            }

            // 1. 校验 OSS 文件归属 + 类型
            const { findOssFileByIdDao } = await import(
                '~~/server/services/files/ossFiles.dao'
            )
            const ossFile = await findOssFileByIdDao(input.ossFileId)
            if (!ossFile || ossFile.userId !== userId) {
                throw new Error('review_contract: 文件不存在或无权访问')
            }
            if (ossFile.fileType !== DOCX_MIME) {
                throw new Error('review_contract: 仅支持 .docx 格式的合同文件')
            }

            // 2. 创建合同审查 session + review（status='pending'，stance 留空）
            const subSessionId = randomUUID()
            await prisma.caseSessions.create({
                data: {
                    sessionId: subSessionId,
                    scope: 'contract',
                    userId,
                    caseId: null,
                    type: 1,
                    status: 1,
                    title: `合同审查 · ${ossFile.fileName}`,
                },
            })
            const { createContractReviewDAO, updateContractReviewDAO } = await import(
                '~~/server/agents/contract/contractReview.dao'
            )
            const review = await createContractReviewDAO({
                userId,
                sessionId: subSessionId,
                originalFileId: ossFile.id,
                status: 'pending',
                ...(caseId !== undefined && caseId !== null ? { caseId } : {}),
            })

            // 3. 识别甲乙方 + 合同类型；落库后 status='awaiting_stance'
            const { loadContractFullText } = await import(
                '~~/server/agents/contract/docx/loadContractFullText'
            )
            const { detectParties } = await import(
                '~~/server/agents/contract/docx/partyDetector'
            )
            const { paragraphs } = await loadContractFullText(ossFile.id)
            const { partyA: detectedA, partyB: detectedB, contractType } = await detectParties(paragraphs)

            await updateContractReviewDAO(review.id, {
                contractType: contractType ?? null,
                partyA: detectedA ?? null,
                partyB: detectedB ?? null,
                status: 'awaiting_stance',
            })

            // 4. 发起立场选择 interrupt（LangGraph 自然透出 __interrupt__）
            //    payload 形态约定：{ type, toolCallId, ...payload }，type 顶层
            const resumedRaw = interrupt({
                type: 'stance_select',
                toolCallId,
                reviewId: review.id,
                fileName: ossFile.fileName,
                partyAHint: input.partyAHint ?? detectedA ?? null,
                partyBHint: input.partyBHint ?? detectedB ?? null,
                contractType: contractType ?? null,
            }) as unknown

            // LangGraph createAgent + 子工具 interrupt 不会自动解掉两层包装
            // (command.resume + toolCallId 路由)，工具内手动解：
            //   raw = { resume: { [toolCallId]: realValue } } → realValue
            // 详见 draftDocument.tool.ts 同款解包注释。
            const resumed = ((): StanceSelectResumeValue | null => {
                if (!resumedRaw || typeof resumedRaw !== 'object') return null
                const layer1 = (resumedRaw as { resume?: unknown }).resume ?? resumedRaw
                if (layer1 && typeof layer1 === 'object' && toolCallId in (layer1 as Record<string, unknown>)) {
                    return (layer1 as Record<string, unknown>)[toolCallId] as StanceSelectResumeValue | null
                }
                return layer1 as StanceSelectResumeValue | null
            })()

            // 用户取消（resume===null / stance 非法）：软删 review，返回 cancelled
            // 用现成的 softDeleteContractReviewDAO 写 deletedAt（不污染 status 状态机）
            if (!resumed || !isValidStance(resumed.stance)) {
                const { softDeleteContractReviewDAO } = await import(
                    '~~/server/agents/contract/contractReview.dao'
                )
                await softDeleteContractReviewDAO(review.id).catch((err) => {
                    logger.warn('review_contract: 软删取消的 review 失败', { reviewId: review.id, err })
                })
                logger.info('review_contract: 用户取消立场选择，已软删 review', {
                    reviewId: review.id,
                    fileName: ossFile.fileName,
                })
                return JSON.stringify({
                    success: false,
                    cancelled: true,
                    message: '用户已取消合同审查',
                })
            }

            const stance = resumed.stance
            const finalPartyA = (resumed.partyA?.trim() || detectedA || null) ?? null
            const finalPartyB = (resumed.partyB?.trim() || detectedB || null) ?? null

            // 5. 写入立场，进入 reviewing
            await updateContractReviewDAO(review.id, {
                stance,
                partyA: finalPartyA,
                partyB: finalPartyB,
                status: 'reviewing',
            })

            // 6. 调 runContractReviewChat(skipStanceInterrupt: true)，直接走 resume 分支
            //    内部读取 review.stance/partyA/partyB（已落库），跳过 parseAndAskStance interrupt
            const { runContractReviewChat } = await import(
                '~~/server/services/workflow/agents/contractReviewMainAgent'
            )
            const stream = await runContractReviewChat(subSessionId, {
                userId,
                runId, // 用主 runId，让 stage/risk 事件流到主 SSE 通道（前端 ReviewContractCard 可订阅）
                skipStanceInterrupt: true,
            })
            const drainResult = await runAndDrainStream(stream)
            if (!drainResult.success) {
                throw new Error(`review_contract: 合同 Agent 执行失败 - ${drainResult.error ?? '未知错误'}`)
            }

            // 7. 取 Top 3 风险 + 等级统计
            const { listContractRisksDAO } = await import(
                '~~/server/agents/contract/contractRisk.dao'
            )
            const risks = await listContractRisksDAO(review.id)
            const levelCount: Record<string, number> = { high: 0, medium: 0, low: 0 }
            for (const r of risks) {
                const lvl = (r.level ?? 'low').toLowerCase()
                if (lvl in levelCount) levelCount[lvl] = (levelCount[lvl] ?? 0) + 1
            }

            // 等级排序：high > medium > low；同等级按 createdAt asc
            const levelOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
            const sortedRisks = [...risks].sort((a, b) => {
                const la = levelOrder[(a.level ?? 'low').toLowerCase()] ?? 9
                const lb = levelOrder[(b.level ?? 'low').toLowerCase()] ?? 9
                if (la !== lb) return la - lb
                return new Date(a.createdAt as any).getTime() - new Date(b.createdAt as any).getTime()
            })
            // 给前端 ReviewContractCard 渲染的"Top 3 风险"摘要：
            // title 优先用 problem（结论性短句），否则回落到 category（分类标签）
            const topRisks = sortedRisks.slice(0, 3).map(r => ({
                title: r.problem || r.category || '风险',
                level: (r.level ?? 'low') as 'high' | 'medium' | 'low',
            }))

            const href = `/dashboard/contract/${review.id}`
                + `?from=assistant&sessionId=${encodeURIComponent(sessionId)}`
                + (caseId ? `&caseId=${caseId}` : '')

            // 8. publishCustomEvent CONTRACT_REVIEW_SAVED
            try {
                await publishCustomEvent({
                    type: 'custom_event',
                    runId,
                    sessionId,
                    name: SSECustomEventType.CONTRACT_REVIEW_SAVED,
                    data: {
                        reviewId: review.id,
                        riskCount: risks.length,
                        topRisks,
                        href,
                    },
                })
            } catch (err) {
                logger.warn('review_contract: publishCustomEvent(CONTRACT_REVIEW_SAVED) 失败，仍返回结果', { err })
            }

            // 9. 返回 LLM
            return JSON.stringify({
                success: true,
                reviewId: review.id,
                fileName: ossFile.fileName,
                stance,
                partyA: finalPartyA,
                partyB: finalPartyB,
                contractType: contractType ?? null,
                riskCount: risks.length,
                levelCount,
                topRisks,
                href,
            })
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
