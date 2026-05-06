# 材料摘要语义统一 + 中间件保底 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把材料"100 字简介"按文件存到识别记录表，统一四种类型 summary 字段语义；案件初分挂材料就绪中间件，等待时复用 MaterialProcessTool 卡片实时显示进度。

**Architecture:** 数据按文件级（`docRecognitionRecords` / `imageRecognitionRecords` / `asrRecords` / `textContentRecords` 的 summary 字段）；新建 `generateOssFileSummaryService` 统一生成入口（含 inflight Map 防重 + summary 已存在防写）；新建 `getMaterialSummariesByMaterials` helper 统一读取入口（4 表并行 join 后按 materialId 聚合）；`caseProcessMaterialMiddleware` 升级"识别 + 简介双就绪"判定 + 等待期间通过 SSE 推送 `prepare_materials` 事件，前端 `useStreamChat` 合成 `process_materials` 同款 toolCall 复用 `MaterialProcessTool.vue`（升级为五态状态指示）。

**Tech Stack:** Nuxt 4 + Prisma + LangGraph + Vitest + Vue 3 + Tailwind v4

**Spec 来源：** `docs/superpowers/specs/2026-05-06-material-summary-unification-design.md`

---

## 任务索引

- Task 1：Prisma schema + migration（删 `caseMaterials.summary`，加 `textContentRecords.summary`）
- Task 2：共享类型 `PREPARE_MATERIALS` 事件类型 + payload
- Task 3：移除 ASR `summary` 字段写入路径
- Task 4：改写 5 处 ASR `summary` 读取为 `result` 现拼
- Task 5：新建 `generateOssFileSummaryService`（含 inflight Map）
- Task 6：新建 `getMaterialSummariesByMaterials` helper
- Task 7：替换简介生成触发点为新函数
- Task 8：识别状态接口 `recognized` 判定升级
- Task 9：`ensureMaterialsReadyService` 终态轮询 + SSE 推送进度
- Task 10：V2 案件初分挂载 `caseProcessMaterialMiddleware`
- Task 11：替换 `caseMaterials.summary` 读取路径
- Task 12：`process_materials` 工具 output 加 `status` 字段
- Task 13：前端 `useStreamChat` 拦截 `prepare_materials`
- Task 14：`MaterialProcessTool.vue` 五态升级
- Task 15：全量回归

---

## 关键参考路径

- Spec：`docs/superpowers/specs/2026-05-06-material-summary-unification-design.md`
- 现有"摘要生成"老函数（本次替换）：`server/services/material/material.service.ts:520` `generateMaterialSummaryService`
- 现有"材料就绪"中间件（本次升级）：`server/agents/_shared/case-context/caseProcessMaterial.middleware.ts`
- 现有 pipeline（本次升级 `runRecognitionAndEmbeddingPipeline`）：`server/services/material/materialPipeline.service.ts`
- 现有"材料处理"前端卡片（本次升级）：`app/components/ai/tools/MaterialProcessTool.vue`
- 现有合成工具卡片机制参考：`app/composables/useStreamChat.ts:285` 处理 `analysis_summary` 的代码块

---

### Task 1：Prisma Schema + Migration

**Files:**
- Modify: `prisma/models/case.prisma`（删 `caseMaterials.summary`）
- Modify: `prisma/models/materials.prisma`（`textContentRecords` 加 `summary`）
- Modify: `prisma/models/recognition.prisma`（更新 `asrRecords.summary` 注释，字段不动）
- Create: `prisma/migrations/<timestamp>_unify_material_summary/migration.sql`（自动生成）

- [ ] **Step 1: 修改 caseMaterials schema 删 summary 字段**

修改 `prisma/models/case.prisma`，找到 `model caseMaterials`，删除以下行（只删这一行，其它字段保留）：

```prisma
  /// 摘要
  summary       String?   @db.Text
```

- [ ] **Step 2: 修改 textContentRecords schema 加 summary 字段**

修改 `prisma/models/materials.prisma`，在 `model textContentRecords` 的 `htmlContent` 字段下方添加：

```prisma
  /// 200 字简介（统一语义：识别完成后由 generateOssFileSummaryService 写入）
  summary         String?   @db.Text
```

- [ ] **Step 3: 修改 asrRecords schema 注释，明确语义**

修改 `prisma/models/recognition.prisma`，把 `model asrRecords` 中 `summary` 字段的注释从 `/// 摘要` 改为：

```prisma
  /// 200 字简介（统一语义；不再存格式化转录文本，转录文本读取时从 result JSON 现拼）
  summary         String?   @db.Text
```

同样把 `model docRecognitionRecords` 和 `model imageRecognitionRecords` 的 `summary` 注释改为：

```prisma
  /// 200 字简介（统一语义：识别完成后由 generateOssFileSummaryService 写入）
  summary         String?   @db.Text
```

- [ ] **Step 4: 生成迁移**

Run: `bun run prisma:migrate --name unify_material_summary`
Expected: 自动生成 migration 文件，里面应包含 `ALTER TABLE "case_materials" DROP COLUMN "summary"` 和 `ALTER TABLE "text_content_records" ADD COLUMN "summary" TEXT`

- [ ] **Step 5: 验证 client 重新生成**

Run: `bun run prisma:generate`
Expected: 无错误，`generated/prisma/client` 类型已更新

- [ ] **Step 6: 验证 schema 不再含 caseMaterials.summary**

Run: `grep -n "summary" generated/prisma/client/index.d.ts | grep "caseMaterials" | head -5`
Expected: 无输出（caseMaterials 不再有 summary 字段）

- [ ] **Step 7: Commit**

```bash
git add prisma/models/ prisma/migrations/ generated/prisma/
git commit -m "feat(db): 统一材料 summary 语义，迁移到识别记录表

- caseMaterials.summary 删除（迁到识别记录表按文件存）
- textContentRecords 加 summary 字段（与 doc/image/asr 对齐）
- asrRecords.summary 注释更新（不再存转录文本，统一为 200 字简介）"
```

---

### Task 2：共享类型 PREPARE_MATERIALS 事件

**Files:**
- Modify: `shared/types/agentEvent.ts`

- [ ] **Step 1: 在 SSECustomEventType 枚举追加事件类型**

修改 `shared/types/agentEvent.ts` 的 `SSECustomEventType` 枚举（在 `CHILD_AGENT_INVOKED` 之前），追加：

```typescript
    /**
     * 材料就绪保底进度事件（中间件等待期间发出）。
     *
     * 由 caseProcessMaterialMiddleware 在等待识别+简介双就绪期间发出 phase:'start'/'progress'/'end'。
     * 前端 useStreamChat 拦截后合成 process_materials 同款 toolCall（toolCallId='prepare-${runId}'），
     * 复用 MaterialProcessTool.vue 渲染。
     */
    PREPARE_MATERIALS = 'prepare_materials',
```

- [ ] **Step 2: 追加 payload 类型定义**

在 `SSECustomEventMap` 之前追加：

```typescript
/** 材料就绪保底进度卡片：单条材料状态 */
export type MaterialItemStatus = 'pending' | 'recognizing' | 'summarizing' | 'ready' | 'failed'

export interface MaterialItem {
    id: number
    name: string
    /** CaseMaterialType: 1 文字 / 2 文档 / 3 图片 / 4 音频 */
    type: number
    status: MaterialItemStatus
}

/**
 * PREPARE_MATERIALS 事件 payload
 *
 * - phase='start'：第一次发现未就绪，发出当前快照
 * - phase='progress'：每秒轮询时发出全量快照（简化前端 diff 逻辑）
 * - phase='end'：全部就绪或超时退出，failedCount=未就绪材料数
 */
export type PrepareMaterialsPayload =
    | { phase: 'start';    toolCallId: string; materials: MaterialItem[] }
    | { phase: 'progress'; toolCallId: string; materials: MaterialItem[] }
    | { phase: 'end';      toolCallId: string; materials: MaterialItem[]; failedCount: number }
```

- [ ] **Step 3: 在 SSECustomEventMap 接口加映射**

找到 `export interface SSECustomEventMap` 块，加一行：

```typescript
    [SSECustomEventType.PREPARE_MATERIALS]: PrepareMaterialsPayload
```

- [ ] **Step 4: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head`
Expected: 无错误输出

- [ ] **Step 5: Commit**

```bash
git add shared/types/agentEvent.ts
git commit -m "feat(types): 增加 PREPARE_MATERIALS SSE 事件类型 + payload

中间件保底等待期间向前端推送材料就绪进度，前端复用
MaterialProcessTool.vue 渲染。"
```

---

### Task 3：移除 ASR summary 字段写入路径

**Files:**
- Modify: `server/services/material/asr.service.ts`（line 1448-1452 删除 summary 写入）
- Modify: `server/services/material/asr.dao.ts`（line 55 删除入参类型 summary）
- Modify: `server/services/material/asr.service.ts`（updateAsrRecordService 入参类型 line ~1299）

- [ ] **Step 1: 修改 embedAsrRecordService 不再写 summary**

修改 `server/services/material/asr.service.ts`，找到 `embedAsrRecordService` 函数中（约 line 1448-1452）：

```typescript
        // 8. 更新 ASR 识别记录的向量信息 + 摘要文本
        // summary 字段供 fetchMaterialContents 读取，作为材料上下文注入工作流
        await updateAsrRecordDao(recordId, {
            vectorIds: embeddingResult.ids,
            lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
            summary: text,
        }, tx)
```

改为（去掉 summary 字段写入）：

```typescript
        // 8. 更新 ASR 识别记录的向量信息
        // 注意：summary 字段不在此处写入——已切换语义为"200 字简介"，由
        // generateOssFileSummaryService 在识别完成后异步生成；
        // 转录正文由 fetchMaterialContents 等读取方从 result JSON 现拼。
        await updateAsrRecordDao(recordId, {
            vectorIds: embeddingResult.ids,
            lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
        }, tx)
```

- [ ] **Step 2: 删除 asr.dao.ts 入参类型中的 summary 字段**

修改 `server/services/material/asr.dao.ts`，找到 `updateAsrRecordDao` 函数的入参类型（约 line 50-60，包含 `summary?: string`），删除 `summary?: string` 这一行。

- [ ] **Step 3: 删除 asr.service.ts updateAsrRecordService 入参类型中的 summary**

修改 `server/services/material/asr.service.ts`，找到 `updateAsrRecordService` 函数的入参类型定义（约 line 1290-1300），删除 `summary?: string` 字段。

- [ ] **Step 4: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head -10`
Expected: 类型错误集中在"读 asrRecord.summary 处" — 这些会在 Task 4 修复，本步先记录但不修

- [ ] **Step 5: 单元测试 ASR 不再写 summary**

