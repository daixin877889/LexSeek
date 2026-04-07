/**
 * 初始化分析服务层
 *
 * 提供初始化分析的业务逻辑，包括模块验证排序、状态查询、已完成结果加载
 */

import { VALID_MODULE_NAMES, INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import type { InitAnalysisStatusResponse } from '#shared/types/initAnalysis'

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
 */
export const getInitAnalysisStatusService = async (
    caseId: number,
    userId: number,
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

    // 获取所有会话的分析结果
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

    const type2Session = sessions.find(s => s.type === 2)
    const primarySession = type2Session ?? sessions[0]!
    const sessionStatus = primarySession.status === 1 ? 'in_progress' as const
        : primarySession.status === 2 ? 'completed' as const
            : 'failed' as const

    // 获取已完成模块的结果（包括 type=2 和 type=3 的会话）
    const result: Record<string, string> = {}
    for (const analysis of analyses) {
        if (analysis.status === 2 && analysis.analysisResult) {
            // isActive 版本优先，否则用最新版
            const existing = result[analysis.analysisType]
            if (!existing || analysis.isActive) {
                result[analysis.analysisType] = analysis.analysisResult
            }
        }
    }

    // 检查是否有待处理的 interrupt（INTERRUPTED 状态的 run）
    const interruptedRun = await prisma.agentRuns.findFirst({
        where: { sessionId: type2Session?.sessionId, status: 'interrupted' },
    })

    // 从 type=2 session metadata 恢复用户原始选中的模块列表
    const sessionMetadata = (type2Session?.metadata ?? sessions[0]!.metadata) as { selectedModules?: string[] } | null
    const selectedModules = sessionMetadata?.selectedModules

    return {
        status: sessionStatus,
        sessionId: primarySession.sessionId,
        selectedModules,
        modules,
        result,
        hasPendingInterrupt: !!interruptedRun,
    }
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
