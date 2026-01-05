# Design Document: Admin RBAC Menu

## Overview

本设计文档描述如何将后台管理系统的硬编码菜单改造为基于 RBAC 权限系统的动态菜单。

### 现状分析

1. **Dashboard 菜单**：`app/components/dashboard/navMain.vue` 已实现动态菜单，使用 `roleStore.currentRoleRouters` 获取数据，无分组显示
2. **Admin 菜单**：`app/components/admin/NavMain.vue` 使用硬编码菜单，按功能分组（权限管理、权益管理等）
3. **路由分组（routerGroups）**：用于区分路由类型（公共页面、管理后台、工作台），不是菜单内部分组

### 设计方案

由于 Admin 菜单需要按功能分组显示，而现有的 `routerGroups` 是用于区分路由类型的，我们需要：

1. **扩展路由表**：在 `routers` 表中新增 `menuGroup` 字段，用于定义菜单内部分组
2. **复用 Dashboard 逻辑**：Admin 菜单复用 Dashboard 的动态菜单逻辑，增加分组处理
3. **图标映射**：复用 Dashboard 已有的图标映射逻辑

## Architecture

```mermaid
graph TD
    A[admin/NavMain.vue] --> B[useAdminMenu composable]
    B --> C[Role Store]
    C --> D[/api/v1/users/routers]
    D --> E[userRoles.dao.ts]
    E --> F[(Database)]
    
    B --> G[getIcon 函数]
    G --> H[Lucide Icons]
    
    subgraph "数据流"
        D -->|返回路由数据| C
        C -->|currentRoleRouters| B
        B -->|按 menuGroup 分组| A
    end
    
    I[dashboard/navMain.vue] --> C
    I --> G
```

## Components and Interfaces

### 1. 数据库扩展：路由表新增菜单分组字段

在 `routers` 表中新增 `menuGroup` 和 `menuGroupSort` 字段，用于定义菜单内部分组。

```prisma
// prisma/models/router.prisma 扩展
model routers {
    // ... 现有字段
    
    /// 菜单分组名称（如"权限管理"、"运营管理"）
    menuGroup     String?   @map("menu_group") @db.VarChar(100)
    /// 菜单分组排序
    menuGroupSort Int       @default(0) @map("menu_group_sort")
}
```

### 2. API 响应结构（无需修改）

现有 `/api/v1/users/routers` 接口返回的数据结构已满足需求，只需确保新增字段被返回。

```typescript
// 路由数据结构
interface RouterData {
  id: number
  name: string
  title: string
  path: string
  icon: string | null
  isMenu: boolean
  parentId: number | null
  groupId: number
  sort: number
  menuGroup: string | null      // 新增：菜单分组名称
  menuGroupSort: number         // 新增：菜单分组排序
}
```

### 3. useAdminMenu Composable

创建新的 composable 处理 Admin 菜单数据，复用 Dashboard 的图标映射逻辑。

```typescript
// app/composables/useAdminMenu.ts

interface MenuItem {
  id: number
  path: string
  title: string
  icon: Component | null
  sort: number
}

interface MenuGroup {
  name: string
  sort: number
  items: MenuItem[]
}

interface UseAdminMenuReturn {
  menuGroups: ComputedRef<MenuGroup[]>
  isLoading: Ref<boolean>
  error: Ref<string | null>
  isActive: (path: string) => boolean
}

export function useAdminMenu(): UseAdminMenuReturn {
  const roleStore = useRoleStore()
  const route = useRoute()
  
  // 将路由数据按 menuGroup 分组
  const menuGroups = computed<MenuGroup[]>(() => {
    const routers = roleStore.currentRoleRouters
      .filter((r: any) => r.isMenu && r.path.startsWith('/admin'))
    
    // 按 menuGroup 分组
    const groupMap = new Map<string, MenuItem[]>()
    const groupSortMap = new Map<string, number>()
    
    for (const router of routers) {
      const groupName = router.menuGroup || '其他'
      const groupSort = router.menuGroupSort || 999
      
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, [])
        groupSortMap.set(groupName, groupSort)
      }
      
      groupMap.get(groupName)!.push({
        id: router.id,
        path: router.path,
        title: router.title,
        icon: getIcon(router.icon),
        sort: router.sort,
      })
    }
    
    // 转换为数组并排序
    return Array.from(groupMap.entries())
      .map(([name, items]) => ({
        name,
        sort: groupSortMap.get(name) || 999,
        items: items.sort((a, b) => a.sort - b.sort),
      }))
      .filter(group => group.items.length > 0)
      .sort((a, b) => a.sort - b.sort)
  })
  
  // 路由匹配逻辑（复用 Dashboard 的实现）
  const isActive = (path: string): boolean => {
    if (route.path === path) return true
    if (route.path.startsWith(path + '/')) {
      const allPaths = roleStore.currentRoleRouters
        .filter((r: any) => r.isMenu)
        .map((r: any) => r.path)
      return !allPaths.some((p: string) => p !== path && route.path.startsWith(p))
    }
    return false
  }
  
  return {
    menuGroups,
    isLoading: computed(() => roleStore.loading),
    error: computed(() => roleStore.error),
    isActive,
  }
}
```

