<template>
  <header class="sticky top-0 z-50 border-b bg-background/85 backdrop-blur-md">
    <div class="max-w-[1280px] mx-auto px-4 py-3.5 flex items-center justify-between">
      <!-- 左侧：logo + 桌面导航 -->
      <div class="flex items-center gap-9">
        <NuxtLink to="/" class="flex items-center gap-2.5">
          <BrandLogo size="md" />
          <span translate="no" class="text-[19px] font-bold whitespace-nowrap">
            法索 AI <span class="text-muted-foreground font-normal">｜</span>LexSeek
          </span>
        </NuxtLink>
        <nav class="hidden md:block">
          <ul class="flex items-center gap-1.5">
            <li v-for="link in NAV_LINKS" :key="link.to">
              <NuxtLink :to="link.to" class="block px-3.5 py-2 rounded-md text-sm transition-colors" :class="isActive(link.to)
                ? 'text-primary font-semibold bg-primary/10'
                : 'text-foreground font-medium hover:bg-primary/5'">{{ link.label }}</NuxtLink>
            </li>
          </ul>
        </nav>
      </div>

      <!-- 右侧：主题切换 + 登录态 + 移动端汉堡 -->
      <div class="flex items-center gap-2">
        <ClientOnly>
          <GeneralThemeToggle />
        </ClientOnly>

        <!-- 未登录（桌面） -->
        <div v-if="!authStore.isAuthenticated" class="hidden md:flex items-center gap-1">
          <NuxtLink :to="loginLink"
            class="px-3.5 py-2 text-sm font-medium text-foreground hover:text-primary transition-colors">登录</NuxtLink>
          <NuxtLink :to="loginLink"
            class="px-[18px] py-2 text-sm font-medium text-white rounded-md bg-linear-to-br from-[#1E9EED] to-[#090380] shadow-[0_6px_16px_-6px_rgba(9,3,128,0.4)] hover:brightness-110 active:scale-[0.98] transition">
            免费注册</NuxtLink>
        </div>

        <!-- 已登录（桌面） -->
        <div v-else class="hidden md:flex items-center gap-3">
          <NuxtLink to="/dashboard" class="text-sm text-foreground hover:text-primary transition-colors">个人中心</NuxtLink>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                class="flex items-center justify-center h-9 w-9 rounded-full bg-muted hover:bg-primary/[0.08] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="用户菜单">
                <User class="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="theme-brand w-56">
              <DropdownMenuLabel class="font-normal">
                <div class="flex flex-col space-y-1">
                  <p class="text-sm font-medium leading-none">{{ userStore.userInfo.name }}</p>
                  <p class="text-xs leading-none text-muted-foreground">{{ maskTel(userStore.userInfo.phone) || "" }}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem as-child class="focus:bg-primary/[0.08]">
                <NuxtLink to="/dashboard" class="cursor-pointer w-full">个人中心</NuxtLink>
              </DropdownMenuItem>
              <DropdownMenuItem as-child class="focus:bg-primary/[0.08]">
                <NuxtLink to="/dashboard/cases" class="cursor-pointer w-full">我的案件</NuxtLink>
              </DropdownMenuItem>
              <DropdownMenuItem as-child class="focus:bg-primary/[0.08]">
                <NuxtLink to="/dashboard/settings" class="cursor-pointer w-full">账户设置</NuxtLink>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-red-500 cursor-pointer focus:bg-red-500/10 focus:text-red-500"
                @click="handleLogout">退出登录</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <!-- 移动端汉堡菜单 -->
        <Sheet v-model:open="mobileMenuOpen">
          <SheetTrigger as-child>
            <button
              class="md:hidden flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground hover:bg-primary/[0.08] hover:text-foreground transition-colors"
              aria-label="打开菜单">
              <Menu class="h-5 w-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" class="theme-brand w-[280px] sm:max-w-[280px] p-0 gap-0">
            <SheetTitle class="sr-only">导航菜单</SheetTitle>
            <SheetDescription class="sr-only">站点导航与登录入口</SheetDescription>
            <div class="flex items-center gap-2.5 px-5 py-5 border-b">
              <BrandLogo size="md" />
              <span translate="no" class="text-base font-bold">
                LexSeek<span class="text-muted-foreground font-normal mx-1">｜</span>法索 AI
              </span>
            </div>
            <nav class="flex-1 flex flex-col gap-1 p-3">
              <NuxtLink v-for="link in NAV_LINKS" :key="link.to" :to="link.to"
                class="px-3.5 py-3 rounded-md text-[15px] transition-colors" :class="isActive(link.to)
                  ? 'text-primary font-semibold bg-primary/10'
                  : 'text-foreground font-medium hover:bg-primary/5'" @click="mobileMenuOpen = false">{{ link.label }}
              </NuxtLink>
            </nav>
            <div class="p-4 border-t">
              <div v-if="!authStore.isAuthenticated" class="flex flex-col gap-2.5">
                <NuxtLink :to="loginLink"
                  class="px-4 py-2.5 rounded-md text-center text-sm font-medium border text-foreground hover:bg-muted transition-colors"
                  @click="mobileMenuOpen = false">登录</NuxtLink>
                <NuxtLink :to="loginLink"
                  class="px-4 py-2.5 rounded-md text-center text-sm font-semibold text-white bg-linear-to-br from-[#1E9EED] to-[#090380] shadow-[0_8px_20px_-8px_rgba(9,3,128,0.4)]"
                  @click="mobileMenuOpen = false">免费注册</NuxtLink>
              </div>
              <div v-else class="flex flex-col gap-1">
                <NuxtLink to="/dashboard"
                  class="px-3.5 py-3 rounded-md text-[15px] font-medium text-foreground hover:bg-primary/5 transition-colors"
                  @click="mobileMenuOpen = false">个人中心</NuxtLink>
                <NuxtLink to="/dashboard/cases"
                  class="px-3.5 py-3 rounded-md text-[15px] font-medium text-foreground hover:bg-primary/5 transition-colors"
                  @click="mobileMenuOpen = false">我的案件</NuxtLink>
                <NuxtLink to="/dashboard/settings"
                  class="px-3.5 py-3 rounded-md text-[15px] font-medium text-foreground hover:bg-primary/5 transition-colors"
                  @click="mobileMenuOpen = false">账户设置</NuxtLink>
                <button
                  class="px-3.5 py-3 rounded-md text-[15px] font-medium text-red-500 text-left hover:bg-red-500/5 transition-colors"
                  @click="handleLogout">退出登录</button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { Menu, User } from "lucide-vue-next"
import BrandLogo from "~/components/general/BrandLogo.vue"
import GeneralThemeToggle from "~/components/general/ThemeToggle.vue"
import { useAuthStore } from "~/store/auth"
import { useUserStore } from "~/store/user"
import { resetAllStore } from "~/utils/resetStore"
import { maskTel } from "#shared/utils/phone"
import toast from "#shared/utils/toast"

const NAV_LINKS = [
  { to: "/", label: "首页" },
  { to: "/features", label: "产品功能" },
  { to: "/pricing", label: "价格方案" },
  { to: "/about", label: "关于我们" },
]

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const userStore = useUserStore()

const mobileMenuOpen = ref(false)

const loginLink = computed(() => `/login?redirect=${route.path}`)

// 首页只在精确匹配时高亮；其它链接命中自身或其子路径时高亮
const isActive = (to: string) => {
  if (to === "/") return route.path === "/"
  return route.path === to || route.path.startsWith(`${to}/`)
}

const handleLogout = async () => {
  try {
    await authStore.logout()
    toast.success("登出成功")
    resetAllStore()
    router.replace("/")
  } catch (error) {
    logger.error("登出请求失败:", error)
  } finally {
    mobileMenuOpen.value = false
  }
}
</script>
