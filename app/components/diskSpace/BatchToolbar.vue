<template>
  <!-- 批量操作栏：absolute 定位，仅覆盖云盘空间页面区域（不遮挡 dashboard 侧边导航） -->
  <Transition
    enter-active-class="transition-all duration-300"
    enter-from-class="translate-y-full opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition-all duration-200"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-full opacity-0"
  >
    <div v-if="visible" class="absolute inset-x-0 bottom-0 z-40">
      <div class="border-t border-border bg-card shadow-lg">
        <div class="flex w-full items-center justify-between px-4 py-3">
          <!-- 左侧：全选 + 计数 -->
          <div class="flex items-center gap-3">
            <DiskCheckbox :checked="isAllSelected" @click="$emit('selectAll')" />
            <span class="text-sm text-foreground">已选择 {{ selectedCount }} 个文件</span>
            <Button variant="link" size="sm" @click="$emit('clearSelection')">
              取消选择
            </Button>
          </div>

          <!-- 右侧：批量删除 -->
          <Button variant="destructive" :disabled="deleting" @click="$emit('batchDelete')">
            <Trash2Icon v-if="!deleting" class="h-4 w-4 mr-1" />
            <div v-else class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
            {{ deleting ? '删除中...' : '批量删除' }}
          </Button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import { Trash2Icon } from 'lucide-vue-next'
import DiskCheckbox from '~/components/diskSpace/Checkbox.vue'

interface Props {
  selectedCount: number
  totalCount: number
  isAllSelected: boolean
  visible: boolean
  deleting?: boolean
}

defineProps<Props>()

defineEmits<{
  (e: 'selectAll'): void
  (e: 'clearSelection'): void
  (e: 'batchDelete'): void
}>()
</script>
