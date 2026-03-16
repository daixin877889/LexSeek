<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-300"
      enter-from-class="translate-y-full opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-200"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-full opacity-0"
    >
      <div v-if="visible" class="fixed bottom-0 left-0 right-0 z-100">
        <div class="bg-card border-t border-border shadow-lg">
          <div class="w-full px-4 py-3 flex items-center justify-between">
            <!-- 左侧：选择和计数 -->
            <div class="flex items-center gap-3">
              <!-- 自定义复选框 - 避免 Shadcn Checkbox 事件问题 -->
              <div
                class="w-5 h-5 rounded border-2 cursor-pointer flex items-center justify-center transition-colors"
                :class="isAllSelected
                  ? 'bg-primary border-primary'
                  : 'bg-white border-gray-300 dark:bg-gray-600 dark:border-gray-400'"
                @click="$emit('selectAll')"
              >
                <svg v-if="isAllSelected" class="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <span class="text-sm text-foreground">已选择 {{ selectedCount }} 个文件</span>
              <Button variant="link" size="sm" @click="$emit('clearSelection')">
                取消选择
              </Button>
            </div>

            <!-- 右侧：删除按钮 -->
            <Button
              variant="destructive"
              @click="$emit('batchDelete')"
              :disabled="deleting"
            >
              <Trash2Icon v-if="!deleting" class="h-4 w-4 mr-1" />
              <div v-else class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1"></div>
              {{ deleting ? '删除中...' : '批量删除' }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts" setup>
import { Trash2Icon } from 'lucide-vue-next'

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
