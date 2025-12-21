<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!-- 全局 Toast 组件 -->
  <Toaster position="top-center" :duration="3000" rich-colors />
</template>

<script setup lang="ts">
import "vue-sonner/style.css";

// 初始化认证状态
const authStore = useAuthStore();
authStore.initAuth();
</script>
