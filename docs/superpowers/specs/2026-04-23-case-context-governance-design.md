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

> **P9 语境说明**：用户原话"不破坏模型供应商的缓存机制"——项目当前**未启用** Prompt Caching，M2 是**新建立**符合三家供应商缓存规则的分段结构（不是改造现有缓存）。"不破坏"在此语境下的含义是：所建分段必须从一开始就 cache-friendly（字段稳定、顺序固定、不带随机值）。

## 0.5 四层上下文职责分离总表（防回归）

| 层 | 职责 | 存储 | 进 prompt 方式 | 配套工具 |
|---|---|---|---|---|
| **A · 案件档案** | 身份证：当事人、法院/案号/法官、案由、诉请、标的、状态 | `cases` 表结构化字段（M1 新增 5 字段） | 每次对话全量渲染进 ③ 段 system（JSON 形态） | — |
| **B · 案件记忆** | 笔记本：对话抽取事实、用户偏好、对话要点 | `case_memories` 表（M3 新建）| 按本轮问题语义召回 top-K 进 ⑤ 段 system（非缓存） | `search/write/update_case_memory` 3 个工具 |
| **C · 案件材料** | 卷宗：合同、证据、笔录原文 | `caseMaterials` 表 + `caseMaterialEmbeddings` 向量表 | **不进** system；系统只塞"清单 + 100 字摘要"到 ⑤ 段；全文按需调工具 | `search_case_materials`（现有）|
| **D · 分析产物** | 阶段报告：模块分析结论 | `caseAnalyses`（新加 `summary`）+ `case_analysis_embeddings`（M4 新建）| 摘要进 ④ 段 system；全文按需调工具 | `search_case_analysis`（M4 新增）|

**不重叠铁律**：
- 结构化字段只由 A 层负责，B 层不重复存（废弃 `basic_info` 的根因）
- 长文本（材料 / 分析报告正文）只由 C / D 负责，不进 system prompt
- B 层记忆条目不包含 A / C / D 已有的原文，只存"抽取结论"（如"甲方承认逾期交货"而不是合同原文）

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
- 5 个新输入框（非必填），在"诉讼信息"分区**平铺**（有小标题分隔，无折叠交互，与现有 `ManualForm.vue` 风格一致）
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

> **前置说明**：项目当前未启用任何供应商的 Prompt Caching。本节是**建立**新的 cache-friendly 结构，而非改造已有缓存（不存在"破坏旧缓存"的风险）。

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

| 供应商 | 翻译规则 | 响应字段（命中率监控） |
|---|---|---|
| **Anthropic** | 把分段放在 `SystemMessage/HumanMessage` 的 `content` 数组里：`new SystemMessage({ content: [{ type:'text', text: seg1, cache_control: { type:'ephemeral', ttl:'1h' } }, { type:'text', text: seg2, cache_control: { type:'ephemeral', ttl:'5m' } }] })`；**1h TTL 段必须排在 5m TTL 段前**；全请求（tools + system + messages 合计）最多 4 个 `cache_control` 断点（本方案用 2 个在限内）；ttl `'1h'` / `'5m'` GA 无需 beta header | `usage.cache_read_input_tokens` + `usage.cache_creation_input_tokens`；混合 TTL 时读 `usage.cache_creation_input_tokens.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens` |
| **OpenAI** | **零配置自动启用**（无 `prompt_caching_enabled` 之类参数）；仅保证系统提示前缀字节稳定即可命中 | `usage.prompt_tokens_details.cached_tokens` |
| **DeepSeek** | 协议与 OpenAI 兼容，**cache 也是零配置**；但响应字段名自有（不要照 OpenAI 抄） | `usage.prompt_cache_hit_tokens` |

**监控策略**（一期简化）：
- 各次 chat 结束后按供应商读对应字段，打结构化日志：`logger.info('prompt_cache', { provider, model, hit_tokens, total_tokens })`
- **不建** `cacheMetrics.service.ts`、**不做**后台卡片（用户未要求；二期再加）
- 命中率核查：日志聚合（`grep prompt_cache | jq ...`）或 LangSmith trace 即可

### 2.4 案件材料改造（Q2.1 A）

**新逻辑**：
- `getMaterialContextService` 返回"清单 + 摘要"：
  ```
  ## 案件材料
  - 《技术开发合同》(文档) — 约定甲乙双方在...【100 字摘要】
  - 《催告函》(文档) — 2025-08-14 原告发出...【100 字摘要】
  ```
- 材料全文走 `search_case_materials` 工具按需召回（项目已有）

