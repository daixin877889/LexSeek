# Admin 侧边栏状态持久化优化实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 38 个 Admin 页面从页面内 `<NuxtLayout>` 改为路由级 Layout，同时将菜单状态提升到 Pinia Store，消除页面切换时侧边栏重新加载。

**Architecture:** 将 Layout 改为 Nuxt 路由级 Layout（而非页面级 Layout），Layout 在整个 Admin 会话期间只挂载一次。菜单数据和 UI 状态缓存在 Pinia Store 中，避免重复请求。

**Tech Stack:** Nuxt 4, Pinia, Vue 3 Composition API

---

## 文件变更总览

| 操作 | 文件 |
|------|------|
| 新建 | `app/store/adminMenu.ts` |
| 修改 | `app/composables/useAdminMenu.ts` |
| 修改 | `app/components/admin/NavMain.vue` |
| 修改 | `app/layouts/admin-layout.vue` |
| 修改 | 38 个 Admin 页面（`app/pages/admin/**/*.vue`） |

---

## 任务 1: 创建 adminMenu Pinia Store

**文件**: `app/store/adminMenu.ts`

- [ ] **Step 1: 创建 Store 文件**

```typescript
import { defineStore } from 'pinia'
import type { AdminMenuItem, AdminMenuGroup } from '~/composables/useAdminMenu'

/** adminMenuStore 返回类型 */
export interface AdminMenuStoreReturn {
  rawRouters: any[]
  isLoading: boolean
  error: ComputedRef<string | null>
  collapsedIds: Set<string>
  activeId: string
  scrollPosition: number
  menuGroups: ComputedRef<AdminMenuGroup[]>
  fetchMenuData: () => Promise<void>
  toggleSubmenu: (id: number) => void
  setActive: (path: string) => void
  setScrollPosition: (pos: number) => void
  isSubmenuCollapsed: (id: number) => boolean
  isActive: (path: string) => boolean
}

export const useAdminMenuStore = defineStore('adminMenu', (): AdminMenuStoreReturn => {
  // 原始路由数据
  const rawRouters = ref<any[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // UI 状态
  const collapsedIds = ref<Set<string>>(new Set())
  const activeId = ref<string>('')
  const scrollPosition = ref<number>(0)

  /** 加载菜单数据（有缓存则不重复请求） */
  async function fetchMenuData() {
    if (rawRouters.value.length > 0) return
    if (isLoading.value) return

    isLoading.value = true
    error.value = null
    try {
      const data = await $fetch<any>('/api/v1/admin/menu-routers')
      // API 返回 resSuccess 格式：{ code, message, data }
      if (data.code === 200 && data.data) {
        rawRouters.value = data.data
      }
    } catch (err: any) {
      error.value = err?.message || '获取菜单失败'
      console.error('获取 Admin 菜单失败:', err)
    } finally {
      isLoading.value = false
    }
  }

  /** 切换子菜单展开状态 */
  function toggleSubmenu(id: number) {
    const key = String(id)
    if (collapsedIds.value.has(key)) {
      collapsedIds.value.delete(key)
    } else {
      collapsedIds.value.add(key)
    }
    collapsedIds.value = new Set(collapsedIds.value) // 触发响应式
  }

  /** 设置当前激活菜单 */
  function setActive(path: string) {
    activeId.value = path
  }

  /** 设置滚动位置 */
  function setScrollPosition(pos: number) {
    scrollPosition.value = pos
  }

  /** 检查菜单是否折叠 */
  function isSubmenuCollapsed(id: number): boolean {
    return collapsedIds.value.has(String(id))
  }

  /** 检查菜单是否激活 */
  function isActive(path: string): boolean {
    return activeId.value === path
  }

  /** 分组后的菜单数据（带权限过滤） */
  const permissionStore = usePermissionStore()
  const menuGroups = computed<AdminMenuGroup[]>(() => {
    const routers = rawRouters.value
      .filter((r: any) => r.isMenu && r.path?.startsWith('/admin'))
      .filter((r: any) => permissionStore.isSuperAdmin || permissionStore.hasRoutePermission(r.path))

    const groupMap = new Map<string, AdminMenuItem[]>()
    const groupSortMap = new Map<string, number>()

    for (const router of routers) {
      const groupName = router.menuGroup || '其他'
      const groupSort = router.menuGroupSort ?? 999

      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, [])
        groupSortMap.set(groupName, groupSort)
      }

      groupMap.get(groupName)!.push({
        id: router.id,
        path: router.path,
        title: router.title,
        icon: getAdminIcon(router.icon),
        sort: router.sort ?? 0,
      })
    }

    return Array.from(groupMap.entries())
      .map(([name, items]) => ({
        name,
        sort: groupSortMap.get(name) ?? 999,
        items: items.sort((a, b) => a.sort - b.sort),
      }))
      .filter(group => group.items.length > 0)
      .sort((a, b) => a.sort - b.sort)
  })

  return {
    rawRouters,
    isLoading,
    error: computed(() => error.value),
    collapsedIds,
    activeId,
    scrollPosition,
    menuGroups,
    fetchMenuData,
    toggleSubmenu,
    setActive,
    setScrollPosition,
    isSubmenuCollapsed,
    isActive,
  }
})
```

