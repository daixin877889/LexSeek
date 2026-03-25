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

增量注入（仅新增材料），固定使用 summary 格式，格式化为变更通知。

**输出**：
```
案件新增了以下材料，需要详细内容时请使用 search_case_materials 工具按需检索。

- 材料3: 补充证据.pdf（摘要：xxx...）
```

### 4. `caseMaterialContextMiddleware`

**位置**：`server/services/agent/caseAnalysis.ts`

**持久化方案**：使用 `createMiddleware` 的 `stateSchema` 扩展 agent state，新增 `_injectedMaterialIds` 字段。该字段随 checkpoint 自动持久化到 PostgreSQL，无需手动操作 Store。

> **技术验证**：langchain 的 `createAgentState()` 会遍历所有 middleware 的 stateSchema 并合并到 agent 的完整 state 中。`beforeAgent` hook 可直接读取扩展字段，返回的 partial state 会被合并回去并持久化。以 `_` 开头的字段不会出现在 input/output schema 中（私有字段）。

```typescript
const caseMaterialContextMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: "CaseMaterialContextMiddleware",
        stateSchema: {
            _injectedMaterialIds: z.array(z.number()).default([]),
        },
        beforeAgent: {
            hook: async (state) => {
                try {
                    // 1. 获取当前材料
                    const materials = await getMaterialsByCaseIdService(caseId)
                    if (materials.length === 0) return

                    // 2. 从 state 读取已注入的材料 id 列表（自动从 checkpoint 恢复）
                    const prevIds: number[] = state._injectedMaterialIds ?? []
                    const currentIds = materials.map(m => m.id)

                    // 3. 判断是首次注入还是增量
                    const isFirstInjection = prevIds.length === 0
                    const newIds = currentIds.filter(id => !prevIds.includes(id))

                    // 无变化则跳过
                    if (!isFirstInjection && newIds.length === 0) return

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
                            materialCount: currentIds.length,
                            totalTokens: context.totalTokens,
                        })
                    } else {
                        // 增量：固定 summary 模式
                        const newMaterials = materials.filter(m => newIds.includes(m.id))
                        const context = await getMaterialContextService(newMaterials)
                        if (context.mode === 'empty') return

                        const messageText = buildIncrementalMaterialMessage(context)

                        // 在用户最新消息前插入（倒数第二位）
                        const insertIdx = Math.max(0, state.messages.length - 1)
                        state.messages.splice(insertIdx, 0, new HumanMessage(messageText))

                        logger.info('材料上下文已注入（增量）', {
                            caseId,
                            newMaterialCount: newIds.length,
                        })
                    }

                    // 7. 返回更新后的 state（自动持久化到 checkpoint）
                    return { _injectedMaterialIds: currentIds }
                } catch (error) {
                    logger.error('材料上下文注入异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}
```

**要点**：
- `_injectedMaterialIds` 以 `_` 开头，标记为私有字段（不暴露到 input/output schema）
- 通过 `return { _injectedMaterialIds: currentIds }` 更新 state，自动随 checkpoint 持久化
- 多轮对话时 state 从 checkpoint 恢复，`prevIds` 自动包含上次注入的 ids
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

## State 持久化机制

middleware 通过 `stateSchema` 声明 `_injectedMaterialIds` 字段，langchain 的 `createAgentState()` 将其合并到 agent 的完整 state 中。该字段随 StateGraph checkpoint 自动持久化到 PostgreSQL（通过 PostgresSaver），多轮对话时自动恢复。

```
state._injectedMaterialIds: number[]  // e.g. [1, 2, 3]
```

每次注入后通过 hook 返回值更新为当前完整的材料 id 列表。下次 beforeAgent 执行时从 state 中读取历史 ids，与当前 ids 对比得出增量。