**摘要生成**（时机：立即生成，非懒生成）：
- `caseMaterials.summary` 字段已存在（见 `case.prisma:162`），复用
- 材料文本就绪（OCR/ASR 完成，即 `status=3/已完成`）时**异步触发**生成：取正文前 500 字 → Haiku 4.5 生成 100 字摘要 → 写入 `summary`
- 生成位置：`materialPipeline.service.ts` 现有的 "OCR/ASR 完成 → embedding 入库" 流水线末尾串联一步
- 对话热路径只读 `summary` 字段，不再触发懒生成，避免首次对话延迟叠加

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
<!-- cacheMetrics.service.ts 一期不建，只在 chatModelFactory 各 adapter 里 logger.info 打点（见 §2.3） -->

---

## 3. M3 · 记忆工具化 + 自动提取 + 召回 pipeline

### 3.1 数据模型（LangChain PGVectorStore 兼容 schema）

**决策依据**：
- `caseMaterialEmbeddings` / `lawEmbeddings` 的 schema 本质是 **LangChain `PGVectorStore` 框架在首次 `addDocuments` 时自动建立**（`id / text / metadata(JSONB) / embedding(vector)`）；Prisma model 只是"占位声明"防止 `migrate diff` 把表判成漂移。`tsv` 列是项目自己追加的 BM25 扩展。
- 新表 `case_memories` 维持同构形态，才能继续用 `addDocumentsToVectorStore`（见 `server/services/legal/vectorStore.service.ts:244`）写入，不打破框架约定
- 所有"业务字段"（kind / subjectKey / invalidatedAt / caseId 等）都放 **metadata JSON**；查询通过 `metadata->>'field'` + expression index 加速

**LangGraph Store 排除说明**：项目现有 `PostgresStore`（`server/services/workflow/checkpointer.ts`）是纯 KV 存储（无 vector / tsv 列，见 `prisma/models/langchain.prisma:41-53` 的 `store` 表），不支持 BM25 混合检索。排除走 Store 的方案。

```prisma
// prisma/models/case.prisma
/// 案件记忆向量表（LangChain PGVectorStore 同构）
/// 写入走 addDocumentsToVectorStore；业务字段放 metadata JSON
/// 注意：此表结构对齐 LangChain 约定，不允许新增查询列（会破坏框架写入）
model caseMemories {
  /// 主键，UUID 类型（框架生成）
  id        String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  /// 记忆正文
  text      String?                  @db.Text
  /// 元数据（JSONB）：{ caseId: number, kind: 'fact'|'preference'|'dialogue_note',
  ///                   subjectKey?: string, confidence?: number, source?: string,
  ///                   supersedes?: string, invalidatedAt?: string(ISO) }
  metadata  Json?
  /// 向量嵌入
  embedding Unsupported("vector")?
  /// 中文全文搜索向量（由 setupRetrievalInfra.ts 手工回填）
  tsv       Unsupported("tsvector")?

  @@index([tsv], type: Gin, map: "idx_case_memories_tsv")
  @@map("case_memories")
}
```

**业务字段 metadata schema**（TypeScript 侧定义在 `shared/types/memory.ts`）：

```ts
export interface CaseMemoryMetadata {
  caseId: number              // 案件 ID，硬过滤必需
  kind: 'fact' | 'preference' | 'dialogue_note'
  subjectKey?: string         // 主题指纹，版本链 group-by 用
  confidence?: number         // consolidator 置信度 0-1
  source?: 'manual' | 'consolidator'
  supersedes?: string         // 上一版 id
  invalidatedAt?: string      // ISO 时间串，非空即失效
  createdAt: string           // ISO
}
```

**迁移（手工 SQL，与 caseMaterialEmbeddings 同款）**：`prisma/migrations/<ts>_add_case_memories/migration.sql` 用 `--create-only` 后追加：

