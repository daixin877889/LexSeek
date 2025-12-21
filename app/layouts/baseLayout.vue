<template>
  <div class="min-h-screen bg-background text-foreground flex flex-col">
    <!-- 头部导航 -->
    <header class="border-b sticky top-0 z-10 bg-background">
      <div class="max-w-[1280px] mx-auto px-4 py-4 flex items-center justify-between">
        <div class="flex items-center gap-6">
          <NuxtLink to="/" class="flex items-center gap-2">
            <!-- <scale-icon class="h-8 w-8 text-primary" /> -->
            <img src="/logo.svg" class="h-6 text-primary" />
            <h1 class="text-xl font-bold">LexSeek｜法索 AI</h1>
          </NuxtLink>

          <!-- 桌面导航菜单 - 放在logo旁边实现左对齐 -->
          <nav class="hidden md:block">
            <ul class="flex gap-6">
              <li>
                <NuxtLink to="/" class="text-sm hover:text-primary transition-colors py-1 block" :class="{ 'text-primary font-medium': $route.path === '/' }"> 首页 </NuxtLink>
              </li>
              <li>
                <NuxtLink to="/features" class="text-sm hover:text-primary transition-colors py-1 block" :class="{ 'text-primary font-medium': $route.path === '/features' }"> 产品功能 </NuxtLink>
              </li>
              <li>
                <NuxtLink to="/pricing" class="text-sm hover:text-primary transition-colors py-1 block" :class="{ 'text-primary font-medium': $route.path === '/pricing' }"> 价格方案 </NuxtLink>
              </li>
              <li>
                <NuxtLink to="/about" class="text-sm hover:text-primary transition-colors py-1 block" :class="{ 'text-primary font-medium': $route.path === '/about' }"> 关于我们 </NuxtLink>
              </li>
            </ul>
          </nav>
        </div>

        <!-- 用户操作区域 -->
        <div class="flex items-center">
          <!-- 用户未登录状态 -->
          <div v-if="!userStore.isAuthenticated" class="hidden md:flex items-center gap-3">
            <NuxtLink to="/login" class="text-sm hover:text-primary transition-colors">登录</NuxtLink>
            <NuxtLink to="/register" class="px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 transition-colors"> 注册 </NuxtLink>
          </div>

          <!-- 用户已登录状态 -->
          <div v-else class="hidden md:flex items-center gap-3">
            <NuxtLink to="/dashboard" class="text-sm hover:text-primary transition-colors">个人中心</NuxtLink>
            <div class="relative" ref="userMenuRef">
              <button @click="toggleUserMenu" class="flex items-center justify-center h-8 w-8 rounded-full bg-muted hover:bg-muted/80 transition-colors">
                <user-icon class="h-5 w-5" />
              </button>

              <!-- 用户菜单下拉框 -->
              <div v-if="userMenuOpen" class="absolute right-0 mt-2 w-48 bg-card rounded-md shadow-lg border overflow-hidden">
                <div class="py-2 px-4 border-b">
                  <p class="font-medium">{{ userStore.getUserName }}</p>
                  <p class="text-xs text-muted-foreground">{{ maskTel(userStore.getUserInfo?.phone) || "" }}</p>
                </div>
                <ul>
                  <li>
                    <NuxtLink to="/dashboard" class="block px-4 py-2 text-sm hover:bg-muted">个人中心</NuxtLink>
                  </li>
                  <li>
                    <NuxtLink to="/dashboard/cases" class="block px-4 py-2 text-sm hover:bg-muted">我的案件</NuxtLink>
                  </li>
                  <li>
                    <NuxtLink to="/dashboard/settings" class="block px-4 py-2 text-sm hover:bg-muted">账户设置</NuxtLink>
                  </li>
                  <li>
                    <button @click="handleLogoutClick" class="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-muted">退出登录</button>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- 移动端菜单按钮 -->
          <button @click="toggleMobileMenu" class="md:hidden p-1 rounded-md hover:bg-muted transition-colors" aria-label="打开菜单">
            <menu-icon v-if="!mobileMenuOpen" class="h-6 w-6" />
            <x-icon v-else class="h-6 w-6" />
          </button>
        </div>
      </div>

      <!-- 移动端菜单 -->
      <div v-if="mobileMenuOpen" class="md:hidden bg-background border-t">
        <div class="w-full mx-auto px-4 py-4">
          <nav>
            <ul class="space-y-4">
              <li>
                <NuxtLink to="/" @click="handleMobileUserMenuClick" class="block py-2 text-sm hover:text-primary transition-colors" :class="{ 'text-primary font-medium': $route.path === '/' }"> 首页 </NuxtLink>
              </li>
              <li>
                <NuxtLink to="/features" @click="handleMobileUserMenuClick" class="block py-2 text-sm hover:text-primary transition-colors" :class="{ 'text-primary font-medium': $route.path === '/features' }"> 产品功能 </NuxtLink>
              </li>
              <li>
                <NuxtLink to="/pricing" @click="handleMobileUserMenuClick" class="block py-2 text-sm hover:text-primary transition-colors" :class="{ 'text-primary font-medium': $route.path === '/pricing' }"> 价格方案 </NuxtLink>
              </li>
              <li>
                <NuxtLink to="/about" @click="handleMobileUserMenuClick" class="block py-2 text-sm hover:text-primary transition-colors" :class="{ 'text-primary font-medium': $route.path === '/about' }"> 关于我们 </NuxtLink>
              </li>
            </ul>
          </nav>

          <!-- 移动端用户未登录状态 -->
          <div v-if="!userStore.isAuthenticated" class="mt-6 pt-6 border-t flex flex-col gap-3">
            <NuxtLink to="/login" class="w-full py-2 text-sm text-center hover:bg-muted rounded-md transition-colors"> 登录 </NuxtLink>
            <NuxtLink to="/register" class="w-full py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 transition-colors text-center"> 注册 </NuxtLink>
          </div>

          <!-- 移动端用户已登录状态 -->
          <div v-else class="mt-6 pt-6 border-t">
            <ul class="space-y-4">
              <li>
                <NuxtLink to="/dashboard" class="block py-2 text-sm hover:text-primary transition-colors">个人中心</NuxtLink>
              </li>
              <li>
                <NuxtLink to="/dashboard/cases" class="block py-2 text-sm hover:text-primary transition-colors">我的案件</NuxtLink>
              </li>
              <li>
                <NuxtLink to="/dashboard/settings" class="block py-2 text-sm hover:text-primary transition-colors">账户设置</NuxtLink>
              </li>
              <li>
                <button @click="handleLogoutClick" class="w-full text-left py-2 text-sm text-red-500">退出登录</button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </header>

    <!-- 路由视图区域 -->
    <main class="flex-1">
      <slot />
    </main>

    <footer class="border-t py-6 bg-muted/30">
      <div class="max-w-[1280px] mx-auto px-4">
        <div class="flex flex-col md:flex-row justify-between items-center">
          <div class="mb-4 md:mb-0 text-center md:text-left">
            <p class="text-sm text-muted-foreground">© 2025 上海盛熙律泓教育科技有限公司｜ <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" class="hover:text-foreground transition-colors"> 沪ICP备2025118451号 </a></p>
            <!-- <p class="text-xs text-muted-foreground mt-1">
              <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" class="hover:text-foreground transition-colors">
                沪ICP备2025118451号
              </a>
            </p> -->
          </div>
          <div class="flex flex-wrap justify-center md:justify-end gap-4">
            <a href="/privacy-agreement" class="text-sm text-muted-foreground hover:text-foreground">隐私政策</a>
            <a href="/terms-of-use" class="text-sm text-muted-foreground hover:text-foreground">使用条款</a>
            <a href="/about/#contact" class="text-sm text-muted-foreground hover:text-foreground">联系我们</a>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ScaleIcon, MenuIcon, XIcon, UserIcon } from "lucide-vue-next";

