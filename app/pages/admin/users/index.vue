<template>
  <div class="theme-brand space-y-6">
    <!-- 页面标题 -->
    <div>
      <h1 class="text-2xl md:text-3xl font-bold mb-1">用户角色管理</h1>
      <p class="text-muted-foreground text-sm">管理用户的角色分配</p>
    </div>

    <!-- 搜索和筛选 -->
    <div class="flex flex-col md:flex-row gap-4">
      <Input v-model="searchKeyword" placeholder="搜索用户名或手机号..." :class="['md:max-w-sm', adminBrandFocusClass]" @keyup.enter="handleSearch" />
      <Select v-model="roleFilter">
        <SelectTrigger :class="['w-full md:w-40', adminBrandFocusClass]">
          <SelectValue placeholder="角色筛选" />
        </SelectTrigger>
        <SelectContent class="theme-brand">
          <SelectItem value="all">全部角色</SelectItem>
          <SelectItem v-for="role in allRoles" :key="role.id" :value="String(role.id)">{{ role.name }}</SelectItem>
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
    <div v-else-if="!users.length" class="flex flex-col items-center justify-center py-12 text-center">
      <Users class="h-12 w-12 text-muted-foreground/50 mb-4" />
      <h3 class="text-lg font-medium mb-1">暂无用户数据</h3>
      <p class="text-muted-foreground text-sm">系统中还没有用户</p>
    </div>

    <!-- 用户列表 -->
    <template v-else>
      <!-- 桌面端表格 -->
      <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
        <Table>
          <TableHeader>
            <TableRow class="bg-muted/50 hover:bg-muted/50">
              <TableHead class="px-4 py-3">用户名</TableHead>
              <TableHead class="px-4 py-3">手机号</TableHead>
              <TableHead class="px-4 py-3">角色</TableHead>
              <TableHead class="w-20 px-4 py-3 text-center">状态</TableHead>
              <TableHead class="w-40 px-4 py-3">注册时间</TableHead>
              <TableHead class="w-28 px-4 py-3 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="user in users" :key="user.id" class="hover:bg-muted/30">
              <TableCell class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <User class="h-4 w-4 text-muted-foreground" />
                  <span class="font-medium">{{ user.name || '-' }}</span>
                </div>
              </TableCell>
              <TableCell class="px-4 py-3 text-sm">{{ user.phone }}</TableCell>
              <TableCell class="px-4 py-3">
                <div class="flex flex-wrap gap-1">
                  <Badge v-for="role in user.roles" :key="role.id" variant="outline" :class="adminBrandChipClass">{{ role.name }}</Badge>
                  <span v-if="!user.roles?.length" class="text-muted-foreground text-sm">-</span>
                </div>
              </TableCell>
              <TableCell class="px-4 py-3 text-center">
                <Badge variant="outline" :class="getAdminStatusBadgeClass(user.status === 1)">
                  {{ user.status === 1 ? '正常' : '禁用' }}
                </Badge>
              </TableCell>
              <TableCell class="px-4 py-3 text-sm text-muted-foreground">{{ formatDate(user.createdAt) }}</TableCell>
              <TableCell class="px-4 py-3 text-center">
                <Button variant="ghost" size="sm" :class="adminBrandFocusClass" @click="openRoleDialog(user)">
                  <Shield class="h-4 w-4 mr-1" />
                  分配角色
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <!-- 移动端卡片 -->
      <div class="md:hidden space-y-3">
        <div v-for="user in users" :key="user.id" class="bg-card rounded-lg border p-4 space-y-3">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <User class="h-4 w-4 text-muted-foreground" />
              <span class="font-medium">{{ user.name || user.phone }}</span>
            </div>
            <Badge variant="outline" :class="getAdminStatusBadgeClass(user.status === 1)">
              {{ user.status === 1 ? '正常' : '禁用' }}
            </Badge>
          </div>
          <div class="text-sm text-muted-foreground">{{ user.phone }}</div>
          <div class="flex flex-wrap gap-1">
            <Badge v-for="role in user.roles" :key="role.id" variant="outline" :class="adminBrandChipClass">{{ role.name }}</Badge>
            <span v-if="!user.roles?.length" class="text-muted-foreground text-sm">无角色</span>
          </div>
          <div class="text-xs text-muted-foreground">注册于 {{ formatDate(user.createdAt) }}</div>
          <div class="pt-2 border-t">
            <Button variant="outline" size="sm" :class="['w-full', adminBrandFocusClass]" @click="openRoleDialog(user)">
              <Shield class="h-3 w-3 mr-1" />
              分配角色
            </Button>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize" :total="pagination.total"
        @change="changePage" />
    </template>
  </div>

  <!-- 角色分配对话框 -->
  <Dialog v-model:open="roleDialogOpen">
    <DialogContent class="theme-brand max-h-[85vh] overflow-hidden flex flex-col">
      <DialogHeader class="shrink-0">
        <DialogTitle>分配角色</DialogTitle>
        <DialogDescription>为用户「{{ selectedUser?.name || selectedUser?.phone }}」分配角色</DialogDescription>
      </DialogHeader>
      <div class="min-h-0 flex-1 overflow-y-auto space-y-4 py-4">
        <div class="space-y-2">
          <Label>选择角色</Label>
          <div class="border rounded-md p-2 max-h-60 overflow-y-auto space-y-1">
            <div v-for="role in allRoles" :key="role.id"
              class="flex items-center gap-2 rounded-md border-l-2 px-2 py-2 transition-colors"
              :class="selectedRoleIds.includes(role.id) ? adminBrandSelectedListItemClass : adminBrandUnselectedListItemClass">
              <Checkbox :id="`role-${role.id}`" :model-value="selectedRoleIds.includes(role.id)"
                :class="adminBrandCheckboxClass"
                @update:model-value="(checked: boolean | 'indeterminate') => toggleRole(role.id, checked)" />
              <Label :for="`role-${role.id}`" class="flex-1 font-normal cursor-pointer">
                {{ role.name }}
                <span class="text-muted-foreground text-xs ml-1">({{ role.code }})</span>
              </Label>
            </div>
          </div>
        </div>
      </div>
      <DialogFooter class="shrink-0">
        <Button variant="outline" :class="adminBrandFocusClass" @click="roleDialogOpen = false">取消</Button>
        <Button :class="adminBrandPrimaryButtonClass" @click="saveUserRoles" :disabled="savingRoles">
          <Loader2 v-if="savingRoles" class="h-4 w-4 mr-2 animate-spin" />
          保存
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { Search, Shield, Loader2, Users, User } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFormatters } from '~/composables/useFormatters'
import {
  adminBrandCheckboxClass,
  adminBrandChipClass,
  adminBrandFocusClass,
  adminBrandPrimaryButtonClass,
  adminBrandSelectedListItemClass,
  adminBrandUnselectedListItemClass,
  getAdminStatusBadgeClass,
} from '~/utils/adminBrandStyles'

