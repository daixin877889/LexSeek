# 设计：ensureMaterialsEmbeddedService — 分析前批量嵌入材料

> 日期：2026-03-20
> 状态：已批准
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
    skipped: number    // 跳过数（无内容）
}>
```

### 内部逻辑

1. **全并行处理**：使用 `Promise.allSettled` 对所有材料并行执行嵌入
2. **按类型分发**：
   - `CASE_CONTENT (type=1)` → `embedTextMaterialService(id, userId, caseId, sessionId)`
   - `DOCUMENT/IMAGE/AUDIO` → 内部辅助函数 `embedSingleMediaMaterial`
3. **辅助函数 `embedSingleMediaMaterial`**：
   - 校验 content 非空（空则标记 skipped）
   - 更新嵌入状态为 `processing`
   - 调用 `embedMaterialService(input)`
   - 成功 → 更新状态为 `completed`
   - 失败 → 更新状态为 `failed`，记录日志，不抛异常
4. **结果汇总**：统计 fulfilled/rejected，返回 total/success/failed/skipped

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
| `embedTextMaterialService` | `caseMaterial.service.ts` | 文本材料嵌入（含状态管理） |
| `embedMaterialService` | `materialEmbedding.service.ts` | 非文本材料嵌入 |
| `updateMaterialEmbeddingStatusDAO` | `caseMaterial.dao.ts` | 更新嵌入状态 |

## 不在范围内

- SSE 流式分析逻辑（mainAgent 调用）— 独立任务
- 材料处理流程改动 — 不涉及
- 新增测试 — 将在实施计划中安排
