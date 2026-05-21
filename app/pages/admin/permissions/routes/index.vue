<template>
    <div class="theme-brand space-y-6">
      <!-- 页面标题 -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl md:text-3xl font-bold mb-1">路由权限管理</h1>
          <p class="text-muted-foreground text-sm">管理前端路由权限资源</p>
        </div>
        <Button :class="['w-full md:w-auto', adminBrandPrimaryButtonClass]" @click="openScanDialog">
          <ScanLine class="h-4 w-4 mr-2" />
          扫描路由
        </Button>
      </div>

      <!-- 搜索和筛选 -->
      <div class="flex flex-col md:flex-row gap-4">
        <Input v-model="searchKeyword" placeholder="搜索路由名称或路径..." :class="['md:max-w-sm', adminBrandFocusClass]" @keyup.enter="handleSearch" />
        <Select v-model="groupFilter">
          <SelectTrigger :class="['w-full md:w-40', adminBrandFocusClass]">
            <SelectValue placeholder="路由组" />
          </SelectTrigger>
          <SelectContent class="theme-brand">
            <SelectItem value="all">全部分组</SelectItem>
            <SelectItem v-for="group in groups" :key="group.id" :value="String(group.id)">{{ group.name }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="menuFilter">
          <SelectTrigger :class="['w-full md:w-32', adminBrandFocusClass]">
            <SelectValue placeholder="菜单类型" />
          </SelectTrigger>
          <SelectContent class="theme-brand">
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="true">菜单</SelectItem>
            <SelectItem value="false">非菜单</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" :class="adminBrandFocusClass" @click="handleSearch">
          <Search class="h-4 w-4 mr-2" />
          搜索
        </Button>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="flex justify-center py-12">
        <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
      </div>

      <!-- 空状态 -->
      <div v-else-if="!routers.length" class="flex flex-col items-center justify-center py-12 text-center">
        <Route class="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 class="text-lg font-medium mb-1">暂无路由权限数据</h3>
        <p class="text-muted-foreground text-sm mb-4">请先扫描并导入路由权限</p>
        <Button :class="adminBrandPrimaryButtonClass" @click="openScanDialog">
          <ScanLine class="h-4 w-4 mr-2" />
          扫描路由
        </Button>
      </div>

      <!-- 路由列表 -->
      <template v-else>
        <div class="bg-card rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="px-4 py-3">路由名称</TableHead>
                <TableHead class="px-4 py-3">标题</TableHead>
                <TableHead class="px-4 py-3">路径</TableHead>
                <TableHead class="w-24 px-4 py-3">分组</TableHead>
                <TableHead class="w-20 px-4 py-3 text-center">菜单</TableHead>
                <TableHead class="w-24 px-4 py-3 text-center">排序</TableHead>
                <TableHead class="w-20 px-4 py-3 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="router in routers" :key="router.id" class="hover:bg-muted/30">
                <TableCell class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <component v-if="router.icon" :is="getIcon(router.icon) as any" />
                    <span class="font-medium">{{ router.name }}</span>
                  </div>
                </TableCell>
                <TableCell class="px-4 py-3 text-sm">{{ router.title }}</TableCell>
                <TableCell class="px-4 py-3">
                  <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ router.path }}</code>
                </TableCell>
                <TableCell class="px-4 py-3">
                  <Badge variant="outline" :class="adminBrandChipClass">{{ router.routerGroups?.name || '-' }}</Badge>
                </TableCell>
                <TableCell class="px-4 py-3 text-center">
                  <Switch :model-value="router.isMenu"
                    :class="adminBrandSwitchClass"
                    @update:model-value="(checked: boolean) => handleToggleMenu(router, checked)" />
                </TableCell>
                <TableCell class="px-4 py-3 text-center">
                  <Input type="number" :model-value="router.sort" min="0" :class="['w-16 h-8 text-center text-sm', adminBrandFocusClass]"
                    @change="(e: Event) => handleUpdateSort(router, (e.target as HTMLInputElement).value)" />
                </TableCell>
                <TableCell class="px-4 py-3 text-center">
                  <Button variant="ghost" size="icon" :class="['h-8 w-8 text-destructive hover:text-destructive', adminBrandFocusClass]"
                    @click="handleDelete(router)">
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <!-- 分页 -->
        <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total"
          @change="changePage" />
      </template>
    </div>

    <!-- 扫描路由对话框 -->
    <Dialog v-model:open="scanDialogOpen">
      <DialogContent class="theme-brand !max-w-5xl w-[95vw] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>扫描路由</DialogTitle>
          <DialogDescription>
            扫描 app/pages 目录下的所有页面文件，选择需要导入的路由
          </DialogDescription>
        </DialogHeader>

        <!-- 扫描中状态 -->
        <div v-if="scanning" class="flex flex-col items-center justify-center py-12">
          <Loader2 class="h-10 w-10 animate-spin text-primary mb-4" />
          <p class="text-muted-foreground">正在扫描路由...</p>
        </div>

        <!-- 扫描结果 -->
        <template v-else-if="scanResults.length">
          <!-- 统计信息 -->
          <div class="flex items-center gap-4 text-sm text-muted-foreground mb-4">
            <span>共扫描到 {{ scanStats.total }} 个路由</span>
            <span class="text-primary">新增 {{ scanStats.new }} 个</span>
            <span class="text-muted-foreground">已存在 {{ scanStats.existing }} 个</span>
          </div>

          <!-- 全选操作 -->
          <div class="flex items-center gap-4 mb-2">
            <Checkbox :model-value="isAllSelected" :indeterminate="isIndeterminate"
              :class="adminBrandCheckboxClass"
              @update:model-value="toggleSelectAll" />
            <span class="text-sm">全选新路由</span>
            <span class="text-xs text-muted-foreground">(已选 {{ selectedCount }} 个)</span>
          </div>

          <!-- 路由列表 -->
          <div class="min-h-0 flex-1 overflow-auto rounded-lg border">
            <Table>
              <TableHeader class="sticky top-0 z-10 bg-card">
                <TableRow class="bg-muted/50 hover:bg-muted/50">
                  <TableHead class="w-10 px-3 py-2"></TableHead>
                  <TableHead class="px-3 py-2">路径</TableHead>
                  <TableHead class="px-3 py-2">标题</TableHead>
                  <TableHead class="w-24 px-3 py-2">分组</TableHead>
                  <TableHead class="w-20 px-3 py-2 text-center">状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="item in scanResults" :key="item.path"
                  class="border-l-2"
                  :class="getScanResultRowClass(item)">
                  <TableCell class="px-3 py-2">
                    <Checkbox :model-value="selectedPaths.has(item.path)" :disabled="item.exists"
                      :class="adminBrandCheckboxClass"
                      @update:model-value="(v) => toggleSelect(item.path, v as boolean)" />
                  </TableCell>
                  <TableCell class="px-3 py-2">
                    <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ item.path }}</code>
                  </TableCell>
                  <TableCell class="px-3 py-2 text-sm">{{ item.title }}</TableCell>
                  <TableCell class="px-3 py-2">
                    <Badge variant="outline" :class="['text-xs', adminBrandChipClass]">{{ item.group }}</Badge>
                  </TableCell>
                  <TableCell class="px-3 py-2 text-center">
                    <Badge variant="outline" :class="['text-xs', getScanStatusBadgeClass(item.exists)]">
                      {{ item.exists ? '已存在' : '新增' }}
                    </Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </template>

        <!-- 空结果 -->
        <div v-else class="flex flex-col items-center justify-center py-12 text-center">
          <Route class="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p class="text-muted-foreground">未扫描到任何路由</p>
        </div>

        <DialogFooter>
          <Button variant="outline" :class="adminBrandFocusClass" @click="scanDialogOpen = false">取消</Button>
          <Button :class="adminBrandPrimaryButtonClass" @click="handleImport" :disabled="selectedCount === 0 || importing">
            <Loader2 v-if="importing" class="h-4 w-4 mr-2 animate-spin" />
            导入选中 ({{ selectedCount }})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 删除确认对话框 -->
    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent class="theme-brand">
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>确定要删除路由「{{ routerToDelete?.path }}」吗？此操作不可撤销。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :class="adminBrandFocusClass">取消</AlertDialogCancel>
          <AlertDialogAction :class="adminBrandDestructiveActionClass" @click="confirmDelete">删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
