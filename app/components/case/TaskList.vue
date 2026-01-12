<template>
  <div class="task-list">
    <!-- 标题 -->
    <div v-if="showTitle" class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-foreground">分析进度</h3>
      <span class="text-xs text-muted-foreground">
        {{ completedCount }}/{{ tasks.length }}
      </span>
    </div>

    <!-- 任务列表 -->
    <ScrollArea :class="scrollAreaClass">
      <div class="space-y-1 pr-2">
        <div v-for="task in sortedTasks" :key="task.id"
          class="task-item group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors" :class="[
            getTaskItemClass(task),
            task.status === 'completed' && task.resultId ? 'cursor-pointer' : '',
          ]" @click="handleTaskClick(task)">
          <!-- 状态图标 -->
          <div class="shrink-0">
            <component :is="getStatusIcon(task.status)" class="h-4 w-4" :class="getStatusIconClass(task.status)" />
          </div>

          <!-- 任务信息 -->
          <div class="flex-1 min-w-0">
            <p class="text-sm truncate" :class="getTaskNameClass(task.status)">
              {{ task.name }}
            </p>
            <p v-if="task.description" class="text-xs text-muted-foreground truncate mt-0.5">
              {{ task.description }}
            </p>
          </div>

          <!-- 类型标签 -->
          <Badge v-if="showTypeLabel && task.type === 'checkpoint'" variant="outline" class="shrink-0 text-xs">
            检查点
          </Badge>

          <!-- 跳转图标（已完成且有结果的任务） -->
          <ChevronRightIcon v-if="task.status === 'completed' && task.resultId"
            class="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>

        <!-- 空状态 -->
        <div v-if="tasks.length === 0" class="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <ListTodoIcon class="h-8 w-8 mb-2 opacity-50" />
          <p class="text-sm">暂无分析任务</p>
        </div>
      </div>
    </ScrollArea>

    <!-- 进度条（可选） -->
    <div v-if="showProgress && tasks.length > 0" class="mt-3">
      <Progress :model-value="progressValue" class="h-1.5" />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  CheckCircle2Icon,
  CircleIcon,
  LoaderIcon,
  ChevronRightIcon,
  ListTodoIcon,
} from 'lucide-vue-next'
import type { TaskItem, TaskStatus } from '#shared/types/case'

// 重新导出类型供外部使用
export type { TaskItem, TaskStatus, TaskType } from '#shared/types/case'

/**
 * 组件 Props
 */
interface Props {
  /** 任务列表 */
  tasks?: TaskItem[]
  /** 当前活动任务ID */
  activeTaskId?: string | null
  /** 是否显示标题 */
  showTitle?: boolean
  /** 是否显示进度条 */
  showProgress?: boolean
  /** 是否显示类型标签 */
  showTypeLabel?: boolean
  /** 滚动区域最大高度 */
  maxHeight?: string
}

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 点击任务 */
  (e: 'task-click', task: TaskItem): void
  /** 跳转到结果 */
  (e: 'navigate-to-result', resultId: number): void
}>()

const props = withDefaults(defineProps<Props>(), {
  tasks: () => [],
  activeTaskId: null,
  showTitle: true,
  showProgress: true,
  showTypeLabel: false,
  maxHeight: '300px',
})

// 计算属性
const scrollAreaClass = computed(() => ({
  'max-h-[var(--max-height)]': true,
}))

// 按顺序排序的任务列表
const sortedTasks = computed(() => {
  return [...props.tasks].sort((a, b) => a.order - b.order)
})

// 已完成任务数量
const completedCount = computed(() => {
  return props.tasks.filter(t => t.status === 'completed').length
})

// 进度值（0-100）
const progressValue = computed(() => {
  if (props.tasks.length === 0) return 0
  return Math.round((completedCount.value / props.tasks.length) * 100)
})

/**
 * 获取状态图标
 */
const getStatusIcon = (status: TaskStatus) => {
  switch (status) {
    case 'completed':
      return CheckCircle2Icon
    case 'active':
      return LoaderIcon
    case 'pending':
    default:
      return CircleIcon
  }
}

/**
 * 获取状态图标样式
 */
const getStatusIconClass = (status: TaskStatus): string => {
  switch (status) {
    case 'completed':
      return 'text-green-500'
    case 'active':
      return 'text-primary animate-spin'
    case 'pending':
    default:
      return 'text-muted-foreground/50'
  }
}

/**
 * 获取任务项样式
 */
const getTaskItemClass = (task: TaskItem): string => {
  const baseClass = 'border border-transparent'

  switch (task.status) {
    case 'completed':
      return `${baseClass} bg-green-50/50 dark:bg-green-950/20 hover:bg-green-50 dark:hover:bg-green-950/30`
    case 'active':
      return `${baseClass} bg-primary/5 border-primary/20`
    case 'pending':
    default:
      return `${baseClass} hover:bg-muted/50`
  }
}

/**
 * 获取任务名称样式
 */
const getTaskNameClass = (status: TaskStatus): string => {
  switch (status) {
    case 'completed':
      return 'text-green-700 dark:text-green-400'
    case 'active':
      return 'text-primary font-medium'
    case 'pending':
    default:
      return 'text-muted-foreground'
  }
}

/**
 * 处理任务点击
 */
const handleTaskClick = (task: TaskItem) => {
  emit('task-click', task)

  // 如果是已完成的任务且有结果ID，触发跳转
  if (task.status === 'completed' && task.resultId) {
    emit('navigate-to-result', task.resultId)
  }
}

// CSS 变量
const cssVars = computed(() => ({
  '--max-height': props.maxHeight,
}))
</script>

<style scoped>
.task-list {
  --max-height: v-bind('cssVars["--max-height"]');
}

.task-item {
  /* 任务项基础样式 */
}
</style>
