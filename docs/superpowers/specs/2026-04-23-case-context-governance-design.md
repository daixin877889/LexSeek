# 案件上下文治理改造（M1-M4）总设计

- **日期**：2026-04-23
- **范围**：小索场景下的案件上下文全链路治理，覆盖 ① 案件字段+状态扩展 ② 上下文去重+Prompt Caching 分段 ③ 记忆工具化+自动提取+召回 pipeline ④ 分析产物摘要+RAG 检索
- **不涉及**：子 Agent 消息可视化（已另行立项 `2026-04-23-sub-agent-chain-of-thought-design.md`）；Graph 记忆（Zep Graphiti，评估后搁置）；Prompt 压缩（LLMLingua，法律文本敏感不适用）

## 0. 四子系统一张图

```
┌──────────────────────────────────────────────────────────────┐
│  M1 · 案件字段 + 状态扩展（数据模型底座）                     │
│   cases 表新 5 字段 + 状态 6 档 + 表单/AI 双路回填            │
└──────────────────────────────────────────────────────────────┘
                    ↓ 新字段进入案件档案 JSON
┌──────────────────────────────────────────────────────────────┐
│  M2 · 上下文去重 + Prompt Caching 分段                       │
│   moduleContextBuilder 5 段化 + 三家供应商 caching           │
│   废弃 basic_info 冗余记忆、材料只传清单+摘要                │
└──────────────────────────────────────────────────────────────┘
                    ↓ 召回结果进第 ⑤ 段（动态）
┌──────────────────────────────────────────────────────────────┐
│  M3 · 记忆工具化 + 自动提取 + 召回 pipeline                  │
│   case_memories 表 + 3 工具 + consolidator + 6 阶段召回      │
└──────────────────────────────────────────────────────────────┘
                    ↓ 复用同一召回 pipeline
┌──────────────────────────────────────────────────────────────┐
│  M4 · 分析产物摘要 + RAG                                     │
│   caseAnalyses.summary + case_analysis_embeddings + 工具     │
└──────────────────────────────────────────────────────────────┘
```

**核心收益**：
- 案件关键元数据完整（庭审编号、法官）
- system prompt 体积下降 50-70%（材料不再塞全量 + basic_info 重复下线）
- Prompt cache 命中率 60%+（案件档案 1h TTL + 分析摘要 5m TTL）
- 案件记忆从"只创建一次"演进为"对话中自动抽取 + Agent 工具按需读写"
- 分析报告支持语义检索与多版本切换，跨模块引用成本下降

---

## 1. M1 · 案件字段 + 状态扩展

### 1.1 数据模型变动

**`cases` 表新增 5 个可空字段**（`prisma/models/case.prisma`）：

```prisma
model cases {
  // ... 现有字段保留 ...
  /// 法院名称
  courtName            String? @map("court_name")             @db.VarChar(200)
  /// 一审案件编号
  firstInstanceCaseNo  String? @map("first_instance_case_no") @db.VarChar(100)
  /// 二审案件编号
  secondInstanceCaseNo String? @map("second_instance_case_no")@db.VarChar(100)
  /// 一审法官姓名
  firstInstanceJudge   String? @map("first_instance_judge")   @db.VarChar(100)
  /// 二审法官姓名
  secondInstanceJudge  String? @map("second_instance_judge")  @db.VarChar(100)
  // 现有 status 字段沿用 Int @default(1)，含义扩展
}
```

迁移命令：`bun run prisma:migrate --name add_case_court_fields`（遵循项目数据库规范，走 `migrate dev` 生成正式迁移）。

### 1.2 状态枚举

`shared/types/case.ts`：

```ts
export enum CaseStatus {
  CONSULTING   = 1,    // 咨询阶段（默认）
  PREPARING    = 2,    // 准备阶段
  FIRST_TRIAL  = 3,    // 一审阶段
  SECOND_TRIAL = 4,    // 二审阶段
  CLOSED       = 99,   // 结案
  ARCHIVED     = 999,  // 归档
}

export const CaseStatusText: Record<CaseStatus, string> = {
  [CaseStatus.CONSULTING]:   '咨询阶段',
  [CaseStatus.PREPARING]:    '准备阶段',
  [CaseStatus.FIRST_TRIAL]:  '一审阶段',
  [CaseStatus.SECOND_TRIAL]: '二审阶段',
  [CaseStatus.CLOSED]:       '结案',
  [CaseStatus.ARCHIVED]:     '归档',
}
```

**存量数据迁移**（Q1.1 B）：`UPDATE cases SET status=99 WHERE status IN (2,3) AND deleted_at IS NULL`
- `status=1` 保持（IN_PROGRESS → CONSULTING 语义兼容）
- `status=2,3` 都归为 CLOSED(99)
- ARCHIVED(999) 只通过手动归档产生

### 1.3 AI 抽取字段扩展

`caseExtraction.service.ts` 的 Zod schema 追加 5 个字段：

