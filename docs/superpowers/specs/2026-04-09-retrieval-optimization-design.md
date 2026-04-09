# 检索系统架构级优化设计

## 概述

LexSeek 的案件材料检索和法律条文检索效果不佳，存在四类核心问题：

1. **法律条文检索不准** — 语义搜索返回不相关条文，漏召回关键条文
2. **案件材料检索不准** — 返回的材料片段不相关，无法找到关键信息
3. **精确查找失败** — "民法典第1000条"这类精确引用走语义搜索，完全找不到
4. **AI 不善于使用工具** — 不知道何时该调用检索工具，传入的 query 质量差

本设计通过 **智能路由 + 多通道检索 + Rerank 精排** 架构，从根本上解决以上问题。

## 现状分析

### 数据规模

| 维度 | 法律检索 | 案件材料检索 |
|------|---------|------------|
| 向量表 | `law_embeddings` | `case_material_embeddings` |
| 记录数 | ~142,000 | ~36（早期阶段） |
| 法律数 | 4,836 部 | - |
| 条文数 | 141,795 条 | - |
| Embedding 模型 | text-embedding-v3 (1536维) | 同左 |
| 向量索引 | **无**（全表扫描） | **无** |
| 全文索引 | **无** | **无** |

### 法律条文内容长度分布

| 类型 | 数量 | P50 | P90 | P95 | >2000字符占比 |
|------|------|-----|-----|-----|-------------|
| l5（条） | 127,839 | 95 | 246 | 318 | 0.02% |
| l3（节） | 14,601 | 0 | 89 | 408 | 0.36% |
| l1（编） | 7,038 | 108 | 917 | 1,342 | 2.05% |
| header | 4,813 | 99 | 291 | 369 | 0.27% |
| annex（附件） | 204 | 488 | 2,185 | 3,740 | 11.27% |

**结论**：99.8% 的条文生成 1 个向量块，当前法律分块阈值 2000 合理，不调整。

### 现有问题根因

1. **无相似度阈值过滤** — 低分噪声结果被返回
2. **无 Rerank** — 纯粹依赖向量余弦距离排序
3. **无关键词检索** — 条文编号、当事人姓名等精确匹配场景，向量搜索无能为力
4. **Embedding 文本格式不佳** — 元信息前缀（文件/类型/章节）占比过高，稀释内容语义
5. **无向量索引** — 14万条记录全表扫描
6. **legalName 精确匹配** — AI 传入"民法典"匹配不到"中华人民共和国民法典"
7. **材料上下文 full/summary 二选一** — 过于粗糙，信息损失大

## 架构设计

### 总体架构

```
用户/AI Query
     │
     ▼
┌──────────────────────────┐
│  search_intent_router    │  ← node (type=extraction)
│  LLM 意图路由节点         │     轻量模型（qwen-turbo）
│                          │
│  输入: query 原文         │
│  输出: {                 │
│    intent: exact|hybrid| │
│            semantic      │
│    legalName?: string    │
│    articleRef?: string   │
│    keywords?: string[]   │
│    rewrittenQuery?: str  │
│  }                       │
└──────────┬───────────────┘
           │
     ┌─────┼─────┐
     ▼     ▼     ▼
  精确    混合   语义
  通道    通道   通道
     │     │     │
     │  ┌──┴──┐  │
     │  ▼     ▼  │
     │ BM25 Vector│
     │  │     │  │
     │  └──┬──┘  │
     │  RRF融合  │
     │     │     │
     └──┬──┴──┬──┘
        ▼
  ┌────────────┐
  │ Rerank 精排 │  ← 阿里云百炼 API
  └─────┬──────┘
        ▼
   阈值过滤 + 返回
```

### 三个检索通道

| 通道 | 触发条件 | 适用场景 | 示例 |
|------|---------|---------|------|
| **精确通道** | 查询包含法律名称+条文编号 | 查找特定法条 | "民法典第1000条" |
| **混合通道** | 查询包含法律关键词但无明确条文编号 | 关键词+语义结合 | "劳动合同法关于经济补偿" |
| **语义通道** | 通用自然语言描述 | 语义理解 | "员工被无故辞退后如何索赔" |

适用范围：

| 通道 | 法律检索 | 案件材料检索 |
|------|---------|------------|
| 精确 | 支持 | 不适用（无条文编号概念） |
| 混合 | 支持 | 支持 |
| 语义 | 支持 | 支持 |

## 模块一：LLM 意图路由

### 节点配置

通过项目已有的 nodes 模块管理，创建一个 `search_intent_router` 节点：

| 配置项 | 值 |
|--------|---|
| name | `search_intent_router` |
| type | `extraction`（支持 outputSchema） |
| model | 轻量快速模型（qwen-turbo 或同级） |
| tools | 无（纯推理） |

### outputSchema

```json
{
  "type": "object",
  "properties": {
    "intent": {
      "enum": ["exact", "hybrid", "semantic"],
      "description": "检索意图类型"
    },
    "legalName": {
      "type": "string",
      "description": "识别到的法律名称"
    },
    "articleRef": {
      "type": "string",
      "description": "条文编号，如 第一千条"
    },
    "keywords": {
      "type": "array",
      "items": { "type": "string" },
      "description": "提取的法律术语关键词"
    },
    "rewrittenQuery": {
      "type": "string",
      "description": "改写后的语义查询，用于向量搜索"
    }
  },
  "required": ["intent"]
}
```

