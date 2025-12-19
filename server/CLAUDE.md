[根目录](../../CLAUDE.md) > **server**

# Server 模块

## 模块职责

Server 模块负责 LexSeek 的后端API服务，提供：
- RESTful API 接口
- 数据库操作封装
- 业务逻辑处理
- 中间件和工具函数

## 入口与启动

Nuxt Server 自动从 `server/api` 目录扫描并注册API路由。

## 目录结构

```
server/
├── api/            # API路由
│   └── v1/        # API版本1
│       ├── login.ts
│       └── sms/
│           └── send.post.ts
└── utils/         # 服务端工具
    ├── db.ts      # 数据库连接
    └── sms.ts     # 短信工具
```

## API接口规范

### 通用响应格式
```typescript
{
  code: number,      // 状态码: 200-成功, 400-客户端错误, 500-服务端错误
  message: string,   // 响应消息
  data?: any        // 响应数据（可选）
}
```

### 已实现接口

#### 用户认证
- `GET /api/v1/login` - 用户登录
  - 参数: `phone` (query)
  - 返回: 用户信息

#### 短信服务
- `POST /api/v1/sms/send` - 发送短信验证码
  - 请求体: `{ phone: string, type: SmsType }`
  - 功能: 生成6位验证码，5分钟有效期，1分钟发送间隔限制

## 数据库连接

### Prisma 配置
- 适配器: `@prisma/adapter-pg`
- 客户端路径: `../app/generated/prisma/client`
- 连接池: 使用环境变量 `DATABASE_URL`

### 使用示例
```typescript
import { prisma } from '~/server/utils/db'

// 查询用户
const user = await prisma.users.findUnique({
  where: { phone }
})
```

## 中间件与工具

### 数据验证
使用 Zod 进行请求数据验证：
```typescript
import { z } from 'zod'

const schema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
  type: z.enum(SmsType)
})

const body = await readValidatedBody(event, (payload) => schema.parse(payload))
```

### 短信工具 (`utils/sms.ts`)
- `generateSmsCode()`: 生成6位随机验证码

## 安全措施

1. **输入验证**
   - 所有API输入使用 Zod Schema 验证
   - 手机号格式验证

2. **频率限制**
   - 短信验证码1分钟内只能发送一次
   - 验证码5分钟有效期

3. **用户状态检查**
   - 发送验证码前检查用户状态
   - 禁用用户无法接收验证码

## 错误处理

### 统一错误处理流程
1. 捕获 Zod 验证错误
2. 解析错误消息并返回
3. 未处理错误返回500状态

### 错误响应示例
```typescript
// 验证错误
{
  code: 400,
  message: "手机号格式不正确,验证码类型不正确"
}

// 服务器错误
{
  code: 500,
  message: "服务器错误"
}
```

## 环境变量

- `DATABASE_URL`: PostgreSQL数据库连接字符串
- `NODE_ENV`: 环境标识（开发/生产）

## 开发规范

1. **API路由命名**
   - GET请求使用文件名: `login.ts`
   - POST请求使用后缀: `send.post.ts`

2. **数据库操作**
   - 优先使用 Prisma Client
   - 查询指定需要的字段
   - 使用软删除（`deletedAt`）

3. **类型安全**
   - 导入共享类型: `import { SmsType } from '~/shared/types/sms'`
   - 使用 TypeScript 严格模式

## 常见问题 (FAQ)

1. **如何添加新的API接口？**
   - 在 `server/api/v1/` 目录下创建文件
   - 使用 `defineEventHandler` 包装处理函数
   - 遵循统一的响应格式

2. **如何处理数据库事务？**
   ```typescript
   await prisma.$transaction(async (tx) => {
     // 事务操作
   })
   ```

3. **如何添加中间件？**
   - 在 `server/middleware/` 目录创建文件
   - Nuxt 自动加载中间件

## 相关文件清单

- `api/v1/login.ts` - 登录接口
- `api/v1/sms/send.post.ts` - 短信发送接口
- `utils/db.ts` - 数据库连接封装
- `utils/sms.ts` - 短信工具函数

## 变更记录 (Changelog)

**2025-12-19**: 初始化 server 模块文档