# M4 · 分析产物摘要 + RAG · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `caseAnalyses` 加 `summary` 字段；新建 `case_analysis_embeddings` 表（LangChain PGVectorStore 同构 schema）；模块分析完成时同步产出 summary（主模型）+ 切块 embedding；`switchActiveVersionService` 原子同步 `metadata.isActive`；新增 `search_case_analysis` 工具复用 `retrieveWithReranking`；重构 `buildCompletedResultsSection` 只塞摘要不塞全文。

**Architecture:** 完全复用 M2+M3 建立的基建（`addDocumentsToVectorStore` / `hybridSearchService` / `retrieveWithReranking` / `generateSummary` / `ALLOWED_TABLES`），M4 只添数据模型 + 一条 Agent 工具 + 一处 initAnalysis 集成。

**Tech Stack:** Prisma + pgvector + zhparser + LangChain PGVectorStore + Vitest

**Spec reference:** [`docs/superpowers/specs/2026-04-23-case-context-governance-design.md`](../specs/2026-04-23-case-context-governance-design.md) §4（commit 8acf2f96）

**Phase:** 3（独立上线，依赖 Phase 2 发布的 retrieveWithReranking / generateSummary）· **预估:** ~3 工作日

**前置条件：** Phase 2（M2+M3）已发布，以下基建可用：
- `server/services/ai/summaryService.ts:generateSummary`
- `server/services/memory/retrieveWithReranking.ts`
- `server/services/retrieval/types.ts:ALLOWED_TABLES`
- `server/services/legal/vectorStore.service.ts:addDocumentsToVectorStore`

---

## File Structure

### 新建
- `server/services/workflow/tools/search_case_analysis.tool.ts`
- `prisma/migrations/<ts>_add_case_analysis_rag/migration.sql`
- `tests/server/memory/searchCaseAnalysis.test.ts`
- `tests/server/caseAnalysis.rag.test.ts`

### 修改
- `prisma/models/case.prisma` — `caseAnalyses` +`summary`；新增 `caseAnalysisEmbeddings` model
- `server/services/retrieval/types.ts` — `ALLOWED_TABLES` 加 `case_analysis_embeddings`；`RetrievalRequest.type` 加 `'case_analysis'`
- `server/services/retrieval/hybridSearch.service.ts` — tableNameMap/extractDocId/reciprocalRankFusion 加 `'case_analysis'` 支持
- `server/services/memory/retrieveWithReranking.ts` — typeMap 加 `case_analysis_embeddings: 'case_analysis'`
- `server/services/case/initAnalysis.service.ts`（或 `caseAnalysisPersistence.middleware`）— 模块分析完成时生成 summary + embedding
- `server/services/case/analysis.service.ts:583` — `switchActiveVersionService` 同步 metadata.isActive
- `server/services/workflow/context/moduleContextBuilder.ts` — `moduleSummaries` 段只取 active 版本的 `caseAnalyses.summary`
- `server/services/workflow/tools/index.ts` — 注册 `search_case_analysis`

---

## Task 1: `caseAnalyses.summary` 字段 + `case_analysis_embeddings` 表

**Files:**
- Modify: `prisma/models/case.prisma`
- Create: `prisma/migrations/<ts>_add_case_analysis_rag/migration.sql`

- [ ] **Step 1: 修改 Prisma model**

在 `prisma/models/case.prisma` 找到 `model caseAnalyses`，追加字段：

```prisma
model caseAnalyses {
  // ... 现有字段保留 ...
  /// 分析结果摘要（200-400 字，模块完成时同步产出，主模型生成）
  summary String? @db.Text
}
```

末尾新增 model：

```prisma
/// 案件分析产物向量表（LangChain PGVectorStore 同构，与 caseMemories 同款约束）
/// 写入走 addDocumentsToVectorStore；业务字段（caseId/analysisId/nodeId/version/isActive/analysisType/chunkIndex）走 metadata JSON + expression index
/// 注意：此表结构对齐 LangChain 约定，不允许新增查询列（会破坏框架写入）
model caseAnalysisEmbeddings {
  id        String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  text      String?                  @db.Text
  metadata  Json?
  embedding Unsupported("vector")?
  tsv       Unsupported("tsvector")?

  @@index([tsv], type: Gin, map: "idx_case_analysis_tsv")
  @@map("case_analysis_embeddings")
}
```

- [ ] **Step 2: 生成 migration**

Run: `bun run prisma:migrate --name add_case_analysis_rag --create-only`
Expected: 生成迁移文件，含 `ALTER TABLE case_analyses ADD COLUMN summary TEXT` + `CREATE TABLE case_analysis_embeddings` + GIN tsv 索引。

- [ ] **Step 3: 追加手工 SQL**

打开生成的 migration.sql，在 Prisma 自动生成部分之后追加：