> **注意**: `getAdminIcon` 函数从 `useAdminMenu.ts` 移动到 Store 文件顶部。

- [ ] **Step 2: 运行类型检查**

Run: `cd /Users/daixin/work/dev/LexSeek/LexSeek && bun run typecheck`
Expected: 无新增类型错误

- [ ] **Step 3: 提交**

```bash
git add app/store/adminMenu.ts
git commit -m "feat(ui): add adminMenu Pinia store for sidebar state"
```

---

## 任务 2: 重构 useAdminMenu Composable

**文件**: `app/composables/useAdminMenu.ts`

- [ ] **Step 1: 重写 useAdminMenu.ts**

```typescript
/**
 * Admin 菜单 Composable
 * 读写 adminMenuStore，为组件提供响应式菜单数据
 */

import type { Component } from 'vue'

/** 菜单项 */
export interface AdminMenuItem {
    id: number
    path: string
    title: string
    icon: Component | null
    sort: number
}

/** 菜单分组 */
export interface AdminMenuGroup {
    name: string
    sort: number
    items: AdminMenuItem[]
}

/** useAdminMenu 返回类型 */
export interface UseAdminMenuReturn {
    menuGroups: ComputedRef<AdminMenuGroup[]>
    isLoading: ComputedRef<boolean>
    error: ComputedRef<string | null>
    isActive: (path: string) => boolean
    isSubmenuCollapsed: (id: number) => boolean
    toggleSubmenu: (id: number) => void
}

/**
 * 获取图标组件
 * 复用 Dashboard 的图标映射逻辑
 */
export const getAdminIcon = (iconName: string | null): Component | null => {
    if (!iconName) return null
    if (iconName.startsWith('lucideIcons.')) {
        const name = iconName.replace('lucideIcons.', '')
        return (lucideIcons[name as keyof typeof lucideIcons] as Component) || null
    }
    return (lucideIcons[iconName as keyof typeof lucideIcons] as Component) || null
}

/**
 * Admin 菜单 Composable
 * 委托给 adminMenuStore，组件层无需感知 Store 细节
 */
export function useAdminMenu(): UseAdminMenuReturn {
    const store = useAdminMenuStore()
    const route = useRoute()

    // 路由变化时更新激活状态
    watch(() => route.path, (path) => {
        const matchedRouter = store.rawRouters.find((r: any) => {
            if (r.path === path) return true
            if (path.startsWith(r.path + '/')) {
                const moreSpecific = store.rawRouters.some((r2: any) =>
                    r2.path !== r.path && r2.path !== path && path.startsWith(r2.path + '/')
                )
                return !moreSpecific
            }
            return false
        })
        if (matchedRouter) {
            store.setActive(matchedRouter.path)
        }
    }, { immediate: true })

    return {
        menuGroups: computed(() => store.menuGroups),
        isLoading: computed(() => store.isLoading),
        error: store.error,
        isActive: store.isActive,
        isSubmenuCollapsed: store.isSubmenuCollapsed,
        toggleSubmenu: store.toggleSubmenu,
    }
}
```

- [ ] **Step 2: 验证无破坏**

Run: `bun run typecheck`
Expected: 无新增类型错误

- [ ] **Step 3: 提交**

```bash
git add app/composables/useAdminMenu.ts
git commit -m "refactor(ui): migrate useAdminMenu to delegate to adminMenuStore"
```

---

## 任务 3: 更新 NavMain 组件

**文件**: `app/components/admin/NavMain.vue`

- [ ] **Step 1: 确认组件兼容**

NavMain 当前使用 `isActive(path)` 判断高亮，refactor 后 `isActive` 从 Store 获取，行为不变。

当前菜单数据结构为平铺（无嵌套 children），`toggleSubmenu`/`isSubmenuCollapsed` 在 Store 中保留备用。

模板无需改动，组件自动从 Store 读取响应式状态。

