# 实现计划：Dashboard 水合状态修复

## 概述

重构 Dashboard 布局相关组件，解决 SSR 水合不匹配问题。主要修改 `navUserRight.vue`、`navUser.vue` 和 `dashboard.vue`。

## 任务

- [x] 1. 重构 NavUserRight 组件
  - [x] 1.1 移除 isMobile 依赖
    - 移除 `useSidebar` 的 `isMobile` 解构
    - 将 DropdownMenuContent 的 `side` 属性改为固定值 `"bottom"`
    - 移除 `:side="isMobile ? 'bottom' : 'right'"` 动态绑定
    - _需求: 2.1, 3.2_

  - [x] 1.2 简化组件结构
    - 移除 SidebarMenuButton 内部多余的 div 嵌套
    - 清理未使用的导入（Lock, Bell, ChevronsUpDown 等）
    - _需求: 2.1_

- [x] 2. 重构 NavUser 组件
  - [x] 2.1 移除 isMobile 依赖
    - 移除 `useSidebar` 的 `isMobile` 解构
    - 将 DropdownMenuContent 的 `side` 属性改为固定值 `"right"`
    - _需求: 3.1, 3.2_

- [x] 3. 重构 Dashboard 布局
  - [x] 3.1 使用 ClientOnly 包裹移动端导航
    - 在 header 中的移动端用户导航区域使用 `<ClientOnly>` 包裹 `DashboardNavUserRight`
    - 提供 fallback 占位符（User 图标）
    - _需求: 4.2, 5.1, 5.2_

  - [x] 3.2 移除 NavUserRight 上的 hidden 类
    - 移除 `DashboardNavUserRight` 上的 `class="hidden md:block"`
    - 因为父容器已经有 `md:hidden`，子组件不需要重复控制
    - _需求: 4.1, 4.3_

- [x] 4. 验证修复效果
  - [x] 4.1 检查点 - 验证水合状态
    - 确保开发环境控制台无水合警告
    - 在桌面端和移动端模拟器中测试
    - 确保用户菜单功能正常
    - 如有问题请告知用户

## 备注

- 本次修改是代码结构重构，不涉及业务逻辑变更
- 核心验证方式是检查控制台是否有水合警告
- `<ClientOnly>` 是 Nuxt 内置组件，无需额外导入
- fallback 内容应与最终内容尺寸相近，避免布局跳动

