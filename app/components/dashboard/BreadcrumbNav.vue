<template>
  <div class="flex items-center">
    <Separator v-if="breadcrumbs.length > 0" orientation="vertical" class="mr-2 h-4 hidden md:flex" />
    <Breadcrumb v-if="breadcrumbs.length > 0">
      <BreadcrumbList>
        <template v-for="(item, index) in breadcrumbs" :key="item.path">
          <!-- 分隔符（第一项之后显示） -->
          <BreadcrumbSeparator v-if="index > 0" />
          <BreadcrumbItem>
            <!-- 最后一项显示为当前页面文本，其他显示为可点击链接 -->
            <BreadcrumbPage v-if="item.isLast">{{ item.name }}</BreadcrumbPage>
            <BreadcrumbLink v-else as-child>
              <NuxtLink :to="item.path" class="transition-colors hover:text-foreground">
                {{ item.name }}
              </NuxtLink>
            </BreadcrumbLink>
          </BreadcrumbItem>
        </template>
      </BreadcrumbList>
    </Breadcrumb>
  </div>
</template>

<script setup lang="ts">
// 面包屑项类型
interface BreadcrumbItem {
  name: string;
  path: string;
  isLast: boolean;
}

// 路由名称映射表（路径段 -> 显示名称）
const pathNameMap: Record<string, string> = {
  dashboard: "工作台",
  cases: "我的案件",
  analysis: "案件分析",
  agent: "AI 分析",
  settings: "账户设置",
  membership: "会员中心",
  "disk-space": "存储空间",
  tools: "办案工具",
  interest: "利息计算",
  "court-fee": "诉讼费用",
  "lawyer-fee": "律师费用",
  "delay-interest": "延迟履行利息",
  "bank-rate": "银行利率查询",
  "date-calculator": "日期推算",
  compensation: "赔偿计算器",
  overtime: "加班计算",
  "divorce-property": "离婚财产分割",
  "social-insurance": "社保追缴",
};

const route = useRoute();

// 计算面包屑
const breadcrumbs = computed<BreadcrumbItem[]>(() => {
  // 获取当前路径，去除开头的斜杠
  const currentPath = route.path.replace(/^\//, "").replace(/\/$/, "");

  // 如果路径为空或只是根路径，返回空数组
  if (!currentPath) {
    return [];
  }

  // 分割路径段
  const segments = currentPath.split("/").filter(Boolean);

  // 构建面包屑数组
  const items: BreadcrumbItem[] = [];
  let accumulatedPath = "";

  segments.forEach((segment, index) => {
    accumulatedPath += `/${segment}`;

    // 获取显示名称：优先使用映射表，其次使用路由 meta.title，最后使用路径段本身
    const matchedRoute = route.matched.find((r) => r.path === accumulatedPath || r.path === accumulatedPath + "/");
    const metaTitle = matchedRoute?.meta?.title as string | undefined;
    const name = pathNameMap[segment] || metaTitle || segment;

    items.push({
      name,
      path: accumulatedPath,
      isLast: index === segments.length - 1,
    });
  });

  return items;
});
</script>
