<script setup lang="ts">
/**
 * 文书预览组件（M5 版本）
 *
 * - 仅在首次有 templateBuffer 时调用一次 renderAsync 渲染 DOCX DOM
 * - 后续字段变化通过 TreeWalker 遍历 text nodes 做占位符替换，无需重新渲染
 * - 使用 useDebounceFn 防抖 500ms，避免高频输入时重复遍历
 */
import { renderAsync } from 'docx-preview'
import { useDebounceFn } from '@vueuse/core'
import { FileTextIcon, DownloadIcon } from 'lucide-vue-next'

const props = defineProps<{
    templateBuffer?: ArrayBuffer | null
    values: Record<string, string | null>
    disabled?: boolean
}>()

const emit = defineEmits<{ export: [] }>()

const previewRoot = ref<HTMLElement | null>(null)
const renderedOnce = ref(false)
const renderError = ref<string | null>(null)

/** 替换 DOM 内所有 {{占位符}} 为对应的值 */
function replacePlaceholders(root: HTMLElement, values: Record<string, string | null>) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const PLACEHOLDER_RE = /\{\{([\u4e00-\u9fa5\w]+)\}\}/g

    while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const original = node.nodeValue ?? ''
        const replaced = original.replace(PLACEHOLDER_RE, (_, name) => values[name] ?? '')
        if (replaced !== original) node.nodeValue = replaced
    }
}

/** 首次渲染 + 占位符替换；templateBuffer 变化时重置并重新渲染 */
async function updatePreview(values: Record<string, string | null>) {
    if (!previewRoot.value || !props.templateBuffer) return

    try {
        if (!renderedOnce.value) {
            await renderAsync(props.templateBuffer, previewRoot.value)
            renderedOnce.value = true
        }
        replacePlaceholders(previewRoot.value, values)
        renderError.value = null
    } catch (err) {
        renderError.value = err instanceof Error ? err.message : '预览渲染失败'
    }
}

const debouncedUpdate = useDebounceFn((v: Record<string, string | null>) => updatePreview(v), 500)

watch(() => props.values, (v) => debouncedUpdate(v), { deep: true })

// templateBuffer 变化时重置渲染状态
watch(
    () => props.templateBuffer,
    (buf) => {
        renderedOnce.value = false
        renderError.value = null
        if (buf) updatePreview(props.values)
    },
)

// 组件挂载后 previewRoot 才就绪，此处首次触发渲染
// 不用 watch(immediate:true)：immediate 回调在 setup 阶段执行，previewRoot 仍是 null 会被 guard 跳过
onMounted(() => {
    if (props.templateBuffer) updatePreview(props.values)
})

function handleExport() {
    emit('export')
}
</script>

<template>
    <div class="space-y-3">
        <!-- 无模板时：仅显示导出按钮 -->
        <div
            v-if="!templateBuffer"
            class="rounded-lg border bg-muted/10 p-6 flex flex-col items-center justify-center min-h-[160px] gap-3"
        >
            <FileTextIcon class="size-10 text-muted-foreground/60" />
            <p class="text-sm text-muted-foreground">准备就绪，可导出 .docx 文书</p>
            <Button :disabled="disabled" @click="handleExport">
                <DownloadIcon class="size-4 mr-2" />
                导出 .docx
            </Button>
        </div>

        <!-- 有模板时：实时预览 + 导出按钮 -->
        <template v-else>
            <div class="flex items-center justify-between">
                <h3 class="text-sm font-medium text-muted-foreground">实时预览</h3>
                <Button :disabled="disabled" size="sm" @click="handleExport">
                    <DownloadIcon class="size-4 mr-2" />
                    导出 .docx
                </Button>
            </div>

            <!-- 渲染出错时显示提示，但仍可导出 -->
            <div
                v-if="renderError"
                class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
                预览出错：{{ renderError }}（仍可导出 .docx）
            </div>

            <!-- DOCX 预览容器 -->
            <div
                ref="previewRoot"
                class="docx-preview-root rounded-lg border bg-background p-6 max-h-[600px] overflow-y-auto"
            />
        </template>
    </div>
</template>

<style scoped>
/* 消除 docx-preview 的背景和阴影，融入页面风格 */
.docx-preview-root :deep(.docx-wrapper) {
    background: transparent;
    padding: 0;
    box-shadow: none;
}
.docx-preview-root :deep(.docx) {
    box-shadow: none !important;
    margin: 0 !important;
}
</style>
