<script setup lang="ts">
/**
 * 批注气泡（AI / 律师 / 外部，带可选删除按钮）
 *
 * UI-R5：从 RiskListPanel 抽出三处重复批注渲染（顶部/主清单/孤立批注区）。
 * 视觉与原 RiskListPanel 对齐：avatar + 作者名 + 时间 + 内容；
 * canDelete=true 时右上角加 Trash2 按钮（emit delete）。
 */
import { BotIcon, UserIcon, Trash2Icon } from 'lucide-vue-next'
import type { ContractAnnotationEntity } from '#shared/types/contract'

defineProps<{
    annotation: ContractAnnotationEntity
    /** 仅对 lawyer 类型且作者为当前用户时可见——具体判断由父组件计算后透传 */
    canDelete?: boolean
}>()

const emit = defineEmits<{
    delete: [annotationId: number]
}>()

function formatTime(value: string | Date): string {
    return new Date(value).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
}
</script>

<template>
    <div class="flex gap-2 text-xs">
        <div
            class="size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
            :class="annotation.authorType === 'ai'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'"
        >
            <BotIcon v-if="annotation.authorType === 'ai'" class="size-3" />
            <UserIcon v-else class="size-3" />
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1">
                <span class="font-medium">
                    {{ annotation.authorType === 'ai' ? 'AI' : annotation.authorName }}
                </span>
                <span class="text-muted-foreground text-[10px]">{{ formatTime(annotation.createdAt) }}</span>
                <button
                    v-if="canDelete"
                    class="ml-auto text-muted-foreground hover:text-destructive"
                    aria-label="删除批注"
                    @click="emit('delete', annotation.id)"
                >
                    <Trash2Icon class="size-3" />
                </button>
            </div>
            <div class="mt-0.5 text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
                {{ annotation.content }}
            </div>
        </div>
    </div>
</template>
