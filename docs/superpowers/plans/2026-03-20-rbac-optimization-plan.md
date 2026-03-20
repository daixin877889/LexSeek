# RBAC 优化实施计划

> 基于设计文档: `docs/superpowers/specs/2026-03-20-rbac-optimization-design.md`

## 团队分工

根据文件依赖关系和并行度分析，将 23 项修复拆分为可并行执行的任务组。

### Phase 1：安全修复（必须串行，因涉及核心安全逻辑）

Phase 1 修改的是中间件和核心 DAO，文件间有强依赖，分为两组顺序执行：

#### 任务 1A：核心安全修复（Agent: security-fixer）
按顺序处理以下修改：

**Step 1 - 统一公开 API 匹配（1.1）**
- 文件: `server/middleware/02.auth.ts`
- 操作: 删除自定义 `isPublicApi()` 函数，导入 `findMatchingPermission` 替代
- 验证: 运行 `npx vitest run tests/server/rbac/public-resource.test.ts`

**Step 2 - DAO 软删除/状态过滤（1.3）**
- 文件: `server/services/rbac/roleApiPermission.dao.ts`
- 操作:
  - `findUserApiPermissionsDao`: userRoles.findMany 添加 `role: { status: 1, deletedAt: null }` 过滤
  - `findRolesApiPermissionsDao`: roleApiPermissions.findMany 添加 `permission: { status: 1, deletedAt: null }` 过滤
- 验证: 运行 `npx vitest run tests/server/rbac/role-api-permission.test.ts`

**Step 3 - setRoleApiPermissionsDao 事务保护（1.5）**
- 文件: `server/services/rbac/roleApiPermission.dao.ts`
- 操作: 当 tx 未传入时，内部包裹 `prisma.$transaction`
- 验证: 运行 `npx vitest run tests/server/rbac/role-api-permission.test.ts`

**Step 4 - 批量删除改软删除 + 清理关联（1.4）**
- 文件: `server/api/v1/admin/api-permissions/batch-delete.delete.ts`
- 操作:
  - 添加事务包裹
  - 先 deleteMany roleApiPermissions 关联
  - 再 updateMany apiPermissions 设置 deletedAt
  - 刷新缓存
- 验证: 运行 `npx vitest run tests/server/rbac/batch-permission.test.ts`

**Step 5 - users/roles.get.ts 可选链（1.6）**
- 文件: `server/api/v1/users/roles.get.ts`
- 操作: `event.context.auth.user` → `event.context.auth?.user`，添加未登录检查

#### 任务 1B：Admin Guard（Agent: admin-guard-worker）
与任务 1A 无文件冲突，可并行：

**Step 1 - 创建 adminGuard 工具**
- 新建: `server/utils/adminGuard.ts`
- 内容: `requireAdmin(event)` 函数，调用 `checkIsSuperAdmin` 验证

**Step 2 - 为所有 RBAC admin 写端点添加校验**
- 文件列表（14 个端点，全部在 handler 开头添加 `await requireAdmin(event)`）:
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

**Phase 1 验证**: 全部完成后运行 `npx vitest run tests/server/rbac --reporter=verbose`

---

### Phase 2：性能与一致性（可高度并行）

Phase 2 的 7 项修改文件交叉较少，分为 3 组并行执行：

#### 任务 2A：缓存与性能优化（Agent: perf-optimizer）

**Step 1 - 缓存容量上限与定期清理（2.1）**
- 文件: `server/services/rbac/cache.service.ts`
- 操作:
  - 添加 MAX_CACHE_SIZE = 1000 常量
  - setUserPermissionCache 中添加容量检查，超限时淘汰过期/FIFO 条目
  - 添加 10 分钟定期清理定时器
  - getCacheStats 增加统计
- 验证: `npx vitest run tests/server/rbac/cache.test.ts`

**Step 2 - 路径匹配器正则缓存（2.2）**
- 文件: `server/services/rbac/pathMatcher.ts`
- 操作: 添加 `Map<string, RegExp>` 缓存
- 验证: `npx vitest run tests/server/rbac/path-matcher.test.ts`

#### 任务 2B：数据库与 API 修复（Agent: db-api-fixer）

**Step 1 - 清理冗余索引（2.3）**
- 文件: `prisma/models/rbac.prisma`, `prisma/models/apiPermission.prisma`, `prisma/models/router.prisma`
- 操作: 按设计文档表格删除冗余索引
- 验证: `bun run prisma:generate`（确认 schema 有效）

**Step 2 - 批量导入事务保护（2.4）**
- 文件: `server/api/v1/admin/api-permissions/batch-import.post.ts`
- 操作: 事务包裹，收集失败项返回

**Step 3 - 全量查询已有权限（2.5）**
- 文件: `server/services/rbac/apiPermission.dao.ts`, `scan.post.ts`, `batch-import.post.ts`
- 操作: 新增 `findAllApiPermissionPathsDao()`，替换硬编码 pageSize=1000
- 验证: `npx vitest run tests/server/rbac/batch-permission.test.ts`

