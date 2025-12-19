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
</script>
