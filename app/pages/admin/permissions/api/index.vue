<template>
  <NuxtLayout name="admin-layout">
    <div class="space-y-6">
      <!-- 页面标题 -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl md:text-3xl font-bold mb-1">API 权限管理</h1>
          <p class="text-muted-foreground text-sm">管理 API 接口权限资源</p>
        </div>
        <Button variant="outline" @click="handleScan" :disabled="scanning" class="w-full md:w-auto">
          <Loader2 v-if="scanning" class="h-4 w-4 mr-2 animate-spin" />
          <RefreshCw v-else class="h-4 w-4 mr-2" />
          扫描 API
        </Button>
      </div>

      <!-- 搜索和筛选 -->
      <div class="flex flex-col md:flex-row gap-4">
        <Input v-model="searchKeyword" placeholder="搜索路径或名称..." class="md:max-w-sm" @keyup.enter="handleSearch" />
        <Select v-model="methodFilter">
          <SelectTrigger class="w-full md:w-32">
            <SelectValue placeholder="请求方法" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部方法</SelectItem>
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="PUT">PUT</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
            <SelectItem value="PATCH">PATCH</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="publicFilter">
          <SelectTrigger class="w-full md:w-32">
            <SelectValue placeholder="公开状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="true">公开</SelectItem>
            <SelectItem value="false">非公开</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" @click="handleSearch">
          <Search class="h-4 w-4 mr-2" />
          搜索
        </Button>
      </div>

      <!-- 批量操作 -->
      <div v-if="selectedIds.length > 0" class="flex items-center gap-4 p-4 bg-muted rounded-lg">
        <span class="text-sm font-medium">已选择 {{ selectedIds.length }} 项</span>
        <Button size="sm" variant="outline" @click="handleBatchPublic(true)">设为公开</Button>
        <Button size="sm" variant="outline" @click="handleBatchPublic(false)">设为非公开</Button>
        <Button size="sm" variant="destructive" @click="handleBatchDelete">批量删除</Button>
        <Button size="sm" variant="ghost" @click="selectedIds = []">取消选择</Button>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="flex justify-center py-12">
        <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
      </div>

      <!-- 空状态 -->
      <div v-else-if="!permissions.length" class="flex flex-col items-center justify-center py-12 text-center">
        <Key class="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 class="text-lg font-medium mb-1">暂无 API 权限数据</h3>
        <p class="text-muted-foreground text-sm mb-4">点击上方按钮扫描 API 接口</p>
      </div>

      <!-- 权限列表 -->
      <template v-else>
        <div class="bg-card rounded-lg border overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th class="px-4 py-3 text-left text-sm font-medium w-12">
                    <Checkbox :model-value="isAllSelected" @update:model-value="toggleSelectAll" />
                  </th>
                  <th class="px-4 py-3 text-left text-sm font-medium w-24">方法</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">路径</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">名称</th>
                  <th class="px-4 py-3 text-center text-sm font-medium w-20">公开</th>
                  <th class="px-4 py-3 text-center text-sm font-medium w-20">状态</th>
                  <th class="px-4 py-3 text-center text-sm font-medium w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="perm in permissions" :key="perm.id"
                  class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                  <td class="px-4 py-3">
                    <Checkbox :model-value="selectedIds.includes(perm.id)"
                      @update:model-value="(checked: boolean | 'indeterminate') => toggleSelect(perm.id, checked)" />
                  </td>
                  <td class="px-4 py-3">
                    <Badge :variant="getMethodVariant(perm.method)">{{ perm.method }}</Badge>
                  </td>
                  <td class="px-4 py-3">
                    <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ perm.path }}</code>
                  </td>
                  <td class="px-4 py-3 text-sm">{{ perm.name }}</td>
                  <td class="px-4 py-3 text-center">
                    <Switch :model-value="perm.isPublic"
                      @update:model-value="(checked: boolean) => handleTogglePublic(perm, checked)" />
                  </td>
                  <td class="px-4 py-3 text-center">
                    <span :class="getStatusClass(perm.status)">{{ perm.status === 1 ? '启用' : '禁用' }}</span>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <Button variant="ghost" size="icon" class="h-8 w-8 text-destructive hover:text-destructive"
                      @click="handleDelete(perm)">
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </td>
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

    <!-- 扫描结果对话框 -->
    <Dialog v-model:open="scanDialogOpen">
      <DialogContent class="!max-w-5xl w-[95vw] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>API 扫描结果</DialogTitle>
          <DialogDescription>发现 {{ scanResult?.stats.total }} 个 API，其中 {{ scanResult?.stats.new }} 个为新增
          </DialogDescription>
        </DialogHeader>
        <!-- 无新增 API -->
        <div v-if="newApiItems.length === 0" class="flex flex-col items-center justify-center py-8 text-center">
          <CheckCircle class="h-12 w-12 text-green-500 mb-4" />
          <h3 class="text-lg font-medium mb-1">API 权限已同步</h3>
          <p class="text-muted-foreground text-sm">所有 API 接口都已添加到权限列表中</p>
        </div>
        <!-- 有新增 API -->
        <template v-else>
          <div class="flex-1 overflow-auto">
            <div class="bg-card rounded-lg border overflow-x-auto">
              <table class="w-full">
                <thead>
                  <tr class="border-b bg-muted/50">
                    <th class="px-3 py-3 text-left text-sm font-medium w-20 whitespace-nowrap">方法</th>
                    <th class="px-3 py-3 text-left text-sm font-medium min-w-[300px]">路径</th>
                    <th class="px-3 py-3 text-left text-sm font-medium">名称</th>
                    <th class="px-3 py-3 text-center text-sm font-medium w-16 whitespace-nowrap">状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in newApiItems" :key="`${item.method}:${item.path}`"
                    class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                    <td class="px-3 py-2">
                      <Badge :variant="getMethodVariant(item.method)">{{ item.method }}</Badge>
                    </td>
                    <td class="px-3 py-2"><code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ item.path }}</code>
                    </td>
                    <td class="px-3 py-2 text-sm text-muted-foreground">{{ item.name }}</td>
                    <td class="px-3 py-2 text-center">
                      <Badge variant="outline">新增</Badge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
        <DialogFooter>
          <Button variant="outline" @click="scanDialogOpen = false">关闭</Button>
          <Button v-if="newApiItems.length > 0" @click="handleImport" :disabled="importing">
            <Loader2 v-if="importing" class="h-4 w-4 mr-2 animate-spin" />
            <Download v-else class="h-4 w-4 mr-2" />
            导入 {{ newApiItems.length }} 个新 API
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 删除确认对话框 -->
    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>确定要删除 API 权限「{{ permToDelete?.path }}」吗？</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="confirmDelete" class="bg-destructive text-white hover:bg-destructive/90">删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 批量删除确认对话框 -->
    <AlertDialog v-model:open="batchDeleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认批量删除</AlertDialogTitle>
          <AlertDialogDescription>确定要删除选中的 {{ selectedIds.length }} 个 API 权限吗？此操作不可撤销。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="confirmBatchDelete" class="bg-destructive text-white hover:bg-destructive/90">删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { Search, RefreshCw, Trash2, Loader2, Key, Download, CheckCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

definePageMeta({ layout: false, title: "API 权限管理" })

interface ApiPermission {
  id: number
  path: string
  method: string
  name: string
  isPublic: boolean
  status: number
}

interface ScanResult {
  items: Array<{ path: string; method: string; name: string; exists: boolean }>
  stats: { total: number; existing: number; new: number }
}

const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
const searchKeyword = ref('')
const methodFilter = ref('all')
const publicFilter = ref('all')
const loading = ref(false)
const scanning = ref(false)
const permissions = ref<ApiPermission[]>([])
const selectedIds = ref<number[]>([])
const scanResult = ref<ScanResult | null>(null)
const scanDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const batchDeleteDialogOpen = ref(false)
const permToDelete = ref<ApiPermission | null>(null)
const importing = ref(false)

const isAllSelected = computed(() => {
  if (permissions.value.length === 0) return false
  if (selectedIds.value.length === permissions.value.length) return true
  if (selectedIds.value.length > 0) return 'indeterminate'
  return false
})

/** 新增的 API 列表 */
const newApiItems = computed(() => scanResult.value?.items.filter(i => !i.exists) || [])

/** 获取 HTTP 方法对应的 Badge 样式 */
const getMethodVariant = (method: string) => {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    GET: 'default', POST: 'secondary', PUT: 'outline', DELETE: 'destructive', PATCH: 'outline', '*': 'secondary'
  }
  return variants[method] || 'outline'
}