### System Prompt 核心逻辑

```
你是法律检索意图分类器。根据用户的查询，判断最佳检索策略：

1. exact（精确查找）— 用户明确引用了某部法律的某个条文
   示例："民法典第1000条"、"刑法第264条"、"劳动合同法第46条第2款"
   → 提取 legalName + articleRef

2. hybrid（混合检索）— 包含特定法律术语或法律名称，但没有精确条文编号
   示例："劳动合同法关于经济补偿的规定"、"公司法股东权益保护"
   → 提取 legalName + keywords + rewrittenQuery

3. semantic（语义检索）— 自然语言描述法律问题
   示例："员工被无故辞退后如何索赔"、"房屋买卖合同纠纷的赔偿标准"
   → 提取 keywords + rewrittenQuery
```

### 设计优势

- **准确度高**：LLM 能理解"民法典第一千条"和"民法典第1000条"是同一个东西
- **Query Rewriting 一并完成**：路由器同时输出 `rewrittenQuery`，不需要额外 LLM 调用
- **关键词提取**：LLM 提取法律术语关键词，供 BM25 通道使用
- **可配置**：通过 nodes 管理 prompt，可随时调整分类策略，不需要改代码
- **版本化**：prompt 版本管理机制支持 A/B 测试

### 性能考量

- 使用轻量模型（qwen-turbo），延迟约 200-500ms
- 一次准确的路由比多次错误的向量搜索要快得多
- 案件材料检索简化为 hybrid/semantic 二选一（无精确通道）

## 模块二：精确检索通道

专门解决"民法典第1000条"类查询。核心思路：**绕过向量搜索，直接查 `legal_articles` 表**。

### 查询流程

```
LLM Router 输出: { intent: "exact", legalName: "民法典", articleRef: "第一千条" }
                          │
                          ▼
                ┌──────────────────┐
                │ 1. 法律名称匹配   │  legal_main 表
                │    LIKE '%民法典%' │  → 匹配到"中华人民共和国民法典"
                └────────┬─────────┘
                         │ legalId
                         ▼
                ┌──────────────────┐
                │ 2. 条文编号匹配   │  legal_articles 表
                │    l5 LIKE '%第一千条%' │
                │    OR l4/l3 匹配  │
                └────────┬─────────┘
                         │ 精确命中条文
                         ▼
                ┌──────────────────┐
                │ 3. 上下文扩展     │  取命中条文的前后 N 条
                │    同章节相邻条文  │
                └────────┬─────────┘
                         │
                         ▼
                    返回结果（无需 Rerank）
```

### 法律名称模糊匹配

用户可能说"民法典"，数据库存的是"中华人民共和国民法典"。使用 `pg_trgm` + SQL LIKE 双重匹配：

```typescript
const legal = await prisma.legalMain.findFirst({
    where: {
        OR: [
            { name: legalName },                    // 精确
            { name: { contains: legalName } },      // 包含
        ],
        deletedAt: null,
    },
})
```

### 条文编号匹配

LLM 路由器输出的 `articleRef` 可能是多种形式（"第一千条"、"第1000条"等）。在 l5/l3 列中搜索：

```typescript
const articles = await prisma.legalArticles.findMany({
    where: {
        legalId: legal.id,
        deletedAt: null,
        OR: [
            { l5: { contains: articleRef } },
            { l3: { contains: articleRef } },
        ],
    },
    orderBy: { order: 'asc' },
})
```

### 上下文扩展

命中条文后，自动关联同章节的相邻条文（前后各 2 条）：

```typescript
const contextArticles = await prisma.legalArticles.findMany({
    where: {
        legalId: legal.id,
        deletedAt: null,
        order: { gte: hitArticle.order - 2, lte: hitArticle.order + 2 },
    },
    orderBy: { order: 'asc' },
})
```

### 返回格式

与现有 `searchLaw` 返回格式一致，确保下游兼容：

```typescript
{
    score: 1.0,  // 精确匹配固定分数
    content: article.content,
    metadata: {
        legal_name, document_number, chapter_hierarchy,
        publish_date, effective_date, invalid_date,
        retrieval_mode: 'exact',
    }
}
```

### 无命中兜底

精确通道未命中时（法律名称不存在、条文编号无匹配），自动降级到**混合通道**。

## 模块三：混合检索通道（BM25 + Vector + RRF）

### 架构

```
LLM Router 输出: { intent: "hybrid", keywords: [...], rewrittenQuery: "..." }
              │
  ┌───────────┴───────────┐
  ▼                       ▼
BM25 关键词检索         Vector 语义检索
zhparser + tsvector     HNSW 索引加速
k = topN * 2            k = topN * 2
  │                       │
  └───────────┬───────────┘
              ▼
     RRF 融合排序 (k=60)
              │
              ▼
     Rerank 精排（阿里云百炼）
              │
              ▼
       阈值过滤 + top-K
```

### BM25 通道 — zhparser 中文全文检索

