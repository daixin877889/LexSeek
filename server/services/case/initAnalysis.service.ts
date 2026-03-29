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

    // 查找初始化分析 session（type=2）
    const session = await prisma.caseSessions.findFirst({
        where: { caseId, type: 2, deletedAt: null },
        orderBy: { createdAt: 'desc' },
    })

    if (!session) {
        return { status: 'not_started', modules: [] }
    }

    // 获取分析结果
    const analyses = await prisma.caseAnalyses.findMany({
        where: { sessionId: session.sessionId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
    })

    const modules = INIT_ANALYSIS_MODULES.map(m => {
        const analysis = analyses.find(a => a.analysisType === m.name)
        return {
            name: m.name,
            status: !analysis ? 'idle' as const
                : analysis.status === 2 ? 'complete' as const
                    : analysis.status === 3 ? 'failed' as const
                        : 'idle' as const,
            result: analysis?.analysisResult ?? undefined,
        }
    })

    const sessionStatus = session.status === 1 ? 'in_progress' as const
        : session.status === 2 ? 'completed' as const
            : 'failed' as const

    // 获取已完成模块的结果
    const result: Record<string, string> = {}
    for (const analysis of analyses) {
        if (analysis.status === 2 && analysis.analysisResult) {
            result[analysis.analysisType] = analysis.analysisResult
        }
    }

    return {
        status: sessionStatus,
        sessionId: session.sessionId,
        modules,
        result,
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
