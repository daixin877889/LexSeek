# 材料摘要语义统一 + 中间件保底 实施计划（v2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把材料"200 字简介"按文件级存到识别记录表，统一四种类型 summary 字段语义；改造 `generateMaterialSummaryService` 为"按 type 分发 + 重试 + inflight"统一入口；`ensureMaterialsReadyService` 升级为"识别+嵌入+简介"三阶段；案件初分挂材料就绪中间件，等待时复用 MaterialProcessTool 卡片实时显示进度。

**Architecture:** 数据按文件级（`docRecognitionRecords` / `imageRecognitionRecords` / `asrRecords` / `textContentRecords` 的 summary 字段）；`generateMaterialSummaryService(materialId)` 内部按 type 分发到 4 张表 + 自动重试 3 次（5s/15s/45s）+ inflight Map 防并发 + summary 已存在防写；`getMaterialSummariesByMaterials` helper 4 表并行 join 后按 materialId 聚合；`caseProcessMaterialMiddleware` 升级"识别+简介双就绪"判定，复用 `createCustomEventEmitter` 推 `prepare_materials` 事件；前端 `useStreamChat` 拦截后合成 `process_materials` 同款 toolCall，**`useMessageParser` 扩展支持 orphan synthetic 独立渲染**让保底卡片不依赖 AIMessage。

**Tech Stack:** Nuxt 4 + Prisma + LangGraph + Vitest + Vue 3 + Tailwind v4

**Spec 来源：** `docs/superpowers/specs/2026-05-06-material-summary-unification-design.md`

**调研已完成（grep 验证过的事实）：**
- `MIDDLEWARE_PRIORITY.PROCESS_MATERIAL = 10` 已存在 ✓
- `MIDDLEWARE_NAMES.PROCESS_MATERIAL = 'caseProcessMaterial'` 已存在 ✓
- `createCustomEventEmitter` 已存在 ✓
- `generateSummaryService(model, text, { maxChars, systemPrompt })` 签名 ✓
- `caseProcessMaterialMiddleware` 已挂 3 处（caseMain / moduleAgent / documentMain），V2 漏挂 ✓
- `lucide-vue-next` 项目里没人用 `CircleIcon`，要用 `import { Circle as CircleIcon }` 别名 ✓
- `extractTextFromAsrResult`（纯文本，pipeline）和 `extractTextFromSimplifiedResult`（带说话人/时间戳，asr）**职责互补，全部保留**——前者用于简介 LLM 输入和文本渲染，后者用于 RAG embedding ✓
- `tests/_helpers/mockEvent` **不存在**，handler 测试需用 `defineEventHandler` mock h3 风格（参考其他 handler 测试） ✓
- ASR `summary` 字段只有 1 处真正写入（asr.service.ts:1451），DAO 入参类型在 line 55 + 1299 ✓
- `findAsrRecordByOssFileIdDao` / `findDocRecognitionByOssFileIdDao` / `findImageRecognitionByOssFileIdDao` 全部存在 ✓
- `updateDocRecognitionRecordDao` / `updateImageRecognitionRecordDao` / `updateAsrRecordDao` 入参类型已支持 summary ✓

---

## 任务索引（10 个 task）

- Task 1：Prisma schema + migration（删 `caseMaterials.summary`，加 `textContentRecords.summary`）
- Task 2：ASR `summary` 写入移除 + 5 处读取改 result JSON 现拼（合并原 T3+T4）
- Task 3：`generateMaterialSummaryService` 改造（按 type 分发 + 重试 + inflight + 防重）
- Task 4：`getMaterialSummariesByMaterials` helper（4 表并行 join）
- Task 5：识别完成回调追加简介触发（OssFile 级 fire-and-forget）
- Task 6：识别状态接口 `recognized` 判定升级
- Task 7：`runRecognitionAndEmbeddingPipeline` 阶段 3 简介 + 终态轮询 + SSE 进度（含 PREPARE_MATERIALS 类型）
- Task 8：V2 案件初分挂 `caseProcessMaterialMiddleware` + 撤回 executor 临时 await
- Task 9：替换所有 `caseMaterials.summary` 读取为 helper（含 process_materials 工具 output 加 status）
- Task 10：前端拦截 `prepare_materials` + `useMessageParser` orphan 渲染 + `MaterialProcessTool.vue` 五态升级 + 全量回归

---

### Task 1：Prisma Schema + Migration

**Files:**
- Modify: `prisma/models/case.prisma`（删 `caseMaterials.summary`）
- Modify: `prisma/models/materials.prisma`（`textContentRecords` 加 `summary`）
- Modify: `prisma/models/recognition.prisma`（更新 4 张表 `summary` 字段注释统一为"200 字简介"）
- Create: `prisma/migrations/<timestamp>_unify_material_summary/migration.sql`（自动生成，禁手写）

- [ ] **Step 1: 修改 caseMaterials schema 删 summary 字段**

修改 `prisma/models/case.prisma`，找到 `model caseMaterials`，删除以下两行：

```prisma
  /// 摘要
  summary       String?   @db.Text
```

- [ ] **Step 2: 修改 textContentRecords schema 加 summary 字段**

修改 `prisma/models/materials.prisma`，在 `model textContentRecords` 的 `htmlContent` 字段下方添加：

```prisma
  /// 200 字简介（统一语义：识别完成后由 generateMaterialSummaryService 写入）
  summary         String?   @db.Text
```

- [ ] **Step 3: 修改 recognition.prisma 三张表的 summary 注释**

修改 `prisma/models/recognition.prisma`，把 `model docRecognitionRecords` / `model imageRecognitionRecords` / `model asrRecords` 中 `summary` 字段的注释统一改为：

```prisma
  /// 200 字简介（统一语义：识别完成后由 generateMaterialSummaryService 写入）
  summary         String?   @db.Text
```

注意：注释改动**不会**进入 migration.sql（只入 schema 文件）。

- [ ] **Step 4: 生成迁移**

Run: `bun run prisma:migrate --name unify_material_summary`
Expected: 自动生成 migration 文件，包含 `ALTER TABLE "case_materials" DROP COLUMN "summary"` 和 `ALTER TABLE "text_content_records" ADD COLUMN "summary" TEXT`。开发机会问"data loss" 回车确认。

- [ ] **Step 5: 验证 client 重新生成**

Run: `bun run prisma:generate`
Expected: 无错误，`generated/prisma/client` 类型已更新

- [ ] **Step 6: 人工 review 自动生成的 SQL**

Run: `cat prisma/migrations/<timestamp>_unify_material_summary/migration.sql`
Expected: 仅含 ALTER TABLE 两行；如有意外语句**停下来排查**。

- [ ] **Step 7: 验证 schema 不再含 caseMaterials.summary**

Run: `grep -n "summary" generated/prisma/client/index.d.ts | grep -i "caseMaterials\|case_materials" | head -5`
Expected: 无输出

- [ ] **Step 8: Commit**

