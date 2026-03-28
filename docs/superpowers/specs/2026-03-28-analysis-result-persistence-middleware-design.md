# 分析结果持久化中间件设计

## 概述

为 `caseAnalysisAgent` 新增 `analysisResultPersistence` 中间件，在 `beforeAgent` / `afterAgent` 钩子中自动管理分析结果的生命周期（创建→完成/失败），并引入 `isActive` 字段支持版本激活管理。

## 目标

1. 统一分析结果持久化逻辑，替代 `initAnalysis.executor` 中手动的 `start/complete` 调用
2. 在 `caseAnalyses` 表新增 `isActive` 字段，同一 `(caseId, nodeId)` 只允许一条激活版本
3. 提供伴生函数处理 Agent 异常时的失败标记

## 数据库变更

### caseAnalyses 表新增字段

```prisma
/// 是否为激活版本（同一 caseId+nodeId 只有一条为 true）
isActive   Boolean   @default(false) @map("is_active")
```

新增索引：

```prisma
@@index([caseId, nodeId, isActive], map: "idx_case_analyses_active_version")
```

### 数据库层唯一约束

通过 Prisma 迁移 SQL 添加 PostgreSQL 条件唯一索引，从数据库层面保证约束：

```sql
CREATE UNIQUE INDEX idx_case_analyses_unique_active
ON case_analyses (case_id, node_id)
WHERE is_active = true AND deleted_at IS NULL;
```

### 现有数据迁移

新增 `isActive` 字段后，需要为现有已完成的分析记录初始化激活状态：

```sql
UPDATE case_analyses ca SET is_active = true
FROM (
  SELECT DISTINCT ON (case_id, node_id) id
  FROM case_analyses
  WHERE status = 2 AND deleted_at IS NULL
  ORDER BY case_id, node_id, version DESC
) latest
WHERE ca.id = latest.id;
```

### 激活版本约束

- 同一 `(caseId, nodeId, deletedAt IS NULL)` 中最多一条 `isActive = true`
- 通过事务 + 条件唯一索引双重保证
- 仅 `status = COMPLETED` 的记录可以被激活

## 中间件设计

### 文件位置

```
server/services/workflow/middleware/analysisResultPersistence.middleware.ts
```

### 参数

```typescript
interface AnalysisResultPersistenceOptions {
  /** Agent 名称（对应 nodes 表 name 字段） */
  agentName: string
  /** 案件 ID */
  caseId: number
  /** 会话 ID */
  sessionId: string
}
```

### 状态 Schema

```typescript
stateSchema: z.object({
  /** 当前分析记录 ID（beforeAgent 创建后写入） */
  _analysisRecordId: z.number().optional(),
})
```

> **多中间件 stateSchema 合并**：langchain 的 createMiddleware 会将多个中间件的 stateSchema 合并（union），不同中间件的私有字段（`_` 前缀）不会冲突。已验证 `pointConsumptionMiddleware` 的 `_totalTokensConsumed` 等字段与本中间件的 `_analysisRecordId` 可以共存。

### beforeAgent 钩子

```
1. 通过 agentName 查找节点 → getNodeByNameService(agentName) → 获取 nodeId
2. 事务内执行（防止并发版本号冲突）：
   a. getNextVersionDao(caseId, nodeId, tx) → 计算版本号
   b. createAnalysisDao({
        caseId, sessionId, nodeId,
        analysisType: agentName,
        version: nextVersion,
        status: IN_PROGRESS,
        isActive: false,  // 进行中不激活
      }, tx)
3. 返回 { _analysisRecordId: record.id }
```

### afterAgent 钩子

```
1. 从 state._analysisRecordId 获取记录 ID（若无则跳过）
2. 提取分析结果：
   - 遍历 state.messages 从后往前找最后一条 AIMessage
   - 提取文本内容（处理 string 和 ContentPart[] 两种格式）
3. 事务内执行：
   a. 将同 (caseId, nodeId, deletedAt=null, isActive=true) 的旧记录设为 isActive=false
   b. 更新当前记录：
      - status = COMPLETED
      - analysisResult = 提取的文本
      - isActive = true
4. 记录日志
```

### 中间件执行顺序

> **重要**：langchain 中间件的 `beforeAgent` 按数组正序执行，`afterAgent` 也按正序执行。因此 `analysisResultPersistence` 应放在 middleware 数组**末位**，以确保：
> - `beforeAgent` 最后执行（其他中间件的预检先完成）
> - `afterAgent` 最后执行（所有其他中间件的后处理先完成后再保存结果）

### 错误处理

afterAgent 内部用 try-catch 包裹，异常时：
- 记录错误日志
- **不阻塞** Agent 正常返回（分析结果仍在 messages 中）

## 伴生错误处理函数

```typescript
/**
 * 标记指定分析记录为失败
 * 用于 Agent 异常时在 catch 块中调用
 *
 * @param analysisId 分析记录 ID（从闭包变量获取，非 state）
 */
export async function markAnalysisFailedById(
  analysisId: number
): Promise<void>
```

