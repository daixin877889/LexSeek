/**
 * 案件分析对话 composable（新版）
 *
 * 使用 @langchain/vue useStream + FetchStreamTransport 管理 LangGraph 原生 SSE 流
 * 替代旧版 useCaseAnalysis.ts（基于 ai-sdk）
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import type { BaseMessage } from '@langchain/core/messages'

export interface CaseChatOptions {
    /** 会话 ID（作为 thread_id） */
    sessionId: string
    /** 是否启用 thinking */
    thinking?: boolean
}

interface CaseAgentState {
    messages: BaseMessage[]
}

export function useCaseChat(options: CaseChatOptions) {
    const { sessionId, thinking = true } = options

    // 使用 FetchStreamTransport 直连 Nuxt Server SSE 端点
    // 不需要 LangGraph Platform，直接 POST 到自定义端点
    const transport = new FetchStreamTransport({
        apiUrl: '/api/v1/case/analysis/chat',
        defaultHeaders: {
            'Content-Type': 'application/json',
        },
        onRequest: async (_url, init) => {
            // 注入 sessionId 和 thinking 到请求体
            const body = JSON.parse(init.body as string || '{}')
            return {
                ...init,
                body: JSON.stringify({
                    ...body,
                    sessionId,
                    thinking,
                }),
            }
        },
    })

    const stream = useStream<CaseAgentState>({
        transport,
        threadId: sessionId,
        messagesKey: 'messages',
        onError: (error) => {
            console.error('对话流错误:', error)
        },
        onCustomEvent: (event) => {
            console.log('自定义事件:', event)
        },
    })

    return {
        // 响应式状态（Vue refs）
        messages: stream.messages,
        values: stream.values,
        isLoading: stream.isLoading,
        error: stream.error,
        interrupt: stream.interrupt,

        // 操作方法
        sendMessage: (message: string) => {
            stream.submit({
                messages: [{ role: 'user', content: message }],
            } as any)
        },
        resumeInterrupt: (data: any) => {
            stream.submit(undefined, {
                command: { resume: data },
            })
        },
        stopGeneration: stream.stop,

        // 元数据
        getMessagesMetadata: stream.getMessagesMetadata,
        hasMessages: computed(() => (stream.messages.value?.length ?? 0) > 0),
    }
}
