/**
 * 文书生成对话 - 薄包装
 *
 * 替代 useDocumentDraft：基于 useDomainAgentSession 工厂的轻薄包装
 */

import type { Ref } from 'vue'
import { computed } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export function useDocumentAgent(sessionId: Ref<string | null>) {
  const userStore = useUserStore()
  const validSessionId = computed(() => sessionId.value ?? `document-${Date.now()}`)

  return useDomainAgentSession({
    scope: 'document',
    sessionId: validSessionId.value,
    userId: String(userStore.userInfo.id ?? ''),
  })
}
