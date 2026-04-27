/**
 * 案件初分分析 - 薄包装
 *
 * 替代 useInitAnalysis：基于 useDomainAgentSession 工厂的轻薄包装
 */

import type { Ref } from 'vue'
import { computed } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export function useCaseAnalysisInitAgent(caseId: Ref<number>, sessionId: Ref<string | null>) {
  const userStore = useUserStore()
  const validSessionId = computed(() => sessionId.value ?? `init-analysis-${caseId.value}-${Date.now()}`)

  return useDomainAgentSession({
    scope: 'case_analysis_init',
    sessionId: validSessionId.value,
    userId: String(userStore.userInfo.id ?? ''),
    caseId: caseId.value,
  })
}
