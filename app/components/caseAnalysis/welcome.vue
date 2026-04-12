<template>
  <div class="p-4 pt-6 pb-4">
    <!-- 欢迎消息 - 大字体突出显示 -->
    <div class="w-full inline-flex items-center gap-4 px-5 py-4 bg-gradient-custom dark:bg-gradient-custom-dark rounded-md">
      <!-- AI 头像 -->
      <IconXiaosuoIcon class="size-14 shrink-0 animate-float" />
      <!-- 欢迎文字 -->
      <div class="flex flex-col gap-1">
        <span class="text-xl font-bold">{{ title }}</span>
        <span class="text-muted-foreground">{{ subtitle }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
withDefaults(defineProps<{
  title?: string
  subtitle?: string
}>(), {
  title: '你好，我是小索，你的案件分析助手',
  subtitle: '在下方输入框输入你的案件信息，我会为你分析案件',
})
</script>

<style></style>