</template>

<script setup lang="ts">
import { Search, Loader2, FileText, Route, ScanLine, Trash2 } from 'lucide-vue-next'
import * as icons from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import {
  adminBrandActiveBadgeClass,
  adminBrandCheckboxClass,
  adminBrandChipClass,
  adminBrandDestructiveActionClass,
  adminBrandDisabledBadgeClass,
  adminBrandFocusClass,
  adminBrandPrimaryButtonClass,
  adminBrandSelectedListItemClass,
  adminBrandSwitchClass,
  adminBrandUnselectedListItemClass,
} from '~/utils/adminBrandStyles'

definePageMeta({
  layout: 'admin-layout',
  title: "路由权限管理"
})

// ==================== 类型定义 ====================

interface Router {
  id: number
  name: string
  title: string
  path: string
  icon: string | null
  isMenu: boolean
  sort: number
  groupId: number
  routerGroups: { id: number; name: string } | null
  parent: { id: number; name: string; title: string } | null
}

interface RouterGroup {
  id: number
  name: string
  description: string | null
}

interface ScannedRouter {
  path: string
  name: string
  title: string
  layout: string | null
  group: string
  exists: boolean
  existingId?: number
}

interface ScanResponse {
  items: ScannedRouter[]
  stats: { total: number; existing: number; new: number }
}

