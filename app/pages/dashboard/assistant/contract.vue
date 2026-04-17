<script setup lang="ts">
/**
 * 法律助手 · 合同审查（WIP 占位页）
 *
 * 第二期上线，当前为占位页，防止 RBAC 菜单跳转 404。
 */
import { HardHatIcon } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard-layout',
  title: '法律助手 · 合同审查',
  icon: 'FileSearch',
})
</script>

<template>
  <div class="flex flex-col items-center justify-center h-[calc(100vh-4rem)] text-muted-foreground">
    <HardHatIcon class="size-16 mb-4 opacity-50" />
    <p class="text-xl font-medium">合同审查功能正在建设中</p>
    <p class="mt-2 text-sm">敬请期待第二期上线</p>
  </div>
</template>
