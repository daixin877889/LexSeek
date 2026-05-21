<template>
    <div class="theme-brand space-y-6">
      <!-- 页面标题 -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl md:text-3xl font-bold mb-1">角色管理</h1>
          <p class="text-muted-foreground text-sm">管理系统角色，配置角色权限</p>
        </div>
        <Button :class="['w-full md:w-auto', adminBrandPrimaryButtonClass]" @click="navigateTo('/admin/roles/create')">
          <Plus class="h-4 w-4 mr-2" />
          创建角色
        </Button>
      </div>

      <!-- 搜索和筛选 -->
      <div class="flex flex-col md:flex-row gap-4">
        <Input v-model="searchKeyword" placeholder="搜索角色名称或标识..." :class="['md:max-w-sm', adminBrandFocusClass]" @keyup.enter="handleSearch" />
        <Select v-model="statusFilter">
          <SelectTrigger :class="['w-full md:w-32', adminBrandFocusClass]">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent class="theme-brand">
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="1">启用</SelectItem>
            <SelectItem value="0">禁用</SelectItem>
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
      <div v-else-if="!roles.length" class="flex flex-col items-center justify-center py-12 text-center">
        <Shield class="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 class="text-lg font-medium mb-1">暂无角色数据</h3>
        <p class="text-muted-foreground text-sm mb-4">点击上方按钮创建第一个角色</p>
        <Button :class="adminBrandPrimaryButtonClass" @click="navigateTo('/admin/roles/create')">
          <Plus class="h-4 w-4 mr-2" />
          创建角色
        </Button>
      </div>

      <!-- 角色列表 -->
      <template v-else>
        <!-- 桌面端表格 -->
        <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
          <Table>
            <TableHeader>
              <TableRow class="bg-muted/50 hover:bg-muted/50">
                <TableHead class="px-4 py-3">角色名称</TableHead>
                <TableHead class="px-4 py-3">角色标识</TableHead>
                <TableHead class="px-4 py-3">描述</TableHead>
                <TableHead class="px-4 py-3 text-center">状态</TableHead>
                <TableHead class="px-4 py-3">创建时间</TableHead>
                <TableHead class="px-4 py-3 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="role in roles" :key="role.id" class="hover:bg-muted/30">
                  <!-- 角色名称 -->
                  <TableCell class="px-4 py-3">
                    <div class="flex items-center">
                      <Shield class="h-4 w-4 text-primary mr-2 shrink-0" />
                      <span class="font-medium">{{ role.name }}</span>
                    </div>
                  </TableCell>
                  <!-- 角色标识 -->
                  <TableCell class="px-4 py-3">
                    <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ role.code }}</code>
                  </TableCell>
                  <!-- 描述 -->
                  <TableCell class="px-4 py-3 text-sm text-muted-foreground">
                    {{ role.description || '-' }}
                  </TableCell>
                  <!-- 状态 -->
                  <TableCell class="px-4 py-3 text-center">
                    <Badge variant="outline" :class="getAdminStatusBadgeClass(role.status === 1)">
                      {{ role.status === 1 ? '启用' : '禁用' }}
                    </Badge>
                  </TableCell>
                  <!-- 创建时间 -->
                  <TableCell class="px-4 py-3 text-sm text-muted-foreground">
                    {{ formatDate(role.createdAt) }}
                  </TableCell>
                  <!-- 操作 -->
                  <TableCell class="px-4 py-3 text-center">
                    <div class="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" :class="['h-8 w-8', adminBrandFocusClass]" title="编辑"
                        @click="navigateTo(`/admin/roles/${role.id}`)">
                        <Pencil class="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" :class="['h-8 w-8', adminBrandFocusClass]" title="权限分配"
                        @click="navigateTo(`/admin/roles/${role.id}/permissions`)">
                        <Key class="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" :class="['h-8 w-8 text-destructive hover:text-destructive', adminBrandFocusClass]"
                        title="删除" :disabled="role.code === 'super_admin'" @click="handleDelete(role)">
                        <Trash2 class="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <!-- 移动端卡片 -->
        <div class="md:hidden space-y-3">
          <div v-for="role in roles" :key="role.id" class="bg-card rounded-lg border p-4 space-y-3">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-2">
                <Shield class="h-4 w-4 text-primary shrink-0" />
                <span class="font-medium">{{ role.name }}</span>
              </div>
              <Badge variant="outline" :class="getAdminStatusBadgeClass(role.status === 1)">
                {{ role.status === 1 ? '启用' : '禁用' }}
              </Badge>
            </div>
            <div class="text-sm">
              <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ role.code }}</code>
            </div>
            <p v-if="role.description" class="text-sm text-muted-foreground">
              {{ role.description }}
            </p>
            <div class="text-xs text-muted-foreground">
              创建于 {{ formatDate(role.createdAt) }}
            </div>
            <div class="flex items-center gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" :class="['flex-1', adminBrandFocusClass]" @click="navigateTo(`/admin/roles/${role.id}`)">
                <Pencil class="h-3 w-3 mr-1" />
                编辑
              </Button>
              <Button variant="outline" size="sm" :class="['flex-1', adminBrandFocusClass]"
                @click="navigateTo(`/admin/roles/${role.id}/permissions`)">
                <Key class="h-3 w-3 mr-1" />
                权限
              </Button>
              <Button variant="outline" size="sm" :class="['text-destructive hover:text-destructive', adminBrandFocusClass]"
                :disabled="role.code === 'super_admin'" @click="handleDelete(role)">
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total"
          @change="changePage" />
      </template>
    </div>

    <!-- 删除确认对话框 -->
    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent class="theme-brand">
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除角色「{{ roleToDelete?.name }}」吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction :class="adminBrandDestructiveActionClass" @click="confirmDelete">
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
</template>