修改 `tests/server/material/asr.service.test.ts`，找到 `embedAsrRecordService` 相关测试（约 line 1100+），修改断言：原本断言 `updateAsrRecordDao` 调用入参含 `summary: text`，改为断言**不含** summary 字段。如果有用例显式传入 summary 字段，调整为只传 vectorIds + lastEmbeddingAt。

- [ ] **Step 6: 跑该测试文件**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/asr.service.test.ts --reporter=default 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 7: Commit**

```bash
git add server/services/material/asr.service.ts server/services/material/asr.dao.ts tests/server/material/asr.service.test.ts
git commit -m "refactor(asr): 移除 summary 字段写入

asrRecords.summary 字段语义切换为 200 字简介（由后续任务的
generateOssFileSummaryService 写入）。原本存的格式化转录文本由读取方
从 result JSON 现拼（extractTextFromAsrResult 已有）。"
```

---

### Task 4：改写 5 处 ASR summary 读取为 result 现拼

**Files:**
- Modify: `server/services/material/materialEmbedding.service.ts`（line 1212-1234 AUDIO 分支）
- Modify: `server/services/material/material.service.ts`（line 588-595 loadMaterialText 音频分支）
- Modify: `server/services/material/materialPipeline.service.ts`（line 412-440 fetchMaterialContents 音频分支）
- Modify: `server/services/material/fileProcess.service.ts`（line 86, 186, 218-221, 254-256）

- [ ] **Step 1: 改 materialEmbedding.service.ts 的 AUDIO 分支**

找到 `embedMaterialUnifiedService` 的 `case 4: { // AUDIO`（约 line 1212-1234），把：

```typescript
        case 4: { // AUDIO
            if (!material.ossFileId) {
                return { success: false, error: '音频材料缺少 ossFileId' }
            }
            const asrRecord = await prisma.asrRecords.findFirst({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                select: { summary: true },
                orderBy: { createdAt: 'desc' },
            })
            if (!asrRecord?.summary) {
                return { success: false, error: '音频识别记录内容为空' }
            }
            const audioResult = await embedAudioService({
                content: asrRecord.summary,
```

改为：

```typescript
        case 4: { // AUDIO
            if (!material.ossFileId) {
                return { success: false, error: '音频材料缺少 ossFileId' }
            }
            const asrRecord = await prisma.asrRecords.findFirst({
                where: { ossFileId: material.ossFileId, deletedAt: null },
                select: { result: true, speakers: true },
                orderBy: { createdAt: 'desc' },
            })
            if (!asrRecord?.result) {
                return { success: false, error: '音频识别记录内容为空' }
            }
            // 从 result JSON 现拼格式化转录文本（带说话人 + 时间戳）
            const speakers = asrRecord.speakers as Array<{ id: number; name: string }> | null
            const text = extractTextFromSimplifiedResult(asrRecord.result as any, speakers || undefined)
            if (!text) {
                return { success: false, error: '音频识别记录内容为空' }
            }
            const audioResult = await embedAudioService({
                content: text,
```

文件顶部 import 区追加：

```typescript
import { extractTextFromSimplifiedResult } from './asr.service'
```

并把 `asr.service.ts` 中 `extractTextFromSimplifiedResult` 函数改为 `export`（找到该函数定义，加 `export`）。

- [ ] **Step 2: 改 material.service.ts 的 loadMaterialText 音频分支**

找到 `loadMaterialText` 函数中音频分支（约 line 588-595）：

```typescript
    // 音频：从 asrRecords 读 summary
    if (m.type === CaseMaterialType.AUDIO && m.ossFileId) {
        const asr = await prisma.asrRecords.findFirst({
            where: { ossFileId: m.ossFileId, deletedAt: null },
            select: { summary: true },
        })
        if (asr?.summary) return asr.summary.slice(0, maxChars)
    }
```

改为：

```typescript
    // 音频：从 asrRecords.result JSON 现拼转录文本
    if (m.type === CaseMaterialType.AUDIO && m.ossFileId) {
        const asr = await prisma.asrRecords.findFirst({
            where: { ossFileId: m.ossFileId, deletedAt: null },
            select: { result: true, speakers: true },
            orderBy: { createdAt: 'desc' },
        })
        if (asr?.result) {
            const speakers = asr.speakers as Array<{ id: number; name: string }> | null
            const text = extractTextFromSimplifiedResult(asr.result as any, speakers || undefined)
            if (text) return text.slice(0, maxChars)
        }
    }
```

文件顶部加 import：

```typescript
import { extractTextFromSimplifiedResult } from './asr.service'
```

- [ ] **Step 3: 改 materialPipeline.service.ts 的 fetchMaterialContents 音频分支**

找到约 line 412-440 的音频材料读取块：

```typescript
            select: { ossFileId: true, summary: true, result: true },
            orderBy: { createdAt: 'desc' },
        }).then(records => {
            const seen = new Set<number>()
            for (const r of records) {
                if (r.ossFileId && !seen.has(r.ossFileId)) {
                    // 优先使用 summary（已格式化的转录文本）
                    // fallback：从 result JSON 提取纯文本
                    const content = r.summary || extractTextFromAsrResult(r.result)
```

改为：

```typescript
            select: { ossFileId: true, result: true },
            orderBy: { createdAt: 'desc' },
        }).then(records => {
            const seen = new Set<number>()
            for (const r of records) {
                if (r.ossFileId && !seen.has(r.ossFileId)) {
                    // 从 result JSON 提取纯文本（summary 字段已切换语义为 200 字简介，不再存转录文本）
                    const content = extractTextFromAsrResult(r.result)
```

- [ ] **Step 4: 改 fileProcess.service.ts 的 3 处 fallback**

修改 `server/services/material/fileProcess.service.ts`：

第 1 处（约 line 86）：

```typescript
            select: { ossFileId: true, status: true, summary: true, result: true },
```

改为：

```typescript
            select: { ossFileId: true, status: true, result: true },
```

第 2 处（约 line 186）：

```typescript
            return r?.summary ?? extractTextFromAsrResult(r?.result) ?? null
```

改为：

```typescript
            return extractTextFromAsrResult(r?.result) ?? null
```

第 3 处（约 line 218-221）：

```typescript
                select: { summary: true, result: true },
```

改为：

```typescript
                select: { result: true },
```

下一行：

```typescript
                const content = record.summary || extractTextFromAsrResult(record.result)
```

改为：

```typescript
                const content = extractTextFromAsrResult(record.result)
```

第 4 处（约 line 254-256）：

```typescript
                select: { summary: true, result: true },
```

改为：

```typescript
                select: { result: true },
```

下一行：

```typescript
                const content = record?.summary || extractTextFromAsrResult(record?.result)
```

改为：

```typescript
                const content = extractTextFromAsrResult(record?.result)
```

第 5 处（约 line 36，类型定义）：

```typescript
    summary: string | null
```

改为：

```typescript
    /** 已废弃：summary 字段统一改为 200 字简介，转录文本从 result 现拼 */
```

并删除该字段。同时找到该类型的所有用法，确保不再返回 summary。

- [ ] **Step 5: 跑相关测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/ --reporter=default 2>&1 | tail -10`
Expected: 大部分通过；可能仍有 1-2 个测试失败，原因是测试 mock 用了 summary 字段——临时修复测试 mock，把 `summary: '...'` 改为 `result: { transcripts: [{ sentences: [...] }] }` 或简单忽略

- [ ] **Step 6: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head -10`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
git add server/services/material/ tests/server/material/
git commit -m "refactor(asr): 5 处读取改为 result JSON 现拼，不再读 summary