```ts
const CaseExtractionSchema = z.object({
  // ... 现有字段 ...
  courtName: z.string().optional(),
  firstInstanceCaseNo: z.string().optional(),
  secondInstanceCaseNo: z.string().optional(),
  firstInstanceJudge: z.string().optional(),
  secondInstanceJudge: z.string().optional(),
})
```

提示词里追加："若材料中出现法院名称、案号（格式如『(2023)京0105民初12345号』）、法官姓名则填入，否则留空"。

### 1.4 前端改动

**创建/编辑案件表单**（`app/components/cases/CaseEditForm.vue` 或类似）：
- 5 个新输入框（非必填），分组在"诉讼信息"折叠面板内
- 状态下拉默认"咨询阶段"（`CaseStatus.CONSULTING`）
- AI 抽取回流时，**仅填充当前为空的字段**（用户已填的不覆盖，Q1.2 C 两条路共存）

**状态联动 UI**：
- 列表页徽章颜色：CONSULTING=灰 / PREPARING=蓝 / FIRST_TRIAL=黄 / SECOND_TRIAL=橙 / CLOSED=绿 / ARCHIVED=灰淡
- 详情页顶部面包屑加状态显示
- ARCHIVED 状态（Q1.3 AI 拍板：完全只读）：
  - 编辑入口置灰 + tooltip "归档案件不可编辑"
  - 分析入口禁用
  - 写记忆工具在 `write_case_memory` 前 check `case.status !== ARCHIVED`，抛业务错误返 Agent

### 1.5 API 层

- `POST /api/v1/case` / `PATCH /api/v1/case/:id`：新字段透传
- `GET /api/v1/case/:id`：响应包含新字段
- 用户端/管理端对同一资源的成对接口遵循现有隔离约定（`.claude/rules/api.md`）

---

## 2. M2 · 上下文去重 + Prompt Caching 分段

### 2.1 五段式 system prompt 结构

重构 `server/services/workflow/context/moduleContextBuilder.ts`，从现有的"四层平铺"改为"稳定 → 动态"五段，带 cache_control 断点：

```
┌───────────────────────────────────────────────────────────────┐
│ ① tools 定义                                            不变  │
├───────────────────────────────────────────────────────────────┤
│ ② system: 角色 + 流程规范（来自 NodeConfig.systemPrompt）     │
│    模板不含时间戳/随机值，版本化内容                          │
├───────────────────────────────────────────────────────────────┤
│ ③ system: 案件档案 JSON（cases 表 + M1 新字段）               │
│    仅结构化字段，案件生命周期内稳定                           │
│    cache_control: { type: 'ephemeral', ttl: '1h' }  ← 断点1   │
├───────────────────────────────────────────────────────────────┤
│ ④ system: 模块摘要（caseAnalyses.summary，active 版本）       │
│    每完成一个模块才变                                         │
│    cache_control: { type: 'ephemeral', ttl: '5m' }  ← 断点2   │
├───────────────────────────────────────────────────────────────┤
│ ⑤ system: 召回记忆 top-K + 材料清单 + 当前模块提示            │
│    动态内容，不进 cache                                       │
├───────────────────────────────────────────────────────────────┤
│   messages: 历史对话                                           │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 `moduleContextBuilder` 新签名

```ts
// server/services/workflow/context/moduleContextBuilder.ts

export interface ContextSegments {
  /** ② 角色 + 流程规范 */
  roleAndFlow: string
  /** ③ 案件档案 JSON（可缓存，1h） */
  caseProfile: string
  /** ④ 模块摘要（可缓存，5m） */
  moduleSummaries: string
  /** ⑤ 召回记忆 top-K + 材料清单（不缓存） */
  dynamicContext: string
}

export async function buildContextSegments(params: {
  caseId: number
  agentName: string
  userQuery: string  // 用于召回 pipeline 的 query
  contextWindow?: number
}): Promise<ContextSegments>
```

- `roleAndFlow`：直接取 `NodeConfig.systemPrompt` 模板
- `caseProfile`：`cases` 表结构化字段序列化（JSON 或 YAML 格式，包含 5 个新字段）
- `moduleSummaries`：`SELECT summary FROM case_analyses WHERE caseId=? AND is_active=true`，按 `analysisType` 组装
- `dynamicContext`：
  - 调 M3 的 `recallMemoryService(caseId, userQuery, top_k=5)` → 得到 top-K 记忆条
  - 材料清单（不含全文）：`[{name, summary}]`，每份材料 100 字摘要
  - 当前模块特定提示（若有）

### 2.3 Prompt Caching 三家适配（Q2.2 B）

新增 `shared/types/prompt.ts`：

```ts
export interface PromptSegment {
  text: string
  cache?: {
    ttl: '5m' | '1h'
  }
}

