/**
 * 文书生成 - 薄包装（阶段 7 重写）
 *
 * 替代 useDocumentDraft。draftId 模式驱动单 session 工厂。
 * 业务方法（versions / snapshots / preview / fields）由调用方页面直接 import 4 个 sub-composable 自己组装。
 *
 * 用法：
 *   const draftId = ref<number | null>(null)
 *   const sessionId = ref<string | null>(null)
 *   const agent = useDocumentAgent(sessionId, { onStreamSettled: refetchDraft })
 *
 * 业务 sub-composable（调用方按需 import）：
 *   - useDocumentDraftFields
 *   - useDocumentDraftVersions
 *   - useDocumentDraftSnapshots
 *   - useDocumentDraftPreview
 */

import type { Ref } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export interface UseDocumentAgentOptions {
    onCustomEvent?: (data: unknown) => void
    onStreamSettled?: (status: 'completed' | 'failed') => void | Promise<void>
}

export function useDocumentAgent(sessionId: Ref<string | null>, options: UseDocumentAgentOptions = {}) {
    const userStore = useUserStore()

    return useDomainAgentSession({
        scope: 'document',
        sessionId: sessionId.value ?? 'auto',
        userId: String(userStore.userInfo.id ?? ''),
        onCustomEvent: options.onCustomEvent,
        onStreamSettled: options.onStreamSettled,
    })
}