### 4. 图标映射（复用现有实现）

Dashboard 的 `navMain.vue` 已实现图标映射，Admin 菜单复用相同逻辑：

```typescript
// 复用 dashboard/navMain.vue 中的 getIcon 函数
const getIcon = (iconName: string): Component | undefined => {
  if (!iconName) return undefined
  // 如果格式是 "lucideIcons.LayoutDashboardIcon"
  if (iconName.startsWith("lucideIcons.")) {
    const name = iconName.replace("lucideIcons.", "")
    return lucideIcons[name as keyof typeof lucideIcons] as Component
  }
  // 如果只是图标名称 "LayoutDashboardIcon"
  return lucideIcons[iconName as keyof typeof lucideIcons] as Component
}
```

### 5. NavMain.vue 组件改造

```vue
<template>
  <!-- 动态渲染菜单分组 -->
  <SidebarGroup v-for="group in menuGroups" :key="group.name">
    <SidebarGroupLabel>{{ group.name }}</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem v-for="item in group.items" :key="item.id">
          <SidebarMenuButton 
            as-child 
            :tooltip="item.title"
            :class="isActive(item.path) ? 'bg-primary/10 text-primary' : ''"
          >
            <NuxtLink :to="item.path">
              <component v-if="item.icon" :is="item.icon" class="h-4 w-4" />
              <span>{{ item.title }}</span>
            </NuxtLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
  
  <!-- 空状态 -->
  <div v-if="menuGroups.length === 0 && !isLoading" class="p-4 text-center text-muted-foreground">
    暂无可访问的菜单
  </div>
</template>

<script setup lang="ts">
const { menuGroups, isLoading, isActive } = useAdminMenu()
</script>
```

## Data Models

### 数据库模型扩展

```prisma
// routers 表扩展（新增字段）
model routers {
    id            Int       @id @default(autoincrement())
    name          String    @unique @db.VarChar(100)
    title         String    @db.VarChar(100)
    description   String?   @db.VarChar(200)
    path          String    @unique @db.VarChar(200)
    isMenu        Boolean   @default(false) @map("is_menu")
    parentId      Int?      @map("parent_id")
    icon          String?   @db.VarChar(100)
    groupId       Int       @default(0) @map("group_id")  // 路由类型分组
    sort          Int       @default(0)
    
    // 新增字段
    menuGroup     String?   @map("menu_group") @db.VarChar(100)  // 菜单内部分组名称
    menuGroupSort Int       @default(0) @map("menu_group_sort")  // 菜单分组排序
    
    // ... 时间戳和关联
}
```

### 前端数据结构

```typescript
// 菜单项
interface MenuItem {
  id: number
  path: string
  title: string
  icon: Component | null
  sort: number
}

// 菜单分组
interface MenuGroup {
  name: string
  sort: number
  items: MenuItem[]
}

// 路由数据（从 API 返回）
interface RouterData {
  id: number
  name: string
  title: string
  path: string
  icon: string | null
  isMenu: boolean
  parentId: number | null
  groupId: number
  sort: number
  menuGroup: string | null
  menuGroupSort: number
}
```

### 菜单分组配置示例

在数据库中配置 Admin 路由时，设置 `menuGroup` 和 `menuGroupSort`：

| path | title | menuGroup | menuGroupSort | sort |
|------|-------|-----------|---------------|------|
| /admin/roles | 角色管理 | 权限管理 | 1 | 1 |
| /admin/permissions/api | API 权限 | 权限管理 | 1 | 2 |
| /admin/permissions/routes | 路由权限 | 权限管理 | 1 | 3 |
| /admin/users | 用户管理 | 权限管理 | 1 | 4 |
| /admin/audit | 审计日志 | 权限管理 | 1 | 5 |
| /admin/benefits | 权益类型 | 权益管理 | 2 | 1 |
| /admin/benefits/membership | 会员权益 | 权益管理 | 2 | 2 |
| /admin/benefits/grant | 用户权益发放 | 权益管理 | 2 | 3 |
| /admin/products | 产品管理 | 运营管理 | 3 | 1 |
| /admin/campaigns | 营销活动 | 运营管理 | 3 | 2 |
| /admin/redemption-codes | 兑换码管理 | 运营管理 | 3 | 3 |
| /admin/redemption-codes/records | 兑换记录 | 运营管理 | 3 | 4 |
| /admin/legal-main | 法律法规 | 知识库管理 | 4 | 1 |
| /admin/model-providers | 模型提供商 | 模型管理 | 5 | 1 |
| /admin/model-api-keys | API 密钥 | 模型管理 | 5 | 2 |
| /admin/models | 模型配置 | 模型管理 | 5 | 3 |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: 菜单过滤正确性

