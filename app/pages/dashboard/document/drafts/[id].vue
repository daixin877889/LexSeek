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
import { ArrowLeftIcon, Loader2Icon, DownloadIcon, SparklesIcon, RefreshCw as RefreshCwIcon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useMediaQuery, useLocalStorage } from '@vueuse/core'
import type { documentDrafts } from '~~/generated/prisma/client'
import { QUEUE_MAX_SIZE } from '~/composables/chatQueueActions'
import type { OssFileItem } from '~/store/file'

definePageMeta({
    layout: 'dashboard-layout',
    title: '文书草稿',
})

const route = useRoute()
const draftId = computed(() => Number(route.params.id))

const {
    draft,
    template,
    runStatus,
    isLoading,
    error,
    onFieldChange,
    onExport,
    mountDraft,
    // Task 10 新增：Agent 交互与队列
    messages,
    sendMessage,
    stopGeneration,
    resumeInterrupt,
    interruptData,
    isInterrupted,
    currentQueue,
    isQueuePaused,
    queuePauseReason,
    enqueueMessage,
    removeQueueItem,
    clearQueue,
    resumeQueue,
} = useDocumentDraft()

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

// ========== 模板 Buffer 加载（用于 docx-preview 实时预览）==========
// 复用自 DocumentDraftPanel 的模式：watch template 拉取下载链接并下载为 ArrayBuffer，
// 通过 fetchSeq 防止过期请求覆盖最新结果。
const templateBuffer = ref<ArrayBuffer | null>(null)
let fetchSeq = 0

watch(template, async (tpl) => {
    if (!tpl) {
        templateBuffer.value = null
        return
    }
    const seq = ++fetchSeq
    try {
        const result = await useApiFetch<{ downloadUrl: string }>(
            `/api/v1/assistant/document/templates/download-url/${tpl.id}`,
            { showError: false } as any,
        )
        if (seq !== fetchSeq || !result?.downloadUrl) return
        const resp = await fetch(result.downloadUrl)
        if (seq !== fetchSeq) return
        if (!resp.ok) throw new Error(`下载模板文件失败：${resp.status}`)
        templateBuffer.value = await resp.arrayBuffer()
    } catch (err) {
        if (seq !== fetchSeq) return
        console.warn('加载模板 buffer 失败', err)
    }
})