实现逻辑：
1. 调用 `failAnalysisService(analysisId)` 标记为 FAILED
2. `isActive` 保持 `false`（IN_PROGRESS 记录本就是 false）

### 调用方式

在 `createModuleNode` 工厂函数中，通过闭包变量保存记录 ID：

```typescript
// createModuleNode 内部
let analysisRecordId: number | undefined

// Agent 创建后、invoke 前，通过 beforeAgent 钩子写入 analysisRecordId
// 或者直接在工厂函数内调用 startAnalysisService 获取 ID（中间件内部处理）

try {
  const result = await agent.invoke(...)
  // afterAgent 已自动保存结果
} catch (error) {
  // 方案：通过 sessionId + nodeId + status=IN_PROGRESS 查找记录
  const inProgressRecord = await findAnalysisBySessionAndNodeDao(
    sessionId, nodeId, AnalysisStatus.IN_PROGRESS
  )
  if (inProgressRecord) {
    await markAnalysisFailedById(inProgressRecord.id)
  }
}
```

> **为何不从 state 获取**：Agent 异常时 checkpointer 中的 state 可能未持久化 `_analysisRecordId`。通过 `(sessionId, nodeId, status=IN_PROGRESS)` 查询是最可靠的方式。

### findAnalysisBySessionAndNodeDao 改造

现有签名：`findAnalysisBySessionAndNodeDao(sessionId, nodeId)` 需要增加可选的 `status` 过滤参数：

```typescript
export const findAnalysisBySessionAndNodeDao = async (
  sessionId: string,
  nodeId: number,
  status?: number  // 新增：可选状态过滤
): Promise<caseAnalyses | null>
```

## DAO 层变更

### analysis.dao.ts 新增/修改

1. **CreateAnalysisInput** 增加 `isActive?: boolean` 字段
2. **UpdateAnalysisInput** 增加 `isActive?: boolean` 字段
3. **createAnalysisDao** 支持 `isActive` 字段
4. **updateAnalysisDao** 支持 `isActive` 字段
5. **getNextVersionDao** 增加可选事务参数 `tx`
6. **findAnalysisBySessionAndNodeDao** 增加可选 `status` 参数

7. 新增 **deactivateVersionsDao**：

```typescript
/**
 * 将指定 (caseId, nodeId) 的所有激活版本设为未激活
 * WHERE: caseId, nodeId, isActive=true, deletedAt IS NULL
 */
export async function deactivateVersionsDao(
  caseId: number,
  nodeId: number,
  tx?: Prisma.TransactionClient
): Promise<void>
```

8. 新增 **activateVersionDao**：

```typescript
/**
 * 激活指定分析记录
 * 事务内：先 deactivate 旧版本 → 再 activate 新记录
 */
export async function activateVersionDao(
  analysisId: number,
  caseId: number,
  nodeId: number,
  tx?: Prisma.TransactionClient
): Promise<void>
```

## Service 层变更

### analysis.service.ts 新增

```typescript
/** 切换激活版本（供 API 调用） */
export async function switchActiveVersionService(
  analysisId: number
): Promise<caseAnalyses>
```

逻辑：
1. 验证记录存在且 status = COMPLETED
2. 事务内：deactivate 旧版本 → activate 新版本
3. 返回更新后的记录

### analysis.service.ts 修改

**deleteAnalysisService** 增加激活转移逻辑：
- 如果被删除的记录 `isActive = true`，自动将同 `(caseId, nodeId)` 的次新 COMPLETED 版本激活
- 若无其他 COMPLETED 版本，则不激活任何记录

## 现有查询迁移

引入 `isActive` 后，以下函数需要适配：

### initAnalysis.service.ts

**loadCompletedResultsService**：
- 当前：`orderBy: [{ version: 'desc' }]` + `distinct` 取最新完成版本
- 改为：优先按 `isActive = true` 筛选，fallback 到 `version desc`（兼容过渡期）

### analysis.dao.ts

**findLatestAnalysisVersionDao**：
- 保持现有行为（按 version desc），但新增注释说明此函数不考虑 isActive
- 新增 **findActiveAnalysisVersionDao**：专门按 `isActive = true` 查询

### analysis.service.ts

**getLatestAnalysisVersionService**：
- 保持现有行为
- 新增 **getActiveAnalysisVersionService**：按 isActive 查询激活版本

## caseAnalysisAgent 集成

### agents/caseAnalysis.ts 变更

在 middleware 数组**末位**添加新中间件：

```typescript
middleware: [
  pointConsumptionMiddleware(userId!, 'case_analysis_token'),
  caseProcessMaterialMiddleware(userId!, caseId!),
  caseMaterialContextMiddleware(userId!, caseId!),
  todoListMiddleware(),
  summarizationMiddleware({ model, trigger: [{ tokens: 100000 }] }),
  // 放末位：确保 afterAgent 在所有其他中间件之后执行
  analysisResultPersistenceMiddleware({
    agentName,
    caseId: caseId!,
    sessionId,
  }),
]
```

