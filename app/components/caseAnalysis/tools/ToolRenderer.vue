<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

const emit = defineEmits<{
    confirm: [caseInfo: any]
    reject: []
}>()
</script>

<template>
    <CaseAnalysisToolsMaterialProcessTool v-if="toolName === 'process_materials'" v-bind="props" />
    <CaseAnalysisToolsPointsReserveTool v-else-if="toolName === 'reserve_points'" v-bind="props" />
    <CaseAnalysisToolsConfirmPointsTool v-else-if="toolName === 'confirm_points'" v-bind="props" />
    <CaseAnalysisToolsRollbackPointsTool v-else-if="toolName === 'rollback_points'" v-bind="props" />
    <CaseAnalysisToolsWriteTodosTool v-else-if="toolName === 'write_todos'" v-bind="props" />
    <CaseAnalysisToolsMaterialSearchTool v-else-if="toolName === 'search_case_materials'" v-bind="props" />
    <CaseAnalysisToolsLawSearchTool v-else-if="toolName === 'search_law'" v-bind="props" />
    <!-- 默认工具展示：使用 ai-elements 标准组件显示完整输入/输出/错误 -->
    <AiElementsTool v-else>
        <AiElementsToolHeader :title="toolName" :type="`tool-${toolName}`" :state="state" />
        <AiElementsToolContent>
            <AiElementsToolInput v-if="input" :input="input" />
            <AiElementsToolOutput v-if="output != null"
                :output="output"
                :error-text="state === 'output-error' ? String(output) : undefined"
            />
        </AiElementsToolContent>
    </AiElementsTool>
</template>
