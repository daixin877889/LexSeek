# 新模块开发清单

基于 LexSeek 项目现有模式总结的标准化开发流程，覆盖后端服务、前端页面、权限配置和测试四个维度。

## 后端开发清单

### 1. 定义数据模型

- [ ] 在 `prisma/models/` 下创建 `<module>.prisma` 文件
- [ ] 定义表结构（包含 `createdAt`、`updatedAt`、`deletedAt` 标准字段）
- [ ] **正式变更必须**走 `bun run prisma:migrate --name <描述>`（=`prisma migrate dev`），自动生成迁移文件并随 git 提交
- [ ] **禁止**：手写 `prisma/migrations/<xxx>/migration.sql`、用 `prisma db push` 当作正式变更、跳开 schema 直接 `psql` 改表结构（详见 [.claude/rules/database.md](../../../.claude/rules/database.md)）
- [ ] 测试数据库会在每次跑 `bun run test` 时由 `tests/_infra/global-setup.ts` 用 `ls_new_testing` 模板复制出 worker DB；如需手动同步，跑 `DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing' bun run prisma:migrate deploy`

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

### 6. 配置公开 API / 注册管理端权限

- [ ] **不要**手写 SQL 到 `seedData.sql` 或 migration 文件添加 `api_permissions` 记录
- [ ] `bun dev` 启动后进管理后台 → "API 权限" → 点 **扫描** → 命中新接口（路径已自动 `[id] → :id`、method 大写）
- [ ] "路由" 页同样有 **扫描** 按钮，挂菜单项
- [ ] "角色" 页给目标角色（admin / editor / operator）勾选权限；如属公开 API（无需登录）→ 在 API 权限编辑里勾"公开"
- [ ] 用户端 API（`/api/v1/<module>/**`）严格 owner-only / viewer 过滤；管理端（`/api/v1/admin/<module>/**`）由中间件保护，handler 内无需重复鉴权（详见 [.claude/rules/api.md](../../../.claude/rules/api.md)）

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

- [ ] **不要写 seed / migration**：通过管理后台 "API 权限" → 扫描 → 角色授权流程注册新接口（详见上一节"6. 配置公开 API / 注册管理端权限"）
- [ ] 用户端接口（`/api/v1/<module>/**`）：handler 内必须做 owner-only / viewer 维度过滤；不允许 `checkIsSuperAdmin` 旁路
- [ ] 管理端接口（`/api/v1/admin/<module>/**`）：靠 `server/middleware/03.permission.ts` 拦截；handler 内不再做归属过滤
- [ ] 同一资源两端都要操作时**必须分别实现两套接口**，前端按身份调用对应那一套
- [ ] `pathMatcher` 已在 `02.auth` / `03.permission` 自动用于公开 API 与权限路径匹配（支持 `:param` / `*` / `**`）

### RBAC 相关服务

权限模块位于 `server/services/rbac/`：

| 文件 | 职责 |
|------|------|
| `permission.service.ts` | 权限检查业务逻辑 |
| `guard.service.ts` | 用户端业务守卫（业务身份匹配 / owner 检查） |
| `cache.service.ts` | 权限缓存管理（5 分钟 TTL，角色变更自动失效） |
| `apiPermission.dao.ts` | API 权限数据访问（含 publicApi 列表） |
| `roleApiPermission.dao.ts` | 角色-API 关联 |
| `roles.dao.ts` | 角色数据访问 |
| `userRoles.dao.ts` | 用户-角色关联 |
| `auditLog.service.ts` / `auditLog.dao.ts` | 权限变更 / 关键操作审计日志 |
| `pathMatcher.ts` | 路径匹配工具（`:param` / `*` / `**`） |

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
- [ ] 清理函数按外键依赖的反序删除（worker 级 DB 隔离已自动 DROP 每个 worker 库，无需注册全局清理）

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
