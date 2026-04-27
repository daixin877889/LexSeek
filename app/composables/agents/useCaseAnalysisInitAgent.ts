/**
 * 案件初分分析 - 薄包装（阶段 7 重写）
 *
 * 替代 useInitAnalysis 的 stream 部分。case_analysis_init scope + 单 session（sessionId 由路由 URL 提供）。
 *
 * 注意：useInitAnalysisRuntime 提供更复杂的初分流程编排（phase / 多模块状态机），
 * 调用方页面可继续 import useInitAnalysisRuntime 取业务能力，本薄包装只负责"对话/流"层。
 * Step 4 调用方迁移时可视情况是否仅用本薄包装、或继续用 runtime + 本薄包装组合。
 *
 * 用法：
 *   const sessionId = ref<string>(route.params.sessionId)
 *   const agent = useCaseAnalysisInitAgent(caseId, sessionId)
 */

import type { Ref } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export function useCaseAnalysisInitAgent(caseId: Ref<number>, sessionId: Ref<string>) {
    const userStore = useUserStore()

    return useDomainAgentSession({
        scope: 'case_analysis_init',
        sessionId,  // 接受 Ref<string>，单 session 模式
        userId: String(userStore.userInfo.id ?? ''),
        caseId: caseId.value,
    })
}
