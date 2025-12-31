<template>
  <NuxtLayout name="admin-layout">
    <div class="space-y-6">
      <!-- 页面标题 -->
      <div>
        <h1 class="text-2xl md:text-3xl font-bold mb-1">用户角色管理</h1>
        <p class="text-muted-foreground text-sm">管理用户的角色分配</p>
      </div>

      <!-- 搜索和筛选 -->
      <div class="flex flex-col md:flex-row gap-4">
        <Input v-model="searchKeyword" placeholder="搜索用户名或手机号..." class="md:max-w-sm" @keyup.enter="handleSearch" />
        <Select v-model="roleFilter">
          <SelectTrigger class="w-full md:w-40">
            <SelectValue placeholder="角色筛选" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部角色</SelectItem>
            <SelectItem v-for="role in allRoles" :key="role.id" :value="String(role.id)">{{ role.name }}</SelectItem>
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
      <div v-else-if="!users.length" class="flex flex-col items-center justify-center py-12 text-center">
        <Users class="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 class="text-lg font-medium mb-1">暂无用户数据</h3>
        <p class="text-muted-foreground text-sm">系统中还没有用户</p>
      </div>

      <!-- 用户列表 -->
      <template v-else>
        <!-- 桌面端表格 -->
        <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th class="px-4 py-3 text-left text-sm font-medium">用户名</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">手机号</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">角色</th>
                  <th class="px-4 py-3 text-center text-sm font-medium w-20">状态</th>
                  <th class="px-4 py-3 text-left text-sm font-medium w-40">注册时间</th>
                  <th class="px-4 py-3 text-center text-sm font-medium w-28">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in users" :key="user.id"
                  class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                      <User class="h-4 w-4 text-muted-foreground" />
                      <span class="font-medium">{{ user.name || '-' }}</span>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-sm">{{ user.phone }}</td>
                  <td class="px-4 py-3">
                    <div class="flex flex-wrap gap-1">
                      <Badge v-for="role in user.roles" :key="role.id" variant="outline">{{ role.name }}</Badge>
                      <span v-if="!user.roles?.length" class="text-muted-foreground text-sm">-</span>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <span :class="getStatusClass(user.status)">{{ user.status === 1 ? '正常' : '禁用' }}</span>
                  </td>
                  <td class="px-4 py-3 text-sm text-muted-foreground">{{ formatDate(user.createdAt) }}</td>
                  <td class="px-4 py-3 text-center">
                    <Button variant="ghost" size="sm" @click="openRoleDialog(user)">
                      <Shield class="h-4 w-4 mr-1" />
                      分配角色
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 移动端卡片 -->
        <div class="md:hidden space-y-3">
          <div v-for="user in users" :key="user.id" class="bg-card rounded-lg border p-4 space-y-3">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-2">
                <User class="h-4 w-4 text-muted-foreground" />
                <span class="font-medium">{{ user.name || user.phone }}</span>
              </div>
              <span :class="getStatusClass(user.status)">{{ user.status === 1 ? '正常' : '禁用' }}</span>
            </div>
            <div class="text-sm text-muted-foreground">{{ user.phone }}</div>
            <div class="flex flex-wrap gap-1">
              <Badge v-for="role in user.roles" :key="role.id" variant="outline">{{ role.name }}</Badge>
              <span v-if="!user.roles?.length" class="text-muted-foreground text-sm">无角色</span>
            </div>
            <div class="text-xs text-muted-foreground">注册于 {{ formatDate(user.createdAt) }}</div>
            <div class="pt-2 border-t">
              <Button variant="outline" size="sm" class="w-full" @click="openRoleDialog(user)">
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>分配角色</DialogTitle>
          <DialogDescription>为用户「{{ selectedUser?.name || selectedUser?.phone }}」分配角色</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <Label>选择角色</Label>
            <div class="border rounded-md p-4 max-h-60 overflow-y-auto space-y-2">
              <div v-for="role in allRoles" :key="role.id" class="flex items-center space-x-2">
                <Checkbox :id="`role-${role.id}`" :checked="selectedRoleIds.includes(role.id)"
                  @update:checked="(checked: boolean | 'indeterminate') => toggleRole(role.id, checked)" />
                <Label :for="`role-${role.id}`" class="font-normal cursor-pointer">
                  {{ role.name }}
                  <span class="text-muted-foreground text-xs ml-1">({{ role.code }})</span>
                </Label>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="roleDialogOpen = false">取消</Button>
          <Button @click="saveUserRoles" :disabled="savingRoles">
            <Loader2 v-if="savingRoles" class="h-4 w-4 mr-2 animate-spin" />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { Search, Shield, Loader2, Users, User } from 'lucide-vue-next'
import dayjs from 'dayjs'
import { toast } from 'vue-sonner'

definePageMeta({ layout: false, title: "用户角色管理" })

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

const formatDate = (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm')

const getStatusClass = (status: number): string => {
  const baseClass = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium'
  return status === 1
    ? `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
    : `${baseClass} bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400`
}

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
    const result = await useApiFetch(`/api/v1/admin/users/${selectedUser.value.id}/roles`, {
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