export type CachedPrompt = PromptSegment[]
```

`server/services/node/chatModelFactory.ts` 各 adapter 翻译：

| 供应商 | 翻译规则 |
|---|---|
| **Anthropic** | 每段包装成 `{type:'text', text, cache_control?: {type:'ephemeral', ttl: segment.cache.ttl}}`；1h TTL 段排在 5m TTL 段前 |
| **OpenAI** | 自动识别（`prompt_caching_enabled`），无需 breakpoint；仅保证顺序稳定即可命中 |
| **DeepSeek** | 同 OpenAI 兼容协议；响应里读 `usage.prompt_cache_hit_tokens` 落 `agentRuns.tokenBreakdown` 用于监控 |

**监控**：新增 `server/services/agent/cacheMetrics.service.ts`，每次 chat 完成后写入 Redis：
```
cache_hit:{model}:{date} += prompt_cache_hit_tokens
cache_miss:{model}:{date} += prompt_tokens - prompt_cache_hit_tokens
```
管理后台新增"Prompt 缓存命中率"卡片（M2 结束再做或延后）。

### 2.4 案件材料改造（Q2.1 A）

**新逻辑**：
- `getMaterialContextService` 返回"清单 + 摘要"：
  ```
  ## 案件材料
  - 《技术开发合同》(文档) — 约定甲乙双方在...【100 字摘要】
  - 《催告函》(文档) — 2025-08-14 原告发出...【100 字摘要】
  ```
- 材料全文走 `search_case_materials` 工具按需召回（项目已有）

**摘要生成**：
- `caseMaterials.summary` 字段已存在（见 `case.prisma:162`），复用
- 首次被引用时：取材料 OCR/文本前 500 字 → Haiku 4.5 生成 100 字摘要 → 写入 `summary` 字段
- 后续命中缓存不重算

**token 预算调整**：
- 原 `moduleContextBuilder` 的 `materialBudget = totalBudget * 0.4` → 降到 `~5%`（仅容纳清单）
- 释放的预算给 `dynamicContext`（召回记忆）

### 2.5 废弃 `basic_info` 记忆（Q2.4 AI 拍板）

- `caseExtraction.service.ts:46` 的 `saveCaseInfoService` 调用下线
- PostgresStore 里 `('cases', <id>, 'basic_info')` 的存量数据保留不读（零迁移风险）
- `moduleContextBuilder.buildMemorySection` 整段下线

### 2.6 改动清单

| 文件 | 改动 |
|---|---|
| `server/services/workflow/context/moduleContextBuilder.ts` | 重构为 `buildContextSegments` |
| `server/services/material/materialPipeline.service.ts` | 输出改为清单+摘要 |
| `server/services/material/material.service.ts` | 新增摘要生成 helper（Haiku 4.5）|
| `server/services/case/caseExtraction.service.ts` | 移除 `saveCaseInfoService` 调用 |
| `server/services/node/chatModelFactory.ts` | 各 adapter 支持 `CachedPrompt` 入参 |
| `shared/types/prompt.ts` | 新增 `PromptSegment` / `CachedPrompt` |
| `server/services/agent/cacheMetrics.service.ts` | 新建命中率统计 |

---

## 3. M3 · 记忆工具化 + 自动提取 + 召回 pipeline

### 3.1 数据模型

自建 `case_memories` 表（不走 LangGraph Store，理由：原生不支持 BM25 混合检索；自建与现有 `caseMaterialEmbeddings` 统一，运维简单，无 LangMem 外部依赖）。

```prisma
// prisma/models/case.prisma
model caseMemories {
  id              String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  caseId          Int                      @map("case_id")
  /// 记忆类型：fact / preference / module_summary / dialogue_note
  kind            String                   @db.VarChar(32)
  /// 主题指纹（如 "plaintiff.address" / "contract.delivery_date"），同主题新事实覆盖旧
  subjectKey      String?                  @map("subject_key") @db.VarChar(200)
  /// 记忆正文
  text            String                   @db.Text
  /// 抽取置信度（0-1），consolidator 产出
  confidence      Float?
  /// 来源：manual（热路径）/ consolidator（后台）/ module_summary
  source          String?                  @db.VarChar(100)
  /// 上一版记忆 id（版本链）
  supersedes      String?                  @map("supersedes") @db.Uuid
  /// 失效时间（不物理删除，召回默认过滤）
  invalidatedAt   DateTime?                @map("invalidated_at") @db.Timestamptz(6)
  /// 向量嵌入（pgvector）
  embedding       Unsupported("vector")?
  /// 中文全文搜索向量（trigger 自动维护）
  tsv             Unsupported("tsvector")?
  createdAt       DateTime                 @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime                 @default(now()) @map("updated_at") @db.Timestamptz(6)

  case cases @relation(fields: [caseId], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@index([caseId, kind], map: "idx_case_memories_case_kind")
  @@index([subjectKey], map: "idx_case_memories_subject_key")
  @@index([invalidatedAt], map: "idx_case_memories_invalidated_at")
  @@index([tsv], type: Gin, map: "idx_case_memories_tsv")
  @@map("case_memories")
}
```

**tsv trigger**（迁移 SQL 手工补，与 `caseMaterialEmbeddings` 同款）：

```sql
CREATE TRIGGER tsv_case_memories_update BEFORE INSERT OR UPDATE ON case_memories
FOR EACH ROW EXECUTE FUNCTION tsvector_update_trigger(tsv, 'pg_catalog.simple', text);
CREATE INDEX IF NOT EXISTS idx_case_memories_embedding ON case_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

需在 `prisma/migrations/<timestamp>_add_case_memories/migration.sql` 用 `--create-only` 后手工追加（遵循数据库规范）。

### 3.2 Service 层

**`server/services/memory/memory.service.ts`（新建）**：

```ts
export interface MemoryWriteInput {
  caseId: number
  kind: 'fact' | 'preference' | 'module_summary' | 'dialogue_note'
  text: string
  subjectKey?: string
  confidence?: number
  source?: 'manual' | 'consolidator' | 'module_summary'
}

/** 写入记忆（含 subject 版本链处理） */
export async function writeMemoryService(input: MemoryWriteInput): Promise<{ id: string }>

/** 更新或打失效 */
export async function updateMemoryService(id: string, patch: { text?: string; invalidate?: boolean }): Promise<void>

/** 召回（走 6 阶段 pipeline） */
export async function recallMemoryService(params: {
  caseId: number
  query: string
  kind?: MemoryWriteInput['kind']
  topK?: number
}): Promise<Array<{ id: string; text: string; score: number; kind: string }>>
```

**版本链处理**（`writeMemoryService` 内部）：

```ts
if (input.subjectKey) {
  // 1. 查同 subjectKey 的最新未失效记录
  const prev = await tx.caseMemories.findFirst({
    where: { caseId: input.caseId, subjectKey: input.subjectKey, invalidatedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (prev) {
    // 2. 对旧记录打失效
    await tx.caseMemories.update({ where: { id: prev.id }, data: { invalidatedAt: new Date() } })
  }
  // 3. 新记录 supersedes 指向旧
  const newId = await tx.caseMemories.create({ data: { ...input, supersedes: prev?.id ?? null, embedding, tsv: <自动> } })
}
```

### 3.3 召回 pipeline 六阶段（Q3.3 A：全量上）

**`server/services/memory/recall.pipeline.ts`（新建）**：

```
① Query Rewrite（Haiku 4.5）
  输入：原 query + 最近 5 轮对话
  输出：自足化 query（消解"他""上次"等指代）
  短 query（≤3 字）跳过此步

② Hybrid Recall (top-50)
  并行：
    - vector_search(pgvector cosine, query_embedding, limit=50)
    - bm25_search(tsv @@ plainto_tsquery('simple', query), limit=50)
  融合：RRF(k=60) → 合并去重 → top-50

③ Pre-filter
  - caseId 硬过滤（必须）
  - invalidatedAt IS NOT NULL → 丢弃（除非 query 显含"历史/曾经"意图）
  - cosine < 0.3 → 丢弃（避免硬凑 top-K）

④ Rerank (bge-reranker-v2-m3)
  HTTP POST to http://bge-reranker:8080/rerank
  body: { query, documents: top50.map(m => m.text) }
  取 top-8

⑤ MMR(λ=0.4) + Adaptive K
  fetch_k=8 → 选 5 条多样性覆盖
  Adaptive K：
    - 简单 query（单实体指称）→ K=3
    - 多跳 query（"X 和 Y 的关系"）→ K=5
    - 时序 query（"当初怎么...") → K=5 + 放开 invalidated 过滤

⑥ Subject 版本链降权
  最终打分：
    score = rerank_score
          × recencyDecay(now - createdAt, 半衰期 30 天)
          × (invalidated ? 0 : 1)
          × (isLatestInSubject(m) ? 1.0 : 0.3)
  按 score 降序输出
```

**isLatestInSubject** 查询：同 subjectKey 下 `createdAt` 最大者即 latest（简单 group by）。

**短 query 绕过**：若 query 非闲聊且 >3 字才进 pipeline；否则不调 memory（省去无效召回）。

### 3.4 Agent 工具（新增 3 个）

文件位置：`server/services/workflow/tools/`，按现有 toolModules 模式注册。

```ts
// search_case_memory.tool.ts
export const toolDefinition = {
  name: 'search_case_memory',
  description: '语义检索当前案件的长期记忆（事实/偏好/模块摘要/对话要点）。当需要回忆之前讨论过的内容时调用。',
  schema: z.object({
    query: z.string().describe('检索关键词或问题'),
    kind: z.enum(['fact', 'preference', 'module_summary', 'dialogue_note']).optional(),
    top_k: z.number().default(5),
  }),
}
export function createTool(context: ToolContext) {
  return tool(async ({ query, kind, top_k }) => {
    const hits = await recallMemoryService({ caseId: context.caseId, query, kind, topK: top_k })
    return JSON.stringify(hits)
  }, toolDefinition)
}
```

类似实现 `write_case_memory.tool.ts` / `update_case_memory.tool.ts`。所有工具**嵌入 caseId**（context 注入，Agent 不能跨案件操作）。

**ARCHIVED 状态保护**：`write_case_memory` / `update_case_memory` 内部先查 `case.status`，若为 ARCHIVED 抛业务错误。

### 3.5 Background consolidator（Q3.1 B：异步 debounce 30s）

**架构**：Redis 队列 + debounce，Haiku 4.5 抽取。

```
chat.post.ts 每轮对话结束
  ↓
consolidator.schedule({ caseId, sessionId, lastMessageIdx })
  ↓ Redis key: consolidator:debounce:{sessionId}
  ↓ setex 30s；若已存在则覆盖（debounce）
  ↓
定时 worker（每秒扫一次过期 key）→ 触发实际 consolidate
```

**实际抽取逻辑**（`server/services/memory/consolidator.service.ts`）：

```ts
async function consolidateSession({ caseId, sessionId, lastMessageIdx }): Promise<void> {
  // 1. 取最近 N 条 messages（从 last consolidator run 之后）
  const messages = await loadRecentMessages(sessionId, fromIdx)

  // 2. Haiku 4.5 按 schema 抽取
  const schema = z.object({
    facts: z.array(z.object({
      subjectKey: z.string(),
      text: z.string(),
      confidence: z.number().min(0).max(1),
    })),
    preferences: z.array(z.object({ text: z.string(), confidence: z.number() })),
    dialogueNotes: z.array(z.object({ text: z.string() })),
  })
  const extracted = await haikuLLM.withStructuredOutput(schema).invoke(extractPrompt(messages))

  // 3. 合并去重（action = add / update / merge / no-op）
  for (const f of extracted.facts) {
    if (f.confidence < 0.6) continue   // 低置信度不落库
    await writeMemoryService({ caseId, kind: 'fact', text: f.text, subjectKey: f.subjectKey, confidence: f.confidence, source: 'consolidator' })
    // writeMemoryService 内部自动处理 subjectKey 版本链（新覆盖旧 invalidate）
  }
  // preferences / dialogueNotes 类似
}
```

**失败处理**：整个 consolidator run 是 best-effort，失败不阻塞主对话。失败日志走 `logger.warn`。

### 3.6 infra：bge-reranker 本地服务

**Docker compose 追加**（`docker-compose.yml`）：

```yaml
services:
  bge-reranker:
    image: ghcr.io/huggingface/text-embeddings-inference:cpu-1.5
    command:
      - --model-id=BAAI/bge-reranker-v2-m3
      - --port=8080
      - --pooling=mean
    ports:
      - "8090:8080"
    restart: unless-stopped
    # 可选：GPU 镜像 tei:latest-grpc-cuda + deploy 段
```

**客户端封装**（`server/services/memory/rerankerClient.ts`）：

```ts
export async function rerankDocuments(query: string, docs: Array<{ id: string; text: string }>): Promise<Array<{ id: string; score: number }>> {
  const res = await $fetch<{ scores: number[] }>('http://localhost:8090/rerank', {
    method: 'POST',
    body: { query, texts: docs.map(d => d.text) },
    timeout: 5000,
  })
  return docs.map((d, i) => ({ id: d.id, score: res.scores[i] })).sort((a, b) => b.score - a.score)
}
```

降级：若 reranker 服务不可达（5s 超时），跳过 ④ 阶段，直接用 hybrid 的融合分数作为最终分（日志 warn）。

### 3.7 评估（二期，不阻塞 MVP）

- Golden set：30-50 条律师标注的 `(query, gold_memory_ids)` 三元组，放 `tests/fixtures/memory-golden.json`
- 评测脚本：`scripts/eval-memory-recall.ts`，跑 Ragas 风格的 Recall@5 / MRR / nDCG@5
- LangSmith 在线 trace 采样：每日 50 条线上 query 采样 → 周报

---

## 4. M4 · 分析产物摘要 + RAG

### 4.1 数据模型

**`caseAnalyses` 加字段**：

```prisma
model caseAnalyses {
  // ... 现有字段 ...
  /// 分析结果摘要（200-400 字，生成时同步产出）
  summary  String?   @db.Text
}
```

**新表 `case_analysis_embeddings`**（结构参考 `caseMaterialEmbeddings`）：

```prisma
model caseAnalysisEmbeddings {
  id        String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  text      String?                  @db.Text
  /// { caseId, analysisId, nodeId, analysisType, version, isActive, chunkIndex }
  metadata  Json?
  embedding Unsupported("vector")?
  tsv       Unsupported("tsvector")?

  @@index([tsv], type: Gin, map: "idx_case_analysis_tsv")
  @@map("case_analysis_embeddings")
}
```

同样需手工追加 tsv trigger + ivfflat 索引。

### 4.2 生成路径（Q4.1 A：同步）

修改 `initAnalysis.service.ts`（模块分析完成写库时）：

```ts
async function completeAnalysisService({ analysisId, result, model }) {
  await prisma.$transaction(async tx => {
    // 1. 写 analysisResult
    const analysis = await tx.caseAnalyses.update({
      where: { id: analysisId },
      data: { status: 2, analysisResult: result, /* ... */ },
    })

    // 2. 同步生成 summary（Q4.2 AI 拍板：主模型）
    const summary = await generateSummary(model, result, { maxChars: 400 })
    await tx.caseAnalyses.update({ where: { id: analysisId }, data: { summary } })

    // 3. 切块 + embedding
    const chunks = splitByParagraph(result, { maxTokens: 500 })
    for (const [i, chunk] of chunks.entries()) {
      await tx.$executeRawUnsafe(`
        INSERT INTO case_analysis_embeddings (text, metadata, embedding)
        VALUES ($1, $2::jsonb, $3::vector)
      `,
        chunk,
        JSON.stringify({
          caseId: analysis.caseId, analysisId, nodeId: analysis.nodeId,
          analysisType: analysis.analysisType, version: analysis.version,
          isActive: true, chunkIndex: i,
        }),
        await embedText(chunk),
      )
    }
  }, { timeout: 30_000 })

  // 用户侧 toast："分析完成" + 后端 publishAgentEvent 一次 analysis_result_saved
}
```

**延迟预算**：摘要 +embedding 约 3-5s，用户可接受。

### 4.3 切版本同步 metadata

`setActiveVersionService`（现有）增加 embedding 同步：

```ts
await prisma.$transaction(async tx => {
  // 1. 翻 caseAnalyses.isActive（原有逻辑）
  await tx.caseAnalyses.updateMany({
    where: { caseId, nodeId, version: { not: newVersion } },
    data: { isActive: false },
  })
  await tx.caseAnalyses.update({ where: { id: newActiveId }, data: { isActive: true } })

  // 2. 同步 embeddings.metadata.isActive（新增）
  await tx.$executeRawUnsafe(`
    UPDATE case_analysis_embeddings
    SET metadata = jsonb_set(metadata, '{isActive}', 'false')
    WHERE metadata->>'caseId' = $1
      AND metadata->>'nodeId' = $2
      AND (metadata->>'version')::int <> $3
  `, caseId.toString(), nodeId.toString(), newVersion)
  await tx.$executeRawUnsafe(`
    UPDATE case_analysis_embeddings
    SET metadata = jsonb_set(metadata, '{isActive}', 'true')
    WHERE metadata->>'analysisId' = $1
  `, newActiveId.toString())
})
```

### 4.4 工具：`search_case_analysis`

```ts
export const toolDefinition = {
  name: 'search_case_analysis',
  description: '检索当前案件已完成的分析报告片段（如诉请分析、风险评估等模块的正文）。默认只返生效版本。',
  schema: z.object({
    query: z.string(),
    analysis_type: z.string().optional().describe('限定分析模块，如 risk_assessment'),
    include_all_versions: z.boolean().default(false),
    top_k: z.number().default(5),
  }),
}

export function createTool(context: ToolContext) {
  return tool(async ({ query, analysis_type, include_all_versions, top_k }) => {
    // 复用 M3 的 6 阶段 pipeline，但查询对象改为 case_analysis_embeddings
    const filter: Record<string, unknown> = { caseId: context.caseId }
    if (analysis_type) filter.analysisType = analysis_type
    if (!include_all_versions) filter.isActive = true
    const hits = await recallAnalysisService({ filter, query, topK: top_k })
    return JSON.stringify(hits)
  }, toolDefinition)
}
```

### 4.5 旧数据（Q4.3 B）

- 生产环境已存在的 `caseAnalyses`（无 summary）**不补**
- 召回时这些旧版本 embedding 缺失，自然不会出现在结果里
- 不上批量脚本；除非后续发现明显漏检（事后处理）

### 4.6 `buildCompletedResultsSection` 精简

原来此函数渲染全文（几 KB 进 prompt）。M4 之后：

```ts
async function buildCompletedResultsSection(caseId: number, excludeModule: string): Promise<string> {
  const results = await prisma.caseAnalyses.findMany({
    where: { caseId, isActive: true, analysisType: { not: excludeModule } },
    select: { analysisType: true, summary: true },
  })
  if (!results.length) return null
  const lines = ['## 已完成的分析模块']
  for (const r of results) {
    lines.push(`### ${r.analysisType}\n${r.summary ?? '(未生成摘要，原文可通过 search_case_analysis 工具检索)'}`)
  }
  return lines.join('\n\n')
}
```

---

## 5. 数据模型汇总

| 表 | 操作 | 字段改动 |
|---|---|---|
| `cases` | 修改 | +5 字段（法院/法官/案号）；`status` 语义扩展至 6 档 |
| `caseAnalyses` | 修改 | +`summary` |
| `caseMaterials` | 不动 | `summary` 字段已有 |
| `case_memories` | 新建 | 完整新表 |
| `case_analysis_embeddings` | 新建 | 完整新表 |

**所有迁移**走 `bun run prisma:migrate --name <name>`（遵循 `.claude/rules/database.md`，禁止手工放独立 SQL；tsv trigger 用 `--create-only` 生成后追加）。

---

## 6. infra 依赖

| 组件 | 作用 | 方式 |
|---|---|---|
| PostgreSQL + pgvector | 主库 + 向量索引 | 已有 |
| Redis | SSE stream / 队列 / cache metrics | 已有 |
| **bge-reranker-v2-m3** | 召回 rerank | 新增 Docker 服务（TEI 镜像） |
| **Haiku 4.5** | consolidator 抽取 + 材料摘要 | 新增一个 API key / 复用 Anthropic provider |

环境变量追加：
- `RERANKER_URL=http://localhost:8090` （开发 / 生产分别）
- 现有 `ANTHROPIC_API_KEY` 复用，无需新增

