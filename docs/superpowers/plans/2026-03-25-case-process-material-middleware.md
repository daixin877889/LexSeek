# 案件材料预处理中间件实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将材料处理编排逻辑抽象到 pipeline service，并在案件分析 Agent 的 beforeAgent 中间件中调用，确保分析前材料已识别+嵌入。

**Architecture:** 新建 `materialPipeline.service.ts` 封装识别+嵌入编排，`caseProcessMaterialMiddleware` 在 beforeAgent 钩子中调用该 service，重构 `processMaterials.tool.ts` 复用同一 service 避免逻辑重复。

**Tech Stack:** TypeScript, LangChain middleware, Prisma, Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-case-process-material-middleware-design.md`

---

## Task 1: 创建 `materialPipeline.service.ts` — 测试

**Files:**
- Create: `tests/server/material/materialPipeline.service.test.ts`

- [ ] **Step 1: 编写测试文件**

```typescript
/**
 * ensureMaterialsReadyService 测试
 *
 * 测试材料就绪保障 pipeline：获取材料 → 检查嵌入 → 处理未嵌入 → 返回结果
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

const mocks = vi.hoisted(() => ({
    getMaterialsByCaseIdService: vi.fn(),
    batchCheckMaterialEmbeddedService: vi.fn(),
    processMaterialService: vi.fn(),
    embedMaterialUnifiedService: vi.fn(),
}))

vi.mock('../../../server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('../../../server/services/material/materialEmbedding.service', () => ({
    batchCheckMaterialEmbeddedService: mocks.batchCheckMaterialEmbeddedService,
    embedMaterialUnifiedService: mocks.embedMaterialUnifiedService,
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    batchCheckMaterialEmbeddedService: mocks.batchCheckMaterialEmbeddedService,
    embedMaterialUnifiedService: mocks.embedMaterialUnifiedService,
}))
vi.mock('../../../server/services/material/materialProcess.service', () => ({
    processMaterialService: mocks.processMaterialService,
}))
vi.mock('~~/server/services/material/materialProcess.service', () => ({
    processMaterialService: mocks.processMaterialService,
}))

import { ensureMaterialsReadyService } from '../../../server/services/material/materialPipeline.service'

function makeMaterial(overrides: Partial<MaterialWithFile> & { id: number; type: number; name: string }): MaterialWithFile {
    return {
        caseId: 1,
        ossFileId: null,
        isEncrypted: false,
        status: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
    } as MaterialWithFile
}

describe('ensureMaterialsReadyService', () => {
    const caseId = 1
    const userId = 1

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('空材料时返回空结果', async () => {
        mocks.getMaterialsByCaseIdService.mockResolvedValue([])

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.totalMaterials).toBe(0)
        expect(result.materials).toEqual([])
        expect(result.failed).toEqual([])
        expect(mocks.batchCheckMaterialEmbeddedService).not.toHaveBeenCalled()
    })

    it('全部已嵌入时不触发处理', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
            makeMaterial({ id: 2, type: 3, name: 'img1.png' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, true], [2, true]])
        )

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.totalMaterials).toBe(2)
        expect(result.alreadyEmbedded).toBe(2)
        expect(result.newlyProcessed).toBe(0)
        expect(result.failed).toEqual([])
        expect(mocks.processMaterialService).not.toHaveBeenCalled()
    })

    it('对未嵌入的材料触发识别和嵌入', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
            makeMaterial({ id: 2, type: 3, name: 'img1.png' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        // 第一次检查：id=1 未嵌入
        mocks.batchCheckMaterialEmbeddedService
            .mockResolvedValueOnce(new Map([[1, false], [2, true]]))
            // 第二次检查（处理后）
            .mockResolvedValueOnce(new Map([[1, true], [2, true]]))
        mocks.processMaterialService.mockResolvedValue({ id: 1, status: 3 })
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.alreadyEmbedded).toBe(1)
        expect(result.newlyProcessed).toBe(1)
        expect(result.failed).toEqual([])
        expect(mocks.processMaterialService).toHaveBeenCalledWith(1, userId)
        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledWith(1, userId)
    })

    it('处理失败时记录到 failed 数组但不抛错', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
            makeMaterial({ id: 2, type: 3, name: 'img1.png' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialEmbeddedService
            .mockResolvedValueOnce(new Map([[1, false], [2, false]]))
            .mockResolvedValueOnce(new Map([[1, false], [2, true]]))
        mocks.processMaterialService
            .mockRejectedValueOnce(new Error('PDF 解析失败'))
            .mockResolvedValueOnce({ id: 2, status: 3 })
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0]).toEqual({
            materialId: 1,
            name: 'doc1.pdf',
            error: 'PDF 解析失败',
        })
        expect(result.newlyProcessed).toBe(1)
    })

    it('嵌入失败时记录到 failed 数组', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialEmbeddedService
            .mockResolvedValueOnce(new Map([[1, false]]))
            .mockResolvedValueOnce(new Map([[1, false]]))
        mocks.processMaterialService.mockResolvedValue({ id: 1, status: 3 })
        mocks.embedMaterialUnifiedService.mockRejectedValue(new Error('嵌入向量化失败'))

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].error).toBe('嵌入向量化失败')
    })

    it('返回的 embeddedMap 是最终嵌入状态', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialEmbeddedService
            .mockResolvedValueOnce(new Map([[1, false]]))
            .mockResolvedValueOnce(new Map([[1, true]]))
        mocks.processMaterialService.mockResolvedValue({ id: 1, status: 3 })
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.embeddedMap.get(1)).toBe(true)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/materialPipeline.service.test.ts --reporter=verbose`
Expected: FAIL — `ensureMaterialsReadyService` 模块不存在

---

## Task 2: 创建 `materialPipeline.service.ts` — 实现

**Files:**
- Create: `server/services/material/materialPipeline.service.ts`

- [ ] **Step 1: 实现 `ensureMaterialsReadyService`**

```typescript
/**
 * 材料就绪保障 Pipeline
 *
 * 确保案件所有材料已完成识别和嵌入，供中间件和工具复用。
 */
