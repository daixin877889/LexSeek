/**
 * chat.post.ts 分支逻辑纯函数
 *
 * 提取的纯函数用于单元测试，无外部依赖
 */

import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

/** Resume 命令白名单 */
export const RESUME_COMMANDS = ['resume', 'continue', 'try_again'] as const

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
 * 验证 resume 命令是否合法
 * @param command 命令字符串
 * @returns true 表示命令合法
 */
export function isValidResumeCommand(command: string | undefined): boolean {
  if (!command) return false
  return RESUME_COMMANDS.includes(command as typeof RESUME_COMMANDS[number])
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
