# M2 + M3 · 上下文去重 & Prompt Caching & 记忆工具化 · 合并实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 `moduleContextBuilder` 为 5 段式 Prompt（三家供应商 Caching）、材料上下文改清单+摘要、废弃冗余 `basic_info` 记忆；新建 `case_memories` 表（LangChain PGVectorStore 同构 schema）、三个 Agent 工具（search/write/update）、对话后台 consolidator（Redis ZSET + 现有 CronScheduler + Haiku 4.5 抽取）、四阶段召回 pipeline（Hybrid RRF + rerank + 版本链降权；复用 `hybridSearchService`，新增 `retrieveWithReranking` 公共入口 + bge-reranker TEI 服务）。

**Architecture:** 最大化复用项目现有基建——写入走 `addDocumentsToVectorStore`（`legal/vectorStore.service.ts:244`），查询走 `hybridSearchService`（`retrieval/hybridSearch.service.ts:107`），consolidator 触发走现有 `CronScheduler`（`server/plugins/cron-scheduler.ts`）。新表仅承担数据存储，不重复造 CRUD 与召回 pipeline。

**Tech Stack:** Nuxt 4 + Prisma + pgvector + tsv/zhparser + LangChain PGVectorStore + ioredis + Haiku 4.5 + Anthropic prompt caching + Docker TEI（bge-reranker-v2-m3）+ Vitest

**Spec reference:** [`docs/superpowers/specs/2026-04-23-case-context-governance-design.md`](../specs/2026-04-23-case-context-governance-design.md) §2 §3（commit 8acf2f96）

**Phase:** 2（M2 + M3 合并发布，M2 的 ⑤ 段依赖 M3 召回填充）· **预估:** ~8 工作日

---

## File Structure

### 新建
- `server/services/ai/summaryService.ts` — 通用摘要 helper（M2 材料 + M4 分析共用）
- `shared/types/prompt.ts` — `PromptSegment` / `CachedPrompt` 类型
- `shared/types/memory.ts` — `CaseMemoryMetadata` / `MemoryHit` / `MemoryKind`
- `server/services/memory/memory.service.ts` — write/update/recall
- `server/services/memory/postProcess.ts` — 纯函数 versionScoring / recencyDecay（MMR 砍掉，等后续有 embedding 数据源再加）
- `server/services/memory/retrieveWithReranking.ts` — M3/M4 共享召回公共入口
- `server/services/memory/rerankerClient.ts` — TEI HTTP client
- `server/services/memory/consolidator.service.ts` — ZSET debounce + Haiku 抽取
- `server/services/workflow/tools/search_case_memory.tool.ts`
- `server/services/workflow/tools/write_case_memory.tool.ts`
- `server/services/workflow/tools/update_case_memory.tool.ts`
- `prisma/migrations/<ts>_add_case_memories/migration.sql`
- `tests/server/summaryService.test.ts`
- `tests/server/moduleContextBuilder.test.ts`
- `tests/server/memory/writeMemoryService.test.ts`
- `tests/server/memory/recallMemoryService.test.ts`
- `tests/server/memory/consolidator.test.ts`
- `tests/server/memory/postProcess.test.ts`
- `tests/server/memory/retrieveWithReranking.test.ts`

### 修改
- `prisma/models/case.prisma` — 加 `caseMemories` model
- `server/services/retrieval/types.ts` — `ALLOWED_TABLES` 加 `case_memories`，`ALLOWED_METADATA_KEYS` 加 `caseId/kind/subjectKey/confidence/source/supersedes/invalidatedAt/isActive`，`RetrievalRequest.type` 加 `'case_memory'`
- `server/services/retrieval/hybridSearch.service.ts` — 扩展 tableName 映射 + `extractDocId` / `reciprocalRankFusion` 支持 `'case_memory'` 类型
- `server/services/workflow/context/moduleContextBuilder.ts` — 重构为 `buildContextSegments`
- `server/services/material/materialPipeline.service.ts` — 输出改清单+摘要 + 触发摘要生成
- `server/services/material/material.service.ts` — 材料摘要入口
- `server/services/case/caseExtraction.service.ts` — 移除 `saveCaseInfoService` 调用
- `server/services/node/chatModelFactory.ts` — 三家 adapter 支持 `CachedPrompt`
- `server/services/workflow/tools/index.ts` — 注册 3 个新工具
- `server/api/v1/case/analysis/chat.post.ts` — 每轮对话结束调 `consolidator.schedule`
- `docker-compose.dev.yml` — 新增 `bge-reranker` service

---

## Task 1: 通用摘要 helper（`summaryService.ts`，TDD）

**Files:**
- Create: `server/services/ai/summaryService.ts`
- Create: `tests/server/summaryService.test.ts`

- [ ] **Step 1: 写测试**

Create `tests/server/summaryService.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { generateSummaryService } from '~~/server/services/ai/summaryService'

describe('generateSummaryService', () => {
  it('100 字场景（M2 材料）用 Haiku 4.5 + maxChars=100', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: '合同约定甲乙双方在 6 月 1 日前完成交付；违约金 10%' }),
    }
    const res = await generateSummaryService(mockModel as any, '一份很长的合同文本...', { maxChars: 100 })
    expect(res.length).toBeLessThanOrEqual(100)
    expect(mockModel.invoke).toHaveBeenCalledOnce()
  })

  it('400 字场景（M4 分析）支持自定义 systemPrompt', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: '风险等级：中高。主要依据...' }),
    }
    const res = await generateSummaryService(mockModel as any, '风险评估分析正文...', {
      maxChars: 400,
      systemPrompt: '你是法律助手，对分析报告做 200-400 字的专业摘要',
    })
    expect(res).toContain('风险等级')
  })

  it('模型返回超长时截断到 maxChars', async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: 'x'.repeat(500) }),
    }
    const res = await generateSummaryService(mockModel as any, 'text', { maxChars: 100 })
    expect(res.length).toBeLessThanOrEqual(100)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/summaryService.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 失败（文件不存在）。

- [ ] **Step 3: 实现**

Create `server/services/ai/summaryService.ts`:

```ts
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

export interface GenerateSummaryOptions {
  /** 摘要最大字符数（中文字符计 1） */
  maxChars: number
  /** 自定义 system prompt；默认通用摘要 prompt */
  systemPrompt?: string
}

/**
 * 通用文本摘要 helper。
 *
 * 使用场景：
 * - M2 材料摘要：Haiku 4.5 + maxChars=100（OCR 文本前 500 字 → 100 字摘要）
 * - M4 分析摘要：主模型 + maxChars=400（分析正文 → 200-400 字结论摘要）
 */
export async function generateSummaryService(
  const { maxChars, systemPrompt } = options
  const defaultSystemPrompt = `请对下方文本生成一段中文摘要，限制在 ${maxChars} 字以内，保留关键事实、时间、数字，不要加任何开场白或总结语，直接输出摘要正文。`
  const sys = systemPrompt ?? defaultSystemPrompt

  const res = await model.invoke([
    { role: 'system', content: sys },
    { role: 'user', content: text },
  ])
  const raw = typeof res.content === 'string' ? res.content : String(res.content)
  const trimmed = raw.trim()
  // 超长兜底（模型偶尔超出，硬截断）
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed
}
```

- [ ] **Step 4: 测试通过**

Run: `npx vitest run tests/server/summaryService.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add server/services/ai/summaryService.ts tests/server/summaryService.test.ts
git commit -m "feat(ai): 新增 generateSummary 通用摘要 helper

- 入参 (model, text, { maxChars, systemPrompt? })
- M2 材料摘要（Haiku 4.5 + 100 字）和 M4 分析摘要（主模型 + 400 字）共用
- 模型超长输出硬截断到 maxChars"
```

---

## Task 2: `PromptSegment` / `CachedPrompt` 类型

**Files:**
- Create: `shared/types/prompt.ts`

- [ ] **Step 1: 创建类型**

Create `shared/types/prompt.ts`:

```ts
/**
 * 带 cache 标记的 prompt 片段。
 * 各供应商 adapter 会按自家协议翻译：
 * - Anthropic: 包装为 content block 数组 + cache_control
 * - OpenAI / DeepSeek: 只需保持前缀稳定，自动命中；cache 字段被忽略
 */
export interface PromptSegment {
  /** 段落文本 */
  text: string
  /** 缓存策略；不填则不打 cache_control 标记 */
  cache?: {
    /**
     * '1h' = 稳定内容（案件档案、角色 prompt）
     * '5m' = 半稳定内容（模块摘要，每完成一个模块才变）
     */
    ttl: '1h' | '5m'
  }
}

/**
 * 带 cache 能力的 System Prompt（多段）。
 * 段落顺序约定：1h TTL 段必须在 5m TTL 段之前（Anthropic 要求）。
 */
export type CachedPrompt = PromptSegment[]
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck 2>&1 | head -20`
Expected: 无错误（仅创建类型，未被引用）。

- [ ] **Step 3: Commit**

```bash
git add shared/types/prompt.ts
git commit -m "feat(prompt): 新增 PromptSegment / CachedPrompt 类型

supply adapter 之间传递多段带 cache 标记的 system prompt；
段落顺序约定：1h TTL 段在 5m TTL 段之前（Anthropic 协议要求）"
```

---

## Task 3: Anthropic adapter 支持 `CachedPrompt`

**Files:**
- Modify: `server/services/node/chatModelFactory.ts`

- [ ] **Step 1: 定位现有 Anthropic adapter**

Run: `grep -n "ChatAnthropic\|anthropic\|sdkType.*anthropic" server/services/node/chatModelFactory.ts`
Expected: 看到 `ChatAnthropic` 实例化代码（大约 120-132 行）。

- [ ] **Step 2: 写两个工具函数（不改 ChatModelConfig）**

> 不在 ChatModelConfig 里加 `systemPromptSegments` 字段——消费方自己在 invoke 时调用这两个工具函数拼 SystemMessage 即可。

在 `chatModelFactory.ts` 末尾追加：

找到 `createChatModel` 函数的 anthropic 分支，在返回 `new ChatAnthropic(...)` 之前：

```ts
// Anthropic 分支示例（保留现有其它参数）
if (config.sdkType === 'anthropic') {
  const anthropicModel = new ChatAnthropic({
    modelName: config.modelName,
    apiKey: config.apiKey,
    temperature: config.temperature ?? 0.7,
    streaming: config.streaming ?? true,
    maxTokens: config.maxTokens,
    anthropicApiUrl: config.baseUrl,
  })

  // 如果有 systemPromptSegments，绑定为 SystemMessage 的 content block 数组
  // 调用方在 invoke 时无需再传 system，直接用本 model 即可
  if (config.systemPromptSegments && config.systemPromptSegments.length > 0) {
    const systemContent = config.systemPromptSegments.map((seg) => {
      const block: Record<string, unknown> = { type: 'text', text: seg.text }
      if (seg.cache) {
        block.cache_control = { type: 'ephemeral', ttl: seg.cache.ttl }
      }
      return block
    })
    // 返回一个已绑定 system 的 Runnable（LangChain pattern）
    // 通过 RunnableBinding + withConfig 注入 SystemMessage 到 invoke
    return anthropicModel.bind({
      callbacks: undefined,
      metadata: { __systemSegments: systemContent }, // 仅 debug 可见
      // LangChain 没有直接"预绑 system"API，消费方需在首次 invoke 时传 SystemMessage
    })
  }
  return anthropicModel
}
```

> **重要**：LangChain 没有把 SystemMessage 预绑到 model 的公共 API。更稳的做法是让**调用方**（`moduleContextBuilder` 的消费者）把 `systemPromptSegments` 自己转换为 `new SystemMessage({ content: contentBlocks })` 塞进 messages 数组。所以本 Task 只是把类型通道打通，不做 auto-bind。

改为：

```ts
// 把 CachedPrompt → Anthropic 风格的 SystemMessage content 数组，导出工具函数
export function cachedPromptToAnthropicContent(
  segments: CachedPrompt,
): Array<Record<string, unknown>> {
  return segments.map((seg) => {
    const block: Record<string, unknown> = { type: 'text', text: seg.text }
    if (seg.cache) {
      // 1h TTL 需显式传；5m 是默认值，不传 ttl 即可
      if (seg.cache.ttl === '1h') {
        block.cache_control = { type: 'ephemeral', ttl: '1h' }
      } else {
        block.cache_control = { type: 'ephemeral' }
      }
    }
    return block
  })
}
```

- [ ] **Step 4: OpenAI / DeepSeek adapter 提供兼容的纯文本拼接**

在同文件继续添加：

```ts
/**
 * 把 CachedPrompt → 纯字符串（OpenAI / DeepSeek 用）
 * 各供应商零配置自动命中 cache；只要前缀稳定，cache 字段忽略即可
 */