import { getMaterialsByCaseIdService, type MaterialWithFile } from './material.service'
import { batchCheckMaterialEmbeddedService, embedMaterialUnifiedService } from './materialEmbedding.service'
import { processMaterialService } from './materialProcess.service'

export interface MaterialFailedItem {
    materialId: number
    name: string
    error: string
}

export interface MaterialReadyResult {
    materials: MaterialWithFile[]
    totalMaterials: number
    alreadyEmbedded: number
    newlyProcessed: number
    embeddedMap: Map<number, boolean>
    failed: MaterialFailedItem[]
}

export async function ensureMaterialsReadyService(
    caseId: number,
    userId: number,
): Promise<MaterialReadyResult> {
    // 1. 获取全部材料
    const materials = await getMaterialsByCaseIdService(caseId)
    if (materials.length === 0) {
        return {
            materials: [],
            totalMaterials: 0,
            alreadyEmbedded: 0,
            newlyProcessed: 0,
            embeddedMap: new Map(),
            failed: [],
        }
    }

    // 2. 批量检查嵌入状态
    const ids = materials.map(m => m.id)
    const initialEmbeddedMap = await batchCheckMaterialEmbeddedService(ids)

    const alreadyEmbedded = materials.filter(m => initialEmbeddedMap.get(m.id)).length
    const notEmbedded = materials.filter(m => !initialEmbeddedMap.get(m.id))

    // 3. 全部已嵌入则直接返回
    if (notEmbedded.length === 0) {
        return {
            materials,
            totalMaterials: materials.length,
            alreadyEmbedded,
            newlyProcessed: 0,
            embeddedMap: initialEmbeddedMap,
            failed: [],
        }
    }

    // 4. 对未嵌入的材料执行识别+嵌入
    // 注意：对于异步识别的材料（PDF via MinerU、音频 via ASR），
    // processMaterialService 可能返回 PROCESSING 状态，
    // 后续 embedMaterialUnifiedService 会因内容为空而 "失败"，这是预期行为。
    // 这些材料需要等异步回调完成后重新触发嵌入。
    // TODO: 大量材料时考虑添加并发限制（p-limit）
    const failed: MaterialFailedItem[] = []
    let newlyProcessed = 0

    const results = await Promise.allSettled(
        notEmbedded.map(async (material) => {
            // 4a. 触发识别（OCR/ASR/PDF 解析）
            // processMaterialService 对已完成材料会抛 400 错误，视为跳过而非失败
            try {
                await processMaterialService(material.id, userId)
            } catch (e: any) {
                if (e?.code === 400) {
                    // 材料已处理完成或正在处理中，跳过识别步骤
                } else {
                    throw e
                }
            }
            // 4b. 触发嵌入
            await embedMaterialUnifiedService(material.id, userId)
        })
    )

    for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const material = notEmbedded[i]
        if (result.status === 'fulfilled') {
            newlyProcessed++
        } else {
            failed.push({
                materialId: material.id,
                name: material.name,
                error: result.reason instanceof Error
                    ? result.reason.message
                    : String(result.reason),
            })
        }
    }

    // 5. 重新获取最终嵌入状态
    const finalEmbeddedMap = await batchCheckMaterialEmbeddedService(ids)

    return {
        materials,
        totalMaterials: materials.length,
        alreadyEmbedded,
        newlyProcessed,
        embeddedMap: finalEmbeddedMap,
        failed,
    }
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run tests/server/material/materialPipeline.service.test.ts --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/material/materialPipeline.service.ts tests/server/material/materialPipeline.service.test.ts
git commit -m "feat(analysis): 新增 materialPipeline service 确保材料识别+嵌入就绪"
```

---

## Task 3: 实现 `caseProcessMaterialMiddleware`

**Files:**
- Modify: `server/services/agent/caseAnalysis.ts`

- [ ] **Step 1: 更新 import 并实现中间件**

在 `caseAnalysis.ts` 中：
- 添加 `import { ensureMaterialsReadyService } from '../material/materialPipeline.service'`
- 删除现有 `caseMaterialMiddleware` 函数（第 19-35 行），替换为 `caseProcessMaterialMiddleware`

```typescript
const caseProcessMaterialMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: "CaseProcessMaterialMiddleware",
        beforeAgent: {
            hook: async (_state) => {
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

- [ ] **Step 2: 更新中间件注册**

将 `middleware: [caseMaterialMiddleware()]` 改为 `middleware: [caseProcessMaterialMiddleware(userId!, caseId!)]`

- [ ] **Step 3: 提交**

```bash
git add server/services/agent/caseAnalysis.ts
git commit -m "feat(analysis): 实现 caseProcessMaterialMiddleware beforeAgent 材料预处理"
```

---

## Task 4: 重构 `processMaterials.tool.ts`

**Files:**
- Modify: `server/services/workflow/tools/processMaterials.tool.ts`

- [ ] **Step 1: 替换编排逻辑为 pipeline service 调用**

修改 `createTool` 函数内部：

```typescript
// 替换步骤 1-2 为：
const { materials, embeddedMap, failed } = await ensureMaterialsReadyService(caseId, userId)
if (materials.length === 0) {
    return JSON.stringify({
        mode: 'empty',
        message: '当前案件没有任何材料，请先上传案件材料。',
        materials: [],
    })
}

// 步骤 3-5 保留但使用 pipeline 返回的数据：
const contentMap = await fetchMaterialContents(materials)

let totalTokens = 0
for (const content of contentMap.values()) {
    totalTokens += estimateTokens(content)
}

const isFullMode = totalTokens < TOKEN_THRESHOLD

const materialList = materials.map(m => {
    const content = contentMap.get(m.id)
    return {
        id: m.id,
        name: m.name,
        type: m.type,
        tokenCount: content ? estimateTokens(content) : 0,
        hasContent: !!content,
        embedded: embeddedMap.get(m.id) ?? false,
        ...(isFullMode && content
            ? { content }
            : { summary: m.summary || (content ? content.substring(0, 200) + '...' : `[材料: ${m.name}，暂无内容]`) }),
    }
})
```

- [ ] **Step 2: 更新 import**

```typescript
// 删除以下 import：
// import { getMaterialsByCaseIdService } from '../../material/material.service'
// import { batchCheckMaterialEmbeddedService } from '../../material/materialEmbedding.service'
// import { ensureMaterialsEmbeddedService } from '../../material/materialProcess.service'

// 替换为：
import { ensureMaterialsReadyService } from '../../material/materialPipeline.service'
```

- [ ] **Step 3: 运行现有全量测试确认无回归**

Run: `npx vitest run tests/server/material/ --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add server/services/workflow/tools/processMaterials.tool.ts
git commit -m "refactor(analysis): processMaterials tool 改用 materialPipeline service"
```

---

## Task 5: 类型检查和全量验证

**Files:** 无新文件

- [ ] **Step 1: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 2: 运行全量测试**

Run: `npx vitest run --reporter=verbose`
Expected: 全部 PASS，无回归

- [ ] **Step 3: 验证完成后提交（如有修复）**

如果类型检查或测试发现问题，修复后提交：
```bash
git commit -m "fix(analysis): 修复类型检查/测试问题"
```
