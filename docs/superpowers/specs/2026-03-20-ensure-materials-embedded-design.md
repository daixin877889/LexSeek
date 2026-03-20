# 设计：ensureMaterialsEmbeddedService — 分析前批量嵌入材料

> 日期：2026-03-20
> 状态：已批准（评审修订版）
> 涉及文件：
> - `server/services/material/materialEmbedding.service.ts`（新增服务函数）
> - `server/api/v1/case/analysis/stream/[sessionId].post.ts`（调用方 + 清理）

## 背景

案件分析端点 (`[sessionId].post.ts`) 在启动 SSE 流式分析前，需要确保所有案件材料已完成向量嵌入。当前代码有一个 TODO 占位：

```typescript
const noEmbeddedMaterials = materials.filter(m => m.embeddingStatus !== 'completed')
if (noEmbeddedMaterials.length > 0) {
    // TODO: 批量嵌入未嵌入的材料
}
```

## 决策记录

| 决策 | 选项 | 选择 | 原因 |
|------|------|------|------|
| 阻塞策略 | 阻塞等待 / 非阻塞 / 返回错误 | **阻塞等待** | 分析依赖嵌入完成，必须等待 |
| 材料类型 | 仅文本 / 所有类型 | **所有类型** | 文档/图片/音频材料同样需要检索 |
| 失败策略 | 容错继续 / 失败即终止 | **容错继续** | 部分嵌入失败不应阻断分析 |
| 并行策略 | 按类型分组串行 / 全并行 | **全并行** | 最大化处理速度 |
| 实现方式 | 端点内联 / 直接调用 / 封装服务 | **封装服务** | 符合服务层承载业务逻辑的架构原则 |

## 架构说明

### 向量存储体系

项目存在两套向量嵌入体系：

1. **旧版（案件材料检索用）**：`embedMaterialService` + `MaterialEmbeddingMetadata`
   - 元数据含 `userId`, `caseId`, `materialId`, `sessionId`, `materialName`, `materialType`
   - 检索端 `searchCaseMaterialsService` 按 `{ userId, caseId }` 过滤
   - **本次使用此体系**

2. **新版（内容检索用）**：`embedDocumentService` / `embedImageService` / `embedAudioService`
   - 元数据含 `source`, `userId`, `sourceId`(ossFileId), `sourceName`
   - 基于 `ossFileId` 索引，用于不同的检索场景

### 材料 content 来源

| 材料类型 | content 来源 | 说明 |
|----------|-------------|------|
| CASE_CONTENT (1) | 用户直接输入 | 总是有 content |
| DOCUMENT (2) | materialProcess → MinerU PDF 解析 → updateMaterialContentService | 处理完成后写入 |
| IMAGE (3) | materialProcess → OCR 识别 → updateMaterialContentService | 处理完成后写入 |
| AUDIO (4) | materialProcess → ASR 转写 → updateMaterialContentService | 处理完成后写入 |

**关键约束**：非文本材料如果 `content` 为 null，说明材料处理流程（PDF解析/OCR/ASR）尚未完成，此时无法嵌入，应标记为 `skipped`。

## 新增服务函数

### 位置

`server/services/material/materialEmbedding.service.ts`

### 签名

```typescript
export async function ensureMaterialsEmbeddedService(
    materials: MaterialWithFile[],
    userId: number,
    caseId: number,
    sessionId: string
): Promise<{
    total: number      // 需要嵌入的材料总数
    success: number    // 成功数
    failed: number     // 失败数
    skipped: number    // 跳过数（无内容，无法嵌入）
}>
```

### 内部逻辑

1. **全并行处理**：使用 `Promise.allSettled` 对所有材料并行执行嵌入
2. **按类型分发**（每个材料独立 try-catch）：
   - `CASE_CONTENT (type=1)` → `embedTextMaterialService(id, userId, caseId, sessionId)`
     - 该服务已包含完整状态管理（processing → completed/failed）
   - `DOCUMENT/IMAGE/AUDIO` → 内部辅助逻辑：
     1. 校验 `content` 非空（null 则返回 `'skipped'`，不更新状态）
     2. 更新嵌入状态为 `processing`（via `updateMaterialEmbeddingStatusDAO`）
     3. 构造 `EmbedMaterialInput` 并调用 `embedMaterialService(input)`
     4. 成功 → 更新状态为 `completed`
     5. 失败 → 更新状态为 `failed`，记录日志
3. **结果汇总**：
   - 每个 Promise 返回 `'success' | 'failed' | 'skipped'`
   - 统计三类结果，返回 `{ total, success, failed, skipped }`

### `EmbedMaterialInput` 字段映射

```typescript
{
    content: material.content!,           // caseMaterials.content（已验证非空）
    userId,                               // 从函数参数传入
    caseId,                               // 从函数参数传入
    materialId: material.id,              // caseMaterials.id
    sessionId,                            // 从函数参数传入
    materialName: material.name,          // caseMaterials.name
    materialType: material.type as CaseMaterialType,  // caseMaterials.type
}
```

### materialId 唯一性保证

传入的 `materials` 来自 `getMaterialsByCaseIdService(caseId)` 的过滤结果，每个 `caseMaterials.id` 在数据库中是主键自增，不存在重复。因此并行处理不会对同一 materialId 产生竞态。

### skipped 材料的状态

被 skipped 的材料（content 为 null）**不更新** `embeddingStatus`，保持原状态（通常为 `pending`）。这些材料需要先完成材料处理流程（PDF解析/OCR/ASR）才能嵌入。

### 容错保证

- 每个材料的嵌入独立 try-catch，单个失败不影响其他
- 失败的材料 `embeddingStatus` 更新为 `failed`，日志记录错误详情
- 函数本身不抛异常，总是返回统计结果

## 端点改动

### 文件

`server/api/v1/case/analysis/stream/[sessionId].post.ts`

### 变更

1. **替换 TODO** 为 `ensureMaterialsEmbeddedService` 调用
2. **移除** `console.log(JSON.stringify(materials, null, 2))` 调试日志
3. **移除** 多余空行

### 改动后代码

```typescript
if (noEmbeddedMaterials.length > 0) {
    const embedResult = await ensureMaterialsEmbeddedService(
        noEmbeddedMaterials, user.id, caseInfo.id, sessionId
    )
    logger.info('批量嵌入完成', embedResult)
}
```

## 复用的现有服务

| 服务 | 位置 | 用途 |
|------|------|------|
| `embedTextMaterialService` | `caseMaterial.service.ts` | 文本材料嵌入（含完整状态管理） |
| `embedMaterialService` | `materialEmbedding.service.ts` | 非文本材料嵌入（旧版，与检索端元数据格式匹配） |
| `updateMaterialEmbeddingStatusDAO` | `caseMaterial.dao.ts` | 更新嵌入状态 |
| `MaterialWithFile` | `material.service.ts` | 材料数据类型（含 content + 文件信息） |

## 不在范围内

- SSE 流式分析逻辑（mainAgent 调用）— 独立任务
- 材料处理流程改动 — 不涉及
- 新增测试 — 将在实施计划中安排
