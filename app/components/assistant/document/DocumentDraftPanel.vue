<script setup lang="ts">
/**
 * 文书生成主容器
 *
 * 组合模板选择 / 材料输入 / 字段表单 / 预览 四个子组件。
 * 运行状态 runStatus 内联展示（不拆独立组件）。
 *
 * 支持两场景：
 * - 独立场景：不传 caseId
 * - 案件场景：传 caseId，材料输入区额外显示"从案件材料选"入口
 */
import { Loader2Icon } from 'lucide-vue-next'

const props = defineProps<{
    caseId?: number
}>()

const {
    draft,
    template,
    runStatus,
    isLoading,
    error,
    onStart,
    onFieldChange,
    onExport,
} = useDocumentDraft()

const templateId = ref<number | null>(null)
const pendingSource = ref<{ text: string; sourceFileIds: number[] } | null>(null)

function handleSourceSubmit(data: { text: string; sourceFileIds: number[] }) {
    pendingSource.value = data
    startDraft()
}

async function startDraft() {
    if (!templateId.value || !pendingSource.value) return
    await onStart({
        templateId: templateId.value,
        sourceText: pendingSource.value.text || undefined,
        sourceFileIds: pendingSource.value.sourceFileIds.length ? pendingSource.value.sourceFileIds : undefined,
        caseId: props.caseId,
    })
}

const currentValues = computed(() => (draft.value?.values ?? {}) as Record<string, string | null>)
const suggestions = computed(() => {
    const metadata = draft.value?.metadata as { suggestions?: Record<string, string> } | null | undefined
    return metadata?.suggestions
})

const exportDisabled = computed(() => runStatus.value !== 'ready' && runStatus.value !== 'exported')

// ========== 模板 Buffer 加载（用于 docx-preview 实时预览）==========

const templateBuffer = ref<ArrayBuffer | null>(null)

// 用于取消过期请求：每次 watch 触发时递增，仅最新版本写入 templateBuffer
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
            { showError: false },
        )
        if (seq !== fetchSeq || !result?.downloadUrl) return
        const resp = await fetch(result.downloadUrl)
        if (seq !== fetchSeq) return
        if (!resp.ok) throw new Error(`下载模板文件失败：${resp.status}`)
        templateBuffer.value = await resp.arrayBuffer()
    } catch (err) {
        if (seq !== fetchSeq) return
        // 加载失败不影响主流程（导出仍可正常工作），仅静默忽略
        console.warn('加载模板 buffer 失败', err)
    }
})
</script>

<template>
    <div class="space-y-6">
        <section v-if="!templateId">
            <h2 class="text-lg font-semibold mb-3">选择模板</h2>
            <DocumentTemplatePicker @select="(id: number) => templateId = id" />
        </section>

        <section v-else-if="runStatus === 'idle'">
            <div class="flex items-center justify-between mb-3">
                <h2 class="text-lg font-semibold">提供材料</h2>
                <Button size="sm" variant="ghost" @click="templateId = null">
                    更换模板
                </Button>
            </div>
            <DocumentSourceInput :case-id="caseId" @submit="handleSourceSubmit" />
        </section>

        <div
            v-if="runStatus === 'filling'"
            class="flex items-center gap-2 py-4 text-muted-foreground"
        >
            <Loader2Icon class="size-4 animate-spin" />
            <span>AI 正在分析材料并填充文书字段...</span>
        </div>

        <div
            v-if="error"
            class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
            生成失败：{{ error.message || '请稍后重试' }}
        </div>

        <section v-if="(runStatus === 'ready' || runStatus === 'exported') && template && draft">
            <h2 class="text-lg font-semibold mb-3">编辑文书字段</h2>
            <DocumentFieldForm
                :template="template"
                :values="currentValues"
                :suggestions="suggestions"
                @change="onFieldChange"
            />
        </section>

        <section v-if="draft && template">
            <DocumentPreview
                :template-buffer="templateBuffer"
                :values="currentValues"
                :disabled="exportDisabled || isLoading"
                @export="onExport"
            />
        </section>
    </div>
</template>
