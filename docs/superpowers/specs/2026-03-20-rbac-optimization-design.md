# RBAC 体系优化设计文档

## 背景

团队对现有 RBAC 体系进行了全面评审，由三位专家（架构设计、API 操作逻辑、代码冗余）分别独立审查。共发现 23 个问题：5 个 P0 关键、11 个 P1 重要、7 个 P2 建议。

本文档定义分三阶段修复全部问题的设计方案。

## 优化策略

按风险优先级分为三个阶段，每阶段独立可交付、可验证：

| 阶段 | 目标 | 涉及文件 |
|------|------|---------|
| Phase 1 - 安全修复 | 消除安全漏洞和数据一致性风险 | ~10 个 |
| Phase 2 - 性能与一致性 | 缓存优化、性能改进、分层统一 | ~15 个 |
| Phase 3 - 代码质量 | 死代码清理、类型整理、测试重构 | ~20 个 |

---

## Phase 1：安全修复

### 1.1 统一公开 API 匹配逻辑

**问题**：`02.auth.ts` 的 `isPublicApi()` 使用精确/前缀匹配，而 `03.permission.ts` 通过 `validateUserApiPermission` 使用 `pathMatcher.ts` 的通配符匹配（支持 `:param`、`*`、`**`）。同一公开 API 在两个中间件中可能产生不同匹配结果，导致安全漏洞。

**方案**：删除 `02.auth.ts` 中自定义的 `isPublicApi()` 函数，改为调用 `pathMatcher.ts` 的 `findMatchingPermission`。

**涉及文件**：
- `server/middleware/02.auth.ts` — 替换 `isPublicApi` 实现

### 1.2 Admin API 添加管理员权限校验

**问题**：所有 `/admin/**` 端点仅检查登录状态，未校验管理员角色。任何已登录用户可执行敏感操作（角色管理、权限分配等），存在权限提升漏洞。

**方案**：
1. 创建 `server/utils/adminGuard.ts`，提供 `requireAdmin(event)` 工具函数，内部调用 `checkIsSuperAdmin` 验证
2. 在所有 `server/api/v1/admin/**` 写操作端点（POST/PUT/DELETE）的 handler 开头调用 `await requireAdmin(event)`

**涉及文件**：
- `server/utils/adminGuard.ts` — 新建
- `server/api/v1/admin/roles/index.post.ts`
- `server/api/v1/admin/roles/[id].put.ts`
- `server/api/v1/admin/roles/[id].delete.ts`
- `server/api/v1/admin/roles/[id]/api-permissions.put.ts`
- `server/api/v1/admin/roles/[id]/route-permissions.put.ts`
- `server/api/v1/admin/api-permissions/index.post.ts`
- `server/api/v1/admin/api-permissions/[id].put.ts`
- `server/api/v1/admin/api-permissions/[id].delete.ts`
- `server/api/v1/admin/api-permissions/batch-import.post.ts`
- `server/api/v1/admin/api-permissions/batch-delete.delete.ts`
- `server/api/v1/admin/api-permissions/batch-public.put.ts`
- `server/api/v1/admin/api-permissions/scan.post.ts`
- `server/api/v1/admin/users/[id]/roles.put.ts`

### 1.3 DAO 查询添加软删除和状态过滤

**问题**：`findUserApiPermissionsDao` 查询用户角色时未过滤 `deletedAt` 和 `status`。`findRolesApiPermissionsDao` 查询权限时未过滤 `status` 和 `deletedAt`。导致已软删除或禁用的角色/权限仍被加载到缓存中。

**方案**：
- `findUserApiPermissionsDao`：`userRoles.findMany` 添加角色过滤 `role: { status: 1, deletedAt: null }`
- `findRolesApiPermissionsDao`：`roleApiPermissions.findMany` 添加权限过滤 `permission: { status: 1, deletedAt: null }`

**涉及文件**：
- `server/services/rbac/roleApiPermission.dao.ts`

### 1.4 批量删除改为软删除 + 清理关联

**问题**：`batch-delete.delete.ts` 使用 `deleteMany` 硬删除且未清理 `roleApiPermissions` 关联，与单条软删除逻辑不一致，产生孤儿数据。

