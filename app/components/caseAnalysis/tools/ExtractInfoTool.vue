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
        <AiElementsToolToolHeader name="信息提取" :state="state" />
        <AiElementsToolToolContent v-if="output">
            <AiElementsToolToolOutput>
                <pre class="text-xs whitespace-pre-wrap">{{ typeof output === 'string' ? output : JSON.stringify(output, null, 2) }}</pre>
            </AiElementsToolToolOutput>
        </AiElementsToolToolContent>
    </AiElementsToolTool>
</template>
