<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!-- 全局 Toast 组件 -->
  <Toaster position="top-center" :offset="{ top: '60px' }" :duration="3000" rich-colors />
  <!-- 全局确认对话框 -->
  <GeneralAlertDialog />
  <!-- 微信客服二维码弹框 -->
  <GeneralWxSupport />
</template>

<script setup lang="ts">
import "vue-sonner/style.css";

const authStore = useAuthStore();
const userStore = useUserStore();
const roleStore = useRoleStore();

// 同步初始化认证状态（从 cookie 读取，SSR 和客户端都安全执行）
authStore.initAuth();

// 已认证时，初始化用户数据（利用 useFetch 水合特性，await 确保 SSR 等待数据）
if (authStore.isAuthenticated) {
  // 并行初始化用户信息和角色列表
  const [, rolesResult] = await Promise.all([userStore.initUserInfo(), roleStore.initUserRoles()]);

  // 角色数据加载完成后，初始化当前角色的路由
  if (rolesResult.data.value && rolesResult.data.value.length > 0) {
    const firstRoleId = rolesResult.data.value[0]?.id;
    if (firstRoleId) {
      await roleStore.initUserRouters(firstRoleId);
    }
  }
}

// 监听登录状态变化，客户端按需重新获取数据
watch(
  () => authStore.isAuthenticated,
  async (isAuth, oldIsAuth) => {
    // 仅在客户端执行
    if (!import.meta.client) return;

    // 状态从 false 变为 true（登录成功）
    if (isAuth && !oldIsAuth) {
      // 登录成功后，使用 $fetch 直接获取用户数据（避免 useFetch 在组件挂载后调用的警告）
      try {
        // 并行获取用户信息和角色列表
        const [userResponse, rolesResponse] = await Promise.all([
          $fetch<ApiBaseResponse<SafeUserInfo>>("/api/v1/users/me"),
          $fetch<ApiBaseResponse<roles[]>>("/api/v1/users/roles"),
        ]);

        // 更新用户信息
        if (userResponse.success && userResponse.data) {
          userStore.setUserInfo(userResponse.data);
        }

        // 更新角色列表并获取当前角色的路由
        if (rolesResponse.success && rolesResponse.data && rolesResponse.data.length > 0) {
          // 使用 setUserRoles 方法设置角色数据
          roleStore.setUserRoles(rolesResponse.data);
          const firstRoleId = rolesResponse.data[0]?.id;
          if (firstRoleId) {
            await roleStore.fetchUserRouters(firstRoleId);
          }
        }
      } catch (err) {
        logger.error("登录后获取用户数据失败:", err);
      }
    }
    // 状态从 true 变为 false（登出）
    else if (!isAuth && oldIsAuth) {
      userStore.clearUserInfo();
      roleStore.clearRoleData();
    }
  }
);

// 监听当前角色变化，获取对应的权限路由
watch(
  () => roleStore.currentRoleIndex,
  async (newIndex, oldIndex) => {
    // 仅在客户端且角色索引真正变化时执行
    if (import.meta.client && oldIndex !== undefined && newIndex !== oldIndex) {
      if (roleStore.currentRole?.id) {
        await roleStore.fetchUserRouters(roleStore.currentRole.id);
      }
    }
  }
);
</script>
