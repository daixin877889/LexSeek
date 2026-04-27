/**
 * 文书生成 - 薄包装（阶段 7 重写）
 *
 * 替代 useDocumentDraft 的 stream 部分。draftId 模式驱动单 session 工厂。
 * 业务方法（versions / snapshots / preview / fields）由调用方页面直接 import 4 个 sub-composable 自己组装。
 *
 * 用法：
 *   const sessionId = ref<string | null>(null)  // mountDraft 后写入
 *   const agent = useDocumentAgent(sessionId, { onCustomEvent, onStreamSettled })
 *   // mountDraft 拿到 sessionId 后：sessionId.value = r.sessionId; await agent.init()
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

    // 单 session 模式：把 Ref<string|null> 转成 Ref<string>（空字符串占位），
    // 工厂内 isSingleSessionMode 检查 sessionId !== 'auto'，空字符串也走单 session 路径。
    // 调用方在 mountDraft 拿到 sessionId 后写入 ref，工厂内 watch 触发 switchSession。
    const sessionIdRef = computed(() => sessionId.value ?? '')

    return useDomainAgentSession({
        scope: 'document',
        sessionId: sessionIdRef,  // Ref<string>，单 session 模式
        userId: String(userStore.userInfo.id ?? ''),
        onCustomEvent: options.onCustomEvent,
        onStreamSettled: options.onStreamSettled,
    })
}
