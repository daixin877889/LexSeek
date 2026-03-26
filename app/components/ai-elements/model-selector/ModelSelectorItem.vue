<script setup lang="ts">
import { CommandItem } from '@/components/ui/command'

defineProps<{
  value: string
}>()
</script>

<template>
  <CommandItem :value="value" v-bind="$attrs">
    <slot />
  </CommandItem>
</template>
