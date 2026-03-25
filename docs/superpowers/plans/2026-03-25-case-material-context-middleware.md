# 案件材料上下文注入中间件实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将材料内容获取和上下文注入逻辑抽象到 pipeline service，实现 caseMaterialContextMiddleware 中间件（支持首次全量/增量注入），增强 search_case_materials 工具支持 sourceId 精确检索，清理旧版 MaterialEmbeddingMetadata。

**Architecture:** 从 processMaterials.tool.ts 提取 fetchMaterialContents/estimateTokens 到 materialPipeline.service.ts，新增 getMaterialContextService 和消息构建函数。中间件通过 stateSchema 扩展 state 持久化已注入的 sourceId 列表。工具增强通过 caseId→sourceId 集合限定案件范围。

**Tech Stack:** TypeScript, LangChain middleware (stateSchema), Prisma, PGVectorStore, Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-case-material-context-middleware-design.md`

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `server/services/material/materialPipeline.service.ts` | 新增 fetchMaterialContents, estimateTokens, getSourceId, getMaterialContextService, buildMaterialContextMessage, buildIncrementalMaterialMessage |
| Modify | `server/services/material/materialEmbedding.service.ts` | 清理旧版 metadata/函数，修正 searchCaseMaterialsService |
| Modify | `server/services/workflow/tools/processMaterials.tool.ts` | 删除迁移到 pipeline 的函数，改用 getMaterialContextService |
| Modify | `server/services/workflow/tools/searchCaseMaterials.tool.ts` | 增强 schema 支持 sourceId |
| Modify | `server/services/material/materialSearch.tool.ts` | 增强 createMaterialSearchTool 支持 sourceId |
| Modify | `server/services/agent/caseAnalysis.ts` | 新增 caseMaterialContextMiddleware |
| Modify | `server/api/v1/material/search.post.ts` | 适配 MaterialSearchResult 字段变更 |
| Create | `tests/server/material/materialContext.service.test.ts` | getMaterialContextService + 消息构建函数测试 |
| Create | `tests/server/material/searchCaseMaterials.enhanced.test.ts` | 增强后的检索工具测试 |

---

## Task 1: 清理旧版 MaterialEmbeddingMetadata

**Files:**
- Modify: `server/services/material/materialEmbedding.service.ts`

- [ ] **Step 1: 确认旧版函数无外部引用**

Run: `grep -rn "embedMaterialService\b\|embedMaterialsBatchService\|splitMaterialContent\|MaterialEmbeddingMetadata\|EmbedMaterialInput\|EmbedMaterialResult" server/ --include="*.ts" | grep -v "materialEmbedding.service.ts" | grep -v ".test.ts"`
Expected: 无匹配（仅文档引用）

- [ ] **Step 2: 删除旧版接口和函数**

在 `server/services/material/materialEmbedding.service.ts` 中删除：
- `MaterialEmbeddingMetadata` 接口（行 29-47）
- `EmbedMaterialInput` 接口（行 69-84）
- `EmbedMaterialResult` 接口（行 86-94）
- `splitMaterialContent` 函数（使用旧版 metadata 的，行 142-173）
- `embedMaterialService` 函数（行 227-293）
- `embedMaterialsBatchService` 函数（行 295-328）

保留所有新版函数（`embedTextService`, `embedDocumentService`, `embedImageService`, `embedAudioService`, `embedMaterialUnifiedService` 等）。

- [ ] **Step 3: 修正 MaterialSearchResult 接口**

```typescript
// 修改前
export interface MaterialSearchResult {
    content: string
    materialId: number
    materialName: string
    score: number
    chunkIndex: number
}

// 修改后
export interface MaterialSearchResult {
    content: string
    sourceId: number
    sourceName: string
    score: number
    chunkIndex: number
}
```

- [ ] **Step 4: 修正 searchCaseMaterialsService**

修改 `searchCaseMaterialsService` 中的结果映射：

```typescript
// 修改前
const searchResults: MaterialSearchResult[] = results.map(([doc, score]) => {
    const metadata = doc.metadata as MaterialEmbeddingMetadata
    return {
        content: doc.pageContent,
        materialId: metadata.materialId,
        materialName: metadata.materialName,
        score,
        chunkIndex: metadata.chunkIndex,
    }
})

