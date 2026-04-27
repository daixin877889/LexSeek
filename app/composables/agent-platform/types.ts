/**
 * agent-platform 内部共享类型（阶段 7）
 *
 * `WrappedChat` 是 useStreamChat 实例 + 三个简化方法（sendMessage / resumeInterrupt / stopGeneration）。
 * 由 useDomainAgentSession 工厂在 switchSession 内构造，由工厂 + useQueueDispatcher 共同消费。
 *
 * 之前由 useCaseChat 提供该类型，stage 7 删除 useCaseChat 后类型独立于此。
 */

import type { useStreamChat } from '../useStreamChat'

type StreamInstance = ReturnType<typeof useStreamChat>

export interface WrappedChat extends StreamInstance {
    sendMessage: (
        message: string,
        opts?: { thinking?: boolean; additional_kwargs?: Record<string, any> },
    ) => Promise<void>
    resumeInterrupt: (data: any) => void
    stopGeneration: () => Promise<void> | void
}
