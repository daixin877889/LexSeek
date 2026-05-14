<template>
  <div class="flex items-center justify-between mb-2">
    <h1 class="text-[22px] font-bold truncate">{{ title }}</h1>
    <div class="relative">
      <Button variant="ghost" size="icon" @click="isHelpOpen = !isHelpOpen" class="rounded-full">
        <HelpCircle class="h-5 w-5" />
        <span class="sr-only">帮助</span>
      </Button>
      <div
        v-if="isHelpOpen"
        class="absolute right-0 z-50 w-80 mt-2 p-4 bg-card rounded-lg border shadow-lg"
      >
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-semibold text-base">{{ helpTitle ?? title + '说明' }}</h3>
          <Button variant="ghost" size="icon" @click="isHelpOpen = false" class="h-6 w-6">
            <X class="h-5 w-5" />
            <span class="sr-only">关闭</span>
          </Button>
        </div>
        <div class="text-sm space-y-3 max-h-96 overflow-y-auto">
          <slot name="help" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { HelpCircle, X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  /** 页面标题 */
  title: string
  /** 帮助弹层标题（不传则为 title + '说明'） */
  helpTitle?: string
}>(), {
  helpTitle: undefined,
})

/** 帮助弹层开关 */
const isHelpOpen = ref(false)
</script>
