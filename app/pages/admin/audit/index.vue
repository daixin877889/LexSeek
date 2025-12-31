<template>
  <NuxtLayout name="admin-layout">
    <div class="space-y-6">
      <!-- 页面标题 -->
      <div>
        <h1 class="text-2xl md:text-3xl font-bold mb-1">审计日志</h1>
        <p class="text-muted-foreground text-sm">查看权限变更操作记录</p>
      </div>

      <!-- 搜索和筛选 -->
      <div class="flex flex-col md:flex-row gap-4">
        <Select v-model="actionFilter">
          <SelectTrigger class="w-full md:w-48">
            <SelectValue placeholder="操作类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部操作</SelectItem>
            <SelectItem v-for="action in actionOptions" :key="action.value" :value="action.value">{{ action.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="targetTypeFilter">
          <SelectTrigger class="w-full md:w-36">
            <SelectValue placeholder="目标类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="role">角色</SelectItem>
            <SelectItem value="api_permission">API 权限</SelectItem>
            <SelectItem value="user_role">用户角色</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" @click="handleSearch">
          <Search class="h-4 w-4 mr-2" />
          搜索
        </Button>
        <Button variant="ghost" @click="resetFilters">
          <RotateCcw class="h-4 w-4 mr-2" />
          重置
        </Button>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="flex justify-center py-12">
        <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
      </div>

      <!-- 空状态 -->
      <div v-else-if="!logs.length" class="flex flex-col items-center justify-center py-12 text-center">
        <FileText class="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 class="text-lg font-medium mb-1">暂无审计日志</h3>
        <p class="text-muted-foreground text-sm">系统中还没有权限变更记录</p>
      </div>

      <!-- 日志列表 -->
      <template v-else>
        <div class="bg-card rounded-lg border overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th class="px-4 py-3 text-left text-sm font-medium w-40">操作类型</th>
                  <th class="px-4 py-3 text-left text-sm font-medium w-28">目标类型</th>
                  <th class="px-4 py-3 text-left text-sm font-medium w-20">目标ID</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">操作人</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">备注</th>
                  <th class="px-4 py-3 text-left text-sm font-medium w-44">操作时间</th>
                  <th class="px-4 py-3 text-center text-sm font-medium w-20">详情</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="log in logs" :key="log.id"
                  class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                  <td class="px-4 py-3">
                    <span :class="getActionClass(log.action)">{{ getActionLabel(log.action) }}</span>
                  </td>
                  <td class="px-4 py-3">
                    <Badge variant="outline">{{ getTargetTypeLabel(log.targetType) }}</Badge>
                  </td>
                  <td class="px-4 py-3 text-sm">{{ log.targetId || '-' }}</td>
                  <td class="px-4 py-3 text-sm">{{ log.operator?.name || log.operator?.phone || '-' }}</td>
                  <td class="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">{{ log.remark || '-' }}</td>
                  <td class="px-4 py-3 text-sm text-muted-foreground">{{ formatDate(log.createdAt) }}</td>
                  <td class="px-4 py-3 text-center">
                    <Button variant="ghost" size="icon" class="h-8 w-8" @click="showDetail(log)">
                      <Eye class="h-4 w-4" />
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

    <!-- 详情对话框 -->
    <Dialog v-model:open="detailDialogOpen">
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>审计日志详情</DialogTitle>
        </DialogHeader>
        <div v-if="selectedLog" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <Label class="text-muted-foreground">操作类型</Label>
              <p class="font-medium">{{ getActionLabel(selectedLog.action) }}</p>
            </div>
            <div>
              <Label class="text-muted-foreground">目标类型</Label>
              <p class="font-medium">{{ getTargetTypeLabel(selectedLog.targetType) }}</p>
            </div>
            <div>
              <Label class="text-muted-foreground">目标 ID</Label>
              <p class="font-medium">{{ selectedLog.targetId || '-' }}</p>
            </div>
            <div>
              <Label class="text-muted-foreground">操作人</Label>
              <p class="font-medium">{{ selectedLog.operator?.name || selectedLog.operator?.phone || '-' }}</p>
            </div>
            <div>
              <Label class="text-muted-foreground">IP 地址</Label>
              <p class="font-medium">{{ selectedLog.ip || '-' }}</p>
            </div>
            <div>
              <Label class="text-muted-foreground">操作时间</Label>
              <p class="font-medium">{{ formatDate(selectedLog.createdAt) }}</p>
            </div>
          </div>
          <div v-if="selectedLog.remark">
            <Label class="text-muted-foreground">备注</Label>
            <p class="font-medium">{{ selectedLog.remark }}</p>
          </div>
          <div v-if="selectedLog.oldValue" class="space-y-2">
            <Label class="text-muted-foreground">变更前</Label>
            <pre class="bg-muted p-3 rounded-md text-xs overflow-auto max-h-40">{{ JSON.stringify(selectedLog.oldValue,
              null, 2) }}</pre>
          </div>
          <div v-if="selectedLog.newValue" class="space-y-2">
            <Label class="text-muted-foreground">变更后</Label>
            <pre class="bg-muted p-3 rounded-md text-xs overflow-auto max-h-40">{{ JSON.stringify(selectedLog.newValue,
              null, 2) }}</pre>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="detailDialogOpen = false">关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { Search, RotateCcw, Eye, Loader2, FileText } from 'lucide-vue-next'
import dayjs from 'dayjs'

definePageMeta({ layout: false, title: "审计日志" })

interface AuditLog {
  id: number
  action: string
  targetType: string
  targetId: number | null
  operatorId: number
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  remark: string | null
  ip: string | null
  createdAt: string
  operator: { id: number; name: string | null; phone: string } | null
}

const actionOptions = [
  { value: 'role_create', label: '创建角色' },
  { value: 'role_update', label: '更新角色' },
  { value: 'role_delete', label: '删除角色' },
  { value: 'role_assign_api_permission', label: '分配 API 权限' },
  { value: 'role_assign_route_permission', label: '分配路由权限' },
  { value: 'user_assign_role', label: '分配用户角色' },
  { value: 'api_permission_create', label: '创建 API 权限' },
  { value: 'api_permission_update', label: '更新 API 权限' },
  { value: 'api_permission_delete', label: '删除 API 权限' },
  { value: 'api_permission_batch_public', label: '批量设置公开' },
]

const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
const actionFilter = ref('all')
const targetTypeFilter = ref('all')
const loading = ref(false)
const logs = ref<AuditLog[]>([])
const detailDialogOpen = ref(false)
const selectedLog = ref<AuditLog | null>(null)

const formatDate = (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm:ss')

const getActionLabel = (action: string) => {
  const option = actionOptions.find(o => o.value === action)
  return option?.label || action
}

const getTargetTypeLabel = (targetType: string) => {
  const labels: Record<string, string> = {
    role: '角色', api_permission: 'API 权限', user_role: '用户角色', route_permission: '路由权限'
  }
  return labels[targetType] || targetType
}

const getActionClass = (action: string): string => {
  const baseClass = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium'
  if (action.includes('delete')) return `${baseClass} bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
  if (action.includes('create')) return `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
  if (action.includes('update') || action.includes('assign')) return `${baseClass} bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400`
  return `${baseClass} bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400`
}

const loadLogs = async () => {
  loading.value = true
  try {
    const params: Record<string, any> = { page: pagination.value.page, pageSize: pagination.value.pageSize }
    if (actionFilter.value !== 'all') params.action = actionFilter.value
    if (targetTypeFilter.value !== 'all') params.targetType = targetTypeFilter.value
    const data = await useApiFetch<{ items: AuditLog[]; total: number; totalPages: number }>('/api/v1/admin/audit', { query: params })
    if (data) {
      logs.value = data.items
      pagination.value.total = data.total
      pagination.value.totalPages = data.totalPages
    }
  } finally { loading.value = false }
}

const handleSearch = () => { pagination.value.page = 1; loadLogs() }
const resetFilters = () => { actionFilter.value = 'all'; targetTypeFilter.value = 'all'; pagination.value.page = 1; loadLogs() }
const changePage = (page: number) => { pagination.value.page = page; loadLogs() }
const showDetail = (log: AuditLog) => { selectedLog.value = log; detailDialogOpen.value = true }

onMounted(() => { loadLogs() })
</script>