```sql

-- ==================== M4 case_analysis_embeddings 手工补充 ====================

-- （幂等）确保 zhparser 中文分词配置存在（同 case_memories migration）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
    CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END $$;

-- HNSW 向量索引
CREATE INDEX IF NOT EXISTS "idx_case_analysis_embedding"
  ON "case_analysis_embeddings" USING hnsw (embedding vector_cosine_ops);

-- metadata 热查询 expression index
CREATE INDEX IF NOT EXISTS "idx_case_analysis_meta_active"
  ON "case_analysis_embeddings" ((metadata->>'caseId'), (metadata->>'analysisType'))
  WHERE metadata->>'isActive' = 'true';
CREATE INDEX IF NOT EXISTS "idx_case_analysis_meta_analysis"
  ON "case_analysis_embeddings" ((metadata->>'analysisId'));
```

- [ ] **Step 4: 应用迁移**

Run: `bun run prisma:migrate`
Expected: 成功。

- [ ] **Step 5: 验证**

Run:
```bash
DATABASE_URL="$DATABASE_URL" psql -c "\d case_analyses" | grep summary
DATABASE_URL="$DATABASE_URL" psql -c "\d case_analysis_embeddings"
```
Expected: `summary` 字段存在；`case_analysis_embeddings` 5 列 + 3 索引。

- [ ] **Step 6: Commit**

```bash
git add prisma/models/case.prisma prisma/migrations/
git commit -m "feat(analysis): caseAnalyses +summary + case_analysis_embeddings 表

- caseAnalyses 加 summary Text?（200-400 字摘要存储）
- case_analysis_embeddings 与 caseMemories 同款 LangChain 同构 schema
- 幂等 CREATE TEXT SEARCH CONFIGURATION chinese + HNSW + metadata 热字段 expression index
spec §4.1"
```

---

## Task 2: `ALLOWED_TABLES` 注册 + 检索路径扩展（`hybridSearch` / `retrieveWithReranking`）

**Files:**
- Modify: `server/services/retrieval/types.ts`
- Modify: `server/services/retrieval/hybridSearch.service.ts`
- Modify: `server/services/memory/retrieveWithReranking.ts`

- [ ] **Step 1: 扩展 `types.ts`**

编辑 `server/services/retrieval/types.ts`：

```ts
export const ALLOWED_TABLES = new Set<string>([
  'case_material_embeddings',
  'law_embeddings',
  'case_memories',             // Phase 2 已加
  'case_analysis_embeddings',  // Phase 3 新加
])

// RetrievalRequest.type 加 'case_analysis'（对应 case_analysis_embeddings 表）
export interface RetrievalRequest {
  query: string
  type: 'law' | 'case_material' | 'case_memory' | 'case_analysis'
  k: number
  metadataFilter?: Record<string, string | number | boolean>
  sourceIds?: string[]
  postFilters?: PostFilters
}
```

> 注意：只修改 `type` 联合类型，其余字段保持不变。

- [ ] **Step 2: 扩展 `hybridSearch.service.ts`**

编辑 `server/services/retrieval/hybridSearch.service.ts`，修改三处：

```ts
// 1. extractDocId：加 'case_analysis' 分支
export function extractDocId(
  item: SearchResultItem,
  type: 'law' | 'case_material' | 'case_memory' | 'case_analysis',
): string {
  if (type === 'law') {
    return (item.metadata.articles_id as string) || `${item.content.slice(0, 50)}`
  }
  if (type === 'case_memory') {
    const m = item.metadata as any
    return m?.id ?? (m?.subjectKey ? `${m.caseId}_${m.subjectKey}` : item.content.slice(0, 50))
  }
  if (type === 'case_analysis') {
    // 同 analysisId + chunkIndex 去重（同一份分析的同一块不重复）
    const m = item.metadata as any
    return m?.id ?? (m?.analysisId != null ? `${m.analysisId}_${m.chunkIndex ?? 0}` : item.content.slice(0, 50))
  }
  return `${item.metadata.sourceId}_${item.metadata.chunkIndex ?? 0}`
}

// 2. reciprocalRankFusion：type 参数扩展
export function reciprocalRankFusion(
  bm25Results: SearchResultItem[],
  vectorResults: SearchResultItem[],
  type: 'law' | 'case_material' | 'case_memory' | 'case_analysis',
  k: number = 60,
): SearchResultItem[] {
  // 实现不变，只扩展 type 参数 union
  ...
}

// 3. hybridSearchService：tableNameMap 加 case_analysis
export async function hybridSearchService(
  intent: IntentClassification,
  request: RetrievalRequest,
): Promise<SearchResultItem[]> {
  const tableNameMap: Record<string, string> = {
    law: 'law_embeddings',
    case_material: 'case_material_embeddings',
    case_memory: 'case_memories',
    case_analysis: 'case_analysis_embeddings',  // M4 新增
  }
  const tableName = tableNameMap[request.type] ?? 'case_material_embeddings'
  ...
  return reciprocalRankFusion(bm25Results, vectorResults, request.type)
}
```

- [ ] **Step 3: 扩展 `retrieveWithReranking.ts` typeMap**

编辑 `server/services/memory/retrieveWithReranking.ts`，修改 typeMap：