asrRecords.summary 字段语义切换为 200 字简介后，5 处原本读它当
'格式化转录文本'用的代码改为从 result JSON 现拼（extractTextFromAsrResult
和 extractTextFromSimplifiedResult 已有，性能毫秒级）。"
```

---

### Task 5：新建 generateOssFileSummaryService（含 inflight Map）

**Files:**
- Create: `server/services/material/ossFileSummary.service.ts`
- Test: `tests/server/material/ossFileSummary.service.test.ts`

- [ ] **Step 1: 写失败测试（防重 + inflight）**

创建 `tests/server/material/ossFileSummary.service.test.ts`：

```typescript
/**
 * generateOssFileSummaryService 测试
 *
 * 验证：按文件 ID + 类型生成 200 字简介，写到识别记录表的 summary 字段
 * - 已有 summary 跳过（防重）
 * - 并发触发同一 ossFileId 时复用同一 Promise（inflight Map 去重）
 * - 4 种类型（文字 / 文档 / 图片 / 音频）分支正确
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CaseMaterialType } from '#shared/types/case'

// mock 各识别记录 DAO
vi.mock('~~/server/services/material/asr.dao', () => ({
    findAsrRecordByOssFileIdDao: vi.fn(),
    updateAsrRecordDao: vi.fn(),
}))
vi.mock('~~/server/services/material/mineru.dao', () => ({
    findDocRecognitionByOssFileIdDao: vi.fn(),
    updateDocRecognitionRecordDao: vi.fn(),
}))
vi.mock('~~/server/services/material/ocr.dao', () => ({
    findImageRecognitionByOssFileIdDao: vi.fn(),
    updateImageRecognitionRecordDao: vi.fn(),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn().mockResolvedValue({
        modelSdkType: 'openai',
        modelName: 'fake',
        modelProviderBaseUrl: 'http://x',
        modelApiKeys: [{ status: 1, apiKey: 'k' }],
        prompts: [{ type: 'system', status: 1, content: 'sys' }],
    }),
}))
vi.mock('~~/server/services/agent-platform/modelFactory', () => ({
    createChatModel: vi.fn(),
}))
vi.mock('~~/server/services/ai/summaryService', () => ({
    generateSummaryService: vi.fn().mockResolvedValue('生成的 200 字简介'),
}))
vi.mock('~~/server/services/material/asr.service', () => ({
    extractTextFromSimplifiedResult: vi.fn().mockReturnValue('音频转录正文'),
}))

import { generateOssFileSummaryService } from '~~/server/services/material/ossFileSummary.service'
import { findAsrRecordByOssFileIdDao, updateAsrRecordDao } from '~~/server/services/material/asr.dao'
import { findDocRecognitionByOssFileIdDao, updateDocRecognitionRecordDao } from '~~/server/services/material/mineru.dao'
import { findImageRecognitionByOssFileIdDao, updateImageRecognitionRecordDao } from '~~/server/services/material/ocr.dao'
import { generateSummaryService } from '~~/server/services/ai/summaryService'

describe('generateOssFileSummaryService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('已有 summary 时直接早返，不调 LLM', async () => {
        vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue({
            id: 1, ossFileId: 100, summary: '已有简介', markdownContent: '内容', status: 2,
        } as any)

        await generateOssFileSummaryService(100, CaseMaterialType.DOCUMENT)

        expect(generateSummaryService).not.toHaveBeenCalled()
        expect(updateDocRecognitionRecordDao).not.toHaveBeenCalled()
    })

    it('文档类型：summary 为空时调 LLM 写到 docRecognitionRecords', async () => {
        vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue({
            id: 1, ossFileId: 200, summary: null, markdownContent: '一段需要总结的正文', status: 2,
        } as any)

        await generateOssFileSummaryService(200, CaseMaterialType.DOCUMENT)

        expect(generateSummaryService).toHaveBeenCalled()
        expect(updateDocRecognitionRecordDao).toHaveBeenCalledWith(1, { summary: '生成的 200 字简介' })
    })

    it('图片类型：summary 为空时调 LLM 写到 imageRecognitionRecords', async () => {
        vi.mocked(findImageRecognitionByOssFileIdDao).mockResolvedValue({
            id: 2, ossFileId: 300, summary: null, markdownContent: '图片识别文字', status: 2,
        } as any)

        await generateOssFileSummaryService(300, CaseMaterialType.IMAGE)

        expect(updateImageRecognitionRecordDao).toHaveBeenCalledWith(2, { summary: '生成的 200 字简介' })
    })

    it('音频类型：summary 为空时调 LLM 写到 asrRecords（content 来自 result 现拼）', async () => {
        vi.mocked(findAsrRecordByOssFileIdDao).mockResolvedValue({
            id: 3, ossFileId: 400, summary: null, result: { transcripts: [] }, speakers: [], status: 2,
        } as any)

        await generateOssFileSummaryService(400, CaseMaterialType.AUDIO)

        expect(updateAsrRecordDao).toHaveBeenCalledWith(3, { summary: '生成的 200 字简介' })
    })

    it('并发同一 ossFileId 触发：只调一次 LLM（inflight Map 去重）', async () => {
        let resolveLlm: ((v: string) => void) | null = null
        vi.mocked(generateSummaryService).mockReturnValue(
            new Promise(resolve => { resolveLlm = resolve as any }) as any,
        )
        vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue({
            id: 4, ossFileId: 500, summary: null, markdownContent: '内容', status: 2,
        } as any)

        const p1 = generateOssFileSummaryService(500, CaseMaterialType.DOCUMENT)
        const p2 = generateOssFileSummaryService(500, CaseMaterialType.DOCUMENT)
        const p3 = generateOssFileSummaryService(500, CaseMaterialType.DOCUMENT)

        // 让 LLM 返回
        resolveLlm!('简介')
        await Promise.all([p1, p2, p3])

        expect(generateSummaryService).toHaveBeenCalledTimes(1)
        expect(updateDocRecognitionRecordDao).toHaveBeenCalledTimes(1)
    })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/ossFileSummary.service.test.ts --reporter=default 2>&1 | tail -5`
Expected: FAIL（模块文件还不存在）

- [ ] **Step 3: 创建实现文件**

创建 `server/services/material/ossFileSummary.service.ts`：

```typescript
/**
 * 按 OSS 文件 + 材料类型生成 200 字简介。
 *
 * - 数据存储：按文件级，写入识别记录表的 summary 字段
 *   - DOCUMENT → docRecognitionRecords.summary
 *   - IMAGE    → imageRecognitionRecords.summary
 *   - AUDIO    → asrRecords.summary
 *   - CASE_CONTENT → 不走本函数（按 materialId，不按 ossFileId；走旧的 generateMaterialSummaryService 兜底）
 *
 * - 防重：select summary 已非空 → 早返，不调 LLM
 * - 并发去重：进程内 inflight Map<ossFileId+'_'+type, Promise<void>>，第二次复用同一 Promise
 *
 * 失败不阻塞主流程，仅 logger.warn。
 */

import { CaseMaterialType } from '#shared/types/case'
import { findAsrRecordByOssFileIdDao, updateAsrRecordDao } from './asr.dao'
import { findDocRecognitionByOssFileIdDao, updateDocRecognitionRecordDao } from './mineru.dao'
import { findImageRecognitionByOssFileIdDao, updateImageRecognitionRecordDao } from './ocr.dao'
import { getValidNodeConfig } from '../node/node.service'
import { createChatModel } from '../agent-platform/modelFactory'
import { generateSummaryService } from '../ai/summaryService'
import { extractTextFromSimplifiedResult } from './asr.service'
import { withLangfuseContext } from '~~/server/lib/langfuse'

/** 简介长度统一 200 字（spec §8.1） */
const SUMMARY_MAX_CHARS = 200

/**
 * inflight Map：同一 ossFileId+type 的并发请求复用同一个 Promise，避免重复 LLM 调用
 * key: `${ossFileId}_${type}`
 */
const inflight = new Map<string, Promise<void>>()

export async function generateOssFileSummaryService(
    ossFileId: number,
    type: CaseMaterialType,
): Promise<void> {
    const key = `${ossFileId}_${type}`
    const existing = inflight.get(key)
    if (existing) return existing

    const task = withLangfuseContext(
        { ossFileId: String(ossFileId), vertical: 'material-summary' },
        () => generateInner(ossFileId, type),
    ).finally(() => inflight.delete(key))

    inflight.set(key, task)
    return task
}

async function generateInner(ossFileId: number, type: CaseMaterialType): Promise<void> {
    try {
        // 1. 按类型查识别记录 + 内容
        const target = await loadRecognitionTarget(ossFileId, type)
        if (!target) return  // 识别记录不存在 / 状态未成功 / 无内容
        if (target.summary) return  // 已有简介，防重早返
        if (!target.content) return  // 无内容可总结

        // 2. 调 LLM 生成 200 字简介（沿用 materialAutoSummary 节点配置）
        const config = await getValidNodeConfig('materialAutoSummary', '材料自动摘要')
        const apiKey = config.modelApiKeys.find(k => k.status === 1)?.apiKey
        if (!apiKey) {
            logger.warn('materialAutoSummary 节点无可用 API Key', { ossFileId, type })
            return
        }
        const systemPrompt = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
        if (!systemPrompt) {
            logger.warn('materialAutoSummary 节点无 system prompt', { ossFileId, type })
            return
        }

        const model = createChatModel({
            sdkType: config.modelSdkType,
            modelName: config.modelName,
            apiKey,
            baseUrl: config.modelProviderBaseUrl,
            temperature: 0,
            streaming: false,
        })
        const summary = await generateSummaryService(model, target.content, {
            maxChars: SUMMARY_MAX_CHARS,
            systemPrompt,
        })

        // 3. 写回对应表的 summary 字段
        await persistSummary(target.recordId, type, summary)
    } catch (e) {
        logger.warn('generateOssFileSummaryService 失败（不阻塞主流程）', { ossFileId, type, error: e })
    }
}

interface RecognitionTarget {
    recordId: number
    summary: string | null
    content: string  // 简介 LLM 的输入文本（已 slice 到合理长度）
}

async function loadRecognitionTarget(
    ossFileId: number,
    type: CaseMaterialType,
): Promise<RecognitionTarget | null> {
    if (type === CaseMaterialType.DOCUMENT) {
        const r = await findDocRecognitionByOssFileIdDao(ossFileId)
        if (!r || r.status !== 2) return null
        return {
            recordId: r.id,
            summary: r.summary,
            content: (r.markdownContent ?? '').slice(0, 2000),
        }
    }
    if (type === CaseMaterialType.IMAGE) {
        const r = await findImageRecognitionByOssFileIdDao(ossFileId)
        if (!r || r.status !== 2) return null
        return {
            recordId: r.id,
            summary: r.summary,
            content: (r.markdownContent ?? '').slice(0, 2000),
        }
    }
    if (type === CaseMaterialType.AUDIO) {
        const r = await findAsrRecordByOssFileIdDao(ossFileId)
        if (!r || r.status !== 2) return null
        const speakers = r.speakers as Array<{ id: number; name: string }> | null
        const transcribed = extractTextFromSimplifiedResult(r.result as any, speakers || undefined)
        return {
            recordId: r.id,
            summary: r.summary,
            content: (transcribed ?? '').slice(0, 2000),
        }
    }
    // CASE_CONTENT 不走本函数
    return null
}

async function persistSummary(recordId: number, type: CaseMaterialType, summary: string): Promise<void> {
    if (type === CaseMaterialType.DOCUMENT) {
        await updateDocRecognitionRecordDao(recordId, { summary })
    } else if (type === CaseMaterialType.IMAGE) {
        await updateImageRecognitionRecordDao(recordId, { summary })
    } else if (type === CaseMaterialType.AUDIO) {
        await updateAsrRecordDao(recordId, { summary })
    }
}
```

- [ ] **Step 4: 确认 ocr.dao.ts 和 mineru.dao.ts 中的 update DAO 接受 summary 字段**

Run: `grep -n "updateImageRecognitionRecordDao\|updateDocRecognitionRecordDao" /Users/daixin/work/dev/LexSeek/LexSeek/server/services/material/ocr.dao.ts /Users/daixin/work/dev/LexSeek/LexSeek/server/services/material/mineru.dao.ts | head -5`

如果发现 update DAO 入参类型限定不含 summary，编辑对应 DAO 把 `summary?: string` 加到入参类型。

- [ ] **Step 5: 跑测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/ossFileSummary.service.test.ts --reporter=default 2>&1 | tail -10`
Expected: 5 个测试全过

- [ ] **Step 6: Commit**

```bash
git add server/services/material/ossFileSummary.service.ts tests/server/material/ossFileSummary.service.test.ts server/services/material/ocr.dao.ts server/services/material/mineru.dao.ts
git commit -m "feat(material): 新建 generateOssFileSummaryService（按文件级生成 200 字简介）

- 三种识别类型（文档/图片/音频）按 ossFileId 写入对应记录表的 summary
- 防重：summary 已非空早返
- 并发去重：进程内 inflight Map
- 失败不阻塞主流程"
```

---

### Task 6：新建 getMaterialSummariesByMaterials helper

