# Service + DAO 分层模式

LexSeek 服务端采用 Service + DAO 两层架构，将业务逻辑与数据访问解耦，API handler 只做参数校验和响应包装。

## 调用链路

```
API Handler (server/api/v1/*)
    │  参数校验（zod）、认证、响应包装
    ▼
Service Layer (server/services/*/*.service.ts)
    │  业务逻辑：权限校验、状态流转、事务编排、跨模块调用
    ▼
DAO Layer (server/services/*/*.dao.ts)
    │  数据访问：Prisma CRUD、查询构建、分页排序
    ▼
Prisma Client → PostgreSQL
```

## 命名规范

### 文件命名

| 层 | 文件名模式 | 示例 |
|---|---|---|
| Service | `模块名.service.ts` | `case.service.ts` |
| DAO | `模块名.dao.ts` | `case.dao.ts` |

### 函数命名

| 层 | 后缀 | 命名模式 | 示例 |
|---|---|---|---|
| Service | `Service` | `动词 + 名词 + Service` | `createCaseService`、`validateCaseAccessService` |
| DAO | `Dao` | `动词 + 名词 + Dao` | `createCaseDao`、`findCaseByIdDao` |

DAO 层的动词通常与 Prisma 操作对应：

| Prisma 操作 | DAO 动词 | 示例 |
|---|---|---|
| `create` | `create` | `createCaseDao` |
| `findFirst` / `findUnique` | `find` | `findCaseByIdDao` |
| `findMany` | `findMany` | `findManyCasesDao` |
| `update` | `update` | `updateCaseDao` |
| `delete` / 软删除 | `softDelete` | `softDeleteCaseDao` |
| `count` | `check` | `checkCaseOwnershipDao` |

## 职责划分

### DAO 层职责

DAO 层是 Prisma 的薄包装，**禁止**包含任何业务逻辑：

```typescript
// server/services/case/case.dao.ts

/** 创建案件 */
export const createCaseDao = async (
    data: CreateCaseInput,
    tx?: Prisma.TransactionClient  // 支持事务注入
): Promise<cases> => {
    const client = tx || prisma        // 事务客户端降级到全局 prisma
    try {
        return await client.cases.create({
            data: {
                title: data.title ?? '',
                content: data.content,
                userId: data.userId,
                caseTypeId: data.caseTypeId,
                // ...
            },
        })
    } catch (error) {
        logger.error('创建案件失败：', error)
        throw error                    // 错误上抛，不做业务处理
    }
}
```

**DAO 层关键规则：**

1. 每个方法对应一个 Prisma 操作
2. 支持可选的 `tx?: Prisma.TransactionClient` 参数，允许 Service 层编排事务
3. 错误只做日志记录后上抛，不做业务级别的错误转换
4. 类型定义（如 `CaseWithRelations`）放在 DAO 文件中导出

### Service 层职责

Service 层封装业务逻辑，协调多个 DAO 和跨模块调用：

```typescript
// server/services/case/case.service.ts

export const createCaseService = async (
    data: CreateCaseInput
): Promise<CreateCaseResult> => {
    // 1. 业务验证
    const caseType = await getCaseTypeByIdService(data.caseTypeId)
    if (!caseType) throw new Error('案件类型不存在')
    if (caseType.status !== 1) throw new Error('案件类型已禁用')

    // 2. 业务逻辑（默认值、ID 生成）
    const title = data.title || `待分析的${caseType.name}`
    const sessionId = uuidv7()

    // 3. 事务编排（跨 DAO 的原子操作）
    const result = await prisma.$transaction(async (tx) => {
        const caseRecord = await createCaseDao({ ...data, title }, tx as any)
        const session = await createSessionDao({
            sessionId, caseId: caseRecord.id,
            status: SessionStatus.IN_PROGRESS,
        }, tx as any)
        if (materials.length > 0) {
            await batchAddCaseMaterialsService(caseRecord.id, data.userId, materials, tx as any)
        }
        return { caseRecord, session }
    })

    // 4. 异步副作用（fire-and-forget）
    vectorizePromise.catch(error => { logger.error('向量化失败', { error }) })

    return { caseId: result.caseRecord.id, sessionId, ... }
}
```

**Service 层关键规则：**

