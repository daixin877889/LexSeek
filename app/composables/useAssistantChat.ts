/**
 * 通用法律助手对话 composable
 *
 * 基于 useStreamChat 的特化，面向 /api/v1/assistant/chat 的单 session 对话。
 * 接口与 useCaseChat 对齐（sendMessage/stopGeneration/resumeInterrupt），
 * 额外提供：
 *   - loadHistory：从 GET /api/v1/assistant/sessions/:id 拿历史消息
 *   - isInterrupted：基于 interruptData 的布尔态，便于 AiChat 组件直接消费
 *
 * 参见 spec §8.3.1。
 */
import type { Ref } from 'vue'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'
import type { AssistantSession } from '#shared/types/assistant'

interface AssistantSessionDetail extends AssistantSession {
    status?: string
    messages: unknown[]
}

export function useAssistantChat(sessionId: Ref<string | null>) {
    // useStreamChat 的 threadId 只接受 string|undefined；null 需转为 undefined。
    // 使用 computed 让 threadId 随 sessionId 变化（虽然当前场景 session 切换会
    // 由上层重建 composable，但保持响应式以防 UI 侧 session 切换不重建实例）。
    const threadId = computed(() => sessionId.value ?? undefined)

    const stream = useStreamChat({
        apiUrl: '/api/v1/assistant/chat',
        threadId: threadId.value,
        messagesKey: 'messages',
    })

    const isInterrupted = computed(() => stream.interruptData.value != null)

    async function sendMessage(input: AiPromptSubmitData, opts?: { thinking?: boolean }) {
        if (!sessionId.value) return
        // 重置 runStatus 到 idle，避免上一轮终态粘滞（参见 useCaseChat 注释）。
        stream.runStatus.value = 'idle'
        await stream.submit({
            messages: [{ type: 'human', content: input.text }],
            thinking: opts?.thinking,
        } as any)
    }

    function resumeInterrupt(data: unknown) {
        stream.runStatus.value = 'idle'
        stream.submit(undefined, { command: { resume: data } })
    }

    async function loadHistory() {
        if (!sessionId.value) return
        const detail = await useApiFetch<AssistantSessionDetail>(
            `/api/v1/assistant/sessions/${sessionId.value}`,
        )
        if (!detail) return
        // stream.values 是 getter，无法直接 set；历史消息经 checkpointer 读取后
        // 通过 reconnect/loadHistory 由 SSE 回放更合适。这里仅返回原始消息，供
        // 调用方按需使用（例如 WIP 占位页的只读展示）。
        return detail
    }

    return {
        // 状态（与 useCaseChat/manager 对齐）
        messages: stream.messages,
        values: stream.values,
        isLoading: stream.isLoading,
        // AiChat 组件 props 名叫 loading，提供同名别名方便直接 v-bind
        loading: stream.isLoading,
        error: stream.error,
        hasHistoryLoaded: stream.hasHistoryLoaded,
        runStatus: stream.runStatus,
        runError: stream.runError,
        interruptData: stream.interruptData,
        isInterrupted,

        // 操作
        sendMessage,
        resumeInterrupt,
        stopGeneration: () => stream.stop(),
        stop: () => stream.stop(),
        reconnect: () => stream.reconnect(),
        loadHistory,
        getMessagesMetadata: stream.getMessagesMetadata,
    }
}
