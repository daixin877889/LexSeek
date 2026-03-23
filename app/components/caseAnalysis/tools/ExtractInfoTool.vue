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
        <AiElementsToolHeader name="信息提取" :state="state" />
        <AiElementsToolContent v-if="output">
            <AiElementsToolOutput>
                <pre class="text-xs whitespace-pre-wrap">{{ typeof output === 'string' ? output : JSON.stringify(output, null, 2) }}</pre>
            </AiElementsToolOutput>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
