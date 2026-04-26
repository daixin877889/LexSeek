<script setup lang="ts">
import CaseAnalysisAnalysisTaskResult from '~/components/caseAnalysis/analysis/TaskResult.vue'
interface TaskItem {
    id: string
    name: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    points?: number
    result?: string
}

defineProps<{
    tasks: TaskItem[]
}>()

/**
 * 映射任务状态到队列指示器状态
 */
const mapStatus = (status: TaskItem['status']): 'pending' | 'in_progress' | 'completed' => {
  switch (status) {
    case 'running':
      return 'in_progress'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'completed' // 失败也显示为完成状态
    default:
      return 'pending'
  }
}
</script>

<template>
    <Queue>
        <QueueSection v-for="task in tasks" :key="task.id">
            <QueueItem>
                <QueueItemContent :completed="task.status === 'completed'">
                    <QueueItemIndicator :status="mapStatus(task.status)" />
                    <span>{{ task.name }}</span>
                    <Badge v-if="task.points" variant="outline" class="text-xs ml-auto">{{ task.points }} 积分</Badge>
                </QueueItemContent>
            </QueueItem>

            <!-- 运行中：显示推理过程 -->
            <Reasoning v-if="task.status === 'running'">
                <ReasoningContent content="">
                    <Shimmer />
                </ReasoningContent>
            </Reasoning>

            <!-- 完成：显示结果 -->
            <CaseAnalysisAnalysisTaskResult v-if="task.status === 'completed' && task.result" :result="task.result" :name="task.name" />
        </QueueSection>
    </Queue>
</template>
