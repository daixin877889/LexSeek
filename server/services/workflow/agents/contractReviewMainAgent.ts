/**
 * 合同审查主代理（contractReviewMain 节点）
 *
 * 仿 documentMainAgent 骨架：
 * - 从 sessionId 反查 review（contractReviews.sessionId unique）
 * - 唯一工具 parseAndAskStance 由 toolModules 加载
 * - 挂载 reviewResultPersistenceMiddleware（末位 afterAgent，兜底路径）
 *
 * 参见 spec §6.2 / §6.6
 *
 * M6.1 事件顺序（按代码触发时机）：
 *
 *   Phase A（agent 启动前，runContractReviewChat 同步执行）：
 *     1. stage:segment,running
 *     2. stage:segment,done + totalClauses（失败时带 warnings: ['segment_failed']）
 *
 *   Phase B·首轮（agent.stream 运行期，事件顺序由 LangGraph 调度决定）：
 *     3. [middleware.beforeAgent]        stage:detect,running
 *     4. [tool.parseAndAskStance 开头]   stage:detect,done + partyA/B/contractType
 *     5. [tool.parseAndAskStance 开头]   stage:stance,running
 *     6. [用户立场选择 interrupt]        —— 挂起 ——
 *
 *   Phase B·resume（用户回复立场后，不再走 agent.stream，直接在主流程执行）：
 *     7. [parseAndAskStance resume 后]   stage:stance,done
 *        注：resume 后 parseAndAskStance 不再被执行（绕过 agent.stream），
 *        stance:done 由 runContractReviewChat 在执行 runAnalyzeLoop 前手动发出
 *     8. [runAnalyzeLoop 开头]           stage:analyze,running
 *     9. [runAnalyzeLoop 循环中]         progress × N + risk × M
 *    10. [runAnalyzeLoop 结尾]           stage:analyze,done
 *    11. [summarizeOverview 开头]        stage:summarize,running
 *    12. [summarizeOverview 完成后]      overview（成功时）+ stage:summarize,done
 *    13. [runAnnotateAndUpload 完成后]   —— status=completed ——
 *
 * 前端 useContractReview 状态机按用户心智顺序呈现：识别→立场→切分→分析→汇总，
 * 即使后端 Phase A 的 segment 事件实际先发，前端也等 detect/stance 完成后才显示。
 */

