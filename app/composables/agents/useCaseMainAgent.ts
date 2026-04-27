/**
 * 案件主体对话（小索）- 薄包装
 *
 * 替代 useXiaosuoChat：基于 useDomainAgentSession 工厂的轻薄包装
 * 为小索浮窗提供多 session 管理入口
 */

import type { MaybeRef } from 'vue'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'

export function useCaseMainAgent(caseId: MaybeRef<number>) {
  const resolvedCaseId = toRef(caseId)
  const userId = 'current'  // 从认证上下文获取（实际应从 auth 状态获取）

  // 生成唯一 sessionId（如果未指定，使用 caseId）
  const sessionId = ref(`xiaosuo-${resolvedCaseId.value}-${Date.now()}`)

  return useDomainAgentSession({
    scope: 'case',
    sessionId: sessionId.value,
    userId,
    caseId: resolvedCaseId.value,
  })
}