```ts
// tableName → RetrievalRequest.type 映射
const typeMap: Record<string, 'law' | 'case_material' | 'case_memory' | 'case_analysis'> = {
  law_embeddings: 'law',
  case_memories: 'case_memory',
  case_analysis_embeddings: 'case_analysis',  // M4 新增
}
const request: RetrievalRequest = {
  type: typeMap[tableName] ?? 'case_material',
  query,
  k: topK * 3,
  metadataFilter,
}
```

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -i "retrieval\|hybridSearch\|RetrievalRequest" | head -10`
Expected: 无错。

- [ ] **Step 5: Commit**

```bash
git add server/services/retrieval/types.ts server/services/retrieval/hybridSearch.service.ts server/services/memory/retrieveWithReranking.ts
git commit -m "feat(retrieval): 检索路径支持 case_analysis_embeddings 表

- RetrievalRequest.type 加 'case_analysis'
- hybridSearchService tableNameMap: case_analysis → case_analysis_embeddings
- extractDocId/reciprocalRankFusion 扩展 'case_analysis' 类型（分析 id+chunkIndex 去重）
- retrieveWithReranking typeMap: case_analysis_embeddings → 'case_analysis'
spec §4"
```

---

## Task 3: 模块分析完成时同步生成 summary + 事务外 embedding（TDD）

**Files:**
- Modify: `server/services/case/initAnalysis.service.ts`（或分析完成落库的文件）
- Create: `tests/server/caseAnalysis.rag.test.ts`

- [ ] **Step 1: 定位分析完成点**

Run: `grep -n "status.*COMPLETED\|status: 2\|analysisResult.*update\|completeAnalysis" server/services/case/*.ts`
Expected: 定位到分析完成写库的代码位置（一般是 `initAnalysis.service.ts` 或 workflow middleware `analysisResultPersistence.middleware.ts`）。

- [ ] **Step 2: 写测试（集成测）**

Create `tests/server/caseAnalysis.rag.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'

// Mock generateSummaryService（不 mock 底层模型，直接控制摘要输出）
vi.mock('~~/server/services/ai/summaryService', () => ({
  generateSummaryService: vi.fn().mockResolvedValue('风险等级：中高。依据：违约条款明确，证据链完整。'),
}))
vi.mock('~~/server/services/legal/vectorStore.service', async (orig) => {
  const actual: any = await orig()
  return {
    ...actual,
    addDocumentsToVectorStore: vi.fn().mockResolvedValue(undefined),
  }
})

describe('completeAnalysisWithRAG（集成测）', () => {
  let caseId: number
  let analysisId: number

  beforeEach(async () => {
    const c = await prisma.cases.create({ data: { title: 'x', userId: 1, caseTypeId: 1 } })
    caseId = c.id
    const n = await prisma.nodes.findFirst() || null
    const a = await prisma.caseAnalyses.create({
      data: {
        caseId, sessionId: 'test-sess', nodeId: n?.id ?? 1,
        analysisType: 'risk_assessment', status: 1, version: 1, isActive: false,
      },
    })
    analysisId = a.id
  })
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_analysis_embeddings WHERE metadata->>'caseId' = $1`, caseId.toString(),
    )
    await prisma.caseAnalyses.deleteMany({ where: { caseId } })
    await prisma.cases.delete({ where: { id: caseId } })
    vi.clearAllMocks()
  })

  it('完成分析后 summary 被写入', async () => {
    const { completeAnalysisWithRAG } = await import('~~/server/services/case/initAnalysis.service')
    await completeAnalysisWithRAG({
      analysisId,
      analysisResult: '风险评估分析全文：本案违约责任明确...',
      model: { invoke: vi.fn() } as any,
    })
    const updated = await prisma.caseAnalyses.findUnique({ where: { id: analysisId } })
    expect(updated?.status).toBe(2)
    expect(updated?.summary).toContain('风险等级')
  })

  it('embedding 写入不在事务内（主 analysis 先 commit）', async () => {
    const { completeAnalysisWithRAG } = await import('~~/server/services/case/initAnalysis.service')
    const { addDocumentsToVectorStore } = await import('~~/server/services/legal/vectorStore.service')
    await completeAnalysisWithRAG({
      analysisId,
      analysisResult: '分析正文...',
      model: { invoke: vi.fn() } as any,
    })
    expect(addDocumentsToVectorStore).toHaveBeenCalled()
    const call = (addDocumentsToVectorStore as any).mock.calls[0]
    expect(call[2]).toEqual({ tableName: 'case_analysis_embeddings' })
  })

  it('embedding 失败只 warn，不回滚主分析', async () => {
    const { completeAnalysisWithRAG } = await import('~~/server/services/case/initAnalysis.service')
    const { addDocumentsToVectorStore } = await import('~~/server/services/legal/vectorStore.service')
    ;(addDocumentsToVectorStore as any).mockRejectedValueOnce(new Error('embedding service down'))

    await completeAnalysisWithRAG({
      analysisId,
      analysisResult: '分析正文',
      model: { invoke: vi.fn() } as any,
    })
    const updated = await prisma.caseAnalyses.findUnique({ where: { id: analysisId } })
    expect(updated?.status).toBe(2)  // 主分析仍 commit
    expect(updated?.summary).toBeTruthy()
  })
})
```

- [ ] **Step 3: 运行验证失败**

Run: `npx vitest run tests/server/caseAnalysis.rag.test.ts 2>&1 | tail -20`
Expected: 失败（`completeAnalysisWithRAG` 未定义）。

- [ ] **Step 4: 实现**

在 `server/services/case/initAnalysis.service.ts` 末尾追加（或插入到现有 `completeAnalysisService` 函数位置）：

```ts
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import crypto from 'node:crypto'
import { generateSummaryService } from '../ai/summaryService'
import { addDocumentsToVectorStore } from '../legal/vectorStore.service'

export interface CompleteAnalysisWithRAGInput {
  analysisId: number
  analysisResult: string
  model: BaseChatModel
}

/**
 * 分析模块完成的落库入口（含 M4 RAG 流程）。
 *
 * 事务边界：
 *   - 主分析 + summary：事务内（保证原子性，~1-3s）
 *   - embedding 切块写入：事务外（失败不回滚主分析，只影响 RAG 检索能力）
 */
