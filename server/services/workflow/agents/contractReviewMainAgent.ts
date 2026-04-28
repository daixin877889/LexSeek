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
import pLimit from 'p-limit'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig, type NodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { renderSystemPrompt } from '../utils/promptRenderer'
import { buildSystemPromptForAgent } from '../context/moduleContextBuilder'
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
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import type { CustomEventEmitter } from '~~/server/services/agent-platform/sse/customEventEmitter'
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
import { persistAiRisksAsContractRows, type PersistAiRiskRow } from '../../assistant/contract/contractRisk.service'
import { createContractAnnotationDAO } from '../../assistant/contract/contractAnnotation.dao'
import { saveContractReviewVersionService } from '../../assistant/contract/contractReviewVersion.service'
import { buildClauseToParagraphMap } from '../../assistant/contract/utils/clauseToParagraph'
import type { Prisma } from '~~/generated/prisma/client'
import type { Risk, Stance, ClauseSegment, ClauseSnapshotItem, PlaybookSnapshot } from '#shared/types/contract'
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
    clauses: ClauseSnapshotItem[],
    segments: ClauseSegment[],
    paragraphs: string[],
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

    // Bug 修复：clauseIndex（segmentClauses 产出的"条款序号"）≠ anchorParagraphIndex
    // （commentInjector / parseWordComments 使用的"非空段落序号"）。
    // 先构造 clauseIndex → 非空段落序号 的映射：segment.offsetStart 落在哪一段，
    // 该条款就归属哪一段。docxText 是 paragraphs.join('\n')，所以累加段落长度
    // + 1 (for '\n') 就能找到对应段落序号。
    const clauseIndexToParagraphIndex = buildClauseToParagraphMap(segments, paragraphs)

    // 写 ContractRisk + ContractAnnotation（每条 AI 风险各一条）
    // CORE-R2：风险落库收口到 persistAiRisksAsContractRows，annotation 由调用方按需创建
    const riskRows: PersistAiRiskRow[] = risks.map(aiRisk => ({
        risk: aiRisk,
        anchorParagraphIndex: clauseIndexToParagraphIndex.get(aiRisk.clauseIndex) ?? null,
    }))
    const createdRisks = await persistAiRisksAsContractRows({ reviewId, rows: riskRows })
    for (let i = 0; i < createdRisks.length; i++) {
        await createContractAnnotationDAO({
            reviewId,
            riskId: createdRisks[i]!.id,
            authorType: 'ai',
            authorName: 'AI',
            content: renderRiskAsAnnotationText(risks[i]!),
        })
    }

    // 创建 v1 initial_upload 快照（显式传 docxText + clauses）
    await saveContractReviewVersionService({
        reviewId,
        systemLabel: 'initial_upload',
        createdById: userId,
        docxText,
        clauses,
    })
    logger.info('persistRisksAndCreateV1Snapshot: v1 快照已创建', { reviewId, risksCount: risks.length })
}

// buildClauseToParagraphMap 已抽到 utils/clauseToParagraph.ts，
// uploadClientVersion Step 4 也复用同一份映射逻辑（DOCX-C1/C2 修复）。

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
    /** 阶段 4 新增：平台注入的节点配置，存在时跳过自加载 */
    platformNodeConfig?: NodeConfig
    /** 阶段 4 新增：平台注入的 emitter，存在时由 emitContractReviewEvent 优先使用 */
    platformEmitCustomEvent?: CustomEventEmitter
    /**
     * 阶段 5 新增：跳过 stance interrupt 直接走 resume 分支。
     *
     * 法律助手 `review_contract` 子代理工具调用本函数前，已在工具内部完成
     * "立场选择 interrupt + 落库 stance/partyA/partyB" 的工作；此时调用方
     * 传 `skipStanceInterrupt: true`，本函数从 review 表读取已落库的立场，
     * 直接走 resume 分支（不再创建 createAgent / 不再 invoke parseAndAskStance）。
     *
     * default false：合同 vertical 自身页面 + `/stance` 端点走原 command 路径，向后兼容。
     */
    skipStanceInterrupt?: boolean
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

/** 单合同条款分析的并发上限：保守取 8，对 DeepSeek/Anthropic API 友好且单合同 30 条款 4 轮搞定。 */
const ANALYZE_CONCURRENCY = 8

/**
 * 按条款并发分析，每条完成时发 progress / risk 事件。
 *
 * 独立 export 便于单测，不依赖 agent.stream。
 *
 * - 每条成功：若有风险则 risks.push + 发 risk 事件
 * - 每条失败：warnings.push + 发 progress.error（继续处理其余条款）
 * - 结束时：发 analyze:done（含 warnings 若非空）
 *
 * 并发说明：
 * - pLimit(8) 控制同时在飞的 analyzeSingleClause 上限；30 条款典型耗时从 4 分钟 → 30-40 秒
 * - progress 事件按"完成顺序"而非"条款顺序"发出，前端 analyzingClauseIndex 会跳跃但功能正确
 *   （error toast 仍然准确：current=seg.index 指向真实失败的条款编号）
 * - risks/warnings push 在 JS 单线程下天然安全，无需锁
 */