// 修改后
const searchResults: MaterialSearchResult[] = results.map(([doc, score]) => {
    const metadata = doc.metadata as ContentEmbeddingMetadata
    return {
        content: doc.pageContent,
        sourceId: metadata.sourceId,
        sourceName: metadata.sourceName,
        score,
        chunkIndex: metadata.chunkIndex,
    }
})
```

- [ ] **Step 5: 修正 searchCaseMaterialsService 的 filter**

`searchCaseMaterialsService` 需要新增 `materialIds` 参数来支持 sourceId 范围限定：

```typescript
// 修改签名
export async function searchCaseMaterialsService(
    userId: number,
    caseId: number,
    query: string,
    k: number = 5,
    sourceIds?: number[],
): Promise<MaterialSearchResult[]> {
    // filter 改为 sourceId 范围限定
    const filter: Record<string, any> = { userId }
    if (sourceIds && sourceIds.length > 0) {
        filter.sourceId = { in: sourceIds.map(String) }
    }
    const results = await similaritySearchWithScore(query, k, filter, caseMaterialVectorConfig)
    // ...
}
```

- [ ] **Step 6: 修正 search.post.ts 适配字段变更**

`server/api/v1/material/search.post.ts` 中将 `item.materialId`/`item.materialName` 改为 `item.sourceId`/`item.sourceName`。

同时修正：调用 `searchCaseMaterialsService` 时传入 sourceIds 参数（通过 caseId 查材料列表映射）。

- [ ] **Step 7: 修正 materialSearch.tool.ts 适配字段变更**

`server/services/material/materialSearch.tool.ts` 中 `formatSearchResults` 将 `result.materialId`/`result.materialName` 改为 `result.sourceId`/`result.sourceName`。

- [ ] **Step 8: 运行现有测试确认无回归**

Run: `npx vitest run tests/server/material/ --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 9: 提交**

```bash
git add server/services/material/materialEmbedding.service.ts server/api/v1/material/search.post.ts server/services/material/materialSearch.tool.ts
git commit -m "refactor(analysis): 清理旧版 MaterialEmbeddingMetadata，统一使用 ContentEmbeddingMetadata"
```

---

## Task 2: 提取函数到 materialPipeline.service.ts — 测试

**Files:**
- Create: `tests/server/material/materialContext.service.test.ts`

- [ ] **Step 1: 编写 getSourceId 和 estimateTokens 测试**

