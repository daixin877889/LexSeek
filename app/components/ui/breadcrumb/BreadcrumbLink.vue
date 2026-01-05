<script lang="ts" setup>
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  href?: string
}>()
</script>

<template>
  <NuxtLink v-if="href" data-slot="breadcrumb-link" :to="href"
    :class="cn('hover:text-foreground transition-colors', props.class)">
    <slot />
  </NuxtLink>
  <span v-else data-slot="breadcrumb-link" :class="cn('hover:text-foreground transition-colors', props.class)">
    <slot />
  </span>
</template>
