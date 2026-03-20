# 材料处理逻辑提取到 Service 层

## 概述

将 `server/api/v1/material/process/[id].post.ts` 中的材料转换业务逻辑提取到新的 `server/services/material/materialProcess.service.ts`，API 层仅保留参数验证和认证检查。

## 动机

当前 API 文件约 310 行，包含授权校验、状态管理、类型分发、向量化等业务逻辑，职责过重。提取后：
- API 层瘦身至约 40 行，只做参数验证 + 认证 + 调用 service
- 业务逻辑集中在 service 层，便于复用和测试
- `material.service.ts` 保持基础 CRUD，不膨胀

## 层级职责划分

| 层级 | 职责 |
|------|------|
| API 层 (`[id].post.ts`) | zod 参数验证、认证检查（用户是否登录）、调用 service、异常转错误响应 |
| Service 层 (`materialProcess.service.ts`) | 授权检查（材料是否属于用户）、状态校验、分发处理、结果更新、向量化 |

## 新文件：`materialProcess.service.ts`

### 导出

```typescript
export class MaterialProcessError extends Error {
  constructor(message: string, public code: number) {
    super(message)
    this.name = 'MaterialProcessError'
  }
}

export interface ProcessMaterialOptions {
  enableEmbedding?: boolean
  mineruOptions?: {
    enableOcr?: boolean
    enableFormula?: boolean
    enableTable?: boolean
    pageRange?: string
  }
  asrOptions?: {
    timestampAlignmentEnabled?: boolean
    languageHints?: string[]
    disfluencyRemovalEnabled?: boolean
    diarizationEnabled?: boolean
  }
}

export interface ProcessMaterialResult {
  id: number
  status: MaterialStatus
  contentLength?: number
  /** 标记材料已有内容无需处理的情况 */
  alreadyCompleted?: boolean
}

export const processMaterialService: (
  materialId: number,
  userId: number,
  options?: ProcessMaterialOptions,
) => Promise<ProcessMaterialResult>
```

### 内部逻辑流程

1. 调用 `getMaterialByIdService(materialId)` 获取材料，不存在抛 `MaterialProcessError(404)`
2. 授权检查：查询 `prisma.cases.findFirst({ where: { id: material.caseId, userId, deletedAt: null } })`，不通过抛 `MaterialProcessError(403)`
3. 状态检查：已完成抛 `MaterialProcessError(400)`，处理中抛 `MaterialProcessError(400)`
4. OSS 文件检查：
   - 无 `ossFileId` 但有 `content` → 直接返回 `{ id, status: COMPLETED, alreadyCompleted: true }`
   - 无 `ossFileId` 且无 `content` → 抛 `MaterialProcessError(400)`
5. 获取 OSS 文件信息（复用步骤 1 中 `MaterialWithFile` 已关联的文件信息，若无则单独查询），不存在抛 `MaterialProcessError(404)`
6. 更新状态为 `PROCESSING`
7. **以下步骤 7-11 包裹在 try-catch 中，catch 时将状态回退为 `FAILED`（回退失败则忽略），再重新抛出异常**
8. 按 `material.type` 分发到私有函数：
   - `DOCUMENT` → `processPdfMaterial(ossFileId, userId, options.mineruOptions)`
   - `IMAGE` → `processImageMaterial(ossFileId, userId)`
   - `AUDIO` → `processAudioMaterial(ossFileId, userId, options.asrOptions)`
   - 其他 → 回退状态为 PENDING，抛 `MaterialProcessError(400)`
9. 处理失败 → 更新状态为 `FAILED`，抛 `MaterialProcessError(500)`
10. 有内容 → 调用 `updateMaterialContentService` 更新内容
11. 向量化（`enableEmbedding !== false` 时）：
    - 查询最近的案件会话：`prisma.caseSessions.findFirst({ where: { caseId: material.caseId, deletedAt: null }, orderBy: { createdAt: 'desc' } })`
    - 组装 `EmbedMaterialInput`：`{ content, userId, caseId: material.caseId, materialId: material.id, sessionId: session?.sessionId || '', materialName: material.name, materialType: material.type }`
    - 调用 `embedMaterialService(embedInput)`
    - 失败仅 `logger.error`，不阻塞主流程
12. 返回 `ProcessMaterialResult`

### 私有函数（从 API 文件原样移入，不加 Service/DAO 后缀）

- `processPdfMaterial(ossFileId, userId, options?)` → 调用 `convertPdfService`
- `processImageMaterial(ossFileId, userId)` → 调用 `createImageConversionService`
- `processAudioMaterial(ossFileId, userId, options?)` → 调用 `transcribeAudioService`

返回类型统一为 `{ success: boolean; content?: string; error?: string }`。

## 修改后的 API 文件：`[id].post.ts`

```typescript
import { z } from 'zod'
import {
  processMaterialService,
  MaterialProcessError,
} from '~~/server/services/material/materialProcess.service'

const paramsSchema = z.object({ ... })  // 保持不变
const bodySchema = z.object({ ... })    // 保持不变

export default defineEventHandler(async (event) => {
  // 认证
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  // 参数验证
  const id = getRouterParam(event, 'id')
  const paramsResult = paramsSchema.safeParse({ id })
  if (!paramsResult.success) return resError(event, 400, parseErrorMessage(...))

  const body = await readBody(event)
  const bodyResult = bodySchema.safeParse(body || {})
  const options = bodyResult.success ? bodyResult.data : { enableEmbedding: true }

  // 调用 service
  try {
    const result = await processMaterialService(paramsResult.data.id, user.id, options)
    const message = result.alreadyCompleted
      ? '材料已有内容，无需处理'
      : result.contentLength
        ? '材料处理成功'
        : '材料处理已提交，请稍后查询结果'
    return resSuccess(event, message, result)
  } catch (error: any) {
    if (error instanceof MaterialProcessError) {
      return resError(event, error.code, error.message)
    }
    return resError(event, 500, error.message || '处理材料失败')
  }
})
```

## 不变的部分

- zod schema 定义保持在 API 文件中
- `material.service.ts` 不做修改
- 底层处理服务（`mineru.service.ts`、`ocr.service.ts`、`asr.service.ts`、`materialEmbedding.service.ts`）不做修改
