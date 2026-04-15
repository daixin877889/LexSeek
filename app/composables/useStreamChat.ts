/**
 * 泛型流管理底层 composable
 *
 * 将 useCaseChat 和 useInitAnalysis 共同的
 * FetchStreamTransport + useStream + computed 包装 + interrupt 解包
 * 抽取为可复用的泛型 composable。
 *
 * @langchain/vue 技术细节：
 * - FetchStreamTransport 路径走 useStreamCustom（非 useStreamLGP）
 * - useStreamCustom 返回的 values/interrupt/messages 是 ES6 getter（非 Ref）
 * - getter 内部读取 shallowRef.value，外层 computed 通过 Vue activeEffect 追踪
 * - interruptComputed 只依赖 isLoading（已知 bug：stream.custom.js:49-52）
 *   → 必须从 values.__interrupt__ 读取 interrupt 数据
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import type { UseStreamCustomOptions } from '@langchain/vue'
import type { BaseMessage } from '@langchain/core/messages'
import type { AgentRunStatus } from '#shared/types/agentRun'

export interface StreamChatOptions {
    /** SSE API 端点 */
    apiUrl: string
    /** LangGraph thread ID */
    threadId?: string
    /** 状态对象中的消息字段名（默认 'messages'） */
    messagesKey?: string
    /** 自定义事件回调 */
    onCustomEvent?: (data: unknown) => void
    /** 初始状态值（用于从 checkpoint 恢复） */
    initialValues?: Record<string, unknown>
}

export function useStreamChat<T extends Record<string, unknown> = Record<string, unknown>>(options: StreamChatOptions) {
    const transport = new FetchStreamTransport({
        apiUrl: options.apiUrl,
    })

    // 代理 agent run 状态，用于 UI 失败反馈
    const runStatus = ref<AgentRunStatus | 'idle'>('idle')
    const runError = ref<string>('')

    const streamOptions: UseStreamCustomOptions<T> = {
        transport: transport as any,
        threadId: options.threadId,
        messagesKey: options.messagesKey ?? 'messages',
        onCustomEvent: (data: unknown) => {
            if (
                data
                && typeof data === 'object'
                && 'type' in data
                && (data as { type: unknown }).type === 'status_change'
            ) {
                const evt = data as { type: 'status_change'; status: AgentRunStatus; error?: string }
                runStatus.value = evt.status
                if (evt.status === 'failed') {
                    runError.value = evt.error || '执行失败'
                } else if (evt.status === 'cancelled') {
                    runError.value = ''  // 用户主动取消不弹 toast
                }
                return  // status_change 不透传给外部 onCustomEvent
            }
            options.onCustomEvent?.(data)
        },
        initialValues: options.initialValues as T | undefined,
        onError: (error) => {
            console.error('[useStreamChat] 流错误:', error)
        },
    }

    // 使用 any 断言访问底层 stream，避免泛型推断导致的类型错误
    // （WithClassMessages 将部分方法包装为 Ref，泛型上下文下 TS 无法准确区分）
    const s = useStream<T>(streamOptions as any) as any

    // 标记历史消息是否已加载
    const hasHistoryLoaded = ref(false)
    watch(() => s.values, (values: unknown) => {
        if (values && !hasHistoryLoaded.value) {
            hasHistoryLoaded.value = true
        }
    })

    return {
        // 状态
        messages: computed((): BaseMessage[] => {
            void s.values // 显式触发 streamValues.value 的 track
            return s.messages as BaseMessage[]
        }),
        values: computed(() => s.values as T | undefined),
        isLoading: s.isLoading,   // shallowRef，直接透传
        error: s.error,           // shallowRef，直接透传
        hasHistoryLoaded,
        runStatus,
        runError,

        /**
         * 统一 interrupt 解包（CRITICAL：绕过 Vue 响应式 bug）
         *
         * 不能用 stream.interrupt（依赖 interruptComputed，只追踪 isLoading）
         * 必须从 stream.values（依赖 streamValues shallowRef）的 __interrupt__ 读取
         */
        interruptData: computed(() => {
            const v = s.values as any
            if (!v?.__interrupt__?.length) return null
            const raw = v.__interrupt__
            const resolved = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : raw) : raw
            return resolved?.value ?? resolved
        }),

        // 操作
        submit: (input?: any, config?: any) => s.submit(input, config) as Promise<void>,
        stop: () => s.stop() as Promise<void>,
        reconnect: () => {
            hasHistoryLoaded.value = false
            s.submit(undefined)
        },
        loadHistory: () => {
            hasHistoryLoaded.value = false
            s.submit(undefined)
        },
        getMessagesMetadata: (msg: any, idx?: number) =>
            s.getMessagesMetadata(msg, idx),
    }
}