export function cachedPromptToPlainText(segments: CachedPrompt): string {
  return segments.map((seg) => seg.text).join('\n\n')
}
```

- [ ] **Step 5: 在 chat 调用路径里加 cache 命中日志**

定位到 `createChatModel` 之外、模型实际 invoke 的位置（一般是 `agentWorker.ts` / `moduleAgent.ts` 等），在响应回调里加：

```ts
// 读各家响应的 cache 字段（统一打点）
function logPromptCacheMetrics(provider: string, model: string, usage: any) {
  let hit = 0
  let total = 0
  if (provider === 'anthropic') {
    hit = (usage?.cache_read_input_tokens ?? 0)
    total = (usage?.input_tokens ?? 0) + hit
  } else if (provider === 'openai') {
    hit = (usage?.prompt_tokens_details?.cached_tokens ?? 0)
    total = usage?.prompt_tokens ?? 0
  } else if (provider === 'deepseek') {
    hit = (usage?.prompt_cache_hit_tokens ?? 0)
    total = usage?.prompt_tokens ?? 0
  }
  logger.info('prompt_cache', { provider, model, hit, total, hitRate: total ? hit / total : 0 })
}
```

在现有 `invoke` 完成后调用：`logPromptCacheMetrics(provider, modelName, response.usage)`。

> **落点**：编码时先运行 `grep -rn "\.invoke\b\|streamEvents\|usage_metadata" server/services/workflow/ | head -20` 找到 AI 模型 invoke 的位置（通常在 `caseAnalysisV2.workflow.ts` 或 `agentWorker.ts`），在该位置读取 response 的 `usage` / `usage_metadata` 字段，调用本函数打点。

- [ ] **Step 6: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -i "chatModelFactory\|prompt" | head -10`
Expected: 无错。

- [ ] **Step 7: Commit**

```bash
git add server/services/node/chatModelFactory.ts
git commit -m "feat(model): chatModelFactory 支持 CachedPrompt

- 新增 cachedPromptToAnthropicContent / cachedPromptToPlainText 工具函数
- 新增 logPromptCacheMetrics 统一日志（Anthropic/OpenAI/DeepSeek 字段名不同）
- ChatModelConfig 新增 systemPromptSegments 可选字段
spec §2.3"
```

---

## Task 4: `moduleContextBuilder` 重构为 5 段式（TDD）

**Files:**
- Modify: `server/services/workflow/context/moduleContextBuilder.ts`
- Create: `tests/server/moduleContextBuilder.test.ts`

- [ ] **Step 1: 写测试（只测段落结构 + cache 标记，纯函数）**

Create `tests/server/moduleContextBuilder.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖（prisma / 材料服务 / 召回）
const mockCasesFindUnique = vi.fn()
const mockCaseAnalysesFindMany = vi.fn()
vi.mock('~~/server/utils/db', () => ({
  prisma: {
    cases: { findUnique: (...args: any[]) => mockCasesFindUnique(...args) },
    caseAnalyses: { findMany: (...args: any[]) => mockCaseAnalysesFindMany(...args) },
  },
}))
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
  getMaterialListWithSummariesService: vi.fn().mockResolvedValue([
    { name: '合同', type: 2, summary: '约定 6 月前交付' },
  ]),
}))
vi.mock('~~/server/services/memory/memory.service', () => ({
  recallMemoryService: vi.fn().mockResolvedValue([
    { id: 'm1', text: '被告承认逾期', score: 0.9, metadata: {} },
  ]),
}))

describe('buildContextSegments', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('输出 4 段（角色/档案/摘要/动态），顺序正确', async () => {
    mockCasesFindUnique.mockResolvedValue({
      id: 1, title: '张李纠纷', courtName: '朝阳法院',
      plaintiff: ['张三'], defendant: ['李四'],
      summary: '房屋租赁纠纷', status: 3,
    })
    // M2 阶段 caseAnalyses 还没有 summary 字段；只有 analysisType
    mockCaseAnalysesFindMany.mockResolvedValue([
      { analysisType: 'risk_assessment' },
    ])

    const { buildContextSegments } = await import('~~/server/services/workflow/context/moduleContextBuilder')
    const segs = await buildContextSegments({
      caseId: 1,
      agentName: 'risk_assessment',
      userQuery: '这个案件违约风险如何',
    })

    expect(segs.roleAndFlow).toBeTruthy()
    expect(segs.caseProfile).toContain('朝阳法院')
    expect(segs.caseProfile).toContain('张李纠纷')
    // M2 阶段 moduleSummaries 只列出已完成的分析类型名称（无摘要正文，M4 补充）
    expect(segs.moduleSummaries).toContain('risk_assessment')
    expect(segs.dynamicContext).toContain('被告承认逾期')
  })

  it('caseProfile JSON 字段顺序稳定（字典序）以保证 cache 命中', async () => {
    mockCasesFindUnique.mockResolvedValue({
      id: 1, title: 'x', courtName: 'y', summary: 'z', status: 1,
      plaintiff: ['a'], defendant: ['b'],
    })
    mockCaseAnalysesFindMany.mockResolvedValue([])
    const { buildContextSegments } = await import('~~/server/services/workflow/context/moduleContextBuilder')
    const s1 = await buildContextSegments({ caseId: 1, agentName: 'x', userQuery: 'q' })
    const s2 = await buildContextSegments({ caseId: 1, agentName: 'x', userQuery: 'q' })
    expect(s1.caseProfile).toBe(s2.caseProfile) // 字节级一致
  })

  it('无分析产物时 moduleSummaries 为空串', async () => {
    mockCasesFindUnique.mockResolvedValue({ id: 1, title: 'x' })
    mockCaseAnalysesFindMany.mockResolvedValue([])
    const { buildContextSegments } = await import('~~/server/services/workflow/context/moduleContextBuilder')
    const segs = await buildContextSegments({ caseId: 1, agentName: 'x', userQuery: 'q' })
    expect(segs.moduleSummaries).toBe('')
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run tests/server/moduleContextBuilder.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 失败（`buildContextSegments` 未导出或输出结构不符）。

- [ ] **Step 3: 重构 moduleContextBuilder 为新接口**

把 `server/services/workflow/context/moduleContextBuilder.ts` 内容替换为：

```ts
import type { CachedPrompt, PromptSegment } from '#shared/types/prompt'
import { getMaterialListWithSummariesService } from '../../material/materialPipeline.service'
import { recallMemoryService } from '../../memory/memory.service'

export interface ContextSegments {
  /** ② 角色 + 流程规范（来自 NodeConfig） */
  roleAndFlow: string
  /** ③ 案件档案 JSON（可缓存 1h） */
  caseProfile: string
  /** ④ 已完成模块摘要（可缓存 5m） */
  moduleSummaries: string
  /** ⑤ 召回记忆 + 材料清单（动态，不缓存） */
  dynamicContext: string
}

interface Params {
  caseId: number
  agentName: string
  userQuery: string
  /** 可选：从 NodeConfig 取到的 systemPrompt 模板（否则用默认） */
  roleAndFlowTemplate?: string
}

/**
 * 构建 5 段式 prompt 的 2-5 段（第 1 段 tools、第 6 段 messages 由调用方处理）。
 * 每段拼接规则严格稳定，避免 cache miss。
 */
export async function buildContextSegments(params: Params): Promise<ContextSegments> {
  const { caseId, agentName, userQuery, roleAndFlowTemplate } = params

  // 并行获取所有数据
  const [caseRecord, activeAnalyses, materials, memoryHits] = await Promise.all([
    prisma.cases.findUnique({
      where: { id: caseId },
      select: {
        id: true, title: true, caseTypeId: true, status: true,
        plaintiff: true, defendant: true, summary: true,
        courtName: true,
        firstInstanceCaseNo: true, secondInstanceCaseNo: true,
        firstInstanceJudge: true, secondInstanceJudge: true,
      },
    }),
    prisma.caseAnalyses.findMany({
      where: { caseId, isActive: true, deletedAt: null, NOT: { analysisType: agentName } },
      // M2 阶段不 select summary（字段在 M4 才通过 migration 加入 caseAnalyses 表）
      // M4 上线后：把 select 改为 { analysisType: true, summary: true }，并更新 moduleSummaries 逻辑
      select: { analysisType: true },
      orderBy: { analysisType: 'asc' },
    }),
    getMaterialListWithSummariesService(caseId).catch(() => []),
    recallMemoryService({ caseId, query: userQuery, topK: 5 }).catch(() => []),
  ])

  if (!caseRecord) {
    return { roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '' }
  }

  // ② 角色+流程
  const roleAndFlow = roleAndFlowTemplate ?? ''

  // ③ 案件档案 JSON（字段字典序 + 去空值 → 稳定 cache key）
  const profile = {
    caseId: caseRecord.id,
    caseTypeId: caseRecord.caseTypeId,
    courtName: caseRecord.courtName ?? '',
    defendant: (caseRecord.defendant as string[] | null) ?? [],
    firstInstanceCaseNo: caseRecord.firstInstanceCaseNo ?? '',
    firstInstanceJudge: caseRecord.firstInstanceJudge ?? '',
    plaintiff: (caseRecord.plaintiff as string[] | null) ?? [],
    secondInstanceCaseNo: caseRecord.secondInstanceCaseNo ?? '',
    secondInstanceJudge: caseRecord.secondInstanceJudge ?? '',
    status: caseRecord.status,
    summary: caseRecord.summary ?? '',
    title: caseRecord.title,
  }
  const caseProfile = `## 案件档案\n\`\`\`json\n${JSON.stringify(profile, Object.keys(profile).sort(), 2)}\n\`\`\``

  // ④ 已完成模块摘要
  // M2 阶段：caseAnalyses 无 summary 字段，只列出已完成的分析类型名称作为上下文提示
  // M4 上线后：select 补 summary 字段，把 `### ${a.analysisType}` 改为 `### ${a.analysisType}\n${a.summary}`
  let moduleSummaries = ''
  if (activeAnalyses.length > 0) {
    const lines = ['## 已完成分析模块']
    for (const a of activeAnalyses) {
      lines.push(`### ${a.analysisType}`)
    }
    moduleSummaries = lines.join('\n\n')
  }

  // ⑤ 动态：召回记忆 + 材料清单
  const dynLines: string[] = []
  if (memoryHits.length > 0) {
    dynLines.push('## 相关案件记忆')
    for (const m of memoryHits) {
      dynLines.push(`- ${m.text}`)
    }
  }
  if (materials.length > 0) {
    dynLines.push('\n## 案件材料清单（全文请调用 search_case_materials 工具）')
    for (const mat of materials) {
      const typeLabel = ({ 1: '文本', 2: '文档', 3: '图片', 4: '音频' } as const)[mat.type as 1 | 2 | 3 | 4] ?? '其它'
      dynLines.push(`- **${mat.name}**（${typeLabel}）— ${mat.summary ?? '（摘要生成中）'}`)
    }
  }
  const dynamicContext = dynLines.join('\n')

  return { roleAndFlow, caseProfile, moduleSummaries, dynamicContext }
}

/**
 * 把 4 段映射为 CachedPrompt（供 Anthropic adapter 用）。
 * 段落顺序：roleAndFlow → caseProfile(1h) → moduleSummaries(5m) → dynamicContext（不缓存）。
 */
/**
 * 段落顺序：roleAndFlow(1h) → caseProfile(1h) → moduleSummaries(5m) → dynamicContext（不缓存）
 * Anthropic 要求：长 TTL 段必须先于短 TTL 段；两个 1h 段相邻符合规范。
 */
