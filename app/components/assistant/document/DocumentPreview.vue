<script setup lang="ts">
/**
 * 文书预览组件（M5 版本）
 *
 * - 仅在首次有 templateBuffer 时调用一次 renderAsync 渲染 DOCX DOM
 * - 首次渲染后立刻快照所有块级容器的 Text 节点 + 原始 nodeValue
 * - 后续字段变化通过 replacePlaceholdersWithSnapshot 按段落合并替换，
 *   解决 docx-preview 把 {{xxx}} 拆到多个 Text 节点导致逐节点正则无法
 *   命中跨节点占位符的问题（#7）。
 * - 使用 useDebounceFn 防抖 500ms，避免高频输入时重复遍历。
 */
import { renderAsync } from 'docx-preview'
import { useDebounceFn } from '@vueuse/core'
import { FileTextIcon, DownloadIcon } from 'lucide-vue-next'
import {
    capturePlaceholderSnapshot,
    replacePlaceholdersWithSnapshot,
    type PlaceholderSnapshot,
} from '~/utils/documentPlaceholder'

const props = defineProps<{
    templateBuffer?: ArrayBuffer | null
    values: Record<string, string | null>
    disabled?: boolean
}>()

const emit = defineEmits<{ export: [] }>()

const previewRoot = ref<HTMLElement | null>(null)
const renderedOnce = ref(false)
const renderError = ref<string | null>(null)
const snapshot = ref<PlaceholderSnapshot | null>(null)

/** 首次渲染 + 占位符替换；templateBuffer 变化时重置并重新渲染 */
async function updatePreview(values: Record<string, string | null>) {
    if (!previewRoot.value || !props.templateBuffer) return

    try {
        if (!renderedOnce.value) {
            await renderAsync(props.templateBuffer, previewRoot.value)
            renderedOnce.value = true
            snapshot.value = capturePlaceholderSnapshot(previewRoot.value)
        }
        if (snapshot.value) {
            replacePlaceholdersWithSnapshot(snapshot.value, values)
        }
        renderError.value = null
    } catch (err) {
        renderError.value = err instanceof Error ? err.message : '预览渲染失败'
    }
}

const debouncedUpdate = useDebounceFn((v: Record<string, string | null>) => updatePreview(v), 500)

watch(() => props.values, (v) => debouncedUpdate(v), { deep: true })

// templateBuffer 变化时重置渲染状态（snapshot 与之绑定，必须同步清）
//
// 二次进入工作区（mountDraft 场景）时 templateBuffer 从 null 变为 ArrayBuffer，
// 此时模板切换到 v-else 分支，previewRoot 的 <div> 还未挂载。
// 必须 await nextTick 等 DOM flush 后再调用 updatePreview，否则 guard 跳过渲染 → 预览空白。
watch(
    () => props.templateBuffer,
    async (buf) => {
        renderedOnce.value = false
        renderError.value = null
        snapshot.value = null
        if (buf) {
            await nextTick()
            await updatePreview(props.values)
        }
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
    <div class="h-full flex flex-col gap-3">
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

        <!-- 有模板时：实时预览 -->
        <template v-else>
            <!-- 渲染出错时显示提示，但仍可导出 -->
            <div
                v-if="renderError"
                class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
                预览出错：{{ renderError }}（仍可导出 .docx）
            </div>

            <!-- DOCX 预览容器：白底与外层容器做对比 -->
            <div
                ref="previewRoot"
                class="docx-preview-root flex-1 min-h-0 overflow-y-auto rounded-md bg-background p-6"
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
/* docx-preview 默认 line-height 偏紧，正文挤在一起；统一放宽到 1.8 */
.docx-preview-root :deep(p),
.docx-preview-root :deep(li),
.docx-preview-root :deep(h1),
.docx-preview-root :deep(h2),
.docx-preview-root :deep(h3),
.docx-preview-root :deep(h4),
.docx-preview-root :deep(h5),
.docx-preview-root :deep(h6) {
    line-height: 1.8 !important;
}
/* 未填占位符（{{xxx}}）：颜色比正文更浅，做视觉降权 */
.docx-preview-root :deep(.docx-placeholder-unfilled) {
    color: var(--muted-foreground, #94a3b8);
    opacity: 0.6;
}
</style>
