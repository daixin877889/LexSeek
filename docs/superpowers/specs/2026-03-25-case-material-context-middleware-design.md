# 案件材料上下文注入中间件设计

## 概述

在案件分析 Agent 启动前（`caseProcessMaterialMiddleware` 之后），通过第二个 `beforeAgent` 中间件获取材料内容，按 token 量决定全量/摘要模式，并以 HumanMessage 注入到 agent 的消息列表中。

**多轮对话支持**：通过 middleware stateSchema 扩展 agent state，持久化已注入的材料 id 列表（随 checkpoint 自动保存到 PostgreSQL）。多轮对话时对比 state 中的历史 ids 与当前 ids，只对新增材料生成增量上下文消息。

## 实现范围

1. **提取** `fetchMaterialContents`、`estimateTokens` 从 `processMaterials.tool.ts` 移到 `materialPipeline.service.ts`
2. **新增** `getMaterialContextService` 在 `materialPipeline.service.ts`
3. **新增** `buildMaterialContextMessage`、`buildIncrementalMaterialMessage` 在 `materialPipeline.service.ts`
4. **新增** `caseMaterialContextMiddleware` 在 `caseAnalysis.ts`（使用 stateSchema 扩展 state）
5. **重构** `processMaterials.tool.ts` 改用 `getMaterialContextService`
6. **增强** `search_case_materials` 工具，支持 sourceId 精确检索和范围限定
7. **清理** 旧版 `MaterialEmbeddingMetadata`，统一使用 `ContentEmbeddingMetadata`

## 设计详情

### 1. 提取到 `materialPipeline.service.ts` 的函数

将以下两个函数从 `processMaterials.tool.ts` 迁移到 `materialPipeline.service.ts` 并 export：

- `fetchMaterialContents(materials)` — 从各识别记录表获取材料实际内容，返回 `Map<materialId, string>`
- `estimateTokens(text)` — 简单 token 估算

新增常量 `TOKEN_THRESHOLD = 32000`（从 tool 迁移）。

新增辅助函数：

- `getSourceId(material)` — 按材料类型返回向量表中的 sourceId（文本类型 sourceId=materialId，文档/图片/音频类型 sourceId=ossFileId）

### 2. `getMaterialContextService`

```typescript
export interface MaterialContextItem {
    sourceId: number
    name: string
    type: number
    hasContent: boolean
    content?: string    // full 模式
    summary?: string    // summary 模式
}

export interface MaterialContextResult {
    mode: 'full' | 'summary' | 'empty'
    totalTokens: number
    materialList: MaterialContextItem[]
}

export async function getMaterialContextService(
    materials: MaterialWithFile[],
    tokenThreshold?: number
): Promise<MaterialContextResult>
```

**内部流程**：
1. 空材料返回 `{ mode: 'empty', totalTokens: 0, materialList: [] }`
2. `fetchMaterialContents(materials)` 获取内容
3. `estimateTokens` 计算总 token 量
4. 按阈值判断 full/summary 模式
5. 构建 `materialList`：full 模式包含完整 content，summary 模式包含摘要

### 3. 消息构建函数

#### `buildMaterialContextMessage`

```typescript
export function buildMaterialContextMessage(context: MaterialContextResult): string
```

首次注入，将完整 `MaterialContextResult` 格式化为结构化文本。

**full 模式输出**：
```
以下是本案件的全部材料内容，请基于这些材料进行分析：

## [sourceId=2] 起诉状.pdf
[完整内容]

## [sourceId=5] 证据清单.docx
[完整内容]
```

**summary 模式输出**：
```
本案件共有 N 份材料，材料量较大，以下为摘要信息。需要详细内容时请使用 search_case_materials 工具，传入 sourceId 精确检索。

- [sourceId=2] 起诉状.pdf（摘要：xxx...）
- [sourceId=5] 证据清单.docx（摘要：xxx...）
```

> 注意：full 和 summary 格式中都包含 `[sourceId=N]` 标记，方便 agent 在后续对话中使用 `search_case_materials({ sourceId: N })` 精确检索。

#### `buildIncrementalMaterialMessage`

```typescript
export function buildIncrementalMaterialMessage(context: MaterialContextResult): string
```

增量注入（仅新增材料），固定使用 summary 格式，格式化为变更通知。

**输出**：
```
案件新增了以下材料，需要详细内容时请使用 search_case_materials 工具，传入 sourceId 精确检索。

- [sourceId=8] 补充证据.pdf（摘要：xxx...）
```

### 4. `caseMaterialContextMiddleware`

**位置**：`server/services/agent/caseAnalysis.ts`

**持久化方案**：使用 `createMiddleware` 的 `stateSchema` 扩展 agent state，新增 `_injectedSourceIds` 字段。该字段随 checkpoint 自动持久化到 PostgreSQL，无需手动操作 Store。

> **技术验证**：langchain 的 `createAgentState()` 会遍历所有 middleware 的 stateSchema 并合并到 agent 的完整 state 中。`beforeAgent` hook 可直接读取扩展字段，返回的 partial state 会被合并回去并持久化。以 `_` 开头的字段不会出现在 input/output schema 中（私有字段）。

