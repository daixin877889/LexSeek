/**
 * 案件分析对话 composable（新版）
 *
 * 使用 @langchain/vue useStream + FetchStreamTransport
 *
 * FetchStreamTransport 会自动发送标准格式：
 * - body: { input, config: { configurable: { thread_id } }, command }
 * - 后端 chat.post.ts 从这些标准字段中提取参数
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import type { BaseMessage } from '@langchain/core/messages'

export interface CaseChatOptions {
    /** 会话 ID（作为 thread_id） */
    sessionId: string
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
        onError: (error) => {
            console.error('[useCaseChat] 流错误:', error)
        },
    })

    // 调试：打印 useStream 返回值的所有 key
    console.log('[useCaseChat] stream keys:', Object.keys(stream))
    console.log('[useCaseChat] stream.messages type:', typeof stream.messages)
    console.log('[useCaseChat] stream.messages value:', stream.messages)
    console.log('[useCaseChat] stream.isLoading type:', typeof stream.isLoading)
    console.log('[useCaseChat] stream:', stream)

    return {
        messages: stream.messages,
        values: stream.values,
        isLoading: stream.isLoading,
        error: stream.error,
        interrupt: stream.interrupt,

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
        stopGeneration: stream.stop,
        getMessagesMetadata: stream.getMessagesMetadata,
    }
}