环境支持情况：
- **测试/生产（阿里云 RDS）**：原生支持 zhparser，直接 `CREATE EXTENSION zhparser`
- **开发环境（Docker）**：构建自定义镜像，基于 `pgvector/pgvector:pg17` 编译安装 zhparser

数据库变更：

```sql
CREATE EXTENSION IF NOT EXISTS zhparser;

CREATE TEXT SEARCH CONFIGURATION IF NOT EXISTS chinese (PARSER = zhparser);
ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR
  n,v,a,i,e,l,j,d,f,r,p,q,m,k,u,s,y,z,x,w,h WITH simple;

-- tsvector 列 + trigger（trigger 对 PGVectorStore 和 Prisma 透明）
ALTER TABLE law_embeddings ADD COLUMN IF NOT EXISTS tsv tsvector;
-- trigger 和初始填充由 setupRetrievalInfra.ts 脚本管理

CREATE INDEX IF NOT EXISTS idx_law_embeddings_tsv
  ON law_embeddings USING GIN(tsv);

-- case_material_embeddings 同样处理
ALTER TABLE case_material_embeddings ADD COLUMN IF NOT EXISTS tsv tsvector;

CREATE INDEX IF NOT EXISTS idx_case_material_tsv
  ON case_material_embeddings USING GIN(tsv);
```

BM25 查询：

```typescript
/** 允许查询的表名白名单 */
const ALLOWED_TABLES = new Set(['law_embeddings', 'case_material_embeddings'])

async function fullTextSearch(
    tableName: string,
    keywords: string[],
    k: number,
    metadataFilter?: Record<string, string | number | boolean>,
): Promise<SearchResultItem[]> {
    // 表名白名单验证，防止 SQL 注入
    if (!ALLOWED_TABLES.has(tableName)) {
        throw new Error(`非法表名: ${tableName}`)
    }

    // 使用 plainto_tsquery 自动处理特殊字符，避免 tsquery 注入
    // 将多个关键词合并为一个查询字符串
    const searchText = keywords.join(' ')

    // metadata 过滤条件使用参数化查询构建
    const { filterSQL, filterParams } = buildParameterizedMetadataFilter(
        metadataFilter, 2  // 从 $2 开始（$1 是 searchText）
    )

    const query = `
        SELECT text, metadata,
               ts_rank_cd(tsv, plainto_tsquery('chinese', $1)) as score
        FROM ${tableName}
        WHERE tsv @@ plainto_tsquery('chinese', $1)
          ${filterSQL}
        ORDER BY score DESC
        LIMIT $${filterParams.length + 2}
    `
    const params = [searchText, ...filterParams, k]
    // ...
}

/** 允许的 metadata 过滤字段白名单 */
const ALLOWED_METADATA_KEYS = new Set([
    'legal_id', 'legal_name', 'legal_type', 'article_type',
    'userId', 'sourceId', 'source',
])

/**
 * 构建参数化 metadata 过滤条件
 * 将结构化 filter 对象转为安全的参数化 SQL
 */
function buildParameterizedMetadataFilter(
    filter: Record<string, string | number | boolean> | undefined,
    startParamIndex: number,
): { filterSQL: string; filterParams: unknown[] } {
    if (!filter || Object.keys(filter).length === 0) {
        return { filterSQL: '', filterParams: [] }
    }
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIdx = startParamIndex

    for (const [key, value] of Object.entries(filter)) {
        // metadata key 白名单验证
        if (!ALLOWED_METADATA_KEYS.has(key)) {
            throw new Error(`非法 metadata 过滤字段: ${key}`)
        }
        conditions.push(`metadata->>'${key}' = $${paramIdx}`)
        params.push(String(value))
        paramIdx++
    }

    return {
        filterSQL: conditions.map(c => ` AND ${c}`).join(''),
        filterParams: params,
    }
}
```

**安全设计要点**：
- `tableName` 使用白名单验证，只允许 `law_embeddings` 和 `case_material_embeddings`
- 使用 `plainto_tsquery` 替代 `to_tsquery`，自动处理 tsquery 特殊字符（`&`, `|`, `!` 等）
- `metadataFilter` 为结构化对象，通过参数化查询构建 WHERE 条件，杜绝 SQL 注入
```

### pg_trgm 保留作为补充

zhparser 做主力 BM25，pg_trgm 作为兜底模糊匹配（法律名称模糊搜索等场景）：

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_law_embeddings_text_trgm
  ON law_embeddings USING GIN(text gin_trgm_ops);
```

### Vector 语义检索 — HNSW 索引

```sql
-- 法律向量表
CREATE INDEX IF NOT EXISTS idx_law_embeddings_hnsw
  ON law_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- 案件材料向量表
CREATE INDEX IF NOT EXISTS idx_case_material_hnsw
  ON case_material_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

语义检索使用 LLM 路由器输出的 `rewrittenQuery`（改写后的查询），而非 AI 原始 query。

搜索时设置 `ef_search` 控制精度/速度平衡：

```sql
SET hnsw.ef_search = 100;  -- 默认 40，提高到 100 确保召回质量
```

### RRF（Reciprocal Rank Fusion）融合排序

```typescript
/**
 * 提取文档唯一标识，用于 RRF 去重
 * - law_embeddings: metadata.articles_id（条文 ID）
 * - case_material_embeddings: `${metadata.sourceId}_${metadata.chunkIndex}`
 */
