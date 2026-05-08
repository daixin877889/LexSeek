<script setup lang="ts">
import { toolDisplayName } from '~/utils/toolDisplayName'

interface Props {
  toolName: string
  input?: any
  output?: any
  errorText?: string
  state: string | 'input-available' | 'output-available' | 'output-error'
}

const props = defineProps<Props>()

const displayName = computed(() => toolDisplayName(props.toolName))
</script>

<template>
  <Tool>
    <ToolHeader :title="displayName" :type="`tool-${props.toolName}`" :state="props.state as any" />
    <ToolContent>
      <ToolInput v-if="props.input" :input="props.input" />
      <ToolOutput v-if="props.output != null" :output="props.output" :error-text="props.errorText" />
    </ToolContent>
  </Tool>
</template>