**方案**：
1. 先删除 `roleApiPermissions` 中的关联记录
2. 使用 `updateMany` 设置 `deletedAt` 实现软删除
3. 包裹在事务中确保原子性
4. 刷新相关缓存

**涉及文件**：
- `server/api/v1/admin/api-permissions/batch-delete.delete.ts`

### 1.5 `setRoleApiPermissionsDao` 添加事务保护

**问题**：该函数内部先 `deleteMany` 后 `createMany`，调用方未传入 `tx` 时无事务保护。若 `createMany` 失败，角色权限会全部丢失。

**方案**：当 `tx` 未传入时，DAO 内部自动包裹 `prisma.$transaction`。

**涉及文件**：
- `server/services/rbac/roleApiPermission.dao.ts`

### 1.6 `users/roles.get.ts` 添加可选链保护

**问题**：`event.context.auth.user` 缺少 `?.`，auth 为 undefined 时会抛异常。

**方案**：改为 `event.context.auth?.user`，添加未登录检查。

**涉及文件**：
- `server/api/v1/users/roles.get.ts`

---

## Phase 2：性能与一致性优化

### 2.1 缓存服务增加容量上限和定期清理

**问题**：`userPermissionCache` 是无限增长的 Map，过期条目仅在读取时惰性清理。用户数量增长后存在 OOM 风险。

**方案**：
- 设置 `MAX_CACHE_SIZE = 1000` 容量上限
- 超出容量时淘汰最早过期的条目
- 添加 10 分钟定期清理定时器，移除已过期条目
- 在 `getCacheStats` 中增加缓存命中率等统计信息

**涉及文件**：
- `server/services/rbac/cache.service.ts`

### 2.2 路径匹配器正则缓存

**问题**：`patternToRegex` 每次调用创建新 RegExp 对象。权限条目较多时每次请求创建大量正则对象。

**方案**：添加 `Map<string, RegExp>` 缓存已编译的正则表达式。权限路径模式是有限集合，缓存不会无限增长。

**涉及文件**：
- `server/services/rbac/pathMatcher.ts`

### 2.3 清理冗余数据库索引

**问题**：多个表对 `description`、`updatedAt` 等非查询字段建了索引，主键字段也重复建了索引，增加写入开销。

**方案**：删除以下冗余索引：

| 表 | 删除的索引 |
|---|---|
| `roles` | `idx_roles_id`、`idx_roles_description`、`idx_roles_updated_at` |
| `roleRouters` | `idx_role_routers_id`、`idx_role_routers_created_at`、`idx_role_routers_updated_at`、`idx_role_routers_deleted_at` |
| `userRoles` | `idx_user_roles_created_at`、`idx_user_roles_updated_at`、`idx_user_roles_deleted_at` |
| `routerGroups` | `idx_router_groups_id`、`idx_router_groups_description`、`idx_router_groups_updated_at` |
| `apiPermissionGroups` | `idx_api_permission_groups_created_at` |
| `apiPermissions` | `idx_api_permissions_created_at` |
| `roleApiPermissions` | `idx_role_api_permissions_created_at` |
| `routers` | `idx_routers_created_at`、`idx_routers_updated_at` |

保留有查询价值的索引（`status`、`deletedAt`、外键、唯一约束等）。

**涉及文件**：
- `prisma/models/rbac.prisma`
- `prisma/models/apiPermission.prisma`
- `prisma/models/router.prisma`

### 2.4 批量导入添加事务保护

**问题**：`batch-import.post.ts` 逐条创建无事务，部分失败导致不一致状态。审计日志只记录成功项，用户不知道哪些失败。

**方案**：用 `prisma.$transaction` 包裹批量创建。收集失败项，在响应中返回 `{ created, failed }` 让前端知道完整结果。

**涉及文件**：
- `server/api/v1/admin/api-permissions/batch-import.post.ts`

### 2.5 scan/batch-import 全量查询已有权限

**问题**：硬编码 `pageSize=1000`，超过 1000 条权限后判重失效。

**方案**：在 `apiPermission.dao.ts` 新增 `findAllApiPermissionPathsDao()` 不分页方法（仅 select path + method），供 scan 和 batch-import 使用。

