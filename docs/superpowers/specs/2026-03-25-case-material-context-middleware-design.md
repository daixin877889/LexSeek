# 案件材料上下文注入中间件设计

## 概述

在案件分析 Agent 启动前（`caseProcessMaterialMiddleware` 之后），通过第二个 `beforeAgent` 中间件获取材料内容，按 token 量决定全量/摘要模式，并以 HumanMessage 注入到 agent 的消息列表中。

**多轮对话支持**：通过 LangGraph Store 持久化已注入的材料 id 列表，多轮对话时只对新增材料生成增量上下文消息。

## 实现范围

1. **提取** `fetchMaterialContents`、`estimateTokens` 从 `processMaterials.tool.ts` 移到 `materialPipeline.service.ts`
2. **新增** `getMaterialContextService` 在 `materialPipeline.service.ts`
3. **新增** `buildMaterialContextMessage`、`buildIncrementalMaterialMessage` 在 `materialPipeline.service.ts`
4. **新增** `caseMaterialContextMiddleware` 在 `caseAnalysis.ts`
5. **重构** `processMaterials.tool.ts` 改用 `getMaterialContextService`

## 设计详情

### 1. 提取到 `materialPipeline.service.ts` 的函数

将以下两个函数从 `processMaterials.tool.ts` 迁移到 `materialPipeline.service.ts` 并 export：

- `fetchMaterialContents(materials)` — 从各识别记录表获取材料实际内容，返回 `Map<materialId, string>`
- `estimateTokens(text)` — 简单 token 估算

新增常量 `TOKEN_THRESHOLD = 32000`（从 tool 迁移）。

### 2. `getMaterialContextService`

```typescript
export interface MaterialContextItem {
    id: number
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

## 材料1: 起诉状.pdf
[完整内容]

## 材料2: 证据清单.docx
[完整内容]
```

**summary 模式输出**：
```
本案件共有 N 份材料，材料量较大，以下为摘要信息。需要详细内容时请使用 search_case_materials 工具按需检索。

- 材料1: 起诉状.pdf（摘要：xxx...）
- 材料2: 证据清单.docx（摘要：xxx...）
```

#### `buildIncrementalMaterialMessage`

```typescript
export function buildIncrementalMaterialMessage(context: MaterialContextResult): string
```

增量注入（仅新增材料），格式化为变更通知。

**full 模式输出**：
```
案件新增了以下材料：

## 材料3: 补充证据.pdf
[完整内容]
```

**summary 模式输出**：
```
案件新增了以下材料，需要详细内容时请使用 search_case_materials 工具按需检索。

- 材料3: 补充证据.pdf（摘要：xxx...）
```

### 4. `caseMaterialContextMiddleware`

**位置**：`server/services/agent/caseAnalysis.ts`

**参数**：通过闭包传入 `userId`、`caseId`、`sessionId`、`store`（PostgresStore 实例）。

`beforeAgent` hook 签名为 `(state, runtime)`，无法通过参数访问 store，因此通过闭包注入。

```typescript
import type { PostgresStore } from '@langchain/langgraph-checkpoint-postgres'

const caseMaterialContextMiddleware = (
    userId: number,
    caseId: number,
    sessionId: string,
    store: PostgresStore,
) => {
    const STORE_NAMESPACE = ['case_materials', sessionId]
    const STORE_KEY = 'injected_material_ids'

    return createMiddleware({
        name: "CaseMaterialContextMiddleware",
        beforeAgent: {
            hook: async (state) => {
                try {
                    // 1. 获取当前材料
                    const materials = await getMaterialsByCaseIdService(caseId)
                    if (materials.length === 0) return

                    // 2. 从 Store 读取已注入的材料 id 列表
                    const prev = await store.get(STORE_NAMESPACE, STORE_KEY)
                    const prevIds: number[] = prev?.value?.ids ?? []
                    const currentIds = materials.map(m => m.id)

                    // 3. 判断是首次注入还是增量
                    const isFirstInjection = prevIds.length === 0
                    const newIds = currentIds.filter(id => !prevIds.includes(id))

                    // 无变化则跳过
                    if (!isFirstInjection && newIds.length === 0) return

                    // 4. 获取材料上下文
                    const targetMaterials = isFirstInjection
                        ? materials
                        : materials.filter(m => newIds.includes(m.id))

                    const context = await getMaterialContextService(targetMaterials)
                    if (context.mode === 'empty') return

                    // 5. 构建消息
                    const messageText = isFirstInjection
                        ? buildMaterialContextMessage(context)
                        : buildIncrementalMaterialMessage(context)

                    // 6. 插入 HumanMessage
                    if (isFirstInjection) {
                        // 首次：在 SystemMessage 之后插入
                        const systemIdx = state.messages.findIndex(
                            m => m._getType() === 'system'
                        )
                        const insertIdx = systemIdx >= 0 ? systemIdx + 1 : 0
                        state.messages.splice(insertIdx, 0, new HumanMessage(messageText))
                    } else {
                        // 增量：在用户最新消息前插入（倒数第二位）
                        const insertIdx = Math.max(0, state.messages.length - 1)
                        state.messages.splice(insertIdx, 0, new HumanMessage(messageText))
                    }

                    // 7. 持久化当前材料 id 列表到 Store
                    await store.put(STORE_NAMESPACE, STORE_KEY, { ids: currentIds })

                    logger.info('材料上下文已注入', {
                        caseId,
                        mode: context.mode,
                        isFirstInjection,
                        newMaterialCount: isFirstInjection ? currentIds.length : newIds.length,
                        totalTokens: context.totalTokens,
                    })
                } catch (error) {
                    logger.error('材料上下文注入异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}
```

**要点**：
- Store namespace 按 sessionId 隔离，不同线程互不干扰
- 首次注入：完整材料上下文，插入 SystemMessage 之后
- 增量注入：仅新增材料，插入用户最新消息之前（倒数第二位）
- 无变化时跳过（不注入、不查询内容）
- try-catch 包裹，异常不阻断 agent

### 5. 中间件注册

```typescript
const store = await getStore()  // 在 caseAnalysisAgent 中已有

const agent = createAgent({
    // ...
    middleware: [
        caseProcessMaterialMiddleware(userId!, caseId!),
        caseMaterialContextMiddleware(userId!, caseId!, sessionId, store),
    ],
})
```

### 6. 重构 `processMaterials.tool.ts`

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

## Store 数据结构

```
namespace: ["case_materials", "<sessionId>"]
key: "injected_material_ids"
value: { ids: [1, 2, 3] }
```

每次注入后更新为当前完整的材料 id 列表。下次执行时对比新旧 ids 得出增量。
