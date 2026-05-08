<script setup lang="ts">
/**
 * 文书草稿工作区
 *
 * 路由：/dashboard/document/drafts/:id
 *
 * 通过已有 draftId 二次进入：
 * - onMounted 调 mountDraft 恢复草稿与模板
 * - 左侧字段表单（手填 + AI 建议），右侧实时预览
 * - 顶部：返回、模板名称（含关联案件）、AI 生成、导出 .docx
 * - 悬浮 Agent 对话窗 + 队列 / 中断 确认 Dialog
 */
import { ArrowLeftIcon, Loader2Icon, DownloadIcon, SparklesIcon, RefreshCw as RefreshCwIcon, HistoryIcon, SaveIcon, FolderIcon, FileTextIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { VisuallyHidden } from 'reka-ui'
import type { DocumentDraftVersion } from '#shared/types/document'
import { useMediaQuery, useLocalStorage } from '@vueuse/core'
import type { documentDrafts } from '~~/generated/prisma/client'
import { QUEUE_MAX_SIZE } from '~/composables/chatQueueActions'
import type { OssFileItem } from '~/store/file'
import type { CaseDetailMaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType } from '#shared/types/case'
import AiChat from '~/components/ai/AiChat.vue'
import AiChatQueueChips from '~/components/ai/AiChatQueueChips.vue'
import { PANEL_TOOL_MAP } from '~/components/agents/panelToolMap'
import AssistantDocumentAllMaterialsSheet from '~/components/assistant/document/AllMaterialsSheet.vue'
import AssistantDocumentDraftTitleInput from '~/components/assistant/document/DocumentDraftTitleInput.vue'
import AssistantDocumentFieldForm from '~/components/assistant/document/DocumentFieldForm.vue'
import AssistantDocumentHistorySheet from '~/components/assistant/document/DocumentHistorySheet.vue'
import AssistantDocumentPreview from '~/components/assistant/document/DocumentPreview.vue'
import AgentsDocumentDraftSourceBar from '~/components/agents/document/DraftSourceBar.vue'
import CasesCaseLinkerDialog from '~/components/cases/CaseLinkerDialog.vue'
import CaseChatWindowShell from '~/components/case/ChatWindowShell.vue'
import InterruptDispatcher from '~/components/InterruptDispatcher.vue'
import CaseAnalysisAudioPreviewDialog from '~/components/caseAnalysis/AudioPreviewDialog.vue'
import CaseAnalysisDocPreviewDialog from '~/components/caseAnalysis/DocPreviewDialog.vue'
import CaseAnalysisMaterialSelector from '~/components/caseAnalysis/materialSelector.vue'
import type { documentDrafts as DocumentDraftRow } from '~~/generated/prisma/client'
import type { ExportDraftResponse } from '#shared/types/document'
import { useApiFetch } from '~/composables/useApiFetch'
import { usePageSourceBar } from '~/composables/usePageSourceBar'
import { useCaseLinker } from '~/composables/useCaseLinker'
import { useDocumentAgent } from '~/composables/agents'
import { useDocumentDraftFields } from '~/composables/document/useDocumentDraftFields'
import { useDocumentDraftVersions } from '~/composables/document/useDocumentDraftVersions'
import { useDocumentDraftSnapshots } from '~/composables/document/useDocumentDraftSnapshots'
import { useDocumentDraftPreview } from '~/composables/document/useDocumentDraftPreview'
import { useInterruptToast } from '~/composables/useInterruptToast'
import { useAlertDialogStore } from '~/store/alertDialog'
import { triggerBrowserDownloadUrl } from '~/utils/browserDownload'

definePageMeta({
    layout: 'dashboard-layout',
    title: '工作区',
})

const route = useRoute()
const draftId = computed(() => Number(route.params.id))

// 草稿 ID Ref（mountDraft 之后写入；sub-composable 内部 read）
const draftIdRef = ref<number | null>(null)
// stream session ID（mountDraft 拿到后写入；驱动 useDocumentAgent 单 session 模式）
const sessionIdRef = ref<string | null>(null)

// === 业务态 sub-composable ===
const fields = useDocumentDraftFields({ draftId: draftIdRef })
const versionsApi = useDocumentDraftVersions({ draftId: draftIdRef })
const snapshotsApi = useDocumentDraftSnapshots({ draftId: draftIdRef })
const preview = useDocumentDraftPreview({ versions: versionsApi.versions })

const draft = fields.draft
const template = fields.template
const onFieldChange = fields.onFieldChange

const { versions, nextVersionNo, loadVersions, saveVersion, renameVersion, deleteVersion, exportVersion } = versionsApi
const { snapshots, loadSnapshots } = snapshotsApi
const { previewVersionId, previewValues, enterPreview, exitPreview } = preview

// === 业务 runStatus（旧 useDocumentDraft 的特有状态机）===
// 旧值域：'idle' | 'filling' | 'ready' | 'exported' | 'failed'
// 由 draft.status 推导 + custom event 修正
type DocumentRunStatus = 'idle' | 'filling' | 'ready' | 'exported' | 'failed'
const runStatus = ref<DocumentRunStatus>('idle')

function deriveRunStatusFromDraft(d: DocumentDraftRow | null): DocumentRunStatus {
    if (!d) return 'idle'
    if (d.status === 'failed') return 'failed'
    if (d.status === 'exported') return 'exported'
    if (d.status === 'drafting' || d.status === 'filling') return 'filling'
    return 'ready'
}

// === 工厂：单 session（sessionId 来自 mountDraft）===
// custom event 钩子：维护 runStatus / draft 与后端业务事件同步
function handleCustomEvent(data: unknown) {
    if (!data || typeof data !== 'object') return
    const evt = data as Record<string, unknown>
    if (evt.type === 'draft_ready') {
        runStatus.value = 'ready'
        if (evt.draft) {
            draft.value = evt.draft as DocumentDraftRow
        }
    } else if (evt.type === 'draft_update') {
        if (evt.draft) draft.value = evt.draft as DocumentDraftRow
    } else if (evt.type === 'draft_failed') {
        runStatus.value = 'failed'
    }
}

// 流末回拉：后端 draftResultPersistenceMiddleware 仅写库不推 SSE，
// 流完成后主动 GET draft 同步 values/status
async function refetchLatestDraft() {
    if (!draftIdRef.value) return
    const latest = await useApiFetch<{ draft: DocumentDraftRow }>(
        `/api/v1/assistant/document/drafts/${draftIdRef.value}`,
        { showError: false } as any,
    )
    if (!latest?.draft) return
    draft.value = latest.draft
    if (latest.draft.status !== 'drafting' && latest.draft.status !== 'filling') {
        runStatus.value = deriveRunStatusFromDraft(latest.draft)
    }
}

const documentAgent = useDocumentAgent(sessionIdRef, {
    onCustomEvent: handleCustomEvent,
    onStreamSettled: refetchLatestDraft,
})

const {
    messages,
    isLoading,
    interruptData,
    runError,
    sendMessage,
    stopGeneration,
    resumeInterrupt,
    currentQueue,
    isQueuePaused,
    queuePauseReason,
    enqueueMessage,
    removeQueueItem,
    clearQueue,
    resumeQueue,
} = documentAgent

const isInterrupted = computed(() => interruptData.value != null)
// 旧的 error 是 stream.error（Error | null），新的 runError 是 string；
// UI 只读取 .message，按 string 包成 { message } 兼容
const error = computed(() => (runError.value ? { message: runError.value } : null))

// === 标题（业务字段，inline 实现）===
const title = computed(() => draft.value?.title ?? '')

async function updateTitle(newTitle: string) {
    if (!draftIdRef.value) return
    const clean = newTitle.trim()
    if (!clean) return
    const prev = draft.value
    if (prev) {
        draft.value = { ...prev, title: clean, titleOverridden: true } as DocumentDraftRow
    }
    const result = await useApiFetch<{ draft: DocumentDraftRow }>(
        `/api/v1/assistant/document/drafts/title/${draftIdRef.value}`,
        { method: 'PATCH', body: { title: clean }, showError: true } as any,
    )
    if (!result?.draft) {
        if (prev) draft.value = prev // 回滚
        return
    }
    draft.value = result.draft
}

// === 导出（inline 实现）===
async function onExport() {
    if (!draftIdRef.value) return
    if (runStatus.value !== 'ready' && runStatus.value !== 'exported') return

    const result = await useApiFetch<ExportDraftResponse>(
        `/api/v1/assistant/document/drafts/export/${draftIdRef.value}`,
        { method: 'POST' } as any,
    )
    if (!result?.downloadUrl) return

    triggerBrowserDownloadUrl(result.downloadUrl)

    runStatus.value = 'exported'
}

// === mountDraft 包装：调 sub-composable.mountDraft + 设置 sessionId 触发工厂 init ===
async function mountDraft(id: number) {
    draftIdRef.value = id
    const r = await fields.mountDraft(id)
    if (!r.draft) {
        runStatus.value = 'idle'
        return
    }
    runStatus.value = deriveRunStatusFromDraft(r.draft)
    if (r.sessionId) {
        // 直接 switchSession 避免 watch 时序坑（先 set ref 再 init 时 watch 还没触发）
        sessionIdRef.value = r.sessionId
        await documentAgent.switchSession(r.sessionId)
        // 工厂内 switchSession 已根据 hasActiveRun 自动调 reconnect/loadHistory（submit undefined 触发回放），
        // 但 sessions 列表为空（单 session 模式不 fetchSessions），hasActiveRun 始终 false → 走 loadHistory。
        // 这与旧 useDocumentDraft 的 hasEverRun 判断不同：旧版仅在 hasEverRun 为 true 时才 submit(undefined)，
        // 全新无材料草稿不空跑。新工厂下需要薄包装层兜底（暂保留行为差异，loadHistory submit(undefined)
        // 在新草稿场景下也是合法的，stream 后端会返回空消息列表，不触发 Agent 跑动）。
    }
}

// === 还原版本 / 应用快照：写回 draft 后再 loadSnapshots（避免 versions/snapshots 双向耦合）===
async function restoreVersion(versionId: number) {
    const r = await versionsApi.restoreVersion(versionId)
    if (r.draft) {
        draft.value = r.draft
        await loadSnapshots()
    }
}

async function applySnapshot(snapshotId: number, fieldNames?: string[]) {
    const r = await snapshotsApi.applySnapshot(snapshotId, fieldNames)
    if (r.draft) {
        draft.value = r.draft
        await loadSnapshots()
    }
}

const loading = ref(true)
const loadError = ref<string | null>(null)

onMounted(async () => {
    if (!Number.isFinite(draftId.value) || draftId.value <= 0) {
        loadError.value = '草稿 ID 无效'
        loading.value = false
        return
    }
    try {
        await mountDraft(draftId.value)
        if (!draft.value) {
            loadError.value = '草稿不存在或已被删除'
        } else {
            await Promise.all([loadRelatedMaterials(), refreshCaseTitle()])
        }
    } catch (e) {
        loadError.value = e instanceof Error ? e.message : '加载草稿失败'
    } finally {
        loading.value = false
    }
})

const currentValues = computed(
    () => (draft.value?.values ?? {}) as Record<string, string | null>,
)

const suggestions = computed(() => {
    const metadata = draft.value?.metadata as
        | { suggestions?: Record<string, string> }
        | null
        | undefined
    return metadata?.suggestions
})

const exportDisabled = computed(
    () => runStatus.value !== 'ready' && runStatus.value !== 'exported',
)

const caseId = computed(() => (draft.value as documentDrafts | null)?.caseId ?? null)

// 来源条：?from=assistant&sessionId=xxx 跳入时显示「返回助手 + 关联案件」，
// 同时隐藏原工具栏「返回」按钮避免双返回按钮歧义
const { fromSource, sourceSessionId, showSourceBar, caseTitle, refreshCaseTitle } = usePageSourceBar({ caseId })

// 关联案件：useCaseLinker 封装了 PATCH + toast；onLinked 回调里重新 mountDraft 拿最新 caseId
const {
    dialogOpen: caseLinkerOpen,
    openLinker: openCaseLinker,
    linkCase: confirmLinkCase,
} = useCaseLinker({
    variant: 'document',
    entityId: draftId,
    onLinked: async () => {
        if (!Number.isFinite(draftId.value) || draftId.value <= 0) return
        await mountDraft(draftId.value)
        await refreshCaseTitle()
    },
})

const effectiveValues = computed<Record<string, string | null>>(() =>
    (previewValues.value ?? currentValues.value) as Record<string, string | null>,
)

// 模板 Buffer 加载（docx-preview 实时预览）：watch 按 template.id 触发，
// 切版本时 abort 上一个 fetch 避免大文件并发下载堆积内存
const templateBuffer = ref<ArrayBuffer | null>(null)
let templateFetchAbort: AbortController | undefined

watch(() => template.value?.id ?? null, async (tplId) => {
    templateFetchAbort?.abort()
    if (!tplId) {
        templateBuffer.value = null
        return
    }
    const ctrl = new AbortController()
    templateFetchAbort = ctrl
    try {
        const result = await useApiFetch<{ downloadUrl: string }>(
            `/api/v1/assistant/document/templates/download-url/${tplId}`,
            { showError: false },
        )
        if (ctrl.signal.aborted || !result?.downloadUrl) return
        const resp = await fetch(result.downloadUrl, { signal: ctrl.signal })
        if (!resp.ok) throw new Error(`下载模板文件失败：${resp.status}`)
        templateBuffer.value = await resp.arrayBuffer()
    } catch (err) {
        if (ctrl.signal.aborted) return
        console.warn('加载模板 buffer 失败', err)
    }
})

/** 按"入口优先级 > 案件归属 > 兜底"决定返回目标与按钮文案，保持一致 */
function resolveBackTarget(): { path: string; label: string } {
    if (route.query.from === 'document-history') {
        return { path: '/dashboard/document?tab=history', label: '返回' }
    }
    const cid = caseId.value
    if (cid != null) {
        const returnTab = route.query.returnTab === 'overview' ? 'overview' : 'documents'
        return { path: `/dashboard/cases/${cid}?tab=${returnTab}`, label: `返回案件 #${cid}` }
    }
    return { path: '/dashboard/document', label: '返回' }
}

const backLabel = computed(() => resolveBackTarget().label)

function goBack() {
    navigateTo(resolveBackTarget().path)
}

const isExporting = ref(false)
async function handleExport() {
    if (isExporting.value) return
    isExporting.value = true
    try {
        await onExport()
    } catch (err) {
        console.error('[document-draft-export] failed', err)
        toast.error('导出失败，请重试')
    } finally {
        isExporting.value = false
    }
}

// ========== 历史面板 / 保存版本 Dialog ==========
const historyOpen = ref(false)
const saveVersionDialogOpen = ref(false)
const saveVersionName = ref('')

// 统一的"破坏性操作"二次确认弹窗（shadcn AlertDialog）
const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmMessage = ref('')
let pendingAction: (() => void | Promise<void>) | null = null

function askConfirm(titleText: string, message: string, action: () => void | Promise<void>) {
    confirmTitle.value = titleText
    confirmMessage.value = message
    pendingAction = action
    confirmOpen.value = true
}

async function handleConfirmOk() {
    const act = pendingAction
    pendingAction = null
    confirmOpen.value = false
    if (act) await act()
}

async function openHistory() {
    historyOpen.value = true
    await Promise.all([loadVersions(), loadSnapshots()])
}

function openSaveVersionDialog() {
    saveVersionName.value = `第 ${nextVersionNo.value} 版`
    saveVersionDialogOpen.value = true
}

async function confirmSaveVersion() {
    const name = saveVersionName.value.trim()
    if (!name) return
    saveVersionDialogOpen.value = false
    const v = await saveVersion(name)
    if (v) toast.success(`已保存：${v.name}`)
}

function handleRestoreVersion(v: DocumentDraftVersion) {
    askConfirm(
        '恢复该版本到工作区？',
        '当前工作区内容将自动备份为快照再被覆盖。',
        async () => {
            await restoreVersion(v.id)
            historyOpen.value = false
            toast.success('已恢复到该版本')
        },
    )
}

function handleDeleteVersion(v: DocumentDraftVersion) {
    askConfirm(
        `删除「${v.name}」？`,
        '删除后无法恢复。',
        async () => {
            await deleteVersion(v.id)
            toast.success('已删除')
        },
    )
}

function handleApplySnapshotAll(snapshotId: number) {
    askConfirm(
        '用该快照全部覆盖工作区？',
        '当前工作区内容将自动备份为快照再被覆盖。',
        async () => {
            await applySnapshot(snapshotId)
            historyOpen.value = false
            toast.success('已覆盖工作区')
        },
    )
}

async function handleApplySnapshotField(snapshotId: number, fieldName: string) {
    // 单字段改动小，不弹确认
    await applySnapshot(snapshotId, [fieldName])
}

const agentOpen = ref(false)
const isStopping = ref(false)
const showRetryButton = ref(false)
const aiChatRef = ref<{
    resetPrompt: () => void
    addFiles: (files: OssFileItem[]) => void
    selectedFileIds: number[]
} | null>(null)
const materialSelectorRef = ref<{ openDialog: () => void } | null>(null)

const chatMessages = computed(() => messages.value as any[])
const chatLoading = computed(() => isLoading.value)
const queueLen = computed(() => currentQueue.value.length)
const queueFull = computed(() => queueLen.value >= QUEUE_MAX_SIZE)

// 已选文件 ID（传给 MaterialSelector 禁用已选项）
const selectedFileIds = computed(() => aiChatRef.value?.selectedFileIds ?? [])

// ========== 所有材料（本草稿 + 所属案件共享）==========
const relatedMaterials = ref<CaseDetailMaterialItem[]>([])

async function loadRelatedMaterials() {
    if (!Number.isFinite(draftId.value) || draftId.value <= 0) return
    const res = await useApiFetch<CaseDetailMaterialItem[]>(
        `/api/v1/assistant/document/drafts/related-materials/${draftId.value}`,
        { showError: false },
    )
    relatedMaterials.value = Array.isArray(res) ? res : []
}

const relatedOssFileIds = computed<number[]>(() =>
    relatedMaterials.value
        .map((m: CaseDetailMaterialItem) => m.ossFileId)
        .filter((id): id is number => id != null),
)

const allMaterialsOpen = ref(false)

function handleDeleteRelatedMaterial(material: CaseDetailMaterialItem) {
    if (!Number.isFinite(draftId.value) || draftId.value <= 0) return
    const alertDialogStore = useAlertDialogStore()
    alertDialogStore.showErrorDialog({
        title: '删除材料',
        message: `确定要删除「${material.name}」吗？删除后本草稿与所属案件都将不再看到该材料，且无法恢复。`,
        confirmText: '确认删除',
        cancelText: '取消',
        zIndex: 9999,
        onConfirm: async () => {
            const ok = await useApiFetch(
                `/api/v1/assistant/document/drafts/materials/${draftId.value}/${material.id}`,
                { method: 'DELETE' },
            )
            if (ok !== null) {
                toast.success('已删除')
                await loadRelatedMaterials()
            }
        },
    })
}

// --- 材料预览弹窗状态（与 cases/[id].vue:98-116 同构）---
const previewMaterial = ref<CaseDetailMaterialItem | null>(null)
const showPreview = ref(false)
const showTextPreview = ref(false)
const textContent = ref<string | null>(null)

async function openMaterialPreview(material: CaseDetailMaterialItem) {
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
    }
    previewMaterial.value = material
    if (material.type === CaseMaterialType.CASE_CONTENT) {
        showTextPreview.value = true
        textContent.value = null
        const res = await useApiFetch<{ content: string | null }>(`/api/v1/material/content/${material.id}`)
        textContent.value = res?.content ?? null
    } else {
        showPreview.value = true
    }
}