---

## 7. 改动清单（跨 4 子系统）

### 数据库
- `prisma/models/case.prisma`：改 cases 加字段 + 加 CaseMemories/CaseAnalysisEmbeddings 表 + 改 caseAnalyses 加 summary
- `prisma/migrations/<ts>_add_case_court_fields/`
- `prisma/migrations/<ts>_extend_case_status/`（仅 seedData 更新，status 本身是 Int 无需改列）
- `prisma/migrations/<ts>_add_case_memories/`（含 tsv trigger 手工追加）
- `prisma/migrations/<ts>_add_case_analysis_rag/`（summary 字段 + embeddings 表 + trigger）

### 前端
- `app/components/cases/CaseEditForm.vue` / `CaseCreateDialog.vue`：表单 +5 字段 + 状态下拉
- `app/components/cases/CaseStatusBadge.vue`（新建或改）：6 档色彩
- `app/composables/useCaseForm.ts`：AI 回填只填空字段逻辑

### 后端 Service
- `server/services/workflow/context/moduleContextBuilder.ts`：重构为 5 段式
- `server/services/material/materialPipeline.service.ts`：清单+摘要
- `server/services/material/material.service.ts`：摘要生成 helper
- `server/services/case/caseExtraction.service.ts`：schema +5 字段 / 移除 basic_info 写入
- `server/services/case/initAnalysis.service.ts`：分析完成时同步生成 summary + embedding
- `server/services/case/caseAnalysis.service.ts`：`setActiveVersionService` 同步 metadata.isActive
- `server/services/node/chatModelFactory.ts`：三家 adapter 接受 `CachedPrompt`
- `server/services/memory/memory.service.ts`：新建（writeMemoryService / updateMemoryService / recallMemoryService）
- `server/services/memory/memory.dao.ts`：新建
- `server/services/memory/recall.pipeline.ts`：6 阶段召回
- `server/services/memory/consolidator.service.ts`：新建（debounce 30s + Haiku 4.5 抽取）
- `server/services/memory/rerankerClient.ts`：新建
- `server/services/agent/cacheMetrics.service.ts`：新建（可选）