// 用户菜单状态
const userMenuOpen = ref(false);
const userMenuRef = ref(null);
const authStore = useAuthStore();

// 切换用户菜单
const toggleUserMenu = () => {
  userMenuOpen.value = !userMenuOpen.value;
};

// 处理点击菜单外部关闭菜单
const handleClickOutside = (event) => {
  if (userMenuRef.value && !userMenuRef.value.contains(event.target)) {
    userMenuOpen.value = false;
  }
};

// 监听用户菜单状态变化，添加或移除点击事件监听器
watch(userMenuOpen, (isOpen) => {
  if (isOpen) {
    // 下一个事件循环添加事件监听，避免立即触发
    setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);
  } else {
    document.removeEventListener("click", handleClickOutside);
  }
});

// 移动端菜单状态
const mobileMenuOpen = ref(false);

// 切换移动端菜单
const toggleMobileMenu = () => {
  mobileMenuOpen.value = !mobileMenuOpen.value;
};

// 处理移动端用户菜单点击
const handleMobileUserMenuClick = () => {
  // 在移动设备下点击菜单项时关闭用户菜单
  if (window.innerWidth < 768) {
    // md 断点是 768px
    mobileMenuOpen.value = false;
  }
};

// 处理退出登录点击
const handleLogoutClick = async () => {
  // 在移动设备下点击退出登录时关闭用户菜单
  if (window.innerWidth < 768) {
    userMenuOpen.value = false;
  }
  await handleLogout();
};

// 处理登出逻辑
const handleLogout = async () => {
  try {
    // 使用 store 登出
    await authStore.logout();
    toast.success("登出成功");
    // 延迟跳转，确保Toast能够显示
    router.replace("/");
  } catch (error) {
    logger.error("登出请求失败:", error);
  } finally {
    userMenuOpen.value = false;
    mobileMenuOpen.value = false;
  }
};
</script>
