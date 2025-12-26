<template>
  <div class="p-4">
    <div class="mb-8">
      <h1 class="text-3xl font-bold mb-2">会员中心</h1>
      <p class="text-muted-foreground">管理您的会员信息</p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <!-- 左侧导航 -->
      <div class="lg:col-span-1 hidden md:block">
        <div class="bg-card rounded-lg border overflow-hidden">
          <nav class="flex flex-col">
            <button v-for="item in membershipRoutes" :key="item.url" @click="linkTo(item.url)" :class="['flex items-center gap-2 px-4 py-3 text-sm text-left transition-colors', activeTab === item.url ? 'bg-primary/10 text-primary border-l-2 border-primary' : 'hover:bg-muted']">
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
const router = useRouter();
import { Crown, Ticket, Sparkles, UserPlus, ReceiptJapaneseYen } from "lucide-vue-next";
const membershipRoutes = ref([
  {
    title: "我的会员",
    url: "/dashboard/membership/level",
    icon: Crown,
  },
  {
    title: "兑换会员",
    url: "/dashboard/membership/redeem",
    icon: Ticket,
  },
  {
    title: "我的积分",
    url: "/dashboard/membership/point",
    icon: Sparkles,
  },
  {
    title: "邀请注册",
    url: "/dashboard/membership/invitation",
    icon: UserPlus,
  },
  {
    title: "我的订单",
    url: "/dashboard/membership/order",
    icon: ReceiptJapaneseYen,
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
