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
        sendMessage: (message: string, opts?: { thinking?: boolean }) => {
            stream.submit({
                messages: [{ type: 'human', content: message }],
                thinking: opts?.thinking,
            } as any)
        },
        resumeInterrupt: (data: any) => {
            stream.submit(undefined, { command: { resume: data } })
        },
        stopGeneration: () => stream.stop(),
    }
}