export async function completeAnalysisWithRAG(input: CompleteAnalysisWithRAGInput): Promise<void> {
  const { analysisId, analysisResult, model } = input

  // Stage 1: 主分析 + summary（事务内）
  const analysis = await prisma.$transaction(async (tx) => {
    const existing = await tx.caseAnalyses.findUnique({
      where: { id: analysisId },
      select: { id: true, caseId: true, nodeId: true, analysisType: true, version: true },
    })
    if (!existing) throw new Error(`caseAnalyses #${analysisId} not found`)

    const summary = await generateSummaryService(model, analysisResult, {
      maxChars: 400,
      systemPrompt: '你是法律助手。对下方分析报告正文生成 200-400 字的中文专业摘要，保留关键事实、结论、依据，不加开场白总结语。',
    })

    const updated = await tx.caseAnalyses.update({
      where: { id: analysisId },
      data: {
        status: 2 /* COMPLETED */,
        analysisResult,
        summary,
        isActive: true,
      },
    })

    // 新激活版本 → 同 nodeId 的其它版本 isActive=false
    await tx.caseAnalyses.updateMany({
      where: {
        caseId: updated.caseId,
        nodeId: updated.nodeId,
        id: { not: updated.id },
      },
      data: { isActive: false },
    })

    return updated
  }, { timeout: 15_000 })

  // Stage 2: embedding 切块写入（事务外，失败不回滚）
  try {
    const chunks = splitByParagraph(analysisResult, 500)
    const ids = chunks.map(() => crypto.randomUUID())
    const docs = chunks.map((chunk, i) => ({
      pageContent: chunk,
      metadata: {
        id: ids[i],              // 铁律：metadata.id 必须存入，供 retrieveWithReranking 取回 MemoryHit.id
        caseId: analysis.caseId,
        analysisId: analysis.id,
        nodeId: analysis.nodeId,
        analysisType: analysis.analysisType,
        version: analysis.version,
        isActive: true,
        chunkIndex: i,
      },
    }))

    await addDocumentsToVectorStore(docs, ids, { tableName: 'case_analysis_embeddings' })

    // 手工回填 tsv
    await prisma.$executeRawUnsafe(
      `UPDATE case_analysis_embeddings
       SET tsv = to_tsvector('chinese', COALESCE(text, ''))
       WHERE id = ANY($1::uuid[]) AND tsv IS NULL`,
      ids,
    )

    // 同步老版本的 isActive=false（metadata 里）
    await prisma.$executeRawUnsafe(
      `UPDATE case_analysis_embeddings
       SET metadata = jsonb_set(metadata, '{isActive}', to_jsonb(false))
       WHERE metadata->>'caseId' = $1
         AND metadata->>'nodeId' = $2
         AND metadata->>'analysisId' <> $3`,
      String(analysis.caseId),
      String(analysis.nodeId),
      String(analysis.id),
    )
  } catch (e) {
    logger.warn(
      'case_analysis_embeddings 写入失败，主分析已 commit；RAG 检索暂不可用',
      { analysisId, error: e },
    )
  }
}

