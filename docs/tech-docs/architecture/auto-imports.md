# 自动导入机制

Nuxt 4 提供三层自动导入：前端 composables/store、服务端 utils/services、共享 shared/utils，需手动导入的只有 `shared/types` 和第三方库。

## 自动导入配置源（nuxt.config.ts）

```typescript
// nuxt.config.ts 关键配置

// 前端自动导入
imports: {
  dirs: ['store'],  // 额外导入 store/ 目录下的所有导出
}

// 服务端自动导入（Nitro）
nitro: {
  imports: {
    dirs: [
      // './server/lib/*',         // 已注释：lib 不自动导入
      './server/services/*/*',     // 所有 services 子模块的所有文件
    ],
  }
}

// 组件自动导入
components: {
  dirs: [{
    path: '~/components',
    ignore: ['**/index.ts', '**/context.ts'],  // 排除 index.ts 和 context.ts
  }],
}

// Nuxt 4 模式
future: {
  compatibilityVersion: 4,  // 启用 shared/ 目录自动导入等新特性
}
```

## 服务端自动导入范围

### 默认自动导入（Nitro 内置）

| 来源 | 自动导入内容 |
|------|------------|
| `server/utils/` | prisma、JwtUtil、logger 等所有导出 |
| H3 框架 | defineEventHandler、getQuery、readBody、getHeader、getRouterParam、getCookie、setCookie 等 |
| Nitro | useRuntimeConfig、useStorage 等 |

### nuxt.config.ts 配置的自动导入

| 配置 | 导入目录 | 导入内容 |
|------|---------|---------|
| `nitro.imports.dirs` | `server/services/*/*` | 所有服务模块的所有导出函数 |

实际导入的服务模块（24 个）：

| 模块 | 路径 | 关键导出示例 |
|------|------|-------------|
| agent | services/agent/ | agentRun.service, agentWorker, agentEventBridge |
| auth | services/auth/ | authToken.service |
| campaign | services/campaign/ | campaign.service, campaign.dao |
| case | services/case/ | case.service, analysis.service, caseMaterial.service |
| dashboard | services/dashboard/ | dashboard.service |
| files | services/files/ | files.service, ossFiles.dao |
| legal | services/legal/ | legalMain.service, vectorStore.service, lawEmbedding.service |
| material | services/material/ | material.service, materialPipeline.service, ocr.service |
| membership | services/membership/ | userMembership.service, benefit.service |
| model | services/model/ | models.service, modelConfig.service, modelProviders.service |
| node | services/node/ | node.service, prompt.service, access.service |
| payment | services/payment/ | payment.service, order.service |
| point | services/point/ | pointConsumption.service, pointRecords.service |
| product | services/product/ | product.service |
| rbac | services/rbac/ | permission.service, cache.service, auditLog.service |
| redemption | services/redemption/ | redemption.service, redemptionCode.admin.service |
| retrieval | services/retrieval/ | hybridSearch.service, semanticSearch.service, rerank.service |
| sms | services/sms/ | smsVerification.service |
| sse | services/sse/ | sse.service (SSE 连接管理) |
| storage | services/storage/ | storage.service |
| system | services/system/ | systemConfig.dao |
| users | services/users/ | users.service, userResponse.service |
| wechat | services/wechat/ | wechat.service |

### shared/ 自动导入（Nuxt 4 特性）

Nuxt 4（compatibilityVersion: 4）自动将 `shared/` 目录的 utils 导出注入前后端：

- `resSuccess` / `resError` — 来自 `shared/utils/apiResponse.ts`
- `logger` — 来自 `shared/utils/logger.ts`
- `uuidv7` — 来自 `shared/utils/uuid.ts`
- 其他 shared/utils 下的工具函数

## 前端自动导入范围

### Vue/Nuxt 内置

| 来源 | 自动导入内容 |
|------|------------|
| Vue | ref、reactive、computed、watch、watchEffect、onMounted、nextTick 等 |
| Vue Router | useRoute、useRouter、navigateTo |
| Nuxt | useFetch、useState、useRuntimeConfig、useCookie、useHead |
| Pinia | defineStore、storeToRefs |

### 目录级自动导入

| 目录 | 导入规则 |
|------|---------|
| `app/composables/` | 所有 `use*.ts` 导出的函数（Nuxt 默认行为） |
| `app/store/` | 所有导出（通过 `imports.dirs: ['store']` 配置） |
| `app/utils/` | 所有导出（Nuxt 默认行为） |

