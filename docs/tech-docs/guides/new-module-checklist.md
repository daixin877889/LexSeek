# 新模块开发清单

基于 LexSeek 项目现有模式总结的标准化开发流程，覆盖后端服务、前端页面、权限配置和测试四个维度。

## 后端开发清单

### 1. 定义数据模型

- [ ] 在 `prisma/models/` 下创建 `<module>.prisma` 文件
- [ ] 定义表结构（包含 `createdAt`、`updatedAt`、`deletedAt` 标准字段）
- [ ] 运行 `bun run prisma:push` 同步到开发数据库
- [ ] 运行 `bun run prisma:generate` 生成 Prisma Client 类型
- [ ] 同步测试数据库：`DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing' bun run prisma:push --accept-data-loss`

### 2. 创建共享类型

- [ ] 在 `shared/types/` 下创建或更新对应类型文件
- [ ] 定义业务枚举（数字枚举与数据库一致）
- [ ] 定义枚举文本映射 `Record<Enum, string>`
- [ ] 定义 API 请求/响应类型
- [ ] 基于 Prisma 类型派生 `CreateInput`、`UpdateInput` 等

```typescript
// shared/types/<module>.ts
import type { <table> } from '~~/generated/prisma/client'

export enum ModuleStatus {
    DISABLED = 0,
    ENABLED = 1,
}

export type CreateModuleInput = Omit<<table>, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
```

### 3. 创建 DAO 层

- [ ] 在 `server/services/<module>/` 下创建 `<module>.dao.ts`
- [ ] 实现标准 CRUD 操作，方法名以 `Dao` 后缀命名
- [ ] 所有查询过滤 `deletedAt: null`
- [ ] 所有方法支持可选事务参数 `tx?: Prisma.TransactionClient`
- [ ] 异常通过 `logger.error` 记录后重新抛出

```typescript
// server/services/<module>/<module>.dao.ts
import type { Prisma } from '#shared/types/prisma'

export const findModuleByIdDao = async (id: number, tx?: Prisma.TransactionClient) => {
    try {
        return await (tx || prisma).<table>.findUnique({
            where: { id, deletedAt: null },
        })
    } catch (error) {
        logger.error('查询失败：', error)
        throw error
    }
}
```

### 4. 创建 Service 层

- [ ] 在 `server/services/<module>/` 下创建 `<module>.service.ts`
- [ ] 方法名以 `Service` 后缀命名
- [ ] 封装业务逻辑（参数验证、权限检查、事务编排）
- [ ] 跨表操作使用 `prisma.$transaction`

### 5. 创建 API 路由

- [ ] 在 `server/api/v1/<module>/` 下创建路由文件
- [ ] 文件命名格式：`<action>.<method>.ts`（如 `list.get.ts`、`create.post.ts`）
- [ ] 动态参数放在文件名末尾：`[id].get.ts`
- [ ] 使用 zod 验证请求参数
- [ ] 使用 `resSuccess` / `resError` 统一响应格式

```typescript
// server/api/v1/<module>/create.post.ts
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const body = await readBody(event)
    const result = schema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, result.error.issues[0].message)
    }

    const data = await createModuleService(result.data)
    return resSuccess(event, '创建成功', data)
})
```

### 6. 配置公开 API（如需要）

- [ ] 在数据库 `api_permissions` 表中添加记录，标记为公开 API
- [ ] 或在管理后台的 API 权限管理页面配置

## 前端开发清单

### 1. 创建页面

- [ ] 在 `app/pages/` 下创建页面 `.vue` 文件
- [ ] 定义 `definePageMeta`（layout、title、icon）
- [ ] 如需管理后台页面，放在 `app/pages/admin/` 下

### 2. 创建组件

- [ ] 在 `app/components/<module>/` 下创建业务组件
- [ ] 遵循单文件 500 行上限
- [ ] 使用 shadcn-vue 基础组件构建 UI
- [ ] 支持深色模式（Tailwind v4 dark 变体）

### 3. 创建 Composable（如需要）