// ==================== 状态 ====================

const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
const searchKeyword = ref('')
const groupFilter = ref('all')
const menuFilter = ref('all')
const loading = ref(false)
const routers = ref<Router[]>([])
const groups = ref<RouterGroup[]>([])

// 扫描相关状态
const scanDialogOpen = ref(false)
const scanning = ref(false)
const importing = ref(false)
const scanResults = ref<ScannedRouter[]>([])
const scanStats = ref({ total: 0, existing: 0, new: 0 })
const selectedPaths = ref(new Set<string>())

// 删除相关状态
const deleteDialogOpen = ref(false)
const routerToDelete = ref<Router | null>(null)

// ==================== 计算属性 ====================

/** 已选数量 */
const selectedCount = computed(() => selectedPaths.value.size)

/** 可选的新路由 */
const selectableItems = computed(() => scanResults.value.filter(i => !i.exists))

/** 是否全选 */
const isAllSelected = computed(() => {
  if (selectableItems.value.length === 0) return false
  return selectableItems.value.every(i => selectedPaths.value.has(i.path))
})

/** 是否部分选中 */
const isIndeterminate = computed(() => {
  if (selectableItems.value.length === 0) return false
  const selectedNew = selectableItems.value.filter(i => selectedPaths.value.has(i.path)).length
  return selectedNew > 0 && selectedNew < selectableItems.value.length
})

// ==================== 方法 ====================

const getIcon = (iconName: string) => {
  const iconKey = iconName as keyof typeof icons
  return icons[iconKey] || FileText
}

const getScanResultRowClass = (item: ScannedRouter): string => {
  if (item.exists) return `${adminBrandUnselectedListItemClass} opacity-50`
  return selectedPaths.value.has(item.path)
    ? adminBrandSelectedListItemClass
    : adminBrandUnselectedListItemClass
}

const getScanStatusBadgeClass = (exists: boolean): string =>
  exists ? adminBrandDisabledBadgeClass : adminBrandActiveBadgeClass

/** 加载路由组 */
const loadGroups = async () => {
  const data = await useApiFetch<RouterGroup[]>('/api/v1/admin/routers/groups')
  if (data) groups.value = data
}

/** 加载路由列表 */
const loadRouters = async () => {
  loading.value = true
  try {
    const params: Record<string, any> = { page: pagination.value.page, pageSize: pagination.value.pageSize }
    if (searchKeyword.value) params.keyword = searchKeyword.value
    if (groupFilter.value !== 'all') params.groupId = parseInt(groupFilter.value)
    if (menuFilter.value !== 'all') params.isMenu = menuFilter.value
    const data = await useApiFetch<{ items: Router[]; total: number; totalPages: number }>('/api/v1/admin/routers', { query: params })
    if (data) {
      routers.value = data.items
      pagination.value.total = data.total
      pagination.value.totalPages = data.totalPages
    }
  } finally {
    loading.value = false
  }
}

