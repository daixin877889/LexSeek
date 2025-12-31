# Requirements Document

## Introduction

本文档定义了 LexSeek 项目 RBAC（基于角色的访问控制）权限管理系统的完善方案。当前系统存在以下问题需要解决：

1. 前端路由资源虽已定义但未做实际管控，未授权角色仍可通过 URL 直接访问页面
2. API 接口未做角色权限管控，所有接口仅区分登录/未登录状态
3. 公共路由硬编码在中间件中，缺乏灵活性
4. 缺少管理员后台，无法方便地管理权限资源

本方案将实现完整的 RBAC 权限管理体系，包括前端路由权限控制、API 接口权限控制、动态公共资源配置以及管理员后台。

## Glossary

- **RBAC_System**: 基于角色的访问控制系统，负责管理用户、角色、权限之间的关系
- **Route_Guard**: 前端路由守卫，负责在页面访问前验证用户是否有权限访问该路由
- **API_Guard**: API 接口守卫，负责在 API 请求处理前验证用户是否有权限调用该接口
- **Permission**: 权限资源，包括前端路由权限和 API 接口权限
- **API_Permission**: API 接口权限资源，定义可被访问控制的 API 端点
- **Route_Permission**: 前端路由权限资源，定义可被访问控制的页面路由
- **Public_Resource**: 公共资源，无需登录即可访问的路由或 API
- **Admin_Panel**: 管理员后台，用于管理权限资源的 Web 界面
- **Permission_Cache**: 权限缓存，用于提升权限验证性能的缓存机制

## Requirements

### Requirement 1: API 权限资源管理

**User Story:** As a 系统管理员, I want to 管理 API 接口权限资源, so that 可以灵活配置哪些 API 需要权限控制。

#### Acceptance Criteria

1. THE RBAC_System SHALL 提供 API 权限资源的数据模型，包含接口路径、请求方法、名称、描述、是否公开等字段
2. THE RBAC_System SHALL 支持 API 权限资源的增删改查操作
3. WHEN 创建 API 权限资源时, THE RBAC_System SHALL 验证接口路径和请求方法的唯一性
4. THE RBAC_System SHALL 支持将 API 权限资源标记为公开（无需登录即可访问）
5. THE RBAC_System SHALL 支持 API 权限资源的批量导入功能，从现有 API 路由自动扫描生成

### Requirement 2: 角色与 API 权限关联

**User Story:** As a 系统管理员, I want to 为角色分配 API 接口权限, so that 不同角色可以访问不同的 API 接口。

#### Acceptance Criteria

1. THE RBAC_System SHALL 提供角色与 API 权限的多对多关联数据模型
2. WHEN 为角色分配 API 权限时, THE RBAC_System SHALL 支持批量分配和取消分配
3. THE RBAC_System SHALL 支持查询角色已分配的所有 API 权限
4. THE RBAC_System SHALL 支持查询 API 权限已分配给哪些角色

### Requirement 3: API 接口权限验证

**User Story:** As a 开发者, I want to API 接口自动进行权限验证, so that 未授权用户无法访问受保护的 API。

#### Acceptance Criteria

1. WHEN 用户请求受保护的 API 时, THE API_Guard SHALL 验证用户是否已登录
2. WHEN 用户请求受保护的 API 时, THE API_Guard SHALL 验证用户角色是否拥有该 API 的访问权限
3. IF 用户未登录访问受保护 API, THEN THE API_Guard SHALL 返回 401 未授权错误
4. IF 用户已登录但无权限访问 API, THEN THE API_Guard SHALL 返回 403 禁止访问错误
5. WHEN API 被标记为公开时, THE API_Guard SHALL 允许任何用户访问，无需登录验证
6. THE API_Guard SHALL 支持通配符路径匹配，如 `/api/v1/users/*` 匹配所有用户相关接口
7. THE API_Guard SHALL 使用缓存机制提升权限验证性能

### Requirement 4: 前端路由权限验证

**User Story:** As a 用户, I want to 只能访问我有权限的页面, so that 系统安全性得到保障。

#### Acceptance Criteria

1. WHEN 用户访问受保护的前端路由时, THE Route_Guard SHALL 验证用户是否已登录
2. WHEN 用户访问受保护的前端路由时, THE Route_Guard SHALL 验证用户角色是否拥有该路由的访问权限
3. IF 用户未登录访问受保护路由, THEN THE Route_Guard SHALL 重定向到登录页面
4. IF 用户已登录但无权限访问路由, THEN THE Route_Guard SHALL 重定向到 403 无权限页面
5. WHEN 路由被标记为公开时, THE Route_Guard SHALL 允许任何用户访问
6. THE Route_Guard SHALL 在服务端和客户端都执行权限验证，确保 SSR 场景下的安全性

### Requirement 5: 动态公共资源配置

**User Story:** As a 系统管理员, I want to 动态配置公共资源, so that 无需修改代码即可调整公开访问的资源。

#### Acceptance Criteria

