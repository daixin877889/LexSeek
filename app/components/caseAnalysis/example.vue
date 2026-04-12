<template>
  <div v-if="loading || examples.length > 0">
    <div class="p-4">
      <div class="text-base font-bold text-muted-foreground">{{ title }}</div>

      <div class="grid gap-4 mt-2 grid-cols-1 sm:grid-cols-2">
        <template v-if="loading">
          <Skeleton v-for="i in 2" :key="`sk-${i}`" class="h-20 w-full rounded-md" />
        </template>
        <template v-else>
          <Card v-for="example in examples" :key="example.id"
            :class="[
              'p-4 shadow-none rounded-md relative transition-all duration-300',
              selectingId === example.id
                ? 'pointer-events-none opacity-60'
                : 'hover:ring-1 hover:ring-primary hover:bg-primary/2 cursor-pointer',
            ]"
            @click="emit('select', example)">
            <Loader2Icon v-if="selectingId === example.id"
              class="absolute right-3 top-3 size-4 animate-spin text-primary" />
            <CardHeader class="p-0">
              <CardTitle class="line-clamp-1 text-sm font-bold">{{ example.title }}</CardTitle>
              <CardDescription class="line-clamp-2">{{ example.description }}</CardDescription>
            </CardHeader>
          </Card>
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon } from 'lucide-vue-next'
import type { DemoCaseListItem } from '#shared/types/case'

/** 向后兼容的导出类型别名 */
export type ExampleItem = DemoCaseListItem

withDefaults(defineProps<{
  examples: DemoCaseListItem[]
  title?: string
  loading?: boolean
  selectingId?: number | null
}>(), {
  title: '✨ 或者点击下方案例快速体验',
  loading: false,
  selectingId: null,
})

const emit = defineEmits<{
  select: [example: DemoCaseListItem]
}>()
</script>
