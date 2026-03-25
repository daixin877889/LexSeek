# 案件材料预处理中间件实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将材料处理编排逻辑抽象到 pipeline service，并在案件分析 Agent 的 beforeAgent 中间件中调用，确保分析前材料已识别+嵌入。

**Architecture:** 新增 `batchCheckMaterialRecognizedService` 批量检查识别状态，新建 `materialPipeline.service.ts` 封装识别+嵌入编排（只对未识别的触发识别，只对未嵌入的触发嵌入），`caseProcessMaterialMiddleware` 在 beforeAgent 钩子中调用该 service，重构 `processMaterials.tool.ts` 复用同一 service。

**Tech Stack:** TypeScript, LangChain middleware, Prisma, Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-case-process-material-middleware-design.md`

---

## Task 1: 新增 `batchCheckMaterialRecognizedService` — 测试

**Files:**
- Create: `tests/server/material/batchCheckMaterialRecognized.test.ts`

- [ ] **Step 1: 编写测试文件**

```typescript
/**
 * batchCheckMaterialRecognizedService 测试
 *
 * 批量检查材料是否已在各识别记录表中完成识别
 * - 文本(1): textContentRecords 中 content 非空
 * - 文档(2): docRecognitionRecords 中 status === 2
 * - 图片(3): imageRecognitionRecords 中 status === 2
 * - 音频(4): asrRecords 中 status === 2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

const mockPrisma = {
    textContentRecords: { findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn() },
}

vi.stubGlobal('prisma', mockPrisma)

import { batchCheckMaterialRecognizedService } from '../../../server/services/material/materialProcess.service'

function makeMaterial(overrides: Partial<MaterialWithFile> & { id: number; type: number; name: string }): MaterialWithFile {
    return {
        caseId: 1,
        ossFileId: null,
        isEncrypted: false,
        status: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...overrides,
    } as MaterialWithFile
}

describe('batchCheckMaterialRecognizedService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockPrisma.textContentRecords.findMany.mockResolvedValue([])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])
    })

    it('空数组返回空 Map', async () => {
        const result = await batchCheckMaterialRecognizedService([])
        expect(result.size).toBe(0)
    })

    it('文本材料：content 非空则已识别', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '文本1' }),
            makeMaterial({ id: 2, type: 1, name: '文本2' }),
        ]
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1 },
        ])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(1)).toBe(true)
        expect(result.get(2)).toBe(false)
    })

    it('文档材料：status === 2 则已识别', async () => {
        const materials = [
            makeMaterial({ id: 10, type: 2, name: 'doc.pdf', ossFileId: 100 }),
            makeMaterial({ id: 11, type: 2, name: 'doc2.pdf', ossFileId: 101 }),
        ]
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 100 },
        ])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(10)).toBe(true)
        expect(result.get(11)).toBe(false)
    })

    it('图片材料：status === 2 则已识别', async () => {
        const materials = [
            makeMaterial({ id: 20, type: 3, name: 'img.png', ossFileId: 200 }),
        ]
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([
            { ossFileId: 200 },
        ])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(20)).toBe(true)
    })

    it('音频材料：status === 2 则已识别', async () => {
        const materials = [
            makeMaterial({ id: 30, type: 4, name: 'audio.mp3', ossFileId: 300 }),
        ]
        mockPrisma.asrRecords.findMany.mockResolvedValue([
            { ossFileId: 300 },
        ])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(30)).toBe(true)
    })

    it('混合类型材料批量检查', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '文本' }),
            makeMaterial({ id: 2, type: 2, name: '文档', ossFileId: 100 }),
            makeMaterial({ id: 3, type: 3, name: '图片', ossFileId: 200 }),
            makeMaterial({ id: 4, type: 4, name: '音频', ossFileId: 300 }),
        ]
        mockPrisma.textContentRecords.findMany.mockResolvedValue([{ materialId: 1 }])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([{ ossFileId: 200 }])
        mockPrisma.asrRecords.findMany.mockResolvedValue([{ ossFileId: 300 }])

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(1)).toBe(true)
        expect(result.get(2)).toBe(false)
        expect(result.get(3)).toBe(true)
        expect(result.get(4)).toBe(true)
    })

    it('无 ossFileId 的非文本材料视为未识别', async () => {
        const materials = [
            makeMaterial({ id: 5, type: 2, name: '无文件文档', ossFileId: null }),
        ]

        const result = await batchCheckMaterialRecognizedService(materials)

        expect(result.get(5)).toBe(false)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/batchCheckMaterialRecognized.test.ts --reporter=verbose`
Expected: FAIL — `batchCheckMaterialRecognizedService` 不存在

---

## Task 2: 新增 `batchCheckMaterialRecognizedService` — 实现

**Files:**
- Modify: `server/services/material/materialProcess.service.ts`

- [ ] **Step 1: 在 `materialProcess.service.ts` 末尾添加函数**

```typescript
/**
 * 批量检查材料是否已在各识别记录表中完成识别
 *
 * 按材料类型查询对应的识别记录表：
 * - 文本(1): textContentRecords，content 非空即已识别
 * - 文档(2): docRecognitionRecords，status === 2 即已识别
 * - 图片(3): imageRecognitionRecords，status === 2 即已识别
 * - 音频(4): asrRecords，status === 2 即已识别
 *
 * @returns Map<materialId, boolean>
 */
