# 设计文档

## 概述

本设计解决 `app/app.vue` 中的 Nuxt 水合状态不匹配问题。核心策略是将所有可能导致 SSR/客户端状态不一致的异步操作延迟到 `onMounted` 钩子中执行，确保这些操作仅在客户端运行。

## 架构

### 当前问题分析

```
SSR 阶段                          客户端水合阶段
    │                                   │
    ▼                                   ▼
┌─────────────────┐              ┌─────────────────┐
│ script setup   │              │ script setup   │
│ 执行           │              │ 执行           │
├─────────────────┤              ├─────────────────┤
│ initAuth()     │──────────────│ initAuth()     │ ✓ 同步，无问题
│ fetchUserInfo()│──────────────│ fetchUserInfo()│ ✗ 异步，可能不一致
│ getUserRoles() │──────────────│ getUserRoles() │ ✗ 异步，可能不一致
│ watch(immediate)│─────────────│ watch(immediate)│ ✗ 立即执行，可能不一致
└─────────────────┘              └─────────────────┘
```

### 解决方案架构

```
SSR 阶段                          客户端阶段
    │                                   │
    ▼                                   ▼
┌─────────────────┐              ┌─────────────────┐
│ script setup   │              │ script setup   │
├─────────────────┤              ├─────────────────┤
│ initAuth()     │──────────────│ initAuth()     │ ✓ 同步读取 cookie
│ (无异步操作)    │              │ (无异步操作)    │
└─────────────────┘              └─────────────────┘
                                        │
                                        ▼
                                 ┌─────────────────┐
                                 │ onMounted()    │
                                 ├─────────────────┤
                                 │ fetchUserInfo()│ ✓ 仅客户端
                                 │ getUserRoles() │ ✓ 仅客户端
                                 │ watch 启动     │ ✓ 仅客户端
                                 └─────────────────┘
```

## 组件和接口

### App 组件 (`app/app.vue`)

重构后的组件结构：

```typescript
// 同步初始化 - SSR 和客户端都执行
const authStore = useAuthStore()
const userStore = useUserStore()
const roleStore = useRoleStore()

// 同步读取 cookie 状态 - 安全
authStore.initAuth()

// 客户端专用初始化
onMounted(async () => {
  if (authStore.isAuthenticated) {
    await initializeUserData()
  }
})

// 数据初始化函数
async function initializeUserData() {
  try {
    await Promise.all([
      userStore.fetchUserInfo(),
      roleStore.getUserRoles()
    ])
  } catch (error) {
    logger.error('初始化用户数据失败:', error)
  }
}

// watch 不使用 immediate，改为在 onMounted 后手动触发
watch(
  () => roleStore.currentRole,
  async (newVal) => {
    if (newVal) {
      await roleStore.getUserRouters(newVal.id)
    }
  }
)
```

### 接口定义

无需新增接口，使用现有的 store 接口。

## 数据模型

无需修改数据模型，使用现有的 store 状态结构。

## 正确性属性

*正确性属性是指在系统所有有效执行中都应保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### 属性 1：水合一致性

*对于任意* SSR 渲染的 HTML 和客户端初始渲染，两者的 DOM 结构应该完全一致，不产生水合警告。

**验证: 需求 4.1, 4.2, 4.3**

### 属性 2：异步操作隔离

*对于任意* 异步数据获取操作（fetchUserInfo, getUserRoles, getUserRouters），该操作仅在客户端 mounted 阶段后执行，不在 SSR 阶段执行。

**验证: 需求 2.2, 3.2**

### 属性 3：错误恢复

*对于任意* 数据获取失败的情况，应用应继续正常运行，不抛出未捕获异常，且相关 store 保持有效的默认状态。

**验证: 需求 5.1, 5.2, 5.3**

### 属性 4：认证状态同步

*对于任意* 应用启动场景，认证状态（isAuthenticated）在 SSR 和客户端应保持一致，因为它基于同步读取的 cookie 值。

**验证: 需求 1.1, 1.2**

## 错误处理

### 用户信息获取失败

- 记录错误日志
- 保持 userInfo 为默认空状态
- 不影响应用其他功能

### 角色信息获取失败

- 记录错误日志
- 保持 userRoles 为空数组
- 不影响应用其他功能

### 权限路由获取失败

- 记录错误日志
- 保持 currentRoleRouters 为空数组
- 用户可能看不到某些菜单项，但应用不崩溃

## 测试策略

### 单元测试

由于这是一个 Nuxt 组件的水合问题修复，主要通过以下方式验证：

1. **手动测试**：在开发环境中验证无水合警告
2. **代码审查**：确保异步操作都在 onMounted 中

### 属性测试

本次修改主要是代码结构调整，不涉及复杂的业务逻辑，因此不需要属性测试。核心验证点是：

- 控制台无水合警告
- 用户数据正确加载
- 角色切换功能正常
