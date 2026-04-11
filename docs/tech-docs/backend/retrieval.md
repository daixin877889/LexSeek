# 检索系统

检索系统提供统一的检索路由器，根据 LLM 意图分类将查询分发到精确、混合或语义三种通道，并通过 Rerank 精排和后处理过滤返回最终结果。

## 架构概览

```
用户查询
    ↓
意图分类器 (LLM)
    ↓
┌──────────┬──────────┬──────────┐
│  exact   │  hybrid  │ semantic │
│ DB 精确  │ BM25+Vec │ 纯向量   │
│ 查询     │ +RRF融合 │ 搜索     │
└────┬─────┴────┬─────┴────┬─────┘
     │          ↓          │
     │     Rerank 精排     │
     │     (阈值过滤)      │
     │          ↓          │
     └──→ 后处理过滤 ←─────┘
         (日期/有效性)
              ↓
          top-k 结果
```

## 源码路径

所有文件位于 `server/services/retrieval/`。

| 文件 | 职责 |
|------|------|
| `types.ts` | 共享类型定义 |
| `retrievalRouter.service.ts` | 统一检索路由器 |
| `intentClassifier.service.ts` | LLM 意图分类器 |
| `semanticSearch.service.ts` | 语义检索（纯向量） |
| `fullTextSearch.service.ts` | 全文搜索（BM25 + zhparser） |
| `hybridSearch.service.ts` | 混合检索（BM25 + Vector + RRF） |
| `exactSearch.service.ts` | 精确检索（法律名 + 条文号） |
| `rerank.service.ts` | Rerank 精排服务 |
| `postFilter.service.ts` | 后处理过滤（日期/有效性） |

## 检索路由器

`retrievalRouterService(request)` 是统一入口，流程：

1. 调用意图分类器获取 `IntentClassification`
2. 根据 `intent` 分发到对应通道
3. 非 exact 通道的结果经过 Rerank 精排
4. 应用后处理过滤
5. 截取 top-k 返回

### 精确通道降级

当 exact 通道无结果时，自动降级到 hybrid：

```typescript
if (results.length === 0) {
  // 将 legalName + articleRef 转为 keywords
  const fallbackIntent = {
    ...intent,
    intent: 'hybrid',
    keywords: [intent.legalName, intent.articleRef].filter(Boolean),
    rewrittenQuery: intent.rewrittenQuery ?? request.query,
  }
  results = await hybridSearchService(fallbackIntent, request)
}
```

## 意图分类器

`classifyIntentService(query, type)` 使用 LLM 结构化输出进行意图分类。

### 配置来源

- 节点名称：`search_intent_router`
- 支持从节点 prompts 和 outputSchema 获取配置
- 未配置时使用内置默认值

### 三种意图

| 意图 | 判定条件 | 示例 |
|------|----------|------|
| `exact` | 法律名称 + 条文编号 | "民法典第1000条"、"刑法第264条" |
| `hybrid` | 专业法律术语（无条文号） | "合同解除的法定条件"、"违约金调整规则" |
| `semantic` | 口语化描述 | "被公司辞退能获得什么赔偿" |

### 输出结构

```typescript
interface IntentClassification {
  intent: 'exact' | 'hybrid' | 'semantic'
  legalName?: string      // exact 通道使用
  articleRef?: string     // exact 通道使用（中文数字格式）
  keywords?: string[]     // hybrid 通道使用
  rewrittenQuery?: string // hybrid/semantic 通道使用
}
```

### 降级策略

- LLM 调用失败 → 降级为 `semantic`
- 节点未配置 → 降级为 `semantic`
- `case_material` 类型 → `exact` 强制降级为 `hybrid`（案件材料无精确通道）
- `intent` 值不合法 → 降级为 `semantic`

### 内部标记

分类器调用 LLM 时传入 `tags: ['internal']`，AgentWorker 会根据此标记过滤消息，不将分类器的 LLM 调用发送到前端。

## 四种搜索策略

### 精确搜索 (exact)

`exactSearchService(intent)` 直接查询数据库，不走向量搜索：

1. 按法律名称查找候选法律（精确匹配优先，再 contains 匹配）
2. 在候选法律中按条文编号匹配（`l5` 或 `l3` 包含匹配）
3. 对每条命中条文扩展上下文（`order ±2`，限制在同 `l1` 层级内）
4. 按 `articles_id` 去重，返回结果（score 固定为 1.0）

元数据包含 `chapter_hierarchy`（由 `buildHierarchyPath` 构建）。

### 语义搜索 (semantic)

`semanticSearchService(intent, request)` 纯向量搜索：

- 使用 `intent.rewrittenQuery` 或原始 query
- 粗检索取 `k * 3` 条，后续由 Rerank 精排
- 直接调用 `vectorSearchService`