```sql
-- （幂等）确保 zhparser 中文分词配置存在（seedData.sql 建过，但 migrate deploy 不跑 seed）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
    CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END $$;

-- LangChain PGVectorStore 首次写入会自建主表，此处显式建立同款 schema 让 Prisma diff 无漂移
CREATE TABLE IF NOT EXISTS "case_memories" (
  "id"        UUID        NOT NULL DEFAULT gen_random_uuid(),
  "text"      TEXT,
  "metadata"  JSONB,
  "embedding" vector,
  "tsv"       tsvector,
  CONSTRAINT "case_memories_pkey" PRIMARY KEY ("id")
);

-- BM25 GIN 索引
CREATE INDEX IF NOT EXISTS "idx_case_memories_tsv"
  ON "case_memories" USING GIN ("tsv");

-- 向量索引（HNSW，pgvector 0.7+ 推荐；规模 <10K 时用默认 m/ef_construction 够用）
CREATE INDEX IF NOT EXISTS "idx_case_memories_embedding"
  ON "case_memories" USING hnsw (embedding vector_cosine_ops);

-- metadata 业务字段 expression index（对应热查询路径）
CREATE INDEX IF NOT EXISTS "idx_case_memories_meta_case"
  ON "case_memories" ((metadata->>'caseId'));
CREATE INDEX IF NOT EXISTS "idx_case_memories_meta_subject"
  ON "case_memories" ((metadata->>'caseId'), (metadata->>'subjectKey'))
  WHERE metadata->>'invalidatedAt' IS NULL;
CREATE INDEX IF NOT EXISTS "idx_case_memories_meta_kind"
  ON "case_memories" ((metadata->>'caseId'), (metadata->>'kind'));
```

tsv 维护：模仿 `setupRetrievalInfra.ts` 在写入完成后手工 `UPDATE case_memories SET tsv = to_tsvector('chinese', COALESCE(text, '')) WHERE tsv IS NULL`；或在 writeMemoryService 写入后立即执行一次该 UPDATE。

### 3.2 Service 层（**最大化复用现有 retrieval 基建**）

**项目现有可复用基建**：

| 函数 | 位置 | 新用途 |
|---|---|---|
| `addDocumentsToVectorStore(docs, ids, { tableName })` | `server/services/legal/vectorStore.service.ts:244` | 写入 case_memories / case_analysis_embeddings（注意参数顺序：docs, ids, config） |
| `getEmbeddingsAsync()` | 同上 | embedding 计算 |
| `hybridSearchService(tableName, query, k, metadataFilter, sourceIds)` | `server/services/retrieval/hybridSearch.service.ts:107` | 召回 ①②③ 阶段 |
| `vectorSearchService` / `fullTextSearchService` | `retrieval/` | hybridSearchService 内部已封装 |
| `reciprocalRankFusion()` | `hybridSearch.service.ts:75` | RRF 融合 |
| `ALLOWED_TABLES` 白名单 | `retrieval/types.ts` | 需要加入 `case_memories` 和 `case_analysis_embeddings` |

**仅需新增的内容**：
1. `shared/types/memory.ts`：`CaseMemoryMetadata` interface
2. `server/services/memory/memory.service.ts`：
   - `writeMemoryService` · 版本链处理 + 调 `addDocumentsToVectorStore` + 手工回填 tsv
   - `updateMemoryService` · `jsonb_set` 翻 metadata.invalidatedAt
   - `recallMemoryService` · 调 `hybridSearchService` + 后接 rerank / MMR / 版本链降权 三个纯函数
3. `server/services/memory/rerankerClient.ts` · 调 TEI 服务
4. `server/services/memory/postProcess.ts` · `mmrFilter()` / `subjectVersionScoring()` 两个纯函数
5. `server/services/retrieval/types.ts` · `ALLOWED_TABLES` 加两个表名

```ts
// memory.service.ts 伪代码
import { addDocumentsToVectorStore } from '~/server/services/legal/vectorStore.service'
import { hybridSearchService } from '~/server/services/retrieval/hybridSearch.service'
import { rerankDocuments } from './rerankerClient'
import { mmrFilter, subjectVersionScoring } from './postProcess'

export async function writeMemoryService(input: MemoryWriteInput): Promise<{ id: string }> {
  // 1. 同 subjectKey 的最新未失效记录 → jsonb_set 打 invalidatedAt
  if (input.subjectKey) {
    await prisma.$executeRawUnsafe(`
      UPDATE case_memories
      SET metadata = jsonb_set(metadata, '{invalidatedAt}', to_jsonb(NOW()::text))
      WHERE metadata->>'caseId' = $1
        AND metadata->>'subjectKey' = $2
        AND metadata->>'invalidatedAt' IS NULL
    `, String(input.caseId), input.subjectKey)
  }

  // 2. 走 LangChain PGVectorStore 写入
  const metadata: CaseMemoryMetadata = {
    caseId: input.caseId,
    kind: input.kind,
    subjectKey: input.subjectKey,
    confidence: input.confidence,
    source: input.source,
    createdAt: new Date().toISOString(),
  }
  const newId = crypto.randomUUID()
  await addDocumentsToVectorStore(
    [{ pageContent: input.text, metadata }],
    [newId],
    { tableName: 'case_memories' },
  )

  // 3. 手工回填 tsv（addDocuments 不写 tsv，参考 setupRetrievalInfra 模式）
  await prisma.$executeRawUnsafe(`
    UPDATE case_memories SET tsv = to_tsvector('chinese', COALESCE(text, ''))
    WHERE id = $1::uuid
  `, newId)

  return { id: newId }
}

export async function recallMemoryService(params: {
  caseId: number
  query: string
  kind?: MemoryKind
  topK?: number
  /** Agent 显式传入；true 时放开失效过滤，可看到历史版本链。默认 false（只返最新有效） */
  includeInvalidated?: boolean
}): Promise<Array<MemoryHit>> {
  const { caseId, query, kind, topK = 5, includeInvalidated = false } = params

  // 调公共入口 retrieveWithReranking（封装 ①②③④⑤⑥）
  const metadataFilter: Record<string, string | number | boolean> = { caseId }
  if (kind) metadataFilter.kind = kind
  return retrieveWithReranking({
    tableName: 'case_memories',
    query,
    topK,
    metadataFilter,
    filterInvalidated: !includeInvalidated,   // 用户/Agent 明确要历史时才放开
    enableVersionScoring: true,
  })
}
```

