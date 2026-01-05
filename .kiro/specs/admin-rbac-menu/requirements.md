# Requirements Document

## Introduction

本功能旨在将后台管理系统（admin）的硬编码菜单改造为基于 RBAC 权限系统的动态菜单。当前 `NavMain.vue` 组件中的菜单项是硬编码的，无法根据用户角色动态显示/隐藏菜单。改造后，菜单将根据用户拥有的角色权限动态生成，实现真正的权限控制。

## Glossary

- **Admin_Menu_System**: 后台管理系统的菜单组件，负责渲染侧边栏导航菜单
- **RBAC_System**: 基于角色的访问控制系统，包含角色（roles）、路由（routers）、角色路由关联（roleRouters）等数据模型
- **Router_Record**: 数据库中的路由记录，包含 path、title、icon、groupId、parentId、isMenu 等字段
- **Router_Group**: 路由分组，用于将相关路由组织在一起（如"权限管理"、"运营管理"等）
- **Menu_Item**: 前端渲染的菜单项，包含路径、标题、图标等信息
- **Menu_Group**: 前端渲染的菜单分组，包含分组名称和该分组下的菜单项列表
- **Role_Store**: Pinia 状态管理中的角色 store，负责管理用户角色和权限路由数据

## Requirements

### Requirement 1: 后台菜单数据获取

**User Story:** As a 后台管理员, I want 系统根据我的角色自动获取可访问的菜单, so that 我只能看到有权限访问的功能入口。

#### Acceptance Criteria

1. WHEN 用户进入后台管理页面, THE Admin_Menu_System SHALL 调用 API 获取当前用户角色对应的路由权限
2. WHEN API 返回路由数据, THE Admin_Menu_System SHALL 过滤出 `isMenu=true` 的路由作为菜单项
3. WHEN 用户没有任何后台角色, THE Admin_Menu_System SHALL 显示空菜单或提示无权限
4. IF API 请求失败, THEN THE Admin_Menu_System SHALL 显示错误提示并提供重试选项

### Requirement 2: 菜单分组渲染

**User Story:** As a 后台管理员, I want 菜单按照功能分组显示, so that 我能快速找到需要的功能。

#### Acceptance Criteria

1. WHEN 渲染菜单时, THE Admin_Menu_System SHALL 根据路由的 `groupId` 将菜单项分组
2. WHEN 某个分组下没有任何可访问的菜单项, THE Admin_Menu_System SHALL 隐藏该分组
3. THE Admin_Menu_System SHALL 按照 `routerGroups.sort` 字段对分组进行排序
4. THE Admin_Menu_System SHALL 按照 `routers.sort` 字段对分组内的菜单项进行排序

### Requirement 3: 菜单项渲染

**User Story:** As a 后台管理员, I want 菜单项显示正确的图标和标题, so that 我能直观地识别各个功能。

#### Acceptance Criteria

1. THE Admin_Menu_System SHALL 使用路由记录中的 `icon` 字段渲染菜单图标
2. THE Admin_Menu_System SHALL 使用路由记录中的 `title` 字段渲染菜单标题
3. WHEN 用户点击菜单项, THE Admin_Menu_System SHALL 导航到对应的 `path`
4. WHEN 当前路由匹配菜单项路径, THE Admin_Menu_System SHALL 高亮显示该菜单项

### Requirement 4: 菜单数据缓存与刷新

**User Story:** As a 后台管理员, I want 菜单数据被合理缓存, so that 页面切换时不会重复请求。

#### Acceptance Criteria

1. THE Role_Store SHALL 缓存用户的路由权限数据
2. WHEN 用户切换角色, THE Admin_Menu_System SHALL 重新获取对应角色的路由权限
3. WHEN 用户登出, THE Role_Store SHALL 清空缓存的路由权限数据

### Requirement 5: 菜单分组数据支持

**User Story:** As a 系统管理员, I want 路由表支持菜单分组配置, so that 前端能够按分组渲染菜单。

#### Acceptance Criteria

1. THE RBAC_System SHALL 在路由表中支持 `menuGroup` 字段定义菜单分组名称
2. THE RBAC_System SHALL 在路由表中支持 `menuGroupSort` 字段定义菜单分组排序
3. WHEN 路由没有设置 `menuGroup`, THE Admin_Menu_System SHALL 将其归入"其他"分组

### Requirement 6: 图标映射支持

**User Story:** As a 开发者, I want 数据库中的图标名称能够映射到前端图标组件, so that 菜单能够正确显示图标。

#### Acceptance Criteria

1. THE Admin_Menu_System SHALL 维护一个图标名称到图标组件的映射表
2. WHEN 路由记录中的 `icon` 字段有值, THE Admin_Menu_System SHALL 查找对应的图标组件
3. IF 图标名称在映射表中不存在, THEN THE Admin_Menu_System SHALL 使用默认图标