- [ ] **Step 2: 验证组件正常渲染**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/components/admin/NavMain.vue
git commit -m "refactor(ui): NavMain reads active state from store"
```

---

## 任务 4: 更新 admin-layout 布局组件

**文件**: `app/layouts/admin-layout.vue`

- [ ] **Step 1: 修改 admin-layout.vue**

在 Layout 的 `onMounted` 中调用 `fetchMenuData()`，确保 Store 数据在 Layout 挂载时预加载。同时监听侧边栏滚动位置变化。

```vue
<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'

const store = useAdminMenuStore()

// Layout 挂载时加载菜单数据（后续页面切换不再重复请求）
onMounted(() => {
  store.fetchMenuData()

  // 恢复滚动位置
  const sidebar = document.querySelector('[data-sidebar-content]')
  if (sidebar && store.scrollPosition > 0) {
    sidebar.scrollTop = store.scrollPosition
  }

  // 监听滚动位置变化
  const contentEl = document.querySelector('[data-sidebar-content]') as HTMLElement
  if (contentEl) {
    const handleScroll = () => {
      store.setScrollPosition(contentEl.scrollTop)
    }
    contentEl.addEventListener('scroll', handleScroll, { passive: true })
    onUnmounted(() => contentEl.removeEventListener('scroll', handleScroll))
  }
})
</script>
```

在模板中找到 `<SidebarContent>` 标签，添加 `data-sidebar-content` 属性：

```vue
<SidebarContent data-sidebar-content>
```

- [ ] **Step 2: 验证**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add app/layouts/admin-layout.vue
git commit -m "refactor(ui): admin-layout loads menu data on mount and persists scroll"
```

---

## 任务 5: 迁移 38 个 Admin 页面

将所有 38 个 Admin 页面从 `<NuxtLayout name="admin-layout">` 改为 `definePageMeta({ layout: 'admin-layout' })`。

### 预检查

- [ ] **Step 0: 确认页面总数**

Run: `grep -r 'NuxtLayout.*admin-layout' app/pages/admin --include='*.vue' -l | wc -l`
Expected: `38`

### 实际文件分组

所有 38 个文件均在 `app/pages/admin/` 下，分为两组：

**A 组（31 个文件）**: `definePageMeta({ layout: false,` 在同一行
**B 组（7 个文件）**: `definePageMeta({` 和 `layout: false` 在不同行（多行格式）

### A 组迁移（31 个文件）

- [ ] **Step A1: 替换 layout: false → layout: 'admin-layout'**

```bash
for f in \
  "app/pages/admin/redemption-codes/records.vue" \
  "app/pages/admin/redemption-codes/index.vue" \
  "app/pages/admin/case-types/index.vue" \
  "app/pages/admin/campaigns/index.vue" \
  "app/pages/admin/benefits/membership.vue" \
  "app/pages/admin/benefits/grant.vue" \
  "app/pages/admin/benefits/index.vue" \
  "app/pages/admin/demo-cases/index.vue" \
  "app/pages/admin/prompts/[id].vue" \
  "app/pages/admin/prompts/index.vue" \
  "app/pages/admin/users/index.vue" \
  "app/pages/admin/node-groups/index.vue" \
  "app/pages/admin/mineru-tasks/index.vue" \
  "app/pages/admin/audit/index.vue" \
  "app/pages/admin/access/index.vue" \
  "app/pages/admin/asr-tasks/index.vue" \
  "app/pages/admin/nodes/[id].vue" \
  "app/pages/admin/nodes/index.vue" \
  "app/pages/admin/mineru-tokens/index.vue" \
  "app/pages/admin/permissions/routes/index.vue" \
  "app/pages/admin/point-items/index.vue" \
  "app/pages/admin/models/index.vue" \
  "app/pages/admin/model-api-keys/index.vue" \
  "app/pages/admin/model-providers/[id].vue" \
  "app/pages/admin/permissions/api/index.vue" \
  "app/pages/admin/model-providers/index.vue" \
  "app/pages/admin/products/index.vue" \
  "app/pages/admin/roles/[id]/permissions.vue" \
  "app/pages/admin/roles/index.vue" \
  "app/pages/admin/roles/create.vue" \
  "app/pages/admin/roles/[id]/index.vue"; do
  sed -i '' "s/definePageMeta({ layout: false,/definePageMeta({ layout: 'admin-layout',/g" "$f"
done
```

- [ ] **Step A2: 删除 NuxtLayout 标签对（A 组 31 个文件）**

Python 脚本处理：