import {
    createAgent,
    summarizationMiddleware,
    type ReactAgent,
} from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { renderSystemPrompt } from '../utils/promptRenderer'
import {
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
    reviewResultPersistenceMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    createAuditMiddleware,
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '../middleware'
import { runAnnotateAndUpload } from '../middleware/reviewResultPersistence.middleware'
import {
    findContractReviewBySessionIdDAO,
    updateContractReviewDAO,
} from '../../assistant/contract/contractReview.dao'
import { listEnabledPlaybookPointsDAO } from '../../assistant/contract/contractPlaybook.dao'
import { loadContractFullText } from '../../assistant/contract/docx/loadContractFullText'
import { segmentClauses } from '../../assistant/contract/docx/clauseSegmenter'
import { analyzeSingleClause } from '../../assistant/contract/analyzeSingleClause'
import { summarizeOverview } from '../../assistant/contract/summarizeOverview'
import {
    emitContractReviewEvent,
    type ContractReviewEmitterCtx,
} from '../nodes/contractReviewStageEmitter'
import { createContractRiskDAO } from '../../assistant/contract/contractRisk.dao'
import { createContractAnnotationDAO } from '../../assistant/contract/contractAnnotation.dao'
import { saveContractReviewVersionService } from '../../assistant/contract/contractReviewVersion.service'
import type { Prisma } from '~~/generated/prisma/client'
import type { Risk, Stance, ClauseSegment, PlaybookSnapshot, StancePreference, RiskLevel } from '#shared/types/contract'
import { resolveContextWindow } from '../context/messageCompressor'

import { renderRiskAsAnnotationText } from '~~/server/services/assistant/contract/contractRiskRender'

/**
 * AI 审查完成后，把每条 Risk 写入 ContractRisk + ContractAnnotation 表，
 * 并生成 v1 initial_upload 快照。
 *
 * 幂等：若 review 已有 currentVersionId 则跳过（避免重复触发写入）。
 */
async function persistRisksAndCreateV1Snapshot(
    reviewId: number,
    userId: number,
    risks: Risk[],
    docxText: string,
): Promise<void> {
    // 幂等守卫：已有 currentVersionId 说明 v1 快照已存在，跳过
    const current = await prisma.contractReviews.findUnique({
        where: { id: reviewId },
        select: { currentVersionId: true },
    })
    if (current?.currentVersionId != null) {
        logger.info('persistRisksAndCreateV1Snapshot: currentVersionId 已存在，跳过', { reviewId })
        return
    }

    // 写 ContractRisk + ContractAnnotation（每条 AI 风险各一条）
    for (const aiRisk of risks) {
        const risk = await createContractRiskDAO({
            reviewId,
            source: 'ai',
            code: aiRisk.matchedPointCode ?? null,
            category: aiRisk.category,
            level: aiRisk.level as RiskLevel,
            stance: 'balanced' as StancePreference,
            problem: aiRisk.problem,
            legalBasis: aiRisk.legalBasis ?? null,
            analysis: aiRisk.analysis,
            suggestion: aiRisk.suggestion,
            anchorQuote: aiRisk.clauseText,
            anchorParagraphIndex: aiRisk.clauseIndex,
        })
        await createContractAnnotationDAO({
            reviewId,
            riskId: risk.id,
            authorType: 'ai',
            authorName: 'AI',
            content: renderRiskAsAnnotationText(aiRisk),
        })
    }

    // 创建 v1 initial_upload 快照（显式传 docxText）
    await saveContractReviewVersionService({
        reviewId,
        systemLabel: 'initial_upload',
        createdById: userId,
        docxText,
    })
    logger.info('persistRisksAndCreateV1Snapshot: v1 快照已创建', { reviewId, risksCount: risks.length })
}

/** 合同审查主代理节点名称 */
const CONTRACT_MAIN_NODE_NAME = 'contractReviewMain'

/**
 * Agent 首轮启动指令。
 *
 * 要求模型：
 * 第一步调用 parseAndAskStance 工具（触发 interrupt 等待用户立场）
 */
function buildInitialPrompt(reviewId: number): string {
    return [
        `请审查合同（reviewId=${reviewId}）。`,
        '第一步：调用 parseAndAskStance 工具解析合同并请求用户立场；该工具会 interrupt 等待用户回复。',
    ].join('\n')
}

export interface ContractReviewAgentOptions {
    /** 用户 ID */
    userId: number
    /** agent run ID（agentWorker.executeRun 持有的 run.id，供 SSE 事件路由） */
    runId?: string
    /** 来自 agentWorker.executeRun 的 AbortController，用户取消/超时时传入 */
    signal?: AbortSignal
    /** 中断恢复命令（若存在则走 resume 分支） */
    command?: unknown
}

/** analyze loop 上下文 */
export interface AnalyzeLoopContext {
    segments: ClauseSegment[]
    stance: Stance
    partyA: string | null
    partyB: string | null
    contractType: string | null
    /** M7 Playbook 快照；null/undefined 表示无清单，analyzeSingleClause 内部回退到无清单 prompt */
    playbookSnapshot?: PlaybookSnapshot | null
    emitterCtx: ContractReviewEmitterCtx
}

/**
 * 按条款循环分析，逐条发 progress / risk 事件。
 *
 * 独立 export 便于单测，不依赖 agent.stream。
 *
 * - 每条成功：若有风险则 risks.push + 发 risk 事件
 * - 每条失败：warnings.push + 发 progress.error（继续处理其余条款）
 * - 结束时：发 analyze:done（含 warnings 若非空）
 */
export async function runAnalyzeLoop(ctx: AnalyzeLoopContext): Promise<{ risks: Risk[]; warnings: string[] }> {
    const risks: Risk[] = []
    const warnings: string[] = []

    await emitContractReviewEvent(ctx.emitterCtx, {
        type: 'stage', stage: 'analyze', status: 'running',
    })

    for (const seg of ctx.segments) {
        await emitContractReviewEvent(ctx.emitterCtx, {
            type: 'progress', current: seg.index, total: ctx.segments.length,
        })
        try {
            const risk = await analyzeSingleClause({
                clause: seg,
                stance: ctx.stance,
                partyA: ctx.partyA,
                partyB: ctx.partyB,
                contractType: ctx.contractType,
                playbookSnapshot: ctx.playbookSnapshot,
            })
            if (risk) {
                risks.push(risk)
                await emitContractReviewEvent(ctx.emitterCtx, { type: 'risk', risk })
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            warnings.push(`第 ${seg.index} 条：${msg}`)
            await emitContractReviewEvent(ctx.emitterCtx, {
                type: 'progress', current: seg.index, total: ctx.segments.length, error: msg,
            })
        }
    }

    await emitContractReviewEvent(ctx.emitterCtx, {
        type: 'stage', stage: 'analyze', status: 'done',
        warnings: warnings.length ? warnings : undefined,
    })

    return { risks, warnings }
}

/**
 * 执行合同审查对话。
 *
 * - 首轮（command 为空）：创建 agent，执行 parseAndAskStance 工具，interrupt 等待用户立场
 * - resume 轮（command 存在）：**不**走 agent.stream，直接从 DB 取立场，
 *   执行 runAnalyzeLoop，最后 runAnnotateAndUpload。
 *   返回一个空 ReadableStream（agentWorker 消费后直接 COMPLETED）。
 *
 * @param sessionId 会话 ID（同时作为 thread_id 和 review.sessionId）
 * @param options Agent 选项
 * @returns ReadableStream（SSE 格式）
 */
export async function runContractReviewChat(
    sessionId: string,
    options: ContractReviewAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, runId = '', signal, command } = options

    // 1. 并发加载基础设施 + 反查 review
    const [checkpointer, store, nodeConfig, review] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(CONTRACT_MAIN_NODE_NAME, '合同审查主Agent'),
        findContractReviewBySessionIdDAO(sessionId),
    ])

    if (!review) {
        throw new Error(`No contract review found for session ${sessionId}`)
    }

    // M6.1：构造 emitter 上下文，供后续所有 SSE 事件调用复用
    const emitterCtx: ContractReviewEmitterCtx = { runId, sessionId }

    // 2. 获取可用 API Key
    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${CONTRACT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }

    // 3. 创建模型实例（temperature=0 确保审查稳定性）
    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0,
        streaming: true,
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })

    // 4. 渲染系统提示词（注入 reviewId + contractType）
    const systemPrompt = renderSystemPrompt(nodeConfig, {
        reviewId: review.id,
        contractType: review.contractType ?? undefined,
    })

    // 5. 加载工具（传入 reviewId 关键上下文，parseAndAskStance 工具依赖）
    const toolContext = {
        userId,
        sessionId,
        runId,
        reviewId: review.id,
    }
    const tools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []

    logger.info('合同审查主 Agent 创建', {
        sessionId,
        reviewId: review.id,
        contractType: review.contractType,
        model: nodeConfig.modelName,
        toolsCount: tools.length,
        isResume: !!command,
    })

    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
        nodeConfig.modelContextWindow,
        nodeConfig.modelMaxOutputTokens,
    )

    // 7. 组装中间件栈（按 priority 排序：scope → toolCallLimit → 计费 → 摘要 → 安全裁剪 → 结果持久化 → 审计）
    const middleware = buildMiddlewareStack([
        {
            middleware: createMessageIntegrityMiddleware(),
            priority: MIDDLEWARE_PRIORITY.MESSAGE_INTEGRITY,
            name: MIDDLEWARE_NAMES.MESSAGE_INTEGRITY,
        },
        {
            middleware: createScopeGuardMiddleware(),
            priority: MIDDLEWARE_PRIORITY.SCOPE_GUARD,
            name: MIDDLEWARE_NAMES.SCOPE_GUARD,
        },
        {
            middleware: pointConsumptionMiddleware(userId, 'contract_review_token', sessionId),
            priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION,
            name: MIDDLEWARE_NAMES.POINT_CONSUMPTION,
        },
        {
            middleware: summarizationMiddleware({
                model,
                trigger: [{ tokens: triggerTokens }],
            }),
            priority: MIDDLEWARE_PRIORITY.SUMMARIZATION,
            name: MIDDLEWARE_NAMES.SUMMARIZATION,
        },
        {
            middleware: safetyTrimMiddleware({
                model,
                maxTokens,
                systemPrompt,
                maxOutputTokens,
            }),
            priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM,
            name: MIDDLEWARE_NAMES.SAFETY_TRIM,
        },
        {
            middleware: reviewResultPersistenceMiddleware({
                reviewId: review.id,
                sessionId,
                runId,
            }),
            priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
            name: MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE,
        },
        {
            middleware: createAuditMiddleware(),
            priority: MIDDLEWARE_PRIORITY.AUDIT,
            name: MIDDLEWARE_NAMES.AUDIT,
        },
    ])

    // 8. 组装 Agent（首轮使用，resume 分支绕过此 agent）
    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools,
        middleware,
    })

    // M6.1 子期 1：在 agent 启动前预切分条款并发 segment 事件
    // 首轮和 resume 均执行（resume 时 segments 是 runAnalyzeLoop 的输入）
    let segments: ClauseSegment[] = []
    // docxText 供 Phase A v1 快照使用（resume 分支写入 snapshot）
    let parsedDocxText = ''
    try {
        await emitContractReviewEvent(emitterCtx, {
            type: 'stage', stage: 'segment', status: 'running',
        })
        const { fullText } = await loadContractFullText(review.originalFileId)
        parsedDocxText = fullText
        segments = await segmentClauses(fullText)
        await emitContractReviewEvent(emitterCtx, {
            type: 'stage', stage: 'segment', status: 'done',
            totalClauses: segments.length,
        })
        logger.info('合同切分完成', { reviewId: review.id, totalClauses: segments.length })
    } catch (err) {
        logger.warn('合同切分失败，降级整篇分析', { reviewId: review.id, err })
        await emitContractReviewEvent(emitterCtx, {
            type: 'stage', stage: 'segment', status: 'done',
            totalClauses: 0,
            warnings: ['segment_failed'],
        })
    }

    // M6.1 子期 2：resume 分支激进替换
    // 用户立场恢复后不再走 agent.stream 的 responseFormat 路径，
    // 直接从 DB 读 stance/partyA/partyB，执行 runAnalyzeLoop，
    // 然后写 DB risks + runAnnotateAndUpload。
    if (command) {
        return new ReadableStream<Uint8Array>({
            async start(controller) {
                try {
                    // resume payload 含 stance（来自用户立场选择）
                    // partyA/B/contractType 由首轮 parseAndAskStance interrupt 前已写入 DB，
                    // 外层 review 对象在 interrupt 后仍是最新值（interrupt 前已落库）
                    const payload = command as { stance?: unknown; partyA?: unknown; partyB?: unknown }
                    const stance = (payload.stance ?? 'neutral') as Stance
                    const finalPartyA = typeof payload.partyA === 'string' ? payload.partyA : review.partyA
                    const finalPartyB = typeof payload.partyB === 'string' ? payload.partyB : review.partyB

                    // 写 stance 到 DB（parseAndAskStance 工具不再执行，由此处代劳）
                    await updateContractReviewDAO(review.id, {
                        stance,
                        partyA: finalPartyA,
                        partyB: finalPartyB,
                        status: 'reviewing',
                    })

                    // 发 stance:done（parseAndAskStance 工具在 resume 路径不执行，由此代劳）
                    await emitContractReviewEvent(emitterCtx, {
                        type: 'stage', stage: 'stance', status: 'done',
                    })

                    // M7：写入 playbook 快照（在 stance 落库后、analyze 开始前）
                    let playbookSnapshot: PlaybookSnapshot | null = null
                    if (review.contractType && review.contractType !== '其他') {
                        try {
                            const points = await listEnabledPlaybookPointsDAO(review.contractType)
                            if (points.length > 0) {
                                playbookSnapshot = {
                                    contractType: review.contractType,
                                    points,
                                    snapshotAt: new Date().toISOString(),
                                }
                                await updateContractReviewDAO(review.id, { playbookSnapshot: playbookSnapshot as unknown as Prisma.InputJsonValue })
                                logger.info('Playbook 快照写入', {
                                    reviewId: review.id,
                                    contractType: review.contractType,
                                    pointCount: points.length,
                                })
                            }
                        } catch (err) {
                            logger.warn('Playbook 快照写入失败，降级为无清单审查', {
                                reviewId: review.id,
                                err: err instanceof Error ? err.message : String(err),
                            })
                        }
                    }

                    // Bug 1 fail-fast：segments 为空 = 切分失败或合同为空，不能继续 analyze。
                    // 若不拦截，runAnalyzeLoop 会把空数组写回 DB，runAnnotateAndUpload 再把
                    // risks=[] 误判为"无风险合同"置 completed，用户看到"审查完成，无风险"。
                    // 这里直接置 failed，M5 rebuild-docx 可据此引导用户重新上传。
                    if (segments.length === 0) {
                        logger.warn('runContractReviewChat resume: 无可分析条款（切分失败或合同为空），置 failed', {
                            reviewId: review.id, sessionId,
                        })
                        await updateContractReviewDAO(review.id, { status: 'failed' })
                        await emitContractReviewEvent(emitterCtx, {
                            type: 'stage', stage: 'analyze', status: 'done',
                            warnings: ['no_segments'],
                        })
                        controller.close()
                        return
                    }

                    // 执行 analyze loop（发 analyze:running / progress / risk / analyze:done）
                    const { risks } = await runAnalyzeLoop({
                        segments,
                        stance,
                        partyA: finalPartyA,
                        partyB: finalPartyB,
                        contractType: review.contractType,
                        playbookSnapshot,
                        emitterCtx,
                    })

                    // 写 risks 到 DB（一次性落库）
                    await updateContractReviewDAO(review.id, {
                        risks: risks as unknown as Prisma.InputJsonValue,
                    })

                    // 生成结构化总览（summarize 阶段）
                    await emitContractReviewEvent(emitterCtx, { type: 'stage', stage: 'summarize', status: 'running' })
                    try {
                        const overview = await summarizeOverview(risks, stance, review.contractType)
                        await updateContractReviewDAO(review.id, { summary: overview as unknown as Prisma.InputJsonValue })
                        await emitContractReviewEvent(emitterCtx, { type: 'overview', overview })
                        await emitContractReviewEvent(emitterCtx, { type: 'stage', stage: 'summarize', status: 'done' })
                    } catch (err) {
                        logger.warn('summarizeOverview 失败，降级为仅 overall', { reviewId: review.id, err })
                        await updateContractReviewDAO(review.id, {
                            summary: { highlights: null, overall: `本合同识别到 ${risks.length} 条风险。` } as unknown as Prisma.InputJsonValue,
                        })
                        await emitContractReviewEvent(emitterCtx, { type: 'stage', stage: 'summarize', status: 'done' })
                    }

                    // Phase A：写 ContractRisk + ContractAnnotation + 创建 v1 initial_upload 快照
                    // 必须在 runAnnotateAndUpload 之前执行（annotate 需要 risks 已落库）
                    try {
                        await persistRisksAndCreateV1Snapshot(
                            review.id,
                            userId,
                            risks,
                            parsedDocxText,
                        )
                    } catch (err) {
                        // 新表写入失败不影响主流程（向下兼容：旧 risks JSON 已落库）
                        logger.error('persistRisksAndCreateV1Snapshot 失败，降级继续主流程', { reviewId: review.id, err })
                    }

                    // 注入批注 + 上传 OSS + 置 completed
                    try {
                        await runAnnotateAndUpload(review.id)
                    } catch (err) {
                        logger.error('runContractReviewChat: 批注/上传失败', { reviewId: review.id, err })
                        await updateContractReviewDAO(review.id, { status: 'failed' })
                    }

                    controller.close()
                } catch (err) {
                    logger.error('runContractReviewChat resume 分支失败', { reviewId: review.id, err })
                    await updateContractReviewDAO(review.id, { status: 'failed' }).catch(() => {})
                    controller.error(err)
                }
            },
        })
    }

    // 首轮（非 resume）：走标准 agent.stream，到 parseAndAskStance interrupt 挂起
    const input: { messages: HumanMessage[] } = {
        messages: [new HumanMessage(buildInitialPrompt(review.id))],
    }

    // 11. 流式执行，返回 SSE 格式的 ReadableStream
    return agent.stream(input, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 1000,
        signal,
    })
}