**Files:**
- Modify: `server/services/material/material.service.ts`（在末尾追加 helper）
- Test: `tests/server/material/material.service.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

修改 `tests/server/material/material.service.test.ts`，追加 describe 块：

```typescript
describe('getMaterialSummariesByMaterials - 跨表读取摘要', () => {
    it('混合类型：按 ossFileId / materialId 关联读到对应 summary', async () => {
        // 准备 4 种类型材料
        const ossFileDoc = await createTestOssFile({ userId: testUser.id })
        const ossFileImg = await createTestOssFile({ userId: testUser.id })
        const ossFileAudio = await createTestOssFile({ userId: testUser.id })

        const matText = await createTestMaterial({
            caseId: testCase.id, type: CaseMaterialType.CASE_CONTENT,
        })
        const matDoc = await createTestMaterial({
            caseId: testCase.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFileDoc.id,
        })
        const matImg = await createTestMaterial({
            caseId: testCase.id, type: CaseMaterialType.IMAGE, ossFileId: ossFileImg.id,
        })
        const matAudio = await createTestMaterial({
            caseId: testCase.id, type: CaseMaterialType.AUDIO, ossFileId: ossFileAudio.id,
        })
        testIds.materialIds.push(matText.id, matDoc.id, matImg.id, matAudio.id)

        // 写四张表的 summary
        await prisma.textContentRecords.create({
            data: { userId: testUser.id, caseId: testCase.id, materialId: matText.id, content: 'x', summary: '文字简介', status: 2 },
        })
        await prisma.docRecognitionRecords.create({
            data: { userId: testUser.id, ossFileId: ossFileDoc.id, status: 2, summary: '文档简介', markdownContent: 'x' },
        })
        await prisma.imageRecognitionRecords.create({
            data: { userId: testUser.id, ossFileId: ossFileImg.id, status: 2, summary: '图片简介', markdownContent: 'x' },
        })
        await prisma.asrRecords.create({
            data: { userId: testUser.id, ossFileId: ossFileAudio.id, status: 2, summary: '音频简介', result: {} },
        })

        const map = await getMaterialSummariesByMaterials([
            { id: matText.id, type: CaseMaterialType.CASE_CONTENT, ossFileId: null },
            { id: matDoc.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFileDoc.id },
            { id: matImg.id, type: CaseMaterialType.IMAGE, ossFileId: ossFileImg.id },
            { id: matAudio.id, type: CaseMaterialType.AUDIO, ossFileId: ossFileAudio.id },
        ])

        expect(map.get(matText.id)).toBe('文字简介')
        expect(map.get(matDoc.id)).toBe('文档简介')
        expect(map.get(matImg.id)).toBe('图片简介')
        expect(map.get(matAudio.id)).toBe('音频简介')
    })

    it('空数组直接返回空 Map', async () => {
        const map = await getMaterialSummariesByMaterials([])
        expect(map.size).toBe(0)
    })

    it('找不到识别记录的材料：Map 不含该 materialId（不报错）', async () => {
        const ossFile = await createTestOssFile({ userId: testUser.id })
        const mat = await createTestMaterial({
            caseId: testCase.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFile.id,
        })
        testIds.materialIds.push(mat.id)
        // 不创建识别记录

        const map = await getMaterialSummariesByMaterials([
            { id: mat.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFile.id },
        ])

        expect(map.get(mat.id)).toBeUndefined()
    })
})
```

修改顶部 import：

```typescript
import {
    ...,
    getMaterialSummariesByMaterials,
} from '../../../server/services/material/material.service'
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/material.service.test.ts --reporter=default 2>&1 | tail -5`
Expected: FAIL（getMaterialSummariesByMaterials 未定义）

- [ ] **Step 3: 在 material.service.ts 末尾追加实现**

修改 `server/services/material/material.service.ts`，文件末尾追加：

```typescript
/**
 * 输入材料的最小描述
 *
 * - CASE_CONTENT 类型：summary 按 materialId 关联到 textContentRecords
 * - 其它三种类型：summary 按 ossFileId 关联到对应识别记录表
 */
export interface MaterialSummaryInput {
    id: number
    type: number  // CaseMaterialType
    ossFileId: number | null
}

/**
 * 批量按材料查 200 字简介，按 type 分组并行查 4 张表后合并到 Map<materialId, summary>。
 *
 * 设计：
 * - 4 种类型并行查询（Promise.all），单次往返时间取决于最慢的那张表
 * - 找不到识别记录或 summary 为 null 的 materialId 不进 Map（调用方自行处理 fallback）
 *
 * 用途：替换原来读 caseMaterials.summary 的所有路径（系统提示词构建、material API、
 * process_materials 工具等）。
 */
export async function getMaterialSummariesByMaterials(
    inputs: MaterialSummaryInput[],
): Promise<Map<number, string>> {
    const result = new Map<number, string>()
    if (inputs.length === 0) return result

    const textIds = inputs.filter(m => m.type === CaseMaterialType.CASE_CONTENT).map(m => m.id)
    const docOssFileIds = inputs
        .filter(m => m.type === CaseMaterialType.DOCUMENT && m.ossFileId)
        .map(m => m.ossFileId!)
    const imgOssFileIds = inputs
        .filter(m => m.type === CaseMaterialType.IMAGE && m.ossFileId)
        .map(m => m.ossFileId!)
    const audioOssFileIds = inputs
        .filter(m => m.type === CaseMaterialType.AUDIO && m.ossFileId)
        .map(m => m.ossFileId!)

    // 反向映射 ossFileId → materialId（同一文件可能被多个材料引用，取首个；并发场景每个材料各自 set）
    const docOssToMat = new Map<number, number[]>()
    const imgOssToMat = new Map<number, number[]>()
    const audioOssToMat = new Map<number, number[]>()
    for (const m of inputs) {
        if (!m.ossFileId) continue
        const target =
            m.type === CaseMaterialType.DOCUMENT ? docOssToMat
            : m.type === CaseMaterialType.IMAGE ? imgOssToMat
            : m.type === CaseMaterialType.AUDIO ? audioOssToMat
            : null
        if (!target) continue
        const list = target.get(m.ossFileId) ?? []
        list.push(m.id)
        target.set(m.ossFileId, list)
    }

    await Promise.all([
        // 文字
        textIds.length > 0
            ? prisma.textContentRecords
                .findMany({
                    where: { materialId: { in: textIds }, deletedAt: null },
                    select: { materialId: true, summary: true },
                })
                .then(rows => {
                    for (const r of rows) {
                        if (r.materialId && r.summary) result.set(r.materialId, r.summary)
                    }
                })
            : Promise.resolve(),
        // 文档
        docOssFileIds.length > 0
            ? prisma.docRecognitionRecords
                .findMany({
                    where: { ossFileId: { in: docOssFileIds }, deletedAt: null },
                    select: { ossFileId: true, summary: true },
                    orderBy: { createdAt: 'desc' },
                })
                .then(rows => {
                    for (const r of rows) {
                        if (r.ossFileId && r.summary) {
                            for (const matId of docOssToMat.get(r.ossFileId) ?? []) {
                                if (!result.has(matId)) result.set(matId, r.summary)
                            }
                        }
                    }
                })
            : Promise.resolve(),
        // 图片
        imgOssFileIds.length > 0
            ? prisma.imageRecognitionRecords
                .findMany({
                    where: { ossFileId: { in: imgOssFileIds }, deletedAt: null },
                    select: { ossFileId: true, summary: true },
                    orderBy: { createdAt: 'desc' },
                })
                .then(rows => {
                    for (const r of rows) {
                        if (r.ossFileId && r.summary) {
                            for (const matId of imgOssToMat.get(r.ossFileId) ?? []) {
                                if (!result.has(matId)) result.set(matId, r.summary)
                            }
                        }
                    }
                })
            : Promise.resolve(),
        // 音频
        audioOssFileIds.length > 0
            ? prisma.asrRecords
                .findMany({
                    where: { ossFileId: { in: audioOssFileIds }, deletedAt: null },
                    select: { ossFileId: true, summary: true },
                    orderBy: { createdAt: 'desc' },
                })
                .then(rows => {
                    for (const r of rows) {
                        if (r.ossFileId && r.summary) {
                            for (const matId of audioOssToMat.get(r.ossFileId) ?? []) {
                                if (!result.has(matId)) result.set(matId, r.summary)
                            }
                        }
                    }
                })
            : Promise.resolve(),
    ])

    return result
}
```

- [ ] **Step 4: 跑测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/material.service.test.ts --reporter=default 2>&1 | tail -10`
Expected: 全部通过（含新增 3 个）

- [ ] **Step 5: Commit**

```bash
git add server/services/material/material.service.ts tests/server/material/material.service.test.ts
git commit -m "feat(material): 新增 getMaterialSummariesByMaterials helper

按 materialId / ossFileId 跨 4 张表并行查 summary 后聚合，替代各处直读
caseMaterials.summary 的逻辑。"
```

---

### Task 7：替换简介生成触发点为新函数

**Files:**
- Modify: `server/services/material/asr.service.ts`（completeTranscriptionService）
- Modify: `server/services/material/mineru.service.ts`（completeConversionService）
- Modify: `server/services/material/materialProcess.service.ts`（同步成功路径 ×2）
- Modify: `server/services/material/material.service.ts`（markMaterialsByOssFileIdService）
- Modify: `server/services/material/materialPipeline.service.ts`（pipeline 内已识别保底 + 单文件路径 ×3）
- Modify: `server/api/v1/recognition/start.post.ts`（识别成功后追加 fire-and-forget）

- [ ] **Step 1: 修改 ASR completeTranscriptionService**

修改 `server/services/material/asr.service.ts`，找到原来加的 `markMaterialsByOssFileIdService(ossFileId, MaterialStatus.COMPLETED)` 调用（约 line 905+），在它**之前**加一行 fire-and-forget 触发简介生成：

```typescript
        // 6.2 fire-and-forget 触发 200 字简介生成（按文件级）
        // 内部 inflight Map 防并发重复，summary 已非空早返
        import('./ossFileSummary.service').then(m =>
            m.generateOssFileSummaryService(ossFileId, CaseMaterialType.AUDIO),
        ).catch(() => { /* 已在内部 catch */ })
```

文件顶部加：

```typescript
import { CaseMaterialType } from '#shared/types/case'
```

- [ ] **Step 2: 修改 MinerU completeConversionService**

修改 `server/services/material/mineru.service.ts`，找到 `markMaterialsByOssFileIdService(task.ossFileId, MaterialStatus.COMPLETED)` 调用，在它**之前**加：

```typescript
        // 6.2 fire-and-forget 触发 200 字简介生成
        import('./ossFileSummary.service').then(m =>
            m.generateOssFileSummaryService(task.ossFileId, CaseMaterialType.DOCUMENT),
        ).catch(() => { /* 已在内部 catch */ })
```

顶部 import 同 step 1。

- [ ] **Step 3: 修改 processMaterialService 同步成功路径**

修改 `server/services/material/materialProcess.service.ts`：

第 1 处（约 line 137-138 文本材料路径，原 fire-and-forget 老函数）：

```typescript
            await updateMaterialStatusService(material.id, MaterialStatus.COMPLETED)
            // 异步触发摘要生成（fire-and-forget；generateMaterialSummaryService 内部已 catch）
            generateMaterialSummaryService(material.id).catch(() => { /* 已在内部 catch */ })
```

改为（CASE_CONTENT 仍走老函数 generateMaterialSummaryService，因为它需要写 textContentRecords.summary 而非 ossFile 级——下一个 task 才迁老函数）：

