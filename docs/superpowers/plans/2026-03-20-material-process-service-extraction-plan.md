# 材料处理逻辑提取到 Service 层 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `server/api/v1/material/process/[id].post.ts` 中的材料转换业务逻辑提取到 `server/services/material/materialProcess.service.ts`，API 层仅保留参数验证和认证。

**Architecture:** 新建 `materialProcess.service.ts` 包含 `MaterialProcessError` 错误类、类型定义、编排函数 `processMaterialService` 和三个私有处理函数。API 文件瘦身为参数验证 + 认证 + 调用 service + 异常转响应。

**Tech Stack:** TypeScript, Nuxt Server (Nitro), Prisma ORM, Vitest

**Spec:** `docs/superpowers/specs/2026-03-20-material-process-service-extraction-design.md`

---

## 文件变更总览

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 新建 | `server/services/material/materialProcess.service.ts` | 材料处理编排服务 |
| 修改 | `server/api/v1/material/process/[id].post.ts` | 瘦身为参数验证 + 认证 + 调用 service |

---

### Task 1: 创建 `materialProcess.service.ts` — 类型定义和错误类

**Files:**
- Create: `server/services/material/materialProcess.service.ts`

- [ ] **Step 1: 创建文件，写入错误类和类型定义**

```typescript
/**
 * 材料处理编排服务
 *
 * 根据材料类型分发到对应的处理服务（PDF/图片/音频），
 * 处理结果更新和向量化。
 * Requirements: 3.8, 3.10, 3.11
 */

import {
    getMaterialByIdService,
    updateMaterialStatusService,
    updateMaterialContentService,
} from './material.service'
import { CaseMaterialType } from '#shared/types/case'
import { MaterialStatus } from '#shared/types/material'
import { convertPdfService } from './mineru.service'
import { createImageConversionService } from './ocr.service'
import { transcribeAudioService } from './asr.service'
import {
    embedMaterialService,
    type EmbedMaterialInput,
} from './materialEmbedding.service'

/**
 * 材料处理业务错误
 * code 与 resError 的 code 字段对齐
 */
export class MaterialProcessError extends Error {
    constructor(message: string, public code: number) {
        super(message)
        this.name = 'MaterialProcessError'
    }
}

/** 材料处理选项 */
export interface ProcessMaterialOptions {
    /** 是否向量化（默认 true） */
    enableEmbedding?: boolean
    /** MinerU 转换选项 */
    mineruOptions?: {
        enableOcr?: boolean
        enableFormula?: boolean
        enableTable?: boolean
        pageRange?: string
    }
    /** ASR 转录选项 */
    asrOptions?: {
        timestampAlignmentEnabled?: boolean
        languageHints?: string[]
        disfluencyRemovalEnabled?: boolean
        diarizationEnabled?: boolean
    }
}

/** 材料处理结果 */
export interface ProcessMaterialResult {
    id: number
    status: MaterialStatus
    contentLength?: number
    /** 标记材料已有内容无需处理的情况 */
    alreadyCompleted?: boolean
}

/** 内部处理结果类型 */
interface InternalProcessResult {
    success: boolean
    content?: string
    error?: string
}
```

- [ ] **Step 2: 确认文件无语法错误**

Run: `npx tsc --noEmit 2>&1 | grep -i materialProcess | head -20`

---

### Task 2: 实现三个私有处理函数

**Files:**
- Modify: `server/services/material/materialProcess.service.ts`

- [ ] **Step 1: 添加 `processPdfMaterial` 私有函数**

在文件末尾添加（从原 API 文件原样移入）：

```typescript
/**
 * 处理 PDF 材料
 */
async function processPdfMaterial(
    ossFileId: number,
    userId: number,
    options?: {
        enableOcr?: boolean
        enableFormula?: boolean
        enableTable?: boolean
        pageRange?: string
    }
): Promise<InternalProcessResult> {
    try {
        const result = await convertPdfService(ossFileId, userId, {
            enableOcr: options?.enableOcr,
            enableFormula: options?.enableFormula,
            enableTable: options?.enableTable,
            pageRange: options?.pageRange,
        })

        if (!result.success) {
            return { success: false, error: result.error }
        }

        // MinerU 是异步处理，返回成功但没有内容
        // 内容会在回调或轮询完成后更新
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}
```

- [ ] **Step 2: 添加 `processImageMaterial` 私有函数**

```typescript
/**
 * 处理图片材料
 */
async function processImageMaterial(
    ossFileId: number,
    userId: number
): Promise<InternalProcessResult> {
    try {
        const result = await createImageConversionService(ossFileId, userId)

        if (!result.success) {
            return { success: false, error: result.error }
        }

        // OCR 是同步处理，直接返回内容
        const content = result.record?.markdownContent || result.record?.htmlContent || undefined
        return { success: true, content }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}
```

- [ ] **Step 3: 添加 `processAudioMaterial` 私有函数**

