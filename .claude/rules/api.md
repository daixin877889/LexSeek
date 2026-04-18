---
paths:
  - "server/**"
---

# API 开发规范

## 响应格式

```typescript
// 成功响应
return resSuccess(event, '操作成功', data)

// 错误响应
return resError(event, 400, '参数错误')
```

API 永远返回 200 的 HTTP 状态码，错误码通过 `resError` 的 `code` 字段返回。

## 参数验证

使用 zod 进行参数验证：

```typescript
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1),
  age: z.number().int().positive()
})

const body = await readBody(event)
const result = schema.safeParse(body)
if (!result.success) {
  return resError(event, 400, result.error.issues[0].message)
}
```

## 服务端自动导入

以下无需手动 import：

**服务层函数**（`server/services/*/*`）：
- auth、campaign、encryption、files、membership
- payment、point、product、rbac、redemption
- sms、storage、system、users

**工具函数**（`server/utils/`）：
- `prisma` - Prisma 客户端
- `logger` - 日志工具
- `resSuccess` / `resError` - 响应函数

**H3 框架函数**：
- `defineEventHandler` - 定义处理器
- `getQuery` - 获取查询参数
- `readBody` - 读取请求体
- `getHeader` - 获取请求头
- `setResponseStatus` - 设置状态码
- `getRouterParam` - 获取路由参数

## OSS 回调

回调自定义变量通过 `callbackVar` 传递：
- key 不能包含 `:` 字符
- 变量名不能包含大写

## 路由文件命名

动态路径参数（`[param]`）必须放在文件名末尾，不能放在目录中间：

```
# 正确：参数在末尾
server/api/v1/case/analysis/runs/cancel/[runId].post.ts
→ POST /api/v1/case/analysis/runs/cancel/:runId

# 错误：参数在中间
server/api/v1/case/analysis/runs/[runId]/cancel.post.ts
→ 不要这样写
```

## 代码架构

在 `server/services` 目录中：
- 服务层：`模块名称.service.ts`，方法要以 `Service` 结尾
- DAO 层：`模块名称.dao.ts`，方法要以 `DAO` 结尾

## 管理端与用户端 API 隔离（系统级规则）

**禁止** 在同一个接口中通过 `checkIsSuperAdmin` 等手段为超管开旁路来兼顾两端诉求。超管走用户端接口的行为必须和普通用户完全一致——否则极易产生"超管从用户页操作时意外越权或创建错误 scope 数据"的 bug。

### 路径约定

- 用户端：`server/api/v1/<module>/**`
  - 鉴权：`event.context.auth?.user` + 业务维度归属校验（owner-only / viewerUserId 过滤等）
  - 资源可见范围：仅自己的 + 公开共享的
- 管理端：`server/api/v1/admin/<module>/**`
  - 鉴权：由 `server/middleware/03.permission.ts` 统一拦截（非 super_admin 访问 `/api/v1/admin/**` 直接 403）
  - 资源可见范围：全量，不做归属过滤

### 强制成对实现

同一资源两端都要操作时，按需分别实现成对接口；前端按身份调用对应那一套：

```
POST   /api/v1/<module>             ← /dashboard/** 页面调用
POST   /api/v1/admin/<module>       ← /admin/** 页面调用

GET    /api/v1/<module>
GET    /api/v1/admin/<module>

PATCH  /api/v1/<module>/:id
PATCH  /api/v1/admin/<module>/:id

DELETE /api/v1/<module>/:id
DELETE /api/v1/admin/<module>/:id
```

用户端 handler 保持严格 owner-only / viewer 过滤；管理端 handler 去掉归属校验，依赖中间件保护。

### 参考实现

`server/api/v1/assistant/document/templates*`（用户端）与 `server/api/v1/admin/document-templates/**`（管理端）即按此规则实现，可直接对照。