1. THE RBAC_System SHALL 支持通过数据库配置公共 API 资源
2. THE RBAC_System SHALL 支持通过数据库配置公共前端路由
3. WHEN 公共资源配置变更时, THE RBAC_System SHALL 自动刷新缓存使配置生效
4. THE RBAC_System SHALL 提供默认的公共资源配置，包括登录、注册、健康检查等基础接口

### Requirement 6: 管理员后台 - 角色管理

**User Story:** As a 系统管理员, I want to 通过后台界面管理角色, so that 可以方便地进行角色的增删改查。

#### Acceptance Criteria

1. THE Admin_Panel SHALL 提供角色列表页面，支持分页、搜索、筛选功能
2. THE Admin_Panel SHALL 提供角色创建表单，包含角色名称、标识、描述、状态等字段
3. THE Admin_Panel SHALL 提供角色编辑功能，支持修改角色基本信息
4. THE Admin_Panel SHALL 提供角色删除功能，删除前需确认且检查是否有用户关联
5. WHEN 角色被用户关联时, THE Admin_Panel SHALL 阻止删除并提示管理员

### Requirement 7: 管理员后台 - 权限资源管理

**User Story:** As a 系统管理员, I want to 通过后台界面管理权限资源, so that 可以方便地配置系统的权限资源。

#### Acceptance Criteria

1. THE Admin_Panel SHALL 提供 API 权限资源列表页面，支持分页、搜索、按请求方法筛选
2. THE Admin_Panel SHALL 提供前端路由权限列表页面，支持树形结构展示
3. THE Admin_Panel SHALL 提供权限资源创建和编辑表单
4. THE Admin_Panel SHALL 支持批量设置权限资源的公开状态
5. THE Admin_Panel SHALL 提供 API 权限资源的自动扫描功能，从代码中发现新增的 API

### Requirement 8: 管理员后台 - 角色权限分配

**User Story:** As a 系统管理员, I want to 通过后台界面为角色分配权限, so that 可以直观地管理角色的权限范围。

#### Acceptance Criteria

1. THE Admin_Panel SHALL 提供角色权限分配页面，以树形结构展示可分配的权限
2. THE Admin_Panel SHALL 支持勾选/取消勾选的方式批量分配权限
3. THE Admin_Panel SHALL 区分展示 API 权限和路由权限两类资源
4. WHEN 保存权限分配时, THE Admin_Panel SHALL 显示变更摘要供管理员确认
5. THE Admin_Panel SHALL 支持权限分配的撤销操作

### Requirement 9: 管理员后台 - 用户角色管理

**User Story:** As a 系统管理员, I want to 通过后台界面管理用户的角色, so that 可以方便地调整用户的权限。

#### Acceptance Criteria

1. THE Admin_Panel SHALL 提供用户列表页面，显示用户基本信息和已分配的角色
2. THE Admin_Panel SHALL 提供用户角色分配功能，支持为用户分配多个角色
3. THE Admin_Panel SHALL 支持批量为用户分配或取消角色
4. WHEN 用户角色变更时, THE RBAC_System SHALL 立即生效，无需用户重新登录

### Requirement 10: 权限缓存与性能优化

**User Story:** As a 开发者, I want to 权限验证具有良好的性能, so that 不会影响系统的响应速度。

#### Acceptance Criteria

1. THE Permission_Cache SHALL 缓存用户的权限数据，避免每次请求都查询数据库
2. THE Permission_Cache SHALL 缓存公共资源列表，提升公共资源判断效率
3. WHEN 用户权限变更时, THE Permission_Cache SHALL 自动失效相关缓存
4. WHEN 权限资源配置变更时, THE Permission_Cache SHALL 自动刷新全局缓存
5. THE Permission_Cache SHALL 支持配置缓存过期时间，默认为 5 分钟

### Requirement 11: 超级管理员角色

**User Story:** As a 系统所有者, I want to 有一个超级管理员角色, so that 可以拥有系统的所有权限。

#### Acceptance Criteria

1. THE RBAC_System SHALL 内置一个超级管理员角色（code: super_admin）
2. WHEN 用户拥有超级管理员角色时, THE API_Guard SHALL 跳过权限验证，允许访问所有 API
3. WHEN 用户拥有超级管理员角色时, THE Route_Guard SHALL 跳过权限验证，允许访问所有路由
4. THE RBAC_System SHALL 禁止删除或禁用超级管理员角色
5. THE Admin_Panel SHALL 限制超级管理员角色的权限编辑功能

### Requirement 12: 权限审计日志

**User Story:** As a 系统管理员, I want to 查看权限相关的操作日志, so that 可以追踪权限变更历史。

#### Acceptance Criteria

1. WHEN 角色被创建、修改或删除时, THE RBAC_System SHALL 记录操作日志
2. WHEN 权限资源被创建、修改或删除时, THE RBAC_System SHALL 记录操作日志
3. WHEN 角色权限分配变更时, THE RBAC_System SHALL 记录变更详情
4. WHEN 用户角色变更时, THE RBAC_System SHALL 记录变更详情
5. THE Admin_Panel SHALL 提供审计日志查询页面，支持按时间、操作类型、操作人筛选
