<template>
  <Breadcrumb>
    <BreadcrumbList>
      <BreadcrumbItem>
        <BreadcrumbLink href="/admin">管理后台</BreadcrumbLink>
      </BreadcrumbItem>
      <template v-for="(item, index) in breadcrumbs" :key="index">
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage v-if="index === breadcrumbs.length - 1">
            {{ item.title }}
          </BreadcrumbPage>
          <BreadcrumbLink v-else :href="item.path">
            {{ item.title }}
          </BreadcrumbLink>
        </BreadcrumbItem>
      </template>
    </BreadcrumbList>
  </Breadcrumb>
</template>

<script setup lang="ts">
const route = useRoute()

/** 路由标题映射 */
const routeTitles: Record<string, string> = {
  '/admin/roles': '角色管理',
  '/admin/roles/create': '创建角色',
  '/admin/permissions': '权限管理',
  '/admin/permissions/api': 'API 权限',
  '/admin/permissions/routes': '路由权限',
  '/admin/users': '用户管理',
  '/admin/audit': '审计日志',
}

/** 计算面包屑 */
const breadcrumbs = computed(() => {
  const path = route.path
  const items: { path: string; title: string }[] = []
  
  // 解析路径
  const segments = path.split('/').filter(Boolean)
  let currentPath = ''
  
  for (let i = 1; i < segments.length; i++) {
    currentPath += '/' + segments[i]
    const fullPath = '/admin' + currentPath.replace('/admin', '')
    
    // 查找标题
    let title = routeTitles[fullPath]
    if (!title) {
      // 处理动态路由
      if (segments[i].match(/^\d+$/)) {
        title = '详情'
      } else {
        title = segments[i]
      }
    }
    
    items.push({ path: fullPath, title })
  }
  
  return items
})
</script>
