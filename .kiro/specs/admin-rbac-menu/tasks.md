# Implementation Plan: Admin RBAC Menu

## Overview

将后台管理系统的硬编码菜单改造为基于 RBAC 权限系统的动态菜单。主要工作包括：数据库扩展、Composable 创建、组件改造、数据初始化。

## Tasks

- [x] 1. 数据库扩展：路由表新增菜单分组字段
  - [x] 1.1 创建 Prisma 迁移文件，添加 `menu_group` 和 `menu_group_sort` 字段
    - 修改 `prisma/models/router.prisma`
    - 运行 `bun run prisma:migrate` 生成迁移
    - _Requirements: 5.1, 5.2_

- [x] 2. 创建 Admin 路由数据初始化脚本
  - [x] 2.1 创建 `scripts/seed-admin-routers.ts` 脚本
    - 定义所有 Admin 路由数据（path、title、icon、menuGroup、menuGroupSort、sort）
    - 实现 upsert 逻辑，支持重复运行
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 3. 创建 useAdminMenu Composable
  - [x] 3.1 创建 `app/composables/useAdminMenu.ts`
    - 从 Role Store 获取路由数据
    - 过滤 `isMenu=true` 且 `path` 以 `/admin` 开头的路由
    - 按 `menuGroup` 分组，按 `menuGroupSort` 和 `sort` 排序
    - 实现 `isActive` 路由匹配函数
    - 复用 Dashboard 的 `getIcon` 图标映射逻辑
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.4, 6.2_

  - [x] 3.2 编写 useAdminMenu 属性测试
    - **Property 1: 菜单过滤正确性**
    - **Property 2: 分组排序正确性**
    - **Property 3: 菜单项排序正确性**
    - **Property 4: 分组非空性**
    - **Validates: Requirements 1.2, 2.2, 2.3, 2.4**

  - [x] 3.3 编写 isActive 路由匹配属性测试
    - **Property 5: 路由匹配正确性**
    - **Validates: Requirements 3.4**

- [x] 4. 改造 NavMain.vue 组件
  - [x] 4.1 重构 `app/components/admin/NavMain.vue`
    - 移除硬编码菜单数据
    - 使用 `useAdminMenu` composable 获取动态菜单
    - 按分组渲染菜单
    - 添加空状态提示
    - _Requirements: 1.3, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

- [x] 5. Checkpoint - 确保所有测试通过
  - 运行 `bun test` 确保所有测试通过
  - 17 个测试全部通过

- [x] 6. 运行数据初始化脚本
  - [x] 6.1 执行 `scripts/seed-admin-routers.ts` 初始化 Admin 路由数据
    - 确保所有 Admin 路由都有正确的 menuGroup 和 menuGroupSort
    - 共处理 16 条路由记录
    - _Requirements: 5.1, 5.2_

- [ ] 7. 功能验证
  - [ ] 7.1 验证 Admin 菜单正确显示
    - 检查菜单分组是否正确
    - 检查菜单排序是否正确
    - 检查图标是否正确显示
    - 检查路由高亮是否正确
    - _Requirements: 1.1, 2.1, 3.1, 3.2, 3.3, 3.4_

## Notes

- 所有任务都需要执行，包括测试任务
- 复用 Dashboard 现有的图标映射逻辑，无需创建新的图标映射模块
- 数据库迁移后需要运行初始化脚本设置 Admin 路由的分组信息