definePageMeta({ layout: 'admin-layout', title: "用户角色管理" })

interface UserItem {
  id: number
  name: string | null
  phone: string
  status: number
  createdAt: string
  roles: Array<{ id: number; name: string; code: string }>
}

interface Role {
  id: number
  name: string
  code: string
}

const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
const searchKeyword = ref('')
const roleFilter = ref('all')
const loading = ref(false)
const savingRoles = ref(false)
const users = ref<UserItem[]>([])
const allRoles = ref<Role[]>([])
const roleDialogOpen = ref(false)
const selectedUser = ref<UserItem | null>(null)
const selectedRoleIds = ref<number[]>([])

const { formatDate } = useFormatters()

const loadRoles = async () => {
  const data = await useApiFetch<{ items: Role[] }>('/api/v1/admin/roles', { query: { pageSize: 100 } })
  if (data) allRoles.value = data.items
}

const loadUsers = async () => {
  loading.value = true
  try {
    const params: Record<string, any> = { page: pagination.value.page, pageSize: pagination.value.pageSize }
    if (searchKeyword.value) params.keyword = searchKeyword.value
    if (roleFilter.value !== 'all') params.roleId = parseInt(roleFilter.value)
    const data = await useApiFetch<{ items: UserItem[]; total: number; totalPages: number }>('/api/v1/admin/users', { query: params })
    if (data) {
      users.value = data.items
      pagination.value.total = data.total
      pagination.value.totalPages = data.totalPages
    }
  } finally { loading.value = false }
}

const handleSearch = () => { pagination.value.page = 1; loadUsers() }
const changePage = (page: number) => { pagination.value.page = page; loadUsers() }

const openRoleDialog = (user: UserItem) => {
  selectedUser.value = user
  selectedRoleIds.value = user.roles.map(r => r.id)
  roleDialogOpen.value = true
}

const toggleRole = (roleId: number, checked: boolean | 'indeterminate') => {
  if (checked === true) {
    if (!selectedRoleIds.value.includes(roleId)) selectedRoleIds.value.push(roleId)
  } else {
    selectedRoleIds.value = selectedRoleIds.value.filter(id => id !== roleId)
  }
}

const saveUserRoles = async () => {
  if (!selectedUser.value) return
  savingRoles.value = true
  try {
    const result = await useApiFetch(`/api/v1/admin/users/roles/${selectedUser.value.id}`, {
      method: 'PUT',
      body: { roleIds: selectedRoleIds.value }
    })
    if (result) {
      toast.success('角色分配成功')
      roleDialogOpen.value = false
      loadUsers()
    }
  } finally { savingRoles.value = false }
}

onMounted(() => { loadRoles(); loadUsers() })
</script>