```typescript
/**
 * materialPipeline.service 上下文相关函数测试
 *
 * 测试：getSourceId, estimateTokens, getMaterialContextService,
 * buildMaterialContextMessage, buildIncrementalMaterialMessage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MaterialWithFile } from '../../../server/services/material/material.service'
import { CaseMaterialType } from '#shared/types/case'

const mockPrisma = {
    textContentRecords: { findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn() },
}
vi.stubGlobal('prisma', mockPrisma)

import {
    getSourceId,
    estimateTokens,
    getMaterialContextService,
    buildMaterialContextMessage,
    buildIncrementalMaterialMessage,
} from '../../../server/services/material/materialPipeline.service'

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

describe('getSourceId', () => {
    it('文本材料返回 materialId', () => {
        const m = makeMaterial({ id: 10, type: CaseMaterialType.CASE_CONTENT, name: '案情' })
        expect(getSourceId(m)).toBe(10)
    })

    it('文档材料返回 ossFileId', () => {
        const m = makeMaterial({ id: 10, type: CaseMaterialType.DOCUMENT, name: 'doc', ossFileId: 100 })
        expect(getSourceId(m)).toBe(100)
    })

    it('图片材料返回 ossFileId', () => {
        const m = makeMaterial({ id: 10, type: CaseMaterialType.IMAGE, name: 'img', ossFileId: 200 })
        expect(getSourceId(m)).toBe(200)
    })

    it('音频材料返回 ossFileId', () => {
        const m = makeMaterial({ id: 10, type: CaseMaterialType.AUDIO, name: 'audio', ossFileId: 300 })
        expect(getSourceId(m)).toBe(300)
    })
})

describe('estimateTokens', () => {
    it('空字符串返回 0', () => {
        expect(estimateTokens('')).toBe(0)
    })

    it('中文约 2 字符/token', () => {
        const text = '你好世界' // 4 个中文字符 → 约 2 tokens
        expect(estimateTokens(text)).toBe(2)
    })

    it('英文约 4 字符/token', () => {
        const text = 'hello world' // 11 个字符 → 约 2.75 → ceil → 3 tokens
        expect(estimateTokens(text)).toBe(3)
    })
})

describe('getMaterialContextService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockPrisma.textContentRecords.findMany.mockResolvedValue([])
        mockPrisma.docRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.imageRecognitionRecords.findMany.mockResolvedValue([])
        mockPrisma.asrRecords.findMany.mockResolvedValue([])
    })

    it('空材料返回 empty 模式', async () => {
        const result = await getMaterialContextService([])
        expect(result.mode).toBe('empty')
        expect(result.materialList).toEqual([])
    })

    it('小量内容返回 full 模式', async () => {
        const materials = [
            makeMaterial({ id: 1, type: CaseMaterialType.CASE_CONTENT, name: '案情描述' }),
        ]
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, content: '短文本内容' },
        ])

        const result = await getMaterialContextService(materials)

        expect(result.mode).toBe('full')
        expect(result.materialList).toHaveLength(1)
        expect(result.materialList[0].content).toBe('短文本内容')
        expect(result.materialList[0].sourceId).toBe(1)
    })

    it('超过阈值返回 summary 模式', async () => {
        const materials = [
            makeMaterial({ id: 1, type: CaseMaterialType.CASE_CONTENT, name: '案情描述' }),
        ]
        // 制造一个超大内容
        const longContent = '这是一段很长的中文内容。'.repeat(10000)
        mockPrisma.textContentRecords.findMany.mockResolvedValue([
            { materialId: 1, content: longContent },
        ])

        const result = await getMaterialContextService(materials, 100) // 低阈值强制 summary

        expect(result.mode).toBe('summary')
        expect(result.materialList[0].summary).toBeDefined()
        expect(result.materialList[0].content).toBeUndefined()
    })

    it('无内容的材料 hasContent 为 false', async () => {
        const materials = [
            makeMaterial({ id: 1, type: CaseMaterialType.DOCUMENT, name: 'doc.pdf', ossFileId: 100 }),
        ]

        const result = await getMaterialContextService(materials)

        expect(result.materialList[0].hasContent).toBe(false)
    })
})

describe('buildMaterialContextMessage', () => {
    it('full 模式包含完整内容和 sourceId 标记', () => {
        const context = {
            mode: 'full' as const,
            totalTokens: 100,
            materialList: [
                { sourceId: 2, name: '起诉状.pdf', type: 2, hasContent: true, content: '起诉内容...' },
            ],
        }
        const msg = buildMaterialContextMessage(context)
        expect(msg).toContain('[sourceId=2]')
        expect(msg).toContain('起诉状.pdf')
        expect(msg).toContain('起诉内容...')
    })

    it('summary 模式包含摘要和检索提示', () => {
        const context = {
            mode: 'summary' as const,
            totalTokens: 50000,
            materialList: [
                { sourceId: 2, name: '起诉状.pdf', type: 2, hasContent: true, summary: '摘要...' },
            ],
        }
        const msg = buildMaterialContextMessage(context)
        expect(msg).toContain('[sourceId=2]')
        expect(msg).toContain('search_case_materials')
        expect(msg).toContain('sourceId')
    })
})

describe('buildIncrementalMaterialMessage', () => {
    it('固定 summary 格式，包含新增提示', () => {
        const context = {
            mode: 'summary' as const,
            totalTokens: 100,
            materialList: [
                { sourceId: 8, name: '补充证据.pdf', type: 2, hasContent: true, summary: '补充...' },
            ],
        }
        const msg = buildIncrementalMaterialMessage(context)
        expect(msg).toContain('新增')
        expect(msg).toContain('[sourceId=8]')
        expect(msg).toContain('search_case_materials')
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/materialContext.service.test.ts --reporter=verbose`
Expected: FAIL — 函数不存在

---

## Task 3: 提取函数到 materialPipeline.service.ts — 实现

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts`

- [ ] **Step 1: 添加 getSourceId, estimateTokens, TOKEN_THRESHOLD, fetchMaterialContents**

在 `materialPipeline.service.ts` 中新增（从 `processMaterials.tool.ts` 迁移 `fetchMaterialContents` 和 `estimateTokens`，新增 `getSourceId`）：

```typescript
import { CaseMaterialType } from '#shared/types/case'

export const TOKEN_THRESHOLD = 32000

/** 按材料类型返回向量表中的 sourceId */
export function getSourceId(material: MaterialWithFile): number {
    if (material.type === CaseMaterialType.CASE_CONTENT) {
        return material.id
    }
    return material.ossFileId!
}

/** 简单 token 估算（中文约 2 字符/token，英文约 4 字符/token） */
export function estimateTokens(text: string): number {
    if (!text) return 0
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const otherChars = text.length - chineseChars
    return Math.ceil(chineseChars / 2 + otherChars / 4)
}

/**
 * 从各识别记录表获取材料的实际内容
 * 返回 Map<materialId, content>
 */
export async function fetchMaterialContents(
    materials: { id: number; type: number; ossFileId: number | null }[]
): Promise<Map<number, string>> {
    // 从 processMaterials.tool.ts 原样迁移，使用 CaseMaterialType 枚举替代魔法数字
}
```

- [ ] **Step 2: 添加 getMaterialContextService**

```typescript
export interface MaterialContextItem {
    sourceId: number
    name: string
    type: number
    hasContent: boolean
    content?: string
    summary?: string
}

