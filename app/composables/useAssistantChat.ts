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
import { useApiFetch } from '~/composables/useApiFetch'
import { useStreamChat } from '~/composables/useStreamChat'

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

        // 阶段 5（方案 C 混合）：附件信息以**单条** human message 同时承载两份信息：
        //   1. content：sentinel + JSON + 用户原话（让 LLM 看到 ossFileId + 用户问题）
        //   2. additional_kwargs.attachments：LangChain 标准 metadata（前端渲染独立气泡）
        // 前端 useMessageParser 遇到带 attachments 的 human message → 展开为两条
        // ParsedMessage（先气泡卡片，再用户文字），content 里的 sentinel 段会被剥离不渲染。
        //
        // ⚠️ 之前尝试过 messages 数组发两条独立 human message，但 LangGraph SDK
        // 把两条同时推送的 human messages 合并/丢弃，后端只收到最后一条 → 改回单条。
        // 阶段 7 计划：清空 content sentinel + 后端中间件读 metadata 注入 system context。
        let content = input.text.trim()
        const additional_kwargs: Record<string, any> = {}
        if (input.files && input.files.length > 0) {
            const payload = input.files.map(f => ({
                id: f.id,
                fileName: f.fileName,
                fileType: f.fileType,
                fileSize: f.fileSize,
                encrypted: f.encrypted,
            }))
            additional_kwargs.attachments = payload
            // sentinel 放在 content 顶部，LLM 能读 ossFileId；前端解析时剥离这一段
            const sentinel = `__ATTACHMENTS__\n${JSON.stringify(payload)}`
            content = content ? `${sentinel}\n\n${content}` : sentinel
        }
        if (!content) return

        await stream.submit({
            messages: [{
                type: 'human',
                content,
                ...(Object.keys(additional_kwargs).length > 0 ? { additional_kwargs } : {}),
            }],
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
