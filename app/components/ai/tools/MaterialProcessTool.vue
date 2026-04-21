<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

const parsedOutput = computed(() => {
    try {
        return typeof props.output === 'string' ? JSON.parse(props.output) : props.output
    } catch { return null }
})

const materials = computed<Array<{ id: number, name: string, embedded: boolean }>>(
    () => parsedOutput.value?.materials || [],
)
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader title="材料处理" type="tool-process_materials" :state="state" />
        <AiElementsToolContent v-if="output != null">
            <div class="p-4">
                <ul class="space-y-1.5">
                    <li
                        v-for="m in materials"
                        :key="m.id"
                        class="flex items-center gap-2 text-sm"
                    >
                        <span
                            :class="[
                                'inline-block size-2 rounded-full shrink-0',
                                m.embedded ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                            ]"
                            :title="m.embedded ? '已处理' : '待处理'"
                        />
                        <span class="text-foreground line-clamp-1 break-words">{{ m.name }}</span>
                    </li>
                </ul>
            </div>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