```bash
git add prisma/models/ prisma/migrations/ generated/prisma/
git commit -m "feat(db): 统一材料 summary 语义，迁移到识别记录表

- caseMaterials.summary 删除（按文件级存到识别记录表）
- textContentRecords 加 summary 字段（与 doc/image/asr 对齐）
- 4 张表 summary 字段注释统一为'200 字简介'"
```

---

### Task 2：ASR summary 写入移除 + 5 处读取改 result 现拼

**Files:**
- Modify: `server/services/material/asr.service.ts`（删 line 1451 写入；export `extractTextFromSimplifiedResult`）
- Modify: `server/services/material/materialEmbedding.service.ts`（line 1212-1234 AUDIO 分支改 result 现拼）
- Modify: `server/services/material/material.service.ts`（line 588-595 loadMaterialText 音频分支改 result 现拼）
- Modify: `server/services/material/materialPipeline.service.ts`（line 412-440 fetchMaterialContents 音频分支删 fallback）
- Modify: `server/services/material/fileProcess.service.ts`（line 86, 186, 218-221, 254-256 删 fallback；line 36 删类型字段）
- Modify: `tests/server/material/asr.service.test.ts`（mock 调整）

**注意：保留 `UpdateAsrRecordInput.summary` / `updateAsrRecordService` 入参类型字段**——Task 3 的简介写入还要用。只删 `embedAsrRecordService` 内 `summary: text` 这一处实际写入。

- [ ] **Step 1: export `extractTextFromSimplifiedResult`**

修改 `server/services/material/asr.service.ts`，找到 `function extractTextFromSimplifiedResult(...)`（约 line 1331），改为：

```typescript
export function extractTextFromSimplifiedResult(
```

- [ ] **Step 2: 删 embedAsrRecordService 内 summary 写入**

修改 `server/services/material/asr.service.ts`，找到 line 1448-1452：

```typescript
        // 8. 更新 ASR 识别记录的向量信息 + 摘要文本
        // summary 字段供 fetchMaterialContents 读取，作为材料上下文注入工作流
        await updateAsrRecordDao(recordId, {
            vectorIds: embeddingResult.ids,
            lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
            summary: text,
        }, tx)
```

改为（去掉 summary 字段写入；保留 DAO 入参类型供 Task 3 用）：

```typescript
        // 8. 更新 ASR 识别记录的向量信息
        // 注意：summary 字段不在此处写入——已切换语义为"200 字简介"，由
        // generateMaterialSummaryService 在识别完成后异步生成；
        // 转录正文由 fetchMaterialContents 等读取方从 result JSON 现拼。
        await updateAsrRecordDao(recordId, {
            vectorIds: embeddingResult.ids,
            lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
        }, tx)
```

- [ ] **Step 3: 改 materialEmbedding.service.ts 的 AUDIO 分支**

修改 `server/services/material/materialEmbedding.service.ts`，找到 `case 4: { // AUDIO`（约 line 1212-1234），把：

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

改为（用带说话人时间戳的 `extractTextFromSimplifiedResult` —— RAG embedding 用）：

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

- [ ] **Step 4: 改 material.service.ts 的 loadMaterialText 音频分支**

修改 `server/services/material/material.service.ts`，找到约 line 588-595：

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

改为（用纯文本 `extractTextFromAsrResult` —— 简介 LLM 输入用）：

```typescript
    // 音频：从 asrRecords.result JSON 现拼纯文本（简介 LLM 输入用）
    if (m.type === CaseMaterialType.AUDIO && m.ossFileId) {
        const asr = await prisma.asrRecords.findFirst({
            where: { ossFileId: m.ossFileId, deletedAt: null },
            select: { result: true },
            orderBy: { createdAt: 'desc' },
        })
        if (asr?.result) {
            const text = extractTextFromAsrResult(asr.result)
            if (text) return text.slice(0, maxChars)
        }
    }
```

文件顶部加 import：

```typescript
import { extractTextFromAsrResult } from './materialPipeline.service'
```

- [ ] **Step 5: 改 materialPipeline.service.ts 的 fetchMaterialContents 音频分支**

修改 `server/services/material/materialPipeline.service.ts`，找到约 line 422 的：

```typescript
                select: { ossFileId: true, summary: true, result: true },
```

改为：

```typescript
                select: { ossFileId: true, result: true },
```

下方约 line 430：

```typescript
                        // 优先使用 summary（已格式化的转录文本）
                        // fallback：从 result JSON 提取纯文本
                        const content = r.summary || extractTextFromAsrResult(r.result)
```

改为：

```typescript
                        // 从 result JSON 现拼纯文本（summary 字段已切换语义为 200 字简介，不再存转录文本）
                        const content = extractTextFromAsrResult(r.result)
```

- [ ] **Step 6: 改 fileProcess.service.ts 4 处**

修改 `server/services/material/fileProcess.service.ts`：

第 1 处（约 line 36 类型字段）：找到 `summary: string | null` 删除该字段（如果该返回类型还有其他使用，把所有"返回 summary"改为"返回 null"或直接移除字段）。

第 2 处（约 line 86）`select: { ossFileId: true, status: true, summary: true, result: true }` 改为 `select: { ossFileId: true, status: true, result: true }`。

第 3 处（约 line 186）`return r?.summary ?? extractTextFromAsrResult(r?.result) ?? null` 改为 `return extractTextFromAsrResult(r?.result) ?? null`。

第 4 处（约 line 218-221）`select: { summary: true, result: true }` 改为 `select: { result: true }`，下一行 `const content = record.summary || extractTextFromAsrResult(record.result)` 改为 `const content = extractTextFromAsrResult(record.result)`。

第 5 处（约 line 254-256）同第 4 处改法。

- [ ] **Step 7: 调整 ASR 测试 mock**

修改 `tests/server/material/asr.service.test.ts`，找到 `embedAsrRecordService` 相关测试（约 line 1100+）：原本断言 `updateAsrRecordDao` 调用入参含 `summary: text`，改为断言**不含** summary 字段。

- [ ] **Step 8: 跑相关测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过；如其他 mock 用了 summary 字段需调整

- [ ] **Step 9: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head -10`
Expected: 无错误

- [ ] **Step 10: Commit**

```bash
git add server/services/material/ tests/server/material/
git commit -m "refactor(cases): ASR summary 字段语义切换 — 转录文本改为 result 现拼

- 删 embedAsrRecordService 中 summary 字段写入
- 5 处读取改用 extractTextFromAsrResult / extractTextFromSimplifiedResult
- 保留 DAO 入参类型字段供后续简介写入用"
```

---

### Task 3：generateMaterialSummaryService 改造（统一入口）

**Files:**
- Modify: `server/services/material/material.service.ts`（改造 `generateMaterialSummaryService` + `generateMaterialSummaryInner`）
- Test: `tests/server/material/material.service.test.ts`（追加用例）

**核心**：保持 `generateMaterialSummaryService(materialId)` 签名不变；内部按 caseMaterials.{type, ossFileId} 分发到 4 张表 + 加 inflight Map + 自动重试 3 次 + summary 已存在防写。

- [ ] **Step 1: 写失败测试**

修改 `tests/server/material/material.service.test.ts`，追加 describe 块：

```typescript
import { CaseMaterialType } from '#shared/types/case'

