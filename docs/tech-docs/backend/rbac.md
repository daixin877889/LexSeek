# 权限系统模块（RBAC）

RBAC 模块提供基于角色的访问控制，包括角色管理、用户角色分配、API 权限定义、角色权限映射、权限校验服务（含路径匹配和缓存），以及审计日志。

## 模块架构

```
server/services/rbac/
├── roles.dao.ts               # 角色 DAO
├── userRoles.dao.ts           # 用户角色 DAO
├── apiPermission.dao.ts       # API 权限 DAO（含权限分组）
├── roleApiPermission.dao.ts   # 角色-API 权限关联 DAO
├── permission.service.ts      # 权限校验 Service
├── pathMatcher.ts             # 路径匹配工具
├── cache.service.ts           # 权限缓存 Service
└── auditLog.dao.ts / auditLog.service.ts  # 审计日志
```

## 数据模型关系

```
roles (1) ──→ (N) userRoles ←── (1) users
roles (1) ──→ (N) roleApiPermissions ←── (1) apiPermissions
roles (1) ──→ (N) roleRouters ←── (1) routers
apiPermissions (N) ──→ (1) apiPermissionGroups
```

## 1. 角色管理

### roles.dao.ts

| 方法 | 说明 |
|------|------|
| `findRoleByIdsDao` | 按 ID 列表查询角色（status=1, 未删除） |

角色核心字段：
- `code` — 角色代码（如 `super_admin`、`admin`、`user`）
- `name` — 角色名称
- `status` — 状态：1 启用 / 0 停用

**特殊角色**：`super_admin` 拥有所有权限，跳过权限校验。

## 2. 用户角色

### userRoles.dao.ts

| 方法 | 说明 |
|------|------|
| `createUserRoleDao` | 创建用户角色关联 |
| `findUserRolesByUserIdDao` | 查询用户的所有角色（include role） |
| `findUserRolesRouterByUserIdDao` | 查询用户角色的路由权限（include role → roleRouters → router） |
| `deleteUserRolesByUserIdDao` | 删除用户的所有角色关联 |

## 3. API 权限

### apiPermission.dao.ts

**权限分组**：

| 方法 | 说明 |
|------|------|
| `createApiPermissionGroupDao` | 创建权限分组 |
| `findAllApiPermissionGroupsDao` | 查询所有分组（按 sort 排序） |
| `findApiPermissionGroupByIdDao` | 按 ID 查询分组 |

**API 权限**：

| 方法 | 说明 |
|------|------|
| `createApiPermissionDao` | 创建 API 权限 |
| `findApiPermissionByIdDao` | 按 ID 查询 |
| `findApiPermissionByPathMethodDao` | 按路径+方法查询 |
| `findApiPermissionsDao` | 分页列表（支持 path/method/groupId/isPublic/keyword 筛选） |
| `findPublicApiPermissionsDao` | 查询所有公共 API 权限（isPublic=true, status=1） |
| `updateApiPermissionDao` | 更新 |
| `deleteApiPermissionDao` | 软删除 |

API 权限核心字段：
- `path` — API 路径（支持通配符，如 `/api/v1/users/:id`）
- `method` — HTTP 方法（GET/POST/PUT/DELETE 或 `*` 表示全部）
- `isPublic` — 是否公共接口（公共接口不需要权限校验）
- `groupId` — 所属分组

## 4. 角色权限映射

### roleApiPermission.dao.ts

| 方法 | 说明 |
|------|------|
| `assignApiPermissionsToRoleDao` | 为角色分配权限（跳过已存在的） |
| `removeApiPermissionsFromRoleDao` | 移除角色的指定权限 |
| `setRoleApiPermissionsDao` | **全量替换**角色的 API 权限（删除旧的 + 创建新的） |
| `findRoleApiPermissionsDao` | 查询角色的 API 权限列表 |
| `findUserApiPermissionsDao` | 查询用户的所有 API 权限（用户 → 角色 → 权限，去重） |

## 5. 权限校验服务

### permission.service.ts

**核心接口**：

```typescript
interface PermissionCheckResult {
    allowed: boolean
    reason?: string
}
```

| 方法 | 说明 |
|------|------|
| `checkIsSuperAdmin` | 检查用户是否为超级管理员 |
| `validateUserApiPermission` | 检查用户是否有 API 访问权限 |
| `getUserPermissions` | 获取用户完整权限数据（API 权限 + 路由权限 + 是否超管） |
| `refreshUserPermissions` | 刷新用户权限缓存 |

**API 权限校验流程**（`validateUserApiPermission`）：

```
1. 检查缓存中是否有用户权限数据
2. 如果没有缓存，从数据库加载并缓存
3. 检查是否为超级管理员 → 直接放行
4. 检查请求路径是否匹配公共 API → 直接放行
5. 遍历用户的 API 权限，使用 pathMatcher 匹配
6. 返回 PermissionCheckResult
```

