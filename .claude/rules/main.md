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
- 日期处理使用 dayjs；服务端写入数据库一律走 Prisma，连接强制 `TimeZone=UTC`
- 单文件超过 500 行需拆分（含 Vue 组件、Service、DAO）

## 自动导入

> 项目已大幅收窄自动导入范围（`imports.scan: false`、`nitro.imports.dirs: []`），**绝大多数代码需要显式 import**。

### 仍然自动导入（无需 import）

**服务端**
- H3 函数：`defineEventHandler`、`getQuery`、`readBody`、`getRouterParam`、`getHeader`、`getCookie`、`setCookie`、`getRequestURL`、`createError` 等
- Nitro 内置：`useRuntimeConfig`、`useStorage`
- 白名单工具：`logger`、`resSuccess`、`resError`

**前端**
- Vue 响应式 API：`ref`、`reactive`、`computed`、`watch`、`watchEffect`、`onMounted`、`nextTick` 等
- Nuxt composables：`useFetch`、`useState`、`useRuntimeConfig`、`useCookie`、`useHead`、`useNuxtApp` 等
- 路由：`navigateTo`、`useRoute`、`useRouter`、`definePageMeta`
- Pinia：`defineStore`、`storeToRefs`
- 白名单工具：`logger`、`resSuccess`、`resError`

**组件**
- `app/components/ui/` — 由 `shadcn-nuxt` 模块通过 `addComponent` 单独注册
- `app/components/ai-elements/` — 由 `nuxt.config.ts` 的 `components.dirs` 自动注册（仅 `.vue` 文件）

### 必须显式 import

**服务端**
```typescript
import { prisma } from '~~/server/utils/db'                       // ✅ 服务端 Prisma 单例
import { someService } from '~~/server/services/xxx/xxx.service'  // 服务层
import { someDao } from '~~/server/services/xxx/xxx.dao'          // DAO 层
import dayjs from 'dayjs'                                          // 第三方库
import { z } from 'zod'                                            // 参数校验
```

**前端**
```typescript
import { useApiFetch } from '~/composables/useApiFetch'  // 所有 composables（含 useApi/useApiFetch）
import { useAuthStore } from '~/store/auth'              // 所有 Pinia stores
import SomeComp from '~/components/xxx/SomeComp.vue'     // 业务组件（非 ui/ 与 ai-elements/）
```

**类型**（始终需要手动导入）
```typescript
import type { UserInfo } from '#shared/types/user'
import type { cases } from '~~/generated/prisma/client'
```

> ⚠️ Prisma 客户端不要从 `#shared/utils/prisma` 直接 `import { prisma }` 用于服务端；服务端业务请求**统一走 `~~/server/utils/db`**（已配置 `globalThis.prisma` 单例 + worker DB 隔离兼容）。

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
- 不要使用 sed 进行批量文件迁移或模板修改。逐文件编辑以避免破坏 Vue 模板语法（标签不平衡）