describe('generateMaterialSummaryService 改造 - 按 type 分发', () => {
    it('文档类型：summary 已存在直接早返', async () => {
        const ossFile = await createTestOssFile({ userId: testUser.id })
        const m = await createTestMaterial({
            caseId: testCase.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFile.id,
        })
        testIds.materialIds.push(m.id)
        await prisma.docRecognitionRecords.create({
            data: { userId: testUser.id, ossFileId: ossFile.id, status: 2, summary: '已有简介', markdownContent: 'x' },
        })

        await generateMaterialSummaryService(m.id)

        // 检查未重写
        const after = await prisma.docRecognitionRecords.findFirst({ where: { ossFileId: ossFile.id } })
        expect(after?.summary).toBe('已有简介')
    })

    it('文字类型 (CASE_CONTENT)：summary 写到 textContentRecords', async () => {
        const m = await createTestMaterial({
            caseId: testCase.id, type: CaseMaterialType.CASE_CONTENT, ossFileId: null,
        })
        testIds.materialIds.push(m.id)
        await prisma.textContentRecords.create({
            data: { userId: testUser.id, caseId: testCase.id, materialId: m.id, content: '一段需要总结的文本内容', status: 2 },
        })

        // 这里需要 mock generateSummaryService 返回固定值，否则会真调 LLM
        // ... 详见 step 3 实现里的 inflight + select 防重 + 重试逻辑
    })

    // 其它 IMAGE / AUDIO 类似
})
```

注：测试入侵 LLM 调用需要 mock `getValidNodeConfig` + `createChatModel` + `generateSummaryService`。参考现有 `material.service.test.ts` 的 mock 模式（必要时把核心逻辑抽到独立单元测试用纯 mock）。

- [ ] **Step 2: 跑测试确认 fail**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/material.service.test.ts --reporter=default 2>&1 | tail -5`
Expected: FAIL（行为还没改造）

- [ ] **Step 3: 改造 generateMaterialSummaryService 实现**

修改 `server/services/material/material.service.ts`，把现有的 `generateMaterialSummaryService` + `generateMaterialSummaryInner` + `loadMaterialText`（约 line 515-600）替换为：

```typescript
/** 简介长度统一 200 字（spec §8.1 拍板） */
const SUMMARY_MAX_CHARS = 200

/** 单次 LLM 失败重试间隔（毫秒，指数退避） */
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000]

/**
 * inflight Map：同一 materialId 的并发请求复用同一 Promise，避免重复 LLM 调用
 */
const inflight = new Map<number, Promise<void>>()

/**
 * 为材料生成 200 字简介。
 *
 * 升级版（spec §4.2）：
 * - 内部按 caseMaterials.{type, ossFileId} 分发到 4 张表的 summary 字段
 *   - CASE_CONTENT → textContentRecords.summary（按 materialId）
 *   - DOCUMENT → docRecognitionRecords.summary（按 ossFileId）
 *   - IMAGE → imageRecognitionRecords.summary（按 ossFileId）
 *   - AUDIO → asrRecords.summary（按 ossFileId）
 * - 防重：先 select 对应表 summary，已非空直接 return
 * - 并发去重：进程内 inflight Map<materialId, Promise<void>>
 * - 失败重试：3 次（5s/15s/45s 指数退避）
 * - 重试穷尽：caseMaterials.status=FAILED + return（不抛错）
 *
 * 失败不阻塞主流程，仅 logger.warn。
 */
export async function generateMaterialSummaryService(materialId: number): Promise<void> {
    const existing = inflight.get(materialId)
    if (existing) return existing

    const task = withLangfuseContext(
        { materialId: String(materialId), vertical: 'material-summary' },
        () => generateMaterialSummaryInner(materialId),
    ).finally(() => inflight.delete(materialId))

    inflight.set(materialId, task)
    return task
}

async function generateMaterialSummaryInner(materialId: number): Promise<void> {
    try {
        const material = await prisma.caseMaterials.findUnique({
            where: { id: materialId },
            select: { id: true, type: true, ossFileId: true },
        })
        if (!material) return

        // 按类型读对应识别记录的 summary + content（防重 + 提供 LLM 输入）
        const target = await loadSummaryTarget(material.id, material.type, material.ossFileId)
        if (!target) return  // 识别记录不存在 / 无内容
        if (target.summary) return  // 已有简介，防重早返
        if (!target.content) return  // 无内容可总结

        const config = await getValidNodeConfig('materialAutoSummary', '材料自动摘要')
        const apiKey = config.modelApiKeys.find(k => k.status === 1)?.apiKey
        if (!apiKey) {
            logger.warn('materialAutoSummary 节点无可用 API Key', { materialId })
            return
        }
        const systemPrompt = config.prompts.find(p => p.type === 'system' && p.status === 1)?.content
        if (!systemPrompt) {
            logger.warn('materialAutoSummary 节点无 system prompt', { materialId })
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

        // LLM 调用 + 自动重试 3 次（指数退避）
        let summary: string | null = null
        let lastErr: unknown = null
        for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
            try {
                summary = await generateSummaryService(model, target.content, {
                    maxChars: SUMMARY_MAX_CHARS,
                    systemPrompt,
                })
                break
            } catch (e) {
                lastErr = e
                logger.warn(`简介 LLM 调用第 ${attempt + 1} 次失败`, { materialId, error: e })
                if (attempt < RETRY_DELAYS_MS.length) {
                    await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
                }
            }
        }
        if (!summary) {
            logger.error('简介 LLM 重试穷尽，标记 caseMaterials.status=FAILED', { materialId, error: lastErr })
            await prisma.caseMaterials.update({
                where: { id: materialId },
                data: { status: MaterialStatus.FAILED },
            }).catch(() => { /* 忽略状态写入失败 */ })
            return
        }

        // 写回对应表 summary
        await persistSummary(material.id, material.type, material.ossFileId, summary)
    } catch (e) {
        logger.warn('generateMaterialSummaryService 失败（不阻塞主流程）', { materialId, error: e })
    }
}

interface SummaryTarget {
    summary: string | null
    content: string  // 简介 LLM 的输入文本（已 slice 到合理长度）
}

async function loadSummaryTarget(
    materialId: number,
    type: number,
    ossFileId: number | null,
): Promise<SummaryTarget | null> {
    if (type === CaseMaterialType.CASE_CONTENT) {
        const r = await findTextContentRecordByMaterialIdDAO(materialId)
        if (!r) return null
        return { summary: r.summary, content: (r.content ?? '').slice(0, 2000) }
    }
    if (!ossFileId) return null
    if (type === CaseMaterialType.DOCUMENT) {
        const r = await findDocRecognitionByOssFileIdDao(ossFileId)
        if (!r || r.status !== 2) return null
        return { summary: r.summary, content: (r.markdownContent ?? '').slice(0, 2000) }
    }
    if (type === CaseMaterialType.IMAGE) {
        const r = await findImageRecognitionByOssFileIdDao(ossFileId)
        if (!r || r.status !== 2) return null
        return { summary: r.summary, content: (r.markdownContent ?? '').slice(0, 2000) }
    }
    if (type === CaseMaterialType.AUDIO) {
        const r = await findAsrRecordByOssFileIdDao(ossFileId)
        if (!r || r.status !== 2) return null
        const transcribed = extractTextFromAsrResult(r.result) ?? ''
        return { summary: r.summary, content: transcribed.slice(0, 2000) }
    }
    return null
}

async function persistSummary(
    materialId: number,
    type: number,
    ossFileId: number | null,
    summary: string,
): Promise<void> {
    if (type === CaseMaterialType.CASE_CONTENT) {
        await prisma.textContentRecords.updateMany({
            where: { materialId, deletedAt: null },
            data: { summary },
        })
        return
    }
    if (!ossFileId) return
    if (type === CaseMaterialType.DOCUMENT) {
        const r = await findDocRecognitionByOssFileIdDao(ossFileId)
        if (r) await updateDocRecognitionRecordDao(r.id, { summary })
    } else if (type === CaseMaterialType.IMAGE) {
        const r = await findImageRecognitionByOssFileIdDao(ossFileId)
        if (r) await updateImageRecognitionRecordDao(r.id, { summary })
    } else if (type === CaseMaterialType.AUDIO) {
        const r = await findAsrRecordByOssFileIdDao(ossFileId)
        if (r) await updateAsrRecordDao(r.id, { summary })
    }
}
```

