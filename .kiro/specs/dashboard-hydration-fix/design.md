# 设计文档

## 概述

本设计解决 Dashboard 布局组件中的 Nuxt 水合（Hydration）不匹配问题。核心策略是：
1. 使用 `<ClientOnly>` 组件包裹依赖 `isMobile` 的动态内容
2. 使用 CSS 类（如 `md:hidden`）而非 `v-if` 来处理响应式显示/隐藏
3. 为 `<ClientOnly>` 提供合适的 fallback 占位内容

## 架构

### 当前问题分析

```
SSR 阶段 (provideSSRWidth: 1024px)     客户端水合阶段 (实际宽度: 375px)
    │                                        │
    ▼                                        ▼
┌─────────────────────┐               ┌─────────────────────┐
│ isMobile = false    │               │ isMobile = true     │
│ (1024 > 768)        │               │ (375 < 768)         │
├─────────────────────┤               ├─────────────────────┤
│ 渲染桌面端布局       │ ──────────── │ 期望移动端布局       │ ✗ 不匹配!
│ - 隐藏移动端元素     │               │ - 显示移动端元素     │
│ - side="right"      │               │ - side="bottom"     │
└─────────────────────┘               └─────────────────────┘
```

### 解决方案架构

```
SSR 阶段                              客户端阶段
    │                                     │
    ▼                                     ▼
┌─────────────────────┐               ┌─────────────────────┐
│ 渲染静态结构         │               │ 水合静态结构         │
├─────────────────────┤               ├─────────────────────┤
│ <ClientOnly>        │ ──────────── │ <ClientOnly>        │ ✓ 一致
│   fallback: 占位符   │               │   渲染真实内容       │
│ </ClientOnly>       │               │ </ClientOnly>       │
├─────────────────────┤               ├─────────────────────┤
│ CSS: md:hidden      │ ──────────── │ CSS: md:hidden      │ ✓ 一致
│ (始终渲染，CSS控制)  │               │ (CSS 响应式显示)     │
└─────────────────────┘               └─────────────────────┘
```

## 组件和接口

### 1. NavUserRight 组件重构

**问题**：组件内部使用 `isMobile` 来控制 DropdownMenuContent 的 `side` 属性。

**解决方案**：
- 移除对 `isMobile` 的依赖
- 使用固定的 `side="bottom"` 值（因为此组件仅在移动端显示）
- 简化组件结构，移除不必要的嵌套

```vue
<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton size="lg">
            <User class="h-6 w-6" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          class="w-56 rounded-lg" 
          side="bottom" 
          align="end" 
          :side-offset="4"
        >
          <!-- 菜单内容 -->
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
```

### 2. NavUser 组件重构

**问题**：DropdownMenuContent 的 `side` 属性依赖 `isMobile`。

**解决方案**：
- 使用固定的 `side="right"` 值（因为此组件仅在桌面端显示）
- 移除对 `isMobile` 的依赖

```vue
<DropdownMenuContent 
  class="w-56 rounded-lg" 
  side="right" 
  align="end" 
  :side-offset="4"
>
```

### 3. Dashboard 布局重构

**问题**：
- 移动端用户导航区域的 DOM 结构在 SSR 和客户端不一致
- `DashboardNavUserRight` 组件使用 `class="hidden md:block"` 但内部依赖 `isMobile`

**解决方案**：
- 使用 `<ClientOnly>` 包裹移动端特定的交互组件
- 提供合适的 fallback 占位符

```vue
<div class="ml-auto pr-4 flex items-center md:hidden">
  <button class="p-2 rounded-md hover:bg-gray-100">
    <MenuIcon class="h-6 w-6" />
  </button>
  <ClientOnly>
    <DashboardNavUserRight />
    <template #fallback>
      <div class="p-2">
        <User class="h-6 w-6 text-gray-400" />
      </div>
    </template>
  </ClientOnly>
</div>
```

## 数据模型

无需修改数据模型，使用现有的 store 状态结构。

## 正确性属性

*正确性属性是指在系统所有有效执行中都应保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

由于本次修复主要涉及 SSR/客户端水合一致性，这些属性无法通过传统的单元测试或属性测试来验证，需要通过以下方式验证：

### 验证方式

1. **控制台检查**：开发环境中无水合警告
2. **代码审查**：确保所有依赖 `isMobile` 的动态渲染都使用 `<ClientOnly>` 包裹
3. **视觉测试**：页面加载时无明显闪烁或布局跳动

### 设计约束（非可测试属性）

1. **水合一致性约束**：所有依赖运行时环境（如屏幕宽度）的条件渲染必须使用 `<ClientOnly>` 包裹
2. **CSS 优先约束**：响应式显示/隐藏优先使用 CSS 类（如 `md:hidden`）而非 `v-if`
3. **占位符约束**：`<ClientOnly>` 必须提供与最终内容尺寸相近的 fallback

## 错误处理

### 水合不匹配

- 使用 `<ClientOnly>` 隔离可能导致不匹配的内容
- 提供 fallback 确保 SSR 输出稳定

### 组件加载失败

- `<ClientOnly>` 的 fallback 作为降级方案
- 用户仍可使用基本功能

## 测试策略

### 手动测试

由于这是 SSR 水合问题，主要通过以下方式验证：

1. **开发环境测试**
   - 启动开发服务器
   - 在桌面端和移动端模拟器中访问 Dashboard
   - 检查控制台是否有水合警告

2. **视觉测试**
   - 页面首次加载时观察是否有闪烁
   - 切换设备模式后刷新页面，观察布局是否稳定

### 代码审查清单

- [ ] 所有使用 `isMobile` 的条件渲染都使用 `<ClientOnly>` 包裹
- [ ] DropdownMenu 的 `side` 属性使用固定值而非动态值
- [ ] `<ClientOnly>` 都提供了合适的 fallback
- [ ] 响应式显示/隐藏使用 CSS 类而非 `v-if`

