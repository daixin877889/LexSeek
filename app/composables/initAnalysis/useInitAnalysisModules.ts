/**
 * 初分模块状态计算 - 子 composable（阶段 7 拆分自 useInitAnalysis）
 *
 * 范围：纯工具函数 pickFirstSelectedModule + computeModuleStatesFromSnapshot
 *
 * 这两个函数 useInitAnalysisRuntime 也会用，故下沉到 initAnalysis/ 目录避免反向依赖。
 */

import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState, InitAnalysisStatusResponse } from '#shared/types/initAnalysis'

/**
 * 全局状态快照（与 useInitAnalysisProjection 的 ProjectionDeps 三段对齐）
 * - completedModules：用于 ModuleSelector 禁用已完成项
 * - statusModules：projection 在 localStates 没值时回退依据
 * - resultFromDB：mergedResult 与 projection 拼出 complete 卡片内容的来源
 */
export interface GlobalStatusSnapshot {
    completedModules: string[]
    statusModules: InitAnalysisStatusResponse['modules']
    resultFromDB: Record<string, string>
}

/**
 * 把 init-analysis-status 接口返回的 status 拆解为 projection 依赖的三段快照
 *
 * 修复背景：runtime.loadStatus 之前只把 status.modules.complete 提取到 completedModules，
 * 没把 modules / result 推给 page 层的 statusModules / resultFromDB，
 * 导致首次进入页面时 projection 看不到 DB 已完成的模块，错误地全部落到 idle（"未生成"）。
 */
export function extractGlobalStatusSnapshot(
    status: InitAnalysisStatusResponse,
): GlobalStatusSnapshot {
    const modules = status.modules ?? []
    return {
        completedModules: modules.filter(m => m.status === 'complete').map(m => m.name),
        statusModules: modules,
        resultFromDB: status.result ?? {},
    }
}

/** 从用户已选模块列表中按 INIT_ANALYSIS_MODULES 排序取第一个 */
export function pickFirstSelectedModule(
    selectedModules: string[],
): string | undefined {
    return INIT_ANALYSIS_MODULES
        .map(m => m.name)
        .find(name => selectedModules.includes(name))
}

/**
 * 把 result / failedModules / prev 三态合并成 ModuleRunState 表
 * + 找出当前 streaming 的模块（非 complete / 非 failed 中的第一个）并标记
 */
export function computeModuleStatesFromSnapshot(
    selectedModules: string[],
    result: Record<string, string | undefined> | undefined,
    failedModules: Record<string, string | undefined> | undefined,
    prev: Record<string, ModuleRunState>,
): Record<string, ModuleRunState> {
    const next: Record<string, ModuleRunState> = {}
    for (const m of selectedModules) {
        if (result?.[m]) {
            next[m] = { name: m, status: 'complete', content: result[m] as string }
        } else if (failedModules?.[m]) {
            next[m] = { name: m, status: 'failed', content: '', error: failedModules[m] as string }
        } else if (prev[m]?.status === 'complete' || prev[m]?.status === 'failed') {
            next[m] = prev[m]!
        } else {
            next[m] = { name: m, status: 'idle', content: '' }
        }
    }
    const currentStreaming = selectedModules.find(m =>
        next[m]!.status !== 'complete' && next[m]!.status !== 'failed',
    )
    if (currentStreaming) {
        next[currentStreaming] = { name: currentStreaming, status: 'streaming', content: '' }
    }
    return next
}
