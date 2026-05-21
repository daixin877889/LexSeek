# 中间件链路

四层中间件按文件名顺序执行：requestId → auth → permission → langfuseContext，所有 API 请求必经此链路，非 API 请求在每层直接放行。

## 执行顺序

```
请求进入
  │
  ├─ 01.requestId.ts ────── 生成请求 ID
  │
  ├─ 02.auth.ts ─────────── 身份认证
  │
  ├─ 03.permission.ts ───── 权限验证
  │
  ├─ 04.langfuseContext.ts ─ 起 Langfuse ALS 根上下文
  │
  └─ API Handler
```

## 01.requestId.ts — 请求标识

**职责**：为每个请求生成唯一标识符，写入 `event.context.requestId`。

```typescript
export default defineEventHandler(async (event) => {
    event.context.requestId = uuidv7()
})
```

- 使用 UUIDv7（时间有序），便于日志排查
- 无条件执行，所有请求都会携带 requestId
- 该 ID 会包含在 `resSuccess` / `resError` 的响应中

## 02.auth.ts — 身份认证

**职责**：验证 JWT、解析用户身份、设置认证上下文。

### 处理流程

```
请求进入
  │
  ├─ 非 API 请求？ ──→ 放行
  │
  ├─ 公开 API？ ────→ 标记 event.context.isPublicApi = true，放行
  │   （从数据库读取，带缓存）
  │
  ├─ 提取 Token
  │   ├─ 优先：Authorization: Bearer <token>（authType: 'token'）
  │   └─ 备选：Cookie auth_token（authType: 'cookie'）
  │
  ├─ 无 Token？ ────→ 清除 Cookie + 返回 401
  │
  ├─ JWT 验证（JwtUtil.verifyToken）
  │   └─ 失败？ ────→ 清除 Cookie + 返回 401
  │
  ├─ Token 黑名单检查
  │   └─ 在黑名单？ → 清除 Cookie + 返回 401
  │
  ├─ 用户存在性 + 状态检查
  │   ├─ 不存在？ ──→ 清除 Cookie + 返回 401
  │   └─ 被禁用？ ──→ 清除 Cookie + 返回 401
  │
  └─ 设置 event.context.auth
```

### 公开 API 判定

公开 API 列表从数据库读取（通过 `getPublicApiPermissions()`），支持：
- **精确匹配**：`/api/v1/auth/login` 匹配相同路径
- **前缀匹配**：`/api/v1/public/` 匹配所有以此开头的路径（仅当配置路径以 `/` 结尾）
- **方法匹配**：`*` 匹配所有 HTTP 方法，或指定具体方法（GET/POST 等）

### 认证上下文结构

```typescript
event.context.auth = {
    user: {
        id: number,       // 用户 ID
        phone: string,    // 手机号
        roles: number[],  // 角色 ID 列表（从 userRoles 关联查询）
        status?: number,  // 用户状态
    },
    type: 'cookie' | 'token',  // 认证方式
    token: string,              // 原始 token
}
```

### 关键陷阱

```typescript
// 正确 - 通过 auth 获取用户
const user = event.context.auth?.user
if (!user) return resError(event, 401, '请先登录')

// 错误 - 始终 undefined
const user = event.context.user
```

## 03.permission.ts — RBAC 权限验证

**职责**：基于角色的 API 访问控制，验证用户是否有权调用当前接口。

### 处理流程

```
请求进入
  │
  ├─ 非 API 请求？ ─────→ 放行
  │
  ├─ event.context.isPublicApi？ → 放行（02.auth 已标记）
  │
  ├─ 获取 userId（event.context.auth?.user?.id）
  │
  └─ validateUserApiPermission(userId, path, method)
      │
      ├─ 公开 API 再次检查 ──→ allowed（兜底）
      ├─ 未登录 ────────────→ 401 请先登录
      ├─ 超级管理员 ────────→ allowed（全部放行）
      ├─ 有权限 ────────────→ allowed
      └─ 无权限 ────────────→ 403 无权限访问该接口
```

### 路径匹配规则

RBAC 使用 `pathMatcher.ts` 进行路径匹配，支持三种模式：

| 模式 | 说明 | 示例 |
|------|------|------|
| `:param` | 匹配单个路径段 | `/api/v1/users/:id` 匹配 `/api/v1/users/123` |
| `*` | 匹配单个路径段 | `/api/v1/files/*/info` |
| `**` | 匹配任意路径段 | `/api/v1/admin/**` 匹配 `/api/v1/admin/roles/1/permissions` |

方法匹配：`*` 匹配所有 HTTP 方法，不区分大小写。

### 缓存策略

权限验证使用内存缓存（`cache.service.ts`），减少数据库查询：

| 缓存类型 | TTL | 刷新时机 |
|---------|-----|---------|
| 用户权限（apiPermissions + routePermissions + isSuperAdmin） | 5 分钟 | 角色变更时主动清除 |
| 公开 API 列表 | 5 分钟 | API 权限配置变更时主动清除 |

刷新方法：
- `refreshUserPermissions(userId)` — 单用户权限刷新
- `refreshRoleUsersPermissions(roleId)` — 角色关联的所有用户批量刷新
- `refreshPublicApiPermissions()` — 公开 API 列表刷新

### 超级管理员

角色 code 为 `super_admin` 的用户跳过所有权限检查，直接放行。判定逻辑：查询 userRoles 关联的 role，检查 `code === 'super_admin'` 且 `status === 1` 且 `deletedAt === null`。

## 04.langfuseContext.ts — Langfuse 上下文

**职责**：在 01/02/03 之后用 `enterLangfuseContext` 起 Langfuse 的 AsyncLocalStorage 根上下文，写入 `requestId` 与 `userId`（未登录时为空），供后续业务节点链路追踪使用。

```typescript
export default defineEventHandler((event) => {
    enterLangfuseContext({
        requestId: event.context.requestId ?? '',
        userId: event.context.auth?.user?.id,
    })
})
```

- 通过 `enterWith` 建立 ALS 根上下文，覆盖整个请求生命周期
- 后续业务节点用 `withLangfuseContext` 在此根上下文上增量补充 `sessionId` / `runId` / 业务实体 ID / `vertical`
- 无条件执行，不做放行 / 拦截判断（详见 [tech-docs/backend/langfuse.md](../backend/langfuse.md)）