<script setup lang="ts">
import { Plus, Search, Pencil, Key, Trash2, Loader2, Shield } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFormatters } from '~/composables/useFormatters'
import {
  adminBrandDestructiveActionClass,
  adminBrandFocusClass,
  adminBrandPrimaryButtonClass,
  getAdminStatusBadgeClass,
} from '~/utils/adminBrandStyles'

definePageMeta({
  layout: 'admin-layout',
  title: "角色管理",
})

/** 角色类型 */
interface Role {
  id: number
  name: string
  code: string
  description: string | null
  status: number
  createdAt: string
}

/** 分页信息 */
const pagination = ref({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
})

/** 搜索关键字 */
const searchKeyword = ref('')

/** 状态筛选 */
const statusFilter = ref('all')

/** 加载状态 */
const loading = ref(false)

/** 角色列表 */
const roles = ref<Role[]>([])

/** 删除对话框 */
const deleteDialogOpen = ref(false)
const roleToDelete = ref<Role | null>(null)

const { formatDate } = useFormatters()

/** 加载角色列表 */
const loadRoles = async () => {
  loading.value = true
  try {
    const params: Record<string, any> = {
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
    }
    if (searchKeyword.value) {
      params.keyword = searchKeyword.value
    }
    if (statusFilter.value !== 'all') {
      params.status = parseInt(statusFilter.value)
    }

    const data = await useApiFetch<{ items: Role[], total: number, totalPages: number }>('/api/v1/admin/roles', { query: params })
    if (data) {
      roles.value = data.items
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
  loadRoles()
}

/** 切换页码 */
const changePage = (page: number) => {
  pagination.value.page = page
  loadRoles()
}

/** 删除角色 */
const handleDelete = (role: Role) => {
  if (role.code === 'super_admin') {
    toast.error('超级管理员角色不能删除')
    return
  }
  roleToDelete.value = role
  deleteDialogOpen.value = true
}

/** 确认删除 */
const confirmDelete = async () => {
  if (!roleToDelete.value) return

  const result = await useApiFetch(`/api/v1/admin/roles/${roleToDelete.value.id}`, {
    method: 'DELETE',
  })

  if (result !== null) {
    toast.success('删除成功')
    loadRoles()
  }

  deleteDialogOpen.value = false
  roleToDelete.value = null
}

// 初始加载
onMounted(() => {
  loadRoles()
})
</script>
