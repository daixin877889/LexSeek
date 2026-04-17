export { runCaseChat, getChatThreadState } from './caseMainAgent'
export { createSubAgentTools, sanitizeName } from './subAgentToolFactory'
export { getThreadValuesService, messageToFlatDict, loadSubAgentThreads } from './threadState'
export type { SubAgentThread } from './threadState'

/**
 * 通用法律助手对话（assistant scope）
 *
 * Task 8 会替换为真实实现（从 ./assistantAgent re-export）。
 * 当前为占位 stub，仅用于让 agentWorker 路由逻辑通过类型检查与测试。
 */
export async function runAssistantChat(
  _sessionId: string,
  _message: string | undefined,
  _options: {
    userId: number
    command?: unknown
    signal?: AbortSignal
    thinking?: boolean
  },
): Promise<ReadableStream<Uint8Array>> {
  throw new Error('runAssistantChat 尚未实现（将在 Task 8 完成）')
}
