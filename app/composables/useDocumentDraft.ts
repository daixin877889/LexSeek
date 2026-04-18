/**
 * 文书草稿生成 composable
 *
 * 基于 useStreamChat 的特化，面向文书助手的完整生命周期管理：
 * - onStart：创建草稿 + 订阅 SSE
 * - onFieldChange：debounce 500ms PATCH 字段值
 * - onExport：导出文书 + 触发浏览器下载
 *
 * 参见 spec §10.2。
 */
import { useDebounceFn } from '@vueuse/core'
import { nanoid } from 'nanoid'
import type { documentDrafts } from '~~/generated/prisma/client'
import type {
    CreateDraftRequest,
    CreateDraftResponse,
    PatchDraftRequest,
    ExportDraftResponse,
    DocumentTemplate,
} from '#shared/types/document'
import { QUEUE_MAX_SIZE, type QueueItem, type QueuePauseReason } from './chatQueueActions'

type DocumentRunStatus = 'idle' | 'filling' | 'ready' | 'exported' | 'failed'

export function useDocumentDraft() {
    const draftId = ref<number | null>(null)
    const draft = ref<documentDrafts | null>(null)
    const template = ref<DocumentTemplate | null>(null)
    const runStatus = ref<DocumentRunStatus>('idle')

    // 延迟创建，在 onStart 获取 sessionId 后初始化
    const stream = shallowRef<ReturnType<typeof useStreamChat> | null>(null)
    // 上一个 stream 的 watcher 停止句柄，防止重启时泄漏
    let stopStreamWatch: (() => void) | null = null

    const messages = computed(() => stream.value?.messages.value ?? [])
    const isLoading = computed(() => stream.value?.isLoading.value ?? false)
    const error = computed(() => stream.value?.error.value ?? null)

    function handleCustomEvent(data: unknown) {
        if (!data || typeof data !== 'object') return
        const evt = data as Record<string, unknown>

        if (evt.type === 'draft_ready') {
            runStatus.value = 'ready'
            if (evt.draft) draft.value = evt.draft as documentDrafts
        } else if (evt.type === 'draft_update') {
            if (evt.draft) draft.value = evt.draft as documentDrafts
        } else if (evt.type === 'draft_failed') {
            runStatus.value = 'failed'
        }
    }

    function mountStream(sessionId: string) {
        stopStreamWatch?.()

        const s = useStreamChat({
            apiUrl: '/api/v1/assistant/document/chat',
            threadId: sessionId,
            messagesKey: 'messages',
            onCustomEvent: handleCustomEvent,
        })
        stream.value = s

        // 后端 draftResultPersistenceMiddleware 只写库未推 SSE custom event，
        // 所以 stream 完成后主动 GET draft 同步 values/status，让 UI 切出 filling 态
        stopStreamWatch = watch(
            () => s.runStatus.value,
            async (status) => {
                if (status === 'failed') {
                    runStatus.value = 'failed'
                    return
                }
                if (status === 'completed' && draftId.value) {
                    const latest = await useApiFetch<{ draft: documentDrafts }>(
                        `/api/v1/assistant/document/drafts/${draftId.value}`,
                        { showError: false } as any,
                    )
                    if (!latest?.draft) return
                    draft.value = latest.draft
                    runStatus.value = latest.draft.status === 'failed' ? 'failed' : 'ready'
                }
            },
        )
    }

    async function onStart(params: CreateDraftRequest) {
        // 立即切到 filling 态：隐藏源输入视图，阻止重复点击，并显示 loading
        // 失败时回退到 idle 由 useApiFetch 自身的 toast 提示错误
        draft.value = null
        template.value = null
        draftId.value = null
        stream.value = null
        runStatus.value = 'filling'

        const resp = await useApiFetch<CreateDraftResponse>('/api/v1/assistant/document/drafts', {
            method: 'POST',
            body: params,
        })
        if (!resp) {
            runStatus.value = 'idle'
            return
        }

        draftId.value = resp.draftId

        // template 是字段表单和预览渲染的前置条件，拉取失败不阻塞 SSE
        const tpl = await useApiFetch<DocumentTemplate>(
            `/api/v1/assistant/document/templates/${params.templateId}`,
            { showError: false } as any,
        )
        if (tpl) template.value = tpl

        mountStream(resp.sessionId)
        // submit 空输入使 LangGraph 从 checkpoint 恢复并开始推送
        stream.value!.submit(undefined)
    }

    /**
     * 二次进入工作区时通过已有 draftId 恢复状态
     *
     * 与 onStart 区别：不创建新 draft，仅拉取 draft + template，
     * 再 mountStream 并 submit(undefined) 触发 checkpointer 回放历史消息。
     */
    async function mountDraft(id: number) {
        draft.value = null
        template.value = null
        draftId.value = null
        stream.value = null

        // 后端 getDraftService 返回 `{ draft }` 嵌套结构，useApiFetch 自动拆 data，
        // 所以这里仍需显式拆一层 draft
        const resp = await useApiFetch<{ draft: documentDrafts }>(
            `/api/v1/assistant/document/drafts/${id}`,
        )
        if (!resp?.draft) {
            runStatus.value = 'idle'
            return
        }
        const draftResp = resp.draft
        draft.value = draftResp
        draftId.value = draftResp.id

        const tpl = await useApiFetch<DocumentTemplate>(
            `/api/v1/assistant/document/templates/${draftResp.templateId}`,
            { showError: false } as any,
        )
        if (tpl) template.value = tpl

        runStatus.value = draftResp.status === 'failed'
            ? 'failed'
            : (draftResp.status === 'exported' ? 'exported' : 'ready')

        mountStream(draftResp.sessionId)
        stream.value!.submit(undefined)
    }

    // 409 表示正在生成中，showError: false 由调用方决定如何展示
    const patchField = useDebounceFn(async (fieldName: string, value: string | null) => {
        if (!draftId.value) return
        const body: PatchDraftRequest = { values: { [fieldName]: value } }
        const result = await useApiFetch<documentDrafts>(
            `/api/v1/assistant/document/drafts/${draftId.value}`,
            { method: 'PATCH', body, showError: false } as any,
        )
        if (result) draft.value = result
    }, 500)

    function onFieldChange(fieldName: string, value: string | null) {
        if (!draftId.value) return
        patchField(fieldName, value)
    }

    async function onExport() {
        if (!draftId.value) return
        if (runStatus.value !== 'ready' && runStatus.value !== 'exported') return

        const result = await useApiFetch<ExportDraftResponse>(
            `/api/v1/assistant/document/drafts/${draftId.value}/export`,
            { method: 'POST' },
        )
        if (!result?.downloadUrl) return

        const a = document.createElement('a')
        a.href = result.downloadUrl
        a.download = ''
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)

        runStatus.value = 'exported'
    }

    // ── agent 交互动作 ─────────────────────────────────────────────────────

    /** 向 stream 发送 human 消息；stream 未挂载则静默忽略 */
    function sendMessage(text: string) {
        if (!stream.value) return
        stream.value.runStatus.value = 'idle'
        stream.value.submit(
            { messages: [{ type: 'human', content: text }] } as any,
            undefined,
        )
    }

    /** 停止当前 stream */
    async function stopGeneration() {
        await stream.value?.stop()
    }

    /** 提交 interrupt resume 指令 */
    function resumeInterrupt(data: unknown) {
        if (!stream.value) return
        stream.value.runStatus.value = 'idle'
        stream.value.submit(undefined, { command: { resume: data } } as any)
    }

    /** 从底层 stream 解包的 interrupt 载荷 */
    const interruptData = computed(() => stream.value?.interruptData.value ?? null)
    const isInterrupted = computed(() => interruptData.value != null)

    // ── 单 session 消息队列 ────────────────────────────────────────────────
    //
    // 复用 chatQueueActions 的 QueueItem 类型和 QUEUE_MAX_SIZE 常量；
    // 因单 session 不需要 Map<sessionId, items[]>，直接用 ref<QueueItem[]> +
    // 不可变更新（filter / concat）实现。
    const currentQueue = ref<QueueItem[]>([])
    const isQueuePaused = ref(false)
    const queuePauseReason = ref<QueuePauseReason>(null)

    function enqueueMessage(text: string): boolean {
        if (currentQueue.value.length >= QUEUE_MAX_SIZE) return false
        currentQueue.value = [
            ...currentQueue.value,
            {
                id: nanoid(),
                text,
                thinking: false,
                enqueuedAt: Date.now(),
            },
        ]
        return true
    }

    function removeQueueItem(id: string) {
        currentQueue.value = currentQueue.value.filter(i => i.id !== id)
    }

    function clearQueue() {
        currentQueue.value = []
    }

    /** 尝试派发：仅在未暂停、stream 已挂载且非 loading 时取队首发送 */
    function dispatchNextIfReady() {
        if (isQueuePaused.value) return
        if (!stream.value || stream.value.isLoading.value) return
        const head = currentQueue.value[0]
        if (!head) return
        currentQueue.value = currentQueue.value.slice(1)
        sendMessage(head.text)
    }

    function resumeQueue() {
        isQueuePaused.value = false
        queuePauseReason.value = null
        dispatchNextIfReady()
    }

    // 监听 stream runStatus：failed/cancelled 暂停、completed 自动派发下一条。
    // stream 未挂载时 getter 返回 undefined，挂载后切换引用，watch 重新追踪新 ref —
    // 此行为符合预期：未挂载时没有 run 可监控。
    watch(
        () => stream.value?.runStatus.value,
        (status) => {
            if (status === 'failed') {
                isQueuePaused.value = true
                queuePauseReason.value = 'failed'
            } else if (status === 'cancelled') {
                isQueuePaused.value = true
                queuePauseReason.value = 'stopped'
            } else if (status === 'completed') {
                dispatchNextIfReady()
            }
        },
    )

    onUnmounted(() => {
        stopStreamWatch?.()
    })

    return {
        draft,
        template,
        runStatus,
        messages,
        isLoading,
        error,
        onStart,
        mountDraft,
        onFieldChange,
        onExport,
        sendMessage,
        stopGeneration,
        resumeInterrupt,
        interruptData,
        isInterrupted,
        // 队列
        currentQueue,
        isQueuePaused,
        queuePauseReason,
        enqueueMessage,
        removeQueueItem,
        clearQueue,
        resumeQueue,
    }
}
