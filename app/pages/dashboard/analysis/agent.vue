<template>
  <div class="h-full flex flex-col" style="height: calc(100vh - 48px)">
    <!-- Header 区域 -->
    <div class="h-12 shrink-0 border-b bg-gray-50 dark:bg-gray-800 text-base font-semibold flex items-center px-4 gap-2">
      <div class="flex-1 truncate">民事案件分析助手</div>
    </div>

    <!-- PC端布局 - ResizablePanelGroup -->
    <ResizablePanelGroup direction="horizontal" class="flex-1">
      <!-- 左侧面板 -->
      <ResizablePanel class="bg-gray-100 dark:bg-gray-700">
        <div>1</div>
      </ResizablePanel>
      <!-- 右侧面板 -->
      <ResizablePanel>
        <div>2</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>
</template>

<script lang="ts" setup>
definePageMeta({
  title: "智能代理",
  layout: "dashboard-layout",
});
</script>

<style></style>
