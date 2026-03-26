<script setup lang="ts">
interface Props {
  toolName: string
  input?: any
  output?: any
  state: string | 'input-available' | 'output-available' | 'output-error'
}

const props = defineProps<Props>()
</script>

<template>
  <AiElementsTool>
    <AiElementsToolHeader :title="props.toolName" :type="`tool-${props.toolName}`" :state="props.state as any" />
    <AiElementsToolContent>
      <AiElementsToolInput v-if="props.input" :input="props.input" />
      <AiElementsToolOutput v-if="props.output != null" :output="props.output" />
    </AiElementsToolContent>
  </AiElementsTool>
</template>