export async function batchCheckMaterialRecognizedService(
    materials: MaterialWithFile[],
): Promise<Map<number, boolean>> {
    const resultMap = new Map<number, boolean>()
    if (materials.length === 0) return resultMap

    // 初始化所有材料为 false
    for (const m of materials) {
        resultMap.set(m.id, false)
    }

    // 按类型分组
    const textMaterials = materials.filter(m => m.type === 1)
    const docMaterials = materials.filter(m => m.type === 2 && m.ossFileId)
    const imgMaterials = materials.filter(m => m.type === 3 && m.ossFileId)
    const audioMaterials = materials.filter(m => m.type === 4 && m.ossFileId)

    const queries: Promise<void>[] = []

    // 文本：content 非空
    if (textMaterials.length > 0) {
        queries.push(
            prisma.textContentRecords.findMany({
                where: {
                    materialId: { in: textMaterials.map(m => m.id) },
                    content: { not: null },
                    deletedAt: null,
                },
                select: { materialId: true },
            }).then(records => {
                for (const r of records) {
                    if (r.materialId) resultMap.set(r.materialId, true)
                }
            })
        )
    }

    // 文档：status === 2
    if (docMaterials.length > 0) {
        const ossToMaterial = new Map(docMaterials.map(m => [m.ossFileId!, m.id]))
        queries.push(
            prisma.docRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...ossToMaterial.keys()] },
                    status: 2,
                    deletedAt: null,
                },
                select: { ossFileId: true },
            }).then(records => {
                const seen = new Set<number>()
                for (const r of records) {
                    if (r.ossFileId && !seen.has(r.ossFileId)) {
                        seen.add(r.ossFileId)
                        const materialId = ossToMaterial.get(r.ossFileId)
                        if (materialId) resultMap.set(materialId, true)
                    }
                }
            })
        )
    }

    // 图片：status === 2
    if (imgMaterials.length > 0) {
        const ossToMaterial = new Map(imgMaterials.map(m => [m.ossFileId!, m.id]))
        queries.push(
            prisma.imageRecognitionRecords.findMany({
                where: {
                    ossFileId: { in: [...ossToMaterial.keys()] },
                    status: 2,
                    deletedAt: null,
                },
                select: { ossFileId: true },
            }).then(records => {
                const seen = new Set<number>()
                for (const r of records) {
                    if (r.ossFileId && !seen.has(r.ossFileId)) {
                        seen.add(r.ossFileId)
                        const materialId = ossToMaterial.get(r.ossFileId)
                        if (materialId) resultMap.set(materialId, true)
                    }
                }
            })
        )
    }

    // 音频：status === 2
    if (audioMaterials.length > 0) {
        const ossToMaterial = new Map(audioMaterials.map(m => [m.ossFileId!, m.id]))
        queries.push(
            prisma.asrRecords.findMany({
                where: {
                    ossFileId: { in: [...ossToMaterial.keys()] },
                    status: 2,
                    deletedAt: null,
                },
                select: { ossFileId: true },
            }).then(records => {
                const seen = new Set<number>()
                for (const r of records) {
                    if (r.ossFileId && !seen.has(r.ossFileId)) {
                        seen.add(r.ossFileId)
                        const materialId = ossToMaterial.get(r.ossFileId)
                        if (materialId) resultMap.set(materialId, true)
                    }
                }
            })
        )
    }

    await Promise.all(queries)
    return resultMap
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run tests/server/material/batchCheckMaterialRecognized.test.ts --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/material/materialProcess.service.ts tests/server/material/batchCheckMaterialRecognized.test.ts
git commit -m "feat(analysis): 新增 batchCheckMaterialRecognizedService 批量检查材料识别状态"
```

---

## Task 3: 创建 `materialPipeline.service.ts` — 测试

**Files:**
- Create: `tests/server/material/materialPipeline.service.test.ts`

- [ ] **Step 1: 编写测试文件**

```typescript
/**
 * ensureMaterialsReadyService 测试
 *
 * 测试材料就绪保障 pipeline：
 * 获取材料 → 检查识别 → 对未识别的触发识别 → 检查嵌入 → 对未嵌入的触发嵌入
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'

const mocks = vi.hoisted(() => ({
    getMaterialsByCaseIdService: vi.fn(),
    batchCheckMaterialEmbeddedService: vi.fn(),
    batchCheckMaterialRecognizedService: vi.fn(),
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
    batchCheckMaterialRecognizedService: mocks.batchCheckMaterialRecognizedService,
}))
vi.mock('~~/server/services/material/materialProcess.service', () => ({
    processMaterialService: mocks.processMaterialService,
    batchCheckMaterialRecognizedService: mocks.batchCheckMaterialRecognizedService,
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

    it('全部已识别且已嵌入时不触发任何处理', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
            makeMaterial({ id: 2, type: 3, name: 'img1.png' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true], [2, true]])
        )
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, true], [2, true]])
        )

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.totalMaterials).toBe(2)
        expect(result.alreadyEmbedded).toBe(2)
        expect(result.newlyProcessed).toBe(0)
        expect(result.failed).toEqual([])
        expect(mocks.processMaterialService).not.toHaveBeenCalled()
        expect(mocks.embedMaterialUnifiedService).not.toHaveBeenCalled()
    })

    it('已识别但未嵌入 → 只触发嵌入，不触发识别', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true]])
        )
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(mocks.processMaterialService).not.toHaveBeenCalled()
        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledWith(1, userId)
        expect(result.newlyProcessed).toBe(1)
        expect(result.failed).toEqual([])
    })

    it('未识别且未嵌入 → 先识别再嵌入', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.processMaterialService.mockResolvedValue({ id: 1, status: 3 })
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(mocks.processMaterialService).toHaveBeenCalledWith(1, userId)
        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledWith(1, userId)
        expect(result.newlyProcessed).toBe(1)
    })

    it('识别失败时记录到 failed 数组但不阻断其他材料', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
            makeMaterial({ id: 2, type: 3, name: 'img1.png' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, false], [2, false]])
        )
        mocks.processMaterialService
            .mockRejectedValueOnce(new Error('PDF 解析失败'))
            .mockResolvedValueOnce({ id: 2, status: 3 })
        // id=1 识别失败不会进入嵌入检查，id=2 识别成功进入嵌入
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[2, false]])
        )
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
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true]])
        )
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.embedMaterialUnifiedService.mockRejectedValue(new Error('嵌入向量化失败'))

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].error).toBe('嵌入向量化失败')
    })

    it('返回的 embeddedMap 反映嵌入后的最终状态', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: 'doc1.pdf' }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true]])
        )
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        // embeddedMap 应该在嵌入操作后重新查询
        expect(result.embeddedMap).toBeDefined()
    })

    it('混合场景：全部已识别 + 部分已嵌入 + 部分未嵌入', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 1, name: '文本材料' }),
            makeMaterial({ id: 2, type: 2, name: '文档', ossFileId: 100 }),
            makeMaterial({ id: 3, type: 3, name: '图片', ossFileId: 200 }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        // 全部已识别
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true], [2, true], [3, true]])
        )
        // id=1 已嵌入，id=2 和 id=3 未嵌入
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, true], [2, false], [3, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        expect(result.alreadyEmbedded).toBe(1)
        expect(result.newlyProcessed).toBe(2)
        // 不触发识别
        expect(mocks.processMaterialService).not.toHaveBeenCalled()
        // id=2 和 id=3 触发嵌入
        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledTimes(2)
    })

    it('混合场景：部分未识别 + 识别后检查嵌入', async () => {
        const materials = [
            makeMaterial({ id: 1, type: 2, name: '已识别文档', ossFileId: 100 }),
            makeMaterial({ id: 2, type: 3, name: '未识别图片', ossFileId: 200 }),
        ]
        mocks.getMaterialsByCaseIdService.mockResolvedValue(materials)
        // id=1 已识别，id=2 未识别
        mocks.batchCheckMaterialRecognizedService.mockResolvedValue(
            new Map([[1, true], [2, false]])
        )
        mocks.processMaterialService.mockResolvedValue({ id: 2, status: 3 })
        // 识别完成后检查嵌入：都未嵌入
        mocks.batchCheckMaterialEmbeddedService.mockResolvedValue(
            new Map([[1, false], [2, false]])
        )
        mocks.embedMaterialUnifiedService.mockResolvedValue({ success: true })

        const result = await ensureMaterialsReadyService(caseId, userId)

        // 只有 id=2 触发识别
        expect(mocks.processMaterialService).toHaveBeenCalledTimes(1)
        expect(mocks.processMaterialService).toHaveBeenCalledWith(2, userId)
        // id=1 和 id=2 都触发嵌入
        expect(mocks.embedMaterialUnifiedService).toHaveBeenCalledTimes(2)
        expect(result.newlyProcessed).toBe(2)
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/materialPipeline.service.test.ts --reporter=verbose`
Expected: FAIL — `ensureMaterialsReadyService` 模块不存在

---

## Task 4: 创建 `materialPipeline.service.ts` — 实现

**Files:**
- Create: `server/services/material/materialPipeline.service.ts`

- [ ] **Step 1: 实现 `ensureMaterialsReadyService`**

```typescript
/**
 * 材料就绪保障 Pipeline
 *
 * 确保案件所有材料已完成识别和嵌入，供中间件和工具复用。
 * 只对未识别的触发识别，只对未嵌入的触发嵌入，避免重复处理。
 */
