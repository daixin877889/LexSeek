<template>
  <NuxtLayout name="admin-layout">
    <div class="space-y-6">
      <!-- 页面标题 -->
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-2xl md:text-3xl font-bold mb-1">权限分配</h1>
          <p class="text-muted-foreground text-sm">为角色「{{ role?.name }}」分配权限</p>
        </div>
        <Button variant="outline" @click="navigateTo('/admin/roles')" class="w-full md:w-auto">
          <ArrowLeft class="h-4 w-4 mr-2" />
          返回列表
        </Button>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="flex justify-center py-12">
        <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
      </div>

      <!-- 权限分配 -->
      <Tabs v-else-if="role" default-value="api" class="space-y-4">
        <TabsList>
          <TabsTrigger value="api">API 权限</TabsTrigger>
          <TabsTrigger value="route">路由权限</TabsTrigger>
        </TabsList>

        <!-- API 权限 -->
        <TabsContent value="api" class="space-y-4">
          <div class="bg-card rounded-lg border p-6 shadow-none">
            <div class="mb-4">
              <h3 class="text-base font-medium">API 权限列表</h3>
              <p class="text-sm text-muted-foreground">勾选需要分配给该角色的 API 权限</p>
            </div>
            <div class="flex gap-4 mb-4">
              <Input v-model="apiSearch" placeholder="搜索 API..." class="max-w-sm" />
            </div>
            <div class="bg-card rounded-lg border overflow-hidden max-h-96 overflow-y-auto">
              <table class="w-full">
                <thead class="sticky top-0 bg-card z-10">
                  <tr class="border-b bg-muted/50">
                    <th class="px-4 py-3 text-left text-sm font-medium w-12">
                      <Checkbox :model-value="isAllApiSelected" @update:model-value="toggleAllApi" />
                    </th>
                    <th class="px-4 py-3 text-left text-sm font-medium w-20">方法</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">路径</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">名称</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="perm in filteredApiPermissions" :key="perm.id"
                    class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                    <td class="px-4 py-3">
                      <Checkbox :model-value="selectedApiIds.includes(perm.id)"
                        @update:model-value="(c: boolean | 'indeterminate') => toggleApiPermission(perm.id, c)" />
                    </td>
                    <td class="px-4 py-3">
                      <Badge :variant="getMethodVariant(perm.method)">{{ perm.method }}</Badge>
                    </td>
                    <td class="px-4 py-3">
                      <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ perm.path }}</code>
                    </td>
                    <td class="px-4 py-3 text-sm">{{ perm.name }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="flex justify-end mt-4">
              <Button @click="saveApiPermissions" :disabled="savingApi">
                <Loader2 v-if="savingApi" class="h-4 w-4 mr-2 animate-spin" />
                保存 API 权限
              </Button>
            </div>
          </div>
        </TabsContent>

        <!-- 路由权限 -->
        <TabsContent value="route" class="space-y-4">
          <div class="bg-card rounded-lg border p-6 shadow-none">
            <div class="mb-4">
              <h3 class="text-base font-medium">路由权限列表</h3>
              <p class="text-sm text-muted-foreground">勾选需要分配给该角色的路由权限</p>
            </div>
            <div class="flex gap-4 mb-4">
              <Input v-model="routeSearch" placeholder="搜索路由..." class="max-w-sm" />
            </div>
            <div class="bg-card rounded-lg border overflow-hidden max-h-96 overflow-y-auto">
              <table class="w-full">
                <thead class="sticky top-0 bg-card z-10">
                  <tr class="border-b bg-muted/50">
                    <th class="px-4 py-3 text-left text-sm font-medium w-12">
                      <Checkbox :model-value="isAllRouteSelected" @update:model-value="toggleAllRoute" />
                    </th>
                    <th class="px-4 py-3 text-left text-sm font-medium">路由名称</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">路径</th>
                    <th class="px-4 py-3 text-center text-sm font-medium w-20">菜单</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in filteredRoutePermissions" :key="r.id"
                    class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                    <td class="px-4 py-3">
                      <Checkbox :model-value="selectedRouteIds.includes(r.id)"
                        @update:model-value="(c: boolean | 'indeterminate') => toggleRoutePermission(r.id, c)" />
                    </td>
                    <td class="px-4 py-3 text-sm font-medium">{{ r.title }}</td>
                    <td class="px-4 py-3">
                      <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{ r.path }}</code>
                    </td>
                    <td class="px-4 py-3 text-center">
                      <span :class="getMenuClass(r.isMenu)">{{ r.isMenu ? '是' : '否' }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="flex justify-end mt-4">
              <Button @click="saveRoutePermissions" :disabled="savingRoute">
                <Loader2 v-if="savingRoute" class="h-4 w-4 mr-2 animate-spin" />
                保存路由权限
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div v-else class="bg-card rounded-lg border p-12 text-center text-muted-foreground shadow-none">
        角色不存在
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { ArrowLeft, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

definePageMeta({ layout: false, title: "权限分配" })

const route = useRoute()
const roleId = computed(() => Number(route.params.id))

interface Role { id: number; name: string; code: string }
interface ApiPermission { id: number; path: string; method: string; name: string }
interface RoutePermission { id: number; name: string; title: string; path: string; isMenu: boolean }

const loading = ref(true)
const savingApi = ref(false)
const savingRoute = ref(false)
const role = ref<Role | null>(null)
const allApiPermissions = ref<ApiPermission[]>([])
const allRoutePermissions = ref<RoutePermission[]>([])
const selectedApiIds = ref<number[]>([])
const selectedRouteIds = ref<number[]>([])
const apiSearch = ref('')
const routeSearch = ref('')

const filteredApiPermissions = computed(() => {
  if (!apiSearch.value) return allApiPermissions.value
  const kw = apiSearch.value.toLowerCase()
  return allApiPermissions.value.filter(p => p.path.toLowerCase().includes(kw) || p.name.toLowerCase().includes(kw))
})

const filteredRoutePermissions = computed(() => {
  if (!routeSearch.value) return allRoutePermissions.value
  const kw = routeSearch.value.toLowerCase()
  return allRoutePermissions.value.filter(r => r.path.toLowerCase().includes(kw) || r.title.toLowerCase().includes(kw))
})

const isAllApiSelected = computed(() => filteredApiPermissions.value.length > 0 && filteredApiPermissions.value.every(p => selectedApiIds.value.includes(p.id)))
const isAllRouteSelected = computed(() => filteredRoutePermissions.value.length > 0 && filteredRoutePermissions.value.every(r => selectedRouteIds.value.includes(r.id)))

const getMethodVariant = (method: string) => {
  const v: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { GET: 'default', POST: 'secondary', PUT: 'outline', DELETE: 'destructive', PATCH: 'outline', '*': 'secondary' }
  return v[method] || 'outline'
}

const getMenuClass = (isMenu: boolean): string => {
  const base = 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium'
  return isMenu ? `${base} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400` : `${base} bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400`
}

const toggleApiPermission = (id: number, checked: boolean | 'indeterminate') => {
  if (checked === true) { if (!selectedApiIds.value.includes(id)) selectedApiIds.value.push(id) }
  else selectedApiIds.value = selectedApiIds.value.filter(i => i !== id)
}

const toggleRoutePermission = (id: number, checked: boolean | 'indeterminate') => {
  if (checked === true) { if (!selectedRouteIds.value.includes(id)) selectedRouteIds.value.push(id) }
  else selectedRouteIds.value = selectedRouteIds.value.filter(i => i !== id)
}

const toggleAllApi = (checked: boolean | 'indeterminate') => {
  if (checked === true) { selectedApiIds.value = [...new Set([...selectedApiIds.value, ...filteredApiPermissions.value.map(p => p.id)])] }
  else { const ids = new Set(filteredApiPermissions.value.map(p => p.id)); selectedApiIds.value = selectedApiIds.value.filter(id => !ids.has(id)) }
}

const toggleAllRoute = (checked: boolean | 'indeterminate') => {
  if (checked === true) { selectedRouteIds.value = [...new Set([...selectedRouteIds.value, ...filteredRoutePermissions.value.map(r => r.id)])] }
  else { const ids = new Set(filteredRoutePermissions.value.map(r => r.id)); selectedRouteIds.value = selectedRouteIds.value.filter(id => !ids.has(id)) }
}

const loadData = async () => {
  loading.value = true
  try {
    const [roleData, rolePerms, apiPerms, routes] = await Promise.all([
      useApiFetch<Role>(`/api/v1/admin/roles/${roleId.value}`),
      useApiFetch<{ apiPermissions: ApiPermission[]; routes: RoutePermission[] }>(`/api/v1/admin/roles/${roleId.value}/permissions`),
      useApiFetch<{ items: ApiPermission[] }>('/api/v1/admin/api-permissions', { query: { pageSize: 100 } }),
      useApiFetch<{ items: RoutePermission[] }>('/api/v1/admin/routers', { query: { pageSize: 100 } }),
    ])
    if (roleData) role.value = roleData
    if (rolePerms) { selectedApiIds.value = rolePerms.apiPermissions.map(p => p.id); selectedRouteIds.value = rolePerms.routes.map(r => r.id) }
    if (apiPerms) allApiPermissions.value = apiPerms.items
    if (routes) allRoutePermissions.value = routes.items
  } finally { loading.value = false }
}

const saveApiPermissions = async () => {
  savingApi.value = true
  try {
    const result = await useApiFetch(`/api/v1/admin/roles/${roleId.value}/api-permissions`, { method: 'PUT', body: { permissionIds: selectedApiIds.value } })
    if (result) toast.success('API 权限保存成功')
  } finally { savingApi.value = false }
}

const saveRoutePermissions = async () => {
  savingRoute.value = true
  try {
    const result = await useApiFetch(`/api/v1/admin/roles/${roleId.value}/route-permissions`, { method: 'PUT', body: { routerIds: selectedRouteIds.value } })
    if (result) toast.success('路由权限保存成功')
  } finally { savingRoute.value = false }
}

onMounted(() => { loadData() })
</script>