```typescript
            await updateMaterialStatusService(material.id, MaterialStatus.COMPLETED)
            // 异步触发摘要生成（fire-and-forget）
            // CASE_CONTENT 走 caseMaterials.id 路径（写 textContentRecords.summary）
            generateMaterialSummaryService(material.id).catch(() => { /* 已在内部 catch */ })
```

第 2 处（约 line 210 同步成功 + 有 content 路径，OCR/docx 等）：

```typescript
            // 11.1 异步触发摘要生成（fire-and-forget；OCR/同步识别成功路径——
            // 历史 bug：仅 ASR/MinerU 异步路径与 ensureMaterialsReadyForDraftService 触发摘要，
            // 此条同步路径漏掉，导致图片 / 文本材料 summary 永远为 null。）
            generateMaterialSummaryService(materialId).catch(() => { /* 已在内部 catch */ })
```

改为（用 ossFile 级；type 已知是 IMAGE 或 DOCUMENT，从 material 拿）：

```typescript
            // 11.1 异步触发 200 字简介生成（fire-and-forget，按文件级）
            // CASE_CONTENT 不会走到这里（无 ossFileId 早在 step 117 处理）
            if (material.ossFileId) {
                import('./ossFileSummary.service').then(m =>
                    m.generateOssFileSummaryService(material.ossFileId!, material.type as CaseMaterialType),
                ).catch(() => { /* 已在内部 catch */ })
            }
```

- [ ] **Step 4: 修改 markMaterialsByOssFileIdService 的简介触发**

修改 `server/services/material/material.service.ts`，找到 `markMaterialsByOssFileIdService` 函数中的简介触发循环（约 line 374-382）：

```typescript
    if (status === MaterialStatus.COMPLETED) {
        for (const r of records) {
            generateMaterialSummaryService(r.id).catch(() => { /* 已在内部 catch */ })
        }
    }
```

改为：

```typescript
    if (status === MaterialStatus.COMPLETED) {
        // 200 字简介按文件级生成（同一 ossFileId 的多条 caseMaterials 共享一份简介）
        // records 都是同一 ossFileId 下的（updateMany where 限定），取首条的 type 触发即可
        const first = records[0]
        if (first && first.ossFileId) {
            // 但不同 caseMaterials 行可能 type 不同（极少数场景），仍按 ossFileId 去重触发
            const ossFileTypeKeys = new Set<string>()
            for (const r of records) {
                if (!r.ossFileId) continue
                const key = `${r.ossFileId}_${r.type}`
                if (ossFileTypeKeys.has(key)) continue
                ossFileTypeKeys.add(key)
                import('./ossFileSummary.service').then(m =>
                    m.generateOssFileSummaryService(r.ossFileId!, r.type as CaseMaterialType),
                ).catch(() => { /* 已在内部 catch */ })
            }
        }
    }
```

注意：原 `findMany` select 仅 `{ id }`，需扩展为 `{ id, ossFileId, type }`。找到上方 `findMany` 调用：

```typescript
    const records = await prisma.caseMaterials.findMany({
        where: { ossFileId, deletedAt: null },
        select: { id: true },
    })
```

改为：

```typescript
    const records = await prisma.caseMaterials.findMany({
        where: { ossFileId, deletedAt: null },
        select: { id: true, ossFileId: true, type: true },
    })
```

- [ ] **Step 5: 修改 pipeline 内的简介触发**

修改 `server/services/material/materialPipeline.service.ts`：

找到约 line 88-96 的"摘要兜底循环"：

```typescript
    for (const m of materials) {
        if (recognizedMap.get(m.id)) {
            generateMaterialSummaryService(m.id).catch(() => { /* 已在内部 catch */ })
        }
    }
```

改为（按 ossFileId 触发新函数）：

```typescript
    // 摘要兜底：对所有已识别材料并行触发 200 字简介生成（fire-and-forget）
    // generateOssFileSummaryService 内部 inflight Map 防并发重复，summary 已存在早返
    for (const m of materials) {
        if (!recognizedMap.get(m.id) || !m.ossFileId) continue
        if (m.type === CaseMaterialType.CASE_CONTENT) continue  // CASE_CONTENT 走旧函数（textContentRecords）
        import('./ossFileSummary.service').then(svc =>
            svc.generateOssFileSummaryService(m.ossFileId!, m.type as CaseMaterialType),
        ).catch(() => { /* 已在内部 catch */ })
    }
```

找到约 line 776, 813, 851 的三处 ensureMaterialsReadyForDraftService 中 generateMaterialSummaryService 调用，逻辑同样改为按 ossFileId 触发新函数。三处分别：

第 1 处（已 COMPLETED 幂等返回路径）：

```typescript
            generateMaterialSummaryService(existing.id).catch(() => { /* 已在内部 catch */ })
```

改为：

```typescript
            // 已识别材料按文件级补触发简介
            if (existing.ossFileId && existing.type !== CaseMaterialType.CASE_CONTENT) {
                import('./ossFileSummary.service').then(svc =>
                    svc.generateOssFileSummaryService(existing.ossFileId!, existing.type as CaseMaterialType),
                ).catch(() => { /* 已在内部 catch */ })
            }
```

第 2 处和第 3 处（跨 draft 复用 + 轮询 COMPLETED）类似，把 `generateMaterialSummaryService(materialId).catch(...)` 改为按 ossFileId 触发新函数（材料对象同上下文里取 type / ossFileId）。

- [ ] **Step 6: 修改 recognition/start.post.ts 同步成功路径触发**

修改 `server/api/v1/recognition/start.post.ts`，在 `results.push(...)` 之前追加：

```typescript
        // 同步识别成功 → fire-and-forget 触发 200 字简介生成
        if (resultStatus === 'completed' && fileType !== CaseMaterialType.CASE_CONTENT) {
            import('~~/server/services/material/ossFileSummary.service').then(m =>
                m.generateOssFileSummaryService(ossFileId, fileType as CaseMaterialType),
            ).catch(() => { /* 已在内部 catch */ })
        }
```

- [ ] **Step 7: 跑相关测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过；若 mock 旧函数的测试失败，调整 mock 也 mock 新函数（`vi.mock('~~/server/services/material/ossFileSummary.service', () => ({ generateOssFileSummaryService: vi.fn() }))`）

- [ ] **Step 8: Commit**

```bash
git add server/services/material/ server/api/v1/recognition/ tests/server/material/
git commit -m "refactor(material): 简介触发点统一切换为 generateOssFileSummaryService

7 处触发点（识别异步完成 / 同步完成 / pipeline 兜底 / draft 单文件 ×3 /
recognition/start 同步成功）从按 caseMaterials.id 触发改为按 ossFileId
触发；CASE_CONTENT 类型仍走旧函数（textContentRecords 按 materialId）。"
```

---

### Task 8：识别状态接口 recognized 判定升级

**Files:**
- Modify: `server/api/v1/recognition/status/[ossFileId].get.ts`
- Test: `tests/server/recognition/status.test.ts`（如不存在则创建）

- [ ] **Step 1: 写失败测试**

创建或修改 `tests/server/recognition/status.test.ts`，加入：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import handler from '~~/server/api/v1/recognition/status/[ossFileId].get'
import { createTestUser, createTestOssFile, cleanupTestData, createEmptyTestIds } from '~~/tests/server/material/test-db-helper'
import { createMockEvent } from '~~/tests/_helpers/mockEvent'  // 若无此 helper 用现成的方式 mock

describe('recognition/status recognized 判定升级', () => {
    let testIds = createEmptyTestIds()
    let user: any

    beforeEach(async () => {
        testIds = createEmptyTestIds()
        user = await createTestUser()
        testIds.userIds.push(user.id)
    })
    afterEach(async () => {
        await cleanupTestData(testIds)
    })

    it('文档识别 SUCCESS 但 summary 为 null → recognized=false', async () => {
        const oss = await createTestOssFile({ userId: user.id })
        await prisma.docRecognitionRecords.create({
            data: { userId: user.id, ossFileId: oss.id, status: 2, summary: null, markdownContent: 'x' },
        })

        const event = createMockEvent({ user, params: { ossFileId: String(oss.id) } })
        const res: any = await handler(event)

        expect(res.data.recognized).toBe(false)
        expect(res.data.status).toBe(2)
    })

    it('文档识别 SUCCESS 且 summary 非空 → recognized=true', async () => {
        const oss = await createTestOssFile({ userId: user.id })
        await prisma.docRecognitionRecords.create({
            data: { userId: user.id, ossFileId: oss.id, status: 2, summary: '简介', markdownContent: 'x' },
        })

        const event = createMockEvent({ user, params: { ossFileId: String(oss.id) } })
        const res: any = await handler(event)

        expect(res.data.recognized).toBe(true)
    })

    it('音频和图片同样判定', async () => {
        const ossAudio = await createTestOssFile({ userId: user.id })
        await prisma.asrRecords.create({
            data: { userId: user.id, ossFileId: ossAudio.id, status: 2, summary: null, result: {} },
        })
        const event1 = createMockEvent({ user, params: { ossFileId: String(ossAudio.id) } })
        const res1: any = await handler(event1)
        expect(res1.data.recognized).toBe(false)
    })
})
```

如果 `tests/_helpers/mockEvent` 不存在，参考已有 handler 测试或换用 `vi.mock('h3', ...)`。

- [ ] **Step 2: 跑确认 fail**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/recognition/status.test.ts --reporter=default 2>&1 | tail -5`
Expected: FAIL（recognized 仍为 true）

- [ ] **Step 3: 修改 handler 升级判定**

修改 `server/api/v1/recognition/status/[ossFileId].get.ts`，找到三处 `isRecognized = ... === SUCCESS / COMPLETED` 的判定：

`docRecord` 分支：

```typescript
        } else if (docRecord) {
            const isRecognized = docRecord.status === DocRecognitionStatus.SUCCESS
```

改为：

```typescript
        } else if (docRecord) {
            // 已就绪 = 识别成功 + 200 字简介已生成
            const isRecognized = docRecord.status === DocRecognitionStatus.SUCCESS && !!docRecord.summary
```

`imageRecord` 分支：

```typescript
        } else if (imageRecord) {
            const isRecognized = imageRecord.status === ImageRecognitionStatus.COMPLETED
```

改为：

```typescript
        } else if (imageRecord) {
            const isRecognized = imageRecord.status === ImageRecognitionStatus.COMPLETED && !!imageRecord.summary
```

`asrRecord` 分支：

```typescript
        } else if (asrRecord) {
            const isRecognized = asrRecord.status === AsrRecordStatus.SUCCESS
```

改为：

```typescript
        } else if (asrRecord) {
            const isRecognized = asrRecord.status === AsrRecordStatus.SUCCESS && !!asrRecord.summary
```

`mineruTask` 分支保持不变（mineruTask 表上没有 summary 字段，识别成功后 docRecord 才生成简介——所以 mineruTask 命中时简介必未生成 → 此处直接令 isRecognized=false 更准确）：