**涉及文件**：
- `server/services/rbac/apiPermission.dao.ts`
- `server/api/v1/admin/api-permissions/scan.post.ts`
- `server/api/v1/admin/api-permissions/batch-import.post.ts`

### 2.6 审计日志批量操作记录完整信息

**问题**：批量操作只记录 `targetId: permissionIds[0]`，其余被影响的记录无法通过 targetId 查询到。

**方案**：批量操作时 `targetId` 设为 `null`，将完整 ID 列表和数量存入 `newValue` JSON 字段。

**涉及文件**：
- `server/services/rbac/auditLog.service.ts`

### 2.7 角色管理统一 DAO 模式

**问题**：角色 CRUD 操作直接使用 `prisma.roles`，而 API 权限全部使用 DAO。两种模式混用降低可维护性。

**方案**：在 `roles.dao.ts` 补充完整 CRUD 方法：
- `createRoleDao`
- `findRolesDao`（分页、过滤）
- `findRoleByIdDao`（单条查询）
- `updateRoleDao`
- `deleteRoleDao`（软删除）
- `checkRoleExistsDao`（重复检查）

然后迁移所有角色 API 端点中的直接 Prisma 调用。

**涉及文件**：
- `server/services/rbac/roles.dao.ts`
- `server/api/v1/admin/roles/index.post.ts`
- `server/api/v1/admin/roles/index.get.ts`
- `server/api/v1/admin/roles/[id].get.ts`
- `server/api/v1/admin/roles/[id].put.ts`
- `server/api/v1/admin/roles/[id].delete.ts`

---

## Phase 3：代码质量与清理

### 3.1 删除未使用的代码

| 文件 | 删除目标 | 原因 |
|------|---------|------|
| `roleApiPermission.dao.ts` | `checkUserHasApiPermissionByPathDao` | 与 `validateUserApiPermission` 功能重叠 |
| `permission.service.ts` | `refreshUserPermissions` | 未被任何 API 端点调用 |
| `apiPermission.dao.ts` | `findApiPermissionByPathMethodDao` | 无引用 |
| `apiPermission.dao.ts` | `createApiPermissionGroupDao` | 无对应 API 端点 |
| `apiPermission.dao.ts` | `findApiPermissionGroupByIdDao` | 无引用 |
| `apiPermission.dao.ts` | `createManyApiPermissionsDao` | 无引用 |
| `auditLog.service.ts` | `logRoleRemoveApiPermission` | 无调用 |
| `auditLog.service.ts` | `logUserRemoveRole` | 无调用 |
| `auditLog.dao.ts` | `findAuditLogsByTargetDao` | 仅是 `findAuditLogsDao` 的简单包装 |
| `shared/types/rbac.ts` | `AuditLogAction.ROLE_REMOVE_ROUTE_PERMISSION` | 未使用枚举值 |

同时将 `findRolesApiPermissionsDao` 移除 `export`，改为模块内部函数。

**涉及文件**：
- `server/services/rbac/roleApiPermission.dao.ts`
- `server/services/rbac/permission.service.ts`
- `server/services/rbac/apiPermission.dao.ts`
- `server/services/rbac/auditLog.service.ts`
- `server/services/rbac/auditLog.dao.ts`
- `shared/types/rbac.ts`

### 3.2 消除类型重复

**问题**：`UserPermissionCache`（cache.service.ts:17-25）与 `UserPermissions`（shared/types/rbac.ts:54-62）结构完全相同。

**方案**：删除 `cache.service.ts` 中的 `UserPermissionCache` 接口，全部使用 `import type { UserPermissions } from '#shared/types/rbac'`。

**涉及文件**：
- `server/services/rbac/cache.service.ts`

### 3.3 审计日志 operatorId 级联策略修改

**问题**：`onDelete: Cascade` 导致删除用户时审计记录也被删除，违反审计不可篡改原则。

**方案**：将 `operatorId` 改为 `Int?`（可空），级联策略改为 `onDelete: SetNull`。

**涉及文件**：
- `prisma/models/apiPermission.prisma`

### 3.4 `routers.groupId` 默认值修正

**问题**：`groupId` 默认值 `0` 但外键指向 `routerGroups.id`，若无 id=0 的记录会违反约束。

