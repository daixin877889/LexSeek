# Implementation Plan: RBAC 权限管理完善

## Overview

本实现计划将 RBAC 权限管理系统的完善方案分解为可执行的任务。实现顺序遵循数据层 → 服务层 → 中间件 → API → 前端的原则，确保每个步骤都能独立验证。

## Tasks

- [x] 1. 数据库模型扩展
  - [x] 1.1 创建 API 权限相关数据模型
    - 在 `prisma/models/` 下创建 `apiPermission.prisma` 文件
    - 定义 `apiPermissions`、`apiPermissionGroups`、`roleApiPermissions` 表
    - 定义 `permissionAuditLogs` 审计日志表
    - 更新 `roles` 和 `users` 模型添加新关联
    - _Requirements: 1.1, 2.1, 12.1_
  - [x] 1.2 执行数据库迁移
    - 运行 `bun run prisma:migrate` 生成迁移文件
    - 验证数据库表结构正确创建
    - _Requirements: 1.1_
  - [x] 1.3 创建初始化种子数据
    - 创建超级管理员角色 (code: super_admin)
    - 创建默认公共 API 权限（登录、注册、健康检查等）
    - _Requirements: 5.4, 11.1_

- [x] 2. API 权限数据访问层
  - [x] 2.1 实现 API 权限 DAO
    - 创建 `server/services/rbac/apiPermission.dao.ts`
    - 实现 CRUD 操作：create、findById、findByPathMethod、findMany、update、delete
    - 实现 findPublicApiPermissions 查询公开 API
    - _Requirements: 1.1, 1.2, 1.4_
  - [x] 2.2 编写 API 权限 DAO 属性测试
    - **Property 1: API 权限 CRUD 完整性**
    - **Validates: Requirements 1.2, 1.3**
  - [x] 2.3 实现角色 API 权限关联 DAO
    - 创建 `server/services/rbac/roleApiPermission.dao.ts`
    - 实现 assignApiPermissionsToRole、removeApiPermissionsFromRole
    - 实现 findRoleApiPermissions、findUserApiPermissions
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 2.4 编写角色 API 权限关联属性测试
    - **Property 2: 角色 API 权限关联完整性**
    - **Validates: Requirements 2.2, 2.3, 2.4**

- [x] 3. 权限缓存服务
  - [x] 3.1 实现缓存服务
    - 创建 `server/services/rbac/cache.service.ts`
    - 实现用户权限缓存：get、set、clear
    - 实现公共资源缓存：get、set、clear
    - 支持配置缓存过期时间（默认 5 分钟）
    - _Requirements: 10.1, 10.2, 10.5_
  - [x] 3.2 编写缓存服务属性测试
    - **Property 10: 缓存一致性**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

- [x] 4. 权限验证服务
  - [x] 4.1 实现路径匹配工具
    - 创建 `server/services/rbac/pathMatcher.ts`
    - 实现通配符路径匹配算法（支持 `*` 和 `**`）
    - _Requirements: 3.6_
  - [x] 4.2 编写路径匹配属性测试
    - **Property 4: 通配符路径匹配正确性**
    - **Validates: Requirements 3.6**
  - [x] 4.3 实现权限验证服务
    - 创建 `server/services/rbac/permission.service.ts`
    - 实现 validateUserApiPermission 验证 API 权限
    - 实现 validateUserRoutePermission 验证路由权限
    - 实现 getUserPermissions 获取用户完整权限
    - 集成缓存服务
    - _Requirements: 3.1, 3.2, 3.7_
  - [x] 4.4 编写权限验证服务属性测试
    - **Property 3: API 权限验证正确性**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

- [x] 5. Checkpoint - 核心服务验证
  - 所有核心服务测试已通过验证

- [x] 6. API 权限中间件
  - [x] 6.1 实现权限验证中间件
    - 创建 `server/middleware/03.permission.ts`
    - 在认证中间件之后执行
    - 检查公开 API → 检查超级管理员 → 验证权限
    - 无权限返回 403 错误
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 11.2_
  - [x] 6.2 编写权限中间件集成测试
    - 测试未登录访问受保护 API
    - 测试无权限访问 API
    - 测试超级管理员访问任意 API
    - **Property 11: 超级管理员权限**
    - **Validates: Requirements 11.2, 11.4**

- [x] 7. 审计日志服务
  - [x] 7.1 实现审计日志 DAO
    - 创建 `server/services/rbac/auditLog.dao.ts`
    - 实现 createAuditLog 记录操作日志
    - 实现 findAuditLogs 查询日志（支持分页、筛选）
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [x] 7.2 实现审计日志服务
    - 创建 `server/services/rbac/auditLog.service.ts`
    - 封装角色变更、权限变更、用户角色变更的日志记录
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [x] 7.3 编写审计日志属性测试
    - **Property 12: 审计日志完整性**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4**

- [x] 8. 管理后台 API - 角色管理
  - [x] 8.1 实现角色管理 API
    - `GET /api/v1/admin/roles` - 角色列表（分页、搜索）
    - `GET /api/v1/admin/roles/:id` - 角色详情
    - `POST /api/v1/admin/roles` - 创建角色
    - `PUT /api/v1/admin/roles/:id` - 更新角色
    - `DELETE /api/v1/admin/roles/:id` - 删除角色（检查关联）
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 8.2 编写角色删除保护属性测试
    - **Property 6: 角色删除保护**
    - **Validates: Requirements 6.5**