import { getMaterialsByCaseIdService, type MaterialWithFile } from './material.service'
import { batchCheckMaterialEmbeddedService, embedMaterialUnifiedService } from './materialEmbedding.service'
import { processMaterialService, batchCheckMaterialRecognizedService } from './materialProcess.service'

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

    const failed: MaterialFailedItem[] = []

    // 2. 识别阶段：检查识别状态，对未识别的触发识别
    const recognizedMap = await batchCheckMaterialRecognizedService(materials)
    const notRecognized = materials.filter(m => !recognizedMap.get(m.id))

    if (notRecognized.length > 0) {
        // 注意：对于异步识别的材料（PDF via MinerU、音频 via ASR），
        // processMaterialService 可能返回 PROCESSING 状态，
        // 后续嵌入会因内容为空而失败，这是预期行为。
        // TODO: 大量材料时考虑添加并发限制（p-limit）
        const recognitionResults = await Promise.allSettled(
            notRecognized.map(async (material) => {
                await processMaterialService(material.id, userId)
            })
        )

        for (let i = 0; i < recognitionResults.length; i++) {
            if (recognitionResults[i].status === 'rejected') {
                const reason = (recognitionResults[i] as PromiseRejectedResult).reason
                failed.push({
                    materialId: notRecognized[i].id,
                    name: notRecognized[i].name,
                    error: reason instanceof Error ? reason.message : String(reason),
                })
            }
        }
    }

    // 3. 嵌入阶段：检查嵌入状态，对未嵌入的触发嵌入
    const ids = materials.map(m => m.id)
    const embeddedMap = await batchCheckMaterialEmbeddedService(ids)

    const alreadyEmbedded = materials.filter(m => embeddedMap.get(m.id)).length
    const notEmbedded = materials.filter(m => !embeddedMap.get(m.id))

    let newlyProcessed = 0

    if (notEmbedded.length > 0) {
        // 排除识别阶段已失败的材料（不需要再尝试嵌入）
        const failedIds = new Set(failed.map(f => f.materialId))
        const toEmbed = notEmbedded.filter(m => !failedIds.has(m.id))

        const embeddingResults = await Promise.allSettled(
            toEmbed.map(async (material) => {
                await embedMaterialUnifiedService(material.id, userId)
            })
        )

        for (let i = 0; i < embeddingResults.length; i++) {
            if (embeddingResults[i].status === 'fulfilled') {
                newlyProcessed++
            } else {
                const reason = (embeddingResults[i] as PromiseRejectedResult).reason
                failed.push({
                    materialId: toEmbed[i].id,
                    name: toEmbed[i].name,
                    error: reason instanceof Error ? reason.message : String(reason),
                })
            }
        }
    }

    // 4. 获取最终嵌入状态
    const finalEmbeddedMap = notEmbedded.length > 0
        ? await batchCheckMaterialEmbeddedService(ids)
        : embeddedMap

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

## Task 5: 实现 `caseProcessMaterialMiddleware`

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

## Task 6: 重构 `processMaterials.tool.ts`

**Files:**
- Modify: `server/services/workflow/tools/processMaterials.tool.ts`

- [ ] **Step 1: 替换编排逻辑为 pipeline service 调用**

修改 `createTool` 函数内部：

```typescript
// 替换步骤 1-2 为：
const { materials, embeddedMap } = await ensureMaterialsReadyService(caseId, userId)
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

## Task 7: 类型检查和全量验证

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