```python
import os

base = "/Users/daixin/work/dev/LexSeek/LexSeek"

files_a = [
    "app/pages/admin/redemption-codes/records.vue",
    "app/pages/admin/redemption-codes/index.vue",
    "app/pages/admin/case-types/index.vue",
    "app/pages/admin/campaigns/index.vue",
    "app/pages/admin/benefits/membership.vue",
    "app/pages/admin/benefits/grant.vue",
    "app/pages/admin/benefits/index.vue",
    "app/pages/admin/demo-cases/index.vue",
    "app/pages/admin/prompts/[id].vue",
    "app/pages/admin/prompts/index.vue",
    "app/pages/admin/users/index.vue",
    "app/pages/admin/node-groups/index.vue",
    "app/pages/admin/mineru-tasks/index.vue",
    "app/pages/admin/audit/index.vue",
    "app/pages/admin/access/index.vue",
    "app/pages/admin/asr-tasks/index.vue",
    "app/pages/admin/nodes/[id].vue",
    "app/pages/admin/nodes/index.vue",
    "app/pages/admin/mineru-tokens/index.vue",
    "app/pages/admin/permissions/routes/index.vue",
    "app/pages/admin/point-items/index.vue",
    "app/pages/admin/models/index.vue",
    "app/pages/admin/model-api-keys/index.vue",
    "app/pages/admin/model-providers/[id].vue",
    "app/pages/admin/permissions/api/index.vue",
    "app/pages/admin/model-providers/index.vue",
    "app/pages/admin/products/index.vue",
    "app/pages/admin/roles/[id]/permissions.vue",
    "app/pages/admin/roles/index.vue",
    "app/pages/admin/roles/create.vue",
    "app/pages/admin/roles/[id]/index.vue",
]

for f in files_a:
    path = os.path.join(base, f)
    with open(path) as fp:
        content = fp.read()
    content = content.replace('<NuxtLayout name="admin-layout">\n', '')
    content = content.replace('<NuxtLayout name="admin-layout">', '')
    content = content.replace('\n  </NuxtLayout>\n', '\n')
    content = content.replace('  </NuxtLayout>\n', '')
    content = content.replace('</NuxtLayout>\n', '')
    content = content.replace('</NuxtLayout>', '')
    with open(path, 'w') as fp:
        fp.write(content)
    print(f"Processed: {f}")
```

### B 组迁移（7 个文件，多行 definePageMeta）

- [ ] **Step B1: 手动修改 B 组文件**

B 组文件列表：

1. `app/pages/admin/index.vue`
2. `app/pages/admin/legal-main/detail/[id].vue`
3. `app/pages/admin/legal-main/edit/[id].vue`
4. `app/pages/admin/legal-main/create.vue`
5. `app/pages/admin/legal-main/full-update/[id].vue`
6. `app/pages/admin/legal-main/articles/[id].vue`
7. `app/pages/admin/legal-main/embeddings/[id].vue`

每个文件两处改动：
- 将 `layout: false,` 行改为 `layout: 'admin-layout',`
- 删除模板中的 `<NuxtLayout name="admin-layout">` 和 `</NuxtLayout>` 包裹标签

使用 Edit 工具逐一修改。

### 验证

- [ ] **Step 6: 验证迁移完成**

Run: `grep -r 'NuxtLayout.*admin-layout' app/pages/admin --include='*.vue' | wc -l`
Expected: `0`

- [ ] **Step 7: 验证 definePageMeta 正确**

Run: `grep -r "definePageMeta.*layout.*admin-layout" app/pages/admin --include='*.vue' | wc -l`
Expected: `38`

- [ ] **Step 8: 类型检查**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 9: 提交**

```bash
git add app/pages/admin/
git commit -m "refactor(ui): migrate 38 admin pages to route-level layout"
```

---

## 任务 6: 端到端验证

- [ ] **Step 1: 启动开发服务器**

Run: `cd /Users/daixin/work/dev/LexSeek/LexSeek && bun dev`

- [ ] **Step 2: 手动验证**

1. 登录并进入管理后台（`/admin`）
2. 观察侧边栏加载
3. 导航到任意子页面（如 `/admin/users`）
4. 观察侧边栏是否保持挂载（无闪烁）
5. 滚动侧边栏后切换页面，验证滚动位置保持
6. 刷新页面，验证状态正常重置

- [ ] **Step 3: 提交验证结果**

```bash
git add -A
git commit -m "test(ui): verify sidebar persists across admin page navigation"
```

---

## 回滚方案

如果出现问题，改回 `<NuxtLayout name="admin-layout">` 包裹模板：

```bash
git revert HEAD
```