export interface MaterialContextResult {
    mode: 'full' | 'summary' | 'empty'
    totalTokens: number
    materialList: MaterialContextItem[]
}

export async function getMaterialContextService(
    materials: MaterialWithFile[],
    tokenThreshold: number = TOKEN_THRESHOLD,
): Promise<MaterialContextResult> {
    if (materials.length === 0) {
        return { mode: 'empty', totalTokens: 0, materialList: [] }
    }

    const contentMap = await fetchMaterialContents(materials)

    let totalTokens = 0
    for (const content of contentMap.values()) {
        totalTokens += estimateTokens(content)
    }

    const isFullMode = totalTokens < tokenThreshold

    const materialList: MaterialContextItem[] = materials.map(m => {
        const content = contentMap.get(m.id)
        return {
            sourceId: getSourceId(m),
            name: m.name,
            type: m.type,
            hasContent: !!content,
            ...(isFullMode && content
                ? { content }
                : { summary: m.summary || (content ? content.substring(0, 200) + '...' : `[材料: ${m.name}，暂无内容]`) }),
        }
    })

    return {
        mode: isFullMode ? 'full' : 'summary',
        totalTokens,
        materialList,
    }
}
```

- [ ] **Step 3: 添加消息构建函数**

```typescript
export function buildMaterialContextMessage(context: MaterialContextResult): string {
    if (context.mode === 'full') {
        const header = '以下是本案件的全部材料内容，请基于这些材料进行分析：\n'
        const body = context.materialList
            .map(m => `## [sourceId=${m.sourceId}] ${m.name}\n${m.content || '[暂无内容]'}`)
            .join('\n\n')
        return header + '\n' + body
    }

    // summary 模式
    const header = `本案件共有 ${context.materialList.length} 份材料，材料量较大，以下为摘要信息。需要详细内容时请使用 search_case_materials 工具，传入 sourceId 精确检索。\n`
    const body = context.materialList
        .map(m => `- [sourceId=${m.sourceId}] ${m.name}（摘要：${m.summary || '暂无'}）`)
        .join('\n')
    return header + '\n' + body
}

