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
import { effectScope, type EffectScope } from 'vue'
import { nanoid } from 'nanoid'
import type { documentDrafts } from '~~/generated/prisma/client'
import type {
    CreateDraftRequest,
    CreateDraftResponse,
    PatchDraftRequest,
    ExportDraftResponse,
    DocumentTemplate,
    DocumentDraftVersion,
    DocumentDraftSnapshot,
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
    // mountStream 可能在 onStart/mountDraft 的 await 之后才被调用，此时组件的
    // active effect scope 已丢失，useStream 内部的 onScopeDispose 会触发
    // `[Vue warn]: onScopeDispose is called when there is no active effect scope...`
    // 用独立 effectScope 承接，组件卸载或重新挂载 stream 时统一 stop。
    let streamScope: EffectScope | null = null

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
        // 释放上一个 scope：stop 会触发其内部 onScopeDispose（包括 useStream
        // 注册的清理钩子）以及停止 scope 内所有 watch，避免泄漏
        streamScope?.stop()

        // 在独立 effectScope 内创建 stream，确保 useStream 内部的 onScopeDispose
        // 有活跃 scope 可依附（mountStream 可能在 await 之后被调用，彼时组件
        // active scope 已丢失）
        const scope = effectScope()
        streamScope = scope
        const s = scope.run(() => useStreamChat({
            apiUrl: '/api/v1/assistant/document/chat',
            threadId: sessionId,
            messagesKey: 'messages',
            onCustomEvent: handleCustomEvent,
        }))!
        stream.value = s

        // 后端 draftResultPersistenceMiddleware 只写库未推 SSE custom event，
        // 所以 stream 完成后主动 GET draft 同步 values/status，让 UI 切出 filling 态
        async function refetchLatestDraft() {
            if (!draftId.value) return
            const latest = await useApiFetch<{ draft: documentDrafts }>(
                `/api/v1/assistant/document/drafts/${draftId.value}`,
                { showError: false },
            )
            if (!latest?.draft) return
            draft.value = latest.draft
            if (latest.draft.status !== 'drafting' && latest.draft.status !== 'filling') {
                runStatus.value = latest.draft.status === 'failed'
                    ? 'failed'
                    : (latest.draft.status === 'exported' ? 'exported' : 'ready')
            }
        }

        // 用 isLoading 的 true→false 作为单一信号触发 refetch：
        // - 涵盖正常完成（completed）与异常（failed/cancelled）
        // - 避免 runStatus/isLoading 双 watch 同一次流结束发两次 GET
        // runStatus 仅用来立即响应 failed（避免等 isLoading 掉落产生视觉延迟）
        const stopStatusWatch = scope.run(() => watch(
            () => s.runStatus.value,
            (status) => {
                if (status === 'failed') runStatus.value = 'failed'
            },
        ))!

        const stopLoadingWatch = scope.run(() => watch(
            () => s.isLoading.value,
            async (loading, prev) => {
                if (prev && !loading) {
                    await refetchLatestDraft()
                }
            },
        ))!

        stopStreamWatch = () => {
            stopStatusWatch()
            stopLoadingWatch()
        }
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
            { showError: false },
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
            { showError: false },
        )
        if (tpl) template.value = tpl

        runStatus.value = draftResp.status === 'failed'
            ? 'failed'
            : (draftResp.status === 'exported' ? 'exported' : 'ready')

        mountStream(draftResp.sessionId)
        // 仅在确实存在 checkpoint 时才 submit(undefined) 回放历史；
        // 全新且无材料的草稿（sourceRef 为 null）从未跑过 Agent，submit 会触发空跑
        const sourceRef = draftResp.sourceRef as { text?: string; fileIds?: number[] } | null
        const hasMaterial = !!sourceRef?.text || (sourceRef?.fileIds?.length ?? 0) > 0
        const hasReadyValues = draftResp.status === 'ready'
            && Object.keys((draftResp.values ?? {}) as Record<string, unknown>).length > 0
        const RAN_STATUSES = new Set<string>(['exported', 'failed', 'drafting', 'filling'])
        const hasEverRun = hasMaterial || hasReadyValues || RAN_STATUSES.has(draftResp.status)
        if (hasEverRun) {
            stream.value!.submit(undefined)
        }
    }

    // 按字段累积待提交变更 + 单 debounce 统一 flush，避免旧实现的"单 debounce
    // 覆盖前一次参数 → 多字段连续改动只 PATCH 最后一字段"丢字段 bug。
    const pendingFieldValues = ref<Record<string, string | null>>({})

    const flushPendingFields = useDebounceFn(async () => {
        if (!draftId.value) return
        const snapshot = pendingFieldValues.value
        if (Object.keys(snapshot).length === 0) return
        // 清空后 await，在飞行中若用户继续编辑，新变更重新进入下一次累积窗口
        pendingFieldValues.value = {}
        const body: PatchDraftRequest = { values: snapshot }
        // 409 表示正在生成中，showError: false 由调用方决定如何展示
        // 后端 patchDraftService 返回 `{ draft }` 嵌套结构，与 getDraftService 一致，
        // 这里需要显式拆一层 draft，否则 draft.value 会变成 { draft: {...} }。
        const result = await useApiFetch<{ draft: documentDrafts }>(
            `/api/v1/assistant/document/drafts/${draftId.value}`,
            { method: 'PATCH', body, showError: false },
        )
        if (result?.draft) draft.value = result.draft
    }, 500)

    function onFieldChange(fieldName: string, value: string | null) {
        if (!draftId.value) return
        pendingFieldValues.value = { ...pendingFieldValues.value, [fieldName]: value }
        flushPendingFields()
    }

    async function onExport() {
        if (!draftId.value) return
        if (runStatus.value !== 'ready' && runStatus.value !== 'exported') return

        const result = await useApiFetch<ExportDraftResponse>(
            `/api/v1/assistant/document/drafts/${draftId.value}/export`,
            { method: 'POST' },
        )
        if (!result?.downloadUrl) return

        triggerBrowserDownloadUrl(result.downloadUrl)

        runStatus.value = 'exported'
    }

    // ── agent 交互动作 ─────────────────────────────────────────────────────

    /** 向 stream 发送 human 消息；stream 未挂载则静默忽略 */
    function sendMessage(text: string) {
        if (!stream.value) return
        stream.value.runStatus.value = 'idle'
        stream.value.submit(
            { messages: [{ type: 'human', content: text }] },
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
        stream.value.submit(undefined, { command: { resume: data } })
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

    // ========== Title ==========
    const title = computed(() => draft.value?.title ?? '')

    async function updateTitle(newTitle: string) {
        if (!draftId.value) return
        const clean = newTitle.trim()
        if (!clean) return
        const prev = draft.value
        if (prev) {
            draft.value = { ...prev, title: clean, titleOverridden: true } as documentDrafts
        }
        const result = await useApiFetch<{ draft: documentDrafts }>(
            `/api/v1/assistant/document/drafts/${draftId.value}/title`,
            { method: 'PATCH', body: { title: clean }, showError: true },
        )
        if (!result?.draft) {
            if (prev) draft.value = prev // 回滚
            return
        }
        draft.value = result.draft
    }

    // ========== Versions ==========
    const versions = ref<DocumentDraftVersion[]>([])
    const nextVersionNo = computed(() =>
        (versions.value.reduce((m, v) => Math.max(m, v.versionNo), 0)) + 1,
    )

    async function loadVersions() {
        if (!draftId.value) return
        const r = await useApiFetch<{ versions: DocumentDraftVersion[] }>(
            `/api/v1/assistant/document/drafts/${draftId.value}/versions`,
        )
        versions.value = r?.versions ?? []
    }

    async function saveVersion(name: string) {
        if (!draftId.value) return null
        const r = await useApiFetch<{ version: DocumentDraftVersion }>(
            `/api/v1/assistant/document/drafts/${draftId.value}/versions`,
            { method: 'POST', body: { name } },
        )
        if (r?.version) versions.value = [r.version, ...versions.value]
        return r?.version ?? null
    }

    async function renameVersion(versionId: number, name: string) {
        const r = await useApiFetch<{ version: DocumentDraftVersion }>(
            `/api/v1/assistant/document/drafts/versions/${versionId}`,
            { method: 'PATCH', body: { name } },
        )
        if (r?.version) {
            versions.value = versions.value.map(v => v.id === versionId ? r.version : v)
        }
    }

    async function deleteVersion(versionId: number) {
        const r = await useApiFetch<{ ok: true }>(
            `/api/v1/assistant/document/drafts/versions/${versionId}`,
            { method: 'DELETE' },
        )
        if (r?.ok) versions.value = versions.value.filter(v => v.id !== versionId)
    }

    async function restoreVersion(versionId: number) {
        const r = await useApiFetch<{ draft: documentDrafts }>(
            `/api/v1/assistant/document/drafts/versions/restore/${versionId}`,
            { method: 'POST' },
        )
        if (r?.draft) {
            draft.value = r.draft
            await loadSnapshots() // workspace-backup 会冒出来
        }
    }

    async function exportVersion(versionId: number) {
        const r = await useApiFetch<{ ossFileId: number; downloadUrl: string }>(
            `/api/v1/assistant/document/drafts/versions/export/${versionId}`,
        )
        if (!r?.downloadUrl) return
        triggerBrowserDownloadUrl(r.downloadUrl)
    }

    // ========== Snapshots ==========
    const snapshots = ref<DocumentDraftSnapshot[]>([])

    async function loadSnapshots() {
        if (!draftId.value) return
        const r = await useApiFetch<{ snapshots: DocumentDraftSnapshot[] }>(
            `/api/v1/assistant/document/drafts/${draftId.value}/snapshots`,
        )
        snapshots.value = r?.snapshots ?? []
    }

    async function applySnapshot(snapshotId: number, fieldNames?: string[]) {
        const r = await useApiFetch<{ draft: documentDrafts }>(
            `/api/v1/assistant/document/drafts/snapshots/apply/${snapshotId}`,
            { method: 'POST', body: fieldNames ? { fieldNames } : {} },
        )
        if (r?.draft) {
            draft.value = r.draft
            await loadSnapshots() // workspace-backup 新增
        }
    }

    // ========== Preview ==========
    const previewVersionId = ref<number | null>(null)
    const previewValues = computed<Record<string, string | null> | null>(() => {
        if (previewVersionId.value == null) return null
        const v = versions.value.find(x => x.id === previewVersionId.value)
        return v ? (v.values as Record<string, string | null>) : null
    })

    function enterPreview(id: number) { previewVersionId.value = id }
    function exitPreview() { previewVersionId.value = null }

    onUnmounted(() => {
        stopStreamWatch?.()
        streamScope?.stop()
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
        // title
        title, updateTitle,
        // versions
        versions, nextVersionNo,
        loadVersions, saveVersion, renameVersion, deleteVersion,
        restoreVersion, exportVersion,
        // snapshots
        snapshots, loadSnapshots, applySnapshot,
        // preview
        previewVersionId, previewValues, enterPreview, exitPreview,
    }
}
