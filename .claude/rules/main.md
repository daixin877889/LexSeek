---
paths:
  - "**/*.ts"
  - "**/*.vue"
  - "server/**"
  - "app/**"
---

# 核心规范

## 语言要求

- 所有回复和对话使用中文（简体中文）
- 代码注释使用中文
- 技术术语可保留英文，但需提供中文解释

## TDD 开发模式

**先编写测试，再写代码，代码完成后运行测试确保通过。**

```bash
# 编写测试 -> 运行测试(失败) -> 编写实现 -> 运行测试(通过)
```

## 框架约定

- Nuxt 4 + Vue 3 + Tailwind v4
- Prisma ORM（Decimal 使用 `shared/utils/decimalToNumber.ts` 转换）
- 日期处理使用 dayjs
- 代码超过 500 行需拆分文件

## 自动导入

### 服务端（无需 import）
- `prisma` - Prisma 客户端
- `logger` - 日志工具
- `resSuccess` / `resError` - 响应函数
- H3 函数：`defineEventHandler`, `getQuery`, `readBody`, `getRouterParam`
- 服务层：`auth`, `campaign`, `encryption`, `files`, `membership`, `payment`, `point`, `product`, `rbac`, `sms`, `storage`, `users`

### 前端（无需 import）
- Vue 响应式 API：`ref`, `reactive`, `computed`, `watch`
- Nuxt composables：`useFetch`, `useState`, `useRuntimeConfig`
- 路由函数：`navigateTo`, `useRoute`, `useRouter`
- Pinia stores：`store/` 目录下所有 store
- Composables：`useApi`, `useApiFetch`, `useAuth`, `useTheme`

### 类型（需手动导入）
```typescript
import type { UserInfo } from '#shared/types/user'
```

## 用户认证

```typescript
// ✅ 正确
const user = event.context.auth?.user
if (!user) return resError(event, 401, '请先登录')

// ❌ 错误
const user = event.context.user  // 始终 undefined
```

## API 路由规范

- params 参数必须在最末尾
- ❌ `/admin/legal-main/:id/articles`
- ✅ `/admin/legal-main/articles/:id`

## 注意事项

- 避免代码多层嵌套
- 代码实现必须使用简洁且健壮的方案，严禁 demo 级别实现
- 需要验证数据库数据时，查找 postgres docker 容器执行查询
