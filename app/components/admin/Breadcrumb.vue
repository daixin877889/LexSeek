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

/** 路由标题映射（作为备用） */
const routeTitles: Record<string, string> = {
  '/admin/roles': '角色管理',
  '/admin/roles/create': '创建角色',
  '/admin/permissions': '权限管理',
  '/admin/permissions/api': 'API 权限',
  '/admin/permissions/routes': '路由权限',
  '/admin/users': '用户管理',
  '/admin/audit': '审计日志',
  '/admin/redemption-codes': '兑换码管理',
  '/admin/redemption-codes/records': '兑换记录',
  '/admin/benefits': '权益类型',
  '/admin/benefits/membership': '会员权益',
  '/admin/benefits/grant': '用户权益发放',
}

/** 计算面包屑 */
const breadcrumbs = computed(() => {
  const path = route.path
  const items: { path: string; title: string }[] = []

  // 优先使用页面 meta 中的 title
  const pageTitle = route.meta.title as string | undefined

  // 解析路径
  const segments = path.split('/').filter(Boolean)
  let currentPath = ''

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i]!
    currentPath += '/' + segment
    const fullPath = '/admin' + currentPath.replace('/admin', '')
    const isLastSegment = i === segments.length - 1

    // 查找标题：最后一级优先使用 pageTitle，否则使用映射或路径名
    let title: string
    if (isLastSegment && pageTitle) {
      title = pageTitle
    } else if (routeTitles[fullPath]) {
      title = routeTitles[fullPath]!
    } else if (segment.match(/^\d+$/)) {
      title = '详情'
    } else {
      title = segment
    }

    items.push({ path: fullPath, title })
  }

  return items
})
</script>
