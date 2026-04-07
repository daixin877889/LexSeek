/**
 * 案件分析对话 composable（新版）
 *
 * 使用 @langchain/vue useStream + FetchStreamTransport
 *
 * 重要：useStream 返回的 messages/values/interrupts 等是 getter（非 Ref），
 * 不能解构赋值，必须保持对 stream 对象的引用。
 * 用 computed() 包装 getter 使其成为响应式 Ref。
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import type { BaseMessage } from '@langchain/core/messages'

export interface CaseChatOptions {
    /** 会话 ID（作为 thread_id） */
    sessionId: string
    /** 自定义事件回调（用于模块对话接收 analysis_result_saved 等事件） */
    onCustomEvent?: (data: any) => void
}

interface CaseAgentState {
    messages: BaseMessage[]
}

export function useCaseChat(options: CaseChatOptions) {
    const { sessionId } = options

    const transport = new FetchStreamTransport({
        apiUrl: '/api/v1/case/analysis/chat',
    })

    const stream = useStream<CaseAgentState>({
        transport,
        threadId: sessionId,
        messagesKey: 'messages',
        onCustomEvent: options.onCustomEvent,
        onError: (error) => {
            console.error('[useCaseChat] 流错误:', error)
        },
    })

    // stream.messages / stream.values / stream.interrupt 是 getter（非 Ref），
    // 必须用 computed 包装才能在 Vue 模板中响应式更新
    return {
        messages: computed(() => stream.messages),
        values: computed(() => stream.values),
        isLoading: stream.isLoading,  // 这个是 shallowRef，可以直接用
        error: stream.error,          // shallowRef
        interrupt: computed(() => stream.interrupt),

        sendMessage: (message: string) => {
            stream.submit({
                messages: [{ type: 'human', content: message }],
            } as any)
        },
        resumeInterrupt: (data: any) => {
            stream.submit(undefined, {
                command: { resume: data },
            })
        },
        /** 触发重连并回放历史消息（页面刷新后恢复 session 时使用） */
        reconnect: () => {
            stream.submit(undefined)
        },
        stopGeneration: () => stream.stop(),
        getMessagesMetadata: (message: any, index?: number) =>
            stream.getMessagesMetadata(message, index),
    }
}
