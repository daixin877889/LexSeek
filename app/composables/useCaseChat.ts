import { useStreamChat } from '~/composables/useStreamChat'
/**
 * 案件分析对话 composable
 * 基于 useStreamChat 的特化。
 */

export interface CaseChatOptions {
    /** 会话 ID（作为 thread_id） */
    sessionId: string
    /** 自定义事件回调（用于模块对话接收 analysis_result_saved 等事件） */
    onCustomEvent?: (data: any) => void
}

export function useCaseChat(options: CaseChatOptions) {
    const stream = useStreamChat({
        apiUrl: '/api/v1/case/analysis/chat',
        threadId: options.sessionId,
        messagesKey: 'messages',
        onCustomEvent: options.onCustomEvent,
    })

    return {
        ...stream,
        sendMessage: async (message: string, opts?: { thinking?: boolean }) => {
            // 重置 runStatus 到 idle：上一轮的 cancelled/failed/completed 会粘滞
            // 在 runStatus，而新一轮的 SSE status_change: running 要等几百 ms
            // 到达。期间消费方（如 handleStop 的短路判断）误把本轮当终态处理。
            // 提前本地重置避免时间窗口踩坑。
            stream.runStatus.value = 'idle'
            // submit 返回 Promise，fetch 建立失败/4xx/5xx 会 reject
            // dispatcher 的 doDispatch 需要 await 这个 Promise 做错误回滚，
            // 因此 wrapper 必须显式 async 并透传 Promise
            await stream.submit({
                messages: [{ type: 'human', content: message }],
                thinking: opts?.thinking,
            } as any, {
                // SDK 在 submit 开始时会把 streamValues 重置为空的 historyValues（{}），
                // 导致消息列表短暂清空后再重新加载历史。传入当前值作为 optimisticValues
                // 可在过渡期间保留现有消息，消除闪烁。
                optimisticValues: stream.values.value,
            })
        },
        resumeInterrupt: (data: any) => {
            // interrupt 恢复也是新一轮，同样重置 runStatus 防止粘滞
            stream.runStatus.value = 'idle'
            stream.submit(undefined, { command: { resume: data } })
        },
        stopGeneration: () => stream.stop(),
    }
}
