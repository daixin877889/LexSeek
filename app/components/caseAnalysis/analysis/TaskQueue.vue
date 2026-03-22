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
    <AiElementsQueueQueue>
        <AiElementsQueueQueueSection v-for="task in tasks" :key="task.id">
            <AiElementsQueueQueueItem>
                <AiElementsQueueQueueItemIndicator :state="task.status" />
                <AiElementsQueueQueueItemContent>
                    <div class="flex items-center justify-between">
                        <span>{{ task.name }}</span>
                        <Badge v-if="task.points" variant="outline" class="text-xs">{{ task.points }} 积分</Badge>
                    </div>
                </AiElementsQueueQueueItemContent>
            </AiElementsQueueQueueItem>

            <!-- 运行中：显示推理过程 -->
            <AiElementsReasoningReasoning v-if="task.status === 'running'">
                <AiElementsReasoningReasoningContent>
                    <AiElementsLoaderShimmer />
                </AiElementsReasoningReasoningContent>
            </AiElementsReasoningReasoning>

            <!-- 完成：显示结果 -->
            <CaseAnalysisAnalysisTaskResult v-if="task.status === 'completed' && task.result" :result="task.result" :name="task.name" />
        </AiElementsQueueQueueSection>
    </AiElementsQueueQueue>
</template>
