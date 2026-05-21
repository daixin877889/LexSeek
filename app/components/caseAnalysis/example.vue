<template>
  <div v-if="loading || examples.length > 0">
    <div class="p-4">
      <div class="text-[15px] font-semibold text-muted-foreground">{{ title }}</div>

      <div class="grid gap-4 mt-2 grid-cols-1 sm:grid-cols-2">
        <template v-if="loading">
          <Skeleton v-for="i in 2" :key="`sk-${i}`" class="h-24 w-full rounded-md" />
        </template>
        <template v-else>
          <Card v-for="example in examples" :key="example.id"
            :class="[
              'p-4 rounded-xl relative transition-all duration-300',
              selectingId === example.id
                ? 'pointer-events-none opacity-60'
                : 'hover:ring-1 hover:ring-primary hover:bg-primary/2 cursor-pointer',
            ]"
            @click="emit('select', example)">
            <Loader2Icon v-if="selectingId === example.id"
              class="absolute right-3 top-3 size-4 animate-spin text-primary" />
            <CardHeader class="p-0 gap-1">
              <CardTitle class="line-clamp-1 text-sm font-semibold pr-6">{{ example.title }}</CardTitle>
              <CardDescription v-if="example.preview" class="line-clamp-2 text-xs">
                {{ example.preview }}
              </CardDescription>
              <CardDescription v-else-if="example.materialCount > 0" class="line-clamp-2 text-xs text-muted-foreground/70 italic">
                包含 {{ example.materialCount }} 份预设材料
              </CardDescription>
              <div v-if="example.materialCount > 0" class="flex items-center gap-1 mt-1">
                <PaperclipIcon class="size-3 text-muted-foreground" />
                <span class="text-xs text-muted-foreground">{{ example.materialCount }} 个文件</span>
              </div>
            </CardHeader>
          </Card>
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon, PaperclipIcon } from 'lucide-vue-next'
import type { DemoCaseListItem } from '#shared/types/case'

/** 向后兼容的导出类型别名 */
export type ExampleItem = DemoCaseListItem

withDefaults(defineProps<{
  examples?: DemoCaseListItem[]
  title?: string
  loading?: boolean
  selectingId?: number | null
}>(), {
  examples: () => [],
  title: '✨ 或者点击下方案例快速体验',
  loading: false,
  selectingId: null,
})

const emit = defineEmits<{
  select: [example: DemoCaseListItem]
}>()
</script>