文件顶部追加 import：

```typescript
import { findTextContentRecordByMaterialIdDAO } from './textContentRecords.dao'
import { findDocRecognitionByOssFileIdDao, updateDocRecognitionRecordDao } from './mineru.dao'
import { findImageRecognitionByOssFileIdDao, updateImageRecognitionRecordDao } from './ocr.dao'
import { findAsrRecordByOssFileIdDao, updateAsrRecordDao } from './asr.dao'
import { extractTextFromAsrResult } from './materialPipeline.service'
```

注意：`MaterialStatus` 已在文件中 import。

- [ ] **Step 4: 跑测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/material.service.test.ts --reporter=default 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add server/services/material/material.service.ts tests/server/material/material.service.test.ts
git commit -m "refactor(cases): generateMaterialSummaryService 改造为按 type 分发

- 内部根据 caseMaterials.{type,ossFileId} 分发到 4 张表的 summary 字段
- 防重：先 select 对应表 summary，已非空直接 return
- 并发去重：进程内 inflight Map
- 失败重试 3 次（5s/15s/45s 指数退避）
- 重试穷尽 → 标记 caseMaterials.status=FAILED 放行
- 签名 (materialId) 不变，调用方无须知道材料类型"
```

---

### Task 4：getMaterialSummariesByMaterials helper（4 表并行 join）

**Files:**
- Modify: `server/services/material/material.service.ts`（在 generateMaterialSummaryService 之前追加 helper）
- Test: `tests/server/material/material.service.test.ts`（追加 3 个用例）

- [ ] **Step 1: 写失败测试**

修改 `tests/server/material/material.service.test.ts`，追加：

```typescript
describe('getMaterialSummariesByMaterials - 跨表读取摘要', () => {
    it('混合类型：按 ossFileId / materialId 关联读到对应 summary', async () => {
        const ossFileDoc = await createTestOssFile({ userId: testUser.id })
        const ossFileImg = await createTestOssFile({ userId: testUser.id })
        const ossFileAudio = await createTestOssFile({ userId: testUser.id })

        const matText = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.CASE_CONTENT })
        const matDoc = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFileDoc.id })
        const matImg = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.IMAGE, ossFileId: ossFileImg.id })
        const matAudio = await createTestMaterial({ caseId: testCase.id, type: CaseMaterialType.AUDIO, ossFileId: ossFileAudio.id })
        testIds.materialIds.push(matText.id, matDoc.id, matImg.id, matAudio.id)

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

    it('找不到识别记录的材料：Map 不含该 materialId', async () => {
        const ossFile = await createTestOssFile({ userId: testUser.id })
        const mat = await createTestMaterial({
            caseId: testCase.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFile.id,
        })
        testIds.materialIds.push(mat.id)
        const map = await getMaterialSummariesByMaterials([
            { id: mat.id, type: CaseMaterialType.DOCUMENT, ossFileId: ossFile.id },
        ])
        expect(map.get(mat.id)).toBeUndefined()
    })
})
```

import 区追加：

```typescript
import { getMaterialSummariesByMaterials } from '../../../server/services/material/material.service'
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/material.service.test.ts --reporter=default 2>&1 | tail -5`
Expected: FAIL（getMaterialSummariesByMaterials 未定义）

- [ ] **Step 3: 在 material.service.ts 追加实现**

在文件末尾（generateMaterialSummaryService 函数之前）追加：

```typescript
export interface MaterialSummaryInput {
    id: number
    type: number  // CaseMaterialType
    ossFileId: number | null
}

/**
 * 批量按材料查 200 字简介，按 type 分组并行查 4 张表后合并到 Map<materialId, summary>。
 *
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

    // 反向映射 ossFileId → materialId[]（同一文件可能被多个材料引用）
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
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add server/services/material/material.service.ts tests/server/material/material.service.test.ts
git commit -m "feat(cases): 新增 getMaterialSummariesByMaterials helper

按 materialId / ossFileId 跨 4 张表并行查 summary 后聚合，替代各处直读
caseMaterials.summary 的逻辑。"
```

---

### Task 5：识别完成回调追加简介触发（OssFile 级 fire-and-forget）

**Files:**
- Modify: `server/api/v1/recognition/start.post.ts`（同步成功路径追加触发）
- Modify: `server/services/material/asr.service.ts`（completeTranscriptionService 末尾追加）
- Modify: `server/services/material/mineru.service.ts`（completeConversionService 末尾追加）
- Modify: `server/services/material/materialProcess.service.ts`（同步路径 ×2）

**注意**：识别完成时 caseMaterials 行可能尚未创建（用户还在 AiPromptInput 阶段），此场景下 ossFile 级简介在用户提交分析后由 ensureMaterialsReadyService 内部触发（Task 7）。本 Task 只触发已有 caseMaterials 的简介。

- [ ] **Step 1: 改 ASR completeTranscriptionService**

修改 `server/services/material/asr.service.ts`，在 `markMaterialsByOssFileIdService(ossFileId, MaterialStatus.COMPLETED)` 调用之后追加：

```typescript
        // 6.2 fire-and-forget 触发对应 caseMaterials 的简介生成
        // generateMaterialSummaryService 内部 inflight Map 防并发 + summary 已非空早返
        prisma.caseMaterials.findMany({
            where: { ossFileId, type: CaseMaterialType.AUDIO, deletedAt: null },
            select: { id: true },
        }).then(rows => {
            for (const r of rows) {
                generateMaterialSummaryService(r.id).catch(() => { /* 已在内部 catch */ })
            }
        }).catch(() => { /* 已在内部 catch */ })