```typescript
const caseMaterialContextMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: "CaseMaterialContextMiddleware",
        stateSchema: {
            _injectedSourceIds: z.array(z.number()).default([]),
        },
        beforeAgent: {
            hook: async (state) => {
                try {
                    // 1. 获取当前材料
                    const materials = await getMaterialsByCaseIdService(caseId)
                    if (materials.length === 0) return

                    // 2. 从 state 读取已注入的 sourceId 列表（自动从 checkpoint 恢复）
                    const prevSourceIds: number[] = state._injectedSourceIds ?? []
                    const currentSourceIds = materials.map(m => getSourceId(m))

                    // 3. 判断是首次注入还是增量
                    const isFirstInjection = prevSourceIds.length === 0
                    const newSourceIds = currentSourceIds.filter(id => !prevSourceIds.includes(id))

                    // 无变化则跳过
                    if (!isFirstInjection && newSourceIds.length === 0) return

                    // 4. 获取材料上下文
                    if (isFirstInjection) {
                        // 首次：按 token 阈值判断 full/summary
                        const context = await getMaterialContextService(materials)
                        if (context.mode === 'empty') return

                        const messageText = buildMaterialContextMessage(context)

                        // 在 SystemMessage 之后插入
                        const systemIdx = state.messages.findIndex(
                            m => m._getType() === 'system'
                        )
                        const insertIdx = systemIdx >= 0 ? systemIdx + 1 : 0
                        state.messages.splice(insertIdx, 0, new HumanMessage(messageText))

                        logger.info('材料上下文已注入（首次）', {
                            caseId,
                            mode: context.mode,
                            materialCount: currentSourceIds.length,
                            totalTokens: context.totalTokens,
                        })
                    } else {
                        // 增量：固定 summary 模式
                        const newSourceIdSet = new Set(newSourceIds)
                        const newMaterials = materials.filter(m => newSourceIdSet.has(getSourceId(m)))
                        const context = await getMaterialContextService(newMaterials)
                        if (context.mode === 'empty') return

                        const messageText = buildIncrementalMaterialMessage(context)

                        // 在用户最新消息前插入（倒数第二位）
                        const insertIdx = Math.max(0, state.messages.length - 1)
                        state.messages.splice(insertIdx, 0, new HumanMessage(messageText))

                        logger.info('材料上下文已注入（增量）', {
                            caseId,
                            newMaterialCount: newSourceIds.length,
                        })
                    }

                    // 5. 返回更新后的 state（自动持久化到 checkpoint）
                    return { _injectedSourceIds: currentSourceIds }
                } catch (error) {
                    logger.error('材料上下文注入异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}
```

**要点**：
- `_injectedSourceIds` 以 `_` 开头，标记为私有字段（不暴露到 input/output schema）
- 通过 `return { _injectedSourceIds: currentSourceIds }` 更新 state，自动随 checkpoint 持久化
- 使用 `getSourceId(material)` 获取每个材料对应的 sourceId
- 多轮对话时 state 从 checkpoint 恢复，`prevSourceIds` 自动包含上次注入的 ids
- 无需 Store 实例，无需额外传参
- 闭包只需 `userId` 和 `caseId` 两个参数
- 首次注入插入 SystemMessage 之后，增量注入插入用户最新消息之前
- try-catch 包裹，异常不阻断 agent

### 5. 中间件注册

```typescript
const agent = createAgent({
    // ...
    middleware: [
        caseProcessMaterialMiddleware(userId!, caseId!),
        caseMaterialContextMiddleware(userId!, caseId!),
    ],
})
```

### 6. 增强 `search_case_materials` 工具

#### 背景

当前向量表 `case_material_embeddings` 使用新版 `ContentEmbeddingMetadata`：

```typescript
interface ContentEmbeddingMetadata {
    source: 'doc' | 'audio' | 'image' | 'text'
    userId: number
    sourceId: number      // 文本=materialId, 文档/图片/音频=ossFileId
    sourceName: string    // 文件名或材料名称
    last_embedding_at: string
    chunkIndex: number
}
```

**关键映射关系**：
| 材料类型 | sourceId 值 |
|---------|------------|
| 文本 (CASE_CONTENT=1) | materialId |
| 文档 (DOCUMENT=2) | ossFileId |
| 图片 (IMAGE=3) | ossFileId |
| 音频 (AUDIO=4) | ossFileId |

#### 新 schema

```typescript
const schema = z.object({
    query: z.string().optional().describe('语义查询内容，用于搜索相关的材料片段'),
    sourceId: z.number().optional().describe('材料 sourceId，精确检索或限定语义搜索范围到指定材料'),
    k: z.number().optional().default(5).describe('返回结果数量，默认为 5'),
}).refine(
    data => data.query || data.sourceId,
    { message: '至少需要提供 query 或 sourceId' }
)
```

#### 检索模式

| 参数组合 | 行为 |
|---------|------|
| `query` only | 语义搜索，通过 caseId→材料列表→sourceId 集合限定案件范围 |
| `query` + `sourceId` | 语义搜索，范围限定到指定 sourceId |
| `sourceId` only | 精确查询，从识别记录表获取该材料完整内容（`fetchMaterialContents`） |

