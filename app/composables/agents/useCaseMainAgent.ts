/**
 * 小索浮窗对话 - 薄包装（阶段 7 重写）
 *
 * 替代 useXiaosuoChat。case scope（caseId 必填）+ 多 session 模式。
 *
 * 用法：
 *   const xiaosuo = useCaseMainAgent(caseIdRef)
 */

import type { MaybeRef } from 'vue'
import { computed, toValue } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export interface CaseMainAgentOptions {
    /**
     * 子代理（ask_*_expert）跑完一次模块分析、analysisResultPersistenceMiddleware 落库后
     * 触发的回调。让 page 层 refreshAnalysis() 刷新前端"分析结果"列表卡片。
     */
    onAnalysisSaved?: () => void
}

/**
 * 从子流分桶 map 提取"正在跑中的模块名"列表（去重）。
 *
 * subThreadsMap 由 useStreamChat 维护，bucket.agentName 是子代理节点名
 * （NodeConfig.name），对 7 个分析专家而言直接等于 INIT_ANALYSIS_MODULES.name。
 * 提取出来供 [id].vue 合并到 module:generating 跨标签广播。
 *
 * 抽出来是为了让本逻辑可被纯函数级单测覆盖（无需 mock useDomainAgentSession）。
 */
export function extractRunningModulesFromBuckets(
    map: Record<string, { agentName?: string, status?: string } | undefined> | null | undefined,
): string[] {
    if (!map) return []
    const names = new Set<string>()
    for (const bucket of Object.values(map)) {
        if (bucket?.status === 'running' && typeof bucket.agentName === 'string' && bucket.agentName) {
            names.add(bucket.agentName)
        }
    }
    return Array.from(names)
}

export function useCaseMainAgent(caseId: MaybeRef<number>, options: CaseMainAgentOptions = {}) {
    const userStore = useUserStore()
    const caseIdValue = toValue(caseId)

    const session = useDomainAgentSession({
        scope: 'case',
        sessionId: 'auto',  // 多 session：从后端列表自动选首个
        userId: String(userStore.userInfo.id ?? ''),
        caseId: caseIdValue,
        // 监听子代理 ANALYSIS_RESULT_SAVED 事件触发列表刷新（与 useCaseModuleAgent 同款逻辑）
        onCustomEvent: (data) => {
            if (data && typeof data === 'object' && 'name' in data && (data as { name: string }).name === 'analysis_result_saved') {
                options.onAnalysisSaved?.()
            }
        },
    })

    /**
     * 小索调起 ask_*_expert 子代理跑模块分析时正在生成的模块名列表。
     *
     * subThreadsMap 由 useStreamChat 维护：每个 parentToolCallId 一个 reactive bucket，
     * bucket.agentName 即子代理节点名（NodeConfig.name），对 7 个分析专家而言直接就是
     * INIT_ANALYSIS_MODULES.name（'evidence' / 'cause' / 'claim' …）。
     *
     * 提取所有 status='running' 的 bucket 的 agentName 让 [id].vue 合并到模块对话路径
     * 一并广播 'module:generating'，覆盖"小索调起的分析"也跨标签同步生成中状态。
     */
    const generatingModules = computed<string[]>(
        () => extractRunningModulesFromBuckets(session.subThreadsMap as Record<string, { agentName?: string, status?: string }>),
    )

    return Object.assign(session, { generatingModules })
}
