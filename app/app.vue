<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!-- 全局 Toast 组件 -->
  <Toaster position="top-center" :duration="3000" rich-colors />
</template>

<script setup lang="ts">
import "vue-sonner/style.css";
const authStore = useAuthStore();
const userStore = useUserStore();
// 初始化认证状态

authStore.initAuth();

onMounted(() => {
  if (authStore.isAuthenticated) userStore.fetchUserInfo();
});

// watch(
//   () => authStore.isAuthenticated,
//   (newVal) => {
//     if (newVal) {
//       userStore.fetchUserInfo();
//     } else {
//       userStore.clearUserInfo();
//     }
//   }
// );
</script>