function extractDocId(item: SearchResultItem, type: 'law' | 'case_material'): string {
    if (type === 'law') {
        return item.metadata.articles_id as string
    }
    return `${item.metadata.sourceId}_${item.metadata.chunkIndex}`
}

function reciprocalRankFusion(
    bm25Results: SearchResultItem[],
    vectorResults: SearchResultItem[],
    type: 'law' | 'case_material',
    k: number = 60,  // RRF 常数
): SearchResultItem[] {
    const scoreMap = new Map<string, { score: number; item: SearchResultItem }>()

    bm25Results.forEach((item, rank) => {
        const id = extractDocId(item, type)
        const rrf = 1 / (k + rank + 1)
        const existing = scoreMap.get(id)
        if (existing) existing.score += rrf
        else scoreMap.set(id, { score: rrf, item })
    })

    vectorResults.forEach((item, rank) => {
        const id = extractDocId(item, type)
        const rrf = 1 / (k + rank + 1)
        const existing = scoreMap.get(id)
        if (existing) existing.score += rrf
        else scoreMap.set(id, { score: rrf, item })
    })

    return [...scoreMap.values()]
        .sort((a, b) => b.score - a.score)
        .map(v => ({ ...v.item, score: v.score }))
}
```

RRF 只看排名不看绝对分数，天然解决 BM25 vs 向量距离的量纲归一化问题。

### 语义通道

混合通道的简化版：**只走 Vector 检索 + Rerank**，不走 BM25。适用于纯自然语言查询。`semanticSearch.service.ts` 作为独立文件维护，内部复用 `hybridSearch.service.ts` 中的向量检索逻辑（提取为共享的 `vectorSearch` 内部函数），但跳过 BM25 和 RRF 步骤。

## 模块四：Rerank 精排服务

### 服务设计

```
粗检索结果 (top N*3, 最多 20 条)
       │
       ▼
┌──────────────────────┐
│   RerankService       │
│  阿里云百炼 API       │
│  模型: gte-rerank-v2  │
└──────────┬───────────┘
           │
           ▼
    阈值过滤 → top-K
```

### API 集成

```typescript
interface RerankResult {
    index: number           // 原始文档索引
    relevanceScore: number  // 0~1 相关度分数
}

async function rerankService(
    query: string,
    documents: string[],
    topK: number,
    model?: string,
): Promise<RerankResult[]>
```

### 配置管理

复用 `model_providers` + `models` 表：

- `models` 表新增 Rerank 模型记录，`modelType` 字段设为 `rerank`（现有字段为 `VarChar(20)`，无 enum 约束）
- 配置获取优先级：**数据库配置 > 环境变量 `NUXT_RERANK_*` 回退**
- 在 `server/services/model/modelConfig.service.ts` 中新增 `getRerankConfigWithFallbackService` 函数：
  - 查询 `models` 表 `modelType='rerank'` 且 `status=1` 的记录
  - 关联 `model_providers` 获取 baseUrl
  - 关联 `model_api_keys` 获取 `isDefault=true` 的密钥
  - 若数据库无记录，回退到 `NUXT_RERANK_API_KEY` / `NUXT_RERANK_BASE_URL` / `NUXT_RERANK_MODEL` 环境变量

### 阿里云百炼 Rerank API 调用

百炼 Rerank API 使用 OpenAI 兼容格式，通过 HTTP POST 调用：

```typescript
// POST ${baseUrl}/v1/rerank
// Headers: { Authorization: `Bearer ${apiKey}`, Content-Type: 'application/json' }
// Body:
{
    model: 'gte-rerank-v2',
    query: '查询文本',
    documents: ['文档1', '文档2', ...],
    top_n: 5,
}
// Response:
{
    results: [
        { index: 0, relevance_score: 0.95 },
        { index: 2, relevance_score: 0.87 },
        ...
    ]
}
```

API 文档参考：[阿里云百炼 Rerank](https://help.aliyun.com/zh/model-studio/text-rerank-api)

### 阈值过滤

| 场景 | 阈值 | 理由 |
|------|------|------|
| 法律检索 | 0.3 | 法律条文与 query 语义距离可能较远，但仍相关 |
| 案件材料检索 | 0.2 | 材料内容更发散，阈值更宽松 |

通过环境变量配置：

```bash
NUXT_LAW_RERANK_THRESHOLD=0.3
NUXT_MATERIAL_RERANK_THRESHOLD=0.2
```

### 性能保护

- **最大输入文档数**：20 条（粗检索取 top 20 送入 Rerank）
- **超时保护**：Rerank API 调用超时 5s，超时跳过精排，返回粗检索结果
- **降级策略**：Rerank API 不可用时，自动降级为仅向量搜索排序

### 调用时机

| 通道 | Rerank | 理由 |
|------|--------|------|
| 精确 | 否 | 精确匹配结果已确定 |
| 混合 | 是 | RRF 融合后需要精排 |
| 语义 | 是 | 向量排序不够精确 |

## 模块五：Embedding 文本优化 + 向量索引

### 法律条文 Embedding 文本格式

当前格式（元信息在前，权重被放大）：

```
文件：金融企业准备金计提管理办法
类型：法规
章节：第一章 总则 - 第三条
内容：本办法所称准备金...
```

改为内容优先，元信息后置辅助：

```
本办法所称准备金，又称拨备，是指金融企业对承担风险和损失的金融资产计提的准备金...

