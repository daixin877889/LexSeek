<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface QueueItemIndicatorProps {
  completed?: boolean
  status?: 'pending' | 'in_progress' | 'completed'
  class?: HTMLAttributes['class']
}

const props = withDefaults(
  defineProps<QueueItemIndicatorProps>(),
  {
    completed: false,
  },
)

const resolvedStatus = computed(() =>
  props.status ?? (props.completed ? 'completed' : 'pending')
)
</script>

<template>
  <span
    :class="
      cn(
        'mt-0.5 inline-block size-2.5 rounded-full border',
        resolvedStatus === 'in_progress'
          ? 'border-green-500 bg-green-500 animate-pulse'
          : resolvedStatus === 'completed'
            ? 'border-muted-foreground/20 bg-muted-foreground/10'
            : 'border-muted-foreground/50',
        props.class,
      )
    "
  />
</template>
