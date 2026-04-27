/**
 * 小索浮窗对话 - 薄包装（阶段 7 重写）
 *
 * 替代 useXiaosuoChat。case scope（caseId 必填）+ 多 session 模式。
 *
 * 用法：
 *   const xiaosuo = useCaseMainAgent(caseIdRef)
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
        sessionId: 'auto',  // 多 session：从后端列表自动选首个
        userId: String(userStore.userInfo.id ?? ''),
        caseId: caseIdValue,
    })
}
