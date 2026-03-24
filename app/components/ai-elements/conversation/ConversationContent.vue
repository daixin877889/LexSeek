<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'

interface Props {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const classes = computed(() => [
  'flex flex-col gap-6 px-8 py-6',
  props.class,
])
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>