——《金融企业准备金计提管理办法》第一章 总则 > 第三条
```

metadata 中保留完整结构化元信息（不变）。embedding 向量主要编码内容语义，检索时 query 和 document 在语义空间更对齐。

### 案件材料 Embedding 文本格式

当前是纯内容（无前缀元信息），合理，**不修改**。

### 法律条文分块策略

数据分析确认 99.8% 的条文生成 1 个向量块。当前 `TEXT_CHUNK_SIZE = 2000` 合理，**不调整**。

### 案件材料分块策略

```typescript
// 旧参数
const defaultSplitterConfig = { chunkSize: 1000, chunkOverlap: 100 }

// 新参数
const defaultSplitterConfig = { chunkSize: 1500, chunkOverlap: 200 }
```

理由：法律文档段落完整性重要，1500 字符覆盖大多数完整段落；overlap 200 确保段落边界信息不丢失。

### HNSW 向量索引

见模块三中的 SQL。参数说明：
- `m=16`：每个节点最大连接数，1536 维向量的推荐值
- `ef_construction=200`：构建时搜索宽度，越大索引质量越好
- 法律表 14 万条，HNSW 构建预计 2-5 分钟（使用 `CONCURRENTLY` 选项避免锁表）

### Metadata 查询索引

```sql
CREATE INDEX IF NOT EXISTS idx_law_emb_legal_id
  ON law_embeddings ((metadata->>'legal_id'));
CREATE INDEX IF NOT EXISTS idx_law_emb_legal_name
  ON law_embeddings ((metadata->>'legal_name'));
CREATE INDEX IF NOT EXISTS idx_case_material_emb_userid
  ON case_material_embeddings ((metadata->>'userId'));
CREATE INDEX IF NOT EXISTS idx_case_material_emb_sourceid
  ON case_material_embeddings ((metadata->>'sourceId'));
```

### 重建流程

法律向量全量重建（embedding 文本格式变了），通过 `server/scripts/rebuildLawEmbeddings.ts` 执行：

1. 按批次遍历所有法律（每批 10 部）
2. 删除旧嵌入 → 用新格式重建
3. 支持断点续传（记录已处理的 legalId）

## 模块六：工具层改造

### 统一检索入口

```
searchLawTool / searchCaseMaterialsTool
            │
            ▼
  retrievalRouter.service.ts    ← 统一检索入口
            │
    ┌───────┼───────┐
    ▼       ▼       ▼
  exact   hybrid  semantic
            │
            ▼
       rerank + 过滤
            │
            ▼
       格式化返回
```

### searchLawTool 改造

法律搜索工具存在两层文件：
- **服务层**：`server/services/legal/searchLaw.tool.ts` — 包含 `searchLaw()` 核心函数
- **工作流工具层**：`server/services/workflow/tools/searchLaw.tool.ts` — 包装服务层并注册为 LangGraph 工具

改造策略：**修改服务层的 `searchLaw()` 函数**，工作流工具层自然继承变更，无需额外修改。

工具参数 schema 不变（保持 AI 调用兼容），内部逻辑替换为走路由器：

```typescript
export const searchLawTool = tool(
    async (input: SearchLawParams): Promise<string> => {
        // 有 query → 走路由器
        if (input.query) {
            const results = await retrievalRouterService({
                query: input.query,
                type: 'law',
                k: input.k || 5,
                // metadataFilter 只传 metadata 等值过滤（snake_case 键名）
                metadataFilter: {
                    ...(input.legalId && { legal_id: input.legalId }),
                    ...(input.legalType && { legal_type: input.legalType }),
                },
                // 日期和有效性等后处理过滤，通过独立字段传递
                postFilters: {
                    isEffective: input.isEffective,
                    invalidDateFilter: input.invalidDateFilter,
                    publishDateFilter: input.publishDateFilter,
                    effectiveDateFilter: input.effectiveDateFilter,
                },
            })
            return JSON.stringify(formatLawResults(results))
        }
        // 无 query → 保持现有 SQL 查询逻辑
        return await sqlQueryLaw(input)
    },
    { name: 'searchLawTool', description: '...', schema: existingSchema }
)
```

### searchCaseMaterialsTool 改造

案件材料搜索工具同样存在两层：
- **服务层**：`server/services/material/materialPipeline.service.ts` — 包含 `searchMaterialsService()`
- **工作流工具层**：`server/services/workflow/tools/searchCaseMaterials.tool.ts` — 包装服务层

改造策略：**修改服务层的 `searchMaterialsService()`**，工作流工具层仅需适配返回格式。

注意：向量检索部分不再使用 PGVectorStore 的 filter 机制（其 `{ in: [...] }` 语法支持不稳定），改为在 `hybridSearch` 和 `semanticSearch` 中使用原始 SQL 构建 metadata 过滤条件（与 BM25 通道复用相同的 `buildParameterizedMetadataFilter` 函数）。

```typescript
export function createTool(context: ToolContext) {
    return tool(
        async (input) => {
            // 无 query → 精确检索，保持现有逻辑
            if (!input.query) {
                return await fetchExactMaterial(context, input.sourceId, input.k)
            }
            // 有 query → 走路由器
            // metadataFilter 只传简单值，IN 过滤由 hybridSearch 内部处理
            const results = await retrievalRouterService({
                query: input.query,
                type: 'case_material',
                k: input.k,
                metadataFilter: {
                    userId: String(context.userId),
                },
                // sourceIds 作为独立参数传递，由各通道内部构建 IN 条件
                sourceIds: input.sourceId
                    ? [String(input.sourceId)]
                    : caseSourceIds.map(String),
            })
            return JSON.stringify(truncateToolResults(results))
        },
        { name: 'search_case_materials', ... }
    )
}
```

### retrievalRouter.service.ts

```typescript
interface RetrievalRequest {
    query: string
    type: 'law' | 'case_material'
    k: number
    /** 简单等值过滤（key=value），由 buildParameterizedMetadataFilter 处理 */
    metadataFilter?: Record<string, string | number | boolean>
    /** sourceId IN 过滤（案件材料检索用），由各通道内部构建 SQL IN 条件 */
    sourceIds?: string[]
    /** 后处理过滤（日期范围、有效性等），在检索结果返回后内存中过滤 */
    postFilters?: {
        isEffective?: boolean
        invalidDateFilter?: DateFilter
        publishDateFilter?: DateFilter
        effectiveDateFilter?: DateFilter
    }
}