export async function runAnalyzeLoop(ctx: AnalyzeLoopContext): Promise<{ risks: Risk[]; warnings: string[] }> {
    const risks: Risk[] = []
    const warnings: string[] = []
    const total = ctx.segments.length

    await emitContractReviewEvent(ctx.emitterCtx, {
        type: 'stage', stage: 'analyze', status: 'running',
    })

    const limit = pLimit(ANALYZE_CONCURRENCY)
    await Promise.all(ctx.segments.map(seg => limit(async () => {
        try {
            const risk = await analyzeSingleClause({
                clause: seg,
                stance: ctx.stance,
                partyA: ctx.partyA,
                partyB: ctx.partyB,
                contractType: ctx.contractType,
                playbookSnapshot: ctx.playbookSnapshot,
            })
            await emitContractReviewEvent(ctx.emitterCtx, {
                type: 'progress', current: seg.index, total,
            })
            if (risk) {
                risks.push(risk)
                await emitContractReviewEvent(ctx.emitterCtx, { type: 'risk', risk })
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            warnings.push(`第 ${seg.index} 条：${msg}`)
            await emitContractReviewEvent(ctx.emitterCtx, {
                type: 'progress', current: seg.index, total, error: msg,
            })
        }
    })))

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
    const { userId, runId = '', signal, command, skipStanceInterrupt = false } = options

    // 1. 并发加载基础设施 + 反查 review
    //    阶段 4：nodeConfig 优先用平台注入，未注入时向后兼容自加载
    const [checkpointer, store, nodeConfig, review] = await Promise.all([
        getCheckpointer(),
        getStore(),
        options.platformNodeConfig
            ? Promise.resolve(options.platformNodeConfig)
            : getValidNodeConfig(CONTRACT_MAIN_NODE_NAME, '合同审查主Agent'),
        findContractReviewBySessionIdDAO(sessionId),
    ])

    if (!review) {
        throw new Error(`No contract review found for session ${sessionId}`)
    }

    // M6.1：构造 emitter 上下文，供后续所有 SSE 事件调用复用
    // 阶段 4：透传平台 emitter；emitContractReviewEvent 内部优先用 platformEmit
    const emitterCtx: ContractReviewEmitterCtx = {
        runId,
        sessionId,
        platformEmit: options.platformEmitCustomEvent,
    }

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

    // 4. 构建 5 段式系统提示词（合同审查 caseId 可空：独立审查场景传 null）
    const roleAndFlowTemplate = renderSystemPrompt(nodeConfig, {
        reviewId: review.id,
        contractType: review.contractType ?? undefined,
    })
    const { systemMessage, plainText: systemPromptPlainText } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        {
            caseId: review.caseId ?? null,
            agentName: CONTRACT_MAIN_NODE_NAME,
            userQuery: buildInitialPrompt(review.id),
            roleAndFlowTemplate,
        },
    )

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
                systemPrompt: systemPromptPlainText,
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
        ...(review.caseId
            ? [{
                middleware: afterAgentMemoryMiddleware({
                    caseId: review.caseId,
                    sessionId,
                    userId,
                }),
                priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
                name: 'afterAgentMemory',
            }]
            : []),
        {
            middleware: createAuditMiddleware(),
            priority: MIDDLEWARE_PRIORITY.AUDIT,
            name: MIDDLEWARE_NAMES.AUDIT,
        },
    ])

    // 8. 组装 Agent（首轮使用，resume 分支绕过此 agent）
    const agent: ReactAgent = createAgent({
        model,
        systemPrompt: systemMessage,
        checkpointer,
        store,
        tools,
        middleware,
    })

    // M6.1 子期 1：在 agent 启动前预切分条款并发 segment 事件
    // 首轮和 resume 均执行（resume 时 segments 是 runAnalyzeLoop 的输入）
    let segments: ClauseSegment[] = []
    // normalizedText：\r\n 已折为 \n 的归一化全文，与 segments 的 offset 同空间。
    // Phase A v1 快照写入 snapshot.docxText 时用此值，保证 Phase B diff 时
    // docxText.slice(offsetStart, offsetEnd) 能精确还原 segment.text
    let normalizedText = ''
    // paragraphs：非空段落数组（parseContractDocx 产出），用于把 segment.offsetStart
    // 映射到 commentInjector 使用的"非空段落序号"空间。
    let paragraphs: string[] = []
    try {
        await emitContractReviewEvent(emitterCtx, {
            type: 'stage', stage: 'segment', status: 'running',
        })
        const loaded = await loadContractFullText(review.originalFileId)
        paragraphs = loaded.paragraphs
        const segmentResult = await segmentClauses(loaded.fullText)
        segments = segmentResult.segments
        normalizedText = segmentResult.normalizedText
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
    //
    // 触发条件（任一即进 resume 分支）：
    //   A. command 存在：合同 vertical 自身的 /stance 端点 enqueue resume run（向后兼容）
    //   B. skipStanceInterrupt && review.stance：法律助手 review_contract 子代理工具
    //      在工具内部已完成 stance 选择 interrupt + 落库，调本函数时直接跳过 stance 流程
    //      （DOCX-S5 子代理工具走 skipStanceInterrupt 路径）
    const shouldRunResumeBranch = !!command || (skipStanceInterrupt && !!review.stance)
    if (shouldRunResumeBranch) {
        return new ReadableStream<Uint8Array>({
            async start(controller) {
                try {
                    // 来源 1（command 路径）：payload 含用户刚提交的 stance/partyA/partyB
                    // 来源 2（skipStanceInterrupt 路径）：command 不存在，走 review 已落库字段
                    // 两路统一：读 command 优先，缺字段时 fallback 到 review.* （DOCX-S5）
                    const payload = (command ?? {}) as { stance?: unknown; partyA?: unknown; partyB?: unknown }
                    const stance = (payload.stance ?? review.stance ?? 'neutral') as Stance
                    const finalPartyA = typeof payload.partyA === 'string'
                        ? payload.partyA
                        : review.partyA
                    const finalPartyB = typeof payload.partyB === 'string'
                        ? payload.partyB
                        : review.partyB

                    // 写 stance 到 DB（parseAndAskStance 工具不再执行，由此处代劳）
                    await updateContractReviewDAO(review.id, {
                        stance,
                        partyA: finalPartyA,
                        partyB: finalPartyB,
                        status: 'reviewing',
                    })

                    // CORE-H4：用户在 stance interrupt 后刷新页面，agent.stream 不会重跑，
                    // 前端 SSE 状态机的 detect / stance 阶段如果首轮已发完（已落库），刷新后
                    // 走 mountReview 回填没问题；但首轮 SSE 中途断流的极端场景下，detect
                    // running/done 与 stance running 都会丢。这里在 resume 入口补发一次
                    // detect:running + detect:done（partyA/B/contractType 已在 DB） + stance:running，
                    // 让前端 5 段进度条都能拿到完整事件序列。emitter 自身幂等（前端按 stageStatus
                    // 覆盖最新 done 即可）。
                    await emitContractReviewEvent(emitterCtx, {
                        type: 'stage', stage: 'detect', status: 'running',
                    })
                    await emitContractReviewEvent(emitterCtx, {
                        type: 'stage', stage: 'detect', status: 'done',
                        ...(finalPartyA ? { partyA: finalPartyA } : {}),
                        ...(finalPartyB ? { partyB: finalPartyB } : {}),
                        ...(review.contractType ? { contractType: review.contractType } : {}),
                    })
                    await emitContractReviewEvent(emitterCtx, {
                        type: 'stage', stage: 'stance', status: 'running',
                    })

                    // 发 stance:done（parseAndAskStance 工具在 resume 路径不执行，由此处代劳）
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
                        // UX-S1：补发 summarize 的 running + done，否则前端 5 段进度条
                        // 的 allDone 永远不为真（summarize 段永远停在 wait），用户只能
                        // 靠刷新页面自愈（review.status=failed 时前端从状态机回填）。
                        await emitContractReviewEvent(emitterCtx, { type: 'stage', stage: 'summarize', status: 'running' })
                        await emitContractReviewEvent(emitterCtx, { type: 'stage', stage: 'summarize', status: 'done' })
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
                    let snapshotOk = true
                    try {
                        const clausesForSnapshot = segments.map(s => ({
                            index: s.index,
                            text: s.text,
                            offsetStart: s.offsetStart,
                            offsetEnd: s.offsetEnd,
                        }))
                        await persistRisksAndCreateV1Snapshot(
                            review.id,
                            userId,
                            risks,
                            normalizedText,
                            clausesForSnapshot,
                            segments,
                            paragraphs,
                        )
                    } catch (err) {
                        // v1 快照写入失败：后续 rebuild-docx / 版本时间线都依赖 ContractRisk + 快照，
                        // 不能在缺失这两者的情况下置 completed 误导用户"审查成功"。直接置 failed，
                        // 跳过 runAnnotateAndUpload（summarize:done 已在上方发完）。
                        logger.error('persistRisksAndCreateV1Snapshot 失败，置 failed', { reviewId: review.id, err })
                        snapshotOk = false
                        await updateContractReviewDAO(review.id, { status: 'failed' })
                    }

                    // 注入批注 + 上传 OSS + 置 completed（仅当 v1 快照成功才继续）
                    if (snapshotOk) {
                        try {
                            await runAnnotateAndUpload(review.id)
                        } catch (err) {
                            logger.error('runContractReviewChat: 批注/上传失败', { reviewId: review.id, err })
                            await updateContractReviewDAO(review.id, { status: 'failed' })
                        }
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
