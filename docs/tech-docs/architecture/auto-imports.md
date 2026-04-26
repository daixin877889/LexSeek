# 自动导入机制

项目已大幅收窄自动导入范围（`imports.scan: false`，`nitro.imports.dirs: []`），**绝大多数代码需要显式 import**。只有 Vue/Nuxt/H3 内置魔法和少量白名单工具保留自动导入。

## 自动导入配置源（nuxt.config.ts）

```typescript
// 前端自动导入：关闭目录扫描，只保留白名单
imports: {
  scan: false,
  dirs: [],
  imports: [
    { name: 'logger', from: '#shared/utils/logger' },
    { name: 'resSuccess', from: '#shared/utils/apiResponse' },
    { name: 'resError', from: '#shared/utils/apiResponse' },
  ]
}

// 服务端自动导入（Nitro）：关闭目录扫描，只保留白名单
nitro: {
  imports: {
    dirs: [],
    imports: [
      { name: 'logger', from: '#shared/utils/logger' },
      { name: 'resSuccess', from: '#shared/utils/apiResponse' },
      { name: 'resError', from: '#shared/utils/apiResponse' },
    ]
  }
}

// 组件自动导入：只扫描 ai-elements/，shadcn-nuxt 模块独立注册 ui/
components: {
  dirs: [{
    path: '~/components/ai-elements',
    pathPrefix: false,
    ignore: ['**/index.ts', '**/context.ts'],
  }],
}
```

## 服务端自动导入范围

### 仍然自动导入（无需 import）

| 来源 | 自动导入内容 |
|------|------------|
| H3 框架 | `defineEventHandler`、`getQuery`、`readBody`、`getHeader`、`getRouterParam`、`getCookie`、`setCookie` 等 |
| Nitro 内置 | `useRuntimeConfig`、`useStorage` |
| 白名单 | `logger`、`resSuccess`、`resError` |

### 必须显式 import

```typescript
// Prisma 客户端
import { prisma } from '#shared/utils/prisma'

// 服务层、DAO 层
import { someService } from '~/server/services/xxx/xxx.service'
import { someDao } from '~/server/services/xxx/xxx.dao'

// 第三方库
import dayjs from 'dayjs'
import { z } from 'zod'
import type { H3Event } from 'h3'
```

服务模块路径示例：

| 模块 | 路径 |
|------|------|
| agent | `~/server/services/agent/` |
| auth | `~/server/services/auth/` |
| case | `~/server/services/case/` |
| material | `~/server/services/material/` |
| membership | `~/server/services/membership/` |
| payment | `~/server/services/payment/` |
| rbac | `~/server/services/rbac/` |
| retrieval | `~/server/services/retrieval/` |
| storage | `~/server/services/storage/` |
| users | `~/server/services/users/` |

## 前端自动导入范围

### 仍然自动导入（无需 import）

| 来源 | 自动导入内容 |
|------|------------|
| Vue | `ref`、`reactive`、`computed`、`watch`、`watchEffect`、`onMounted`、`nextTick` 等 |
| Vue Router | `useRoute`、`useRouter`、`navigateTo` |
| Nuxt | `useFetch`、`useState`、`useRuntimeConfig`、`useCookie`、`useHead` |
| Pinia | `defineStore`、`storeToRefs` |
| 白名单 | `logger`、`resSuccess`、`resError` |

### 必须显式 import

```typescript
// composables（app/composables/）
import { useApiFetch } from '~/composables/useApiFetch'
import { useAuth } from '~/composables/useAuth'
import { useTheme } from '~/composables/useTheme'

// Pinia stores（app/store/）
import { useAuthStore } from '~/store/auth'
import { useUserStore } from '~/store/user'

// 业务组件（非 ui/ 和 ai-elements/）
import SomeComp from '~/components/xxx/SomeComp.vue'

// 第三方库
import dayjs from 'dayjs'
import { z } from 'zod'
```

## 组件自动导入范围

| 目录 | 注册方式 | 是否自动 |
|------|---------|---------|
| `app/components/ui/` | shadcn-nuxt 模块 | 是，如 `<Button />`、`<Dialog />` |
| `app/components/ai-elements/` | nuxt.config.ts dirs | 是，pathPrefix: false |
| `app/components/**`（其他） | — | **否，需显式 import** |

## 必须手动导入的内容

### shared/types（类型定义）

```typescript
import type { UserInfo } from '#shared/types/user'
import type { CaseStatus } from '#shared/types/case'
import type { ApiBaseResponse } from '#shared/utils/apiResponse'
import type { cases } from '~~/generated/prisma/client'
```

### 第三方库

```typescript
import dayjs from 'dayjs'
import { z } from 'zod'
import type { H3Event } from 'h3'
```

## 常见陷阱

1. **prisma 不再自动导入**：必须 `import { prisma } from '#shared/utils/prisma'`。

2. **服务层不再自动导入**：所有 `server/services/` 下的函数必须显式 import，不能裸用。

3. **composables/store 不再自动导入**：`app/composables/` 和 `app/store/` 下的内容必须显式 import。

4. **shared/types 不会自动导入**：所有类型必须 `import type`。

5. **业务组件不再自动注册**：`ui/` 和 `ai-elements/` 以外的组件必须显式 import。

6. **useApiFetch vs useApi**：
   - `useApi` — 封装 `useFetch`，用于 SSR 和组件 setup
   - `useApiFetch` — 封装 `$fetch`，用于事件处理函数（onClick 等）
   - 两者都自动提取 data 字段，不要 `response?.data?.xxx`，直接 `response?.xxx`
