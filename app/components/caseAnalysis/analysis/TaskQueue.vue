<script setup lang="ts">
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
</script>

<template>
    <AiElementsQueue>
        <AiElementsQueueSection v-for="task in tasks" :key="task.id">
            <AiElementsQueueItem>
                <AiElementsQueueItemContent :completed="task.status === 'completed'">
                    <AiElementsQueueItemIndicator :status="task.status" />
                    <span>{{ task.name }}</span>
                    <Badge v-if="task.points" variant="outline" class="text-xs ml-auto">{{ task.points }} 积分</Badge>
                </AiElementsQueueItemContent>
            </AiElementsQueueItem>

            <!-- 运行中：显示推理过程 -->
            <AiElementsReasoning v-if="task.status === 'running'">
                <AiElementsReasoningContent content="">
                    <AiElementsShimmer />
                </AiElementsReasoningContent>
            </AiElementsReasoning>

            <!-- 完成：显示结果 -->
            <CaseAnalysisAnalysisTaskResult v-if="task.status === 'completed' && task.result" :result="task.result" :name="task.name" />
        </AiElementsQueueSection>
    </AiElementsQueue>
</template>