export function toCachedPrompt(segs: ContextSegments): CachedPrompt {
  const out: CachedPrompt = []
  // 角色+流程规范：来自 NodeConfig 静态配置，内容极稳，1h 缓存
  if (segs.roleAndFlow) out.push({ text: segs.roleAndFlow, cache: { ttl: '1h' } })
  // 案件档案 JSON：字段字典序序列化，字节级稳定，1h 缓存
  if (segs.caseProfile) out.push({ text: segs.caseProfile, cache: { ttl: '1h' } })
  // 已完成模块摘要：每完成一个模块才变，5m 缓存
  if (segs.moduleSummaries) out.push({ text: segs.moduleSummaries, cache: { ttl: '5m' } })
  // 动态内容：召回记忆 + 材料清单，每次对话可能变化，不缓存
  if (segs.dynamicContext) out.push({ text: segs.dynamicContext })
  return out
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run tests/server/moduleContextBuilder.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: 3 passed。

- [ ] **Step 5: 同步改调用方（`caseAnalysisV2.workflow.ts:382`）**

现有代码（`caseAnalysisV2.workflow.ts:382`）：
```ts
const moduleContext = await buildModuleContext({ caseId, agentName, contextWindow })
const enrichedSystemPrompt = [systemPrompt, moduleContext].filter(Boolean).join('\n\n')
const initialMessages = [
  ...(enrichedSystemPrompt ? [{ role: 'system' as const, content: enrichedSystemPrompt }] : []),
  new HumanMessage(`现在请开始"${moduleTitle}"分析。`),
]
```

改为：
```ts
import { buildContextSegments, toCachedPrompt } from './context/moduleContextBuilder'
import { cachedPromptToAnthropicContent, cachedPromptToPlainText } from '../node/chatModelFactory'

// WorkflowState 字段是 prompt（非 userQuery）；nodeConfig.systemPrompt 是角色 prompt 模板
const segs = await buildContextSegments({
  caseId,
  agentName,
  userQuery: state.prompt ?? '',
  roleAndFlowTemplate: nodeConfig.systemPrompt,
})

// 根据供应商决定 system prompt 格式
let systemContent: string | Array<Record<string, unknown>>
if (nodeConfig.sdkType === 'anthropic') {
  const cachedPrompt = toCachedPrompt(segs)
  systemContent = cachedPromptToAnthropicContent(cachedPrompt)
} else {
  // OpenAI / DeepSeek：纯文本拼接
  systemContent = cachedPromptToPlainText(toCachedPrompt(segs))
}

const initialMessages = [
  ...(systemContent ? [{ role: 'system' as const, content: systemContent }] : []),
  new HumanMessage(`现在请开始"${moduleTitle}"分析。`),
]
```

> 同时移除 `moduleContext.middleware.ts` 中对 `getCaseMemory` 的调用（`getCaseMemory` 在旧 `moduleContextBuilder.ts` 里读 basic_info，重构后不再需要）。

- [ ] **Step 6: Commit**

```bash
git add server/services/workflow/context/moduleContextBuilder.ts server/services/workflow/caseAnalysisV2.workflow.ts server/services/workflow/context/moduleContext.middleware.ts tests/server/moduleContextBuilder.test.ts
git commit -m "refactor(context): moduleContextBuilder 重构为 5 段式（ContextSegments）

- 废弃原四层平铺 + token 预算机制
- 新 buildContextSegments 返回 { roleAndFlow, caseProfile, moduleSummaries, dynamicContext }
- caseProfile JSON 字段字典序序列化，保证 cache 命中字节级稳定
- 辅助函数 toCachedPrompt 映射为 Anthropic 两断点（1h + 5m）
- 调用方 caseAnalysisV2.workflow.ts 同步改为新接口
spec §2.1 / §2.2"
```

---

## Task 5: 材料上下文改清单+摘要 + 触发材料摘要生成

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts`
- Modify: `server/services/material/material.service.ts`

- [ ] **Step 1: 定位现有服务**

Run: `grep -n "getMaterialContextService\|MaterialStatus.COMPLETED\|generateEmbeddings" server/services/material/*.ts | head -20`
Expected: 找到现有的材料处理流水线与完成点。

- [ ] **Step 2: 在 material.service.ts 加摘要生成**

在 `server/services/material/material.service.ts` 末尾加：

```ts
import { createChatModel } from '../node/chatModelFactory'
import { generateSummaryService } from '../ai/summaryService'
import { findDocRecognitionByOssFileIdDao } from './mineru.dao'  // 注意：实际在 mineru.dao.ts，不是 ocr.dao.ts

/**
 * 为材料生成 100 字摘要并写入 caseMaterials.summary
 * 触发时机：材料文本就绪（OCR/ASR 完成）之后异步调用
 * 失败不阻塞主流程，仅 logger.warn
 */
export async function generateMaterialSummaryService(materialId: number): Promise<void> {
  try {
    const material = await prisma.caseMaterials.findUnique({
      where: { id: materialId },
      select: { id: true, summary: true, ossFileId: true, type: true },
    })
    if (!material || material.summary) return  // 已有摘要跳过

    // 读原文前 500 字（OCR/ASR 结果已存在其它表，具体按项目现状）
    const content = await loadMaterialText(materialId, 500)
    if (!content) return

    const haiku = createChatModel({
      sdkType: 'anthropic',
      modelName: 'claude-haiku-4-5-20251001',
      apiKey: process.env.ANTHROPIC_API_KEY!,
      streaming: false,
      temperature: 0,
    })
    const summary = await generateSummaryService(haiku, content, { maxChars: 100 })
    await prisma.caseMaterials.update({
      where: { id: materialId },
      data: { summary },
    })
  } catch (e) {
    logger.warn('generateMaterialSummaryService 失败（不阻塞主流程）', { materialId, error: e })
  }
}

/**
 * 读材料正文（从 OCR/ASR 结果 或 type=1 的 content 字段）
 * 现状路径（编码时 grep 验证并按此接入）：
 *   - type=2 文档：ocrResults.text via `server/services/material/recognition.service.ts`
 *   - type=3 图片：同上 OCR
 *   - type=4 音频：asrResults.text
 *   - type=1 文本：caseMaterials.content 字段
 */
async function loadMaterialText(materialId: number, maxChars: number): Promise<string> {
  const m = await prisma.caseMaterials.findUnique({
    where: { id: materialId },
    select: { id: true, type: true, content: true, ossFileId: true },
  })
  if (!m) return ''
  // type=1 直接返回 content 字段
  if (m.type === 1 && m.content) return m.content.slice(0, maxChars)
  // type=2/3 走 OCR 结果（findDocRecognitionByOssFileIdDao 返回 markdownContent）
  if ((m.type === 2 || m.type === 3) && m.ossFileId) {
    const records = await findDocRecognitionByOssFileIdDao(m.ossFileId)
    const text = records?.map((r: any) => r.markdownContent ?? '').join('\n') ?? ''
    return text.slice(0, maxChars)
  }
  // type=4 音频：读 ASR 结果表（编码时确认项目 ASR 结果表名和字段）
  return ''
}
```

> `loadMaterialText` 在实际编码时对接项目现有读文本的入口（`ocr.service.ts` / `asr.service.ts` / `material.dao.ts`，具体以现状为准）。

- [ ] **Step 3: 在 materialPipeline 完成点触发摘要**

在 `materialPipeline.service.ts` 找到"材料状态翻为 COMPLETED（3）"的位置，在该位置之后追加：

```ts
// 触发异步摘要生成（fire-and-forget，失败不阻塞）
import { generateMaterialSummaryService } from './material.service'

// 在 pipeline 完成点：
await prisma.caseMaterials.update({
  where: { id: materialId },
  data: { status: 3 /* COMPLETED */ },
})
// 异步调摘要生成
generateMaterialSummaryService(materialId).catch(() => { /* 已在内部 catch */ })
```

- [ ] **Step 4: 新增 getMaterialListWithSummaries**

在 `materialPipeline.service.ts` 末尾加：

```ts
/**
 * 返回案件材料清单 + 摘要（供 moduleContextBuilder 的 ⑤ 段使用）
 * 不返回全文；全文请通过 search_case_materials 工具按需召回。
 */
export async function getMaterialListWithSummariesService(caseId: number): Promise<Array<{
  id: number
  name: string
  type: number
  summary: string | null
}>> {
  return prisma.caseMaterials.findMany({
    where: { caseId, deletedAt: null, status: 3 /* COMPLETED */ },
    select: { id: true, name: true, type: true, summary: true },
    orderBy: { createdAt: 'asc' },
  })
}
```

- [ ] **Step 5: 废弃原 getMaterialContextService 全量灌入路径**

在 `materialPipeline.service.ts` 把 `getMaterialContextService` 原实现中"返回材料全文"的分支标记为 deprecated 或直接删除；保留 `buildMaterialContextMessage` 如果被其它工具用到则保留，但不再作为 `moduleContextBuilder` 的输入。

- [ ] **Step 6: 类型检查 + 全量单测过**

Run: `npx nuxi typecheck 2>&1 | grep -i "material\|context" | head -10`
Expected: 无错。

Run: `npx vitest run tests/server/moduleContextBuilder.test.ts 2>&1 | tail -10`
Expected: 之前的 3 passed 保持。

- [ ] **Step 7: Commit**

```bash
git add server/services/material/ server/services/workflow/context/moduleContextBuilder.ts
git commit -m "feat(material): 材料上下文改为清单+100字摘要（全文走工具）

- 新增 generateMaterialSummaryService（Haiku 4.5，异步，失败不阻塞）
- materialPipeline 在材料 COMPLETED 时 fire-and-forget 触发
- 新增 getMaterialListWithSummaries 供 moduleContextBuilder ⑤ 段使用
- 原 getMaterialContextService 全量灌入路径废弃
对应 spec §2.4 Q2.1-A 决策"
```

---

## Task 6: 废弃 `basic_info` 记忆写入

**Files:**
- Modify: `server/services/case/caseExtraction.service.ts`

- [ ] **Step 1: 定位 saveCaseInfoService 全部调用点**

Run: `grep -n "saveCaseInfoService" server/ --include="*.ts" -r`
Expected: 找到 3 处调用：
- `caseExtraction.service.ts:46` — AI 抽取时
- `case.service.ts:141` — AI 抽取确认后
- `[caseId].put.ts:87` — API 手动保存时

- [ ] **Step 2: 注释全部 3 处调用点**

对每处：

```ts
// M2 废弃：案件基础信息已通过 cases 表 + extractedInfo 足够表示，
// 不再写 PostgresStore ('cases', caseId, 'basic_info') 避免和案件档案 JSON 重复灌 prompt。
// 存量数据保留不读，后续观察无引用再清理。
```

`saveCaseInfoService` 函数定义不删除。

- [ ] **Step 3: 手工验证**

Run: `grep -n "saveCaseInfoService" server/ --include="*.ts" -r | grep -v "// " | grep -v "async function saveCaseInfoService"`
Expected: 无活跃调用。

- [ ] **Step 4: Commit**

```bash
git add server/services/case/caseExtraction.service.ts
git commit -m "refactor(case): 废弃 basic_info 记忆写入（消除与案件档案重复）

- caseExtraction.service.ts 移除 saveCaseInfoService 调用
- PostgresStore ('cases', id, 'basic_info') 存量保留不读
- 案件档案 JSON（cases 表字段）已在 moduleContextBuilder 第 ③ 段承担
对应 spec §2.5 Q2.4 AI 拍板"
```

---

## Task 7: `case_memories` 表 migration

**Files:**
- Modify: `prisma/models/case.prisma`
- Create: `prisma/migrations/<ts>_add_case_memories/migration.sql`

- [ ] **Step 1: 加 Prisma model**

在 `prisma/models/case.prisma` 末尾加：

```prisma
/// 案件记忆向量表（LangChain PGVectorStore 同构）
/// 写入走 addDocumentsToVectorStore；业务字段放 metadata JSON
/// 注意：此表结构对齐 LangChain 约定，不允许新增查询列（会破坏框架写入）
model caseMemories {
  id        String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  text      String?                  @db.Text
  metadata  Json?
  embedding Unsupported("vector")?
  tsv       Unsupported("tsvector")?

  @@index([tsv], type: Gin, map: "idx_case_memories_tsv")
  @@map("case_memories")
}
```

- [ ] **Step 2: 生成 migration（--create-only，需追加 SQL）**

Run: `bun run prisma:migrate --name add_case_memories --create-only`
Expected: 生成 `prisma/migrations/<ts>_add_case_memories/migration.sql`。

- [ ] **Step 3: 追加手工 SQL**

打开生成的 migration.sql，在 Prisma 自动生成的 CREATE TABLE + GIN index 之后追加：

```sql

-- ==================== M3 case_memories 手工补充 ====================

-- （幂等）确保 zhparser 中文分词配置存在
-- seedData.sql 建过，但 `prisma migrate deploy` 不跑 seed；CI/生产必须在 migration 里幂等建
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
    CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END $$;

-- HNSW 向量索引（pgvector 0.7+ 推荐，比 ivfflat 召回率更高，<10K 表默认参数够用）
CREATE INDEX IF NOT EXISTS "idx_case_memories_embedding"
  ON "case_memories" USING hnsw (embedding vector_cosine_ops);

-- metadata 热查询 expression index
CREATE INDEX IF NOT EXISTS "idx_case_memories_meta_case"
  ON "case_memories" ((metadata->>'caseId'));
CREATE INDEX IF NOT EXISTS "idx_case_memories_meta_subject"
  ON "case_memories" ((metadata->>'caseId'), (metadata->>'subjectKey'))
  WHERE metadata->>'invalidatedAt' IS NULL;
CREATE INDEX IF NOT EXISTS "idx_case_memories_meta_kind"
  ON "case_memories" ((metadata->>'caseId'), (metadata->>'kind'));
```

- [ ] **Step 4: 应用迁移到本地开发库**

Run: `bun run prisma:migrate`
Expected: Applying migration `<ts>_add_case_memories`，成功。

- [ ] **Step 5: 验证表结构**

Run:
```bash
DATABASE_URL="$DATABASE_URL" psql -c "\d case_memories"
```
Expected: 看到 id / text / metadata / embedding / tsv 五列；及 4 个索引（GIN tsv / HNSW embedding / 3 个 expression）。

- [ ] **Step 6: Commit**

```bash
git add prisma/models/case.prisma prisma/migrations/
git commit -m "feat(memory): case_memories 表（LangChain PGVectorStore 同构 schema）

- 5 列：id/text/metadata(jsonb)/embedding(vector)/tsv(tsvector)
- 业务字段（caseId/kind/subjectKey/confidence/source/supersedes/invalidatedAt）全部放 metadata JSON
- HNSW 向量索引 + 3 个 metadata expression index
- 幂等 CREATE TEXT SEARCH CONFIGURATION chinese（防 CI/生产未跑 seed）
spec §3.1 · 严禁新增查询列（会破坏 addDocumentsToVectorStore 写入）"
```

---

## Task 8: `ALLOWED_TABLES` 注册新表 + shared types

**Files:**
- Modify: `server/services/retrieval/types.ts`
- Create: `shared/types/memory.ts`

- [ ] **Step 1: 定位 ALLOWED_TABLES**

Run: `grep -n "ALLOWED_TABLES" server/services/retrieval/types.ts`
Expected: 看到现有 `Set<string>` 定义，含 `case_material_embeddings` / `law_embeddings`。

- [ ] **Step 2: 新增 case_memories + metadata keys + 扩展 RetrievalRequest 类型**

编辑 `server/services/retrieval/types.ts`：

```ts
// ALLOWED_TABLES 加 case_memories
export const ALLOWED_TABLES = new Set<string>([
  'case_material_embeddings',
  'law_embeddings',
  'case_memories',
])

// ALLOWED_METADATA_KEYS 加 case_memories 用的过滤字段
export const ALLOWED_METADATA_KEYS = new Set([
  'legal_id', 'legal_name', 'legal_type', 'article_type',
  'userId', 'sourceId', 'source',
  // case_memories 新增
  'caseId', 'kind', 'subjectKey', 'confidence',
  'supersedes', 'invalidatedAt',
  // case_analysis_embeddings 新增（M4）
  'isActive', 'analysisId', 'analysisType',
])

// RetrievalRequest.type 加 'case_memory'（对应 case_memories 表）
export interface RetrievalRequest {
  query: string
  type: 'law' | 'case_material' | 'case_memory'
  k: number
  metadataFilter?: Record<string, string | number | boolean>
  sourceIds?: string[]
  postFilters?: PostFilters
}
```

> 注意：`RetrievalRequest` 接口的其余字段不变，只修改 `type` 联合类型。

- [ ] **Step 3: 扩展 `hybridSearch.service.ts` 支持 `case_memories`（方案 B）**

编辑 `server/services/retrieval/hybridSearch.service.ts`：

```ts
// 1. extractDocId：加 'case_memory' 分支
export function extractDocId(
  item: SearchResultItem,
  type: 'law' | 'case_material' | 'case_memory',
): string {
  if (type === 'law') {
    return (item.metadata.articles_id as string) || `${item.content.slice(0, 50)}`
  }
  if (type === 'case_memory') {
    // 优先用写入时存入 metadata 的 id；次用 subjectKey+caseId（版本链同主题去重）；最后用内容前缀
    const m = item.metadata as any
    return m?.id ?? (m?.subjectKey ? `${m.caseId}_${m.subjectKey}` : item.content.slice(0, 50))
  }
  return `${item.metadata.sourceId}_${item.metadata.chunkIndex ?? 0}`
}

// 2. reciprocalRankFusion：type 参数放宽
export function reciprocalRankFusion(
  bm25Results: SearchResultItem[],
  vectorResults: SearchResultItem[],
  type: 'law' | 'case_material' | 'case_memory',
  k: number = 60,
): SearchResultItem[] {
  // 实现不变，只是 type 参数 union 扩展
  ...
}

// 3. hybridSearchService：tableName 改用 Map 映射
export async function hybridSearchService(
  intent: IntentClassification,
  request: RetrievalRequest,
): Promise<SearchResultItem[]> {
  const tableNameMap: Record<string, string> = {
    law: 'law_embeddings',
    case_material: 'case_material_embeddings',
    case_memory: 'case_memories',
  }
  const tableName = tableNameMap[request.type] ?? 'case_material_embeddings'
  const searchK = request.k * 3
  const searchQuery = intent.rewrittenQuery || request.query

  const [bm25Results, vectorResults] = await Promise.all([
    fullTextSearchService(tableName, intent.keywords || [], searchK, request.metadataFilter, request.sourceIds),
    vectorSearchService(tableName, searchQuery, searchK, request.metadataFilter, request.sourceIds),
  ])

  return reciprocalRankFusion(bm25Results, vectorResults, request.type)
}
```

> 整个 `hybridSearch.service.ts` 中只需修改这三个函数，其余保持不变。

- [ ] **Step 4: 新建 shared/types/memory.ts**

Create `shared/types/memory.ts`:

```ts
/** 记忆类型 */
export type MemoryKind = 'fact' | 'preference' | 'dialogue_note'

/** 案件记忆 metadata（存在 case_memories.metadata JSONB 里） */
export interface CaseMemoryMetadata {
  /** 行 UUID（和 case_memories.id 列相同），写入时存入 metadata 以供召回时读回 */
  id: string
  /** 案件 ID（硬过滤必需） */
  caseId: number
  /** 记忆类型 */
  kind: MemoryKind
  /** 主题指纹，如 "plaintiff.address"；同主题版本链用 */
  subjectKey?: string
  /** consolidator 抽取置信度 0-1 */
  confidence?: number
  /** 'manual' | 'consolidator' */
  source?: string
  /** 上一版 id */
  supersedes?: string
  /** ISO 时间串，非空即失效 */
  invalidatedAt?: string
  /** ISO 创建时间 */
  createdAt: string
}

/** 召回命中 */
export interface MemoryHit {
  id: string
  text: string
  score: number
  metadata: CaseMemoryMetadata
}
```

- [ ] **Step 5: 类型检查**

Run: `npx nuxi typecheck 2>&1 | head -10`
Expected: 无错。

- [ ] **Step 6: Commit**

```bash
git add server/services/retrieval/types.ts server/services/retrieval/hybridSearch.service.ts shared/types/memory.ts
git commit -m "feat(memory): hybridSearch 支持 case_memories + ALLOWED_TABLES + 新类型

- RetrievalRequest.type 加 'case_memory'，hybridSearchService tableName 改 Map 映射
- extractDocId / reciprocalRankFusion 支持 'case_memory' 类型（RRF 去重用 metadata.id）
- ALLOWED_TABLES 加 case_memories，ALLOWED_METADATA_KEYS 加 caseId/kind/subjectKey 等
- CaseMemoryMetadata / MemoryKind / MemoryHit 类型定义
为 Task 9/10/13 的 memory.service 做准备"
```

---

## Task 9: `writeMemoryService` + 版本链处理（TDD）

**Files:**
- Create: `server/services/memory/memory.service.ts`
- Create: `tests/server/memory/writeMemoryService.test.ts`

- [ ] **Step 1: 写测试（集成测，走测试库）**

Create `tests/server/memory/writeMemoryService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { writeMemoryService } from '~~/server/services/memory/memory.service'

describe('writeMemoryService（集成测 · 需测试库）', () => {
  let testCaseId: number

  beforeEach(async () => {
    // 插入 fixture 案件（依赖 caseTypes 有 id=1 的记录；测试库应由 seedData 准备）
    const c = await prisma.cases.create({
      data: { title: 'test case for memory', userId: 1, caseTypeId: 1 },
    })
    testCaseId = c.id
  })

  afterEach(async () => {
    // 清理
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
      testCaseId.toString(),
    )
    await prisma.cases.delete({ where: { id: testCaseId } })
  })

  it('写入记忆后能查到', async () => {
    const { id } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: '被告承认 2025-08-14 逾期交货',
      source: 'manual',
    })
    expect(id).toBeTruthy()

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, text, metadata FROM case_memories WHERE id = $1::uuid`, id,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('被告承认 2025-08-14 逾期交货')
    expect(rows[0].metadata.caseId).toBe(testCaseId)
  })

  it('同 subjectKey 的新记忆触发旧的 invalidatedAt', async () => {
    const { id: oldId } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: '原告住址：北京',
      subjectKey: 'plaintiff.address',
      source: 'manual',
    })
    const { id: newId } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: '原告住址：上海（2025-08 变更）',
      subjectKey: 'plaintiff.address',
      source: 'manual',
    })

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, metadata FROM case_memories
       WHERE metadata->>'caseId' = $1 AND metadata->>'subjectKey' = 'plaintiff.address'
       ORDER BY metadata->>'createdAt' ASC`,
      testCaseId.toString(),
    )
    expect(rows).toHaveLength(2)
    const oldRow = rows.find((r: any) => r.id === oldId)
    const newRow = rows.find((r: any) => r.id === newId)
    expect(oldRow.metadata.invalidatedAt).toBeTruthy()  // 旧的被打失效
    expect(newRow.metadata.invalidatedAt).toBeUndefined()
    expect(newRow.metadata.supersedes).toBe(oldId)       // 新的指向旧的
  })

  it('tsv 被回填', async () => {
    const { id } = await writeMemoryService({
      caseId: testCaseId,
      kind: 'fact',
      text: '合同约定违约金 10%',
      source: 'manual',
    })
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT tsv IS NOT NULL AS has_tsv FROM case_memories WHERE id = $1::uuid`, id,
    )
    expect(rows[0].has_tsv).toBe(true)
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run tests/server/memory/writeMemoryService.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 失败（服务不存在）。

- [ ] **Step 3: 实现 memory.service.ts 的 writeMemoryService**

Create `server/services/memory/memory.service.ts`:

```ts
import crypto from 'node:crypto'
import { addDocumentsToVectorStore } from '../legal/vectorStore.service'
import type { CaseMemoryMetadata, MemoryHit, MemoryKind } from '#shared/types/memory'

export interface MemoryWriteInput {
  caseId: number
  kind: MemoryKind
  text: string
  subjectKey?: string
  confidence?: number
  source?: 'manual' | 'consolidator'
}

/**
 * 写入记忆。
 * 若带 subjectKey，自动处理版本链：同 subjectKey 的最新未失效记录被打 invalidatedAt；
 * 新记录的 metadata.supersedes 指向被覆盖的旧 id。
 *
 * 操作顺序：先写新记录，再 invalidate 旧记录——避免 INSERT 失败时出现孤立的已失效旧记录。
 * 极端情况（INSERT 成功但 UPDATE 失败）：新旧记录并存，版本链评分（subjectVersionScoring）
 * 会自动将旧记录降权 ×0.3，不影响召回正确性。
 */
export async function writeMemoryService(input: MemoryWriteInput): Promise<{ id: string }> {
  let supersedes: string | undefined

  // 1. 查找同 subjectKey 的最新未失效记录（只查，先不改）
  if (input.subjectKey) {
    const prevRows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT id FROM case_memories
       WHERE metadata->>'caseId' = $1
         AND metadata->>'subjectKey' = $2
         AND (metadata->>'invalidatedAt' IS NULL)
       ORDER BY metadata->>'createdAt' DESC
       LIMIT 1`,
      String(input.caseId), input.subjectKey,
    )
    if (prevRows.length > 0) {
      supersedes = prevRows[0]!.id
    }
  }

  // 2. 走 LangChain PGVectorStore 写入（保持 schema 同构，不能自建 CRUD）
  //    metadata.id 同时存入 metadata，供 extractDocId / retrieveWithReranking 取回
  const newId = crypto.randomUUID()
  const metadata: CaseMemoryMetadata & { id: string } = {
    id: newId,
    caseId: input.caseId,
    kind: input.kind,
    subjectKey: input.subjectKey,
    confidence: input.confidence,
    source: input.source,
    supersedes,
    createdAt: new Date().toISOString(),
  }
  await addDocumentsToVectorStore(
    [{ pageContent: input.text, metadata }],
    [newId],
    { tableName: 'case_memories' },
  )

  // 3. 手工回填 tsv（addDocumentsToVectorStore 不写 tsv）
  await prisma.$executeRawUnsafe(
    `UPDATE case_memories SET tsv = to_tsvector('chinese', COALESCE(text, ''))
     WHERE id = $1::uuid`,
    newId,
  )

  // 4. 版本链：新记录写入成功后，再 invalidate 旧记录
  //    此步骤在 INSERT 之后执行，避免 INSERT 失败时出现孤立的失效记录
  if (supersedes) {
    await prisma.$executeRawUnsafe(
      `UPDATE case_memories
       SET metadata = jsonb_set(metadata, '{invalidatedAt}', to_jsonb($2::text))
       WHERE id = $1::uuid`,
      supersedes,
      new Date().toISOString(),
    )
  }

  return { id: newId }
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run tests/server/memory/writeMemoryService.test.ts --reporter=verbose 2>&1 | tail -15`
Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add server/services/memory/memory.service.ts tests/server/memory/writeMemoryService.test.ts
git commit -m "feat(memory): writeMemoryService 含版本链处理

- 走 addDocumentsToVectorStore（LangChain 同构 schema）
- metadata.id 同步写入 metadata JSON，供召回时 extractDocId/MemoryHit 取回 UUID
- INSERT 先于 invalidate（避免写入失败时出现孤立失效记录）
- 同 subjectKey 新记忆 → 旧记忆 metadata.invalidatedAt 打时间戳
- 新记忆 metadata.supersedes 指向旧 id
- tsv 手工回填到 to_tsvector('chinese', text)
spec §3.2"
```

---

## Task 10: `updateMemoryService`

**Files:**
- Modify: `server/services/memory/memory.service.ts`

- [ ] **Step 1: 在同文件追加 updateMemoryService**

在 `memory.service.ts` 末尾追加：

```ts
/**
 * 更新记忆：改文本 和/或 打失效
 */
export async function updateMemoryService(
  id: string,
  patch: { text?: string; invalidate?: boolean },
): Promise<void> {
  if (patch.text !== undefined) {
    await prisma.$executeRawUnsafe(
      `UPDATE case_memories
       SET text = $2,
           tsv = to_tsvector('chinese', $2)
       WHERE id = $1::uuid`,
      id, patch.text,
    )
  }
  if (patch.invalidate) {
    await prisma.$executeRawUnsafe(
      `UPDATE case_memories
       SET metadata = jsonb_set(metadata, '{invalidatedAt}', to_jsonb($2::text))
       WHERE id = $1::uuid`,
      id, new Date().toISOString(),
    )
  }
}
```

- [ ] **Step 2: 追加测试**

在 `tests/server/memory/writeMemoryService.test.ts` 末尾追加（同文件测试）：

```ts
describe('updateMemoryService', () => {
  it('改文本同时同步 tsv', async () => {
    const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
    const c = await prisma.cases.create({
      data: { title: 'x', userId: 1, caseTypeId: 1 },
    })
    const { id } = await writeMemoryService({
      caseId: c.id, kind: 'fact', text: '原文本', source: 'manual',
    })
    await updateMemoryService(id, { text: '新文本 with 合同' })
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT text, tsv::text AS tsv_text FROM case_memories WHERE id = $1::uuid`, id,
    )
    expect(rows[0].text).toBe('新文本 with 合同')
    expect(rows[0].tsv_text).toContain('合同')
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`, c.id.toString(),
    )
    await prisma.cases.delete({ where: { id: c.id } })
  })

  it('invalidate: true 打失效时间戳', async () => {
    const { updateMemoryService } = await import('~~/server/services/memory/memory.service')
    const c = await prisma.cases.create({
      data: { title: 'x', userId: 1, caseTypeId: 1 },
    })
    const { id } = await writeMemoryService({
      caseId: c.id, kind: 'fact', text: 'x', source: 'manual',
    })
    await updateMemoryService(id, { invalidate: true })
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT metadata FROM case_memories WHERE id = $1::uuid`, id,
    )
    expect(rows[0].metadata.invalidatedAt).toBeTruthy()
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`, c.id.toString(),
    )
    await prisma.cases.delete({ where: { id: c.id } })
  })
})
```

- [ ] **Step 3: 运行测试通过**

Run: `npx vitest run tests/server/memory/writeMemoryService.test.ts 2>&1 | tail -10`
Expected: 5 passed（3 write + 2 update）。

- [ ] **Step 4: Commit**

```bash
git add server/services/memory/memory.service.ts tests/server/memory/writeMemoryService.test.ts
git commit -m "feat(memory): updateMemoryService

- text 更新时同步刷新 tsv
- invalidate=true 时 jsonb_set metadata.invalidatedAt = now
spec §3.2"
```

---

## Task 11: `postProcess.ts` 纯函数 + `retrieveWithReranking` 公共入口（TDD）

**Files:**
- Create: `server/services/memory/postProcess.ts`
- Create: `server/services/memory/retrieveWithReranking.ts`
- Create: `tests/server/memory/postProcess.test.ts`

- [ ] **Step 1: 写测试（纯函数）**

Create `tests/server/memory/postProcess.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { recencyDecay, subjectVersionScoring } from '~~/server/services/memory/postProcess'

describe('recencyDecay', () => {
  it('刚创建返回 1', () => {
    expect(recencyDecay(new Date().toISOString(), 30)).toBeCloseTo(1, 1)
  })
  it('30 天后约 0.5（半衰期）', () => {
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    expect(recencyDecay(past, 30)).toBeGreaterThan(0.45)
    expect(recencyDecay(past, 30)).toBeLessThan(0.55)
  })
})

describe('subjectVersionScoring', () => {
  it('同 subjectKey 旧版降权 ×0.3', () => {
    const hits = [
      { id: '1', text: 'old', score: 0.9, metadata: { caseId: 1, kind: 'fact', subjectKey: 'x', createdAt: '2025-01-01T00:00:00Z' } },
      { id: '2', text: 'new', score: 0.85, metadata: { caseId: 1, kind: 'fact', subjectKey: 'x', createdAt: '2025-08-01T00:00:00Z' } },
    ] as any
    const scored = subjectVersionScoring(hits)
    // new 是 latest，保持高分；old 降权
    const oldHit = scored.find((h) => h.id === '1')!
    const newHit = scored.find((h) => h.id === '2')!
    expect(newHit.score).toBeGreaterThan(oldHit.score)
  })

  it('失效的 score 置 0', () => {
    const hits = [
      { id: '1', text: 'x', score: 0.9, metadata: { caseId: 1, kind: 'fact', invalidatedAt: '2025-08-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' } },
    ] as any
    const scored = subjectVersionScoring(hits)
    expect(scored[0]!.score).toBe(0)
  })
})
```

> **MMR 砍掉说明**：`hybridSearchService` 返回的 `SearchResultItem` 只有 `score/content/metadata`，不含 `embedding` 向量。没有 embedding 数据源 MMR 无法工作（永远走 fallback topK）。reranker 已具备去重效果，MMR 等后续有 embedding 数据源时再加。

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run tests/server/memory/postProcess.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: 失败。

- [ ] **Step 3: 实现 postProcess.ts（无 MMR）**

Create `server/services/memory/postProcess.ts`:

```ts
import type { MemoryHit } from '#shared/types/memory'

/**
 * 时间衰减（以天为单位的半衰期）
 * 公式：0.5 ^ (daysSinceCreated / halfLifeDays)
 */
export function recencyDecay(createdAtISO: string, halfLifeDays: number): number {
  const now = Date.now()
  const created = new Date(createdAtISO).getTime()
  const days = Math.max(0, (now - created) / (24 * 60 * 60 * 1000))
  return Math.pow(0.5, days / halfLifeDays)
}

/**
 * Subject 版本链打分
 * final = base × recencyDecay(30d) × (invalidated ? 0 : 1) × (isLatestInSubject ? 1.0 : 0.3)
 */
export function subjectVersionScoring(hits: MemoryHit[]): MemoryHit[] {
  const latestBySubject = new Map<string, string>()
  for (const h of hits) {
    const key = h.metadata.subjectKey
    if (!key) continue
    const prev = latestBySubject.get(key)
    const prevHit = prev ? hits.find((x) => x.id === prev) : null
    if (!prevHit || h.metadata.createdAt > prevHit.metadata.createdAt) {
      latestBySubject.set(key, h.id)
    }
  }

  return hits.map((h) => {
    const invalidated = !!h.metadata.invalidatedAt
    const hasSubject = !!h.metadata.subjectKey
    const isLatest = !hasSubject || latestBySubject.get(h.metadata.subjectKey!) === h.id
    const decay = recencyDecay(h.metadata.createdAt, 30)
    const versionWeight = isLatest ? 1.0 : 0.3
    const score = invalidated ? 0 : h.score * decay * versionWeight
    return { ...h, score }
  }).sort((a, b) => b.score - a.score)
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run tests/server/memory/postProcess.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: 4 passed。

- [ ] **Step 5: 实现 retrieveWithReranking 公共入口**

Create `server/services/memory/retrieveWithReranking.ts`:

> **重要**：`hybridSearchService(intent, request)` 接收两个对象参数（不是 4 个位置参数），返回 `SearchResultItem[]`（字段为 `content/metadata/score`，无 `id` 和 `embedding`）。需要做字段映射。

```ts
import { hybridSearchService } from '../retrieval/hybridSearch.service'
import { rerankDocuments } from './rerankerClient'
import { subjectVersionScoring } from './postProcess'
import type { MemoryHit, CaseMemoryMetadata } from '#shared/types/memory'
import type { IntentClassification, RetrievalRequest } from '../retrieval/types'

export interface RetrieveInput {
  tableName: string
  query: string
  topK: number
  /** metadata 级别过滤（如 { caseId: 123 } 会映射到 metadataFilter） */
  metadataFilter: Record<string, string | number | boolean>
  /** true 时过滤 metadata.invalidatedAt 非空（默认 true） */
  filterInvalidated?: boolean
  /** true 时走 subject 版本链降权（M3 为 true，M4 用 isActive 代替所以为 false） */
  enableVersionScoring?: boolean
  /** 相似度阈值，默认 0.3 */
  minScore?: number
}

/**
 * M3/M4 共享的召回公共入口（四阶段）：
 *   ①② Hybrid Recall（复用 hybridSearchService）→ ③ pre-filter → ④ rerank → ⑤ 版本链降权
 * reranker 不可达时降级走 hybrid 分数。
 */
export async function retrieveWithReranking(input: RetrieveInput): Promise<MemoryHit[]> {
  const {
    tableName, query, topK, metadataFilter,
    filterInvalidated = true,
    enableVersionScoring = false,
    minScore = 0.3,
  } = input

  // ①② Hybrid Recall
  // 构造 hybridSearchService 所需的 IntentClassification + RetrievalRequest
  const intent: IntentClassification = {
    rewrittenQuery: query,
    keywords: [],
  }
  // tableName → RetrievalRequest.type 映射（Task 8 扩展了 hybridSearch.service.ts 支持 case_memory）
  const typeMap: Record<string, 'law' | 'case_material' | 'case_memory'> = {
    law_embeddings: 'law',
    case_memories: 'case_memory',
  }
  const request: RetrievalRequest = {
    type: typeMap[tableName] ?? 'case_material',
    query,
    k: topK * 3,
    metadataFilter,
  }
  const hybridResults = await hybridSearchService(intent, request)

  // 字段映射：SearchResultItem → MemoryHit
  // SearchResultItem 只有 content/metadata/score，无独立 id 列
  // writeMemoryService 写入时已把 newId 存入 metadata.id，此处直接读取
  const hybridHits: MemoryHit[] = hybridResults.map((r, i) => ({
    id: (r.metadata as any)?.id ?? String(i),  // fallback String(i) 仅在 metadata.id 缺失时触发（不应发生）
    text: r.content,
    score: r.score,
    metadata: r.metadata as CaseMemoryMetadata,
  }))

  // ③ Pre-filter
  const filtered = hybridHits.filter((h) => {
    if ((h.score ?? 0) < minScore) return false
    if (filterInvalidated) {
      if (h.metadata?.invalidatedAt) return false
    }
    return true
  })
  if (filtered.length === 0) return []

  // ④ Rerank（降级：服务不可达 → 跳过）
  let reranked: MemoryHit[]
  try {
    const rerankRes = await rerankDocuments(
      query,
      filtered.slice(0, 20).map((h) => ({ id: h.id, text: h.text })),
    )
    reranked = rerankRes.map((r) => {
      const orig = filtered.find((h) => h.id === r.id)!
      return { ...orig, score: r.score }
    })
  } catch (e) {
    logger.warn('rerankerClient 不可达，降级走 hybrid 分数', { error: e })
    reranked = filtered.slice(0, topK)
  }

  // ⑤ 版本链降权（仅 M3 场景）
  const final = enableVersionScoring ? subjectVersionScoring(reranked) : reranked

  return final.slice(0, topK)
}
```

- [ ] **Step 6: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -i "memory\|retrieve" | head -10`
Expected: 无错。

> 若 `IntentClassification` / `RetrievalRequest` 类型不在 `types.ts` 里导出，先读 `hybridSearch.service.ts` 顶部 import 确认来源，按实际 import 路径调整。

- [ ] **Step 7: Commit**

```bash
git add server/services/memory/postProcess.ts server/services/memory/retrieveWithReranking.ts tests/server/memory/postProcess.test.ts
git commit -m "feat(memory): postProcess 纯函数 + retrieveWithReranking 公共入口

- postProcess: recencyDecay / subjectVersionScoring 两个纯函数
- retrieveWithReranking: 四阶段召回（Hybrid → pre-filter → rerank → versionScoring）
- tableName → request.type 映射：case_memories→'case_memory'（不再误用 case_material）
- SearchResultItem → MemoryHit 字段映射（content→text；id 从 metadata.id 可靠读取）
- reranker 不可达时降级走 hybrid 分数
spec §3.3"
```

---

## Task 12: `rerankerClient` + `docker-compose` 追加 bge-reranker

**Files:**
- Create: `server/services/memory/rerankerClient.ts`
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: 追加 Docker service**

编辑 `docker-compose.dev.yml`，在 services 下追加：

```yaml
  bge-reranker:
    image: ghcr.io/huggingface/text-embeddings-inference:cpu-1.9
    command:
      - --model-id=BAAI/bge-reranker-v2-m3
      - --port=8080
    ports:
      - "8090:8080"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 120s
```

- [ ] **Step 2: 启动服务 + 验证**

Run: `docker compose -f docker-compose.dev.yml up -d bge-reranker`
Expected: 启动成功（首次拉镜像约 2-5 分钟；启动预热约 2-3 分钟）。

Run（等待 3 分钟后）: `curl -sf http://localhost:8090/health | head -5`
Expected: `{"status":"ok"}` 或类似。

Run: `curl -s -X POST http://localhost:8090/rerank -H "Content-Type: application/json" -d '{"query":"测试","texts":["很相关的文本","无关文本"]}'`
Expected: `[{"index":0,"score":0.xxx},{"index":1,"score":0.xxx}]`（按分数倒序返回，`index` 指原 texts 数组位置）。

- [ ] **Step 3: 实现 client**

Create `server/services/memory/rerankerClient.ts`:

```ts
/**
 * TEI bge-reranker-v2-m3 HTTP client
 *
 * 响应格式（TEI 1.9 官方）：`[{ index: number, score: number, text?: string }]`
 * - 数组已按分数倒序，按 `index` 回填原 docs.id
 */
export async function rerankDocuments(
  query: string,
  docs: Array<{ id: string; text: string }>,
): Promise<Array<{ id: string; score: number }>> {
  if (docs.length === 0) return []
  const url = `${process.env.RERANKER_URL ?? 'http://localhost:8090'}/rerank`
  const res = await $fetch<Array<{ index: number; score: number }>>(url, {
    method: 'POST',
    body: { query, texts: docs.map((d) => d.text), raw_scores: false },
    timeout: 5000,
  })
  return res.map((r) => ({ id: docs[r.index]!.id, score: r.score }))
}
```

- [ ] **Step 4: 环境变量 + 补文档**

编辑 `.env.example`（或项目环境变量说明文件）追加：
```
# bge-reranker TEI 服务 (M3)
RERANKER_URL=http://localhost:8090
```

- [ ] **Step 5: 删除 Task 11 的 stub（如有）**

删掉 `retrieveWithReranking.ts` 顶部的 `async function rerankDocuments` 桩（若 Task 11 加了），改为正确的 import：

```ts
import { rerankDocuments } from './rerankerClient'
```

- [ ] **Step 6: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -i "reranker\|memory" | head -10`
Expected: 无错。

- [ ] **Step 7: Commit**

```bash
git add docker-compose.dev.yml server/services/memory/rerankerClient.ts server/services/memory/retrieveWithReranking.ts .env.example
git commit -m "feat(memory): bge-reranker-v2-m3 Docker 服务 + rerankerClient

- docker-compose.dev.yml 新增 bge-reranker service（TEI 1.9 CPU 镜像，带 healthcheck）
- rerankerClient: POST /rerank body { query, texts, raw_scores:false }，按 index 回填 id
- RERANKER_URL 环境变量
- retrieveWithReranking 的 stub 已替换为真实 import
spec §3.6"
```

---

## Task 13: `recallMemoryService`（TDD）

**Files:**
- Modify: `server/services/memory/memory.service.ts`
- Create: `tests/server/memory/recallMemoryService.test.ts`

- [ ] **Step 1: 写测试（集成测，走测试库 + mock reranker）**

Create `tests/server/memory/recallMemoryService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { writeMemoryService } from '~~/server/services/memory/memory.service'

// Mock reranker 服务
vi.mock('~~/server/services/memory/rerankerClient', () => ({
  rerankDocuments: vi.fn((_q, docs) =>
    Promise.resolve(docs.map((d: any, i: number) => ({ id: d.id, score: 1 - i * 0.01 }))),
  ),
}))

describe('recallMemoryService（集成测）', () => {
  let caseId: number
  beforeEach(async () => {
    const c = await prisma.cases.create({ data: { title: 'x', userId: 1, caseTypeId: 1 } })
    caseId = c.id
  })
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`, caseId.toString(),
    )
    await prisma.cases.delete({ where: { id: caseId } })
    vi.clearAllMocks()
  })

  it('按 query 语义召回（至少返回匹配记忆）', async () => {
    await writeMemoryService({ caseId, kind: 'fact', text: '合同约定 6 月前交付违约金 10%', source: 'manual' })
    await writeMemoryService({ caseId, kind: 'fact', text: '原告住址在北京朝阳', source: 'manual' })

    const { recallMemoryService } = await import('~~/server/services/memory/memory.service')
    const hits = await recallMemoryService({ caseId, query: '违约金' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.text).toContain('违约金')
  })

  it('caseId 硬过滤：不跨案件', async () => {
    const otherCase = await prisma.cases.create({ data: { title: 'other', userId: 1, caseTypeId: 1 } })
    await writeMemoryService({ caseId, kind: 'fact', text: 'case A memory', source: 'manual' })
    await writeMemoryService({ caseId: otherCase.id, kind: 'fact', text: 'case B memory', source: 'manual' })

    const { recallMemoryService } = await import('~~/server/services/memory/memory.service')
    const hits = await recallMemoryService({ caseId, query: 'memory' })
    expect(hits.every((h) => h.metadata.caseId === caseId)).toBe(true)

    // 清理
    await prisma.$executeRawUnsafe(
      `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`, otherCase.id.toString(),
    )
    await prisma.cases.delete({ where: { id: otherCase.id } })
  })

  it('includeInvalidated=false（默认）过滤失效记忆', async () => {
    const { id } = await writeMemoryService({
      caseId, kind: 'fact', text: '旧事实', subjectKey: 's1', source: 'manual',
    })
    await writeMemoryService({
      caseId, kind: 'fact', text: '新事实', subjectKey: 's1', source: 'manual',
    })
    // 旧的被 invalidate

    const { recallMemoryService } = await import('~~/server/services/memory/memory.service')
    const hits = await recallMemoryService({ caseId, query: '事实' })
    expect(hits.every((h) => h.id !== id)).toBe(true)
  })

  it('includeInvalidated=true 时能看到失效的', async () => {
    await writeMemoryService({ caseId, kind: 'fact', text: '旧', subjectKey: 's2', source: 'manual' })
    await writeMemoryService({ caseId, kind: 'fact', text: '新', subjectKey: 's2', source: 'manual' })

    const { recallMemoryService } = await import('~~/server/services/memory/memory.service')
    const hitsAll = await recallMemoryService({
      caseId, query: '新或旧', includeInvalidated: true,
    })
    expect(hitsAll.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run tests/server/memory/recallMemoryService.test.ts 2>&1 | tail -20`
Expected: 失败（recallMemoryService 未定义）。

- [ ] **Step 3: 实现**

在 `server/services/memory/memory.service.ts` 末尾追加：

```ts
import { retrieveWithReranking } from './retrieveWithReranking'
import type { MemoryHit, MemoryKind } from '#shared/types/memory'

export async function recallMemoryService(params: {
  caseId: number
  query: string
  kind?: MemoryKind
  topK?: number
  includeInvalidated?: boolean
}): Promise<MemoryHit[]> {
  const { caseId, query, kind, topK = 5, includeInvalidated = false } = params

  const metadataFilter: Record<string, string | number | boolean> = { caseId }
  if (kind) metadataFilter.kind = kind

  return retrieveWithReranking({
    tableName: 'case_memories',
    query,
    topK,
    metadataFilter,
    filterInvalidated: !includeInvalidated,
    enableVersionScoring: true,
  })
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/server/memory/recallMemoryService.test.ts 2>&1 | tail -15`
Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add server/services/memory/memory.service.ts tests/server/memory/recallMemoryService.test.ts
git commit -m "feat(memory): recallMemoryService 走 retrieveWithReranking 公共入口

入参 { caseId, query, kind?, topK?=5, includeInvalidated?=false }
- caseId 硬过滤（Agent 不跨案件）
- kind 可选细分
- includeInvalidated=true 放开失效过滤，用于历史版本链查询（O32 拍板）
spec §3.2 §3.3"
```

---

## Task 14: 三个 Agent 工具

**Files:**
- Create: `server/services/workflow/tools/search_case_memory.tool.ts`
- Create: `server/services/workflow/tools/write_case_memory.tool.ts`
- Create: `server/services/workflow/tools/update_case_memory.tool.ts`
- Modify: `server/services/workflow/tools/index.ts`

- [ ] **Step 1: search_case_memory**

Create `server/services/workflow/tools/search_case_memory.tool.ts`:

```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { recallMemoryService } from '../../memory/memory.service'
import type { ToolContext } from './types'

export const toolDefinition = {
  name: 'search_case_memory',
  description: '语义检索当前案件的长期记忆（事实/偏好/对话要点）。当需要回忆之前讨论过的内容、用户偏好、或已抽取的事实时调用。',
  schema: z.object({
    query: z.string().describe('检索关键词或问题'),
    kind: z.enum(['fact', 'preference', 'dialogue_note']).optional(),
    top_k: z.number().default(5),
    include_history: z.boolean().default(false)
      .describe('是否放开已失效记忆（仅在用户明确问"之前/历史/曾经/当初"等时序追溯问题时设为 true）'),
  }),
}

export function createTool(context: ToolContext) {
  return tool(async ({ query, kind, top_k, include_history }) => {
    if (!context.caseId) return JSON.stringify({ error: '未绑定案件，无法检索记忆' })
    const hits = await recallMemoryService({
      caseId: context.caseId,
      query,
      kind,
      topK: top_k,
      includeInvalidated: include_history,
    })
    return JSON.stringify(hits.map((h) => ({
      id: h.id,
      text: h.text,
      score: h.score.toFixed(3),
      kind: h.metadata.kind,
      createdAt: h.metadata.createdAt,
    })))
  }, toolDefinition)
}
```

- [ ] **Step 2: write_case_memory**

Create `server/services/workflow/tools/write_case_memory.tool.ts`:

```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { writeMemoryService } from '../../memory/memory.service'
import { CaseStatus } from '#shared/types/case'
import type { ToolContext } from './types'

export const toolDefinition = {
  name: 'write_case_memory',
  description: '把一条事实、用户偏好或对话要点写入当前案件的长期记忆。适用于用户明确表达的偏好、从对话中确认的关键事实、或需要未来回忆的笔记。',
  schema: z.object({
    text: z.string().describe('记忆正文'),
    kind: z.enum(['fact', 'preference', 'dialogue_note']),
    subject_key: z.string().optional().describe('主题指纹，如 "plaintiff.address"；同主题新事实覆盖旧（版本链）'),
  }),
}

export function createTool(context: ToolContext) {
  return tool(async ({ text, kind, subject_key }) => {
    if (!context.caseId) return JSON.stringify({ error: '未绑定案件，无法写入记忆' })
    // ARCHIVED 守卫
    const caseRecord = await prisma.cases.findUnique({
      where: { id: context.caseId },
      select: { status: true },
    })
    if (caseRecord?.status === CaseStatus.ARCHIVED) {
      return JSON.stringify({ error: '案件已归档，不可写入新记忆' })
    }

    const { id } = await writeMemoryService({
      caseId: context.caseId, kind, text, subjectKey: subject_key, source: 'manual',
    })
    return JSON.stringify({ id, ok: true })
  }, toolDefinition)
}
```

- [ ] **Step 3: update_case_memory**

Create `server/services/workflow/tools/update_case_memory.tool.ts`:

```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { updateMemoryService } from '../../memory/memory.service'
import { CaseStatus } from '#shared/types/case'
import type { ToolContext } from './types'

export const toolDefinition = {
  name: 'update_case_memory',
  description: '更新一条已有记忆的文本，或将其标记为失效（软删除）。',
  schema: z.object({
    id: z.string().uuid(),
    text: z.string().optional(),
    invalidate: z.boolean().default(false),
  }),
}

export function createTool(context: ToolContext) {
  return tool(async ({ id, text, invalidate }) => {
    if (!context.caseId) return JSON.stringify({ error: '未绑定案件，无法修改记忆' })
    // ARCHIVED 守卫
    const caseRecord = await prisma.cases.findUnique({
      where: { id: context.caseId },
      select: { status: true },
    })
    if (caseRecord?.status === CaseStatus.ARCHIVED) {
      return JSON.stringify({ error: '案件已归档，不可修改记忆' })
    }

    await updateMemoryService(id, { text, invalidate })
    return JSON.stringify({ ok: true })
  }, toolDefinition)
}
```

- [ ] **Step 4: 注册到 tools/index.ts**

打开 `server/services/workflow/tools/index.ts`，在 `toolModules` 映射表追加：

```ts
// ... 现有注册 ...
import * as searchCaseMemory from './search_case_memory.tool'
import * as writeCaseMemory from './write_case_memory.tool'
import * as updateCaseMemory from './update_case_memory.tool'

export const toolModules: Record<string, ToolModule> = {
  // ... 现有 ...
  search_case_memory: searchCaseMemory,
  write_case_memory: writeCaseMemory,
  update_case_memory: updateCaseMemory,
}
```

- [ ] **Step 5: 类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -i "memory\|tool" | head -20`
Expected: 无错。

- [ ] **Step 6: Commit**

```bash
git add server/services/workflow/tools/
git commit -m "feat(tools): 新增 search/write/update_case_memory 三个 Agent 工具

- search_case_memory: query + kind? + top_k + include_history
- write_case_memory: text + kind + subject_key?，ARCHIVED 守卫
- update_case_memory: id + text? + invalidate?，ARCHIVED 守卫
- 注册到 toolModules 供 Agent 动态加载
spec §3.4 · O32 include_history 参数已拍板"
```

---

## Task 15: `consolidator` 异步队列（ZSET + CronScheduler）

**Files:**
- Create: `server/services/memory/consolidator.service.ts`
- Create: `tests/server/memory/consolidator.test.ts`

- [ ] **Step 1: 写测试**

Create `tests/server/memory/consolidator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/lib/redis', () => ({
  getRedisClient: () => ({
    zadd: vi.fn().mockResolvedValue(1),
    zrangebyscore: vi.fn().mockResolvedValue([]),
    zrem: vi.fn().mockResolvedValue(1),
  }),
}))

describe('consolidator · schedule + drain', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('schedule 将 sessionId 写入 Redis ZSET，score 为 now+30s', async () => {
    const { scheduleConsolidation } = await import('~~/server/services/memory/consolidator.service')
    const { getRedisClient } = await import('~~/server/lib/redis')
    const redis = getRedisClient() as any

    const beforeMs = Date.now()
    await scheduleConsolidation({ caseId: 1, sessionId: 'sess-x' })
    const [[dueAt, sessionId]] = redis.zadd.mock.calls
    expect(sessionId).toBe('sess-x')
    expect(dueAt).toBeGreaterThanOrEqual(beforeMs + 30 * 1000 - 100)
    expect(dueAt).toBeLessThanOrEqual(beforeMs + 30 * 1000 + 100)
  })

  it('schedule 重复调用会覆盖同 sessionId 的 score（debounce）', async () => {
    const { scheduleConsolidation } = await import('~~/server/services/memory/consolidator.service')
    const { getRedisClient } = await import('~~/server/lib/redis')
    const redis = getRedisClient() as any

    await scheduleConsolidation({ caseId: 1, sessionId: 'sess-y' })
    await new Promise((r) => setTimeout(r, 50))
    await scheduleConsolidation({ caseId: 1, sessionId: 'sess-y' })

    expect(redis.zadd).toHaveBeenCalledTimes(2)
    // 两次都用同一 sessionId；Redis ZADD 会覆盖分数
  })

  it('drainDueSessions 调 zrangebyscore + zrem', async () => {
    const { drainDueSessions } = await import('~~/server/services/memory/consolidator.service')
    const { getRedisClient } = await import('~~/server/lib/redis')
    const redis = getRedisClient() as any
    redis.zrangebyscore.mockResolvedValue(['sess-due-1', 'sess-due-2'])

    const due = await drainDueSessions()
    expect(due).toEqual(['sess-due-1', 'sess-due-2'])
    expect(redis.zrem).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npx vitest run tests/server/memory/consolidator.test.ts 2>&1 | tail -15`
Expected: 失败。

- [ ] **Step 3: 实现 consolidator.service.ts**

Create `server/services/memory/consolidator.service.ts`:

```ts
import { z } from 'zod'
import { getRedisClient } from '~~/server/lib/redis'
import { createChatModel } from '../node/chatModelFactory'
import { writeMemoryService } from './memory.service'

const DEBOUNCE_MS = 30 * 1000
const QUEUE_KEY = 'consolidator:due'

/**
 * 调度一次 consolidator 运行（debounce 30s）
 * 同 sessionId 重复调用会覆盖 score，自然实现防重频
 */
export async function scheduleConsolidation(params: {
  caseId: number
  sessionId: string
}): Promise<void> {
  const redis = getRedisClient()
  const dueAt = Date.now() + DEBOUNCE_MS
  await redis.zadd(QUEUE_KEY, dueAt, params.sessionId)
}

/**
 * 取出所有已到期的 session（由 CronScheduler 每 10s 调用一次）
 */
export async function drainDueSessions(): Promise<string[]> {
  const redis = getRedisClient()
  const now = Date.now()
  const ids: string[] = await redis.zrangebyscore(QUEUE_KEY, 0, now)
  for (const id of ids) await redis.zrem(QUEUE_KEY, id)
  return ids
}

/**
 * 对单个 session 做 consolidation：
 *   1. 加载最近 N 条 messages
 *   2. Haiku 4.5 按 schema 抽取 fact/preference/dialogue_note
 *   3. 置信度 < 0.6 丢弃
 *   4. 调 writeMemoryService 批量写入
 *   5. 失败 best-effort logger.warn，不抛
 */
export async function consolidateSession(sessionId: string): Promise<void> {
  try {
    const session = await prisma.caseSessions.findUnique({
      where: { sessionId },
      select: { caseId: true, scope: true },
    })
    if (!session?.caseId) return

    // 1. 取最近 N 条消息（从 workflow 的 checkpoint 或 agent_messages 视项目现状决定）
    const messages = await loadRecentAgentMessages(sessionId, 20)
    if (messages.length === 0) return

    // 2. Haiku 4.5 结构化抽取
    const haiku = createChatModel({
      sdkType: 'anthropic',
      modelName: 'claude-haiku-4-5-20251001',
      apiKey: process.env.ANTHROPIC_API_KEY!,
      streaming: false,
      temperature: 0,
    })

    const schema = z.object({
      facts: z.array(z.object({
        subjectKey: z.string(),
        text: z.string(),
        confidence: z.number().min(0).max(1),
      })),
      preferences: z.array(z.object({
        text: z.string(),
        confidence: z.number().min(0).max(1),
      })),
      dialogueNotes: z.array(z.object({ text: z.string() })),
    })

    const extractPrompt = buildExtractPrompt(messages)
    const extracted = await haiku.withStructuredOutput(schema).invoke(extractPrompt)

    // 3. 过滤低置信度 + 4. 写入
    for (const f of extracted.facts) {
      if (f.confidence < 0.6) continue
      await writeMemoryService({
        caseId: session.caseId,
        kind: 'fact',
        text: f.text,
        subjectKey: f.subjectKey,
        confidence: f.confidence,
        source: 'consolidator',
      })
    }
    for (const p of extracted.preferences) {
      if (p.confidence < 0.6) continue
      await writeMemoryService({
        caseId: session.caseId,
        kind: 'preference',
        text: p.text,
        confidence: p.confidence,
        source: 'consolidator',
      })
    }
    for (const n of extracted.dialogueNotes) {
      await writeMemoryService({
        caseId: session.caseId,
        kind: 'dialogue_note',
        text: n.text,
        source: 'consolidator',
      })
    }
  } catch (e) {
    logger.warn('consolidator run 失败（best-effort，下轮自动重试）', { sessionId, error: e })
  }
}

// 辅助：加载最近消息（从 LangGraph checkpoint 读取 messages 通道）
async function loadRecentAgentMessages(sessionId: string, limit: number): Promise<Array<{ role: string; content: string }>> {
  const store = await getStore()
  // checkpoint 存储键：['cases', caseId] 通道：sessionId
  // 编码时根据项目 LangGraph checkpoint 结构调整
  const allSessions = await store.search(['cases'], { limit: 100 })
  // 找到匹配 sessionId 的 checkpoint，读其 messages channel
  // 具体路径视项目 checkpointer 实现；通常 checkpoint.values?.messages
  // 编码时读 caseAnalysisV2.workflow.ts 用的 checkpoint 存储方式对接
  const messages: any[] = [] // 编码时对接实际 checkpoint 读取
  return messages
    .filter((m: any) => m.getType() === 'human' || m.getType() === 'ai')
    .slice(-limit)
    .map((m: any) => ({
      role: m.getType(),
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }))
}

function buildExtractPrompt(messages: Array<{ role: string; content: string }>): string {
  const joined = messages.map((m) => `[${m.role}] ${m.content}`).join('\n')
  return `从下面律师与 AI 助手的对话中抽取用户侧的：
1. 事实（facts）：客观信息，每条配 subjectKey（主题指纹，如 "plaintiff.address"）+ confidence 0-1
2. 偏好（preferences）：用户对输出/流程的偏好
3. 对话要点（dialogueNotes）：其它值得记住的上下文

对话内容：
${joined}

仅输出符合 schema 的 JSON；不要编造；confidence 低于 0.6 的不要输出。`
}
```

- [ ] **Step 4: 注册到现有 CronScheduler**

复用 `server/utils/cron.ts` 的 `CronScheduler` class（不新建插件）。

在 `server/plugins/cron-scheduler.ts` 里已有 `scheduler.register(...)` 调用列表，追加一条：

```ts
import { drainDueSessions, consolidateSession } from '~/server/services/memory/consolidator.service'

// 在现有 scheduler.register 调用列表末尾追加：
scheduler.register({
  name: 'consolidator-drain',
  intervalMs: 10_000,
  lockTtlSeconds: 5,
  fn: async () => {
    const dueSessions = await drainDueSessions()
    for (const sessionId of dueSessions) {
      consolidateSession(sessionId).catch(() => {})  // fire-and-forget
    }
  },
})
```

> 编码时确认 `CronScheduler.register` 的参数名（`intervalMs` / `lockTtlSeconds` / `fn`）与 `server/utils/cron.ts` 一致。

- [ ] **Step 5: 运行测试**

Run: `npx vitest run tests/server/memory/consolidator.test.ts 2>&1 | tail -10`
Expected: 3 passed。

- [ ] **Step 6: Commit**

```bash
git add server/services/memory/consolidator.service.ts server/plugins/cron-scheduler.ts tests/server/memory/consolidator.test.ts
git commit -m "feat(memory): consolidator 异步队列 + Haiku 4.5 抽取

- scheduleConsolidation: ZADD consolidator:due <now+30s> <sessionId>（重复覆盖实现 debounce）
- drainDueSessions: ZRANGEBYSCORE 0 now + ZREM 批量出队
- consolidateSession: Haiku 4.5 withStructuredOutput 抽取 fact/preference/dialogueNote
- 置信度 <0.6 丢弃；失败 logger.warn 不抛
- consolidator-worker Nitro 插件每 10s 扫一次
spec §3.5 Q3.1-B"
```

---

## Task 16: 对话结束触发 consolidator

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts`

- [ ] **Step 1: 定位现有对话结束点**

Run: `sed -n '100,160p' server/api/v1/case/analysis/chat.post.ts`
Expected: 找到 SSE 流结束或 agentRun completion 的回调。

- [ ] **Step 2: 触发 scheduleConsolidation**

在对话结束（返回 response / SSE 关闭前）的位置追加：

```ts
import { scheduleConsolidation } from '~/server/services/memory/consolidator.service'

// 对话流结束后（成功或失败都调；consolidator 失败自己兜底）
scheduleConsolidation({ caseId, sessionId })
  .catch((e) => logger.warn('scheduleConsolidation 失败', { sessionId, error: e }))
```

> 具体位置：chat.post.ts 里 `onClose` / `finalizeRun` / streaming 结束处。

- [ ] **Step 3: 手工验证**

Run: `bun dev &`
打开一个案件对话，随便聊两轮，观察日志：
```
# 应看到 consolidator worker 在 30s 后触发抽取
```

Run: `docker exec -it <redis-container> redis-cli ZRANGE consolidator:due 0 -1 WITHSCORES`
Expected: 能看到 sessionId + 对应 score（未到期时显示）。

- [ ] **Step 4: Commit**

```bash
git add server/api/v1/case/analysis/chat.post.ts
git commit -m "feat(memory): 对话结束触发 consolidator.schedule

每轮对话结束都 fire-and-forget 入队；同 sessionId 会被 debounce 30s 合并。
spec §3.5"
```

---

## Task 17: E2E 手工验收清单

**Files:**
- Create: `docs/superpowers/plans/m2-m3-e2e-checklist.md`

- [ ] **Step 1: 建验收单**

Create `docs/superpowers/plans/m2-m3-e2e-checklist.md`:

```markdown
# M2+M3 · E2E 手工验收清单

## M2 · 5 段式 prompt + Caching
- [ ] 第 3 段（案件档案 JSON）在刷新/切模块时**字节级完全一致**（无时间戳/随机值）
- [ ] Anthropic 模型第二次请求 `usage.cache_read_input_tokens` > 0（命中缓存）
- [ ] OpenAI 模型第二次请求 `usage.prompt_tokens_details.cached_tokens` > 0
- [ ] DeepSeek 模型第二次请求 `usage.prompt_cache_hit_tokens` > 0
- [ ] 材料上下文只出现在第 ⑤ 段（清单 + 100 字摘要），**不塞全文**
- [ ] 材料上传完成后 5-10 秒内 `caseMaterials.summary` 字段有值
- [ ] 对话触发 `search_case_materials` 工具能正常召回片段

## M3 · 记忆工具链
- [ ] 首次对话后 30-60 秒，`case_memories` 表里有新记录（source='consolidator'）
- [ ] 确实抽取出事实/偏好（confidence >= 0.6）
- [ ] Agent 调用 `search_case_memory({ query: '...' })` 返回合理结果
- [ ] Agent 调用 `write_case_memory({ text, kind })` 成功写入（检查表）
- [ ] Agent 调用 `update_case_memory({ id, invalidate: true })` 后，该记忆 metadata.invalidatedAt 有值
- [ ] 同 subjectKey 的新记忆进入，旧记忆被自动 invalidate（版本链）
- [ ] `search_case_memory({ include_history: true })` 能看到失效记忆
- [ ] `include_history: false` 过滤失效记忆

## 权限/隔离
- [ ] ARCHIVED 案件调 `write_case_memory` 返回错误消息
- [ ] ARCHIVED 案件调 `update_case_memory` 返回错误消息
- [ ] 案件 A 的 Agent 不能检索到案件 B 的记忆（caseId 硬过滤）

## Reranker 降级
- [ ] 停掉 bge-reranker 容器（`docker stop bge-reranker`），召回仍能返回结果（降级走 hybrid 分数）
- [ ] 日志出现 `rerankerClient 不可达，降级走 hybrid 分数` warn

## 中文分词
- [ ] 重新执行 `prisma migrate reset` + `prisma migrate deploy` 后，`chinese` 配置仍可用
- [ ] 全中文记忆能被中文 query BM25 召回（如"合同违约"能命中"违约金"记忆）
```

- [ ] **Step 2: 全量单测**

Run: `npx vitest run tests/server/summaryService tests/server/moduleContextBuilder tests/server/memory --reporter=verbose 2>&1 | tail -30`
Expected: 全部通过。

- [ ] **Step 3: 按清单手工 E2E**

逐项验证。每通过一项打勾。

- [ ] **Step 4: 最终 Commit**

```bash
git add docs/superpowers/plans/m2-m3-e2e-checklist.md
git commit -m "docs(memory): M2+M3 合并发布 E2E 手工验收清单

5 大场景：5 段 Caching / 记忆工具链 / ARCHIVED 守卫 / Reranker 降级 / 中文分词。
合并发布前必须逐项通过。"
```

---

## 附录 · 关键文件全景

```
shared/types/
├── prompt.ts                                           [新建] PromptSegment / CachedPrompt
└── memory.ts                                           [新建] CaseMemoryMetadata / MemoryHit / MemoryKind

prisma/
├── models/case.prisma                                  [修改] 加 caseMemories model
└── migrations/<ts>_add_case_memories/                  [新建] 含 chinese 配置幂等建 + HNSW + expression index

server/services/ai/
└── summaryService.ts                                   [新建] generateSummary helper

server/services/memory/
├── memory.service.ts                                   [新建] write/update/recall
├── postProcess.ts                                      [新建] recencyDecay/subjectVersionScoring/mmrFilter
├── retrieveWithReranking.ts                            [新建] M3/M4 共享召回入口
├── rerankerClient.ts                                   [新建] TEI /rerank client
└── consolidator.service.ts                             [新建] schedule/drain/consolidate

server/services/material/
├── materialPipeline.service.ts                         [修改] 清单+摘要 + 摘要触发
└── material.service.ts                                 [修改] generateMaterialSummaryService

server/services/workflow/
├── context/moduleContextBuilder.ts                     [修改] 5 段式 buildContextSegments
└── tools/
    ├── search_case_memory.tool.ts                      [新建]
    ├── write_case_memory.tool.ts                       [新建]
    ├── update_case_memory.tool.ts                      [新建]
    └── index.ts                                        [修改] 注册 3 工具

server/services/retrieval/
└── types.ts                                            [修改] ALLOWED_TABLES 加 case_memories

server/services/case/
└── caseExtraction.service.ts                           [修改] 移除 saveCaseInfoService 调用

server/services/node/
└── chatModelFactory.ts                                 [修改] CachedPrompt 支持 + 3 家响应字段日志

server/api/v1/case/analysis/
└── chat.post.ts                                        [修改] 对话结束 scheduleConsolidation

server/plugins/
└── cron-scheduler.ts                                   [修改] 追加 consolidator-drain 定时任务

docker-compose.dev.yml                                  [修改] bge-reranker service

tests/server/
├── summaryService.test.ts                              [新建]
├── moduleContextBuilder.test.ts                        [新建]
└── memory/
    ├── writeMemoryService.test.ts                      [新建]
    ├── recallMemoryService.test.ts                     [新建]
    ├── postProcess.test.ts                             [新建]
    └── consolidator.test.ts                            [新建]

docs/superpowers/plans/
└── m2-m3-e2e-checklist.md                              [新建]
```

---

## 铁律核验（编码时逐条检查）

- [ ] `case_memories` 严格 LangChain PGVectorStore 同构 schema（id/text/metadata/embedding/tsv），**严禁新增查询列**
- [ ] 写入走 `addDocumentsToVectorStore(docs, ids, { tableName })`（参数顺序！），且 **metadata.id 必须存入 metadata JSON** 以便召回时取回 UUID
- [ ] 查询走 `hybridSearchService(intent, request)`（两个对象参数，不是 4 个位置参数！），`request.type` 用 `'case_memory'`（不是 `'case_material'`）
- [ ] `ALLOWED_TABLES` + `ALLOWED_METADATA_KEYS` + `RetrievalRequest.type` 都必须注册新表和字段
- [ ] 召回 query 始终硬过滤 `caseId`（`metadataFilter.caseId`）
- [ ] `write_case_memory` / `update_case_memory` 服务端 check `case.status !== ARCHIVED`
- [ ] Anthropic 1h TTL 显式传 `{ type: 'ephemeral', ttl: '1h' }`；5m 默认只传 `{ type: 'ephemeral' }` 不传 ttl
- [ ] `caseProfile` JSON 字段字典序序列化
- [ ] consolidator 注册到现有 CronScheduler（不新建插件）；失败 `logger.warn`，不抛不熔断
- [ ] bge-reranker 不可达时降级走 hybrid 分数
- [ ] 每张新表 migration 必须幂等 `CREATE TEXT SEARCH CONFIGURATION chinese`
- [ ] 测试 import prisma 从 `~~/server/utils/db`（具名 `{ prisma }`），不是 `~~/server/utils/prisma`
- [ ] 函数名一律 Service 后缀（generateSummaryService / getMaterialListWithSummariesService）
- [ ] 工具文件复用 `tools/types.ts` 的 ToolContext（不重定义）
