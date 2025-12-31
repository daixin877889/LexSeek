<template>
  <NuxtLayout name="admin-layout">
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-bold">管理后台</h1>
        <p class="text-muted-foreground">RBAC 权限管理系统</p>
      </div>

      <!-- 快捷入口卡片 -->
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card v-for="item in quickLinks" :key="item.path"
          class="shadow-none hover:bg-muted/50 transition-colors cursor-pointer" @click="navigateTo(item.path)">
          <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle class="text-sm font-medium">{{ item.title }}</CardTitle>
            <component :is="item.icon" class="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p class="text-xs text-muted-foreground">{{ item.description }}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { Shield, Key, Users, FileText } from 'lucide-vue-next'

definePageMeta({
  layout: false,
  title: "管理后台"
})

/** 快捷入口 */
const quickLinks = [
  {
    path: '/admin/roles',
    title: '角色管理',
    description: '管理系统角色，配置角色权限',
    icon: Shield,
  },
  {
    path: '/admin/permissions/api',
    title: 'API 权限',
    description: '管理 API 接口权限资源',
    icon: Key,
  },
  {
    path: '/admin/users',
    title: '用户管理',
    description: '管理用户角色分配',
    icon: Users,
  },
  {
    path: '/admin/audit',
    title: '审计日志',
    description: '查看权限变更记录',
    icon: FileText,
  },
]
</script>
