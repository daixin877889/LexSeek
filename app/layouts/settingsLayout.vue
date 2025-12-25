<template>
  <div class="p-4">
    <div class="mb-8">
      <h1 class="text-3xl font-bold mb-2">账户设置</h1>
      <p class="text-muted-foreground">管理您的个人信息和账户设置</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <!-- 左侧导航 -->
      <div class="lg:col-span-1 hidden md:block">
        <div class="bg-card rounded-lg border overflow-hidden">
          <nav class="flex flex-col">
            <button v-for="item in settingsRoutes" :key="item.url" @click="linkTo(item.url)" :class="['flex items-center gap-2 px-4 py-3 text-sm text-left transition-colors', activeTab === item.url ? 'bg-primary/10 text-primary border-l-2 border-primary' : 'hover:bg-muted']">
              <component :is="item.icon" class="h-4 w-4" />
              <span>{{ item.title }}</span>
            </button>
          </nav>
        </div>
      </div>

      <!-- 右侧内容 -->
      <div class="lg:col-span-3">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// import { ref, onMounted, watch } from "vue";
// import { useRouter } from "vue-router";
// import { useMenuStore } from "@/stores";
const router = useRouter();
// const menuStore = useMenuStore();
import { UserIcon, LockIcon, FileLockIcon } from "lucide-vue-next";
const settingsRoutes = ref([
  {
    title: "个人资料",
    url: "/dashboard/settings/profile",
    icon: UserIcon,
  },
  {
    title: "安全设置",
    url: "/dashboard/settings/security",
    icon: LockIcon,
  },
  {
    title: "文件加密",
    url: "/dashboard/settings/file-encryption",
    icon: FileLockIcon,
  },
]);

// 当前激活的标签页
const activeTab = ref("");

// 路由变化时更新激活的标签页
watch(
  () => useRoute().path,
  (newPath) => {
    activeTab.value = newPath;
  }
);

onMounted(() => {
  activeTab.value = useRoute().path;
});

const linkTo = (url: string) => {
  navigateTo(url);
};
</script>
