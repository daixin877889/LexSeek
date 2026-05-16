<template>
  <!-- 云盘空间统一复选框（对齐设计稿 disk-checkbox） -->
  <div role="checkbox" :aria-checked="checked"
    :class="[
      'flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-2 transition-colors',
      checked ? 'border-primary bg-primary text-white' : 'border-muted-foreground/45 bg-card'
    ]">
    <CheckIcon v-if="checked" class="size-3" :stroke-width="3" />
  </div>
</template>

<script lang="ts" setup>
import { CheckIcon } from 'lucide-vue-next'

defineProps<{
  /** 是否选中 */
  checked: boolean
}>()
</script>
