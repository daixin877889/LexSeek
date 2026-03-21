# Admin 侧边栏状态持久化优化设计

## 1. 背景与目标

### 现状问题

36 个 Admin 页面每个都在模板内使用 `<NuxtLayout name="admin-layout">`，导致每次页面切换时：

- Layout 组件完全卸载并重新挂载
- 侧边栏闪烁，展开的子菜单、滚动位置丢失
- 菜单 API 每次页面切换都重复请求

### 目标

- Layout 在整个 Admin 会话期间只挂载一次，页面切换时不重建
- 侧边栏状态（展开的子菜单、选中菜单、滚动位置）在页面切换时保留
- 菜单 API 数据缓存，避免重复请求

## 2. 解决方案

### 核心策略

将 Layout 改为 Nuxt 路由级 Layout（而非页面级 Layout），同时将菜单和 UI 状态提升到 Pinia Store。

### 状态分层

```
adminMenuStore (Pinia)
├── menuGroups          # 菜单数据（带权限过滤）
├── isLoading           # 菜单加载状态
├── collapsedIds       # 当前展开的子菜单 ID 集合 (Set<string>)
├── activeId           # 当前选中菜单 ID
└── scrollPosition     # 侧边栏滚动位置
```

- 折叠状态（`isCollapsed`）保持现有 Cookie 方案不变
- 展开的子菜单、滚动位置等使用内存状态（刷新页面后重置）

## 3. 详细设计

### 3.1 新增 Pinia Store

**文件**: `app/store/adminMenu.ts`

```typescript
export const useAdminMenuStore = defineStore('adminMenu', () => {
  // 菜单数据
  const menuGroups = ref<MenuGroup[]>([])
  const isLoading = ref(false)

  // UI 状态
  const collapsedIds = ref<Set<string>>(new Set())
  const activeId = ref<string>('')
  const scrollPosition = ref(0)

  // 菜单数据请求
  async function fetchMenuData() {
    if (menuGroups.value.length > 0) return // 有缓存不重复请求
    isLoading.value = true
    try {
      const data = await $fetch<any>('/api/v1/admin/menu-routers')
      menuGroups.value = filterMenuByPermission(data)
    } finally {
      isLoading.value = false
    }
  }

  function toggleSubmenu(id: string) {
    if (collapsedIds.value.has(id)) {
      collapsedIds.value.delete(id)
    } else {
      collapsedIds.value.add(id)
    }
    collapsedIds.value = new Set(collapsedIds.value) // 触发响应式
  }

  function setActive(id: string) {
    activeId.value = id
  }

  function setScrollPosition(pos: number) {
    scrollPosition.value = pos
  }

  return {
    menuGroups, isLoading, collapsedIds, activeId, scrollPosition,
    fetchMenuData, toggleSubmenu, setActive, setScrollPosition
  }
})
```

### 3.2 修改 useAdminMenu Composable

**文件**: `app/composables/useAdminMenu.ts`

保留接口不变，内部改为读写 Store：

```typescript
export function useAdminMenu() {
  const store = useAdminMenuStore()
  const route = useRoute()
  const permissionStore = usePermissionStore()

  // 首次加载时请求菜单数据
  onMounted(async () => {
    if (permissionStore.isSuperAdmin || permissionStore.adminPermissions.length > 0) {
      await store.fetchMenuData()
    }
  })

  // 路由变化时更新 activeId
  watch(() => route.path, (path) => {
    const id = findActiveMenuId(store.menuGroups, path)
    if (id) store.setActive(id)
  }, { immediate: true })

  return {
    menuGroups: computed(() => store.menuGroups),
    isLoading: computed(() => store.isLoading),
    isActive: (id: string) => computed(() => store.activeId === id),
    toggleSubmenu: store.toggleSubmenu,
    isSubmenuCollapsed: (id: string) => computed(() => !store.collapsedIds.has(id))
  }
}
```

### 3.3 修改 NavMain 组件

**文件**: `app/components/admin/NavMain.vue`

从 Store 读取展开/选中状态：

```vue
<script setup lang="ts">
const { menuGroups, isLoading, isActive, isSubmenuCollapsed, toggleSubmenu } = useAdminMenu()

// 点击菜单项时切换子菜单展开状态
function handleMenuClick(item: MenuItem) {
  if (item.children?.length) {
    toggleSubmenu(item.id)
  }
}
</script>

<template>
  <!-- 模板中用 isActive(id).value 和 isSubmenuCollapsed(id).value -->
</template>
```

### 3.4 修改 Layout

**文件**: `app/layouts/admin-layout.vue`

Layout 订阅 Store 状态，保持自身挂载：

```vue
<script setup lang="ts">
// Layout 本身不请求数据，数据在 useAdminMenu 的 onMounted 中请求
// 确保 Store 首次加载
const store = useAdminMenuStore()
onMounted(() => {
  store.fetchMenuData()
})
</script>

<template>
  <!-- 模板不变 -->
</template>
```

### 3.5 修改 36 个 Admin 页面

所有 Admin 页面统一改为 `definePageMeta` 方式：

```vue
<script setup lang="ts">
definePageMeta({
  layout: 'admin-layout'  // 移除 <NuxtLayout name="admin-layout"> 模板标签
})
</script>
```

受影响的页面（按目录分组）：

- `app/pages/admin/**/*.vue` — 所有管理后台页面
- `app/pages/auth/admin-*.vue` — 管理后台认证页面

**操作方式**：批量查找替换，将 `<NuxtLayout name="admin-layout">` 及对应闭合标签替换为 `definePageMeta`。

## 4. 页面切换流程对比

### 改动前

```
页面 A 切换到 页面 B
  → 页面 A 卸载
  → 页面 A 的 <NuxtLayout> 卸载
  → admin-layout 组件卸载（Sidebar 卸载）
  → 页面 B 挂载
  → 页面 B 的 <NuxtLayout> 挂载
  → admin-layout 重新挂载（Sidebar 重新挂载）
  → 菜单 API 重新请求
```

### 改动后

```
页面 A 切换到 页面 B
  → 页面 A 卸载（Layout 保持挂载）
  → Sidebar 保持挂载，状态保留
  → 页面 B 挂载（使用同一 Layout 实例）
  → 菜单 API 不重复请求（有 Store 缓存）
```

## 5. 测试验证

1. **状态保留**：切换页面后，展开的子菜单、滚动位置保持不变
2. **API 调用**：验证菜单 API 在首次加载后不再被重复调用
3. **功能正常**：折叠/展开、权限过滤、选中高亮等原有功能不受影响

## 6. 风险与回滚

- **风险低**：纯重构，不改变业务逻辑
- **回滚方案**：保留 git commit，改回模板内 `<NuxtLayout>` 即可快速回滚
