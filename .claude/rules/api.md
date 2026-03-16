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

## 代码架构

在 `server/services` 目录中：
- 服务层：`模块名称.service.ts`，方法要以 `Service` 结尾
- DAO 层：`模块名称.dao.ts`，方法要以 `DAO` 结尾
