# 案件材料上下文注入中间件设计

## 概述

在案件分析 Agent 启动前（`caseProcessMaterialMiddleware` 之后），通过第二个 `beforeAgent` 中间件获取材料内容，按 token 量决定全量/摘要模式，并以 HumanMessage 注入到 agent 的消息列表中（插入在 SystemMessage 之后）。

## 实现范围

1. **提取** `fetchMaterialContents`、`estimateTokens` 从 `processMaterials.tool.ts` 移到 `materialPipeline.service.ts`
2. **新增** `getMaterialContextService` 在 `materialPipeline.service.ts`
3. **新增** `buildMaterialContextMessage` 在 `materialPipeline.service.ts`
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

### 3. `buildMaterialContextMessage`

```typescript
export function buildMaterialContextMessage(context: MaterialContextResult): string
```

纯函数，将 `MaterialContextResult` 格式化为结构化文本：

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

### 4. `caseMaterialContextMiddleware`

**位置**：`server/services/agent/caseAnalysis.ts`

```typescript
const caseMaterialContextMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: "CaseMaterialContextMiddleware",
        beforeAgent: {
            hook: async (state) => {
                try {
                    const materials = await getMaterialsByCaseIdService(caseId)
                    if (materials.length === 0) return

                    const context = await getMaterialContextService(materials)
                    if (context.mode === 'empty') return

                    const contextMessage = buildMaterialContextMessage(context)

                    // 在 SystemMessage 之后插入 HumanMessage
                    const systemIdx = state.messages.findIndex(
                        m => m._getType() === 'system'
                    )
                    const insertIdx = systemIdx >= 0 ? systemIdx + 1 : 0
                    state.messages.splice(insertIdx, 0, new HumanMessage(contextMessage))

                    logger.info('材料上下文已注入', {
                        caseId,
                        mode: context.mode,
                        totalTokens: context.totalTokens,
                        materialCount: context.materialList.length,
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
- try-catch 包裹，异常不阻断 agent
- 日志记录注入模式和 token 量

### 5. 中间件注册顺序

```typescript
middleware: [
    caseProcessMaterialMiddleware(userId!, caseId!),   // 先确保识别+嵌入
    caseMaterialContextMiddleware(userId!, caseId!),    // 再注入上下文
]
```

### 6. 重构 `processMaterials.tool.ts`

- 删除 `fetchMaterialContents`、`estimateTokens`、`TOKEN_THRESHOLD`
- 改为 import 并调用 `getMaterialContextService`
- tool 保留 `embedded` 字段和 `hint` 等 tool 特有的返回格式