```typescript
        if (mineruTask) {
            const isRecognized = mineruTask.status === MineruTaskStatus.SUCCESS
```

改为：

```typescript
        if (mineruTask) {
            // mineruTask 上无 summary 字段——只有 docRecord 才有；mineruTask 命中通常说明
            // docRecord 还未创建或简介未生成 → recognized=false 让前端继续轮询
            const isRecognized = false
```

- [ ] **Step 4: 跑测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/recognition/status.test.ts --reporter=default 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/recognition/status/ tests/server/recognition/
git commit -m "feat(recognition): 状态接口 recognized 判定升级为'识别+简介双就绪'

让 AiPromptInput 发送按钮自动等到简介生成完成后才放行（前端零改动）。
mineruTask 命中时强制 recognized=false（mineruTask 表无 summary 字段）。"
```

---

### Task 9：ensureMaterialsReadyService 终态轮询 + SSE 推送

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts`（升级 waitMaterialsTerminalAndSummary 为按文件级判定 + 推送进度）
- Modify: `server/agents/_shared/case-context/caseProcessMaterial.middleware.ts`（中间件包装 SSE 推送）

- [ ] **Step 1: 改写 waitMaterialsTerminalAndSummary 按文件级判定**

修改 `server/services/material/materialPipeline.service.ts`，原 `waitMaterialsTerminalAndSummary` 函数读 `caseMaterials.summary`。改为读识别记录表的 summary（通过 ossFileId/materialId）：

```typescript
/**
 * 等所有材料到达"识别终态 + 简介生成完毕"
 *
 * 终态判定（按 4 张识别记录表）：
 * - 文字材料：textContentRecords.status=SUCCESS && summary 非 null
 * - 文档/图片/音频：对应识别记录 status=SUCCESS && summary 非 null
 * - 任意识别记录 status=FAILED 也算终态（识别失败放行，不卡）
 *
 * 超时策略（3 分钟），超时后强制 await 一次同步生成兜底。
 *
 * 可选 onProgress 回调：每次轮询拿到当前快照后调一次，用于中间件推送 SSE 进度。
 */
export interface MaterialReadinessSnapshot {
    materialId: number
    type: CaseMaterialType
    status: 'pending' | 'recognizing' | 'summarizing' | 'ready' | 'failed'
}

async function waitMaterialsTerminalAndSummary(
    materials: MaterialWithFile[],
    onProgress?: (snapshot: MaterialReadinessSnapshot[]) => void | Promise<void>,
): Promise<void> {
    const startedAt = Date.now()
    const TIMEOUT_MS = 3 * 60 * 1000
    const POLL_MS = 1000

    while (Date.now() - startedAt < TIMEOUT_MS) {
        const snapshot = await snapshotMaterialReadiness(materials)
        if (onProgress) {
            try { await onProgress(snapshot) } catch { /* 推送失败不阻塞 */ }
        }
        const allReady = snapshot.every(s => s.status === 'ready' || s.status === 'failed')
        if (allReady) return

        await new Promise(r => setTimeout(r, POLL_MS))
    }

    // 超时兜底：对仍非终态的材料 await 一次同步生成
    const finalSnapshot = await snapshotMaterialReadiness(materials)
    const stuckMaterials = materials.filter(m => {
        const s = finalSnapshot.find(x => x.materialId === m.id)
        return s && s.status !== 'ready' && s.status !== 'failed'
    })
    if (stuckMaterials.length > 0) {
        logger.warn('材料终态轮询超时，强制同步生成简介', {
            count: stuckMaterials.length,
            ids: stuckMaterials.map(m => m.id),
        })
        const { generateOssFileSummaryService } = await import('./ossFileSummary.service')
        await Promise.allSettled(stuckMaterials.map(m => {
            if (m.type === CaseMaterialType.CASE_CONTENT) {
                // CASE_CONTENT 走旧函数兜底（写 textContentRecords.summary）
                return generateMaterialSummaryService(m.id)
            }
            if (!m.ossFileId) return Promise.resolve()
            return generateOssFileSummaryService(m.ossFileId, m.type as CaseMaterialType)
        }))
    }

    // 最后再发一次进度（让前端看到 end 状态）
    if (onProgress) {
        const last = await snapshotMaterialReadiness(materials)
        try { await onProgress(last) } catch { /* ignore */ }
    }
}

/**
 * 查询材料就绪状态快照（按文件级跨 4 表 join 查 summary）
 */
async function snapshotMaterialReadiness(
    materials: MaterialWithFile[],
): Promise<MaterialReadinessSnapshot[]> {
    if (materials.length === 0) return []

    // 1. 拉 caseMaterials.status（PROCESSING/PENDING 时映射 recognizing/pending）
    const matStatusMap = new Map(materials.map(m => [m.id, m.status]))

    // 2. 拉 4 表 summary（用 helper）
    const summaryMap = await getMaterialSummariesByMaterials(
        materials.map(m => ({ id: m.id, type: m.type, ossFileId: m.ossFileId })),
    )

    // 3. 组合判定
    return materials.map(m => {
        const matStatus = matStatusMap.get(m.id)
        const hasSummary = summaryMap.has(m.id)
        let status: MaterialReadinessSnapshot['status']
        if (matStatus === MaterialStatus.FAILED) {
            status = 'failed'
        } else if (matStatus === MaterialStatus.PENDING) {
            status = 'pending'
        } else if (matStatus === MaterialStatus.PROCESSING) {
            status = 'recognizing'
        } else if (matStatus === MaterialStatus.COMPLETED) {
            status = hasSummary ? 'ready' : 'summarizing'
        } else {
            status = 'pending'
        }
        return { materialId: m.id, type: m.type as CaseMaterialType, status }
    })
}
```

文件顶部已有 `getMaterialSummariesByMaterials` import（来自 Task 6）；如未 import 则加：

```typescript
import { getMaterialSummariesByMaterials } from './material.service'
```

将原 `waitMaterialsTerminalAndSummary(materialIds: number[])` 调用点改为 `waitMaterialsTerminalAndSummary(materials)`，同时在 `runRecognitionAndEmbeddingPipeline` 内部追加一个可选 `onProgress` 参数透传：

```typescript
async function runRecognitionAndEmbeddingPipeline(
    materials: MaterialWithFile[],
    userId: number,
    initialFailed: MaterialFailedItem[] = [],
    onProgress?: (snapshot: MaterialReadinessSnapshot[]) => void | Promise<void>,
): Promise<MaterialReadyResult> {
    ...
    if (materials.length > 0) {
        await waitMaterialsTerminalAndSummary(materials, onProgress)
    }
    ...
}
```

`ensureMaterialsReadyService` 也加 `onProgress` 参数透传：

```typescript
export async function ensureMaterialsReadyService(
    caseId: number,
    userId: number,
    onProgress?: (snapshot: MaterialReadinessSnapshot[]) => void | Promise<void>,
): Promise<MaterialReadyResult> {
    const materials = await getMaterialsByCaseIdService(caseId)
    return runRecognitionAndEmbeddingPipeline(materials, userId, [], onProgress)
}
```

`MaterialReadinessSnapshot` 类型 export（让中间件能 import）。

- [ ] **Step 2: 改 caseProcessMaterialMiddleware 推送 SSE**

修改 `server/agents/_shared/case-context/caseProcessMaterial.middleware.ts`：

```typescript
import { createMiddleware } from "langchain"
import { ensureMaterialsReadyService } from "~~/server/services/material/materialPipeline.service"
import type { MaterialReadinessSnapshot } from "~~/server/services/material/materialPipeline.service"
import { publishCustomEvent } from "~~/server/services/agent/agentEventBridge"
import { SSECustomEventType } from "#shared/types/agentEvent"
import type { MaterialItem, PrepareMaterialsPayload } from "#shared/types/agentEvent"
import { getMaterialsByCaseIdService } from "~~/server/services/material/material.service"

/**
 * 材料就绪保底中间件
 *
 * 升级版：等到所有材料"识别 + 200 字简介"双就绪才放行 Agent。
 * 等待期间（首次发现未就绪）通过 SSE PREPARE_MATERIALS 事件推送进度，
 * 前端 useStreamChat 拦截后合成 process_materials 同款 toolCall，复用 MaterialProcessTool.vue 渲染。
 */
export const caseProcessMaterialMiddleware = (userId: number, caseId: number, runId?: string) => {
    return createMiddleware({
        name: "CaseProcessMaterialMiddleware",
        beforeAgent: {
            hook: async (_state) => {
                let toolCallId: string | null = null
                let started = false
                const materials = await getMaterialsByCaseIdService(caseId)
                const nameMap = new Map(materials.map(m => [m.id, m.name]))

                const onProgress = async (snapshot: MaterialReadinessSnapshot[]) => {
                    if (!runId) return  // 无 runId 不推送（兼容旧调用方）
                    const items: MaterialItem[] = snapshot.map(s => ({
                        id: s.materialId,
                        name: nameMap.get(s.materialId) ?? '未知材料',
                        type: s.type,
                        status: s.status,
                    }))
                    const allReady = snapshot.every(s => s.status === 'ready' || s.status === 'failed')
                    if (!started) {
                        started = true
                        toolCallId = `prepare-${runId}`
                        const startPayload: PrepareMaterialsPayload = {
                            phase: 'start',
                            toolCallId,
                            materials: items,
                        }
                        await publishCustomEvent({
                            type: 'custom_event',
                            runId,
                            sessionId: '',  // sessionId 上层不强制，bridge 内部按 runId 路由
                            name: SSECustomEventType.PREPARE_MATERIALS,
                            data: startPayload,
                        }).catch(() => { /* ignore */ })
                    } else if (!allReady) {
                        const progressPayload: PrepareMaterialsPayload = {
                            phase: 'progress',
                            toolCallId: toolCallId!,
                            materials: items,
                        }
                        await publishCustomEvent({
                            type: 'custom_event',
                            runId,
                            sessionId: '',
                            name: SSECustomEventType.PREPARE_MATERIALS,
                            data: progressPayload,
                        }).catch(() => { /* ignore */ })
                    }
                }

                try {
                    const result = await ensureMaterialsReadyService(caseId, userId, onProgress)
                    logger.info('材料预处理完成', {
                        caseId,
                        totalMaterials: result.totalMaterials,
                        alreadyEmbedded: result.alreadyEmbedded,
                        newlyProcessed: result.newlyProcessed,
                        failedCount: result.failed.length,
                    })

                    // 发 phase=end（若曾发过 start）
                    if (started && toolCallId && runId) {
                        const endPayload: PrepareMaterialsPayload = {
                            phase: 'end',
                            toolCallId,
                            materials: (await getMaterialsByCaseIdService(caseId)).map(m => ({
                                id: m.id,
                                name: m.name,
                                type: m.type,
                                status: 'ready',  // end 时统一为 ready；失败由 failedCount 反映
                            })),
                            failedCount: result.failed.length,
                        }
                        await publishCustomEvent({
                            type: 'custom_event',
                            runId,
                            sessionId: '',
                            name: SSECustomEventType.PREPARE_MATERIALS,
                            data: endPayload,
                        }).catch(() => { /* ignore */ })
                    }
                } catch (error) {
                    logger.error('材料预处理中间件异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}
```