interface RetrievalResult {
    content: string
    score: number
    metadata: Record<string, unknown>
    retrievalMode: 'exact' | 'hybrid' | 'semantic'
}

async function retrievalRouterService(
    request: RetrievalRequest
): Promise<RetrievalResult[]> {
    // 1. LLM 意图路由
    const intent = await classifyIntent(request.query, request.type)

    // 2. 分发到对应通道
    let results: RetrievalResult[]
    let actualMode: 'exact' | 'hybrid' | 'semantic' = intent.intent
    switch (intent.intent) {
        case 'exact':
            results = await exactSearch(intent, request)
            if (results.length === 0) {
                // 降级：用原始 query 作为 rewrittenQuery，用 legalName+articleRef 作为 keywords
                const fallbackIntent = {
                    ...intent,
                    intent: 'hybrid' as const,
                    keywords: intent.keywords ?? [intent.legalName, intent.articleRef].filter(Boolean),
                    rewrittenQuery: intent.rewrittenQuery ?? request.query,
                }
                results = await hybridSearch(fallbackIntent, request)
                actualMode = 'hybrid'  // 标记实际使用的检索模式
            }
            break
        case 'hybrid':
            results = await hybridSearch(intent, request)
            break
        case 'semantic':
            results = await semanticSearch(intent, request)
            break
    }

    // 3. Rerank（仅精确通道且未降级时跳过）
    if (actualMode !== 'exact' && results.length > 0) {
        results = await rerankAndFilter(request.query, results, request.k, request.type)
    }

    return results.slice(0, request.k)
}
```

## 模块七：材料上下文注入优化

### 现有问题

1. full/summary 二选一过于粗糙（TOKEN_THRESHOLD=32000）
2. summary fallback 截取前 200 字符 — 不是摘要，是截断
3. 增量注入固定 summary 模式

### 改造：分级注入

```
材料列表（按相关度排序）
   │
   ▼
逐份材料累加 token：
   累计 < 阈值 → 全文注入
   累计 ≥ 阈值 → 摘要注入
   │
   ▼
最终结果：
   材料A: 全文 ✓
   材料B: 全文 ✓
   材料C: 摘要（超限了）
   材料D: 摘要
```

核心逻辑：

```typescript
async function buildGradedMaterialContext(
    materials: MaterialWithFile[],
    contentMap: Map<number, string>,
    tokenBudget: number = TOKEN_THRESHOLD,
): Promise<MaterialContextItem[]> {
    let usedTokens = 0
    const result: MaterialContextItem[] = []

    for (const m of materials) {
        const content = contentMap.get(m.id)
        if (!content) {
            result.push({ ...meta, mode: 'summary', summary: `[材料: ${m.name}，暂无内容]` })
            continue
        }
        const tokens = estimateTokens(content)  // 复用现有函数：中文 ~2 字符/token，英文 ~4 字符/token
        if (usedTokens + tokens <= tokenBudget) {
            result.push({ ...meta, mode: 'full', content })
            usedTokens += tokens
        } else {
            result.push({ ...meta, mode: 'summary', summary: m.summary || await generateSummary(content) })
        }
    }
    return result
}
```

### 材料排序权重

```typescript
const MATERIAL_PRIORITY: Record<number, number> = {
    1: 10,  // CASE_CONTENT — 最高，通常是案情描述
    2: 8,   // DOCUMENT — 合同、判决书等核心证据
    3: 5,   // IMAGE — 辅助证据
    4: 3,   // AUDIO — 通常较长，摘要即可
}
```

### 消息格式

```
以下是本案件的材料内容（共 5 份，3 份全文 + 2 份摘要）。
摘要材料需要详细内容时请使用 search_case_materials 工具，传入 sourceId 精确检索。