```typescript
/**
 * 处理音频材料
 */
async function processAudioMaterial(
    ossFileId: number,
    userId: number,
    options?: {
        timestampAlignmentEnabled?: boolean
        languageHints?: string[]
        disfluencyRemovalEnabled?: boolean
        diarizationEnabled?: boolean
    }
): Promise<InternalProcessResult> {
    try {
        const result = await transcribeAudioService(ossFileId, userId, {
            timestampAlignmentEnabled: options?.timestampAlignmentEnabled,
            languageHints: options?.languageHints,
            disfluencyRemovalEnabled: options?.disfluencyRemovalEnabled,
            diarizationEnabled: options?.diarizationEnabled,
        })

        if (!result.success) {
            return { success: false, error: result.error }
        }

        // ASR 是异步处理，返回成功但没有内容
        // 内容会在轮询完成后更新
        return { success: true }
    } catch (error: any) {
        return { success: false, error: error.message }
    }
}
```

---

### Task 3: 实现 `processMaterialService` 编排函数

**Files:**
- Modify: `server/services/material/materialProcess.service.ts`

- [ ] **Step 1: 在类型定义之后、私有函数之前添加 `processMaterialService`**

```typescript
/**
 * 处理材料（编排函数）
 *
 * 包含授权检查、状态校验、分发到具体处理服务、结果更新和向量化。
 * Requirements: 3.8, 3.10, 3.11
 *
 * @param materialId 材料 ID
 * @param userId 当前用户 ID（用于授权检查）
 * @param options 处理选项
 * @returns 处理结果
 * @throws MaterialProcessError 业务错误（包含 code 用于 API 层返回）
 */
export const processMaterialService = async (
    materialId: number,
    userId: number,
    options: ProcessMaterialOptions = {},
): Promise<ProcessMaterialResult> => {
    // 1. 获取材料信息
    const material = await getMaterialByIdService(materialId)
    if (!material) {
        throw new MaterialProcessError('材料不存在', 404)
    }

    // 2. 授权检查：验证材料所属案件是否属于当前用户
    const caseRecord = await prisma.cases.findFirst({
        where: { id: material.caseId, userId, deletedAt: null },
    })
    if (!caseRecord) {
        throw new MaterialProcessError('无权处理此材料', 403)
    }

    // 3. 状态检查
    if (material.status === MaterialStatus.COMPLETED) {
        throw new MaterialProcessError('材料已处理完成，无需重复处理', 400)
    }
    if (material.status === MaterialStatus.PROCESSING) {
        throw new MaterialProcessError('材料正在处理中，请稍后', 400)
    }

    // 4. OSS 文件检查
    if (!material.ossFileId) {
        if (material.content) {
            return {
                id: material.id,
                status: MaterialStatus.COMPLETED,
                alreadyCompleted: true,
            }
        }
        throw new MaterialProcessError('材料没有关联的文件，无法处理', 400)
    }

    // 5. 获取 OSS 文件信息
    const ossFile = await prisma.ossFiles.findFirst({
        where: { id: material.ossFileId, deletedAt: null },
    })
    if (!ossFile) {
        throw new MaterialProcessError('关联的文件不存在', 404)
    }

    // 6. 更新状态为处理中
    await updateMaterialStatusService(materialId, MaterialStatus.PROCESSING)

    // 7-12. 分发处理（包裹在 try-catch 中，失败时回退状态）
    try {
        // 8. 按类型分发
        let processResult: InternalProcessResult

        switch (material.type) {
            case CaseMaterialType.DOCUMENT:
                processResult = await processPdfMaterial(ossFile.id, userId, options.mineruOptions)
                break
            case CaseMaterialType.IMAGE:
                processResult = await processImageMaterial(ossFile.id, userId)
                break
            case CaseMaterialType.AUDIO:
                processResult = await processAudioMaterial(ossFile.id, userId, options.asrOptions)
                break
            default:
                await updateMaterialStatusService(materialId, MaterialStatus.PENDING)
                throw new MaterialProcessError('该材料类型不需要服务端处理', 400)
        }

        // 9. 处理失败
        if (!processResult.success) {
            try {
                await updateMaterialStatusService(materialId, MaterialStatus.FAILED)
            } catch {
                // 忽略状态更新失败
            }
            throw new MaterialProcessError(processResult.error || '材料处理失败', 500)
        }

        // 10. 有内容则更新材料
        if (processResult.content) {
            await updateMaterialContentService(materialId, processResult.content)

            // 11. 向量化处理
            if (options.enableEmbedding !== false) {
                try {
                    const session = await prisma.caseSessions.findFirst({
                        where: { caseId: material.caseId, deletedAt: null },
                        orderBy: { createdAt: 'desc' },
                    })

                    const embedInput: EmbedMaterialInput = {
                        content: processResult.content,
                        userId,
                        caseId: material.caseId,
                        materialId: material.id,
                        sessionId: session?.sessionId || '',
                        materialName: material.name,
                        materialType: material.type as CaseMaterialType,
                    }

                    await embedMaterialService(embedInput)
                    logger.info('材料向量化完成', { materialId })
                } catch (embedError: any) {
                    // 向量化失败不影响主流程
                    logger.error('材料向量化失败', {
                        materialId,
                        error: embedError.message,
                    })
                }
            }

            // 12. 返回同步处理结果
            return {
                id: material.id,
                status: MaterialStatus.COMPLETED,
                contentLength: processResult.content.length,
            }
        }

        // 12. 异步处理（MinerU/ASR），返回处理中状态
        return {
            id: material.id,
            status: MaterialStatus.PROCESSING,
        }
    } catch (error: any) {
        // 状态回退（MaterialProcessError 中部分已处理状态，这里兜底）
        if (!(error instanceof MaterialProcessError)) {
            logger.error('处理材料失败', {
                materialId,
                userId,
                error: error.message,
            })
            try {
                await updateMaterialStatusService(materialId, MaterialStatus.FAILED)
            } catch {
                // 忽略状态更新失败
            }
        }
        throw error
    }
}
```

