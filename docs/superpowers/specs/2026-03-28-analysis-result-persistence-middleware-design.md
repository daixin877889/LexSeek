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

### 激活版本约束

- 同一 `(caseId, nodeId, deletedAt IS NULL)` 中最多一条 `isActive = true`
- 通过事务保证：先将旧版本 `isActive = false`，再将新版本 `isActive = true`
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

### beforeAgent 钩子

```
1. 通过 agentName 查找节点 → getNodeByNameService(agentName) → 获取 nodeId
2. 计算版本号 → getNextVersionDao(caseId, nodeId)
3. 创建 IN_PROGRESS 分析记录 → createAnalysisDao({
     caseId, sessionId, nodeId,
     analysisType: agentName,
     version: nextVersion,
     status: IN_PROGRESS,
     isActive: false,  // 进行中不激活
   })
4. 返回 { _analysisRecordId: record.id }
```

### afterAgent 钩子

```
1. 从 state._analysisRecordId 获取记录 ID（若无则跳过）
2. 提取分析结果：
   - 遍历 state.messages 从后往前找最后一条 AIMessage
   - 提取文本内容（处理 string 和 ContentPart[] 两种格式）
3. 事务内执行：
   a. 将同 (caseId, nodeId, deletedAt=null) 的旧 isActive 记录设为 false
   b. 更新当前记录：
      - status = COMPLETED
      - analysisResult = 提取的文本
      - isActive = true
4. 记录日志
```

### 错误处理

afterAgent 内部用 try-catch 包裹，异常时：
- 记录错误日志
- **不阻塞** Agent 正常返回（分析结果仍在 messages 中）

## 伴生错误处理函数

```typescript
/**
 * 从中间件 state 中提取 analysisRecordId，标记为 FAILED
 * 用于 Agent 异常时在 catch 块中调用
 */
export async function markAnalysisFailedFromState(
  state: { _analysisRecordId?: number }
): Promise<void>
```

实现逻辑：
1. 读取 `state._analysisRecordId`
2. 若存在，调用 `failAnalysisService(id)` 标记为 FAILED
3. 确保 `isActive` 保持 `false`（IN_PROGRESS 记录本就是 false）

## DAO 层变更

### analysis.dao.ts 新增/修改

1. **createAnalysisDao** 增加 `isActive` 字段支持
2. **updateAnalysisDao** 增加 `isActive` 字段支持
3. 新增 **deactivateVersionsDao**：

```typescript
/** 将指定 (caseId, nodeId) 的所有激活版本设为未激活 */
export async function deactivateVersionsDao(
  caseId: number,
  nodeId: number,
  tx?: Prisma.TransactionClient
): Promise<void>
```

4. 新增 **activateVersionDao**：

```typescript
/** 激活指定分析记录（事务内：先取消旧激活，再激活新记录） */
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

## caseAnalysisAgent 集成

### agents/caseAnalysis.ts 变更

在 middleware 数组中添加新中间件：

```typescript
middleware: [
  analysisResultPersistenceMiddleware({
    agentName,
    caseId: caseId!,
    sessionId,
  }),
  pointConsumptionMiddleware(userId!, 'case_analysis_token'),
  caseProcessMaterialMiddleware(userId!, caseId!),
  caseMaterialContextMiddleware(userId!, caseId!),
  // ...
]
```

注意：`analysisResultPersistence` 放在首位，确保 beforeAgent 最先执行（创建记录），afterAgent 最后执行（保存结果）。

## initAnalysis.executor 迁移

### 删除

- 移除 `startAnalysisService` / `completeAnalysisService` 的手动调用
- 移除 `import { startAnalysisService, completeAnalysisService }` 导入

### 新增

- 在 `createModuleNode` 中 `agent.invoke` 外层添加 try-catch
- catch 中调用 `markAnalysisFailedFromState(state)` 标记失败
- 中间件已通过 `caseAnalysisAgent` 自动挂载（若 initAnalysis 使用 caseAnalysisAgent）
- 若 initAnalysis 直接创建 Agent（当前是这样），则需在其 `createAgent` 的 middleware 中也添加新中间件

### initAnalysis.executor 中间件挂载

```typescript
const agent = createAgent({
  model,
  systemPrompt,
  checkpointer,
  tools,
  store,
  middleware: [
    analysisResultPersistenceMiddleware({
      agentName: config.moduleName,
      caseId,
      sessionId,
    }),
    pointConsumptionMiddleware(userId, 'case_analysis_token'),
    caseMaterialContextMiddleware(userId, caseId),
    // ...
  ],
})

try {
  const result = await agent.invoke(...)
  // afterAgent 已自动保存结果
  return { messages: result.messages, ... }
} catch (error) {
  // 标记分析失败
  await markAnalysisFailedFromState({ _analysisRecordId: /* 从 state 获取 */ })
  throw error
}
```

**注意**：由于中间件状态存储在 checkpointer 中，`_analysisRecordId` 可以通过读取 checkpointer 获取。但更实用的方式是在 catch 中通过 `findAnalysisBySessionAndNodeDao(sessionId, nodeId)` 查找 IN_PROGRESS 记录并标记失败。

## 中间件注册

### middleware/index.ts

```typescript
export * from './analysisResultPersistence.middleware'
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `prisma/models/case.prisma` | 修改 | caseAnalyses 新增 isActive 字段和索引 |
| `server/services/workflow/middleware/analysisResultPersistence.middleware.ts` | 新增 | 核心中间件 |
| `server/services/workflow/middleware/index.ts` | 修改 | 导出新中间件 |
| `server/services/case/analysis.dao.ts` | 修改 | 新增 deactivateVersionsDao / activateVersionDao |
| `server/services/case/analysis.service.ts` | 修改 | 新增 switchActiveVersionService |
| `server/services/workflow/agents/caseAnalysis.ts` | 修改 | 添加中间件 |
| `server/services/workflow/initAnalysis.executor.ts` | 修改 | 迁移为使用中间件 + 错误处理 |

## 测试计划

- [ ] 中间件单元测试：beforeAgent 创建记录、afterAgent 保存结果和激活版本
- [ ] isActive 约束测试：同 (caseId, nodeId) 只有一条 isActive=true
- [ ] 失败处理测试：Agent 异常时 markAnalysisFailedFromState 正确标记
- [ ] 版本递增测试：多次分析同一模块版本号递增
- [ ] 集成测试：通过 caseAnalysisAgent 调用验证端到端流程
- [ ] switchActiveVersionService 测试：手动切换激活版本
