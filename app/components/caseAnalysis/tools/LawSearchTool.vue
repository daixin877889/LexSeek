<script setup lang="ts">
const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: string
}>()
</script>

<template>
    <AiElementsTool>
        <AiElementsToolHeader name="法律检索" :state="state" />
        <AiElementsToolInput v-if="input">
            <Badge variant="secondary">{{ input.query || input.keyword }}</Badge>
        </AiElementsToolInput>
        <AiElementsToolContent v-if="output">
            <AiElementsToolOutput>
                <pre class="text-xs whitespace-pre-wrap">{{ typeof output === 'string' ? output : JSON.stringify(output, null, 2) }}</pre>
            </AiElementsToolOutput>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