- [ ] **Step 2: 确认文件无语法错误**

Run: `npx tsc --noEmit 2>&1 | grep -i materialProcess | head -20`

- [ ] **Step 3: 提交新服务文件**

```bash
git add server/services/material/materialProcess.service.ts
git commit -m "refactor(material): 新建 materialProcess.service.ts 材料处理编排服务"
```

---

### Task 4: 瘦身 API 文件

**Files:**
- Modify: `server/api/v1/material/process/[id].post.ts`

- [ ] **Step 1: 重写 API 文件，仅保留参数验证、认证和 service 调用**

将 `server/api/v1/material/process/[id].post.ts` 的全部内容替换为：

```typescript
/**
 * 处理材料
 *
 * POST /api/v1/material/process/:id
 *
 * 根据材料类型调用对应的处理服务：
 * - PDF：调用 MinerU 服务
 * - 图片：调用 OCR 服务
 * - 音频：调用 ASR 服务
 * Requirements: 3.8, 3.10, 3.11
 */

import { z } from 'zod'
import {
    processMaterialService,
    MaterialProcessError,
} from '~~/server/services/material/materialProcess.service'

// 路径参数验证
const paramsSchema = z.object({
    id: z.coerce.number({ message: '材料 ID 必须为数字' }).int().positive({ message: '材料 ID 必须为正整数' }),
})

// 请求体验证（可选参数）
const bodySchema = z.object({
    /** 是否向量化（默认 true） */
    enableEmbedding: z.boolean().optional().default(true),
    /** MinerU 转换选项 */
    mineruOptions: z.object({
        enableOcr: z.boolean().optional(),
        enableFormula: z.boolean().optional(),
        enableTable: z.boolean().optional(),
        pageRange: z.string().optional(),
    }).optional(),
    /** ASR 转录选项 */
    asrOptions: z.object({
        timestampAlignmentEnabled: z.boolean().optional(),
        languageHints: z.array(z.string()).optional(),
        disfluencyRemovalEnabled: z.boolean().optional(),
        diarizationEnabled: z.boolean().optional(),
    }).optional(),
})

export default defineEventHandler(async (event) => {
    // 认证检查
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 参数验证
    const id = getRouterParam(event, 'id')
    const paramsResult = paramsSchema.safeParse({ id })
    if (!paramsResult.success) {
        return resError(event, 400, parseErrorMessage(paramsResult.error, '参数验证失败'))
    }

    // 请求体解析
    const body = await readBody(event)
    const bodyResult = bodySchema.safeParse(body || {})
    const options = bodyResult.success ? bodyResult.data : { enableEmbedding: true }

    // 调用 service 层
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

- [ ] **Step 2: 确认文件无语法错误**

Run: `npx tsc --noEmit 2>&1 | grep -i "\\[id\\]\\|materialProcess" | head -20`

- [ ] **Step 3: 提交 API 文件瘦身**

```bash
git add server/api/v1/material/process/\[id\].post.ts
git commit -m "refactor(material): 瘦身材料处理 API，业务逻辑委托给 service 层"
```

---

### Task 5: 验证

**Files:**
- Read: `server/services/material/materialProcess.service.ts`
- Read: `server/api/v1/material/process/[id].post.ts`

- [ ] **Step 1: 全量类型检查**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: 无与 `materialProcess.service.ts` 或 `[id].post.ts` 相关的错误

- [ ] **Step 2: 运行现有测试确认无回归**

Run: `npx vitest run 2>&1 | tail -30`
Expected: 所有现有测试通过

- [ ] **Step 3: 确认文件行数符合预期**

Run: `wc -l server/services/material/materialProcess.service.ts server/api/v1/material/process/\\[id\\].post.ts`
Expected: service 文件约 200 行，API 文件约 70 行