**方案**：将 `groupId` 改为 `Int?`，移除 `@default(0)`，默认为 `null`。

**涉及文件**：
- `prisma/models/router.prisma`

### 3.5 权限分配审计记录变更前状态

**问题**：API 权限分配和路由权限分配的审计日志未记录 oldValue，无法做变更对比审计。

**方案**：分配前先查询当前权限列表，记录为 oldValue。

**涉及文件**：
- `server/api/v1/admin/roles/[id]/api-permissions.put.ts`
- `server/api/v1/admin/roles/[id]/route-permissions.put.ts`

### 3.6 中间表改用硬删除

**问题**：`roleRouters`、`userRoles`、`roleApiPermissions` 使用软删除但联合唯一约束未排除已删除记录，先删后建会冲突。

**方案**：这三个中间表移除 `deletedAt` 字段和相关索引。理由：
- 中间表软删除价值低（关联关系无业务含义需保留）
- 审计日志已覆盖变更追踪

**涉及文件**：
- `prisma/models/rbac.prisma`
- `prisma/models/apiPermission.prisma`

### 3.7 `scan.post.ts` 添加环境检查

**问题**：依赖 `process.cwd()` + `readdirSync` 读取源文件，生产环境可能不可用。

**方案**：handler 开头添加 `process.env.NODE_ENV === 'production'` 检查，生产环境直接返回错误。

**涉及文件**：
- `server/api/v1/admin/api-permissions/scan.post.ts`

### 3.8 API 权限 method 字段枚举校验

**问题**：method 字段仅校验长度，不校验是否为合法 HTTP 方法。

**方案**：Zod schema 改为 `z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', '*'])`。

**涉及文件**：
- `server/api/v1/admin/api-permissions/index.post.ts`
- `server/api/v1/admin/api-permissions/[id].put.ts`

### 3.9 提取测试辅助函数

**问题**：`generateUniqueId`、`createTestRole` 等在 5 个测试文件中复制粘贴。

**方案**：创建 `tests/server/rbac/helpers/test-helper.ts`，提取公共函数：
- `generateUniqueId()`
- `createTestRole(overrides?)`
- `createTestApiPermission(overrides?)`
- `cleanupTestData(ids)`
- 全局 `prisma`/`logger` 设置

各测试文件改为从 helper 导入。

**涉及文件**：
- `tests/server/rbac/helpers/test-helper.ts` — 新建
- `tests/server/rbac/rbac.test.ts`
- `tests/server/rbac/role-protection.test.ts`
- `tests/server/rbac/role-api-permission.test.ts`
- `tests/server/rbac/user-role.test.ts`
- `tests/server/rbac/permission-service.test.ts`（如存在）
- `tests/server/rbac/permission-guard.test.ts`（如存在）

### 3.10 响应中字段清理方式优化

**问题**：`roles/[id].get.ts` 使用 `undefined` 清除字段，依赖 JSON 序列化行为。

**方案**：改用解构排除不需要的字段。

**涉及文件**：
- `server/api/v1/admin/roles/[id].get.ts`
- `server/api/v1/admin/roles/index.get.ts`

---

## 数据库迁移注意事项

Phase 2 和 Phase 3 涉及 Prisma schema 变更（索引删除、字段修改、软删除字段移除），需要生成并执行数据库迁移：

1. Phase 2 索引清理：`prisma migrate dev --name rbac-cleanup-indexes`
2. Phase 3 模型变更：`prisma migrate dev --name rbac-model-improvements`

**数据迁移风险**：
- 中间表移除 `deletedAt` 前，需先检查是否有 `deletedAt IS NOT NULL` 的记录，确认是否需要清理
- `routers.groupId` 改为可空前，需将现有 `groupId = 0` 的记录更新为 `null`
- `permissionAuditLogs.operatorId` 改为可空前，无需数据迁移（已有记录保持原值）

## 测试策略

每个阶段完成后运行完整 RBAC 测试套件验证：

```bash
npx vitest run tests/server/rbac --reporter=verbose
```

Phase 1 额外需要手动验证：
- 未登录用户无法访问 admin 端点
- 非管理员登录用户无法访问 admin 端点
- 公开 API 匹配行为与之前一致（回归测试）
