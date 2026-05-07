/**
 * chat.post.ts 分支逻辑纯函数
 *
 * 提取的纯函数用于单元测试，无外部依赖
 */

import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

/** Resume 次数上限 */
export const MAX_RESUME_COUNT = 3

/**
 * 判断是否应该拒绝消息（RUNNING 状态 + 有新消息）
 * @param activeRunStatus 当前 run 的状态
 * @param hasMessage 是否有新消息
 * @returns true 表示应该拒绝
 */
export function shouldRejectMessage(activeRunStatus: string, hasMessage: boolean): boolean {
  return activeRunStatus === AGENT_RUN_STATUS.RUNNING && hasMessage
}

/**
 * 验证 resume 命令是否符合 LangGraph SDK 协议
 *
 * LangGraph 的 Command 协议形式为 `{ resume: <payload> }`，payload 可以是：
 * - dict 按 interrupt.id / toolCallId 索引：`{ call_xxx: { templateId: 1 } }`
 * - dict 携带语义动作：`{ action: 'approve' | 'reject' | 'continue', data?: ... }`
 * - 任意 JSON-serializable 值（字符串 / 数字 / null）
 *
 * 仅校验"是不是 LangGraph dict 形式"，不限制 payload 的内部结构——payload 由 interrupt() 的
 * 调用方（具体工具如 recommend_template / stance_select）按自身协议解析。
 */
export function isValidResumeCommand(command: unknown): boolean {
  return !!command && typeof command === 'object' && 'resume' in (command as object)
}

/**
 * 判断是否应该拒绝 resume（超过次数上限）
 * @param resumeCount 当前 resume 次数
 * @returns true 表示应该拒绝
 */
export function shouldRejectResume(resumeCount: number): boolean {
  return resumeCount >= MAX_RESUME_COUNT
}

/**
 * 获取当前 resume 次数
 * @param metadata run 的 metadata 对象
 * @returns resume 次数，默认为 0
 */
export function getResumeCount(metadata: any): number {
  return (metadata?.resumeCount as number | undefined) ?? 0
}

/**
 * FetchStreamTransport（@langchain/vue）请求体解析
 *
 * 前端 useStream 走该协议，body 形如：
 *   { input: { messages: [{ type, content }, ...], thinking? },
 *     config: { configurable: { thread_id } },
 *     command, streamSubgraphs }
 *
 * 此函数将其规整为 case/assistant 两类对话 API 共用的 `{ sessionId, message, command, thinking }`。
 */
export interface ExtractedChatParams {
  sessionId: string | undefined
  message: string | undefined
  command: any
  thinking: boolean | undefined
}

export function extractChatParams(body: any): ExtractedChatParams {
  const input = body?.input
  const config = body?.config
  const command = body?.command

  const sessionId = config?.configurable?.thread_id as string | undefined

  let message: string | undefined
  if (input?.messages && Array.isArray(input.messages)) {
    const lastMsg = input.messages.at(-1)
    if (lastMsg) {
      message = typeof lastMsg.content === 'string'
        ? lastMsg.content
        : typeof lastMsg === 'string'
          ? lastMsg
          : undefined
    }
  }

  const thinking = input?.thinking as boolean | undefined

  return { sessionId, message, command, thinking }
}
