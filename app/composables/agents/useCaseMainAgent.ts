/**
 * 案件主体对话（小索）- 薄包装
 *
 * 替代 useXiaosuoChat：基于 useDomainAgentSession 工厂的轻薄包装
 */

import type { MaybeRef } from 'vue'
import { toValue } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export function useCaseMainAgent(caseId: MaybeRef<number>) {
  const userStore = useUserStore()
  const caseIdValue = toValue(caseId)

  return useDomainAgentSession({
    scope: 'case',
    sessionId: `xiaosuo-${caseIdValue}`,
    userId: String(userStore.userInfo.id ?? ''),
    caseId: caseIdValue,
  })
}
