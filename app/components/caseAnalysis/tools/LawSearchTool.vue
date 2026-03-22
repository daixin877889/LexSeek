<script setup lang="ts">
const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: string
}>()
</script>

<template>
    <AiElementsToolTool>
        <AiElementsToolToolHeader name="法律检索" :state="state" />
        <AiElementsToolToolInput v-if="input">
            <Badge variant="secondary">{{ input.query || input.keyword }}</Badge>
        </AiElementsToolToolInput>
        <AiElementsToolToolContent v-if="output">
            <AiElementsToolToolOutput>
                <pre class="text-xs whitespace-pre-wrap">{{ typeof output === 'string' ? output : JSON.stringify(output, null, 2) }}</pre>
            </AiElementsToolToolOutput>
        </AiElementsToolToolContent>
    </AiElementsToolTool>
</template>