完整签名：

```ts
export interface MemoryWriteInput {
  caseId: number
  kind: 'fact' | 'preference' | 'dialogue_note'
  text: string
  subjectKey?: string
  confidence?: number
  source?: 'manual' | 'consolidator'
}
export interface MemoryHit {
  id: string
  text: string
  score: number
  metadata: CaseMemoryMetadata
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
  /** 放开失效过滤，查询历史版本链（默认 false，仅返最新有效） */
  includeInvalidated?: boolean
}): Promise<Array<MemoryHit>>
```

### 3.3 召回 pipeline 六阶段（复用现有 retrieval 基建 + 新增后处理）

**实施位置**：召回主入口在 `memory.service.ts:recallMemoryService`；① ② ③ 阶段复用项目现有 `retrieval/hybridSearch.service.ts`（只需把 `case_memories` 加入 `ALLOWED_TABLES`）；④ ⑤ ⑥ 为新增后处理纯函数（放 `server/services/memory/postProcess.ts` + `rerankerClient.ts`）。

```
① Query 上下文补齐（**仅代词触发才调 LLM**）
  默认：query 前拼接最近 3 轮 user turn 文本（零 LLM 调用）
  LLM 兜底：query 正则命中代词/指代词（"他/她/它/上次/之前/刚才/那个"）时调 Haiku 4.5 重写
  短 query（≤3 字）跳过此步
  实施位置：memory.service.ts 内部简单 preprocess

② Hybrid Recall (top-50) · **直接复用** hybridSearchService
  调用：hybridSearchService('case_memories', query, 50, { caseId, kind? })
  内部已实现：
    - vectorSearchService + $queryRaw + pgvector <=> 操作符
    - fullTextSearchService + $queryRaw + plainto_tsquery('chinese', ...)
    - reciprocalRankFusion RRF(k=60) 合并
  metadata filter 由 retrieval/fullTextSearch.service.ts:buildParameterizedMetadataFilter 统一参数化
  **不写新 SQL**，仅把 'case_memories' 加入 retrieval/types.ts ALLOWED_TABLES

③ Pre-filter · memory.service.ts 内部 JS 过滤
  - caseId 已通过 metadata filter 硬过滤（在 ② 阶段）
  - 失效过滤：metadata.invalidatedAt 非空 → 丢弃（query 含"历史/曾经"意图时放开）
  - 分数阈值：hybridHit.score < 0.3 → 丢弃

④ Rerank (bge-reranker-v2-m3)
  HTTP POST to http://bge-reranker:8080/rerank
  body: { query, documents: top50.map(m => m.text) }
  取 top-8

⑤ MMR(λ=0.4) + Adaptive K
  fetch_k=8 → 选 5 条多样性覆盖
  Adaptive K：
    - 简单 query（单实体指称）→ K=3
    - 多跳 query（"X 和 Y 的关系"）→ K=5
    - 时序/历史查询：由上层（Agent 工具调用方）传 `includeInvalidated=true` 显式放开（不用正则猜意图）

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
  description: '语义检索当前案件的长期记忆（事实/偏好/对话要点）。当需要回忆之前讨论过的内容时调用。',
  schema: z.object({
    query: z.string().describe('检索关键词或问题'),
    kind: z.enum(['fact', 'preference', 'dialogue_note']).optional(),
    top_k: z.number().default(5),
    /** 当用户明确问"之前/历史/曾经/当初"这类时序追溯问题时，Agent 设为 true 以看到被新事实覆盖的历史版本 */
    include_history: z.boolean().default(false).describe('是否放开已失效记忆（查询历史版本链时用）'),
  }),
}
export function createTool(context: ToolContext) {
  return tool(async ({ query, kind, top_k, include_history }) => {
    const hits = await recallMemoryService({
      caseId: context.caseId,
      query,
      kind,
      topK: top_k,
      includeInvalidated: include_history,
    })
    return JSON.stringify(hits)
  }, toolDefinition)
}
```

