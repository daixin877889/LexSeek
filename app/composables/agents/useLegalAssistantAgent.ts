/**
 * 法律助手对话 - 薄包装（阶段 7 重写）
 *
 * 替代 useAssistantChat。基于 useDomainAgentSession 工厂的多 session 配置。
 *
 * 用法：
 *   const sessionId = ref<string | null>(null)
 *   const chat = useLegalAssistantAgent(sessionId)
 */

import type { Ref } from 'vue'
import { useUserStore } from '~/store/user'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export function useLegalAssistantAgent(sessionId: Ref<string | null>) {
    const userStore = useUserStore()

    // 'auto' 模式：从后端 session 列表选首个；调用方传 ref(null) 即开启 auto；
    // 传 ref('some-id') 则锁定单 session 模式（remount 已弃用，改 switchSession）
    return useDomainAgentSession({
        scope: 'legal_assistant',
        sessionId: sessionId.value ?? 'auto',
        userId: String(userStore.userInfo.id ?? ''),
    })
}
