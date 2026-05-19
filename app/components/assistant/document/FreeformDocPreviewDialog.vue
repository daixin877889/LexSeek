<script setup lang="ts">
/**
 * 自由文书预览弹窗（只读）
 *
 * 自由文书（mode=freeform，含历史迁移文书）正文是整块 Markdown，
 * 用与案件分析结果一致的 MessageResponse 渲染——只读、不可编辑。
 */
import { CheckIcon, CopyIcon, FileTextIcon, Loader2Icon } from 'lucide-vue-next'
import { VisuallyHidden } from 'reka-ui'
import toast from '#shared/utils/toast'
import { useApiFetch } from '~/composables/useApiFetch'

const props = defineProps<{
    /** 要预览的文书草稿 ID；为 null 时不加载 */
    draftId: number | null
}>()

const open = defineModel<boolean>('open', { default: false })

const loading = ref(false)
const title = ref('')
const content = ref<string | null>(null)
const copied = ref(false)

watch([open, () => props.draftId], async ([isOpen, id]) => {
    if (!isOpen || !id) return
    loading.value = true
    content.value = null
    title.value = ''
    const res = await useApiFetch<{ draft: { title: string; content: string | null } }>(
        `/api/v1/assistant/document/drafts/${id}`,
    )
    if (res?.draft) {
        title.value = res.draft.title || '历史文书'
        content.value = res.draft.content ?? ''
    }
    loading.value = false
})

async function handleCopy() {
    if (!content.value) return
    try {
        await navigator.clipboard.writeText(content.value)
        copied.value = true
        setTimeout(() => { copied.value = false }, 2000)
    } catch {
        toast.error('复制失败')
    }
}
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent class="w-full max-h-[85vh] md:min-w-[70vw] flex flex-col">
            <DialogHeader class="shrink-0">
                <DialogTitle class="flex items-center gap-2 pr-8">
                    <FileTextIcon class="size-5 text-indigo-500 shrink-0" />
                    <span class="truncate">{{ title || '历史文书' }}</span>
                </DialogTitle>
                <VisuallyHidden><DialogDescription>自由文书内容预览</DialogDescription></VisuallyHidden>
            </DialogHeader>

            <div class="flex-1 min-h-0 overflow-y-auto">
                <div v-if="loading" class="flex justify-center py-16">
                    <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
                </div>
                <div v-else-if="content" class="px-1 pb-2">
                    <MessageResponse :content="content" mode="static"
                        class="prose prose-sm dark:prose-invert max-w-none" />
                </div>
                <div v-else class="text-sm text-muted-foreground text-center py-16">
                    暂无文书内容
                </div>
            </div>

            <div v-if="content && !loading" class="shrink-0 flex justify-end pt-2 border-t">
                <Button variant="outline" size="sm" class="gap-1.5" @click="handleCopy">
                    <CheckIcon v-if="copied" class="size-4 text-emerald-500" />
                    <CopyIcon v-else class="size-4" />
                    {{ copied ? '已复制' : '复制全文' }}
                </Button>
            </div>
        </DialogContent>
    </Dialog>
</template>