类似实现 `write_case_memory.tool.ts` / `update_case_memory.tool.ts`。所有工具**嵌入 caseId**（context 注入，Agent 不能跨案件操作）。

**ARCHIVED 状态保护**：`write_case_memory` / `update_case_memory` 内部先查 `case.status`，若为 ARCHIVED 抛业务错误。

### 3.5 Background consolidator（Q3.1 B：异步 debounce 30s）

**架构**：Redis ZSET + 现有 `CronScheduler`，Haiku 4.5 抽取。

> **为何用 ZSET 而非 `SET EX`**：Redis `SET EX` 到期不主动通知（除非启用 `notify-keyspace-events`），且 `KEYS consolidator:debounce:*` 扫描性能极差。项目已有 `server/plugins/cron-scheduler.ts` 的 `CronScheduler`（带 Redis 分布式锁，`intervalMs + lockTtlSeconds`），直接复用。

```
chat.post.ts 每轮对话结束
  ↓
consolidator.schedule({ caseId, sessionId, lastMessageIdx })
  ↓ ZADD consolidator:due <dueAtTimestamp> <sessionId>
  ↓ （重新 ZADD 会覆盖 score，自然实现 debounce：最后一轮的 dueAt 覆盖前一轮）
  ↓
CronScheduler（每 10s 一次）：
  ↓ ZRANGEBYSCORE consolidator:due 0 <now>     -- 取到期任务
  ↓ ZREM consolidator:due <sessionId>          -- 出队
  ↓ 执行 consolidateSession
```

**实际抽取逻辑**（`server/services/memory/consolidator.service.ts`）：

```ts
async function consolidateSession({ caseId, sessionId, lastMessageIdx }): Promise<void> {
  // 1. 取最近 N 条 messages（从 last consolidator run 之后）
  const messages = await loadRecentMessages(sessionId, fromIdx)

  // 2. Haiku 4.5 按 schema 抽取（复用现有 createChatModel factory）
  const haikuLLM = createChatModel({
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
    image: ghcr.io/huggingface/text-embeddings-inference:cpu-1.9
    command:
      - --model-id=BAAI/bge-reranker-v2-m3
      - --port=8080
    # 注：reranker 是 cross-encoder 类型，TEI 自动识别模型 task，不需要 --pooling 参数
    ports:
      - "8090:8080"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 120s   # 首次冷启 CPU 约 2-3min
```

**客户端封装**（`server/services/memory/rerankerClient.ts`）：

```ts
// TEI /rerank 响应格式（官方）：`[{ index: number, score: number, text?: string }]`
// 数组**已按分数倒序**，但 `index` 指向原 texts 数组位置，我们用 index 回填 doc.id
export async function rerankDocuments(
  query: string,
  docs: Array<{ id: string; text: string }>,
): Promise<Array<{ id: string; score: number }>> {
  const res = await $fetch<Array<{ index: number; score: number }>>(
    `${process.env.RERANKER_URL}/rerank`,
    {
      method: 'POST',
      body: { query, texts: docs.map(d => d.text), raw_scores: false },
      timeout: 5000,
    },
  )
  return res.map(r => ({ id: docs[r.index]!.id, score: r.score }))
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

**新表 `case_analysis_embeddings`**（LangChain PGVectorStore 同构 schema，同 case_memories 决策）：

```prisma
/// 案件分析产物向量表（LangChain PGVectorStore 同构）
/// 写入走 addDocumentsToVectorStore；查询热字段放 metadata JSON + expression index
/// 注意：此表结构对齐 LangChain 约定，不允许新增查询列（会破坏框架写入）
model caseAnalysisEmbeddings {
  id        String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  text      String?                  @db.Text
  /// metadata JSON：{ caseId, analysisId, nodeId, analysisType, version, isActive, chunkIndex }
  metadata  Json?
  embedding Unsupported("vector")?
  tsv       Unsupported("tsvector")?

  @@index([tsv], type: Gin, map: "idx_case_analysis_tsv")
  @@map("case_analysis_embeddings")
}
```

**手工追加 SQL**（`prisma/migrations/<ts>_add_case_analysis_rag/migration.sql`，用 `--create-only` 后追加）：

```sql
-- （幂等）同 case_memories migration，确保 chinese 配置存在
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
    CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END $$;

