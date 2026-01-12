<template>
  <div class="p-4 pt-6 pb-4">
    <!-- 欢迎消息 - 大字体突出显示 -->
    <div class="w-full inline-flex items-center gap-4 px-5 py-4 bg-gradient-custom dark:bg-gradient-custom-dark rounded-md">
      <!-- AI 头像 -->
      <NuxtImg src="/logo-gradient.svg" alt="小索" class="size-14 shrink-0" />
      <!-- 欢迎文字 -->
      <div class="flex flex-col gap-1">
        <span class="text-xl font-bold">你好，我是小索，你的案件分析助手</span>
        <span class="text-muted-foreground">在下方输入框输入你的案件信息，我会为你分析案件</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup></script>

<style></style>