**Step 4 - 审计日志批量操作完整记录（2.6）**
- 文件: `server/services/rbac/auditLog.service.ts`
- 操作: 批量操作 targetId 改为 null，完整 ID 列表存入 newValue
- 验证: `npx vitest run tests/server/rbac/audit-log.test.ts`

#### 任务 2C：角色 DAO 统一（Agent: role-dao-worker）

**Step 1 - 补充角色 DAO 方法（2.7）**
- 文件: `server/services/rbac/roles.dao.ts`
- 操作: 添加 createRoleDao, findRolesDao, findRoleByIdDao, updateRoleDao, deleteRoleDao, checkRoleExistsDao

**Step 2 - 迁移角色 API 端点**
- 文件: `index.post.ts`, `index.get.ts`, `[id].get.ts`, `[id].put.ts`, `[id].delete.ts`
- 操作: 替换直接 prisma 调用为 DAO 方法
- 验证: `npx vitest run tests/server/rbac/rbac.test.ts tests/server/rbac/role-protection.test.ts`

**Phase 2 验证**: 全部完成后运行 `npx vitest run tests/server/rbac --reporter=verbose`

---

### Phase 3：代码质量（可高度并行）

Phase 3 的 10 项修改拆分为 3 组：

#### 任务 3A：死代码清理 + 类型修复（Agent: code-cleaner）

**Step 1 - 删除未使用代码（3.1）**
- 文件: `roleApiPermission.dao.ts`, `permission.service.ts`, `apiPermission.dao.ts`, `auditLog.service.ts`, `auditLog.dao.ts`, `shared/types/rbac.ts`
- 操作: 按设计文档表格逐一删除，findRolesApiPermissionsDao 移除 export
- 验证: `npx vitest run tests/server/rbac --reporter=verbose`（确认无破坏）

**Step 2 - 消除类型重复（3.2）**
- 文件: `server/services/rbac/cache.service.ts`
- 操作: 删除 UserPermissionCache，使用 UserPermissions

**Step 3 - 审计日志 operatorId 级联修改（3.3）**
- 文件: `prisma/models/apiPermission.prisma`, `auditLog.dao.ts`, `auditLog.service.ts`
- 操作: operatorId 改可空，onDelete 改 SetNull，适配类型签名

**Step 4 - routers.groupId 修正（3.4）**
- 文件: `prisma/models/router.prisma`
- 操作: groupId 改 Int?，移除 @default(0)

**Step 5 - 中间表清理冗余字段（3.6）**
- 文件: `prisma/models/rbac.prisma`, `prisma/models/apiPermission.prisma`
- 操作: roleRouters/userRoles/roleApiPermissions 移除 deletedAt/updatedAt 字段和相关索引

**Step 6 - 生成数据库迁移**
- 执行: `bun run prisma:generate`

#### 任务 3B：API 端点改进（Agent: api-improver）

**Step 1 - 权限分配审计记录 oldValue（3.5）**
- 文件: `api-permissions.put.ts`, `route-permissions.put.ts`
- 操作: 分配前查询当前权限列表记录为 oldValue

**Step 2 - scan.post.ts 环境检查（3.7）**
- 文件: `scan.post.ts`
- 操作: 添加生产环境检查

**Step 3 - method 枚举校验（3.8）**
- 文件: `api-permissions/index.post.ts`, `[id].put.ts`
- 操作: method 改为 z.enum

**Step 4 - 响应字段清理优化（3.10）**
- 文件: `roles/[id].get.ts`, `roles/index.get.ts`
- 操作: 改用解构排除字段

#### 任务 3C：测试重构（Agent: test-refactorer）

**Step 1 - 创建测试辅助模块（3.9）**
- 新建: `tests/server/rbac/helpers/test-helper.ts`
- 操作: 提取 generateUniqueId, createTestRole, createTestApiPermission, cleanupTestData, 全局 prisma/logger

**Step 2 - 迁移所有测试文件**
- 文件: 11 个测试文件
- 操作: 替换重复代码为 helper 导入
- 验证: `npx vitest run tests/server/rbac --reporter=verbose`

**Phase 3 验证**: 全部完成后运行完整测试 `npx vitest run tests/server/rbac --reporter=verbose`

---

## 并行度总结

```
Phase 1:  [1A: security-fixer] ──────────┐
          [1B: admin-guard-worker] ───────┤── Phase 1 验证
                                          │
Phase 2:  [2A: perf-optimizer] ──────────┐│
          [2B: db-api-fixer] ────────────┤├── Phase 2 验证
          [2C: role-dao-worker] ─────────┘│
                                          │
Phase 3:  [3A: code-cleaner] ───────────┐ │
          [3B: api-improver] ───────────┤ ├── Phase 3 验证
          [3C: test-refactorer] ────────┘ │
                                          └── 全量测试
```

Phase 1 的两组可并行，Phase 2 的三组可并行，Phase 3 的三组可并行。
Phase 之间必须串行（Phase 1 → Phase 2 → Phase 3）。
