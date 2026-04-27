/**
 * 合同审查对话 - 薄包装
 *
 * 替代 useContractReview：基于 useDomainAgentSession 工厂的轻薄包装
 * 为合同审查提供对话入口
 */

import type { Ref } from 'vue'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export function useContractAgent(sessionId: Ref<string | null>) {
  const userId = 'current'
  const validSessionId = computed(() => sessionId.value ?? `contract-${Date.now()}`)

  return useDomainAgentSession({
    scope: 'contract',
    sessionId: validSessionId.value,
    userId,
  })
}