**缓存集成**：校验结果从缓存读取，避免每次请求查库。缓存在角色/权限变更时主动清除。

## 6. 路径匹配器

### pathMatcher.ts

支持三种路径模式：

| 模式 | 说明 | 示例 |
|------|------|------|
| `:param` | 匹配单个路径段 | `/api/v1/users/:id` 匹配 `/api/v1/users/123` |
| `*` | 匹配单个路径段 | `/api/v1/files/*/info` |
| `**` | 匹配任意路径段 | `/api/v1/admin/**` 匹配 `/api/v1/admin/roles/1/permissions` |

| 函数 | 说明 |
|------|------|
| `matchPath(pattern, path)` | 路径匹配 |
| `matchMethod(permissionMethod, requestMethod)` | 方法匹配（`*` 匹配所有，不区分大小写） |
| `findMatchingPermission(permissions, path, method)` | 在权限列表中查找匹配项 |

**实现原理**：将路径模式转换为正则表达式。`:param` 和 `*` 转为 `[^/]+`，`**` 转为 `.*`。

## 7. 缓存服务

### cache.service.ts

内存缓存，默认过期时间 5 分钟。

**缓存类型**：

```typescript
interface UserPermissionCache {
    apiPermissions: Array<{ id: number; path: string; method: string }>
    routePermissions: string[]
    isSuperAdmin: boolean
}

interface PublicApiPermissionCache {
    path: string
    method: string
}
```

| 方法 | 说明 |
|------|------|
| `getUserPermissionCache` / `setUserPermissionCache` | 用户权限缓存（按 userId 键） |
| `clearUserPermissionCache` | 清除指定用户缓存 |
| `clearUserPermissionCacheBatch` | 批量清除用户缓存 |
| `getPublicApiPermissionCache` / `setPublicApiPermissionCache` | 公共 API 权限缓存（全局单例） |
| `clearPublicApiPermissionCache` | 清除公共权限缓存 |
| `clearAllCache` | 清除所有缓存 |

**缓存失效时机**：
- 角色创建/更新/删除 → 清除相关用户缓存
- 用户角色变更 → 清除该用户缓存
- API 权限变更 → 清除公共权限缓存 + 所有用户缓存
- 角色权限映射变更 → 清除相关用户缓存

## 8. 审计日志

### auditLog.dao.ts / auditLog.service.ts

记录权限相关的操作日志。

**日志操作类型**（`AuditLogAction`）：
- `ROLE_CREATE` / `ROLE_UPDATE` / `ROLE_DELETE`
- `USER_ROLE_ASSIGN` / `USER_ROLE_REMOVE`
- `PERMISSION_CREATE` / `PERMISSION_UPDATE` / `PERMISSION_DELETE`
- `ROLE_PERMISSION_ASSIGN` / `ROLE_PERMISSION_REMOVE`

| 方法（DAO） | 说明 |
|--------|------|
| `createAuditLogDao` | 创建审计日志 |
| `findAuditLogsDao` | 分页查询（支持 action/targetType/targetId/operatorId/时间范围筛选） |

| 方法（Service） | 说明 |
|--------|------|
| `logRoleCreate` / `logRoleUpdate` / `logRoleDelete` | 角色操作日志 |
| `logUserAssignRole` / `logUserRemoveRole` | 用户角色日志 |
| `logApiPermissionCreate` / `logApiPermissionUpdate` | 权限操作日志 |

审计日志自动记录 `oldValue`、`newValue`（JSON 格式）和客户端 IP（从 `X-Forwarded-For` / `X-Real-IP` 获取）。

## 中间件集成

RBAC 通过 Nitro 中间件在 API 请求到达路由处理器之前执行权限校验：

```
请求进入
  ↓
认证中间件（获取 userId）
  ↓
RBAC 中间件：
  1. 路径是否匹配公共 API → 放行
  2. 获取用户权限（缓存优先）
  3. 超级管理员 → 放行
  4. pathMatcher 匹配用户权限列表
  5. 匹配成功 → 放行；失败 → 403
  ↓
路由处理器
```

## 注意事项

1. **超级管理员**：`super_admin` 角色跳过所有权限校验
2. **公共 API**：`isPublic=true` 的权限不需要任何角色即可访问
3. **缓存一致性**：权限变更后必须主动清除相关缓存
4. **路径匹配优先级**：精确匹配 > `:param` > `*` > `**`
5. **审计日志不走事务**：审计日志记录失败不影响业务操作

## 相关文档

- [tech-docs/backend/membership.md](./membership.md) — 会员级别与节点访问控制（另一套权限体系）
- [tech-docs/backend/node.md](./node.md) — 节点访问控制
