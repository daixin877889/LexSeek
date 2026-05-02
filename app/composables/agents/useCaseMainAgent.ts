/**
 * 小索浮窗对话 - 薄包装（阶段 7 重写）
 *
 * 替代 useXiaosuoChat。case scope（caseId 必填）+ 多 session 模式。
 *
 * 用法：
 *   const xiaosuo = useCaseMainAgent(caseIdRef)
 */

import type { MaybeRef } from 'vue'
import { toValue } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export interface CaseMainAgentOptions {
    /**
     * 子代理（ask_*_expert）跑完一次模块分析、analysisResultPersistenceMiddleware 落库后
     * 触发的回调。让 page 层 refreshAnalysis() 刷新前端"分析结果"列表卡片。
     */
    onAnalysisSaved?: () => void
}

export function useCaseMainAgent(caseId: MaybeRef<number>, options: CaseMainAgentOptions = {}) {
    const userStore = useUserStore()
    const caseIdValue = toValue(caseId)

    return useDomainAgentSession({
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
}