#### 内部实现

```typescript
async (input) => {
    const { query, sourceId, k = 5 } = input

    // 1. 获取案件材料列表
    const allMaterials = await getMaterialsByCaseIdService(caseId)

    // 2. 按 sourceId 过滤（如果指定）
    const targetMaterials = sourceId
        ? allMaterials.filter(m => getSourceId(m) === sourceId)
        : allMaterials

    if (targetMaterials.length === 0) {
        return JSON.stringify({ error: '未找到指定材料' })
    }

    // 3. 无 query → 精确查询完整内容
    if (!query) {
        const contentMap = await fetchMaterialContents(targetMaterials)
        return JSON.stringify(formatExactResults(targetMaterials, contentMap))
    }

    // 4. 有 query → 向量语义搜索，用 sourceId IN 限定范围
    const sourceIds = targetMaterials.map(m => getSourceId(m))
    const filter = {
        userId,
        sourceId: { in: sourceIds.map(String) },
    }
    const results = await similaritySearchWithScore(query, k, filter, caseMaterialVectorConfig)

    // 5. 格式化结果
    return JSON.stringify(results.map(([doc, score], index) => {
        const metadata = doc.metadata as ContentEmbeddingMetadata
        return {
            index: index + 1,
            content: doc.pageContent,
            source: {
                sourceId: metadata.sourceId,
                sourceName: metadata.sourceName,
                chunkIndex: metadata.chunkIndex,
            },
            relevanceScore: Number(score.toFixed(4)),
        }
    }))
}
```

**`getSourceId` 辅助函数**：

```typescript
export function getSourceId(material: MaterialWithFile): number {
    // 文本类型用 materialId，其他类型用 ossFileId
    if (material.type === CaseMaterialType.CASE_CONTENT) {
        return material.id
    }
    return material.ossFileId!
}
```

> 注意：PGVectorStore 的 filter 支持 `{ in: [...] }` 操作符（已通过源码确认，`buildFilterClauses` 中处理 `_value.in` 数组生成 `IN (...)` SQL 子句）。

### 7. 清理旧版 `MaterialEmbeddingMetadata`

#### 背景

`materialEmbedding.service.ts` 中存在两套 metadata 接口：

**旧版（应删除）**：
```typescript
interface MaterialEmbeddingMetadata {
    userId: number
    caseId: number          // 新版中已不存在
    materialId: number      // 新版改为 sourceId
    sessionId: string       // 新版中已不存在
    materialName: string    // 新版改为 sourceName
    materialType: number    // 新版改为 source（字符串枚举）
    chunkIndex: number
    lastEmbeddingAt: string // 新版改为 last_embedding_at
}
```

**新版（保留）**：
```typescript
interface ContentEmbeddingMetadata {
    source: 'doc' | 'audio' | 'image' | 'text'
    userId: number
    sourceId: number
    sourceName: string
    last_embedding_at: string
    chunkIndex: number
}
```

#### 清理内容

1. **删除** `MaterialEmbeddingMetadata` 接口定义
2. **删除** 使用旧版接口的嵌入函数（`embedMaterialService`、`embedMaterialsBatchService`、旧版 `splitMaterialContent`）
3. **修正** `searchCaseMaterialsService` 中结果映射，从 `metadata.materialId`/`metadata.materialName` 改为 `metadata.sourceId`/`metadata.sourceName`
4. **修正** `MaterialSearchResult` 接口，确保字段与新版 metadata 对齐
5. **修正** `searchCaseMaterialsService` 的 filter，从 `{ userId, caseId }` 改为通过 caseId→sourceId 集合限定范围（与工具增强方案一致）
6. **更新** 相关测试

### 8. 重构 `processMaterials.tool.ts`

- 删除 `fetchMaterialContents`、`estimateTokens`、`TOKEN_THRESHOLD`
- 改为 import 并调用 `getMaterialContextService`
- tool 仍需调用 `ensureMaterialsReadyService` 获取 `embeddedMap`（用于 `embedded` 字段），再将返回的 `materials` 传给 `getMaterialContextService`
- tool 在 `getMaterialContextService` 返回的 `materialList` 基础上补充 `embedded`、`tokenCount` 等 tool 特有字段

**tool 调用流程**：
```typescript
const { materials, embeddedMap } = await ensureMaterialsReadyService(caseId, userId)
const context = await getMaterialContextService(materials)
// 在 context.materialList 基础上补充 embedded 字段构建最终返回
```

## State 持久化机制

middleware 通过 `stateSchema` 声明 `_injectedSourceIds` 字段，langchain 的 `createAgentState()` 将其合并到 agent 的完整 state 中。该字段随 StateGraph checkpoint 自动持久化到 PostgreSQL（通过 PostgresSaver），多轮对话时自动恢复。

```
state._injectedSourceIds: number[]  // e.g. [2, 5, 8]
```

每次注入后通过 hook 返回值更新为当前完整的 sourceId 列表。下次 beforeAgent 执行时从 state 中读取历史 sourceIds，与当前 sourceIds 对比得出增量。
