<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

const todos = computed(() => {
    // 优先从 output 解析
    if (props.output != null) {
        try {
            const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
            const items = data?.update?.todos ?? data?.todos
            if (Array.isArray(items)) return items
        } catch { /* fallback to input */ }
    }
    // 降级从 input 解析
    const items = props.input?.todos
    return Array.isArray(items) ? items : []
})

const completedCount = computed(() =>
    todos.value.filter((t: any) => t.status === 'completed').length,
)
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader title="任务规划" type="tool-write_todos" :state="state" />
        <AiElementsToolContent v-if="todos.length">
            <div class="p-4 space-y-2">
                <AiElementsQueue>
                    <AiElementsQueueItem v-for="(todo, idx) in todos" :key="idx">
                        <AiElementsQueueItemContent :completed="todo.status === 'completed'">
                            <AiElementsQueueItemIndicator :status="todo.status || 'pending'" />
                            {{ todo.content || todo.title }}
                        </AiElementsQueueItemContent>
                    </AiElementsQueueItem>
                </AiElementsQueue>
                <div class="flex justify-end">
                    <Badge variant="outline" class="text-xs">
                        {{ completedCount }}/{{ todos.length }}
                    </Badge>
                </div>
            </div>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
