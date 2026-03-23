<script setup lang="ts">
const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: string
}>()
</script>

<template>
    <CaseAnalysisToolsMaterialProcessTool v-if="toolName === 'process_materials'" v-bind="props" />
    <CaseAnalysisToolsPointsReserveTool v-else-if="toolName === 'reserve_points'" v-bind="props" />
    <CaseAnalysisToolsMaterialSearchTool v-else-if="toolName === 'search_case_materials'" v-bind="props" />
    <CaseAnalysisToolsLawSearchTool v-else-if="toolName === 'search_law'" v-bind="props" />
    <CaseAnalysisToolsExtractInfoTool v-else-if="toolName === 'extract_case_info'" v-bind="props" />
    <!-- 默认工具展示 -->
    <AiElementsTool v-else>
        <AiElementsToolHeader :name="toolName" :state="state" />
        <AiElementsToolContent v-if="output">
            <AiElementsToolOutput>
                <pre class="text-xs whitespace-pre-wrap">{{ JSON.stringify(output, null, 2) }}</pre>
            </AiElementsToolOutput>
        </AiElementsToolContent>
    </AiElementsTool>
</template>