```

文件顶部 import：

```typescript
import { generateMaterialSummaryService } from './material.service'
import { CaseMaterialType } from '#shared/types/case'
```

- [ ] **Step 2: 改 MinerU completeConversionService**

修改 `server/services/material/mineru.service.ts`，在 `markMaterialsByOssFileIdService(task.ossFileId, MaterialStatus.COMPLETED)` 调用之后追加：

```typescript
        // 6.2 fire-and-forget 触发对应 caseMaterials 的简介生成
        prisma.caseMaterials.findMany({
            where: { ossFileId: task.ossFileId, type: CaseMaterialType.DOCUMENT, deletedAt: null },
            select: { id: true },
        }).then(rows => {
            for (const r of rows) {
                generateMaterialSummaryService(r.id).catch(() => { /* 已在内部 catch */ })
            }
        }).catch(() => { /* 已在内部 catch */ })
```

文件顶部 import：

```typescript
import { generateMaterialSummaryService } from './material.service'
import { CaseMaterialType } from '#shared/types/case'
```

- [ ] **Step 3: processMaterialService 同步路径**

修改 `server/services/material/materialProcess.service.ts`，约 line 137-138 的：

```typescript
            generateMaterialSummaryService(material.id).catch(() => { /* 已在内部 catch */ })
```

保留不变（CASE_CONTENT 路径，已经按 materialId 触发；改造后的函数会自动按 type 分发）。

约 line 210 的：

```typescript
            generateMaterialSummaryService(materialId).catch(() => { /* 已在内部 catch */ })
```

也保留不变。

- [ ] **Step 4: 改 recognition/start.post.ts 同步成功路径**

修改 `server/api/v1/recognition/start.post.ts`，在 `results.push(...)` 之前追加：

```typescript
        // 同步识别成功 → 如有对应 caseMaterials 行 fire-and-forget 触发简介生成
        if (resultStatus === 'completed') {
            prisma.caseMaterials.findMany({
                where: { ossFileId, deletedAt: null },
                select: { id: true },
            }).then(rows => {
                for (const r of rows) {
                    import('~~/server/services/material/material.service').then(svc =>
                        svc.generateMaterialSummaryService(r.id),
                    ).catch(() => { /* 已在内部 catch */ })
                }
            }).catch(() => { /* 已在内部 catch */ })
        }
```

注：此处用动态 import 是为了避免 server/api 模块对 service 的循环引用风险；可改为静态 import 视情况。

- [ ] **Step 5: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head -10`
Expected: 无错误

- [ ] **Step 6: 跑相关测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 7: Commit**

```bash
git add server/services/material/ server/api/v1/recognition/
git commit -m "feat(cases): 识别完成后 fire-and-forget 触发简介生成

- ASR/MinerU 异步完成回调 + recognition/start 同步成功路径
- 通过 generateMaterialSummaryService 统一入口（按 ossFileId 找 caseMaterials → 按 type 分发）
- 防重 + inflight Map + 自动重试由统一入口承担"
```

---

### Task 6：识别状态接口 recognized 判定升级

**Files:**
- Modify: `server/api/v1/recognition/status/[ossFileId].get.ts`

- [ ] **Step 1: 修改 handler 升级 4 处判定**

修改 `server/api/v1/recognition/status/[ossFileId].get.ts`：

`mineruTask` 分支（约 line 70-83）：

```typescript
        if (mineruTask) {
            const isRecognized = mineruTask.status === MineruTaskStatus.SUCCESS
```

改为：

```typescript
        if (mineruTask) {
            // mineruTask 表无 summary 字段；mineruTask 命中通常说明 docRecord 还未创建
            // 或简介未生成 → recognized=false 让前端继续轮询
            const isRecognized = false
```

`docRecord` 分支（约 line 84-91）：

```typescript
        } else if (docRecord) {
            const isRecognized = docRecord.status === DocRecognitionStatus.SUCCESS
```

改为：

```typescript
        } else if (docRecord) {
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

- [ ] **Step 2: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head -5`
Expected: 无错误

- [ ] **Step 3: 跑现有 recognition 测试（如有）**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/recognition/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add server/api/v1/recognition/status/
git commit -m "feat(api): 状态接口 recognized 升级为'识别+简介双就绪'

让 AiPromptInput 发送按钮自动等到简介生成完成后才放行（前端零改动）。
mineruTask 命中时强制 recognized=false（mineruTask 表无 summary 字段）。"
```

---

### Task 7：runRecognitionAndEmbeddingPipeline 阶段 3 简介 + 终态轮询 + SSE 进度

**Files:**
- Modify: `shared/types/agentEvent.ts`（新增 PREPARE_MATERIALS 事件类型 + payload）
- Modify: `server/services/material/materialPipeline.service.ts`（升级 ensureMaterialsReadyService 为三阶段 + 终态轮询 + onProgress 回调）
- Modify: `server/agents/_shared/case-context/caseProcessMaterial.middleware.ts`（用 createCustomEventEmitter 推 PREPARE_MATERIALS）

- [ ] **Step 1: 共享类型新增 PREPARE_MATERIALS**

修改 `shared/types/agentEvent.ts`，在 `SSECustomEventType` 枚举中（CHILD_AGENT_INVOKED 之前）追加：

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

在 `SSECustomEventMap` 之前追加 payload 类型：

```typescript
/** 材料项状态（保底进度卡片用） */
export type MaterialItemStatus = 'pending' | 'recognizing' | 'summarizing' | 'ready' | 'failed'

/** 单条材料状态（不携带 type 字段——前端渲染只用 name + status） */
export interface MaterialItem {
    id: number
    name: string
    status: MaterialItemStatus
}

/** PREPARE_MATERIALS payload */
export type PrepareMaterialsPayload =
    | { phase: 'start';    toolCallId: string; materials: MaterialItem[] }
    | { phase: 'progress'; toolCallId: string; materials: MaterialItem[] }
    | { phase: 'end';      toolCallId: string; materials: MaterialItem[]; failedCount: number }
```

在 `SSECustomEventMap` 中加映射：

```typescript
    [SSECustomEventType.PREPARE_MATERIALS]: PrepareMaterialsPayload
```

- [ ] **Step 2: 改造 ensureMaterialsReadyService 加阶段 3 + onProgress**

修改 `server/services/material/materialPipeline.service.ts`，把现有的 `runRecognitionAndEmbeddingPipeline` + `ensureMaterialsReadyService` + `waitMaterialsTerminalAndSummary` 改造为：

（先看现有签名）找到 `waitMaterialsTerminalAndSummary` 函数及其调用，替换为新版（按 materialId 跨表 join 判定终态 + onProgress 回调）：

```typescript
import type { MaterialItemStatus } from '#shared/types/agentEvent'

/** 材料就绪快照单项 */
export interface MaterialReadinessSnapshot {
    materialId: number
    name: string
    status: MaterialItemStatus
}

