<template>
  <NuxtLayout name="admin-layout">
    <div class="space-y-6">
      <!-- 页面标题 -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl md:text-3xl font-bold mb-1">路由权限管理</h1>
          <p class="text-muted-foreground text-sm">管理前端路由权限资源</p>
        </div>
        <Button @click="openScanDialog">
          <ScanLine class="h-4 w-4 mr-2" />
          扫描路由
        </Button>
      </div>

      <!-- 搜索和筛选 -->
      <div class="flex flex-col md:flex-row gap-4">
        <Input v-model="searchKeyword" placeholder="搜索路由名称或路径..." class="md:max-w-sm" @keyup.enter="handleSearch" />
        <Select v-model="groupFilter">
          <SelectTrigger class="w-full md:w-40">
            <SelectValue placeholder="路由组" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分组</SelectItem>
            <SelectItem v-for="group in groups" :key="group.id" :value="String(group.id)">{{ group.name }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="menuFilter">
          <SelectTrigger class="w-full md:w-32">
            <SelectValue placeholder="菜单类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="true">菜单</SelectItem>
            <SelectItem value="false">非菜单</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" @click="handleSearch">
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
        <Button @click="openScanDialog">
          <ScanLine class="h-4 w-4 mr-2" />
          扫描路由
        </Button>
      </div>

      <!-- 路由列表 -->
      <template v-else>
        <div class="bg-card rounded-lg border overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th class="px-4 py-3 text-left text-sm font-medium">路由名称</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">标题</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">路径</th>
                  <th class="px-4 py-3 text-left text-sm font-medium w-24">分组</th>
                  <th class="px-4 py-3 text-center text-sm font-medium w-20">菜单</th>
                  <th class="px-4 py-3 text-center text-sm font-medium w-20">排序</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="router in routers" :key="router.id"
                  class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                      <component v-if="router.icon" :is="getIcon(router.icon)" class="h-4 w-4 text-muted-foreground" />
                      <span class="font-medium">{{ router.name }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-sm">{{ router.title }}</td>
                  <td class="px-4 py-3">
                    <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ router.path }}</code>
                  </td>
                  <td class="px-4 py-3">
                    <Badge variant="outline">{{ router.routerGroups?.name || '-' }}</Badge>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <span :class="getMenuClass(router.isMenu)">{{ router.isMenu ? '是' : '否' }}</span>
                  </td>
                  <td class="px-4 py-3 text-center text-muted-foreground">{{ router.sort }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 分页 -->
        <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total"
          @change="changePage" />
      </template>
    </div>

    <!-- 扫描路由对话框 -->
    <Dialog v-model:open="scanDialogOpen">
      <DialogContent class="!max-w-5xl w-[95vw] max-h-[80vh] flex flex-col">
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
            <span class="text-green-600">新增 {{ scanStats.new }} 个</span>
            <span class="text-gray-500">已存在 {{ scanStats.existing }} 个</span>
          </div>

          <!-- 全选操作 -->
          <div class="flex items-center gap-4 mb-2">
            <Checkbox :model-value="isAllSelected" :indeterminate="isIndeterminate"
              @update:model-value="toggleSelectAll" />
            <span class="text-sm">全选新路由</span>
            <span class="text-xs text-muted-foreground">(已选 {{ selectedCount }} 个)</span>
          </div>

          <!-- 路由列表 -->
          <div class="flex-1 overflow-auto border rounded-lg">
            <table class="w-full">
              <thead class="sticky top-0 bg-card z-10">
                <tr class="border-b bg-muted/50">
                  <th class="px-3 py-2 text-left text-sm font-medium w-10"></th>
                  <th class="px-3 py-2 text-left text-sm font-medium">路径</th>
                  <th class="px-3 py-2 text-left text-sm font-medium">标题</th>
                  <th class="px-3 py-2 text-left text-sm font-medium w-24">分组</th>
                  <th class="px-3 py-2 text-center text-sm font-medium w-20">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in scanResults" :key="item.path"
                  class="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                  :class="{ 'opacity-50': item.exists }">
                  <td class="px-3 py-2">
                    <Checkbox :model-value="selectedPaths.has(item.path)" :disabled="item.exists"
                      @update:model-value="(v) => toggleSelect(item.path, v as boolean)" />
                  </td>
                  <td class="px-3 py-2">
                    <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ item.path }}</code>
                  </td>
                  <td class="px-3 py-2 text-sm">{{ item.title }}</td>
                  <td class="px-3 py-2">
                    <Badge variant="outline" class="text-xs">{{ item.group }}</Badge>
                  </td>
                  <td class="px-3 py-2 text-center">
                    <Badge :variant="item.exists ? 'secondary' : 'default'" class="text-xs">
                      {{ item.exists ? '已存在' : '新增' }}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- 空结果 -->
        <div v-else class="flex flex-col items-center justify-center py-12 text-center">
          <Route class="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p class="text-muted-foreground">未扫描到任何路由</p>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="scanDialogOpen = false">取消</Button>
          <Button @click="handleImport" :disabled="selectedCount === 0 || importing">
            <Loader2 v-if="importing" class="h-4 w-4 mr-2 animate-spin" />
            导入选中 ({{ selectedCount }})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { Search, Loader2, FileText, Route, ScanLine } from 'lucide-vue-next'
import * as icons from 'lucide-vue-next'

definePageMeta({
  layout: false,
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

const getMenuClass = (isMenu: boolean): string => {
  const baseClass = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium'
  return isMenu
    ? `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
    : `${baseClass} bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400`
}

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

// ==================== 生命周期 ====================

onMounted(() => {
  loadGroups()
  loadRouters()
})
</script>