/** 按段落切块（\n\n 分隔，每块最多 maxChars 字符） */
function splitByParagraph(text: string, maxChars: number): string[] {
  const paras = text.split(/\n\n+/).filter((p) => p.trim())
  const chunks: string[] = []
  let current = ''
  for (const p of paras) {
    if ((current + p).length > maxChars) {
      if (current) chunks.push(current)
      current = p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current) chunks.push(current)
  return chunks
}
```

替换现有 `completeAnalysisService`（或原分析落库函数）的调用方改调 `completeAnalysisWithRAG`；旧入口保留兼容直至调用全部迁移完。

- [ ] **Step 5: 运行测试**

Run: `npx vitest run tests/server/caseAnalysis.rag.test.ts 2>&1 | tail -15`
Expected: 3 passed。

- [ ] **Step 6: Commit**

```bash
git add server/services/case/initAnalysis.service.ts tests/server/caseAnalysis.rag.test.ts
git commit -m "feat(analysis): 模块分析完成同步生成 summary + 事务外写 embedding

- completeAnalysisWithRAG 函数：两阶段
  Stage 1 (事务内): 主分析 + summary（generateSummaryService，400 字）+ 切换 isActive
  Stage 2 (事务外): 切块 + addDocumentsToVectorStore + tsv 回填 + 老版本 metadata.isActive=false
- Stage 2 失败只 warn 不回滚（主分析已 commit，RAG 检索能力降级）
- splitByParagraph 按 \\n\\n 切块，每块 <= 500 字符
- metadata.id = chunkUUID（铁律：必须存入供 retrieveWithReranking 取回 MemoryHit.id）
spec §4.2 Q4.1-A 拍板"
```

---

## Task 4: `switchActiveVersionService` 同步 metadata.isActive

**Files:**
- Modify: `server/services/case/analysis.service.ts:583`

- [ ] **Step 1: 读现有实现**

Run: `sed -n '580,610p' server/services/case/analysis.service.ts`
Expected: 看到 `switchActiveVersionService` 现有实现（只翻 caseAnalyses.isActive，不管 embeddings）。

- [ ] **Step 2: 扩展同步 embeddings metadata**

在 `switchActiveVersionService` 中、`activateVersionDao` 调用之后（或用事务包起来）加：

```ts
export const switchActiveVersionService = async (
  analysisId: number,
): Promise<caseAnalyses> => {
  const existing = await findAnalysisByIdDao(analysisId)
  if (!existing) throw new Error('分析记录不存在')
  if (existing.status !== AnalysisStatus.COMPLETED) {
    throw new Error('只能激活已完成的分析记录')
  }

  await prisma.$transaction(async (tx) => {
    // 1. 原有：翻 caseAnalyses.isActive
    await tx.caseAnalyses.updateMany({
      where: {
        caseId: existing.caseId,
        nodeId: existing.nodeId,
        id: { not: analysisId },
      },
      data: { isActive: false },
    })
    await tx.caseAnalyses.update({
      where: { id: analysisId },
      data: { isActive: true },
    })

    // 2. 新增：同步 case_analysis_embeddings.metadata.isActive
    await tx.$executeRawUnsafe(
      `UPDATE case_analysis_embeddings
       SET metadata = jsonb_set(metadata, '{isActive}', to_jsonb(false))
       WHERE metadata->>'caseId' = $1
         AND metadata->>'nodeId' = $2
         AND (metadata->>'analysisId')::int <> $3`,
      String(existing.caseId),
      String(existing.nodeId),
      analysisId,
    )
    await tx.$executeRawUnsafe(
      `UPDATE case_analysis_embeddings
       SET metadata = jsonb_set(metadata, '{isActive}', to_jsonb(true))
       WHERE metadata->>'analysisId' = $1`,
      String(analysisId),
    )
  })

  const updated = await findAnalysisByIdDao(analysisId)
  return updated!
}
```

> 若原 `activateVersionDao` 内部已有事务，外面再包 `prisma.$transaction` 会报错；这种情况下 inline 展开事务内的 updateMany / update，替代对 DAO 的调用。

- [ ] **Step 3: 追加测试（扩充现有 analysis.service 测试）**

在 `tests/server/caseAnalysis.rag.test.ts` 末尾追加：

```ts
describe('switchActiveVersionService · 同步 embeddings.metadata.isActive', () => {
  let caseId: number, v1: number, v2: number

  beforeEach(async () => {
    const c = await prisma.cases.create({ data: { title: 'x', userId: 1, caseTypeId: 1 } })
    caseId = c.id
    const n = await prisma.nodes.findFirst() || null
    const nodeId = n?.id ?? 1

    const a1 = await prisma.caseAnalyses.create({
      data: { caseId, sessionId: 's', nodeId, analysisType: 't', status: 2, version: 1, isActive: true },
    })
    const a2 = await prisma.caseAnalyses.create({
      data: { caseId, sessionId: 's', nodeId, analysisType: 't', status: 2, version: 2, isActive: false },
    })
    v1 = a1.id; v2 = a2.id

    // 插入两条对应的 embedding 记录（v1 active / v2 inactive）
    await prisma.$executeRawUnsafe(
      `INSERT INTO case_analysis_embeddings (text, metadata) VALUES
       ('v1 text', $1::jsonb),
       ('v2 text', $2::jsonb)`,
      JSON.stringify({ caseId, analysisId: v1, nodeId, version: 1, isActive: true, chunkIndex: 0 }),
      JSON.stringify({ caseId, analysisId: v2, nodeId, version: 2, isActive: false, chunkIndex: 0 }),
    )
  })
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_analysis_embeddings WHERE metadata->>'caseId' = $1`, caseId.toString(),
    )
    await prisma.caseAnalyses.deleteMany({ where: { caseId } })
    await prisma.cases.delete({ where: { id: caseId } })
  })

  it('切到 v2：v2 embedding.isActive=true，v1=false', async () => {
    const { switchActiveVersionService } = await import('~~/server/services/case/analysis.service')
    await switchActiveVersionService(v2)

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT metadata->>'analysisId' AS aid, metadata->>'isActive' AS active
       FROM case_analysis_embeddings
       WHERE metadata->>'caseId' = $1
       ORDER BY (metadata->>'analysisId')::int ASC`,
      caseId.toString(),
    )
    const v1Row = rows.find((r) => Number(r.aid) === v1)
    const v2Row = rows.find((r) => Number(r.aid) === v2)
    expect(v1Row.active).toBe('false')
    expect(v2Row.active).toBe('true')
  })
})
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/server/caseAnalysis.rag.test.ts 2>&1 | tail -10`
Expected: 4 passed（原 3 + 新 1）。

- [ ] **Step 5: Commit**

```bash
git add server/services/case/analysis.service.ts tests/server/caseAnalysis.rag.test.ts
git commit -m "feat(analysis): switchActiveVersionService 同步 embeddings.metadata.isActive

