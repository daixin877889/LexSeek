<template>
  <div>
    <!-- 欢迎消息区域 -->
    <CaseAnalysisWelcome />

    <!-- 输入框 -->
    <CaseAnalysisPromptInput />

    <!-- 案例区 -->
    <CaseAnalysisExample v-if="false" />

    <!-- 模块选择区域 -->
    <CaseAnalysisModuleSelector id="analysis-module-selector" />
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
});
</script>

<style></style>