/** 搜索 */
const handleSearch = () => {
  pagination.value.page = 1
  loadRouters()
}

/** 切换页码 */
const changePage = (page: number) => {
  pagination.value.page = page
  loadRouters()
}

/** 打开扫描对话框 */
const openScanDialog = async () => {
  scanDialogOpen.value = true
  scanning.value = true
  scanResults.value = []
  selectedPaths.value = new Set()

  try {
    const data = await useApiFetch<ScanResponse>('/api/v1/admin/routers/scan', { method: 'POST' })
    if (data) {
      scanResults.value = data.items
      scanStats.value = data.stats
      // 默认选中所有新路由
      data.items.filter(i => !i.exists).forEach(i => selectedPaths.value.add(i.path))
    }
  } finally {
    scanning.value = false
  }
}

/** 切换选中状态 */
const toggleSelect = (path: string, selected: boolean) => {
  if (selected) {
    selectedPaths.value.add(path)
  } else {
    selectedPaths.value.delete(path)
  }
  // 触发响应式更新
  selectedPaths.value = new Set(selectedPaths.value)
}

/** 全选/取消全选 */
const toggleSelectAll = (selected: boolean | 'indeterminate') => {
  if (selected === true) {
    selectableItems.value.forEach(i => selectedPaths.value.add(i.path))
  } else {
    selectableItems.value.forEach(i => selectedPaths.value.delete(i.path))
  }
  selectedPaths.value = new Set(selectedPaths.value)
}

/** 导入选中的路由 */
const handleImport = async () => {
  if (selectedCount.value === 0) return

  importing.value = true
  try {
    const items = scanResults.value
      .filter(i => selectedPaths.value.has(i.path))
      .map(i => ({
        path: i.path,
        name: i.name,
        title: i.title,
        group: i.group,
        isMenu: false,
      }))

    const result = await useApiFetch<{ imported: number; skipped: number }>('/api/v1/admin/routers/import', {
      method: 'POST',
      body: { items },
    })

    if (result) {
      toast.success(`成功导入 ${result.imported} 个路由`)
      scanDialogOpen.value = false
      loadRouters()
      loadGroups()
    }
  } finally {
    importing.value = false
  }
}

/** 切换菜单状态 */
const handleToggleMenu = async (router: Router, isMenu: boolean) => {
  const result = await useApiFetch(`/api/v1/admin/routers/${router.id}`, {
    method: 'PUT',
    body: { isMenu },
  })
  if (result) {
    router.isMenu = isMenu
    toast.success('更新成功')
  }
}

/** 更新排序 */
const handleUpdateSort = async (router: Router, sortValue: string) => {
  const sort = parseInt(sortValue)
  if (isNaN(sort) || sort < 0) {
    toast.error('排序值必须为非负整数')
    return
  }
  if (sort === router.sort) return

  const oldSort = router.sort
  router.sort = sort // 乐观更新

  const result = await useApiFetch(`/api/v1/admin/routers/${router.id}`, {
    method: 'PUT',
    body: { sort },
  })
  if (result) {
    toast.success('更新成功')
  } else {
    router.sort = oldSort // 恢复原值
  }
}

/** 打开删除确认对话框 */
const handleDelete = (router: Router) => {
  routerToDelete.value = router
  deleteDialogOpen.value = true
}

/** 确认删除 */
const confirmDelete = async () => {
  if (!routerToDelete.value) return

  const result = await useApiFetch(`/api/v1/admin/routers/${routerToDelete.value.id}`, {
    method: 'DELETE',
  })
  if (result !== null) {
    toast.success('删除成功')
    loadRouters()
  }
  deleteDialogOpen.value = false
  routerToDelete.value = null
}

// ==================== 生命周期 ====================

onMounted(() => {
  loadGroups()
  loadRouters()
})
</script>
