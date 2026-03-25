# 案件材料预处理中间件设计

## 概述

在案件分析 Agent 启动前，通过 `beforeAgent` 中间件确保所有案件材料已完成识别和嵌入。同时将材料处理编排逻辑抽象到独立 service，供中间件和工具复用。

## 实现范围

1. **新建** `server/services/material/materialPipeline.service.ts`
2. **新建** `caseProcessMaterialMiddleware`（在 `caseAnalysis.ts` 中）
3. **重构** `processMaterials.tool.ts` 调用 pipeline service

`caseMaterialContextMiddleware`（内容获取+上下文注入）留到下一轮。

## 设计详情

### 1. `materialPipeline.service.ts`

**文件**：`server/services/material/materialPipeline.service.ts`

**核心方法**：

```typescript
interface MaterialReadyResult {
  materials: MaterialWithFile[]
  totalMaterials: number
  alreadyEmbedded: number
  newlyProcessed: number
  embeddedMap: Map<number, boolean>
  failed: Array<{ materialId: number; name: string; error: string }>
}

export async function ensureMaterialsReadyService(
  caseId: number,
  userId: number
): Promise<MaterialReadyResult>
```

**内部流程**：

1. `getMaterialsByCaseIdService(caseId)` 获取全部材料
2. 空材料时直接返回 `totalMaterials: 0`，不抛错
3. `batchCheckMaterialEmbeddedService(ids)` 批量检查嵌入状态
4. 对未嵌入的材料调用 `ensureMaterialsEmbeddedService(notEmbedded, userId)`
5. 返回结果摘要（含材料列表、嵌入状态映射、失败列表）

失败的材料记录到 `failed` 数组但不阻断整体流程。

### 2. `caseProcessMaterialMiddleware`

**位置**：`server/services/agent/caseAnalysis.ts`

```typescript
const caseProcessMaterialMiddleware = (userId: number, caseId: number) => {
  return createMiddleware({
    name: "CaseProcessMaterialMiddleware",
    beforeAgent: {
      hook: async (state) => {
        const result = await ensureMaterialsReadyService(caseId, userId)
        logger.info('材料预处理完成', { caseId, ...result })
        if (result.failed.length > 0) {
          logger.warn('部分材料处理失败', { failed: result.failed })
        }
      }
    }
  })
}
```

**要点**：

- `userId` 和 `caseId` 通过闭包传入
- 只在 `beforeAgent` 执行，无 `afterAgent`
- 处理失败不阻断 agent 启动
- 后续迁移到正式版（`caseAgent.ts`）时以同样方式集成

### 3. 重构 `processMaterials.tool.ts`

**变化**：

- 删除 tool 中的 `getMaterialsByCaseIdService` + `batchCheckMaterialEmbeddedService` + `ensureMaterialsEmbeddedService` 编排代码
- 替换为 `ensureMaterialsReadyService(caseId, userId)` 一次调用
- 从返回的 `result.materials` 获取材料列表传给 `fetchMaterialContents`，避免重复查询
- `fetchMaterialContents`、`estimateTokens`、token 模式判断逻辑保留在 tool 中

## 中间件注册

```typescript
// caseAnalysis.ts 中
const agent = createAgent({
  // ...
  middleware: [caseProcessMaterialMiddleware(userId!, caseId!)],
})
```

## 后续迭代

- `caseMaterialContextMiddleware`：获取材料内容 + token 估算 + 注入 agent 上下文
- 验证通过后迁移到 `caseAgent.ts`（正式版 `createDeepAgent`）
