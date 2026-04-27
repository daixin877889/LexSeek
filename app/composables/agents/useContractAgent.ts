/**
 * 合同审查 - 薄包装（阶段 7 重写）
 *
 * 替代 useContractReview 的 stream/对话部分。reviewId 模式驱动单 session 工厂。
 * 业务方法（stages / risks-editing / lifecycle）由调用方页面直接 import 3 个 sub-composable 自己组装。
 *
 * 用法：
 *   const sessionId = ref<string | null>(null)  // mountReview 后写入
 *   const agent = useContractAgent(sessionId, {
 *     onCustomEvent: lifecycle.applyCustomEvent,
 *     onStreamSettled: lifecycle.refreshReview,
 *   })
 *
 * 业务 sub-composable（调用方按需 import）：
 *   - useContractReviewStages
 *   - useContractReviewRisksEditing
 *   - useContractReviewLifecycle
 */

import type { Ref } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export interface UseContractAgentOptions {
    onCustomEvent?: (data: unknown) => void
    onStreamSettled?: (status: 'completed' | 'failed') => void | Promise<void>
}

export function useContractAgent(sessionId: Ref<string | null>, options: UseContractAgentOptions = {}) {
    const userStore = useUserStore()

    // 单 session 模式：与 useDocumentAgent 同款（Ref<string|null> → Ref<string>，空占位）
    const sessionIdRef = computed(() => sessionId.value ?? '')

    return useDomainAgentSession({
        scope: 'contract',
        sessionId: sessionIdRef,  // Ref<string>，单 session 模式
        userId: String(userStore.userInfo.id ?? ''),
        onCustomEvent: options.onCustomEvent,
        onStreamSettled: options.onStreamSettled,
    })
}