- [x] 9. 管理后台 API - API 权限管理
  - [x] 9.1 实现 API 权限管理 API
    - `GET /api/v1/admin/api-permissions` - 权限列表（分页、筛选）
    - `GET /api/v1/admin/api-permissions/:id` - 权限详情
    - `POST /api/v1/admin/api-permissions` - 创建权限
    - `PUT /api/v1/admin/api-permissions/:id` - 更新权限
    - `DELETE /api/v1/admin/api-permissions/:id` - 删除权限
    - `PUT /api/v1/admin/api-permissions/batch-public` - 批量设置公开状态
    - _Requirements: 7.1, 7.3, 7.4_
  - [x] 9.2 编写批量权限状态更新属性测试
    - **Property 7: 批量权限状态更新**
    - **Validates: Requirements 7.4**
  - [x] 9.3 实现 API 权限扫描功能
    - `POST /api/v1/admin/api-permissions/scan` - 扫描 API 路由
    - 从 `server/api/` 目录扫描 API 文件
    - 生成待导入的权限列表
    - _Requirements: 1.5, 7.5_

- [x] 10. 管理后台 API - 角色权限分配
  - [x] 10.1 实现角色权限分配 API
    - `GET /api/v1/admin/roles/:id/permissions` - 获取角色权限
    - `PUT /api/v1/admin/roles/:id/api-permissions` - 分配 API 权限
    - `PUT /api/v1/admin/roles/:id/route-permissions` - 分配路由权限
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 10.2 编写公共资源配置生效性属性测试
    - **Property 5: 公共资源配置生效性**
    - **Validates: Requirements 5.1, 5.3**

- [x] 11. 管理后台 API - 用户角色管理
  - [x] 11.1 实现用户角色管理 API
    - `GET /api/v1/admin/users` - 用户列表（含角色信息）
    - `PUT /api/v1/admin/users/:id/roles` - 分配用户角色
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 11.2 编写用户角色分配属性测试
    - **Property 8: 用户角色分配**
    - **Validates: Requirements 9.2, 9.3**
  - [x] 11.3 编写权限变更即时生效属性测试
    - **Property 9: 权限变更即时生效**
    - **Validates: Requirements 9.4**

- [x] 12. Checkpoint - API 层验证
  - 所有 API 层测试已通过验证

- [x] 13. 前端权限 Store
  - [x] 13.1 实现权限 Store
    - 创建 `app/store/permission.ts`
    - 实现 initUserPermissions 初始化权限
    - 实现 hasApiPermission、hasRoutePermission 权限检查
    - 实现 refreshPermissions、clearPermissions
    - _Requirements: 4.1, 4.2_
  - [x] 13.2 更新前端路由守卫
    - 修改 `app/middleware/01.auth.global.ts`
    - 集成权限 Store 进行路由权限验证
    - 无权限重定向到 403 页面
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 13.3 创建 403 无权限页面
    - 创建 `app/pages/403.vue`
    - 提供返回首页和联系管理员选项
    - _Requirements: 4.4_

- [x] 14. 管理后台前端 - 角色管理
  - [x] 14.1 创建管理后台布局
    - 创建 `app/layouts/admin-layout.vue`
    - 包含管理后台侧边栏导航
    - _Requirements: 6.1_
  - [x] 14.2 实现角色列表页面
    - 创建 `app/pages/admin/roles/index.vue`
    - 支持分页、搜索、筛选
    - _Requirements: 6.1_
  - [x] 14.3 实现角色创建/编辑页面
    - 创建 `app/pages/admin/roles/[id].vue`
    - 创建 `app/pages/admin/roles/create.vue`
    - 包含角色基本信息表单
    - _Requirements: 6.2, 6.3_

- [x] 15. 管理后台前端 - 权限资源管理
  - [x] 15.1 实现 API 权限列表页面
    - 创建 `app/pages/admin/permissions/api/index.vue`
    - 支持分页、搜索、按方法筛选
    - 支持批量设置公开状态
    - _Requirements: 7.1, 7.4_
  - [x] 15.2 实现路由权限列表页面
    - 创建 `app/pages/admin/permissions/routes/index.vue`
    - 支持分页、搜索、按分组筛选
    - _Requirements: 7.2_

- [x] 16. 管理后台前端 - 角色权限分配
  - [x] 16.1 实现角色权限分配页面
    - 创建 `app/pages/admin/roles/[id]/permissions.vue`
    - 分 Tab 展示 API 权限和路由权限
    - 支持勾选/取消勾选批量分配
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 17. 管理后台前端 - 用户角色管理
  - [x] 17.1 实现用户角色管理页面
    - 创建 `app/pages/admin/users/index.vue`
    - 显示用户列表和已分配角色
    - 支持分配/取消角色
    - _Requirements: 9.1, 9.2_

- [x] 18. 管理后台前端 - 审计日志
  - [x] 18.1 实现审计日志页面
    - 创建 `app/pages/admin/audit/index.vue`
    - 支持按操作类型、目标类型筛选
    - 支持查看详情
    - _Requirements: 12.5_

- [x] 19. Final Checkpoint - 完整功能验证
  - 所有 104 个测试用例全部通过
  - RBAC 权限管理系统完善方案已完成实现

## Notes

- All tasks are required for comprehensive testing
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