function openAgent() {
    agentOpen.value = true
}

// 打开文件选择弹框
function openMaterialSelector() {
    materialSelectorRef.value?.openDialog()
}

// 从弹框选择文件后添加到输入框
function handleFilesFromSelector(files: OssFileItem[]) {
    aiChatRef.value?.addFiles(files)
}

function handleChatSubmit(data: { text: string; files?: unknown[] }) {
    if (!data.text.trim() && !data.files?.length) return
    const shouldEnqueue = chatLoading.value || isQueuePaused.value
    if (shouldEnqueue) {
        const ok = enqueueMessage(data.text)
        if (!ok) {
            toast.warning(`队列已满（最多 ${QUEUE_MAX_SIZE} 条），请等待当前对话结束或清空队列`)
        } else {
            aiChatRef.value?.resetPrompt()
        }
    } else {
        void submitWithFiles(data)
    }
}

// 把 fileIds 前置在消息里，由 Agent 通过 process_materials 工具处理；
// 前端不再单独调 /materials 预挂接口，识别+嵌入进度由工具调用气泡呈现。
async function submitWithFiles(data: { text: string; files?: unknown[] }) {
    const fileIds = extractFileIds(data.files)

    // 立即清空输入框，给用户即时反馈
    aiChatRef.value?.resetPrompt()

    const segments: string[] = []
    if (fileIds.length > 0) {
        segments.push(
            `新增材料 fileIds: [${fileIds.join(', ')}]，请先调用 process_materials(fileIds=[${fileIds.join(', ')}]) 完成识别+嵌入后再继续。`,
        )
    }
    if (data.text) segments.push(data.text)

    const finalText = segments.join('\n\n').trim()
    if (!finalText) return
    sendMessage(finalText)
}

