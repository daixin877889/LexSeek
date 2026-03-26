<script setup lang="ts">
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

function toggleExpand() {
  if (props.collapsible) isExpanded.value = !isExpanded.value
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'in_progress': return 'loader'
    case 'completed': return 'check-circle'
    default: return 'circle'
  }
}

function getStatusClass(status: string) {
  switch (status) {
    case 'in_progress': return 'text-blue-500 animate-spin'
    case 'completed': return 'text-green-500'
    default: return 'text-muted-foreground'
  }
}
</script>

<template>
  <div v-if="todos.length > 0" class="border-t bg-muted/10">
    <button
      v-if="collapsible"
      class="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-muted/20"
      @click="toggleExpand"
    >
      <Icon :name="isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'" class="size-4" />
      <span>任务进度 ({{ todos.filter(t => t.status === 'completed').length }}/{{ todos.length }})</span>
    </button>
    <div v-show="isExpanded || !collapsible" class="max-h-40 overflow-y-auto px-4 pb-2">
      <div
        v-for="todo in sortedTodos"
        :key="todo.id"
        class="flex items-center gap-2 py-1 text-sm"
      >
        <Icon :name="`lucide:${getStatusIcon(todo.status)}`" class="size-4 shrink-0" :class="getStatusClass(todo.status)" />
        <span :class="{ 'line-through text-muted-foreground': todo.status === 'completed' }">
          {{ todo.text }}
        </span>
      </div>
    </div>
  </div>
</template>
