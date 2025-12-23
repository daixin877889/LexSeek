<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button class="p-2 rounded-md hover:bg-gray-100 transition-colors focus:outline-none">
        <User class="h-6 w-6" />
      </button>
    </DropdownMenuTrigger>
    <!-- 用户菜单 -->
    <DropdownMenuContent class="min-w-56 rounded-lg" side="bottom" align="end" :side-offset="8">
      <DropdownMenuLabel class="p-0 font-normal">
        <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
          <Avatar class="h-8 w-8 rounded-lg">
            <AvatarFallback class="rounded-lg"> LS </AvatarFallback>
          </Avatar>
          <div class="grid flex-1 text-left text-sm leading-tight">
            <span class="truncate font-semibold">{{ userStore.userInfo?.name || "用户" }}</span>
            <span class="truncate text-xs">{{ maskTel(userStore.userInfo?.phone) }}</span>
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <!-- TODO: 获取用户菜单 -->
        <NuxtLink v-for="route in [{ url: '/dashboard', title: '首页', icon: HomeIcon }]" :to="route.url" :key="route.title" class="my-3">
          <DropdownMenuItem>
            <component :is="route.icon" />
            {{ route.title }}
          </DropdownMenuItem>
        </NuxtLink>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem @click="handleLogoutClick" class="text-red-500 data-highlighted:bg-red-50 data-highlighted:text-red-600 group cursor-pointer">
        <LogOut class="mr-2 h-4 w-4 group-hover:text-red-600" />
        <span class="group-hover:text-red-600">退出登录</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { User, HomeIcon, LogOut } from "lucide-vue-next";

const userStore = useUserStore();
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

// 处理退出登录点击
const handleLogoutClick = async () => {
  await authStore.logout();

  // 重置所有 store 的状态
  resetAllStore();
  // 跳转至登录页面
  router.replace({
    path: "/login",
  });
};
</script>
