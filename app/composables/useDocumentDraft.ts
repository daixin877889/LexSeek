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
import type { documentDrafts, documentTemplates } from '~~/generated/prisma/client'
import type {
    CreateDraftRequest,
    CreateDraftResponse,
    PatchDraftRequest,
    ExportDraftResponse,
} from '#shared/types/document'

type DocumentRunStatus = 'idle' | 'filling' | 'ready' | 'exported' | 'failed'

export function useDocumentDraft() {
    const draftId = ref<number | null>(null)
    const draft = ref<documentDrafts | null>(null)
    const template = ref<documentTemplates | null>(null)
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

        // 'completed' 时后端通过 custom event 推送 draft_ready，不在此处设置 ready 防 race condition
        stopStreamWatch = watch(
            () => s.runStatus.value,
            (status) => { if (status === 'failed') runStatus.value = 'failed' },
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

        mountStream(resp.sessionId)
        // submit 空输入使 LangGraph 从 checkpoint 恢复并开始推送
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
        onFieldChange,
        onExport,
    }
}