常用 composables（33 个）：

| Composable | 用途 |
|-----------|------|
| useApi | 封装 useFetch，支持 SSR 的 API 请求 |
| useApiFetch | 封装 $fetch，用于事件处理函数中的 API 请求 |
| useAuth | 认证状态管理 |
| useTheme | 主题切换 |
| useColorMode | 颜色模式管理 (light/dark/system) |
| useStreamChat | SSE 流式聊天 |
| useXiaosuoChat | 小索 AI 对话 |
| useCaseChat | 案件对话 |
| useCaseDetail | 案件详情 |
| useCaseCreation | 案件创建 |
| useInitAnalysis | 初始化分析 |
| useFileUploadWorker | 文件上传 (Web Worker) |
| useFileReader | 文件读取 |
| useFileRecognition | 文件识别 |
| useBatchUpload | 批量上传 |
| useMembershipStatus | 会员状态 |
| usePurchaseFlow | 购买流程 |
| useWechatPayment | 微信支付 |
| useLegalSearch | 法律检索 |
| useArticleSearch | 文章搜索 |
| useLegalParser | 法律解析 |
| useFormatters | 格式化工具 |
| useDraggableResize | 可拖拽调整大小 |

常用 stores（9 个）：auth、user、permission、role、file、caseAnalysis、adminMenu、alertDialog、wxSupport。

## 必须手动导入的内容

### shared/types（类型定义）

类型不会被自动导入，必须显式 `import type`：

```typescript
// 正确 - 手动导入类型
import type { UserInfo } from '#shared/types/user'
import type { CaseStatus } from '#shared/types/case'
import type { ApiBaseResponse } from '#shared/utils/apiResponse'
import type { cases } from '~~/generated/prisma/client'

// 错误 - 类型不会自动导入
const user: UserInfo = ...  // TS 报错：找不到 UserInfo
```

### 跨模块服务内部导入

虽然服务模块的导出会被自动导入，但模块内部的相互引用（如 cache.service.ts 被 permission.service.ts 使用）建议显式 import，确保测试环境兼容：

```typescript
// permission.service.ts 内部
import { getUserPermissionCache, setUserPermissionCache } from './cache.service'
import { findUserApiPermissionsDao } from './roleApiPermission.dao'
```

### 第三方库

第三方库始终需要手动导入：

```typescript
import dayjs from 'dayjs'
import { z } from 'zod'
import type { H3Event } from 'h3'
```

## 组件自动导入

### 配置

```typescript
// nuxt.config.ts
components: {
  dirs: [{
    path: '~/components',
    ignore: ['**/index.ts', '**/context.ts'],  // 排除 index.ts 和 context.ts
  }],
}
```

### 命名规则

组件按目录层级自动生成名称：
- `components/ui/Button.vue` → `<Button />`
- `components/case/CaseList.vue` → `<CaseCaseList />`

### 陷阱：index.ts 被排除

`components/**/index.ts` 被 ignore 配置排除，避免与同名 `.vue` 组件冲突。例如 `artifact/index.ts` 和 `artifact/Artifact.vue` 都会解析为相同名称。

## 常见陷阱

1. **同名冲突**：不同服务模块导出同名函数会冲突。服务层方法以 `Service` 结尾、DAO 层以 `DAO/Dao` 结尾，可有效避免。

2. **shared/types 不会自动导入**：这是最常见的错误。所有类型必须 `import type`。

3. **server/lib 不自动导入**：`server/lib/` 目录在 nuxt.config.ts 中被注释掉（`// './server/lib/*'`），需要手动 import。

4. **useApiFetch vs useApi**：
   - `useApi` — 封装 `useFetch`，用于 SSR 和组件 setup
   - `useApiFetch` — 封装 `$fetch`，用于事件处理函数（onClick 等）
   - 两者都自动提取 data 字段，不要 `response?.data?.xxx`

5. **logger 来源**：logger 来自 `shared/utils/logger.ts`，前后端共用，通过 Nuxt 4 的 shared 自动导入机制注入。

6. **Prisma Client 路径**：Prisma 生成的客户端在 `generated/prisma/client`，类型导入用 `~~/generated/prisma/client`。