- [ ] 在 `app/composables/` 下创建 `use<Module>.ts`
- [ ] 提取可复用的业务逻辑
- [ ] 自动导入，无需手动 import

### 4. 创建 Store（如需要）

- [ ] 在 `app/store/` 下创建 `<module>.ts`
- [ ] 使用 Pinia 定义 store
- [ ] 自动导入，无需手动 import

### 5. 数据请求

- [ ] SSR 场景使用 `useApi`
- [ ] 客户端场景使用 `useApiFetch`
- [ ] 注意 `useApiFetch` 自动提取 `data` 字段

## 权限配置清单

### RBAC 权限

- [ ] 在数据库 `api_permissions` 表中注册新模块的 API 路径和方法
- [ ] 配置角色-API 权限关联（`role_api_permissions` 表）
- [ ] 标记公开 API（无需认证的接口）
- [ ] 权限中间件（`03.permission.ts`）会自动检查

### RBAC 相关服务

权限模块位于 `server/services/rbac/`：

| 文件 | 职责 |
|------|------|
| `permission.service.ts` | 权限检查业务逻辑 |
| `cache.service.ts` | 权限缓存管理 |
| `apiPermission.dao.ts` | API 权限数据访问 |
| `roleApiPermission.dao.ts` | 角色-API 关联 |
| `roles.dao.ts` | 角色数据访问 |
| `userRoles.dao.ts` | 用户-角色关联 |
| `auditLog.service.ts` / `auditLog.dao.ts` | 审计日志 |
| `pathMatcher.ts` | 路径匹配工具 |

## 测试开发清单

### 1. 创建测试基础设施

- [ ] 在 `tests/server/<module>/` 下创建目录
- [ ] 创建 `test-db-helper.ts`：测试数据库连接、测试数据创建和清理函数
- [ ] 创建 `test-setup.ts`：模拟全局变量（prisma、logger 等 Nuxt 自动导入）
- [ ] 创建 `test-generators.ts`（如使用属性测试）：fast-check 数据生成器

### 2. 编写测试

- [ ] 文件命名：`<module>.<feature>.test.ts`
- [ ] 测试描述使用中文
- [ ] 真实数据库操作（非 mock）
- [ ] 每个 `describe` 块的 `afterEach` / `afterAll` 中清理测试数据
- [ ] 属性测试使用 deterministic seed（`{ numRuns: 100, seed: 42 }`）

### 3. 测试数据管理

- [ ] 使用特定前缀标记测试数据（如 `测试_`、`TEST_`、`199` 手机号前缀）
- [ ] 创建 `TestIds` 追踪对象，记录所有创建的测试记录 ID
- [ ] 清理函数按外键依赖的反序删除
- [ ] 在 `global-teardown.ts` 中添加新模块的清理 SQL（如需要）

### 4. 运行测试

```bash
# 单模块测试
npx vitest run tests/server/<module> --reporter=verbose

# 全量测试
bun run test
```

## 文件命名速查

| 类型 | 命名格式 | 示例 |
|------|---------|------|
| Prisma 模型 | `<module>.prisma` | `payment.prisma` |
| 共享类型 | `<module>.ts` | `payment.ts` |
| DAO 层 | `<module>.dao.ts` | `payment.dao.ts` |
| Service 层 | `<module>.service.ts` | `payment.service.ts` |
| API 路由 | `<action>.<method>.ts` | `create.post.ts` |
| 组件 | `PascalCase.vue` | `PaymentForm.vue` |
| Composable | `use<Module>.ts` | `usePayment.ts` |
| Store | `<module>.ts` | `payment.ts` |
| 测试 | `<module>.<feature>.test.ts` | `payment.order.test.ts` |

## 完成检查

- [ ] 后端：Service / DAO / API 路由均已创建
- [ ] 共享类型已定义并从 `#shared/types/` 导入
- [ ] 前端：页面 / 组件 / composable 均已创建
- [ ] RBAC 权限已配置
- [ ] 测试覆盖率达到 80%+
- [ ] 全量测试通过（`bun run test`）
- [ ] 代码使用 `npx nuxi typecheck` 通过类型检查
