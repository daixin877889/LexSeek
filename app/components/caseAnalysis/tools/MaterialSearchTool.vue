<script setup lang="ts">
const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: string
}>()

const results = computed(() => {
    try {
        const data = typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        return Array.isArray(data) ? data : []
    } catch { return [] }
})
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader name="材料检索" :state="state" />
        <AiElementsToolInput v-if="input">
            <Badge variant="secondary">{{ input.query }}</Badge>
        </AiElementsToolInput>
        <AiElementsToolContent v-if="output">
            <AiElementsToolOutput>
                <div class="space-y-2">
                    <div v-for="r in results" :key="r.index" class="border rounded p-2 text-sm">
                        <div class="font-medium text-xs text-muted-foreground">{{ r.source?.materialName }}</div>
                        <div class="mt-1">{{ r.content?.substring(0, 200) }}...</div>
                    </div>
                </div>
            </AiElementsToolOutput>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