export function buildIncrementalMaterialMessage(context: MaterialContextResult): string {
    const header = '案件新增了以下材料，需要详细内容时请使用 search_case_materials 工具，传入 sourceId 精确检索。\n'
    const body = context.materialList
        .map(m => `- [sourceId=${m.sourceId}] ${m.name}（摘要：${m.summary || '暂无'}）`)
        .join('\n')
    return header + '\n' + body
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/material/materialContext.service.test.ts --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/material/materialPipeline.service.ts tests/server/material/materialContext.service.test.ts
git commit -m "feat(analysis): 新增 getMaterialContextService 和消息构建函数"
```

---

## Task 4: 实现 caseMaterialContextMiddleware

**Files:**
- Modify: `server/services/agent/caseAnalysis.ts`

- [ ] **Step 1: 添加 import 和 caseMaterialContextMiddleware**

在 `caseAnalysis.ts` 中添加：

```typescript
import {
    getMaterialContextService,
    buildMaterialContextMessage,
    buildIncrementalMaterialMessage,
    getSourceId,
} from '../material/materialPipeline.service'
import { getMaterialsByCaseIdService } from '../material/material.service'
import { z } from 'zod'
```

添加 `caseMaterialContextMiddleware` 函数（按设计文档 §4 的完整代码）。

- [ ] **Step 2: 更新中间件注册**

```typescript
middleware: [
    caseProcessMaterialMiddleware(userId!, caseId!),
    caseMaterialContextMiddleware(userId!, caseId!),
],
```

- [ ] **Step 3: 提交**

```bash
git add server/services/agent/caseAnalysis.ts
git commit -m "feat(analysis): 实现 caseMaterialContextMiddleware 上下文注入中间件"
```

---

## Task 5: 增强 search_case_materials 工具 — 测试

**Files:**
- Create: `tests/server/material/searchCaseMaterials.enhanced.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
/**
 * search_case_materials 增强功能测试
 *
 * 测试三种检索模式：
 * - query only: 语义搜索，caseId→sourceId 限定范围
 * - query + sourceId: 语义搜索，限定到指定 sourceId
 * - sourceId only: 精确查询完整内容
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
    getMaterialsByCaseIdService: vi.fn(),
    searchCaseMaterials: vi.fn(),
    fetchMaterialContents: vi.fn(),
}))

vi.mock('../../../server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: mocks.getMaterialsByCaseIdService,
}))
vi.mock('../../../server/services/material/materialSearch.tool', () => ({
    searchCaseMaterials: mocks.searchCaseMaterials,
}))
vi.mock('~~/server/services/material/materialSearch.tool', () => ({
    searchCaseMaterials: mocks.searchCaseMaterials,
}))
vi.mock('../../../server/services/material/materialPipeline.service', async (importOriginal) => {
    const original = await importOriginal() as any
    return {
        ...original,
        fetchMaterialContents: mocks.fetchMaterialContents,
    }
})
vi.mock('~~/server/services/material/materialPipeline.service', async (importOriginal) => {
    const original = await importOriginal() as any
    return {
        ...original,
        fetchMaterialContents: mocks.fetchMaterialContents,
    }
})

// 测试工具的核心逻辑（从 tool 中提取的内部函数）
// 具体 import 路径根据实现调整

describe('search_case_materials 增强', () => {
    // 测试用例根据实现细节在实现时补充
    it('placeholder - 验证 sourceId 参数在 schema 中定义', () => {
        expect(true).toBe(true) // 将在实现时替换
    })
})
```

> 注意：search_case_materials 是 LangChain tool，直接单元测试其内部逻辑。具体测试需要在 Task 6 实现后根据实际代码结构调整 mock 和 import。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/material/searchCaseMaterials.enhanced.test.ts --reporter=verbose`

---

## Task 6: 增强 search_case_materials 工具 — 实现

**Files:**
- Modify: `server/services/workflow/tools/searchCaseMaterials.tool.ts`
- Modify: `server/services/material/materialSearch.tool.ts`

- [ ] **Step 1: 更新 searchCaseMaterials.tool.ts schema 和实现**

修改 schema 新增 `sourceId` 参数：

```typescript
const schema = z.object({
    query: z.string().optional().describe('语义查询内容，用于搜索相关的材料片段'),
    sourceId: z.number().optional().describe('材料 sourceId，精确检索或限定语义搜索范围到指定材料'),
    k: z.number().optional().default(5).describe('返回结果数量，默认为 5'),
})
```

修改 `createTool` 内部逻辑，按设计文档 §6 实现三种检索模式。

- [ ] **Step 2: 更新 materialSearch.tool.ts**

同步更新 `createMaterialSearchTool` 的 schema 和逻辑，与 `searchCaseMaterials.tool.ts` 保持一致。

- [ ] **Step 3: 更新增强测试**

回到 `tests/server/material/searchCaseMaterials.enhanced.test.ts`，补充真实测试用例。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/server/material/searchCaseMaterials.enhanced.test.ts --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/tools/searchCaseMaterials.tool.ts server/services/material/materialSearch.tool.ts tests/server/material/searchCaseMaterials.enhanced.test.ts
git commit -m "feat(analysis): 增强 search_case_materials 工具支持 sourceId 精确检索"
```

---

## Task 7: 重构 processMaterials.tool.ts

**Files:**
- Modify: `server/services/workflow/tools/processMaterials.tool.ts`

- [ ] **Step 1: 删除迁移到 pipeline 的函数**

删除 `fetchMaterialContents`、`estimateTokens`、`TOKEN_THRESHOLD`，替换为 import：

```typescript
import {
    getMaterialContextService,
    type MaterialContextResult,
} from '../../material/materialPipeline.service'
```

- [ ] **Step 2: 修改 createTool 内部逻辑**

```typescript
// 替换步骤 2-4 为：
const context = await getMaterialContextService(materials)

// 在 context.materialList 基础上补充 embedded 字段
const materialList = context.materialList.map(m => ({
    ...m,
    tokenCount: m.content ? estimateTokens(m.content) : 0,
    embedded: embeddedMap.get(/* 需要反向映射 sourceId→materialId */) ?? false,
}))
```

> 注意：tool 需要从 `ensureMaterialsReadyService` 获取 `embeddedMap`，其 key 是 materialId。需要适配。

- [ ] **Step 3: 运行测试确认无回归**

Run: `npx vitest run tests/server/material/ --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add server/services/workflow/tools/processMaterials.tool.ts
git commit -m "refactor(analysis): processMaterials tool 改用 getMaterialContextService"
```

---

## Task 8: 类型检查和全量验证

**Files:** 无新文件

- [ ] **Step 1: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 2: 运行全量测试**

Run: `npx vitest run --reporter=verbose`
Expected: 全部 PASS，无回归

- [ ] **Step 3: 如有修复则提交**

```bash
git commit -m "fix(analysis): 修复类型检查/测试问题"
```