### Workflow 工具
- `server/services/workflow/tools/search_case_memory.tool.ts`
- `server/services/workflow/tools/write_case_memory.tool.ts`
- `server/services/workflow/tools/update_case_memory.tool.ts`
- `server/services/workflow/tools/search_case_analysis.tool.ts`
- `server/services/workflow/tools/index.ts`：注册上面 4 个

### API
- `server/api/v1/case/*.ts`：透传 5 新字段
- `server/api/v1/case/analysis/chat.post.ts`：每轮结束触发 `consolidator.schedule`

### 共享类型
- `shared/types/case.ts`：`CaseStatus` 枚举 + `CaseStatusText`
- `shared/types/prompt.ts`：新建 `PromptSegment` / `CachedPrompt`
- `shared/types/memory.ts`：新建 `MemoryKind` / `CaseMemory` DTO
- `shared/types/prisma.ts`：重导出新模型

### Infra
- `docker-compose.yml`：bge-reranker service

---

## 8. 非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | M2 后单次 chat system prompt < 4K tokens（不含召回）；M3 召回 p95 < 500ms；M4 摘要生成 < 3s |
| Prompt Cache | Anthropic 命中率 ≥ 60%；OpenAI/DeepSeek 命中率监控（≥ 30% 即达标）|
| 兼容性 | 旧案件打开不报错：status=1 正常显示；status=2,3 迁移后为 99；缺 summary 的分析产物不阻塞主流程 |
| ARCHIVED 行为 | 编辑/分析/写记忆入口禁用（服务端业务检查 + 前端 UI 灰化）|
| Reranker 降级 | 服务不可达时跳过 ④ 阶段，不阻塞 chat；日志 warn |
| Consolidator 失败 | best-effort，失败不阻塞用户对话 |
| 迁移安全 | 所有迁移走 `prisma migrate dev` 正式生成；tsv trigger 用 `--create-only` 手工补；dev/test/prod 一致性由 `prisma migrate deploy` 保证 |

