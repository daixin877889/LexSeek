/**
 * 法律助手对话 - 薄包装
 *
 * 替代 useAssistantChat：基于 useDomainAgentSession 工厂的轻薄包装
 * 为法律助手提供跨案件全局对话入口
 */

import type { Ref } from 'vue'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export function useLegalAssistantAgent(sessionId: Ref<string | null>) {
  const userId = 'current'
  const validSessionId = computed(() => sessionId.value ?? `assistant-${Date.now()}`)

  return useDomainAgentSession({
    scope: 'legal_assistant',
    sessionId: validSessionId.value,
    userId,
  })
}