function extractFileIds(files: unknown[] | undefined): number[] {
    if (!Array.isArray(files)) return []
    const ids: number[] = []
    for (const f of files) {
        if (f && typeof f === 'object' && 'id' in f) {
            const id = Number((f as { id: unknown }).id)
            if (Number.isInteger(id) && id > 0) ids.push(id)
        }
    }
    return ids
}

async function handleStop() {
    if (isStopping.value) return
    if (!chatLoading.value) return

    isStopping.value = true
    let unwatch: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
        isStopping.value = false
        unwatch?.()
        if (timer) clearTimeout(timer)
        unwatch = undefined
        timer = undefined
    }
    unwatch = watch(chatLoading, (loading) => {
        if (!loading) cleanup()
    })
    timer = setTimeout(cleanup, 3000)
    try {
        await stopGeneration()
    } catch (err) {
        console.error('[document-draft-stop] stopGeneration failed', err)
        cleanup()
    }
}

function handleResumeInterrupt(data: unknown) {
    resumeInterrupt(data)
}

// 失败时显示重试按钮（useDocumentDraft 暴露 runStatus: failed）
watch(runStatus, (status) => {
    if (status === 'failed') {
        showRetryButton.value = true
    } else {
        showRetryButton.value = false
    }
})

function onRetry() {
    const list = chatMessages.value as any[]
    const lastUser = [...list].reverse().find((m) => {
        return typeof m?.getType === 'function' ? m.getType() === 'human' : m?.type === 'human'
    })
    if (!lastUser) return
    showRetryButton.value = false
    const content = typeof lastUser.content === 'string' ? lastUser.content : ''
    if (content) sendMessage(content)
}

