/**
 * 初始化分析服务层
 *
 * 提供初始化分析的业务逻辑，包括模块验证排序、状态查询、已完成结果加载
 */

import crypto from 'node:crypto'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { VALID_MODULE_NAMES, INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import type { InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import { isCaseReadOnly } from '#shared/types/case'
import { generateSummaryService } from '../ai/summaryService'
import { addDocumentsToVectorStore } from '../legal/vectorStore.service'

/**
 * 验证并排序选中的模块
 * 确保模块名合法，并按固定顺序排列
 */
export const validateAndSortModules = (selectedModules: string[]): string[] => {
    if (!selectedModules.length) {
        throw new Error('请至少选择一个分析模块')
    }

    const unique = [...new Set(selectedModules)]
    const invalid = unique.filter(m => !VALID_MODULE_NAMES.includes(m))
    if (invalid.length) {
        throw new Error(`无效的分析模块: ${invalid.join(', ')}`)
    }

    // 按固定顺序排列
    return VALID_MODULE_NAMES.filter(m => unique.includes(m))
}

/**
 * 获取案件的初始化分析状态
 *
 * @param sessionId 可选，指定查询特定 session 的状态。
 *   传入时：status/selectedModules/hasPendingInterrupt 精确对应该 session。
 *   不传时：使用最新的 type=2 session（案件详情页场景）。
 *   modules/result 始终是跨 session 的全局聚合结果。
 */
export const getInitAnalysisStatusService = async (
    caseId: number,
    userId: number,
    sessionId?: string,
): Promise<InitAnalysisStatusResponse> => {
    // 验证案件权限
    const caseRecord = await prisma.cases.findFirst({
        where: { id: caseId, userId, deletedAt: null },
    })
    if (!caseRecord) {
        throw new Error('案件不存在')
    }

    // 获取 type=2（初始分析）和 type=3（模块对话）的会话
    const sessions = await prisma.caseSessions.findMany({
        where: { caseId, type: { in: [2, 3] }, deletedAt: null },
        orderBy: { createdAt: 'desc' },
    })

    if (sessions.length === 0) {
        return { status: 'not_started', modules: [] }
    }

    const sessionIds = sessions.map(s => s.sessionId)

    // 获取所有会话的分析结果（跨 session 全局聚合）
    const analyses = await prisma.caseAnalyses.findMany({
        where: { sessionId: { in: sessionIds }, deletedAt: null },
        orderBy: { createdAt: 'asc' },
    })

    const modules = INIT_ANALYSIS_MODULES.map(m => {
        // 优先使用 isActive 版本（来自任意会话）
        const activeAnalysis = analyses.find(a => a.analysisType === m.name && a.isActive)
        // fallback 到最新版本
        const latestAnalysis = analyses
            .filter(a => a.analysisType === m.name)
            .sort((a, b) => b.version - a.version)[0]
        const analysis = activeAnalysis || latestAnalysis
        return {
            name: m.name,
            status: !analysis ? 'idle' as const
                : analysis.status === 2 ? 'complete' as const
                    : analysis.status === 3 ? 'failed' as const
                        : analysis.status === 1 ? 'in_progress' as const
                            : 'idle' as const,
            result: analysis?.analysisResult ?? undefined,
            version: analysis?.version ?? undefined,
            analyzedAt: analysis?.createdAt?.toISOString() ?? undefined,
        }
    })

    // 确定 primarySession：指定 sessionId 时精确匹配，否则使用最新 type=2
    let primarySession
    if (sessionId) {
        primarySession = sessions.find(s => s.sessionId === sessionId && s.type === 2)
        if (!primarySession) {
            // sessionId 不匹配任何 type=2 session（可能是 type=1 主会话），回退到最新 type=2
            primarySession = sessions.find(s => s.type === 2)
            if (!primarySession) {
                return { status: 'not_started', sessionId, modules, result: buildResultMap(analyses), hasPendingInterrupt: false }
            }
        }
    } else {
        const type2Session = sessions.find(s => s.type === 2)
        if (!type2Session) {
            // 案件没走过初始化分析（无 type=2 session），但可能在模块对话（type=3）
            // 里通过 save_analysis_result 工具直接生成了部分模块结果。
            // 这种情况下不能把 type=3 模块对话当作 init-analysis 的 primarySession——
            // 模块对话 session 永远 status=1 且 metadata 没有 selectedModules，
            // 会让自动修复条件失效，接口永远返回 in_progress，进而把"批量分析"按钮锁死。
            const hasAnyComplete = modules.some(m => m.status === 'complete')
            return {
                status: hasAnyComplete ? 'completed' : 'not_started',
                modules,
                result: buildResultMap(analyses),
                hasPendingInterrupt: false,
            }
        }
        primarySession = type2Session
    }

    // 检查是否有待处理的 interrupt（INTERRUPTED 状态的 run）
    const interruptedRun = await prisma.agentRuns.findFirst({
        where: { sessionId: primarySession.sessionId, status: 'interrupted' },
    })

    // 检查是否有活跃的 run（PENDING/RUNNING）
    const activeRun = await prisma.agentRuns.findFirst({
        where: { sessionId: primarySession.sessionId, status: { in: ['pending', 'running'] } },
    })

    // 检查 primarySession 是否有任何 run（用于 not_started 判断）
    const anyRun = await prisma.agentRuns.findFirst({
        where: { sessionId: primarySession.sessionId },
        select: { id: true },
    })

    // 从 primarySession metadata 恢复用户原始选中的模块列表
    const sessionMetadata = primarySession.metadata as { selectedModules?: string[] } | null
    const selectedModules = sessionMetadata?.selectedModules

    // 获取已完成模块的结果（跨 session 全局聚合）
    const result = buildResultMap(analyses)

    // 如果 primarySession 从未有 run（刚通过 init-session API 创建的空 session）
    // 返回 not_started 让前端展示 ModuleSelector，同时仍然返回其他 session 累积的 modules/result
    if (!anyRun && primarySession.status === 1) {
        return {
            status: 'not_started',
            sessionId: primarySession.sessionId,
            modules,
            result,
            hasPendingInterrupt: false,
        }
    }

    // 防御性状态修正：如果 session.status=1 但无活跃 run 且无 interrupt，
    // 检查 selectedModules 是否全部到达终态（complete 或 failed），如果是则修正为 completed
    let sessionStatus = primarySession.status === 1 ? 'in_progress' as const
        : primarySession.status === 2 ? 'completed' as const
            : 'failed' as const

    if (sessionStatus === 'in_progress' && !activeRun && !interruptedRun && selectedModules?.length) {
        const allSelectedSettled = selectedModules.every(name => {
            const m = modules.find(mo => mo.name === name)
            return m?.status === 'complete' || m?.status === 'failed'
        })
        if (allSelectedSettled) {
            // 自动修复 session 状态
            await prisma.caseSessions.update({
                where: { sessionId: primarySession.sessionId },
                data: { status: 2 },
            })
            sessionStatus = 'completed'
            logger.info(`[initAnalysis] 自动修复 session ${primarySession.sessionId} 状态为 completed`)
        }
    }

    return {
        status: sessionStatus,
        sessionId: primarySession.sessionId,
        selectedModules,
        modules,
        result,
        hasPendingInterrupt: !!interruptedRun,
    }
}

/** 从 analyses 构建已完成结果 map（isActive 优先） */
function buildResultMap(analyses: Array<{ analysisType: string; status: number; analysisResult: string | null; isActive: boolean }>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const analysis of analyses) {
        if (analysis.status === 2 && analysis.analysisResult) {
            const existing = result[analysis.analysisType]
            if (!existing || analysis.isActive) {
                result[analysis.analysisType] = analysis.analysisResult
            }
        }
    }
    return result
}

/**
 * 从已有的 caseAnalyses 加载已完成模块的结果
 * 用于重试失败模块时注入上下文
 */
export const loadCompletedResultsService = async (
    caseId: number,
): Promise<Record<string, string>> => {
    // 优先使用 isActive 版本
    const activeAnalyses = await prisma.caseAnalyses.findMany({
        where: { caseId, status: 2, isActive: true, deletedAt: null },
    })

    // fallback：如果没有 isActive 的记录，使用旧逻辑（兼容过渡期）
    const analyses = activeAnalyses.length > 0
        ? activeAnalyses
        : await prisma.caseAnalyses.findMany({
            where: { caseId, status: 2, deletedAt: null },
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
            distinct: ['analysisType'],
        })

    const results: Record<string, string> = {}
    for (const a of analyses) {
        if (a.analysisResult) {
            results[a.analysisType] = a.analysisResult
        }
    }
    return results
}

/** SSE 重连短路路径支持的终态 run 状态 */
export type TerminalRunStatusForSSE = 'completed' | 'failed' | 'cancelled'

/**
 * 判断 run 状态是否可以走 SSE 短路路径（跳过 Redis Stream 全量 replay）
 *
 * 可短路：completed/failed/cancelled —— 这些 run 已终结，不会再有新事件，
 *   checkpoint 里已包含最终 state，直接发一条 values + 一条 status_change 即可。
 *
 * 不可短路：
 * - interrupted：`__interrupt__` 字段只存在于 Redis Stream 最后一条 values 事件中
 *   （LangGraph 的 `mapOutputValues` 不会写进 checkpoint.channel_values），
 *   短路会丢失恢复对话所需的 interrupt 信息。
 * - running/pending：需继续订阅 pubsub 接收后续实时事件，不能立即关闭 SSE。
 * - 未知/缺失状态：保守拒绝短路，走原 replay 路径。
 */
export function canShortCircuitSSE(
    runStatus: string | null | undefined,
): boolean {
    return runStatus === 'completed'
        || runStatus === 'failed'
        || runStatus === 'cancelled'
}

/**
 * 构造短路路径要发送的 SSE 事件字符串
 *
 * 输出顺序与当前 createSSEResponse fallback 分支完全一致：
 * 1. （可选）一条 `event: values` —— 仅当 checkpoint 有 messages 时
 * 2. 一条 `event: custom` status_change —— 必发
 *
 * 前端 useStreamChat 的 onCustomEvent 只关心 type/status/error，
 * 发出的报文结构与原 Redis Stream replay 路径兼容。
 *
 * 仅 `failed` 状态在有 errorMessage 时附加 `error` 字段（修复历史 bug：
 * 原 fallback 分支始终不带 error，导致前端展示泛化的"执行失败"文案）。
 */
export function buildTerminalSnapshotEvents(params: {
    runId: string
    runStatus: TerminalRunStatusForSSE
    checkpointValues: Record<string, unknown> | null
    errorMessage?: string | null
}): string[] {
    const events: string[] = []

    const messages = params.checkpointValues
        ? (params.checkpointValues.messages as unknown[] | undefined)
        : undefined
    if (params.checkpointValues && Array.isArray(messages) && messages.length > 0) {
        events.push(
            `event: values\ndata: ${JSON.stringify(params.checkpointValues)}\n\n`,
        )
    }

    const statusPayload: Record<string, unknown> = {
        type: 'status_change',
        runId: params.runId,
        status: params.runStatus,
    }
    if (params.runStatus === 'failed' && params.errorMessage) {
        statusPayload.error = params.errorMessage
    }
    events.push(`event: custom\ndata: ${JSON.stringify(statusPayload)}\n\n`)

    return events
}

// ==================== M4: RAG 落库入口 ====================

export interface CompleteAnalysisWithRAGInput {
    analysisId: number
    analysisResult: string
    model: BaseChatModel
}

/**
 * 模块分析完成的落库入口（含 M4 RAG 流程）。
 *
 * 事务边界：
 *   Stage 1（主分析 + summary）事务内 - 保证原子性
 *   Stage 2（embedding 切块写入）事务外 - 失败不回滚主分析，只降级 RAG 检索能力
 */
export async function completeAnalysisWithRAG(input: CompleteAnalysisWithRAGInput): Promise<void> {
    const { analysisId, analysisResult, model } = input

    // 事务外先查 existing（只读），不占用事务连接
    const existing = await prisma.caseAnalyses.findUnique({
        where: { id: analysisId },
        select: {
            id: true,
            caseId: true,
            nodeId: true,
            analysisType: true,
            version: true,
            case: { select: { status: true } },
        },
    })
    if (!existing) throw new Error(`caseAnalyses #${analysisId} not found`)

    // ARCHIVED 只读守卫（spec §1.4 / §12 铁律）
    if (existing.case && isCaseReadOnly(existing.case.status)) {
        throw new Error('案件已归档，不可启动分析')
    }

    // LLM 调用在事务外：网络 IO 不受事务超时约束，LLM 慢不会拖垮主分析落库
    const summary = await generateSummaryService(model, analysisResult, {
        maxChars: 400,
        systemPrompt: '你是法律助手。对下方分析报告正文生成 200-400 字的中文专业摘要，保留关键事实、结论、依据，不加开场白总结语。',
    })

    // Stage 1: 主分析 + summary（事务内；只做 DB 写入，无网络 IO）
    const analysis = await prisma.$transaction(async (tx) => {
        const updated = await tx.caseAnalyses.update({
            where: { id: analysisId },
            data: {
                status: 2,
                analysisResult,
                summary,
                isActive: true,
            },
        })

        // 同 nodeId 的其它版本 isActive=false
        await tx.caseAnalyses.updateMany({
            where: {
                caseId: updated.caseId,
                nodeId: updated.nodeId,
                id: { not: updated.id },
            },
            data: { isActive: false },
        })

        return updated
    }, { timeout: 5_000 })

    // Stage 2: embedding 切块写入（事务外，失败只 warn）
    try {
        const chunks = splitByParagraph(analysisResult, 500)
        const ids = chunks.map(() => crypto.randomUUID())
        const docs = chunks.map((chunk, i) => ({
            pageContent: chunk,
            metadata: {
                id: ids[i],
                caseId: analysis.caseId,
                analysisId: analysis.id,
                nodeId: analysis.nodeId,
                analysisType: analysis.analysisType,
                version: analysis.version,
                isActive: true,
                chunkIndex: i,
            },
        }))

        await addDocumentsToVectorStore(docs, ids, { tableName: 'case_analysis_embeddings' })

        // 手工回填 tsv（addDocuments 不会写 tsv 列）
        await prisma.$executeRawUnsafe(
            `UPDATE case_analysis_embeddings
             SET tsv = to_tsvector('chinese', COALESCE(text, ''))
             WHERE id = ANY($1::uuid[]) AND tsv IS NULL`,
            ids,
        )

        // 同步老版本 metadata.isActive=false
        await prisma.$executeRawUnsafe(
            `UPDATE case_analysis_embeddings
             SET metadata = jsonb_set(metadata, '{isActive}', to_jsonb(false))
             WHERE metadata->>'caseId' = $1
               AND metadata->>'nodeId' = $2
               AND metadata->>'analysisId' <> $3`,
            String(analysis.caseId),
            String(analysis.nodeId),
            String(analysis.id),
        )
    } catch (e) {
        logger.warn(
            'case_analysis_embeddings 写入失败，主分析已 commit；RAG 检索暂不可用',
            { analysisId, error: e },
        )
    }
}

/** 按段落切块（\n\n 分隔，每块最多 maxChars 字符） */
function splitByParagraph(text: string, maxChars: number): string[] {
    const paras = text.split(/\n\n+/).filter((p) => p.trim())
    const chunks: string[] = []
    let current = ''
    for (const p of paras) {
        if ((current + p).length > maxChars) {
            if (current) chunks.push(current)
            current = p
        } else {
            current = current ? `${current}\n\n${p}` : p
        }
    }
    if (current) chunks.push(current)
    return chunks
}