事务内原子更新：
1. caseAnalyses.isActive（原有）
2. case_analysis_embeddings.metadata.isActive（新增，jsonb_set + to_jsonb）

无需重建 embedding；用户切版本后 search_case_analysis 立即跟随新 active 版本。
spec §4.3"
```

---

## Task 5: `search_case_analysis` 工具

**Files:**
- Create: `server/services/workflow/tools/search_case_analysis.tool.ts`
- Modify: `server/services/workflow/tools/index.ts`
- Create: `tests/server/memory/searchCaseAnalysis.test.ts`

- [ ] **Step 1: 写测试**

Create `tests/server/memory/searchCaseAnalysis.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/memory/retrieveWithReranking', () => ({
  retrieveWithReranking: vi.fn().mockResolvedValue([
    { id: 'a1', text: '风险评估结论', score: 0.9, metadata: { caseId: 1, analysisType: 'risk_assessment', isActive: true } },
  ]),
}))

describe('search_case_analysis tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('默认 filter.isActive=true，不带历史版本', async () => {
    const { createTool } = await import('~~/server/services/workflow/tools/search_case_analysis.tool')
    const { retrieveWithReranking } = await import('~~/server/services/memory/retrieveWithReranking')
    const t = createTool({ caseId: 42, userId: 1, sessionId: 's' })
    await t.invoke({ query: '违约风险', top_k: 5, include_all_versions: false })
    const call = (retrieveWithReranking as any).mock.calls[0][0]
    expect(call.tableName).toBe('case_analysis_embeddings')
    expect(call.metadataFilter).toEqual({ caseId: 42, isActive: true })
  })

  it('analysis_type 过滤特定模块', async () => {
    const { createTool } = await import('~~/server/services/workflow/tools/search_case_analysis.tool')
    const { retrieveWithReranking } = await import('~~/server/services/memory/retrieveWithReranking')
    const t = createTool({ caseId: 42, userId: 1, sessionId: 's' })
    await t.invoke({ query: 'x', analysis_type: 'risk_assessment', top_k: 3 })
    const call = (retrieveWithReranking as any).mock.calls[0][0]
    expect(call.metadataFilter.analysisType).toBe('risk_assessment')
  })

  it('include_all_versions=true 去掉 isActive 过滤', async () => {
    const { createTool } = await import('~~/server/services/workflow/tools/search_case_analysis.tool')
    const { retrieveWithReranking } = await import('~~/server/services/memory/retrieveWithReranking')
    const t = createTool({ caseId: 42, userId: 1, sessionId: 's' })
    await t.invoke({ query: 'x', include_all_versions: true, top_k: 5 })
    const call = (retrieveWithReranking as any).mock.calls[0][0]
    expect(call.metadataFilter.isActive).toBeUndefined()
  })

  it('enableVersionScoring=false（M4 用 isActive 过滤替代版本链降权）', async () => {
    const { createTool } = await import('~~/server/services/workflow/tools/search_case_analysis.tool')
    const { retrieveWithReranking } = await import('~~/server/services/memory/retrieveWithReranking')
    const t = createTool({ caseId: 42, userId: 1, sessionId: 's' })
    await t.invoke({ query: 'x', top_k: 5 })
    const call = (retrieveWithReranking as any).mock.calls[0][0]
    expect(call.enableVersionScoring).toBe(false)
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run tests/server/memory/searchCaseAnalysis.test.ts 2>&1 | tail -10`
Expected: 失败。

- [ ] **Step 3: 实现**

Create `server/services/workflow/tools/search_case_analysis.tool.ts`:

```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { retrieveWithReranking } from '../../memory/retrieveWithReranking'
import type { ToolContext } from './types'  // 复用 tools/types.ts，不重定义

export const toolDefinition = {
  name: 'search_case_analysis',
  description: '检索当前案件已完成的分析报告片段（诉请分析、风险评估等模块的正文）。默认只返回生效版本。当需要引用某个模块的具体分析细节时调用。',
  schema: z.object({
    query: z.string().describe('检索关键词或问题'),
    analysis_type: z.string().optional().describe('限定分析模块类型，如 "risk_assessment" / "claim_analysis"'),
    include_all_versions: z.boolean().default(false).describe('是否返回非生效版本（对比历史版本时用）'),
    top_k: z.number().default(5),
  }),
}

export function createTool(context: ToolContext) {
  return tool(async ({ query, analysis_type, include_all_versions, top_k }) => {
    if (!context.caseId) return JSON.stringify({ error: '未绑定案件，无法检索分析产物' })
    const metadataFilter: Record<string, string | number | boolean> = { caseId: context.caseId }
    if (analysis_type) metadataFilter.analysisType = analysis_type
    if (!include_all_versions) metadataFilter.isActive = true

    const hits = await retrieveWithReranking({
      tableName: 'case_analysis_embeddings',
      query,
      topK: top_k,
      metadataFilter,
      filterInvalidated: false,    // 分析产物不使用 invalidatedAt 语义
      enableVersionScoring: false, // 用 isActive 过滤代替版本链降权
    })
    return JSON.stringify(hits.map((h) => ({
      id: h.id,
      text: h.text,
      score: h.score.toFixed(3),
      analysisType: (h.metadata as any).analysisType,
      version: (h.metadata as any).version,
    })))
  }, toolDefinition)
}
```

- [ ] **Step 4: 注册到 tools/index.ts**

编辑 `server/services/workflow/tools/index.ts`：

```ts
import * as searchCaseAnalysis from './search_case_analysis.tool'

export const toolModules: Record<string, ToolModule> = {
  // ... 现有 ...
  search_case_analysis: searchCaseAnalysis,
}
```

- [ ] **Step 5: 测试通过**

Run: `npx vitest run tests/server/memory/searchCaseAnalysis.test.ts 2>&1 | tail -10`
Expected: 4 passed。

- [ ] **Step 6: Commit**

```bash
git add server/services/workflow/tools/search_case_analysis.tool.ts server/services/workflow/tools/index.ts tests/server/memory/searchCaseAnalysis.test.ts
git commit -m "feat(tools): search_case_analysis 工具

- schema: query + analysis_type? + include_all_versions=false + top_k=5
- 默认 filter.isActive=true 只返生效版本
- 复用 retrieveWithReranking（enableVersionScoring=false，用 isActive 过滤替代）
- ToolContext 从 ./types 导入（不重定义），caseId 加 null check
- 注册到 toolModules
spec §4.4"
```

---

## Task 6: `moduleContextBuilder` 改为只塞 summary（非全文）

**Files:**
- Modify: `server/services/workflow/context/moduleContextBuilder.ts`

- [ ] **Step 1: 确认 Phase 2 的 buildContextSegments 里已经用 summary 字段**

Run: `grep -n "caseAnalyses\|analysisType.*summary" server/services/workflow/context/moduleContextBuilder.ts`
Expected: Phase 2 的实现已经用 `activeAnalyses.summary`。若 Phase 2 漏写 `summary`，这里补。

检查 `moduleContextBuilder.ts` 里 `caseAnalyses.findMany` 的 select：

```ts
// 应该是：
prisma.caseAnalyses.findMany({
  where: { caseId, isActive: true, deletedAt: null, NOT: { analysisType: agentName } },
  select: { analysisType: true, summary: true },   // ← 只取 summary，不取 analysisResult 全文
  orderBy: { analysisType: 'asc' },
})
```

- [ ] **Step 2: 确保渲染逻辑用 summary**

```ts
const lines = ['## 已完成分析模块']
for (const a of activeAnalyses) {
  if (!a.summary) continue   // 无摘要的旧版本跳过（Q4.3 B）
  lines.push(`### ${a.analysisType}\n${a.summary}`)
}
```

若发现用的是 `a.analysisResult`（全文），改为 `a.summary`。

- [ ] **Step 3: 类型检查 + 全量单测**

Run: `npx nuxi typecheck 2>&1 | grep -i "context" | head -5`
Run: `npx vitest run tests/server/moduleContextBuilder.test.ts 2>&1 | tail -10`
Expected: 无错 + 测试通过。

- [ ] **Step 4: Commit（若 Phase 2 已经改好则跳过）**

```bash
git add server/services/workflow/context/moduleContextBuilder.ts
git commit -m "refactor(context): moduleSummaries 段只塞 caseAnalyses.summary（非全文）

- 跳过无 summary 的旧版本（Q4.3 B 旧数据不补）
- 全文改由 search_case_analysis 工具按需召回
spec §4.6"
```

---

## Task 7: E2E 手工验收清单

**Files:**
- Create: `docs/superpowers/plans/m4-e2e-checklist.md`

- [ ] **Step 1: 建验收单**

Create `docs/superpowers/plans/m4-e2e-checklist.md`:

```markdown
# M4 · E2E 手工验收清单

## 分析模块完成流程
- [ ] 跑完一个案件的风险评估模块分析，3-5 秒内 `caseAnalyses.summary` 有值（200-400 字）
- [ ] `case_analysis_embeddings` 表对应 `analysisId` 的多条记录写入（按段落切块）
- [ ] 这些记录的 `metadata.isActive = true` / `metadata.analysisType = 'risk_assessment'` / `metadata.version = N`
- [ ] 主对话里触发 `search_case_analysis` 工具，能命中该模块的内容

## 多版本切换
- [ ] 对同一模块跑第二次分析，产生 version=2 的 caseAnalyses + embeddings
- [ ] version=2 自动 isActive=true，version=1 自动 isActive=false（caseAnalyses 和 embeddings 都变）
- [ ] 调 `switchActiveVersionService(v1Id)` 切回 v1 版本
- [ ] v1 的 caseAnalyses.isActive=true，v2 的=false
- [ ] v1 的 embeddings.metadata.isActive=true，v2 的=false
- [ ] `search_case_analysis` 跟随切版本，返回 v1 片段

## 模块摘要进 prompt
- [ ] 分析完风险评估后，打开另一个模块的对话
- [ ] 观察 system prompt 第 ④ 段包含"已完成分析模块"+ 风险评估的 summary
- [ ] prompt 中**不**出现风险评估全文（只摘要）
- [ ] Agent 可以调 `search_case_analysis` 召回全文片段

## 旧数据兼容
- [ ] 生产前的 caseAnalyses（无 summary）不阻塞对话
- [ ] 这些旧版本召回不到（合理，Q4.3 B）

## 事务边界
- [ ] 故意让 embedding 服务不可达（停 embedding API 或改环境变量到错地址）
- [ ] 跑分析：`caseAnalyses.summary` 仍有值（主事务 commit）
- [ ] 日志出现 `case_analysis_embeddings 写入失败，主分析已 commit` warn
- [ ] 后续恢复 embedding 服务，新分析正常写入

## 中文分词
- [ ] 分析摘要全中文：`合同纠纷的违约责任中高`
- [ ] Agent 调 `search_case_analysis({ query: '违约' })` 能命中（BM25 通过 tsv('chinese') 召回）
```

- [ ] **Step 2: 全量单测**

Run: `npx vitest run tests/server/caseAnalysis.rag.test.ts tests/server/memory/searchCaseAnalysis.test.ts 2>&1 | tail -10`
Expected: 全部通过。

- [ ] **Step 3: 按清单手工 E2E**

逐项验证。

- [ ] **Step 4: 最终 Commit**

```bash
git add docs/superpowers/plans/m4-e2e-checklist.md
git commit -m "docs(analysis): M4 RAG E2E 手工验收清单

6 大场景：分析完成流程 / 多版本切换 / 摘要进 prompt / 旧数据兼容 / 事务边界 / 中文分词。
M4 发布前必须逐项通过。"
```

---

## 附录 · 关键文件全景

```
prisma/
├── models/case.prisma                                  [修改] caseAnalyses +summary / caseAnalysisEmbeddings 新 model
└── migrations/<ts>_add_case_analysis_rag/              [新建] +summary 字段 + 新表 + chinese 配置 + HNSW + expression index

server/services/
├── case/
│   ├── initAnalysis.service.ts                         [修改] 新增 completeAnalysisWithRAG（两阶段事务）
│   └── analysis.service.ts:583                         [修改] switchActiveVersionService 同步 metadata.isActive
├── workflow/
│   ├── context/moduleContextBuilder.ts                 [修改/确认] moduleSummaries 段只塞 caseAnalyses.summary
│   └── tools/
│       ├── search_case_analysis.tool.ts                [新建]
│       └── index.ts                                    [修改] 注册
└── retrieval/types.ts                                  [修改] ALLOWED_TABLES +case_analysis_embeddings

tests/server/
├── caseAnalysis.rag.test.ts                            [新建] 3 + 1 用例
└── memory/searchCaseAnalysis.test.ts                   [新建] 4 用例

docs/superpowers/plans/
└── m4-e2e-checklist.md                                 [新建]
```

---

## 铁律核验（编码时逐条检查）

- [ ] `case_analysis_embeddings` 严格 LangChain PGVectorStore 同构 schema（同 `case_memories`）
- [ ] 写入走 `addDocumentsToVectorStore(docs, ids, { tableName })`，且 **metadata.id = chunk UUID**（铁律：retrieveWithReranking 依赖此字段）
- [ ] 查询链路完整：`ALLOWED_TABLES` + `RetrievalRequest.type('case_analysis')` + `hybridSearchService` tableNameMap + `retrieveWithReranking` typeMap 四处全部注册
- [ ] Stage 1（主分析 + summary）事务内；Stage 2（embedding）事务外
- [ ] `switchActiveVersionService` 在同一事务内同步 caseAnalyses.isActive + embeddings metadata.isActive
- [ ] 旧分析产物不补 summary / embedding（Q4.3 B）；召回不到不算 bug
- [ ] `search_case_analysis` 默认 `filter.isActive=true`，`enableVersionScoring=false`，`ToolContext` 从 `./types` 导入（不重定义）
- [ ] Migration 幂等 `CREATE TEXT SEARCH CONFIGURATION chinese`
- [ ] ARCHIVED 案件的分析触发已在 Phase 1 的 `initAnalysis.service` 入口加过守卫（无需在本 Phase 重复）
- [ ] 测试用 `import { prisma } from '~~/server/utils/db'`；mock `generateSummaryService` 而非 createChatModel
