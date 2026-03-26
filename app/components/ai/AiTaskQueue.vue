<script setup lang="ts">
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-vue-next'
import type { TodoItem } from './composables/useTaskQueueParser'

interface Props {
  todos: readonly TodoItem[]
  collapsible?: boolean
  defaultExpanded?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  collapsible: true,
  defaultExpanded: true,
})

const isExpanded = ref(props.defaultExpanded)

const sortedTodos = computed(() => {
  const order: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 }
  return [...props.todos].sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1))
})

const completedCount = computed(() =>
  props.todos.filter(t => t.status === 'completed').length,
)

function toggleExpand() {
  if (props.collapsible) isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div v-if="todos.length > 0" class="border-t bg-muted/10">
    <!-- 可折叠头部 -->
    <button
      v-if="collapsible"
      class="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-muted/20"
      @click="toggleExpand"
    >
      <ChevronDownIcon v-if="isExpanded" class="size-4" />
      <ChevronRightIcon v-else class="size-4" />
      <span>任务进度 ({{ completedCount }}/{{ todos.length }})</span>
    </button>

    <!-- 任务列表 -->
    <div v-show="isExpanded || !collapsible" class="max-h-[120px] overflow-y-auto px-4 pb-3">
      <AiElementsQueue>
        <AiElementsQueueItem v-for="todo in sortedTodos" :key="todo.id">
          <AiElementsQueueItemContent :completed="todo.status === 'completed'">
            <AiElementsQueueItemIndicator :status="todo.status" />
            {{ todo.text }}
          </AiElementsQueueItemContent>
        </AiElementsQueueItem>
      </AiElementsQueue>
    </div>
  </div>
</template>
