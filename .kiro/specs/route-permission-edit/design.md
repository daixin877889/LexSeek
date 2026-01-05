# 设计文档

## 概述

为路由权限管理页面增加编辑功能，包括是否菜单切换、删除操作和排序调整。本设计遵循现有 API 权限管理页面的交互模式，保持一致的用户体验。

## 架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 (Vue 3 + Nuxt 4)                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         routes/index.vue (路由权限页面)               │   │
│  │  - Switch 组件 (是否菜单)                            │   │
│  │  - 内联编辑 (排序)                                   │   │
│  │  - 删除按钮 + 确认对话框                             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    后端 API (Nuxt Server)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  PUT  /api/v1/admin/routers/:id  (更新路由)          │   │
│  │  DELETE /api/v1/admin/routers/:id (删除路由)         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    数据库 (PostgreSQL)                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  routers 表                                          │   │
│  │  - isMenu: Boolean (是否菜单)                        │   │
│  │  - sort: Int (排序值)                                │   │
│  │  - deletedAt: DateTime (软删除标记)                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 组件和接口

### 后端 API 接口

#### 1. 更新路由 API

**端点**: `PUT /api/v1/admin/routers/:id`

**请求参数**:
```typescript
interface UpdateRouterRequest {
  isMenu?: boolean      // 是否菜单
  sort?: number         // 排序值 (非负整数)
  title?: string        // 路由标题
  icon?: string         // 路由图标
}
```

**响应**:
```typescript
interface UpdateRouterResponse {
  code: number
  message: string
  data: Router | null
}
```

**验证规则**:
- `sort` 必须为非负整数 (>= 0)
- `isMenu` 必须为布尔值

#### 2. 删除路由 API

**端点**: `DELETE /api/v1/admin/routers/:id`

**响应**:
```typescript
interface DeleteRouterResponse {
  code: number
  message: string
  data: null
}
```

**行为**:
- 执行软删除 (设置 deletedAt)
- 检查路由是否存在
- 返回操作结果

### 前端组件修改

#### routes/index.vue 修改

**新增状态**:
```typescript
// 删除相关状态
const deleteDialogOpen = ref(false)
const routerToDelete = ref<Router | null>(null)
```

**新增方法**:
```typescript
// 切换菜单状态
const handleToggleMenu = async (router: Router, isMenu: boolean) => { ... }

// 更新排序
const handleUpdateSort = async (router: Router, sort: number) => { ... }

// 删除路由
const handleDelete = (router: Router) => { ... }
const confirmDelete = async () => { ... }
```

**表格列修改**:
- "菜单" 列: 从文本显示改为 Switch 组件
- "排序" 列: 从文本显示改为可编辑输入框
- 新增 "操作" 列: 包含删除按钮

## 数据模型

### Router 接口 (已存在，无需修改)

```typescript
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
```

## 正确性属性

*正确性属性是指在系统所有有效执行中都应保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### Property 1: 排序值验证

*对于任意* 排序值输入，如果输入是非负整数，验证应通过；如果输入是负数或非整数，验证应失败。

**验证: 需求 3.5**

## 错误处理

### 前端错误处理

1. **API 请求失败**
   - 显示错误 toast 提示
   - 恢复组件状态 (Switch 状态、排序值)
   - 不刷新列表

2. **输入验证失败**
   - 排序值非法时显示提示
   - 阻止 API 请求

### 后端错误处理

1. **路由不存在** (404)
   - 返回 "路由不存在" 错误

2. **参数验证失败** (400)
   - 返回具体的验证错误信息

3. **未授权** (401)
   - 返回 "请先登录" 错误

## 测试策略

### 单元测试

1. **API 接口测试**
   - 测试更新路由 API 的参数验证
   - 测试删除路由 API 的权限检查
   - 测试软删除逻辑

2. **前端组件测试**
   - 测试 Switch 组件的交互
   - 测试删除确认对话框
   - 测试排序输入验证

### 属性测试

使用 Vitest 进行属性测试:

1. **排序值验证属性测试**
   - 生成随机整数，验证非负整数通过验证
   - 生成随机负数，验证验证失败
   - 生成随机浮点数，验证验证失败

### 测试配置

- 使用 Vitest 作为测试框架
- 属性测试使用 fast-check 库
- 每个属性测试运行至少 100 次迭代
