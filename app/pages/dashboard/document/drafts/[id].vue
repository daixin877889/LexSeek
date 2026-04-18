<script setup lang="ts">
/**
 * 文书草稿工作区
 *
 * 路由：/dashboard/document/drafts/:id
 *
 * 通过已有 draftId 二次进入：
 * - onMounted 调 mountDraft 恢复草稿与模板
 * - 左侧字段表单（手填 + AI 建议），右侧实时预览
 * - 顶部：返回、模板名称（含关联案件）、导出 .docx
 *
 * 本页不包含 Agent 对话窗与"AI 生成"按钮（Task 10 再加入）。
 */
import { ArrowLeftIcon, Loader2Icon, DownloadIcon } from 'lucide-vue-next'
import type { documentDrafts } from '~~/generated/prisma/client'

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
                <Button :disabled="exportDisabled || isLoading" @click="onExport">
                    <DownloadIcon class="size-4 mr-2" />
                    导出 .docx
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
            class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden"
        >
            <div class="min-h-0 overflow-y-auto rounded-lg border bg-card p-4">
                <h2 class="text-sm font-medium text-muted-foreground mb-3">编辑字段</h2>
                <AssistantDocumentFieldForm
                    :template="template"
                    :values="currentValues"
                    :suggestions="suggestions"
                    @change="onFieldChange"
                />
            </div>
            <div class="min-h-0 overflow-y-auto rounded-lg border bg-card p-4">
                <AssistantDocumentPreview
                    :template-buffer="templateBuffer"
                    :values="currentValues"
                    :disabled="exportDisabled || isLoading"
                    @export="onExport"
                />
            </div>
        </div>
    </div>
</template>