### 全文搜索 (fullText)

`fullTextSearchService(tableName, keywords, k, metadataFilter, sourceIds)` 基于 PostgreSQL tsv 列的 BM25 搜索：

- 使用 zhparser 中文分词扩展
- `plainto_tsquery('chinese', searchText)` 构建搜索查询
- `ts_rank_cd` 计算相关性分数
- 支持 metadata 过滤和 sourceIds 过滤

### 混合搜索 (hybrid)

`hybridSearchService(intent, request)` 并行执行 BM25 + Vector，然后 RRF 融合：

```typescript
const [bm25Results, vectorResults] = await Promise.all([
  fullTextSearchService(tableName, intent.keywords || [], searchK, ...),
  vectorSearchService(tableName, searchQuery, searchK, ...),
])
return reciprocalRankFusion(bm25Results, vectorResults, request.type)
```

### RRF 融合算法

`reciprocalRankFusion(bm25Results, vectorResults, type, k=60)`：

```
RRF_score(d) = Σ 1/(k + rank + 1)
```

- `k` 参数默认 60，控制排名靠前结果的权重
- 两路结果按文档 ID 合并得分
- 法律文档 ID：`articles_id`
- 材料文档 ID：`sourceId_chunkIndex`

### 向量搜索实现

`vectorSearchService` 使用原始 SQL（绕过 PGVectorStore 的 filter 机制）：

- 余弦距离：`1 - (embedding <=> $1::vector) as score`
- HNSW 索引：通过 `SET hnsw.ef_search` 控制精度（环境变量 `NUXT_HNSW_EF_SEARCH`，默认 100）
- 使用同一个 client 连接保证 SET 和查询在同一会话

## 安全防护

### 表名白名单

```typescript
const ALLOWED_TABLES = new Set(['law_embeddings', 'case_material_embeddings'])
```

### Metadata 过滤字段白名单

```typescript
const ALLOWED_METADATA_KEYS = new Set([
  'legal_id', 'legal_name', 'legal_type', 'article_type',
  'userId', 'sourceId', 'source',
])
```

所有 metadata 过滤使用参数化 SQL（`$N` 占位符），防止注入。

## Rerank 服务

`rerankAndFilterService(query, results, k, type)` 对检索结果进行精排：

1. 取前 `MAX_RERANK_DOCS`（20）条候选
2. 调用 Rerank API 精排
3. 按阈值过滤低分结果
4. API 失败时降级返回原始结果前 k 条

### 阈值配置

| 类型 | 默认阈值 | 环境变量 |
|------|----------|----------|
| 法律 (law) | 0.3 | `NUXT_LAW_RERANK_THRESHOLD` |
| 材料 (case_material) | 0.2 | `NUXT_MATERIAL_RERANK_THRESHOLD` |

### 多供应商兼容

`rerankService` 自动检测 API 格式：

- **DashScope 原生格式**（URL 含 `/api/v1/services/`）：嵌套 `input/parameters` 请求体，`output.results` 响应
- **标准格式**（Cohere/Jina/SiliconFlow/阿里云兼容端点）：扁平请求体，`results` 响应

管理员在后台配置完整的 API 端点 URL，代码不拼接路径。

超时控制：5000ms（AbortController）。

## 后处理过滤

`applyPostFiltersService(results, postFilters)` 在检索结果返回后进行内存过滤：

### 有效性过滤

`isLawEffective(effectiveDate, invalidDate)`：
- 生效日期在未来 → 无效
- 失效日期在过去 → 无效
- 时区：`Asia/Shanghai`

### 日期范围过滤

支持三个日期字段的范围过滤：
- `invalidDateFilter` → metadata 中的 `invalid_date`
- `publishDateFilter` → metadata 中的 `publish_date`
- `effectiveDateFilter` → metadata 中的 `effective_date`

操作符：`>`, `<`, `=`, `>=`, `<=`

## 类型定义

```typescript
/** 检索请求 */
interface RetrievalRequest {
  query: string
  type: 'law' | 'case_material'
  k: number
  metadataFilter?: Record<string, string | number | boolean>
  sourceIds?: string[]
  postFilters?: PostFilters
}

/** 检索结果 */
interface RetrievalResult {
  content: string
  score: number
  metadata: Record<string, unknown>
  retrievalMode: 'exact' | 'hybrid' | 'semantic'
}
```

## 相关文档

- [tech-docs/backend/material.md](./material.md) - 材料处理管道（提供向量数据）
- [tech-docs/backend/agent.md](./agent.md) - Agent Worker（消费检索结果）
- [tech-docs/patterns/workflow-middleware.md](../patterns/workflow-middleware.md) - 工作流与中间件模式