const getStatusClass = (status: number): string => {
  const baseClass = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium'
  return status === 1
    ? `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
    : `${baseClass} bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400`
}

const loadPermissions = async () => {
  loading.value = true
  try {
    const params: Record<string, any> = { page: pagination.value.page, pageSize: pagination.value.pageSize }
    if (searchKeyword.value) params.keyword = searchKeyword.value
    if (methodFilter.value !== 'all') params.method = methodFilter.value
    if (publicFilter.value !== 'all') params.isPublic = publicFilter.value === 'true'
    const data = await useApiFetch<{ items: ApiPermission[]; total: number; totalPages: number }>('/api/v1/admin/api-permissions', { query: params })
    if (data) {
      permissions.value = data.items
      pagination.value.total = data.total
      pagination.value.totalPages = data.totalPages
    }
  } finally { loading.value = false }
}

const handleSearch = () => { pagination.value.page = 1; selectedIds.value = []; loadPermissions() }
const changePage = (page: number) => { pagination.value.page = page; selectedIds.value = []; loadPermissions() }
const toggleSelect = (id: number, checked: boolean | 'indeterminate') => {
  if (checked === true) selectedIds.value.push(id)
  else selectedIds.value = selectedIds.value.filter(i => i !== id)
}
const toggleSelectAll = (checked: boolean | 'indeterminate') => {
  selectedIds.value = checked === true ? permissions.value.map(p => p.id) : []
}

const handleTogglePublic = async (perm: ApiPermission, isPublic: boolean) => {
  const result = await useApiFetch(`/api/v1/admin/api-permissions/${perm.id}`, { method: 'PUT', body: { isPublic } })
  if (result) { perm.isPublic = isPublic; toast.success('更新成功') }
}

const handleBatchPublic = async (isPublic: boolean) => {
  const result = await useApiFetch('/api/v1/admin/api-permissions/batch-public', { method: 'PUT', body: { ids: selectedIds.value, isPublic } })
  if (result) { toast.success('批量更新成功'); selectedIds.value = []; loadPermissions() }
}

const handleScan = async () => {
  scanning.value = true
  try {
    const data = await useApiFetch<ScanResult>('/api/v1/admin/api-permissions/scan', { method: 'POST' })
    if (data) { scanResult.value = data; scanDialogOpen.value = true }
  } finally { scanning.value = false }
}

/** 批量导入新 API */
const handleImport = async () => {
  if (newApiItems.value.length === 0) return
  importing.value = true
  try {
    const result = await useApiFetch<{ imported: number }>('/api/v1/admin/api-permissions/batch-import', {
      method: 'POST',
      body: { items: newApiItems.value }
    })
    if (result) {
      toast.success(`成功导入 ${result.imported} 个 API 权限`)
      scanDialogOpen.value = false
      loadPermissions()
    }
  } finally { importing.value = false }
}

const handleDelete = (perm: ApiPermission) => { permToDelete.value = perm; deleteDialogOpen.value = true }
const confirmDelete = async () => {
  if (!permToDelete.value) return
  const result = await useApiFetch(`/api/v1/admin/api-permissions/${permToDelete.value.id}`, { method: 'DELETE' })
  if (result !== null) { toast.success('删除成功'); loadPermissions() }
  deleteDialogOpen.value = false
  permToDelete.value = null
}

/** 批量删除 */
const handleBatchDelete = () => { batchDeleteDialogOpen.value = true }
const confirmBatchDelete = async () => {
  const result = await useApiFetch('/api/v1/admin/api-permissions/batch-delete', { method: 'DELETE', body: { ids: selectedIds.value } })
  if (result !== null) { toast.success('批量删除成功'); selectedIds.value = []; loadPermissions() }
  batchDeleteDialogOpen.value = false
}

onMounted(() => { loadPermissions() })
</script>
