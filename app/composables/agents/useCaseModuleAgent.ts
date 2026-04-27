/**
 * 案件模块对话 - 薄包装
 *
 * 替代 useModuleChatManager：基于 useDomainAgentSession 工厂的轻薄包装
 * 为模块分析提供多 session 管理
 */

import type { Ref } from 'vue'
import { effectScope, type EffectScope } from 'vue'
import { useDomainAgentSession } from '../agent-platform/useDomainAgentSession'
import type { DomainAgentSessionConfig } from '../agent-platform/useDomainAgentSession'

export interface ModuleAgentInstance {
  sessionId: string
  moduleName: string
  moduleTitle: string
  isExpanded: Ref<boolean>
  isHidden: Ref<boolean>
  // 从工厂继承的所有能力
  messages: any
  isLoading: any
  interruptData: any
  runStatus: any
  runError: any
  sessions: any
  currentSessionId: any
  sendMessage: any
  resumeInterrupt: any
  switchSession: any
  createSession: any
  deleteSession: any
  renameSession: any
  stopGeneration: any
  currentQueue: any
  currentQueueLen: any
  isQueuePaused: any
  queuePauseReason: any
  enqueueMessage: any
  removeQueueItem: any
  resumeQueue: any
  clearQueue: any
}

export interface CaseModuleAgentOptions {
  onAnalysisSaved?: () => void
}

/**
 * 为每个模块创建独立的工厂实例
 */
export function useCaseModuleAgent(
  caseId: Ref<number>,
  moduleName: string,
  moduleTitle: string,
  options: CaseModuleAgentOptions = {},
) {
  const userId = 'current'

  // 为该模块生成唯一 sessionId
  const sessionId = ref(`module-${moduleName}-${caseId.value}-${Date.now()}`)

  const factory = useDomainAgentSession({
    scope: 'case',
    sessionId: sessionId.value,
    userId,
    caseId: caseId.value,
  })

  const instance: ModuleAgentInstance = Object.assign(factory as any, {
    sessionId: sessionId.value,
    moduleName,
    moduleTitle,
    isExpanded: ref(false),
    isHidden: ref(false),
  })

  return instance
}
