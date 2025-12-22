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
interface BreadcrumbItemType {
  name: string;
  path: string;
  isLast: boolean;
}

const router = useRouter();
const route = useRoute();

// 根据路径查找对应路由的 title
const getTitleForPath = (path: string): string | undefined => {
  const routes = router.getRoutes();
  const matchedRoute = routes.find((r) => r.path === path);
  return matchedRoute?.meta?.title as string | undefined;
};

// 计算面包屑 - 基于 URL 路径段构建层级，从路由 meta 获取 title
const breadcrumbs = computed<BreadcrumbItemType[]>(() => {
  // 获取当前路径，去除首尾斜杠
  const currentPath = route.path.replace(/^\//, "").replace(/\/$/, "");

  if (!currentPath) return [];

  // 分割路径段
  const segments = currentPath.split("/").filter(Boolean);
  const items: BreadcrumbItemType[] = [];
  let accumulatedPath = "";

  segments.forEach((segment, index) => {
    accumulatedPath += `/${segment}`;

    // 优先从路由 meta.title 获取名称
    const title = getTitleForPath(accumulatedPath);

    // 如果没有 title，使用路径段本身（可以做一些基本格式化）
    const name = title || segment;

    items.push({
      name,
      path: accumulatedPath,
      isLast: index === segments.length - 1,
    });
  });

  return items;
});
</script>