- [ ] **Step 3: 改所有挂载点透传 runId**

修改以下挂载中间件的文件，传入 `ctx.runId`：

`server/agents/case-main/agent.config.ts`（约 line 52）：
```typescript
            middleware: caseProcessMaterialMiddleware(ctx.userId, ctx.caseId!, ctx.runId),
```

`server/services/workflow/agents/moduleAgent.ts`（约 line 179）：
```typescript
            caseProcessMaterialMiddleware(userId, caseId, runId),
```
（runId 从函数入参拿，已在上下文中）

`server/services/workflow/agents/documentMainAgent.ts`（约 line 172）类似。

- [ ] **Step 4: 跑测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/ tests/server/agents/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过；如有 mock 旧函数签名失败，更新 mock

- [ ] **Step 5: Commit**

```bash
git add server/services/material/materialPipeline.service.ts server/agents/_shared/case-context/ server/agents/case-main/ server/services/workflow/agents/
git commit -m "feat(material): 中间件升级为'识别+简介双就绪'判定 + SSE 进度推送

- ensureMaterialsReadyService / waitMaterialsTerminalAndSummary 改为按文件级
  跨表查 summary（不再读 caseMaterials.summary）
- 中间件 onProgress 回调推送 PREPARE_MATERIALS SSE 事件，前端可渲染进度卡片
- 所有挂载点透传 runId 给中间件"
```

---

### Task 10：V2 案件初分挂载 caseProcessMaterialMiddleware

**Files:**
- Modify: `server/services/workflow/caseAnalysisV2.executor.ts`（撤回临时 await）
- Modify: `server/agents/case-analysis/runAnalysisSubAgent.ts`（挂中间件）

- [ ] **Step 1: 撤回 V2 入口的临时 await**

修改 `server/services/workflow/caseAnalysisV2.executor.ts`，删除之前加的：

```typescript
import { ensureMaterialsReadyService } from '~~/server/services/material/materialPipeline.service'
```

和：

```typescript
    if (!params.command) {
        await ensureMaterialsReadyService(params.caseId, params.userId)
    }
```

恢复成 spec 之前的纯 stream 启动逻辑。

- [ ] **Step 2: V2 子代理挂中间件**

修改 `server/agents/case-analysis/runAnalysisSubAgent.ts`，找到 `middlewareItems` 列表（约 line 155-191），在 `MESSAGE_INTEGRITY` 中间件之后追加：

```typescript
        {
            middleware: caseProcessMaterialMiddleware(userId, caseId, runId),
            priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
            name: MIDDLEWARE_NAMES.PROCESS_MATERIAL,
        },
```

文件顶部 import：

```typescript
import { caseProcessMaterialMiddleware } from '~~/server/agents/_shared/case-context/caseProcessMaterial.middleware'
```

确认 `MIDDLEWARE_PRIORITY.PROCESS_MATERIAL` 与 `MIDDLEWARE_NAMES.PROCESS_MATERIAL` 已在 `server/services/agent-platform/middleware/types.ts` 定义；如未定义则添加（参考 case-main agent.config.ts 中的优先级 10）。

- [ ] **Step 3: 删除 caseAnalysisV2.executor.test.ts 中的相关测试**

修改 `tests/server/workflow/caseAnalysisV2.executor.test.ts`，由于撤回了 await ensureMaterialsReadyService，原先验证它被调用的两个测试也需要相应调整或删除：删除"首次启动调 ensureMaterialsReadyService"和"resume 跳过"两条测试，因为 V2 入口已不直接调该函数（改为通过 runAnalysisSubAgent 内的中间件）。或者改测试为"V2 子代理启动时挂载了 caseProcessMaterialMiddleware"。

- [ ] **Step 4: 跑测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/workflow/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/caseAnalysisV2.executor.ts server/agents/case-analysis/runAnalysisSubAgent.ts tests/server/workflow/
git commit -m "feat(case-analysis): V2 工作流挂载 caseProcessMaterialMiddleware

- 撤回 V2 executor 中的临时 await ensureMaterialsReadyService
- 在 runAnalysisSubAgent 的中间件管道里挂 caseProcessMaterialMiddleware（PROCESS_MATERIAL 优先级）
- 7 个分析子代理启动前自动过中间件，与小索/模块对话/文书生成行为一致"
```

---

### Task 11：替换 caseMaterials.summary 读取路径

**Files:**
- Modify: `server/services/agent-platform/context/moduleContextBuilder.ts`（材料行渲染）
- Modify: `server/services/material/materialPipeline.service.ts`（getMaterialContextService、getMaterialListWithSummariesService）
- Modify: `server/api/v1/cases/materials/[caseId].get.ts`、`[caseId].post.ts`
- Modify: `server/api/v1/assistant/document/drafts/related-materials/[id].get.ts`
- Modify: 其它读 `m.summary` 的地方

- [ ] **Step 1: moduleContextBuilder.ts 改读 summary 来源**

修改 `server/services/agent-platform/context/moduleContextBuilder.ts`，找到读 `mat.summary` 的渲染代码（约 line 165-170），同时找到上方拉取 materials 的代码：

原 `getMaterialListWithSummariesService` 返回值 `summary` 直接来自 `caseMaterials.summary`。本步骤把这个 service 改为内部用 helper 读跨表 summary，对外 API 不变。

修改 `materialPipeline.service.ts` 的 `getMaterialListWithSummariesService`：

```typescript
export async function getMaterialListWithSummariesService(caseId: number): Promise<Array<{
    id: number
    name: string
    type: number
    status: number
    ossFileId: number | null
    summary: string | null
}>> {
    const materials = await prisma.caseMaterials.findMany({
        where: { caseId, deletedAt: null },
        select: { id: true, name: true, type: true, status: true, ossFileId: true },
        orderBy: { createdAt: 'asc' },
    })
    if (materials.length === 0) return []

    const summaryMap = await getMaterialSummariesByMaterials(
        materials.map(m => ({ id: m.id, type: m.type, ossFileId: m.ossFileId })),
    )

    return materials.map(m => ({
        ...m,
        summary: summaryMap.get(m.id) ?? null,
    }))
}
```

- [ ] **Step 2: getMaterialContextService 改读 summary 来源**

`server/services/material/materialPipeline.service.ts` 内 `getMaterialContextService` 函数中也读 `m.summary`，先确认入参 `materials` 是否带 summary 字段：找到 `materialList` 构建处（约 line 540-543）：

```typescript
        const summaryText = m.summary || content.substring(0, 200) + '...'
        const summaryTokens = estimateTokens(summaryText)
