<template>
  <div class="flex items-center">
    <Separator v-if="breadcrumbs.length > 0" orientation="vertical" class="mr-2 h-4 hidden md:flex" />
    <Breadcrumb v-if="breadcrumbs.length > 0">
      <BreadcrumbList>
        <!-- 如果当前不是工作台页面，显示工作台链接 -->
        <BreadcrumbItem v-if="!(route.name === 'dashboard-default' || route.path === '/dashboard')">
          <router-link to="/dashboard" class="transition-colors hover:text-foreground"> 工作台 </router-link>
        </BreadcrumbItem>
        <template v-for="(item, index) in breadcrumbs" :key="index">
          <!-- 如果当前不是工作台页面或者不是第一个面包屑项，才显示分隔符 -->
          <BreadcrumbSeparator v-if="!(route.name === 'dashboard-default' || route.path === '/dashboard') || index > 0" />
          <BreadcrumbItem>
            <router-link v-if="!item.isLast" :to="item.path" class="transition-colors hover:text-foreground">
              {{ item.name }}
            </router-link>
            <BreadcrumbPage v-else>{{ item.name }}</BreadcrumbPage>
          </BreadcrumbItem>
        </template>
      </BreadcrumbList>
    </Breadcrumb>
  </div>
</template>

<script setup>
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";

const route = useRoute();

// watch(route, () => {
//   console.log(route);
// });

// 面包屑映射表
const breadcrumbMap = {
  dashboard: "工作台",
  "dashboard-default": "工作台",
  cases: "我的案件",
  "case-detail": "案件详情",
  analysis: "案件分析",
  settings: "账户设置",
  ProfileSettings: "个人资料",
  SecuritySettings: "安全设置",
  BillingSettings: "积分与账单",
  NotificationsSettings: "通知设置",
  redeem: "兑换会员",
  chat: "聊天",
  tools: "办案工具",
};

// 计算面包屑
const breadcrumbs = computed(() => {
  try {
    // 获取当前匹配的路由
    const matched = route.matched;

    // 如果是工作台页面，只显示"工作台"一项
    if (route.name === "dashboard-default" || route.path === "/dashboard") {
      return [
        {
          name: "工作台",
          path: "/dashboard",
          isLast: true,
        },
      ];
    }

    // 构建面包屑数据
    const breadcrumbItems = [];
    let parentRoutes = [];

    // 从当前路由获取路径配置
    matched.forEach((routeItem) => {
      // 跳过DashboardLayout布局路由和首页/工作台路由
      if (routeItem.name === "dashboard-layout" || routeItem.name === "dashboard" || routeItem.name === "dashboard-default") {
        return;
      }

      // 获取路由元数据
      const meta = routeItem.meta || {};

      // 获取显示名称
      const name = breadcrumbMap[routeItem.name] || meta.title || routeItem.name;

      // 如果当前路由显示名称是"工作台"，则跳过（避免重复）
      if (name === "工作台") {
        return;
      }

      // 动态路由参数替换
      let path = routeItem.path;
      if (path.includes(":")) {
        Object.keys(route.params).forEach((param) => {
          path = path.replace(`:${param}`, route.params[param]);
        });
      }

      // 如果路由元数据中指定了父路由，先添加父路由
      if (meta.breadcrumbParent && !parentRoutes.includes(meta.breadcrumbParent)) {
        // 如果父路由是dashboard相关，则跳过（避免重复）
        if (meta.breadcrumbParent === "dashboard" || meta.breadcrumbParent === "dashboard-default") {
          return;
        }

        // 获取父路由名称
        const parentName = breadcrumbMap[meta.breadcrumbParent] || meta.breadcrumbParent;

        // 如果父路由显示名称是"工作台"，则跳过（避免重复）
        if (parentName === "工作台") {
          return;
        }

        // 构建父路由路径 (默认格式：/dashboard/parent-name)
        const parentPath = `/dashboard/${meta.breadcrumbParent.toLowerCase().replace(/_/g, "-")}`;

        breadcrumbItems.push({
          name: parentName,
          path: parentPath,
          isLast: false,
        });

        parentRoutes.push(meta.breadcrumbParent);
      }

      // 添加当前路由到面包屑
      breadcrumbItems.push({
        name,
        path,
        isLast: routeItem === matched[matched.length - 1], // 最后一个为当前页面
      });
    });

    // 特殊处理：规范化面包屑项目路径
    breadcrumbItems.forEach((item) => {
      // 确保路径以/开头
      if (item.path && !item.path.startsWith("/")) {
        item.path = "/" + item.path;
      }

      // 如果是dashboard下的直接子路由，确保路径格式正确
      if (!item.path.includes("/dashboard/") && item.path !== "/dashboard") {
        const pathSegments = item.path.split("/").filter(Boolean);
        if (pathSegments.length === 1) {
          item.path = `/dashboard/${pathSegments[0]}`;
        }
      }
    });

    // 确保面包屑中不存在重复项
    const uniqueBreadcrumbs = [];
    const paths = new Set();

    breadcrumbItems.forEach((item) => {
      if (!paths.has(item.path)) {
        paths.add(item.path);
        uniqueBreadcrumbs.push(item);
      }
    });

    // 重设最后一项为最终项
    if (uniqueBreadcrumbs.length > 0) {
      uniqueBreadcrumbs.forEach((item) => (item.isLast = false));
      uniqueBreadcrumbs[uniqueBreadcrumbs.length - 1].isLast = true;
    }

    return uniqueBreadcrumbs;
  } catch (error) {
    logger.error("面包屑计算出错:", error);
    return [];
  }
});
</script>