*For any* 路由数据集合，经过菜单过滤后的结果应该只包含 `isMenu=true` 且 `path` 以 `/admin` 开头的路由。

**Validates: Requirements 1.2**

### Property 2: 分组排序正确性

*For any* 菜单分组集合，分组应该按照 `menuGroupSort` 字段升序排列。即对于任意相邻的两个分组 `groups[i]` 和 `groups[i+1]`，应满足 `groups[i].sort <= groups[i+1].sort`。

**Validates: Requirements 2.3**

### Property 3: 菜单项排序正确性

*For any* 菜单分组，该分组内的菜单项应该按照 `sort` 字段升序排列。即对于任意分组内相邻的两个菜单项 `items[i]` 和 `items[i+1]`，应满足 `items[i].sort <= items[i+1].sort`。

**Validates: Requirements 2.4**

### Property 4: 分组非空性

*For any* 最终渲染的菜单分组集合，每个分组都应该包含至少一个菜单项。即 `group.items.length > 0` 对所有分组成立。

**Validates: Requirements 2.2**

### Property 5: 路由匹配正确性

*For any* 当前路由路径和菜单项路径，`isActive` 函数应该在以下情况返回 `true`：
1. 精确匹配：当前路径等于菜单项路径
2. 子路由匹配：当前路径以菜单项路径开头（且没有更精确的匹配）

**Validates: Requirements 3.4**

### Property 6: 图标映射完整性

*For any* 有效的图标名称（在 lucideIcons 中存在），`getIcon` 函数应该返回对应的图标组件。对于无效或空的图标名称，应该返回 `undefined`。

**Validates: Requirements 6.2, 6.3**

## Error Handling

### API 错误处理

复用 Role Store 现有的错误处理机制：

```typescript
// role.ts store 中已有的错误处理
if (apiError.value) {
  error.value = apiError.value.message
  logger.error("获取用户权限路由失败:", apiError.value)
}
```

### 空数据处理

- 当用户没有任何 Admin 角色时，显示"暂无可访问的菜单"提示
- 当某个分组下没有菜单项时，不渲染该分组（在 `menuGroups` computed 中过滤）

### 图标映射失败处理

- 当图标名称不在 `lucideIcons` 中时，返回 `undefined`，组件使用 `v-if` 判断是否渲染图标
- 当图标名称为 `null` 或空字符串时，返回 `undefined`

## Testing Strategy

### 单元测试

1. **菜单数据转换测试** (`tests/client/composables/useAdminMenu.test.ts`)
   - 测试路由过滤逻辑（isMenu=true 且 path 以 /admin 开头）
   - 测试分组逻辑（按 menuGroup 分组）
   - 测试排序逻辑（分组按 menuGroupSort，菜单项按 sort）
   - 测试空分组过滤

2. **路由匹配测试**
   - 测试精确匹配
   - 测试子路由匹配
   - 测试更精确匹配优先

### 属性测试

使用 `fast-check` 进行属性测试，每个属性测试运行至少 100 次迭代。

1. **Property 1 测试**：生成随机路由数据，验证过滤结果只包含 isMenu=true 且 path 以 /admin 开头的路由
2. **Property 2 测试**：生成随机分组数据，验证分组按 menuGroupSort 升序排列
3. **Property 3 测试**：生成随机菜单项数据，验证每个分组内菜单项按 sort 升序排列
4. **Property 4 测试**：生成随机分组数据，验证所有分组都非空
5. **Property 5 测试**：生成随机路径，验证 isActive 匹配逻辑

### 集成测试

1. **组件集成测试**
   - 测试菜单正确渲染
   - 测试点击导航
   - 测试高亮状态

## Migration Plan

### 数据库迁移

1. 创建迁移文件，添加 `menu_group` 和 `menu_group_sort` 字段
2. 更新现有 Admin 路由数据，设置正确的分组信息

### 数据初始化脚本

创建种子脚本 `scripts/seed-admin-routers.ts`，初始化 Admin 路由数据：

```typescript
const ADMIN_ROUTERS = [
  { path: '/admin/roles', title: '角色管理', icon: 'Shield', menuGroup: '权限管理', menuGroupSort: 1, sort: 1 },
  { path: '/admin/permissions/api', title: 'API 权限', icon: 'Key', menuGroup: '权限管理', menuGroupSort: 1, sort: 2 },
  // ... 其他路由
]
```