---

## 9. 风险与回归点

| 风险 | 缓解 |
|---|---|
| Prompt Cache 命中率不达预期 | `cacheMetrics.service` 监控；未达 60% 定位 diff 段位（多半是 caseProfile JSON 字段顺序抖动）|
| consolidator 死循环 / 抽取成本飙升 | debounce 30s + 单次最多处理 20 条 messages + confidence<0.6 丢弃 + 失败熔断（连续 3 次失败该 session 暂停 consolidator 10min） |
| bge-reranker Docker 容器启动慢（CPU 首次 2-5min） | 启动时预热 + healthcheck；未 healthy 时降级走 hybrid 分数 |
| 状态迁移 SQL 在生产跑误伤 | 脚本附带 `BEGIN; <update>; SELECT ... LIMIT 20; ROLLBACK;` 预演步骤；正式执行前 DBA 复核 |
| 5 段 prompt 结构改动破坏现有 Agent | 灰度：先在 `initAnalysis` 模块启用 M2，观察 3 天；再推广到小索/法律助手 |
| 分析结果生成 summary 拖慢用户体感 | 并行化：summary 生成与 embedding 切块并发 Promise.all；总延迟控制在 5s 内 |
| ARCHIVED 状态前端/后端不同步（前端灰了但后端没挡）| 服务端在 `writeMemoryService` / `updateMemoryService` / `updateCaseService` / 分析触发接口各加一道 status check；单测覆盖 |
| `case_memories` 表随时间膨胀 | `invalidatedAt` 索引；6 个月后统计大小，必要时加 `archivedMemories` 冷表分离（二期）|

