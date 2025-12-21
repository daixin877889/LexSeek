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
const roleStore = useRoleStore();
// 初始化认证状态

authStore.initAuth();

onMounted(() => {
  if (authStore.isAuthenticated) {
    userStore.fetchUserInfo();
    roleStore.getUserRoles();
  }
  console.log("roleStore.currentRoleIndex", roleStore.currentRoleIndex);
});

// 监听当前角色变化,获取当前角色路由
watch(
  () => roleStore.currentRole,
  async (newVal: roles | undefined) => {
    if (newVal) {
      await roleStore.getUserRouters(newVal.id);
    }
  },
  { immediate: true }
);

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
