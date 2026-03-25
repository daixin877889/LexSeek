# 案件材料预处理中间件设计

## 概述

在案件分析 Agent 启动前，通过 `beforeAgent` 中间件确保所有案件材料已完成识别和嵌入。同时将材料处理编排逻辑抽象到独立 service，供中间件和工具复用。

## 实现范围

1. **新增** `batchCheckMaterialRecognizedService` 在 `materialProcess.service.ts` 中
2. **新建** `server/services/material/materialPipeline.service.ts`
3. **新建** `caseProcessMaterialMiddleware`（在 `caseAnalysis.ts` 中）
4. **重构** `processMaterials.tool.ts` 调用 pipeline service

`caseMaterialContextMiddleware`（内容获取+上下文注入）留到下一轮。

## 设计详情

### 0. `batchCheckMaterialRecognizedService`

**文件**：`server/services/material/materialProcess.service.ts`

**签名**：

```typescript
/** 批量检查材料是否已识别完成 */
export async function batchCheckMaterialRecognizedService(
  materials: MaterialWithFile[]
): Promise<Map<number, boolean>>
```

**逻辑**：
- 按材料类型分组
- 文本(1): 查 `textContentRecords`，条件 `materialId in ids, content not null, deletedAt null`
- 文档(2): 查 `docRecognitionRecords`，条件 `ossFileId in ids, status === 2, deletedAt null`
- 图片(3): 查 `imageRecognitionRecords`，条件 `ossFileId in ids, status === 2, deletedAt null`
- 音频(4): 查 `asrRecords`，条件 `ossFileId in ids, status === 2, deletedAt null`
- 文本类型没有 status 字段，通过 `content not null` 判断已识别
- 并行查询四张表，汇总为 `Map<materialId, boolean>`

### 1. `materialPipeline.service.ts`

**文件**：`server/services/material/materialPipeline.service.ts`

**核心方法**：

```typescript
interface MaterialFailedItem {
  materialId: number
  name: string
  error: string
}

interface MaterialReadyResult {
  materials: MaterialWithFile[]
  totalMaterials: number
  alreadyEmbedded: number
  newlyProcessed: number
  embeddedMap: Map<number, boolean>
  failed: MaterialFailedItem[]
}

export async function ensureMaterialsReadyService(
  caseId: number,
  userId: number
): Promise<MaterialReadyResult>
```

**内部流程**：

1. `getMaterialsByCaseIdService(caseId)` 获取全部材料
2. 空材料时直接返回 `{ materials: [], totalMaterials: 0, ... }`，不抛错
3. **识别阶段**：`batchCheckMaterialRecognizedService(materials)` 批量检查识别状态，对未识别的材料调用 `processMaterialService(materialId, userId)` 触发识别（OCR/ASR/PDF解析），使用 `Promise.allSettled` 并发处理，失败记录到 `failed` 数组
4. **嵌入阶段**：`batchCheckMaterialEmbeddedService(ids)` 批量检查嵌入状态，对未嵌入的材料调用 `embedMaterialUnifiedService(materialId, userId)` 触发嵌入，使用 `Promise.allSettled` 并发处理，失败记录到 `failed` 数组
5. 返回结果摘要（含材料列表、嵌入状态映射、失败列表）

**关于 failed 详情收集**：pipeline service 在 `Promise.allSettled` 结果中自行收集每个材料的失败原因和名称。识别失败和嵌入失败都记录到同一个 `failed` 数组。

失败的材料记录到 `failed` 数组但不阻断整体流程。

### 2. `caseProcessMaterialMiddleware`

**位置**：`server/services/agent/caseAnalysis.ts`

```typescript
const caseProcessMaterialMiddleware = (userId: number, caseId: number) => {
  return createMiddleware({
    name: "CaseProcessMaterialMiddleware",
    beforeAgent: {
      hook: async (state) => {
        try {
          const result = await ensureMaterialsReadyService(caseId, userId)
          logger.info('材料预处理完成', {
            caseId,
            totalMaterials: result.totalMaterials,
            alreadyEmbedded: result.alreadyEmbedded,
            newlyProcessed: result.newlyProcessed,
            failedCount: result.failed.length,
          })
          if (result.failed.length > 0) {
            logger.warn('部分材料处理失败', { failed: result.failed })
          }
        } catch (error) {
          logger.error('材料预处理中间件异常，继续启动 Agent', { caseId, error })
        }
      }
    }
  })
}
```

**要点**：

- `userId` 和 `caseId` 通过闭包传入
- 只在 `beforeAgent` 执行，无 `afterAgent`
- 包裹 try-catch，即使 pipeline 整体异常也不阻断 agent 启动
- 日志只记录统计信息，不展开完整材料列表
- 后续迁移到正式版时以同样方式集成

### 3. 重构 `processMaterials.tool.ts`

**变化**：

- 删除 tool 中的 `getMaterialsByCaseIdService` + `batchCheckMaterialEmbeddedService` + `ensureMaterialsEmbeddedService` 编排代码
- 替换为 `ensureMaterialsReadyService(caseId, userId)` 一次调用
- 从返回的 `result.materials` 获取材料列表传给 `fetchMaterialContents`，避免重复查询
- 从返回的 `result.embeddedMap` 获取嵌入状态，用于构建材料列表中的 `embedded` 字段
- `fetchMaterialContents`、`estimateTokens`、token 模式判断逻辑保留在 tool 中

## 中间件注册

```typescript
// caseAnalysis.ts 中
const agent = createAgent({
  // ...
  middleware: [caseProcessMaterialMiddleware(userId!, caseId!)],
})
```

## 注意事项

### 超时与并发

`ensureMaterialsReadyService` 在 `beforeAgent` 中执行，若案件有大量未识别/未嵌入的材料，处理可能耗时较长。当前使用 `Promise.allSettled` 全量并行。如果后续出现性能问题，可考虑添加并发限制（如 `p-limit`）。

### 异步识别材料

对于 PDF（MinerU）和音频（ASR），`processMaterialService` 可能返回 PROCESSING 状态（异步识别），后续 `embedMaterialUnifiedService` 会因内容为空而失败。这是预期行为，这些材料需要等异步回调完成后重新触发嵌入。

### 迁移到正式版

`caseAgent.ts` 使用 `createDeepAgent`（来自 `deepagents` 包），其 middleware API 可能与 `createAgent`（来自 `langchain`）不同。迁移时需确认 `createDeepAgent` 是否支持相同的 middleware 接口。

## 后续迭代

- `caseMaterialContextMiddleware`：获取材料内容 + token 估算 + 注入 agent 上下文
- 验证通过后迁移到 `caseAgent.ts`（正式版 `createDeepAgent`）