---

## 10. 测试策略

### 单测
- `memoryService.spec.ts`：writeMemoryService 版本链（subjectKey 覆盖 invalidate）；update 打失效；recallMemoryService 各阶段流程正确
- `recallPipeline.spec.ts`：6 阶段各自纯函数 + 打分公式
- `consolidator.spec.ts`：debounce / 抽取 schema / confidence 过滤 / 动作集
- `moduleContextBuilder.spec.ts`：5 段结构输出正确，cache_control 标记位置正确
- `setActiveVersionService.spec.ts`：metadata.isActive 原子同步

### 集成测
- 状态迁移 SQL dry-run（测试库跑一遍预期结果）
- Prompt Caching 三家 adapter：每个发 identical system 两次，第二次应命中（检查 usage.prompt_cache_hit_tokens > 0）
- 召回 pipeline E2E：mock bge-reranker → 全流程 ≤ 500ms
- 分析完成同步生成 summary + embedding（不阻塞主流程，延迟 < 5s）

### E2E（手工）
- 新建案件：5 字段填写 + 状态默认"咨询"+ AI 抽取回填只填空字段
- 切换状态到 ARCHIVED：编辑/分析/写记忆入口全部禁用
- 对话触发子 Agent 调用 `search_case_memory`，返回合理结果
- 连续多轮对话后，consolidator 在 30s 内把事实写进 `case_memories`
- 切换分析版本：`search_case_analysis` 返回跟随 active 版本变化
- 7 种主题 × 浅/深模式 UI 健壮