-- 与 caseMaterialEmbeddings 同模式
CREATE INDEX IF NOT EXISTS "idx_case_analysis_embedding"
  ON "case_analysis_embeddings" USING hnsw (embedding vector_cosine_ops);

-- metadata 热查询字段 expression index
CREATE INDEX IF NOT EXISTS "idx_case_analysis_meta_active"
  ON "case_analysis_embeddings" ((metadata->>'caseId'), (metadata->>'analysisType'))
  WHERE metadata->>'isActive' = 'true';
CREATE INDEX IF NOT EXISTS "idx_case_analysis_meta_analysis"
  ON "case_analysis_embeddings" ((metadata->>'analysisId'));
```

**tsv 维护**：同 caseMemories，手工回填（setupRetrievalInfra 模式）。

### 4.2 生成路径（Q4.1 A：同步）

修改 `initAnalysis.service.ts`（模块分析完成写库时）：

```ts
import { addDocumentsToVectorStore } from '~/server/services/legal/vectorStore.service'

async function completeAnalysisService({ analysisId, result, model }) {
  // 先把主分析结果和 summary 落库（一个事务内）
  const analysis = await prisma.$transaction(async tx => {
    // 1. 写 analysisResult
    const updated = await tx.caseAnalyses.update({
      where: { id: analysisId },
      data: { status: 2, analysisResult: result, /* ... */ },
    })

    // 2. 同步生成 summary（主模型，与分析同源，Q4.2 AI 拍板）
    const summary = await generateSummary(model, result, { maxChars: 400 })
    await tx.caseAnalyses.update({ where: { id: analysisId }, data: { summary } })

    return updated
  }, { timeout: 15_000 })

  // 3. 切块 + 写 embeddings（走 LangChain 框架 API，不进上一个事务）
  //    失败不影响主分析落库（已 commit），仅影响 RAG 检索能力，日志告警即可
  try {
    const chunks = splitByParagraph(result, { maxTokens: 500 })
    const docs = chunks.map((chunk, i) => ({
      pageContent: chunk,
      metadata: {
        caseId: analysis.caseId,
        analysisId: analysis.id,
        nodeId: analysis.nodeId,
        analysisType: analysis.analysisType,
        version: analysis.version,
        isActive: true,
        chunkIndex: i,
      },
    }))
    const ids = chunks.map(() => crypto.randomUUID())
    await addDocumentsToVectorStore(docs, ids, { tableName: 'case_analysis_embeddings' })

    // 手工回填 tsv（addDocumentsToVectorStore 不写 tsv）
    await prisma.$executeRawUnsafe(`
      UPDATE case_analysis_embeddings
      SET tsv = to_tsvector('chinese', COALESCE(text, ''))
      WHERE id = ANY($1::uuid[]) AND tsv IS NULL
    `, ids)
  } catch (e) {
    logger.warn('case_analysis_embeddings 写入失败，主分析已完成；RAG 检索此版本暂不可用', { analysisId, error: e })
  }

  // 用户侧 toast："分析完成"（界面给反馈，A6 拍板）
}
```

**事务边界说明**：主分析 + summary 一个事务（~1-3s）保证原子性；embedding 切块/写入在事务外（~2-3s），失败只影响 RAG 检索，不回滚主分析。两段串行总延迟 3-5s，界面显示进度。

### 4.3 切版本同步 metadata

`switchActiveVersionService`（现有）增加 embedding 同步：

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
    SET metadata = jsonb_set(metadata, '{isActive}', to_jsonb(false))
    WHERE metadata->>'caseId' = $1
      AND metadata->>'nodeId' = $2
      AND (metadata->>'version')::int <> $3
  `, caseId.toString(), nodeId.toString(), newVersion)
  await tx.$executeRawUnsafe(`
    UPDATE case_analysis_embeddings
    SET metadata = jsonb_set(metadata, '{isActive}', to_jsonb(true))
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
    const metadataFilter: Record<string, string | number | boolean> = { caseId: context.caseId }
    if (analysis_type) metadataFilter.analysisType = analysis_type
    if (!include_all_versions) metadataFilter.isActive = true

    // 复用公共入口 retrieveWithReranking（M3/M4 共享，避免重复拼装 hybrid+rerank+MMR）
    const hits = await retrieveWithReranking({
      tableName: 'case_analysis_embeddings',
      query,
      topK: top_k,
      metadataFilter,
      enableVersionScoring: false,   // M4 用 isActive 过滤代替版本链降权
    })
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

<!-- §5 数据模型汇总已删除，与 §7 改动清单的"数据库"小节重叠。唯一 DB 改动权威在 §7。 -->

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
- `app/components/caseCreation/ManualForm.vue`：表单 +5 字段平铺 + 状态下拉
- `app/composables/useCaseCreation.ts`：AI 回填只填空字段逻辑（`formInitialData` 合并时跳过已填字段）
- **`app/components/cases/CaseStatusBadge.vue`（新建）**：统一 6 档状态徽章（图标 lucide + 语义色 + 深浅模式），抽离现有 `CasesTable.vue` / `CasesGrid.vue` / `CasesMobile.vue` 里各自重复的 `getStatusText` / `getStatusBadgeClass` 逻辑
- `app/components/cases/CasesTable.vue` / `CasesGrid.vue` / `CasesMobile.vue`：改为使用 `CaseStatusBadge`（顺手消除三份重复代码）

### 后端 Service
- `server/services/workflow/context/moduleContextBuilder.ts`：重构为 5 段式
- `server/services/material/materialPipeline.service.ts`：清单+摘要 + 材料就绪时触发 summary 生成
- `server/services/material/material.service.ts`：100 字摘要生成 helper（Haiku 4.5）
- `server/services/case/caseExtraction.service.ts`：schema +5 字段 / 移除 basic_info 写入
- `server/services/case/initAnalysis.service.ts`：分析完成时同步生成 summary → 事务外走 addDocumentsToVectorStore 写 embeddings
- `server/services/case/analysis.service.ts`：`switchActiveVersionService`（现有，analysis.service.ts:583）扩展为同步 metadata.isActive（`jsonb_set` + `to_jsonb(bool)`）
- `server/services/node/chatModelFactory.ts`：三家 adapter 接受 `CachedPrompt` 分段输入 + 读对应响应字段落日志
- **`server/services/retrieval/types.ts`：`ALLOWED_TABLES` 加 `case_memories` / `case_analysis_embeddings`**（关键复用点）
- `server/services/memory/memory.service.ts`：新建
  - `writeMemoryService` 复用 `addDocumentsToVectorStore` + 手工回填 tsv + 版本链 `jsonb_set(invalidatedAt)`
  - `updateMemoryService` `jsonb_set` 更新 metadata
  - `recallMemoryService` 调 `hybridSearchService`（①②③）+ 后接 postProcess 三函数（④⑤⑥）
- `server/services/memory/postProcess.ts`：新建 `rerankPostProcess` / `mmrFilter` / `subjectVersionScoring` 三个纯函数
- `server/services/memory/retrieveWithReranking.ts`：**公共入口**（封装 ①~⑥ 流水线）。`recallMemoryService` 传 `{ enableVersionScoring: true }`；`search_case_analysis` 传 `false`。避免 M3/M4 各写一份
- `server/services/ai/summaryService.ts`：**新建通用 summary helper**（`generateSummary(model, text, { maxChars, systemPrompt? })`），被 §2.4 材料摘要（Haiku 4.5 100字）和 §4.2 分析摘要（主模型 400字）共用
- `server/services/memory/rerankerClient.ts`：新建（HTTP 调 TEI）
- `server/services/memory/consolidator.service.ts`：新建（Redis SET debounce 30s + Haiku 4.5 抽取）

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

| 维度 | 初始目标（上线后按日志校准） |
|---|---|
| 性能 | M2 后单次 chat system prompt < 4K tokens（不含召回）；M3 召回 p95 < 500ms；M4 摘要生成 < 3s |
| Prompt Cache 命中率 | Anthropic ≥ 60%；OpenAI / DeepSeek ≥ 30% |
| 旧数据兼容性 | 迁移后 status=2,3 → 99 无报错；缺 summary 的旧分析产物不阻塞对话 |

> ARCHIVED 行为、Reranker / Consolidator 降级、迁移安全等已在各自章节（§1.4 / §3.3 / §3.5 / §12）明确，不在此重复。

---

## 9. 风险与回归点

| 风险 | 缓解 |
|---|---|
| **5 段 prompt 结构改动破坏现有 Agent**（主线风险）| 灰度：先在 `initAnalysis` 模块启用 M2，观察 3 天；再推广到小索/法律助手 |
| **状态迁移 SQL 在生产跑误伤** | 脚本附带 `BEGIN; UPDATE ...; SELECT ... LIMIT 20; ROLLBACK;` 预演；正式执行前 DBA 复核 |
| **外部依赖降级**（bge-reranker / consolidator LLM 抽取失败） | reranker：跳过 ④ 阶段走 hybrid 分数；consolidator：best-effort logger.warn，下轮 schedule 重试 |
| **LangChain PGVectorStore 写入约束被后续维护者破坏**（本期新增独特风险）| §12 铁律明示：两张新表严禁新增查询列；代码评审必查 |

---

## 10. 测试策略

### 单测（纯函数为主，不触 DB/网络）
- `postProcess.spec.ts`：`mmrFilter` / `subjectVersionScoring` / `recencyDecay` 输入输出正确性
- `summaryService.spec.ts`：`generateSummary` 对不同 maxChars 参数的截断行为（mock LLM 返回）
- `moduleContextBuilder.spec.ts`：5 段结构输出字段正确，cache_control 标记位置（不含 LLM 调用）
- `CaseStatus.spec.ts`：枚举值、文案映射、ARCHIVED 只读判断

### 集成测（走测试库 + 真 pgvector）
- `memoryService.integration.spec.ts`：writeMemoryService 版本链（subjectKey 覆盖 invalidatedAt）；recallMemoryService 端到端（含 hybridSearchService 真查询，mock bge-reranker）
- `consolidator.integration.spec.ts`：ZSET 入队/出队 debounce；LLM 抽取走 mock；confidence 过滤；失败 best-effort
- `switchActiveVersionService.integration.spec.ts`：metadata.isActive 原子同步
- 状态迁移 SQL dry-run（测试库跑一遍预期结果）
- Prompt Caching 三家 adapter：每个发 identical system 两次，第二次 `cached_tokens > 0`（按各家字段名）

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
Phase 1 (M1)   字段 + 状态 + 表单 + 存量迁移           ~2 天
               独立可上线

Phase 2 (M2+M3 合并发布)
  - M2: moduleContextBuilder 5 段化 + 三家 Caching + 材料改造 + 废弃 basic_info
  - M3: case_memories 表 + Service + 3 工具 + bge-reranker infra + 召回 pipeline + consolidator
  合计 ~8 天
  **合并理由**：M2 的 ⑤ 段（召回记忆）内容由 M3 的 recallMemoryService 产出；M2 先上线会出现"prompt 第 ⑤ 段为空"的过渡态无意义

Phase 3 (M4)   caseAnalyses.summary + embedding 表     ~3 天
               switchActiveVersionService 同步 + search_case_analysis 工具
               独立可上线（不依赖 M2/M3 上线节奏，但共享 retrieveWithReranking 抽象）
```

总计约 13 工作日；Phase 1 与 Phase 3 独立可上线；Phase 2 合并发布。

---

## 12. 铁律清单（编码时逐条核验）

- [ ] 所有数据库变更走 `bun run prisma:migrate` 正式生成；tsv / expression index / `CREATE TEXT SEARCH CONFIGURATION chinese` 手工补充需用 `--create-only`
- [ ] `case_memories` / `case_analysis_embeddings` **严格保持 LangChain PGVectorStore 同构 schema**（id/text/metadata/embedding/tsv），**严禁新增业务字段列**（会破坏 `addDocumentsToVectorStore`）；查询字段一律走 `metadata->>` + expression index
- [ ] 写入走 `addDocumentsToVectorStore(docs, ids, { tableName })`（注意参数顺序！），查询走 `hybridSearchService`（新表需加入 `ALLOWED_TABLES`）；**禁止再自建一套 CRUD**
- [ ] 召回 query 始终硬过滤 `caseId`（Agent 不能跨案件读记忆 / 不能跨案件读分析）
- [ ] `write_case_memory` / `update_case_memory` / `initAnalysis` / `updateCase` 服务端全部 check `case.status !== ARCHIVED`（前端灰化不够，服务端必须挡）
- [ ] Prompt Cache Anthropic 断点顺序：1h TTL 段在 5m TTL 段**之前**，且合计 `cache_control` ≤ 4 个（含 tools + system + messages）
- [ ] 外部依赖降级：bge-reranker 不可达 → 跳过 ④ 阶段走 hybrid 分数；consolidator 抽取失败 → logger.warn，不抛不熔断