## initAnalysis.executor 迁移

### createModuleNode 工厂函数迁移

当前 `createModuleNode` 内部直接 `createAgent`，7 个模块节点（summary、chronicle、claim、trend、cause、defense、evidence）各自独立创建 Agent。迁移方式：

**每个模块节点的 createAgent 调用都需要：**

1. 在 middleware 数组中添加 `analysisResultPersistenceMiddleware`，传入 `config.moduleName` 作为 agentName
2. 移除手动的 `startAnalysisService`（第 135-141 行）和 `completeAnalysisService`（第 191 行）调用
3. 在 `agent.invoke` 外层添加 try-catch，失败时通过查询 IN_PROGRESS 记录标记失败

### 具体代码变更

```typescript
function createModuleNode(config: ModuleNodeConfig) {
  return async (state: InitAnalysisState) => {
    // ... 节点配置加载 ...

    const agent = createAgent({
      model,
      systemPrompt,
      checkpointer,
      tools,
      store,
      middleware: [
        pointConsumptionMiddleware(userId, 'case_analysis_token'),
        caseMaterialContextMiddleware(userId, caseId),
        summarizationMiddleware({ model, trigger: [{ tokens: 100000 }] }),
        // 中间件自动处理 start/complete
        analysisResultPersistenceMiddleware({
          agentName: config.moduleName,
          caseId,
          sessionId,
        }),
      ],
    })

    try {
      const result = await agent.invoke(...)
      // afterAgent 已自动保存结果和管理 isActive
      const resultText = extractResultText(result)
      return { messages: result.messages, result: { [config.moduleName]: resultText }, ... }
    } catch (error) {
      // 查找 IN_PROGRESS 记录并标记失败
      const nodeInfo = await getNodeByNameService(config.moduleName)
      if (nodeInfo) {
        const record = await findAnalysisBySessionAndNodeDao(
          sessionId, nodeInfo.id, AnalysisStatus.IN_PROGRESS
        )
        if (record) await markAnalysisFailedById(record.id)
      }
      // 返回错误结果
      return { result: { [config.moduleName]: `[错误] ${error.message}` }, ... }
    }
  }
}
```

### 删除的代码

- 移除 `import { startAnalysisService, completeAnalysisService }` 导入
- 移除 `createModuleNode` 内的 `startAnalysisService` 调用（第 135-141 行）
- 移除 `createModuleNode` 内的 `completeAnalysisService` 调用（第 191 行）

## 中间件注册

### middleware/index.ts

```typescript
export * from './analysisResultPersistence.middleware'
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `prisma/models/case.prisma` | 修改 | caseAnalyses 新增 isActive 字段、索引、条件唯一索引 |
| `prisma/migrations/xxx` | 新增 | 数据库迁移（含数据初始化 SQL） |
| `server/services/workflow/middleware/analysisResultPersistence.middleware.ts` | 新增 | 核心中间件 + 伴生函数 |
| `server/services/workflow/middleware/index.ts` | 修改 | 导出新中间件 |
| `server/services/case/analysis.dao.ts` | 修改 | 新增 deactivateVersionsDao / activateVersionDao / findActiveAnalysisVersionDao；修改 createAnalysisDao / updateAnalysisDao / getNextVersionDao / findAnalysisBySessionAndNodeDao |
| `server/services/case/analysis.service.ts` | 修改 | 新增 switchActiveVersionService / getActiveAnalysisVersionService；修改 deleteAnalysisService（激活转移） |
| `server/services/case/initAnalysis.service.ts` | 修改 | loadCompletedResultsService 适配 isActive |
| `server/services/workflow/agents/caseAnalysis.ts` | 修改 | 添加中间件 |
| `server/services/workflow/initAnalysis.executor.ts` | 修改 | 迁移为使用中间件 + 错误处理，删除手动 start/complete 调用 |

## 测试计划

- [ ] 中间件单元测试：beforeAgent 创建记录、afterAgent 保存结果和激活版本
- [ ] isActive 约束测试：同 (caseId, nodeId) 只有一条 isActive=true
- [ ] 条件唯一索引测试：并发写入时数据库层面拒绝重复激活
- [ ] 失败处理测试：Agent 异常时通过查询 IN_PROGRESS 记录正确标记 FAILED
- [ ] 版本递增测试：多次分析同一模块版本号递增（事务内执行防竞态）
- [ ] 集成测试：通过 caseAnalysisAgent 调用验证端到端流程
- [ ] switchActiveVersionService 测试：手动切换激活版本
- [ ] deleteAnalysisService 测试：删除激活版本后自动转移激活状态
- [ ] loadCompletedResultsService 测试：验证优先使用 isActive 筛选
- [ ] 现有数据迁移测试：验证迁移 SQL 正确设置 isActive