function goBack() {
    navigateTo('/dashboard/document')
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

// ========== Task 10：悬浮 Agent 窗 + 队列 / 中断 ==========

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

// 把附件挂到 draft 后再发消息，确保 search_case_materials 工具能命中
async function submitWithFiles(data: { text: string; files?: unknown[] }) {
    const fileIds = extractFileIds(data.files)
    let promptPrefix = ''
    if (fileIds.length > 0 && draftId.value) {
        const result = await useApiFetch<{ succeeded: number[]; failed: Array<{ fileId: number; reason: string }> }>(
            `/api/v1/assistant/document/drafts/${draftId.value}/materials`,
            { method: 'POST', body: { fileIds }, showError: false } as any,
        )
        const ok = result?.succeeded?.length ?? 0
        const fail = result?.failed?.length ?? 0
        if (fail > 0) {
            toast.warning(`${fail} 份材料处理失败，已忽略`)
        }
        if (ok > 0) {
            promptPrefix = `已上传 ${ok} 份新材料，请通过 search_case_materials 检索后补充提取并回填字段。\n\n`
        }
    }
    const finalText = `${promptPrefix}${data.text || ''}`.trim()
    if (!finalText) return
    sendMessage(finalText)
    aiChatRef.value?.resetPrompt()
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

// ========== 左右分栏：桌面端 Resizable，移动端改为竖向堆叠 ==========
const isDesktop = useMediaQuery('(min-width: 768px)')
const leftSize = useLocalStorage<number>('doc-draft-split-left-size-v3', 30)
function handlePanelResize(sizes: number[]) {
    const next = sizes[0]
    if (typeof next === 'number' && Number.isFinite(next)) {
        leftSize.value = next
    }
}
</script>

<template>
    <div class="p-4 md:p-6 flex flex-col gap-4" style="height: calc(100vh - 48px)">
        <!-- 顶部工具栏 -->
        <header class="flex items-center justify-between gap-4 flex-wrap">
            <div class="flex items-center gap-2 min-w-0">
                <Button variant="ghost" size="sm" @click="goBack">
                    <ArrowLeftIcon class="size-4 mr-1" />
                    返回
                </Button>
                <h1 v-if="template" class="text-lg md:text-xl font-semibold truncate">
                    {{ template.name }}
                    <span v-if="caseId" class="text-sm text-muted-foreground ml-2">
                        · 案件 #{{ caseId }}
                    </span>
                </h1>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="default" class="shadow-sm" @click="openAgent">
                    <SparklesIcon class="size-4 mr-2" />
                    AI 生成
                </Button>
                <Button :disabled="exportDisabled || isLoading || isExporting" @click="handleExport">
                    <Loader2Icon v-if="isExporting" class="size-4 mr-2 animate-spin" />
                    <DownloadIcon v-else class="size-4 mr-2" />
                    {{ isExporting ? '导出中...' : '导出 .docx' }}
                </Button>
            </div>
        </header>

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
        <div
            v-else-if="error"
            class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
            {{ error.message || '发生未知错误' }}
        </div>

        <!-- 主体：左表单 / 右预览 -->
        <div
            v-if="!loading && !loadError && draft && template"
            class="flex-1 min-h-0 overflow-hidden"
        >
            <!-- 桌面：可拖拽分栏 -->
            <ResizablePanelGroup
                v-if="isDesktop"
                direction="horizontal"
                class="h-full"
                @layout="handlePanelResize"
            >
                <ResizablePanel :default-size="leftSize" :min-size="25">
                    <div class="h-full min-h-0 overflow-y-auto rounded-lg border bg-card p-4 mr-1">
                        <AssistantDocumentFieldForm
                            :template="template"
                            :values="currentValues"
                            :suggestions="suggestions"
                            @change="onFieldChange"
                        />
                    </div>
                </ResizablePanel>

                <ResizableHandle with-handle class="bg-transparent" />

                <ResizablePanel :default-size="100 - leftSize" :min-size="25">
                    <div class="h-full min-h-0 overflow-y-auto rounded-lg border bg-card p-4 ml-1">
                        <AssistantDocumentPreview
                            :template-buffer="templateBuffer"
                            :values="currentValues"
                            :disabled="exportDisabled || isLoading || isExporting"
                            @export="handleExport"
                        />
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>

            <!-- 移动：竖向堆叠 -->
            <div v-else class="h-full min-h-0 flex flex-col gap-4 overflow-y-auto">
                <div class="rounded-lg border bg-card p-4">
                    <AssistantDocumentFieldForm
                        :template="template"
                        :values="currentValues"
                        :suggestions="suggestions"
                        @change="onFieldChange"
                    />
                </div>
                <div class="rounded-lg border bg-card p-4">
                    <AssistantDocumentPreview
                        :template-buffer="templateBuffer"
                        :values="currentValues"
                        :disabled="exportDisabled || isLoading || isExporting"
                        @export="handleExport"
                    />
                </div>
            </div>
        </div>

        <!-- 悬浮 Agent 窗 -->
        <CaseChatWindowShell
            v-model:open="agentOpen"
            title="AI 生成助手"
            :initial-width="420"
            :initial-height="560"
        >
            <AiChat
                ref="aiChatRef"
                :messages="chatMessages"
                :loading="chatLoading"
                :is-interrupted="isInterrupted"
                :enable-file-upload="true"
                :queue-length="queueLen"
                :queue-full="queueFull"
                :is-stopping="isStopping"
                prompt-placeholder="告诉 AI 你想怎么填..."
                :show-header="false"
                panel-mode="left"
                :on-file-button-click="openMaterialSelector"
                @submit="handleChatSubmit"
                @stop="handleStop"
            >
                <template #prompt-actions>
                    <div
                        v-if="showRetryButton && currentQueue.length === 0"
                        class="flex items-center gap-2 px-4 py-2"
                    >
                        <Button size="sm" variant="outline" @click="onRetry">
                            <RefreshCwIcon class="w-4 h-4 mr-1" />
                            重试
                        </Button>
                    </div>
                    <AiChatQueueChips
                        :queue="currentQueue"
                        :max="QUEUE_MAX_SIZE"
                        :paused="isQueuePaused"
                        :pause-reason="queuePauseReason"
                        @remove="(id) => removeQueueItem(id)"
                        @resume="() => resumeQueue()"
                        @clear="() => clearQueue()"
                    />
                </template>
            </AiChat>
        </CaseChatWindowShell>

        <!-- 中断确认弹窗 -->
        <Dialog :open="!!interruptData" @update:open="() => {}">
            <DialogContent
                class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0 z-[70]"
                overlay-class="z-[70]"
                :show-close-button="false"
                @pointer-down-outside.prevent
                @escape-key-down.prevent
                @open-auto-focus.prevent
            >
                <DialogHeader class="sr-only">
                    <DialogTitle>需要您的确认</DialogTitle>
                    <DialogDescription>请查看并回应 AI 的请求</DialogDescription>
                </DialogHeader>
                <div v-if="interruptData" class="p-6">
                    <CaseInterruptConfirmation
                        :interrupt="interruptData"
                        @submit="handleResumeInterrupt"
                        @cancel="() => {}"
                    />
                </div>
            </DialogContent>
        </Dialog>

        <!-- 材料选择弹框（点击 AiChat 文件按钮触发） -->
        <CaseAnalysisMaterialSelector
            ref="materialSelectorRef"
            :disabled-file-ids="selectedFileIds"
            @files-selected="handleFilesFromSelector"
        />
    </div>
</template>
