<template>
  <div>
    <!-- 欢迎消息区域 -->
    <CaseAnalysisWelcome />

    <!-- 输入框 -->
    <CaseAnalysisPromptInput />

    <!-- 案例区：无输入时显示 -->
    <CaseAnalysisExample v-if="!hasPromptInput" />

    <!-- 模块选择区域：有输入时显示 -->
    <CaseAnalysisModuleSelector v-else id="analysis-module-selector" />
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
});

const store = useCaseAnalysisStore()
const { hasPromptInput } = storeToRefs(store)
</script>

<style></style>