1. 业务验证在 Service 层完成（权限、状态、前置条件）
2. 跨表事务使用 `prisma.$transaction()` 编排，将 `tx` 传入各 DAO
3. 异步副作用（向量化、长期记忆写入）使用 fire-and-forget 模式
4. 跨模块调用通过导入其他 Service（不跨模块调用 DAO）

## 完整调用链示例

以 `POST /api/v1/cases/create` 为例：

### API Handler

```typescript
// server/api/v1/cases/create.post.ts
export default defineEventHandler(async (event) => {
    // 1. 认证
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    // 2. 参数校验（zod schema）
    const body = await readBody(event)
    const result = createCaseSchema.safeParse(body)
    if (!result.success) return resError(event, 400, parseErrorMessage(result.error))

    // 3. 调用 Service
    try {
        const createResult = await createCaseService({ ...result.data, userId: user.id })
        return resSuccess(event, '创建案件成功', { caseId: createResult.caseId, ... })
    } catch (error: any) {
        return resError(event, 500, error.message || '创建案件失败')
    }
})
```

### 调用流程

```
create.post.ts
  ├── zod.safeParse()          → 参数校验
  └── createCaseService()      → 业务逻辑
        ├── getCaseTypeByIdService() → 跨模块验证
        └── prisma.$transaction()
              ├── createCaseDao()          → 写入 cases 表
              ├── createSessionDao()       → 写入 caseSessions 表
              └── batchAddCaseMaterialsService() → 写入材料记录
```

## 自动导入机制

Nuxt Server 的自动导入覆盖 `server/services` 下的所有导出函数。以下对象无需手动 import：

| 对象 | 来源 |
|---|---|
| `prisma` | `server/utils/prisma` |
| `logger` | `server/utils/logger` |
| `resSuccess` / `resError` | `server/utils/response` |
| `defineEventHandler` 等 | H3 框架 |
| 所有 Service 函数 | `server/services/*/*` |

**注意**：类型（`type`、`interface`、`enum`）不会被自动导入，必须使用 `import type` 从 `#shared/types/*` 手动引入。

## 事务模式

### 单表操作

直接调用 DAO，不需要事务：

```typescript
export const updateCaseStatusService = async (caseId: number, status: CaseStatus) => {
    const existing = await findCaseByIdDao(caseId)
    if (!existing) throw new Error('案件不存在')
    return await updateCaseDao(caseId, { status })
}
```

### 跨表事务

使用 `prisma.$transaction()` + DAO 的 `tx` 参数：

```typescript
export const completeCaseAnalysisService = async (caseId: number, sessionId: string) => {
    await prisma.$transaction(async (tx) => {
        await updateCaseDao(caseId, { status: CaseStatus.COMPLETED }, tx as any)
        await updateSessionStatusDao(sessionId, SessionStatus.COMPLETED, tx as any)
    })
}
```

### 软删除

案件使用 `deletedAt` 字段实现软删除，查询时过滤 `deletedAt: null`：

```typescript
export const softDeleteCaseDao = async (id: number, tx?: Prisma.TransactionClient) => {
    const client = tx || prisma
    const now = new Date()
    await Promise.all([
        client.cases.update({ where: { id }, data: { deletedAt: now } }),
        client.caseSessions.updateMany({
            where: { caseId: id, deletedAt: null },
            data: { deletedAt: now },
        }),
    ])
}
```

## 模块文件组织

```
server/services/case/
├── case.service.ts         # 案件业务逻辑
├── case.dao.ts             # 案件数据访问
├── caseType.service.ts     # 案件类型服务
├── caseMaterial.service.ts # 案件材料服务
├── caseExtraction.service.ts # AI 提取服务
├── analysis.service.ts     # 分析结果服务
├── analysis.dao.ts         # 分析结果数据访问
└── initAnalysis.service.ts # 初始化分析服务
```

每个业务模块遵循同样的 Service + DAO 拆分规则。Service 之间可以互相调用，但 DAO 之间不产生直接依赖。

## 相关文档

- [tech-docs/patterns/adapter-factory.md](./adapter-factory.md) - 适配器工厂模式（server/lib 层架构）
- [tech-docs/patterns/workflow-middleware.md](./workflow-middleware.md) - 工作流中间件（与 Service 层的交互）
