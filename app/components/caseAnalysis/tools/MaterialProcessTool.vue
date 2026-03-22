<script setup lang="ts">
defineProps<{
    toolName: string
    input?: any
    output?: any
    state: string
}>()

const materials = computed(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return data?.materials || []
    } catch { return [] }
})

const mode = computed(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return data?.mode || 'unknown'
    } catch { return 'unknown' }
})

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: string
}>()
</script>

<template>
    <AiElementsToolTool>
        <AiElementsToolToolHeader name="材料处理" :state="state" />
        <AiElementsToolToolContent v-if="output">
            <AiElementsToolToolOutput>
                <div class="space-y-2">
                    <Badge :variant="mode === 'full' ? 'default' : 'secondary'">
                        {{ mode === 'full' ? '全量模式' : mode === 'summary' ? '摘要模式' : mode }}
                    </Badge>
                    <div v-for="m in materials" :key="m.id" class="flex items-center gap-2 text-sm">
                        <span>{{ m.name }}</span>
                        <Badge variant="outline" class="text-xs">{{ m.type }}</Badge>
                        <span v-if="m.embedded" class="text-green-500 text-xs">已嵌入</span>
                    </div>
                </div>
            </AiElementsToolToolOutput>
        </AiElementsToolToolContent>
    </AiElementsToolTool>
</template>
