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
import GeneralAlertDialog from '~/components/general/AlertDialog.vue'
import GeneralWxSupport from '~/components/general/WxSupport.vue'
import { useTheme } from '~/composables/useTheme'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAuthStore } from '~/store/auth'
import { useRoleStore } from '~/store/role'
import { useUserStore } from '~/store/user'
import type { roles } from '~~/generated/prisma/client'
import type { SafeUserInfo } from '~~/server/services/users/userResponse.service'
import { organizationLd, websiteLd } from '#shared/utils/seo/jsonLd'

// 全局 SEO：站长验证 meta + Organization / WebSite JSON-LD
// 把 `seo.siteUrl` 显式传给 helper，消除 helper 默认值与 runtimeConfig 的双轨。
const { seo } = useRuntimeConfig().public
useHead({
  meta: [
    seo.baiduVerify ? { name: 'baidu-site-verification', content: seo.baiduVerify } : null,
    seo.googleVerify ? { name: 'google-site-verification', content: seo.googleVerify } : null,
    seo.bingVerify ? { name: 'msvalidate.01', content: seo.bingVerify } : null,
    seo.sogouVerify ? { name: 'sogou_site_verification', content: seo.sogouVerify } : null,
    seo.so360Verify ? { name: '360-site-verification', content: seo.so360Verify } : null,
  ].filter(Boolean) as { name: string; content: string }[],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify(organizationLd(seo.siteUrl)).replace(/</g, '\\u003c'),
    },
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify(websiteLd(seo.siteUrl)).replace(/</g, '\\u003c'),
    },
  ],
})

const authStore = useAuthStore();
const userStore = useUserStore();
const roleStore = useRoleStore();

// 初始化主题色
const { initTheme } = useTheme();
onMounted(() => {
  initTheme();
});

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
      // 登录成功后，使用 useApiFetch 直接获取用户数据
      try {
        // 并行获取用户信息和角色列表
        const [userInfo, roles_] = await Promise.all([
          useApiFetch<SafeUserInfo>("/api/v1/users/me"),
          useApiFetch<roles[]>("/api/v1/users/roles"),
        ]);

        // 更新用户信息
        if (userInfo) {
          userStore.setUserInfo(userInfo);
        }

        // 更新角色列表并获取当前角色的路由
        if (roles_ && roles_.length > 0) {
          // 使用 setUserRoles 方法设置角色数据
          roleStore.setUserRoles(roles_);
          const firstRoleId = roles_[0]?.id;
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