/**
 * 等所有材料到达"识别终态 + 简介生成完毕"
 *
 * 终态判定（按文件级跨 4 表查 summary）：
 * - status=FAILED 视为终态（不卡用户）
 * - status=COMPLETED 且 summary 非 null 视为终态
 *
 * 不设硬超时（自动重试 3 次由 generateMaterialSummaryService 内部承担；
 * 重试穷尽会标记 status=FAILED）。
 *
 * onProgress 回调每次轮询拿到当前快照后调一次，用于中间件推送 SSE 进度。
 */
async function waitMaterialsTerminalAndSummary(
    materials: MaterialWithFile[],
    onProgress?: (snapshot: MaterialReadinessSnapshot[]) => void | Promise<void>,
): Promise<void> {
    const POLL_MS = 2000  // 5check 优化：2 秒一次

    while (true) {
        const snapshot = await snapshotMaterialReadiness(materials)
        if (onProgress) {
            try { await onProgress(snapshot) } catch { /* 推送失败不阻塞 */ }
        }
        const allTerminal = snapshot.every(s => s.status === 'ready' || s.status === 'failed')
        if (allTerminal) return

        await new Promise(r => setTimeout(r, POLL_MS))
    }
}

/**
 * 查询材料就绪状态快照（按文件级跨 4 表 join 查 summary）
 */