## [sourceId=431] 起诉状.docx [全文]
[完整 Markdown 内容]

## [sourceId=434] 录音证据.mp3 [摘要]
本段录音为当事人与对方就借款事宜的电话沟通...
```

标记 `[全文]` 和 `[摘要]` 让 AI 清楚知道哪些材料需要用工具补充完整内容。

### 增量注入

计算剩余 token 预算，新增材料也走分级逻辑：

```typescript
const remainingBudget = tokenBudget - currentContextTokens
const newContext = await buildGradedMaterialContext(newMaterials, contentMap, remainingBudget)
```

## 模块八：数据库迁移 + 开发环境

### 自定义 PostgreSQL Docker 镜像

新增 `docker/postgres/Dockerfile`：

```dockerfile
FROM pgvector/pgvector:pg17

RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-server-dev-17 gcc make git ca-certificates \
    automake autoconf libtool \
    && git clone --depth 1 https://github.com/hightman/scws.git /tmp/scws \
    && cd /tmp/scws \
    && touch README && aclocal && autoconf && autoheader \
    && libtoolize && automake --add-missing \
    && ./configure && make install \
    && git clone --depth 1 https://github.com/amutu/zhparser.git /tmp/zhparser \
    && cd /tmp/zhparser && make && make install \
    && apt-get purge -y gcc make git postgresql-server-dev-17 automake autoconf libtool \
    && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /tmp/scws /tmp/zhparser
```

### 基础设施初始化脚本

新增 `server/scripts/setupRetrievalInfra.ts`（幂等，可重复执行）：

1. 启用扩展（pg_trgm, zhparser）
2. 创建中文全文搜索配置
3. 添加 tsvector 计算列（使用 trigger 而非 GENERATED ALWAYS AS，确保与 Prisma 和 PGVectorStore 兼容）
4. 创建 GIN / HNSW / metadata 索引

**tsvector 列使用 trigger 方案**（替代 GENERATED ALWAYS AS）：

```sql
-- 添加普通列（非 GENERATED，避免 Prisma drift 和 PGVectorStore INSERT 冲突）
ALTER TABLE law_embeddings ADD COLUMN IF NOT EXISTS tsv tsvector;