// 中断出现时 toast 提示（复用小索）
useInterruptToast(interruptData)

// ========== 布局分级：紧凑(Tab) / 标准分栏 / 宽屏分栏 ==========
// - <1024px：Tabs 切换表单/预览
// - 1024–1440px：左右分栏，默认左 40%
// - >=1440px：左右分栏，默认左 32%
const isSplit = useMediaQuery('(min-width: 1024px)')
const isWide = useMediaQuery('(min-width: 1440px)')
const narrowTab = ref<'form' | 'preview'>('form')
const leftSizeStandard = useLocalStorage<number>('doc-draft-split-left-standard', 40)
const leftSizeWide = useLocalStorage<number>('doc-draft-split-left-wide', 32)
const activeLeftSize = computed(() => (isWide.value ? leftSizeWide.value : leftSizeStandard.value))
function handlePanelResize(sizes: number[]) {
    const next = sizes[0]
    if (typeof next !== 'number' || !Number.isFinite(next)) return
    if (isWide.value) leftSizeWide.value = next
    else leftSizeStandard.value = next
}
</script>

<template>
    <div class="p-4 md:p-6 flex flex-col gap-4" style="height: calc(100vh - 48px)">
        <!-- 顶部来源条仅当从法律助手 / 小索跳入时显示 -->
        <AgentsDocumentDraftSourceBar
            v-if="showSourceBar"
            :from="fromSource"
            :session-id="sourceSessionId"
            :case-id="caseId"
            :case-title="caseTitle"
            @link="openCaseLinker"
            @change="openCaseLinker"
        />

        <!-- 顶部工具栏 -->
        <header class="flex items-center justify-between gap-4 flex-wrap">
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <!-- showSourceBar 时由来源条接管返回按钮，避免双返回按钮歧义 -->
                <Button v-if="!showSourceBar" variant="ghost" size="sm" @click="goBack">
                    <ArrowLeftIcon class="size-4 mr-1" />
                    {{ backLabel }}
                </Button>
                <AssistantDocumentDraftTitleInput v-if="draft" :title="title" @save="updateTitle" />
            </div>
            <div class="flex items-center gap-2">
                <Button variant="outline" size="sm" :disabled="!draft" title="历史" @click="openHistory">
                    <HistoryIcon class="size-4" />
                    <span class="hidden lg:inline ml-1">历史</span>
                </Button>
                <Button variant="outline" size="sm" :disabled="!draft" title="所有材料" @click="allMaterialsOpen = true">
                    <FolderIcon class="size-4" />
                    <span class="hidden md:inline ml-1">材料</span>
                </Button>
                <Button variant="outline" size="sm" :disabled="!draft" title="保存当前为版本" @click="openSaveVersionDialog">
                    <SaveIcon class="size-4" />
                    <span class="hidden lg:inline ml-1">保存当前为版本</span>
                </Button>
                <Button variant="default" class="shadow-sm" title="AI 生成" @click="openAgent">
                    <SparklesIcon class="size-4" />
                    <span class="hidden sm:inline ml-1">AI 生成</span>
                </Button>
                <Button :disabled="exportDisabled || isLoading || isExporting"
                    :title="isExporting ? '导出中...' : '导出 word'" @click="handleExport">
                    <Loader2Icon v-if="isExporting" class="size-4 animate-spin" />
                    <DownloadIcon v-else class="size-4" />
                    <span class="hidden sm:inline ml-1">{{ isExporting ? '导出中...' : '导出 word' }}</span>
                </Button>
            </div>
        </header>

        <div v-if="previewVersionId !== null && draft"
            class="flex items-center justify-between rounded-md bg-amber-100 dark:bg-amber-900/40 px-3 py-2 text-sm">
            <span class="truncate">
                <span class="hidden sm:inline">预览中 · 版本 #{{ previewVersionId }}（点击"退出预览"回到当前工作区）</span>
                <span class="sm:hidden">预览 · v#{{ previewVersionId }}</span>
            </span>
            <Button size="sm" variant="ghost" @click="exitPreview">退出预览</Button>
        </div>

        <!-- 加载态 -->
        <div v-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground">
            <Loader2Icon class="size-6 animate-spin mr-2" />
            加载中...
        </div>

        <!-- 错误态 -->
        <div v-else-if="loadError" class="flex-1 flex items-center justify-center text-destructive">
            {{ loadError }}
        </div>

        <!-- stream 错误提示（不阻塞主体渲染） -->
        <div v-else-if="error"
            class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {{ error.message || '发生未知错误' }}
        </div>

        <!-- 主体：预览模式 / 分栏 / 紧凑 Tab -->
        <div v-if="!loading && !loadError && draft && template" class="flex-1 min-h-0 overflow-hidden">
            <!-- 预览模式：全屏预览 -->
            <div v-if="previewVersionId !== null"
                class="h-full min-h-0 overflow-y-auto rounded-lg border bg-muted/40 p-4">
                <AssistantDocumentPreview :template-buffer="templateBuffer" :values="effectiveValues"
                    :disabled="exportDisabled || isLoading || isExporting" @export="handleExport" />
            </div>
            <!-- 分栏 (>=1024px)：可拖拽，宽/标准档用不同默认比例 -->
            <ResizablePanelGroup v-else-if="isSplit" :key="isWide ? 'wide' : 'standard'" direction="horizontal"
                class="h-full" @layout="handlePanelResize">
                <ResizablePanel :default-size="activeLeftSize" :min-size="25">
                    <div class="h-full min-h-0 overflow-y-auto rounded-lg border bg-card p-4 mr-1">
                        <AssistantDocumentFieldForm :template="template" :values="effectiveValues"
                            :suggestions="suggestions" @change="onFieldChange" />
                    </div>
                </ResizablePanel>

                <ResizableHandle with-handle class="bg-transparent" />

                <ResizablePanel :default-size="100 - activeLeftSize" :min-size="25">
                    <div class="h-full min-h-0 overflow-y-auto rounded-lg border bg-muted/40 p-4 ml-1">
                        <AssistantDocumentPreview :template-buffer="templateBuffer" :values="effectiveValues"
                            :disabled="exportDisabled || isLoading || isExporting" @export="handleExport" />
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>

            <!-- 紧凑 (<1024px)：Tabs 切换，避免无限滚 -->
            <Tabs v-else v-model="narrowTab" class="h-full min-h-0 flex flex-col">
                <TabsList class="grid grid-cols-2 w-full shrink-0">
                    <TabsTrigger value="form">字段</TabsTrigger>
                    <TabsTrigger value="preview">预览</TabsTrigger>
                </TabsList>
                <TabsContent value="form" class="mt-2 flex-1 min-h-0 overflow-y-auto rounded-lg border bg-card p-4">
                    <AssistantDocumentFieldForm :template="template" :values="effectiveValues"
                        :suggestions="suggestions" @change="onFieldChange" />
                </TabsContent>
                <TabsContent value="preview"
                    class="mt-2 flex-1 min-h-0 overflow-y-auto rounded-lg border bg-muted/40 p-4">
                    <AssistantDocumentPreview :template-buffer="templateBuffer" :values="effectiveValues"
                        :disabled="exportDisabled || isLoading || isExporting" @export="handleExport" />
                </TabsContent>
            </Tabs>
        </div>

        <!-- 悬浮 Agent 窗 -->
        <CaseChatWindowShell v-model:open="agentOpen" title="文书生成助手" :initial-width="420" :initial-height="560">
            <AiChat ref="aiChatRef" :messages="chatMessages" :loading="chatLoading" :is-interrupted="isInterrupted"
                :enable-file-upload="true" :queue-length="queueLen" :queue-full="queueFull" :is-stopping="isStopping"
                prompt-placeholder="告诉 AI 你想怎么填..." :show-header="false" panel-mode="left"
                :tool-map="PANEL_TOOL_MAP"
                :on-file-button-click="openMaterialSelector" @submit="handleChatSubmit" @stop="handleStop">
                <template #prompt-actions>
                    <div v-if="showRetryButton && currentQueue.length === 0" class="flex items-center gap-2 px-4 py-2">
                        <Button size="sm" variant="outline" @click="onRetry">
                            <RefreshCwIcon class="w-4 h-4 mr-1" />
                            重试
                        </Button>
                    </div>
                    <AiChatQueueChips :queue="currentQueue" :max="QUEUE_MAX_SIZE" :paused="isQueuePaused"
                        :pause-reason="queuePauseReason" @remove="(id) => removeQueueItem(id)"
                        @resume="() => resumeQueue()" @clear="() => clearQueue()" />
                </template>
            </AiChat>
        </CaseChatWindowShell>

        <!-- 中断确认弹窗：InterruptDispatcher 按 type 分发到对应卡片 -->
        <Dialog :open="!!interruptData" @update:open="() => { }">
            <DialogContent class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0 z-70" overlay-class="z-[70]"
                :show-close-button="false" @pointer-down-outside.prevent @escape-key-down.prevent
                @open-auto-focus.prevent>
                <DialogHeader class="sr-only">
                    <DialogTitle>需要您的确认</DialogTitle>
                    <DialogDescription>请查看并回应 AI 的请求</DialogDescription>
                </DialogHeader>
                <div v-if="interruptData" class="p-6">
                    <InterruptDispatcher :interrupt="interruptData as any" @submit="handleResumeInterrupt"
                        @cancel="() => { }" />
                </div>
            </DialogContent>
        </Dialog>

        <!-- 关联案件 Dialog（来源条触发） -->
        <CasesCaseLinkerDialog
            v-model:open="caseLinkerOpen"
            :current-case-id="caseId"
            :on-confirm="confirmLinkCase"
        />

        <!-- 材料选择弹框（点击 AiChat 文件按钮触发） -->
        <CaseAnalysisMaterialSelector ref="materialSelectorRef"
            :disabled-file-ids="[...selectedFileIds, ...relatedOssFileIds]" @files-selected="handleFilesFromSelector" />

        <AssistantDocumentHistorySheet v-if="draft && template" v-model:open="historyOpen" :versions="versions"
            :snapshots="snapshots" :current-values="currentValues"
            @preview-version="(v: DocumentDraftVersion) => { enterPreview(v.id); historyOpen = false }"
            @restore-version="handleRestoreVersion" @export-version="(v: DocumentDraftVersion) => exportVersion(v.id)"
            @delete-version="handleDeleteVersion" @rename-version="renameVersion"
            @apply-snapshot-field="handleApplySnapshotField" @apply-snapshot-all="handleApplySnapshotAll" />

        <Dialog v-model:open="saveVersionDialogOpen">
            <DialogContent class="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>保存当前为版本</DialogTitle>
                    <DialogDescription>给这一版起个名字方便之后查找</DialogDescription>
                </DialogHeader>
                <div class="py-2">
                    <Input v-model="saveVersionName" maxlength="100" placeholder="例如：客户反馈前版"
                        @keydown.enter="confirmSaveVersion" />
                </div>
                <DialogFooter>
                    <Button variant="outline" @click="saveVersionDialogOpen = false">取消</Button>
                    <Button :disabled="!saveVersionName.trim()" @click="confirmSaveVersion">保存</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <!-- 统一的破坏性操作二次确认（恢复版本 / 删除版本 / 覆盖工作区） -->
        <AlertDialog v-model:open="confirmOpen">
            <AlertDialogContent class="z-80">
                <AlertDialogHeader>
                    <AlertDialogTitle>{{ confirmTitle }}</AlertDialogTitle>
                    <AlertDialogDescription>{{ confirmMessage }}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction @click="handleConfirmOk">确定</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <!-- 所有材料 Sheet（本草稿 + 所属案件共享） -->
        <AssistantDocumentAllMaterialsSheet v-model:open="allMaterialsOpen" :materials="relatedMaterials" show-delete
            @preview-material="openMaterialPreview" @delete="handleDeleteRelatedMaterial" />

        <!-- 文档/图片预览弹窗 -->
        <CaseAnalysisDocPreviewDialog
            v-if="previewMaterial?.type === CaseMaterialType.DOCUMENT || previewMaterial?.type === CaseMaterialType.IMAGE"
            v-model:open="showPreview" :oss-file-id="previewMaterial!.ossFileId!" :file-name="previewMaterial!.name"
            :file-type="previewMaterial!.fileType || 'document'" />

        <!-- 音频预览弹窗 -->
        <CaseAnalysisAudioPreviewDialog v-if="previewMaterial?.type === CaseMaterialType.AUDIO"
            v-model:open="showPreview" :oss-file-id="previewMaterial!.ossFileId!" :file-name="previewMaterial!.name" />

        <!-- 文本内容预览弹窗 -->
        <Dialog v-model:open="showTextPreview">
            <DialogContent class="w-full max-h-[80vh] md:min-w-[70vw] flex flex-col z-80" overlay-class="z-[75]">
                <DialogHeader class="shrink-0">
                    <DialogTitle class="flex items-center gap-2">
                        <FileTextIcon class="size-5 text-blue-500" />
                        {{ previewMaterial?.name }}
                    </DialogTitle>
                    <VisuallyHidden>
                        <DialogDescription>文本内容预览</DialogDescription>
                    </VisuallyHidden>
                </DialogHeader>
                <div class="flex-1 min-h-0 overflow-y-auto">
                    <div v-if="textContent" class="text-sm leading-relaxed whitespace-pre-wrap">
                        {{ textContent }}
                    </div>
                    <div v-else class="text-sm text-muted-foreground text-center py-8">
                        暂无文本内容
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    </div>
</template>
