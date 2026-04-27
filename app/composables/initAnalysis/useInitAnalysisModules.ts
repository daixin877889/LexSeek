/**
 * 初分模块状态计算 - 子 composable（阶段 7 拆分自 useInitAnalysis）
 *
 * 范围：纯工具函数 pickFirstSelectedModule + computeModuleStatesFromSnapshot
 *
 * 这两个函数 useInitAnalysisRuntime 也会用，故下沉到 initAnalysis/ 目录避免反向依赖。
 */

import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import type { ModuleRunState } from '#shared/types/initAnalysis'

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