-- 创建触发器函数，自动同步 tsvector
CREATE OR REPLACE FUNCTION update_tsv_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.tsv := to_tsvector('chinese', COALESCE(NEW.text, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 绑定触发器
CREATE TRIGGER trg_law_embeddings_tsv
    BEFORE INSERT OR UPDATE OF text ON law_embeddings
    FOR EACH ROW EXECUTE FUNCTION update_tsv_column();

-- case_material_embeddings 复用同一个触发器函数
CREATE TRIGGER trg_case_material_embeddings_tsv
    BEFORE INSERT OR UPDATE OF text ON case_material_embeddings
    FOR EACH ROW EXECUTE FUNCTION update_tsv_column();

-- 初始填充已有数据
UPDATE law_embeddings SET tsv = to_tsvector('chinese', COALESCE(text, ''));
UPDATE case_material_embeddings SET tsv = to_tsvector('chinese', COALESCE(text, ''));
```

trigger 对 Prisma 和 PGVectorStore 完全透明 — INSERT 时无需显式传入 tsv 列。

**HNSW 索引使用 CONCURRENTLY**（避免锁表）：

```sql
-- CONCURRENTLY 不能在事务中执行，脚本需单独执行此语句
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_law_embeddings_hnsw
  ON law_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
```

注意：`setupRetrievalInfra.ts` 脚本中 HNSW 索引创建语句不能包裹在事务中。

package.json 组合命令：

```json
{ "db:setup": "bun run prisma:push && bun run server/scripts/setupRetrievalInfra.ts" }
```

### 法律 Embedding 重建脚本

新增 `server/scripts/rebuildLawEmbeddings.ts`：按批次（每批 10 部法律）重建所有法律条文向量，支持断点续传。

### Prisma Schema

两个 embedding 表 schema **保持不变**，`tsv` 列完全由 `setupRetrievalInfra.ts` 脚本管理。

### 环境变量新增

```bash
# Rerank 配置
NUXT_RERANK_API_KEY=
NUXT_RERANK_BASE_URL=
NUXT_RERANK_MODEL=gte-rerank-v2

# 检索阈值
NUXT_LAW_RERANK_THRESHOLD=0.3
NUXT_MATERIAL_RERANK_THRESHOLD=0.2

# HNSW 搜索参数
NUXT_HNSW_EF_SEARCH=100
```

### models 表新增

```typescript
// Rerank 模型
{ name: 'gte-rerank-v2', type: 'rerank', providerId: alibailanProviderId, status: 1 }
```

意图路由用的轻量模型复用已有的 qwen-turbo。

## 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `docker/postgres/Dockerfile` | 带 zhparser 的自定义 PG 镜像 |
| `docker-compose.dev.yml` | 开发环境 compose |
| `server/services/retrieval/types.ts` | 检索系统类型定义 |
| `server/services/retrieval/retrievalRouter.service.ts` | 统一检索路由入口 |
| `server/services/retrieval/intentClassifier.service.ts` | LLM 意图分类 |
| `server/services/retrieval/exactSearch.service.ts` | 精确检索通道 |
| `server/services/retrieval/hybridSearch.service.ts` | 混合检索（BM25+Vector+RRF） |
| `server/services/retrieval/semanticSearch.service.ts` | 语义检索通道 |
| `server/services/retrieval/rerank.service.ts` | Rerank 精排服务 |
| `server/services/retrieval/fullTextSearch.service.ts` | zhparser 全文搜索封装 |
| `server/scripts/setupRetrievalInfra.ts` | 基础设施初始化脚本 |
| `server/scripts/rebuildLawEmbeddings.ts` | 法律向量重建脚本 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server/services/legal/lawEmbedding.service.ts` | `buildEmbeddingText` 格式改为内容优先 |
| `server/services/material/materialEmbedding.service.ts` | 分块参数 1000/100 → 1500/200 |
| `server/services/workflow/tools/searchCaseMaterials.tool.ts` | 内部逻辑改为调用 retrievalRouter |
| `server/services/legal/searchLaw.tool.ts` | `searchLaw()` 核心函数改为调用 retrievalRouter |
| `server/services/workflow/tools/searchLaw.tool.ts` | 适配改造后的服务层（如需调整格式化逻辑） |
| `server/services/material/materialPipeline.service.ts` | `searchMaterialsService` + `getMaterialContextService` 改造 |
| `server/services/workflow/middleware/caseMaterialContext.middleware.ts` | 适配分级注入消息格式 |
| `server/services/model/modelConfig.service.ts` | 新增 `getRerankConfigWithFallbackService` |
| `shared/types/model.ts` | `ModelType` 联合类型新增 `'rerank'`，`ModelTypeLabels` 新增对应标签 |
| `package.json` | 新增 `db:setup` 脚本 |

### 不动的文件

| 文件 | 理由 |
|------|------|
| `server/services/legal/vectorStore.service.ts` | 底层向量存储服务，新增服务在其上层调用 |
| Prisma schema（两个 embedding 表） | 保持不变，tsv 列由脚本管理 |
| 工具参数 schema | 保持不变，AI 调用兼容 |

## 实施顺序

```
Phase 1: 基础设施
  ├── Docker 镜像 + zhparser
  ├── setupRetrievalInfra 脚本
  └── models 表新增 rerank 模型记录

Phase 2: 检索服务层（新增，不改现有代码）
  ├── retrieval/types.ts
  ├── fullTextSearch.service.ts
  ├── rerank.service.ts
  ├── exactSearch.service.ts
  ├── hybridSearch.service.ts
  ├── semanticSearch.service.ts
  ├── intentClassifier.service.ts（+ node 配置）
  └── retrievalRouter.service.ts

Phase 3: 接入（修改现有代码）
  ├── searchLawTool → 接入 retrievalRouter
  ├── searchCaseMaterialsTool → 接入 retrievalRouter
  └── 单元测试 + 集成测试

Phase 4: 辅助优化
  ├── lawEmbedding embedding 文本格式优化
  ├── rebuildLawEmbeddings 脚本 + 执行重建
  ├── materialEmbedding 分块参数调整
  └── caseMaterialContext 分级注入改造

Phase 5: 验证
  └── 效果评估数据集 + 指标对比
```

Phase 2 全部是新增文件，不动现有代码，可安全并行开发。Phase 3 是切换点，改动最小化。

## 测试策略

### 单元测试

| 测试文件 | 覆盖内容 |
|---------|---------|
| `intentClassifier.test.ts` | 意图分类：精确/混合/语义识别准确性 |
| `exactSearch.test.ts` | 法律名称模糊匹配、条文编号解析、上下文扩展 |
| `hybridSearch.test.ts` | RRF 融合排序算法正确性 |
| `rerank.test.ts` | Rerank 服务调用、超时降级、阈值过滤 |
| `fullTextSearch.test.ts` | zhparser 分词查询构建 |
| `retrievalRouter.test.ts` | 路由分发、精确通道无命中降级 |
| `materialContext.test.ts` | 分级注入逻辑、token 预算累计 |

### 集成测试

| 测试 | 验证 |
|------|------|
| 精确检索端到端 | "民法典第1000条" → 命中正确条文 |
| 混合检索端到端 | "劳动合同法经济补偿" → BM25+Vector 结果融合 |
| Rerank 端到端 | 粗检索结果经 Rerank 后排序提升 |
| HNSW 索引验证 | `EXPLAIN ANALYZE` 确认使用索引 |

### 效果评估

```typescript
// 评估数据集
const evalCases = [
    { query: '民法典第一千条', expectedArticleIds: ['xxx'], mode: 'exact' },
    { query: '劳动合同法关于经济补偿金的规定', expectedArticleIds: ['yyy', 'zzz'], mode: 'hybrid' },
    { query: '员工被无故辞退如何索赔', expectedArticleIds: ['aaa', 'bbb'], mode: 'semantic' },
]
// 指标：Recall@K、MRR（Mean Reciprocal Rank）
```