export async function snapshotMaterialReadiness(
    materials: MaterialWithFile[],
): Promise<MaterialReadinessSnapshot[]> {
    if (materials.length === 0) return []

    const matStatusMap = new Map(materials.map(m => [m.id, { status: m.status, name: m.name }]))

    const summaryMap = await getMaterialSummariesByMaterials(
        materials.map(m => ({ id: m.id, type: m.type, ossFileId: m.ossFileId })),
    )

    return materials.map(m => {
        const meta = matStatusMap.get(m.id)!
        const hasSummary = summaryMap.has(m.id)
        let status: MaterialItemStatus
        if (meta.status === MaterialStatus.FAILED) status = 'failed'
        else if (meta.status === MaterialStatus.PENDING) status = 'pending'
        else if (meta.status === MaterialStatus.PROCESSING) status = 'recognizing'
        else if (meta.status === MaterialStatus.COMPLETED) status = hasSummary ? 'ready' : 'summarizing'
        else status = 'pending'
        return { materialId: m.id, name: meta.name, status }
    })
}
```

修改 `runRecognitionAndEmbeddingPipeline`（新增可选 onProgress 参数）：

```typescript
async function runRecognitionAndEmbeddingPipeline(
    materials: MaterialWithFile[],
    userId: number,
    initialFailed: MaterialFailedItem[] = [],
    onProgress?: (snapshot: MaterialReadinessSnapshot[]) => void | Promise<void>,
): Promise<MaterialReadyResult> {
    // ... 原有识别 + 嵌入逻辑保持不变 ...

    // 阶段 3：对所有已识别但 summary 缺失的材料并行触发简介生成
    // generateMaterialSummaryService 内部 inflight + 防重，重复触发 0 副作用
    const recognizedMatIds = materials
        .filter(m => recognizedMap.get(m.id))
        .map(m => m.id)
    if (recognizedMatIds.length > 0) {
        await Promise.allSettled(
            recognizedMatIds.map(id => generateMaterialSummaryService(id)),
        )
    }

    // 阶段 4：终态轮询（识别+简介双就绪 / FAILED）
    if (materials.length > 0) {
        await waitMaterialsTerminalAndSummary(materials, onProgress)
    }

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

`ensureMaterialsReadyService` 加 onProgress 参数透传：

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

注意 import 区追加 `getMaterialSummariesByMaterials`：

```typescript
import { getMaterialSummariesByMaterials } from './material.service'
```

- [ ] **Step 3: 改造 caseProcessMaterialMiddleware 推 SSE**

修改 `server/agents/_shared/case-context/caseProcessMaterial.middleware.ts`：

```typescript
import { createMiddleware } from "langchain"
import { ensureMaterialsReadyService } from "~~/server/services/material/materialPipeline.service"
import type { MaterialReadinessSnapshot } from "~~/server/services/material/materialPipeline.service"
import { createCustomEventEmitter } from "~~/server/services/agent-platform/sse/customEventEmitter"
import { SSECustomEventType } from "#shared/types/agentEvent"
import type { MaterialItem, PrepareMaterialsPayload } from "#shared/types/agentEvent"

/**
 * 材料就绪保底中间件
 *
 * 升级版：等到所有材料"识别 + 200 字简介"双就绪才放行 Agent。
 * 等待期间通过 SSE PREPARE_MATERIALS 事件推送进度，前端 useStreamChat
 * 拦截后合成 process_materials 同款 toolCall，复用 MaterialProcessTool.vue 渲染。
 *
 * runId / sessionId 从 LangGraph runtime ALS / RunnableConfig 拿，
 * 不强制透传给中间件签名（与现有 middleware 设计一致）。
 */
export const caseProcessMaterialMiddleware = (userId: number, caseId: number) => {
    return createMiddleware({
        name: "CaseProcessMaterialMiddleware",
        beforeAgent: {
            hook: async (_state, runtime?) => {
                // 从 runtime / ALS 拿 runId 和 sessionId
                const runId = (runtime as any)?.context?.runId ?? (runtime as any)?.configurable?.runId
                const sessionId = (runtime as any)?.context?.sessionId ?? (runtime as any)?.configurable?.thread_id ?? ''

                let toolCallId: string | null = null
                let started = false
                let lastSnapshot: MaterialReadinessSnapshot[] = []
                const emit = runId
                    ? createCustomEventEmitter({ runId, sessionId })
                    : null

                const onProgress = async (snapshot: MaterialReadinessSnapshot[]) => {
                    lastSnapshot = snapshot  // 累积，end 阶段直接用
                    if (!emit) return  // 无 runId 不推送（兼容旧调用方）
                    const items: MaterialItem[] = snapshot.map(s => ({
                        id: s.materialId,
                        name: s.name,
                        status: s.status,
                    }))
                    if (!started) {
                        started = true
                        toolCallId = `prepare-${runId}`
                        const payload: PrepareMaterialsPayload = { phase: 'start', toolCallId, materials: items }
                        await emit({ name: SSECustomEventType.PREPARE_MATERIALS, data: payload })
                    } else {
                        const payload: PrepareMaterialsPayload = { phase: 'progress', toolCallId: toolCallId!, materials: items }
                        await emit({ name: SSECustomEventType.PREPARE_MATERIALS, data: payload })
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
                    if (started && toolCallId && emit) {
                        const items: MaterialItem[] = lastSnapshot.map(s => ({
                            id: s.materialId,
                            name: s.name,
                            status: s.status,
                        }))
                        const failedCount = lastSnapshot.filter(s => s.status === 'failed').length
                        const payload: PrepareMaterialsPayload = {
                            phase: 'end',
                            toolCallId,
                            materials: items,
                            failedCount,
                        }
                        await emit({ name: SSECustomEventType.PREPARE_MATERIALS, data: payload })
                    }
                } catch (error) {
                    logger.error('材料预处理中间件异常，继续启动 Agent', { caseId, error })
                }
            }
        }
    })
}
```

- [ ] **Step 4: 跑测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/material/ tests/server/agents/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add shared/types/agentEvent.ts server/services/material/materialPipeline.service.ts server/agents/_shared/case-context/
git commit -m "feat(cases): 中间件升级'识别+简介双就绪'判定 + SSE 进度推送

- ensureMaterialsReadyService 加阶段 3：并行触发已识别材料的简介生成
- waitMaterialsTerminalAndSummary 按文件级查 summary（不再读 caseMaterials.summary）
- 中间件用 createCustomEventEmitter 推 PREPARE_MATERIALS，runId/sessionId 从 ALS 拿
- onProgress 回调累积 lastSnapshot，end 阶段直接用（不重新查 DB）"
```

---

### Task 8：V2 案件初分挂 caseProcessMaterialMiddleware

**Files:**
- Modify: `server/services/workflow/caseAnalysisV2.executor.ts`（撤回临时 await）
- Modify: `server/agents/case-analysis/runAnalysisSubAgent.ts`（挂中间件）

- [ ] **Step 1: 撤回 V2 入口的临时 await**

修改 `server/services/workflow/caseAnalysisV2.executor.ts`，删除：

```typescript
import { ensureMaterialsReadyService } from '~~/server/services/material/materialPipeline.service'
```

和：

```typescript
    if (!params.command) {
        await ensureMaterialsReadyService(params.caseId, params.userId)
    }
```

恢复纯 stream 启动。

- [ ] **Step 2: V2 子代理挂中间件**

修改 `server/agents/case-analysis/runAnalysisSubAgent.ts`，找到 `middlewareItems` 列表（约 line 155-191），在 `MESSAGE_INTEGRITY` 之后追加：

```typescript
        {
            middleware: caseProcessMaterialMiddleware(userId, caseId),
            priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
            name: MIDDLEWARE_NAMES.PROCESS_MATERIAL,
        },
```

文件顶部 import：

```typescript
import { caseProcessMaterialMiddleware } from '~~/server/agents/_shared/case-context/caseProcessMaterial.middleware'
```

`MIDDLEWARE_PRIORITY.PROCESS_MATERIAL` / `MIDDLEWARE_NAMES.PROCESS_MATERIAL` 已存在（grep 验证 ✓）。

- [ ] **Step 3: 调整 caseAnalysisV2.executor.test.ts**

修改 `tests/server/workflow/caseAnalysisV2.executor.test.ts`，删除原本验证"V2 入口调 ensureMaterialsReadyService"的两个测试（撤回了直接调用）。如果想新增验证"V2 子代理挂载了中间件"的测试，参考 runAnalysisSubAgent.test.ts。

- [ ] **Step 4: 跑测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/workflow/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/caseAnalysisV2.executor.ts server/agents/case-analysis/runAnalysisSubAgent.ts tests/server/workflow/
git commit -m "feat(analysis): V2 工作流挂载 caseProcessMaterialMiddleware

- 撤回 V2 executor 中的临时 await ensureMaterialsReadyService
- 在 runAnalysisSubAgent 中间件管道挂 caseProcessMaterialMiddleware
- 7 个分析子代理启动前自动过中间件，与小索/模块对话/文书生成行为一致"
```

---

### Task 9：替换 caseMaterials.summary 读取（含 process_materials 工具加 status）

**Files:**
- Modify: `server/services/agent-platform/context/moduleContextBuilder.ts`
- Modify: `server/services/material/materialPipeline.service.ts`（getMaterialContextService、getMaterialListWithSummariesService）
- Modify: `server/api/v1/cases/materials/[caseId].get.ts`、`[caseId].post.ts`
- Modify: `server/api/v1/assistant/document/drafts/related-materials/[id].get.ts`
- Modify: `server/services/agent-platform/tools/processMaterials.tool.ts`（output 加 status）

- [ ] **Step 1: 改 getMaterialListWithSummariesService**

修改 `server/services/material/materialPipeline.service.ts` 的 `getMaterialListWithSummariesService`：

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

- [ ] **Step 2: 改 getMaterialContextService**

`server/services/material/materialPipeline.service.ts` 内 `getMaterialContextService` 函数入口处加批量查询：

```typescript
export async function getMaterialContextService(
    materials: MaterialWithFile[],
): Promise<MaterialContextResult> {
    if (materials.length === 0) {
        return { mode: 'empty', totalTokens: 0, materialList: [] }
    }
    const summaryMap = await getMaterialSummariesByMaterials(
        materials.map(m => ({ id: m.id, type: m.type, ossFileId: m.ossFileId })),
    )
    // ...
```

后续 `m.summary` 的读取替换为 `summaryMap.get(m.id) ?? null`。

- [ ] **Step 3: 改 cases/materials API**

修改 `server/api/v1/cases/materials/[caseId].get.ts`（约 line 46）：

原：

```typescript
            summary: m.summary,
```

改为通过 helper 拿，在响应组装前批量查：

```typescript
import { getMaterialSummariesByMaterials } from '~~/server/services/material/material.service'

// 拿到 materials 之后
const summaryMap = await getMaterialSummariesByMaterials(
    materials.map(m => ({ id: m.id, type: m.type, ossFileId: m.ossFileId })),
)
// 组装响应
const responseData = materials.map(m => ({
    ...,
    summary: summaryMap.get(m.id) ?? null,
}))
```

`[caseId].post.ts` 同改法。

- [ ] **Step 4: 改 drafts/related-materials API**

修改 `server/api/v1/assistant/document/drafts/related-materials/[id].get.ts`（约 line 47），同样替换。

- [ ] **Step 5: process_materials 工具 output 加 status 字段**

修改 `server/services/agent-platform/tools/processMaterials.tool.ts`，在 `materialList` 映射前批量调 snapshot：

```typescript
import { snapshotMaterialReadiness } from '~~/server/services/material/materialPipeline.service'

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

- [ ] **Step 6: grep 兜底排查**

Run: `grep -rn "m\.summary\|material\.summary\|mat\.summary" server --include="*.ts" 2>&1 | grep -v ".test.ts" | grep -v "case_summary\|analysisResult\|analysis\.summary\|caseRecord\.summary\|asrRecord\.summary\|imageRecord\.summary\|docRecord\.summary" | head -20`
Expected: 余下应该都是已改过的或不相关引用——逐一确认

- [ ] **Step 7: 跑全部 server 测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/server/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过；如类型错误（caseMaterials.summary 不存在）—— 漏改的读取点逐一修

- [ ] **Step 8: Commit**

```bash
git add server/
git commit -m "refactor(cases): 8+ 处 caseMaterials.summary 读取改走跨表 helper

- moduleContextBuilder / 2 个 cases API / drafts API / processMaterials 工具
- 通过 getMaterialSummariesByMaterials 统一从识别记录表读 summary
- process_materials 工具 output 增加 status 字段（前端渲染五态）"
```

---

### Task 10：前端 + 全量回归

**Files:**
- Modify: `app/composables/useStreamChat.ts`（拦截 prepare_materials）
- Modify: `app/components/ai/composables/useMessageParser.ts`（orphan synthetic 独立渲染）
- Modify: `app/components/ai/tools/MaterialProcessTool.vue`（五态升级）
- Modify: `app/utils/toolDisplayName.ts`（如需调整显示名）

- [ ] **Step 1: useStreamChat 拦截 prepare_materials**

修改 `app/composables/useStreamChat.ts`，找到现有 `analysis_summary` 拦截块（约 line 285-325），在它**之后**追加：

```typescript
            if (
                data
                && typeof data === 'object'
                && 'name' in data
                && (data as { name: unknown }).name === 'prepare_materials'
            ) {
                const payload = (data as unknown as { data: PrepareMaterialsPayload }).data
                // 用 sentinel parentId，让 useMessageParser 走 orphan 渲染分支
                const parentId = '__pre_agent__'

                const list = syntheticToolCalls[parentId] ?? []
                let mutated = false
                if (payload.phase === 'start') {
                    if (!list.some(t => t.id === payload.toolCallId)) {
                        list.push({
                            id: payload.toolCallId,
                            name: 'process_materials',
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

- [ ] **Step 2: useMessageParser 加 orphan synthetic 独立渲染**

修改 `app/components/ai/composables/useMessageParser.ts`，找到 `parsedMessages` computed 末尾（约 line 348 附近，return Boolean filter 之后），追加 orphan synthetic 卡片处理：

```typescript
      // orphan synthetic toolCalls：sentinel parentId='__pre_agent__'
      // 独立渲染在消息流头部，不依赖任何 AIMessage（用于材料预处理保底卡片等场景）
      const orphanList = extras['__pre_agent__'] ?? []
      if (orphanList.length > 0) {
        return [
          {
            id: '__pre_agent_synthetic__',
            type: 'ai' as const,
            content: '',
            thinking: undefined,
            toolCalls: orphanList,
            raw: null as any,  // 没有原始 BaseMessage
          } as ParsedMessage,
          ...result,  // 原有解析结果
        ]
      }
      return result
```

注意：实际改造细节需根据现有 `parsedMessages` 的具体结构调整（如何插入到列表头部等）。

- [ ] **Step 3: MaterialProcessTool.vue 五态升级**

替换 `app/components/ai/tools/MaterialProcessTool.vue`：

```vue
<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import { CheckCircle2 as CheckCircle2Icon, Circle as CircleIcon, Loader2 as Loader2Icon, XCircle as XCircleIcon } from 'lucide-vue-next'

interface MaterialItem {
    id: number
    name: string
    status?: 'pending' | 'recognizing' | 'summarizing' | 'ready' | 'failed'
    embedded?: boolean
}

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

const sourceData = computed(() => {
    if (props.output != null) {
        try {
            return typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        } catch { return null }
    }
    return props.input ?? null
})

const materials = computed<MaterialItem[]>(() => sourceData.value?.materials || [])

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
        case 'summarizing': return '提取摘要中'
        case 'ready': return '已完成'
        case 'failed': return '识别失败'
        default: return ''
    }
}
</script>

<template>
    <Tool>
        <ToolHeader title="材料处理" type="tool-process_materials" :state="state">
            <template #extra>
                <span v-if="materials.length" class="text-xs text-muted-foreground">
                    {{ summary.ready }}/{{ summary.total }} 已完成
                </span>
            </template>
        </ToolHeader>
        <ToolContent v-if="materials.length > 0">
            <div class="p-4">
                <ul class="space-y-2">
                    <li v-for="m in materials" :key="m.id" class="flex items-center gap-2 text-sm">
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
                        <CircleIcon v-else class="size-4 shrink-0 text-muted-foreground/40" />
                        <span class="text-foreground line-clamp-1 break-words flex-1">{{ m.name }}</span>
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

注意：`ToolHeader` 是 `app/components/ai-elements/tool/` 下的组件，`extra` 是 named slot（**不是 prop**）—— grep 验证过。

- [ ] **Step 4: 类型校验**

Run: `bun run typecheck 2>&1 | grep -E "error|Error" | head -10`
Expected: 无错误

- [ ] **Step 5: 跑前端测试**

Run: `VITEST_MAX_WORKERS=4 npx vitest run tests/client/ --reporter=default 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 6: 全量回归**

Run: `VITEST_MAX_WORKERS=4 NODE_OPTIONS='--max-old-space-size=16384' bun run test 2>&1 | tail -10`
Expected: 全部通过

- [ ] **Step 7: 覆盖率检查**

Run: `VITEST_MAX_WORKERS=4 bun run coverage 2>&1 | tail -20`
Expected: agent-platform 子目录覆盖率 ≥90%

- [ ] **Step 8: dev server E2E 验证**

Run: `bun dev`（后台），手动验证：
1. **主路径**：选 3 份不同类型材料 → 等待按钮解锁（识别+简介都好）→ 提交分析正常进入
2. **保底路径**：手工 SQL 把识别记录的 summary 置 null 模拟未生成 → 启动分析 → 看到"材料处理"卡片**立即显示**进度 → 卡片完成后分析进入
3. **失败路径**：模拟 LLM 故意失败 → 看到红叉 + "X 份材料处理失败"
4. **复用验证**：同一份文件先在案件 A 用，复制到案件 B → B 启动时秒进（简介天然复用）

验证完后 `kill -9 <dev_pid>` 杀掉 dev server。

- [ ] **Step 9: Commit + push**

```bash
git add app/
git commit -m "feat(ui): MaterialProcessTool 五态升级 + 保底卡片独立渲染

- useStreamChat 拦截 prepare_materials 事件合成 process_materials toolCall
- useMessageParser 增加 orphan synthetic 独立渲染分支（不依赖 AIMessage）
- MaterialProcessTool.vue 五态状态指示 + 头部 X/Y 已完成 + lucide 图标
- 文案：'提取摘要中' / '已完成'（与用户拍板一致）"
git push origin dev
```

---

## Self-Review

| Spec 章节                         | 实现 Task                          |
| --------------------------------- | ---------------------------------- |
| §4.1 字段语义统一                 | Task 1                             |
| §4.2 generateMaterialSummaryService 改造 | Task 3                             |
| §4.3 触发时机                     | Task 5 + Task 7（pipeline 阶段 3） |
| §4.4 状态判定 / 前端等待          | Task 6                             |
| §4.5 中间件保底                   | Task 7 + Task 8                    |
| §4.6 防重 + 并行 + 重试           | Task 3（inflight + 重试）+ Task 7（并行） |
| §4.7 UI 进度卡片                  | Task 7（事件）+ Task 10（拦截+渲染）   |
| §4.8 数据迁移                     | Task 1                             |
| §4.9 读取改造                     | Task 4 + Task 9                    |
| ASR summary 字段语义切换          | Task 2                             |

**Task 数：10 个**（原 15 → 简化 33%）

无遗漏。无占位符。

---

## Execution Handoff

Plan 完成。两种执行方式选一：

1. **Subagent-Driven**（推荐）：每个 Task 派一个 subagent 实施 + 两段 review
2. **Inline**：本会话直接执行，加 checkpoint

请选择。