---

## 11. 实施阶段（交给 writing-plans 产出详细 plan，本节仅概述）

```
Phase 1 (M1)  字段 + 状态 + 表单 + 存量迁移           ~2 天
Phase 2 (M2)  moduleContextBuilder 5 段化 + Caching   ~3 天
              材料改造 + 废弃 basic_info
Phase 3 (M3)  case_memories 表 + Service + 3 工具     ~5 天
              bge-reranker infra + 召回 pipeline
              consolidator 异步队列
Phase 4 (M4)  caseAnalyses.summary + embedding 表     ~3 天
              setActiveVersion 同步 + search_case_analysis 工具
```

总计约 13 工作日；每个 Phase 独立可上线（不阻塞前一 Phase 发版）。

---

## 12. 铁律清单（编码时逐条核验）

- [ ] 所有数据库变更走 `bun run prisma:migrate` 正式生成迁移；tsv trigger 手工补充需用 `--create-only` + 用户同意
- [ ] 召回 query 始终硬过滤 `caseId`（Agent 不能跨案件读记忆）
- [ ] `write_case_memory` / `update_case_memory` / `initAnalysis` / `updateCase` 服务端全部 check `case.status !== ARCHIVED`
- [ ] Prompt Cache 断点位置严格：1h TTL（案件档案）在 5m TTL（模块摘要）**之前**
- [ ] `caseProfile` JSON 字段序列化顺序稳定（字段名字典序），避免无意义 cache miss
- [ ] consolidator 失败不阻塞主对话（best-effort）
- [ ] 召回 pipeline 的 bge-reranker 不可达时降级走 hybrid 分数，不抛异常
- [ ] `case_memories` / `case_analysis_embeddings` 的 `invalidatedAt` / `metadata.isActive` 所有写入必须在事务内
- [ ] 摘要与 embedding 使用主模型 / Haiku 4.5 的划分按本 spec §2.3 §3.5 §4.2 严格执行（不临时换）
- [ ] 所有新增表的 Prisma schema 严格遵循项目现有惯例（`@map` 下划线、`@@index` 命名 `idx_<table>_<col>`）
- [ ] UI 上 6 档状态徽章色系预先评审（配合 `.claude/rules/ui.md` 深色模式），所有主题下可读
