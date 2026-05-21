<template>
  <Breadcrumb>
    <BreadcrumbList>
      <BreadcrumbItem>
        <BreadcrumbLink href="/admin">管理后台</BreadcrumbLink>
      </BreadcrumbItem>
      <template v-for="(item, index) in breadcrumbs" :key="index">
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage v-if="index === breadcrumbs.length - 1 || !item.clickable">
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

/** 动态面包屑标题（由页面设置） */
const dynamicBreadcrumbTitle = useState<string | null>('breadcrumb-dynamic-title', () => null)

/** 路由标题映射（作为备用） */
const routeTitles: Record<string, string> = {
  // 角色权限
  '/admin/roles': '角色管理',
  '/admin/roles/create': '创建角色',
  '/admin/permissions': '权限管理',
  '/admin/permissions/api': 'API 权限',
  '/admin/permissions/routes': '路由权限',
  '/admin/users': '用户管理',
  '/admin/audit': '审计日志',
  // 兑换码
  '/admin/redemption-codes': '兑换码管理',
  '/admin/redemption-codes/records': '兑换记录',
  // 权益
  '/admin/benefits': '权益类型',
  '/admin/benefits/membership': '会员权益',
  '/admin/benefits/grant': '用户权益发放',
  // 法律法规
  '/admin/legal-main': '法律法规',
  '/admin/legal-main/create': '添加法律法规',
  '/admin/legal-main/edit': '编辑法律法规',
  '/admin/legal-main/detail': '法规详情',
  '/admin/legal-main/articles': '条文列表',
  '/admin/legal-main/embeddings': '向量化',
  '/admin/legal-main/full-update': '全量更新',
  // 模型管理
  '/admin/model-providers': '模型提供商',
  '/admin/model-api-keys': 'API 密钥管理',
  '/admin/models': '模型列表',
  // 营销活动
  '/admin/campaigns': '营销活动',
  // 商品管理
  '/admin/products': '商品管理',
  // 利率管理
  '/admin/rates': '利率管理',
}

/** 计算面包屑 */
const breadcrumbs = computed(() => {
  const path = route.path
  const items: { path: string; title: string; clickable: boolean }[] = []

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
    let clickable = true // 默认可点击

    if (isLastSegment && pageTitle) {
      title = pageTitle
      clickable = false // 最后一级不可点击
    } else if (routeTitles[fullPath]) {
      title = routeTitles[fullPath]!
      // 检查下一个 segment 是否是 UUID，如果是，说明当前路径需要参数，不可点击
      const nextSegment = segments[i + 1]
      if (nextSegment && isUUID(nextSegment)) {
        clickable = false
      }
    } else if (isUUID(segment) && dynamicBreadcrumbTitle.value) {
      // 如果是 UUID 且有动态标题，使用动态标题
      title = dynamicBreadcrumbTitle.value
      clickable = false // UUID 参数不可点击
    } else if (segment.match(/^\d+$/)) {
      title = '详情'
      clickable = false
    } else if (isUUID(segment)) {
      title = '详情'
      clickable = false
    } else {
      title = segment
      clickable = false // 未知路径不可点击
    }

    items.push({ path: fullPath, title, clickable })
  }

  return items
})

/** 判断是否为 UUID 格式 */
function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}
</script>
