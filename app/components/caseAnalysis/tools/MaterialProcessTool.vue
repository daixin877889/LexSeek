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

const materials = computed(() => parsedOutput.value?.materials || [])
const mode = computed(() => parsedOutput.value?.mode || 'unknown')
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader title="材料处理" type="tool-process_materials" :state="state" />
        <AiElementsToolContent v-if="output != null">
            <div class="p-4 space-y-2">
                <AiElementsQueue>
                    <AiElementsQueueItem v-for="m in materials" :key="m.id">
                        <AiElementsQueueItemContent :completed="m.embedded">
                            <AiElementsQueueItemIndicator :status="m.embedded ? 'completed' : 'pending'" />
                            <span>{{ m.name }}</span>
                            <Badge variant="outline" class="text-xs">{{ m.type }}</Badge>
                        </AiElementsQueueItemContent>
                    </AiElementsQueueItem>
                </AiElementsQueue>
                <Badge :variant="mode === 'full' ? 'default' : 'secondary'">
                    {{ mode === 'full' ? '全量模式' : mode === 'summary' ? '摘要模式' : mode }}
                </Badge>
            </div>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
