/**
 * 案件初分分析 - 薄包装
 *
 * 替代 useInitAnalysis：基于 useDomainAgentSession 工厂的轻薄包装
 * 为初分流程提供对话入口
 */

import type { Ref } from 'vue'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export function useCaseAnalysisInitAgent(caseId: Ref<number>, sessionId: Ref<string | null>) {
  const userId = 'current'
  const validSessionId = computed(() => sessionId.value ?? `init-analysis-${caseId.value}-${Date.now()}`)

  return useDomainAgentSession({
    scope: 'case_analysis_init',
    sessionId: validSessionId.value,
    userId,
    caseId: caseId.value,
  })
}
