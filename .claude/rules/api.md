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

> 项目已关闭服务端目录扫描（`nitro.imports.dirs: []`），**所有 service / DAO / Prisma 客户端都必须显式 import**。

### 仍自动导入（无需 import）

| 类别 | 内容 |
|------|------|
| H3 框架 | `defineEventHandler`、`getQuery`、`readBody`、`getRouterParam`、`getHeader`、`getCookie`、`setCookie`、`getRequestURL`、`setResponseStatus`、`createError` 等 |
| Nitro 内置 | `useRuntimeConfig`、`useStorage` |
| 白名单工具 | `logger`、`resSuccess`、`resError` |

### 必须显式 import

```typescript
// 服务端 Prisma 单例 — 不要从 #shared/utils/prisma 取
import { prisma } from '~~/server/utils/db'

// 业务 Service / DAO（命名规则：模块名.service.ts / 模块名.dao.ts）
import { someService } from '~~/server/services/<domain>/xxx.service'
import { someDao } from '~~/server/services/<domain>/xxx.dao'

// 工具函数
import { md5 } from '~~/server/utils/jwt'
import { compress } from '~~/server/utils/imageCompression'

// 类型
import type { H3Event } from 'h3'
import type { cases, users } from '~~/generated/prisma/client'
import type { CaseStatus } from '#shared/types/case'
```

> Service 命名约定：方法以 `Service` 结尾、DAO 方法以 `DAO` 结尾。Service 之间可互相调用；DAO 仅被 Service 调用，不直接被 handler 调用。

## OSS 回调

回调自定义变量通过 `callbackVar` 传递：
- key 不能包含 `:` 字符
- 变量名不能包含大写

## 路由文件命名

动态路径参数（`[param]`）必须放在文件名末尾，不能放在目录中间：

```
# 正确：参数在末尾
server/api/v1/cases/analysis/runs/cancel/[runId].post.ts
→ POST /api/v1/cases/analysis/runs/cancel/:runId

# 错误：参数在中间
server/api/v1/cases/analysis/runs/[runId]/cancel.post.ts
→ 不要这样写
```

> 历史教训：早期 scan 接口未把 `[xxx]` 转为 `:xxx`，库里曾残留 158 条带字面 `[]` 的 dead 权限规则，永远匹配不上真实请求。`api-permissions/scan.post.ts` 现已通过 `normalizeApiPath`（[xxx] → :xxx）+ `validateApiPathFormat`（拒绝任何残留 `[`/`]`）兜底；写新接口时仍优先按上面的 `参数末尾` 范式落盘。

## RBAC 路径匹配协议（pathMatcher）

数据库里 `api_permissions.path` 存的是 **匹配模式**，非真实请求路径。三种通配符：

| 模式 | 含义 | 示例 |
|------|------|------|
| `:param` | 匹配单个路径段（动态参数） | `/api/v1/users/:id` 匹配 `/api/v1/users/123` |
| `*` | 匹配单个路径段 | `/api/v1/files/*/meta` 匹配 `/api/v1/files/abc/meta` |
| `**` | 匹配任意路径段（含 `/`） | `/api/v1/admin/**` 匹配 `/api/v1/admin/roles/1/permissions` |

> ⚠️ `:param` 仅在路径段开头才会被识别为动态参数。`/foo:bar` 中的 `:` 会按字面冒号处理，不当作参数。这是 M5 的安全收紧。

## 管理端 API 注册流程（不动 seedData / migration）

新增 / 修改一个管理端接口（`server/api/v1/admin/**`）后，**不要**手写 SQL 到 `seedData.sql` 或迁移文件，按下面流程注册：

1. 路由文件落盘后，`bun dev` 让 Nitro 扫描到新文件
2. 进入管理后台 → 「API 权限」→ 点 **扫描** → 命中新接口（路径已自动 `[id] → :id`、method 大写）
3. 「路由」页同样有 **扫描** 按钮，把新增页面挂到菜单
4. 在「角色」页给目标角色（一般是新建管理类角色 admin / editor / operator）勾上权限
5. 超级管理员开发期通过菜单兜底直接可见，无需手工 INSERT

> 不要在中间件里硬卡"非 super_admin 一律 403"——管理端接口走 RBAC 权限表细粒度判定（详见 `server/middleware/03.permission.ts` + `server/services/rbac/permission.service.ts`）。任意被授权的管理类角色都能访问。

> seedData 的角色：`prisma/seeds/seedData.sql` 是基础数据快照，不用作迁移增量。新业务的权限通过上面的 scan + import 流程进入数据库，**不写到 seedData.sql 里**（防止把开发期临时配置带到生产）。

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
  - 鉴权：由 `server/middleware/03.permission.ts` 统一拦截，**根据 RBAC 权限表细粒度判定**——任意已被授予对应 API 权限的角色都能访问（super_admin、admin、editor、operator 等管理类角色按需授权即可）。**不允许**在中间件里做"非 super_admin 一律 403"这种身份硬卡，否则后续新增管理类岗位都得改代码。默认拒绝兜底由 RBAC 实现（没匹配到权限自动 403）。
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

## 系统级文件落库（如有此类场景时参考）

`ossFiles.userId` 已设计为可空。当一份文件是"面向全体用户的系统资源"（如全局文书模板）而非任何用户的私有云盘文件时：

- 落库时 `userId` 写 `NULL`，表示"系统所有，不属于任何个人云盘"
- 用户云盘列表 `findOssFilesByUserIdDao` 与配额计算 `ossUsageDao` 按 `WHERE userId = me` 过滤，NULL 行天然被排除
- 决策在 API handler 层显式表态（管理端 handler 传 `null`，用户端 handler 传 `user.id`），与"管理端 / 用户端 API 物理隔离"铁律一致

参考实现：`server/api/v1/admin/document-templates/index.post.ts` + `server/agents/document/documentTemplate.service.ts`。