```

如果 `m` 来自 `caseMaterials`，先在函数入口处批量查 summaryMap：

```typescript
export async function getMaterialContextService(
    materials: MaterialWithFile[],
): Promise<MaterialContextResult> {
    if (materials.length === 0) {
        return { mode: 'empty', totalTokens: 0, materialList: [] }
    }
    // 跨表查 summary（不再依赖 caseMaterials.summary）
    const summaryMap = await getMaterialSummariesByMaterials(
        materials.map(m => ({ id: m.id, type: m.type, ossFileId: m.ossFileId })),
    )
    ...
```

后续 `m.summary` 替换为 `summaryMap.get(m.id) ?? null`。

- [ ] **Step 3: cases/materials API 改读 summary 来源**

修改 `server/api/v1/cases/materials/[caseId].get.ts`（约 line 46）和 `[caseId].post.ts`（约 line 109），把响应中的 `summary: m.summary` 改为通过 helper 读：

GET 接口：

```typescript
import { getMaterialSummariesByMaterials } from '~~/server/services/material/material.service'

// ... 拿到 materials 之后
const summaryMap = await getMaterialSummariesByMaterials(
    materials.map(m => ({ id: m.id, type: m.type, ossFileId: m.ossFileId })),
)
const responseData = materials.map(m => ({
    ...,
    summary: summaryMap.get(m.id) ?? null,
}))
```

POST 接口同理。

- [ ] **Step 4: drafts/related-materials API 改读 summary 来源**

修改 `server/api/v1/assistant/document/drafts/related-materials/[id].get.ts`（约 line 47），同样替换。

- [ ] **Step 5: 其它读 m.summary 的地方**

Run: `grep -rn "m\.summary\|material\.summary\|mat\.summary\|\.summary" server --include="*.ts" | grep -v ".test.ts" | grep -v "case_summary\|analysisResult\|analysis\.summary\|caseRecord\.summary" | head -20`

每个剩余引用根据上下文替换为 helper 调用。

- [ ] **Step 6: 跑全部 server 测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过；如类型错误（caseMaterials.summary 不存在）—— 那些是漏改的读取点，逐一修

- [ ] **Step 7: Commit**

```bash
git add server/
git commit -m "refactor(material): 8+ 处 caseMaterials.summary 读取改走跨表 helper

通过 getMaterialSummariesByMaterials 统一从识别记录表读 summary，
彻底移除对 caseMaterials.summary 字段的依赖。"
```

---

### Task 12：process_materials 工具 output 加 status 字段

**Files:**
- Modify: `server/services/agent-platform/tools/processMaterials.tool.ts`

- [ ] **Step 1: 给工具返回的 materialList 加 status 字段**

修改 `server/services/agent-platform/tools/processMaterials.tool.ts`，找到 `materialList` 映射代码（约 line 80-93），在 `embedded` 字段旁加 `status` 字段：

```typescript
import { snapshotMaterialReadiness } from '~~/server/services/material/materialPipeline.service'  // 导出 snapshotMaterialReadiness

// ...

const snapshot = await snapshotMaterialReadiness(materials)
const statusMap = new Map(snapshot.map(s => [s.materialId, s.status]))

const materialList = materialContext.materialList.map(m => {
    const material = materials.find(mat => getSourceId(mat) === m.sourceId)
    const payloadText = m.mode === 'full' ? m.content : m.summary ?? ''
    return {
        ...m,
        id: material?.id,
        tokenCount: payloadText ? estimateTokens(payloadText) : 0,
        embedded: material ? (embeddedMap.get(material.id) ?? false) : false,
        status: material ? (statusMap.get(material.id) ?? 'pending') : 'pending',
    }
})
```

`snapshotMaterialReadiness` 在 Task 9 中是 internal，需要 export 出去。修改 `materialPipeline.service.ts`，将其改为 `export async function snapshotMaterialReadiness(...)`。

- [ ] **Step 2: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head -10`
Expected: 无错误

- [ ] **Step 3: 跑工具测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/agent-platform/tools/processMaterials.tool.test.ts --reporter=default 2>&1 | tail -5`
Expected: 通过；若有断言 output 字段的测试需要补 status 字段

- [ ] **Step 4: Commit**

```bash
git add server/services/agent-platform/tools/processMaterials.tool.ts server/services/material/materialPipeline.service.ts
git commit -m "feat(tool): process_materials output 增加 status 字段

每条材料附带'识别+简介'就绪状态，前端 MaterialProcessTool.vue 渲染
五态状态指示统一来源（工具调用路径和保底中间件路径数据结构一致）。"
```

---

### Task 13：前端 useStreamChat 拦截 prepare_materials

**Files:**
- Modify: `app/composables/useStreamChat.ts`

- [ ] **Step 1: 加拦截分支**

修改 `app/composables/useStreamChat.ts`，找到现有 `analysis_summary` 拦截块（约 line 285-325），在它**之后**追加：

```typescript
            // 准备材料卡片：合成 process_materials 工具卡片，复用 MaterialProcessTool 渲染
            // toolCallId 用 sentinel 'prepare-${runId}'，挂到当前会话最新 AIMessage
            if (
                data
                && typeof data === 'object'
                && 'name' in data
                && (data as { name: unknown }).name === 'prepare_materials'
            ) {
                const payload = (data as unknown as { data: PrepareMaterialsPayload }).data
                // 找到当前会话最新 AIMessage 作为 parent
                const aiMessages = (s.messages as BaseMessage[] | undefined)?.filter(
                    m => (m as any)._getType?.() === 'ai',
                ) ?? []
                const parentId = aiMessages[aiMessages.length - 1]?.id
                    ?? `pre-agent-${payload.toolCallId}`

                const list = syntheticToolCalls[parentId] ?? []
                let mutated = false
                if (payload.phase === 'start') {
                    if (!list.some(t => t.id === payload.toolCallId)) {
                        list.push({
                            id: payload.toolCallId,
                            name: 'process_materials',  // 复用工具卡片渲染
                            args: { materials: payload.materials },
                            state: 'input-available',
                        })
                        mutated = true
                    }
                } else if (payload.phase === 'progress') {
                    const idx = list.findIndex(t => t.id === payload.toolCallId)
                    if (idx >= 0) {
                        list[idx] = {
                            ...list[idx]!,
                            args: { materials: payload.materials },
                        }
                        mutated = true
                    }
                } else {
                    // phase === 'end'
                    const idx = list.findIndex(t => t.id === payload.toolCallId)
                    if (idx >= 0) {
                        list[idx] = {
                            ...list[idx]!,
                            result: { materials: payload.materials, failedCount: payload.failedCount },
                            state: payload.failedCount === 0 ? 'output-available' : 'output-error',
                        }
                        mutated = true
                    }
                }
                if (mutated) {
                    syntheticToolCalls[parentId] = [...list]
                }
                return
            }
```

文件顶部 import：

```typescript
import type { PrepareMaterialsPayload } from '#shared/types/agentEvent'
```

- [ ] **Step 2: 跑前端测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/client/composables/useStreamChat.test.ts --reporter=default 2>&1 | tail -10`
Expected: 通过；若有相关测试报错调整断言

- [ ] **Step 3: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head -5`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add app/composables/useStreamChat.ts
git commit -m "feat(client): useStreamChat 拦截 prepare_materials 事件合成工具卡片

合成的 toolCall.name='process_materials'，由 AiToolRenderer 路由到
MaterialProcessTool.vue 渲染，复用现有卡片组件不另起。"
```

---

### Task 14：MaterialProcessTool.vue 五态升级

**Files:**
- Modify: `app/components/ai/tools/MaterialProcessTool.vue`

- [ ] **Step 1: 升级渲染**

把 `app/components/ai/tools/MaterialProcessTool.vue` 替换为：

```vue
<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import { CheckCircle2Icon, CircleIcon, Loader2Icon, XCircleIcon } from 'lucide-vue-next'

interface MaterialItem {
    id: number
    name: string
    type: number
    status?: 'pending' | 'recognizing' | 'summarizing' | 'ready' | 'failed'
    embedded?: boolean  // 旧字段兼容
}

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

// 数据来源：优先 output（LLM 主动调起 process_materials 工具的返回），
// 没有 output 时取 input/args（中间件保底事件合成的 toolCall）
const sourceData = computed(() => {
    if (props.output != null) {
        try {
            return typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        } catch {
            return null
        }
    }
    return props.input ?? null
})

const materials = computed<MaterialItem[]>(() => {
    const data = sourceData.value
    if (!data) return []
    return data.materials || []
})

// 兼容：旧数据只有 embedded boolean，没有 status，按 embedded 推断
function inferStatus(m: MaterialItem): MaterialItem['status'] {
    if (m.status) return m.status
    return m.embedded ? 'ready' : 'pending'
}

const summary = computed(() => {
    const total = materials.value.length
    const ready = materials.value.filter(m => inferStatus(m) === 'ready').length
    return { total, ready }
})

function statusLabel(s: MaterialItem['status']) {
    switch (s) {
        case 'pending': return '待识别'
        case 'recognizing': return '识别中'
        case 'summarizing': return '生成简介中'
        case 'ready': return '已就绪'
        case 'failed': return '识别失败'
        default: return ''
    }
}
</script>

<template>
    <Tool>
        <ToolHeader
            title="材料处理"
            type="tool-process_materials"
            :state="state"
            :extra="materials.length > 0 ? `${summary.ready}/${summary.total} 已就绪` : undefined"
        />
        <ToolContent v-if="materials.length > 0">
            <div class="p-4">
                <ul class="space-y-2">
                    <li
                        v-for="m in materials"
                        :key="m.id"
                        class="flex items-center gap-2 text-sm"
                    >
                        <!-- 状态图标 -->
                        <CheckCircle2Icon
                            v-if="inferStatus(m) === 'ready'"
                            class="size-4 shrink-0 text-emerald-500"
                        />
                        <XCircleIcon
                            v-else-if="inferStatus(m) === 'failed'"
                            class="size-4 shrink-0 text-destructive"
                        />
                        <Loader2Icon
                            v-else-if="inferStatus(m) === 'recognizing' || inferStatus(m) === 'summarizing'"
                            class="size-4 shrink-0 text-blue-500 animate-spin"
                        />
                        <CircleIcon
                            v-else
                            class="size-4 shrink-0 text-muted-foreground/40"
                        />
                        <!-- 文件名 -->
                        <span class="text-foreground line-clamp-1 break-words flex-1">{{ m.name }}</span>
                        <!-- 状态文字 -->
                        <span
                            class="text-xs shrink-0"
                            :class="{
                                'text-muted-foreground': ['pending', 'ready'].includes(inferStatus(m) ?? ''),
                                'text-blue-500': ['recognizing', 'summarizing'].includes(inferStatus(m) ?? ''),
                                'text-destructive': inferStatus(m) === 'failed',
                            }"
                        >{{ statusLabel(inferStatus(m)) }}</span>
                    </li>
                </ul>
            </div>
        </ToolContent>
    </Tool>
</template>
```

如果 `ToolHeader` 不支持 `extra` prop，去掉该 prop，把汇总文字改在 ToolContent 顶部一行：

```vue
<div class="px-4 pt-3 text-xs text-muted-foreground">
    {{ summary.ready }}/{{ summary.total }} 已就绪
</div>
```

- [ ] **Step 2: 启动 dev 用 chrome-devtools 验证**

Run: `bun dev`（后台运行）
打开浏览器，进入一个有材料的案件，触发小索对话或案件初分。

人工验证清单：
- 材料处理卡片显示"X/Y 已就绪"汇总
- 处理中的材料显示蓝色 spinner + "识别中"/"生成简介中"
- 已就绪的材料显示绿色对号 + "已就绪"
- 失败的显示红叉

- [ ] **Step 3: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head -5`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add app/components/ai/tools/MaterialProcessTool.vue
git commit -m "feat(client): MaterialProcessTool.vue 渲染升级为五态状态指示

- 状态图标：CheckCircle2 / XCircle / Loader2(spin) / Circle 四套
- 卡片头部显示 'X/Y 已就绪' 汇总
- 数据来源双轨：output（工具调用）/ input（中间件合成）
- 兼容旧 embedded 字段：通过 inferStatus 推断"
```

---

### Task 15：全量回归

**Files:** 全部

- [ ] **Step 1: 跑全量测试**

Run: `VITEST_MAX_WORKERS=4 NODE_OPTIONS='--max-old-space-size=16384' bun run test 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 2: 类型最终校验**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: 无错误

- [ ] **Step 3: 跑 dev server 端到端验证**

Run: `bun dev`（后台），手动进行以下验证：

1. **主路径**：在案件详情页选 3 份文件（PDF/图片/音频），观察发送按钮：
   - 识别期间禁用
   - 识别完成 + 简介生成完成后启用
2. **保底路径**：进入有材料但 summary 缺失的案件（可手工 SQL 把识别记录的 summary 置为 null 模拟），开启分析：
   - 看到"材料处理 X/Y 已就绪"卡片
   - 卡片实时刷新，处理中的材料变绿，最终显示"完成"
3. **避免重复处理**：同一份文件先在案件 A 用，复制到案件 B，B 启动时简介应秒就绪（不再调 LLM）

验证完成后 `kill -9 <dev_pid>` 杀掉 dev server。

- [ ] **Step 4: 最终 commit + push**

```bash
git status
git log --oneline | head -20
git push origin dev
```

---

## Self-Review

完成上述所有任务后，根据 spec 重新走一遍核对：

| Spec 章节                         | 实现 Task                          |
| --------------------------------- | ---------------------------------- |
| §4.1 字段语义统一                 | Task 1                             |
| §4.2 generateOssFileSummaryService | Task 5                             |
| §4.3 触发时机                     | Task 7                             |
| §4.4 状态判定 / 前端等待          | Task 8                             |
| §4.5 中间件保底                   | Task 9 + 10                        |
| §4.6 防重 + 并行                  | Task 5（inflight）+ Task 9（轮询并行） |
| §4.7 UI 进度卡片                  | Task 2 + 13 + 14                   |
| §4.8 数据迁移                     | Task 1                             |
| §4.9 读取改造                     | Task 6 + 11                        |
| ASR summary 字段语义切换          | Task 3 + 4                         |
| process_materials 工具同步升级    | Task 12                            |

无遗漏。

---

## Execution Handoff

Plan 完成。两种执行方式选一：

1. **Subagent-Driven**（推荐）：每个 Task 派一个 subagent 实施 + 两段 review
2. **Inline**：本会话直接执行，加 checkpoint

请选择。
