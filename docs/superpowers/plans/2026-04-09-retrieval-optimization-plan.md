# 检索系统架构级优化 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过智能路由 + 多通道检索 + Rerank 精排架构，全面提升法律条文和案件材料的检索准确度。

**Architecture:** LLM 意图路由将查询分类为 exact/hybrid/semantic 三通道，精确通道直接查 legal_articles 表，混合通道使用 zhparser BM25 + pgvector HNSW + RRF 融合，语义通道纯向量搜索。所有非精确结果经阿里云百炼 Rerank API 精排后返回。

**Tech Stack:** PostgreSQL 17 + pgvector 0.8.0 + zhparser + pg_trgm + HNSW + LangChain + 阿里云百炼 Rerank API

**Spec:** `docs/superpowers/specs/2026-04-09-retrieval-optimization-design.md`

---

## Phase 1: 基础设施

### Task 1: Docker 自定义 PostgreSQL 镜像

**Files:**
- Create: `docker/postgres/Dockerfile`
- Create: `docker-compose.dev.yml`

- [ ] **Step 1: 创建 Dockerfile**

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

- [ ] **Step 2: 创建 docker-compose.dev.yml**

从现有 postgres 容器配置推导，添加 build 配置指向自定义镜像。需要查看当前 postgres 容器的运行参数（端口、volumes、env）来构建。

- [ ] **Step 3: 构建并测试镜像**

Run: `docker compose -f docker-compose.dev.yml build postgres`
Run: `docker compose -f docker-compose.dev.yml up -d postgres`

验证 zhparser 可用：
```sql
CREATE EXTENSION IF NOT EXISTS zhparser;
SELECT to_tsvector('chinese_test', '中华人民共和国民法典第一千条');
```

- [ ] **Step 4: Commit**

```
feat(infra): 添加带 zhparser 的自定义 PostgreSQL Docker 镜像
```

---

### Task 2: 基础设施初始化脚本

**Files:**
- Create: `server/scripts/setupRetrievalInfra.ts`
- Modify: `package.json` (scripts 部分)

- [ ] **Step 1: 编写 setupRetrievalInfra.ts**

幂等脚本，包含以下 DDL（均使用 IF NOT EXISTS / IF EXISTS）：

1. `CREATE EXTENSION IF NOT EXISTS pg_trgm`
2. `CREATE EXTENSION IF NOT EXISTS zhparser`
3. 创建 `chinese` 全文搜索配置
4. 两个表添加 `tsv tsvector` 列
5. 创建 `update_tsv_column()` trigger 函数
6. 绑定 trigger 到两个表
7. 初始填充已有数据的 tsv 列
8. 创建 GIN(tsv) 索引
9. 创建 GIN(trgm) 索引
10. 创建 HNSW 向量索引（CONCURRENTLY，不在事务中）：
    - `law_embeddings`: `ef_construction = 200`（14万条数据，需要高构建质量）
    - `case_material_embeddings`: `ef_construction = 64`（数据量小，预留）
11. 创建 metadata JSONB 索引（legal_id, legal_name, userId, sourceId）

注意：HNSW `CREATE INDEX CONCURRENTLY` 不能在事务中执行，脚本需要将此语句单独执行。

使用 `pg` 包直接连接数据库执行 DDL，参考 `server/services/legal/vectorStore.service.ts` 中 `getPool()` 的连接方式。

- [ ] **Step 2: package.json 添加 db:setup 脚本**

```json
"db:setup": "bun run prisma:push && bun run server/scripts/setupRetrievalInfra.ts"
```

- [ ] **Step 3: 执行脚本验证**

Run: `bun run server/scripts/setupRetrievalInfra.ts`

验证索引创建成功：
```sql
SELECT indexname FROM pg_indexes WHERE tablename IN ('law_embeddings', 'case_material_embeddings');
```

- [ ] **Step 4: Commit**

```
feat(infra): 添加检索基础设施初始化脚本（zhparser、索引、trigger）
```

- [ ] **Step 5: 更新环境变量配置**

在 `docker-compose.yml` 和 `.env.example`（如果存在）中添加新增的环境变量：
```bash
NUXT_RERANK_API_KEY=
NUXT_RERANK_BASE_URL=
NUXT_RERANK_MODEL=gte-rerank-v2
NUXT_LAW_RERANK_THRESHOLD=0.3
NUXT_MATERIAL_RERANK_THRESHOLD=0.2
NUXT_HNSW_EF_SEARCH=100
```

---

### Task 3: ModelType 扩展 + Rerank 配置服务

**Files:**
- Modify: `shared/types/model.ts` (第60行 ModelType 和 ModelTypeLabels)
- Modify: `server/services/model/modelConfig.service.ts` (新增 getRerankConfigWithFallbackService)
- Test: `tests/server/retrieval/rerank-config.test.ts`

- [ ] **Step 1: 写失败测试 — getRerankConfigWithFallbackService**

测试场景：
1. 数据库有 rerank 模型配置 → 返回数据库配置
2. 数据库无配置，环境变量有 → 返回环境变量配置
3. 都没有 → 抛出错误

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/retrieval/rerank-config.test.ts --reporter=verbose`

- [ ] **Step 3: 实现**

在 `shared/types/model.ts` 中：
- `ModelType` 新增 `'rerank'`
- `ModelTypeLabels` 新增 `rerank: '重排序模型'`
- 新增 `RerankConfig` 接口（参照 `EmbeddingConfig`）

在 `server/services/model/modelConfig.service.ts` 中：
- 新增 `getRerankConfigWithFallbackService`，照搬 `getEmbeddingConfigWithFallbackService` 模式
- 数据库查询 `modelType = 'rerank'` + `status = 1`
- 环境变量回退：`NUXT_RERANK_API_KEY` / `NUXT_RERANK_BASE_URL` / `NUXT_RERANK_MODEL`

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```
feat(model): 新增 rerank 模型类型和配置服务
```

---

## Phase 2: 检索服务层（全部新增文件）

### Task 4: 检索类型定义

**Files:**
- Create: `server/services/retrieval/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
/** 检索意图分类结果 */
export interface IntentClassification {
    intent: 'exact' | 'hybrid' | 'semantic'
    legalName?: string
    articleRef?: string
    keywords?: string[]
    rewrittenQuery?: string
}

/** 检索请求 */
export interface RetrievalRequest {
    query: string
    type: 'law' | 'case_material'
    k: number
    metadataFilter?: Record<string, string | number | boolean>
    sourceIds?: string[]
    postFilters?: {
        isEffective?: boolean
        invalidDateFilter?: DateFilter
        publishDateFilter?: DateFilter
        effectiveDateFilter?: DateFilter
    }
}

/** 检索结果 */
export interface RetrievalResult {
    content: string
    score: number
    metadata: Record<string, unknown>
    retrievalMode: 'exact' | 'hybrid' | 'semantic'
}

/** 内部搜索结果（BM25/Vector 通道共用） */
export interface SearchResultItem {
    score: number
    content: string
    metadata: Record<string, unknown>
}

/** 日期过滤 */
export interface DateFilter {
    date: string
    operator: '>' | '<' | '=' | '>=' | '<='
}

/** 允许查询的表名白名单 */
export const ALLOWED_TABLES = new Set(['law_embeddings', 'case_material_embeddings'])

/** 允许的 metadata 过滤字段白名单 */
export const ALLOWED_METADATA_KEYS = new Set([
    'legal_id', 'legal_name', 'legal_type', 'article_type',
    'userId', 'sourceId', 'source',
])
```

- [ ] **Step 2: Commit**

```
feat(retrieval): 添加检索系统类型定义
```

---

### Task 5: 全文搜索服务

**Files:**
- Create: `server/services/retrieval/fullTextSearch.service.ts`
- Test: `tests/server/retrieval/fullTextSearch.test.ts`

- [ ] **Step 1: 写失败测试**

测试 `buildParameterizedMetadataFilter`：
1. 空 filter → 空 SQL
2. 合法 key → 正确参数化 SQL
3. 非法 key → 抛出错误

测试 `fullTextSearchService`：
1. 表名白名单验证
2. 正确构建 plainto_tsquery SQL

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 fullTextSearch.service.ts**

核心函数：
- `buildParameterizedMetadataFilter(filter, startParamIndex)` — 参数化 metadata WHERE 构建
- `buildSourceIdsFilter(sourceIds, startParamIndex)` — sourceId IN 条件构建：
  ```typescript
  // 生成：AND metadata->>'sourceId' IN ($N, $N+1, ...)
  function buildSourceIdsFilter(sourceIds: string[] | undefined, startIdx: number) {
      if (!sourceIds?.length) return { filterSQL: '', filterParams: [] }
      const placeholders = sourceIds.map((_, i) => `$${startIdx + i}`).join(', ')
      return {
          filterSQL: ` AND metadata->>'sourceId' IN (${placeholders})`,
          filterParams: sourceIds,
      }
  }
  ```
- `fullTextSearchService(tableName, keywords, k, metadataFilter?, sourceIds?)` — zhparser BM25 查询，内部组合 metadataFilter SQL + sourceIds SQL

使用 `getPool()` from `server/services/legal/vectorStore.service` 获取数据库连接。

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```
feat(retrieval): 添加 zhparser 全文搜索服务
```

---

### Task 6: Rerank 精排服务

**Files:**
- Create: `server/services/retrieval/rerank.service.ts`
- Test: `tests/server/retrieval/rerank.test.ts`

- [ ] **Step 1: 写失败测试**

测试场景：
1. 正常 rerank → 返回排序后的结果
2. API 超时 → 降级返回原始结果
3. API 错误 → 降级返回原始结果
4. 阈值过滤 → 低分结果被过滤

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 rerank.service.ts**

核心函数：
- `rerankService(query, documents, topK, model?)` — 调用百炼 Rerank API
- `rerankAndFilterService(query, results, k, type)` — rerank + 阈值过滤

API 调用方式：`POST ${baseUrl}/v1/rerank`，OpenAI 兼容格式。
配置来源：`getRerankConfigWithFallbackService()`（Task 3 实现）。

性能保护：
- 最大输入 20 条文档
- 超时 5s
- 降级策略：API 失败时返回原始结果

阈值从环境变量读取：
- `NUXT_LAW_RERANK_THRESHOLD` (默认 0.3)
- `NUXT_MATERIAL_RERANK_THRESHOLD` (默认 0.2)

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```
feat(retrieval): 添加 Rerank 精排服务（阿里云百炼）
```

---

### Task 7: 精确检索通道

**Files:**
- Create: `server/services/retrieval/exactSearch.service.ts`
- Test: `tests/server/retrieval/exactSearch.test.ts`

- [ ] **Step 1: 写失败测试**

测试场景：
1. 法律名称模糊匹配 — "民法典" → 匹配"中华人民共和国民法典"
2. 条文编号匹配 — l5 LIKE '%第一千条%'
3. 上下文扩展 — 命中条文前后各 2 条
4. 无命中 → 返回空数组
5. 返回格式兼容（score=1, retrieval_mode='exact'）

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 exactSearch.service.ts**

核心函数：`exactSearchService(intent, request)` → `RetrievalResult[]`

流程：
1. `prisma.legalMain.findFirst` — 精确/包含匹配法律名称
2. `prisma.legalArticles.findMany` — l5/l3 LIKE 匹配条文编号
3. 上下文扩展 — 命中条文 order ± 2，但需限制在同章节内（添加 l1/l2 层级相同的约束，避免跨章节取到不相关条文）
4. 格式化为 `RetrievalResult`

使用 Prisma 查询（非原始 SQL），因为查询的是 legal_main 和 legal_articles 表（有 Prisma model）。

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```
feat(retrieval): 添加精确检索通道（法律名称 + 条文编号直接查询）
```

---

### Task 8: 向量检索 + 混合检索 + 语义检索

**Files:**
- Create: `server/services/retrieval/hybridSearch.service.ts`
- Create: `server/services/retrieval/semanticSearch.service.ts`
- Test: `tests/server/retrieval/hybridSearch.test.ts`

- [ ] **Step 1: 写失败测试**

测试 RRF 融合排序（纯算法，不需要数据库）：
1. 两路结果无重叠 → 按 RRF 分数合并
2. 两路结果有重叠 → 分数叠加，排名提升
3. 单路为空 → 正常处理

测试 `extractDocId`：
1. type='law' → 返回 articles_id
2. type='case_material' → 返回 sourceId_chunkIndex

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现**

`hybridSearch.service.ts` 核心函数：
- `vectorSearchService(tableName, query, k, metadataFilter?, sourceIds?)` — 原始 SQL 向量搜索（不用 PGVectorStore filter）
- `extractDocId(item, type)` — 文档去重标识
- `reciprocalRankFusion(bm25Results, vectorResults, type, k=60)` — RRF 融合
- `hybridSearchService(intent, request)` — 组合 BM25 + Vector + RRF

`semanticSearch.service.ts`：
- `semanticSearchService(intent, request)` — 只走 vectorSearchService，复用向量检索逻辑

向量搜索使用原始 SQL（`SELECT ... ORDER BY embedding <=> $1::vector LIMIT $2`，注意 `$1::vector` 类型转换），通过 `getEmbeddingsAsync()` 获取 embedding 实例将 query 转为向量字符串后传入参数。同时需要复用 `buildParameterizedMetadataFilter` 和 `buildSourceIdsFilter` 构建 WHERE 条件。

设置 `hnsw.ef_search` 从环境变量 `NUXT_HNSW_EF_SEARCH` 读取（默认 100）。

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```
feat(retrieval): 添加混合检索（BM25+Vector+RRF）和语义检索通道
```

---

### Task 9: LLM 意图分类服务

**Files:**
- Create: `server/services/retrieval/intentClassifier.service.ts`
- Test: `tests/server/retrieval/intentClassifier.test.ts`

- [ ] **Step 1: 写失败测试**

测试 `classifyIntentService`：
1. mock LLM 返回 exact 意图 → 正确解析
2. mock LLM 返回 hybrid 意图 → 正确解析
3. LLM 错误 → 降级返回 semantic（兜底）

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 intentClassifier.service.ts**

核心函数：`classifyIntentService(query, type)` → `IntentClassification`

实现方式：
1. 调用 `getValidNodeConfig('search_intent_router')` 获取节点配置
2. 使用 `createChatModel(config)` 创建轻量模型
3. 构建 system prompt（从节点 prompts 获取）+ user prompt（query）
4. 使用 `withStructuredOutput(outputSchema)` 获取结构化输出
5. 解析 LLM 输出为 `IntentClassification`
6. 错误时降级为 `{ intent: 'semantic', rewrittenQuery: query }`

需要通过 admin 后台或脚本创建 `search_intent_router` 节点（type=extraction, outputSchema 如设计文档所述）。

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 在数据库中创建 search_intent_router 节点**

通过 admin API 创建（需要先确认可用的轻量模型 ID）：

```bash
# 1. 创建节点
curl -X POST http://localhost:3000/api/v1/admin/nodes -H 'Content-Type: application/json' -d '{
    "name": "search_intent_router",
    "title": "检索意图路由器",
    "description": "根据查询内容分类检索意图（精确/混合/语义）",
    "type": "extraction",
    "modelId": <qwen-turbo的modelId>,
    "tools": [],
    "outputSchema": {
        "type": "object",
        "properties": {
            "intent": { "enum": ["exact", "hybrid", "semantic"] },
            "legalName": { "type": "string" },
            "articleRef": { "type": "string" },
            "keywords": { "type": "array", "items": { "type": "string" } },
            "rewrittenQuery": { "type": "string" }
        },
        "required": ["intent"]
    },
    "status": 1
}'

# 2. 创建 system prompt（nodeId 从上一步返回获取）
curl -X POST http://localhost:3000/api/v1/admin/prompts -H 'Content-Type: application/json' -d '{
    "name": "search_intent_router_system",
    "title": "检索意图路由 System Prompt",
    "content": "你是法律检索意图分类器。根据用户的查询，判断最佳检索策略：\n\n1. exact（精确查找）— 用户明确引用了某部法律的某个条文\n   示例：\"民法典第1000条\"、\"刑法第264条\"\n   → 提取 legalName + articleRef\n\n2. hybrid（混合检索）— 包含特定法律术语或法律名称，但没有精确条文编号\n   示例：\"劳动合同法关于经济补偿的规定\"\n   → 提取 legalName + keywords + rewrittenQuery\n\n3. semantic（语义检索）— 自然语言描述法律问题\n   示例：\"员工被无故辞退后如何索赔\"\n   → 提取 keywords + rewrittenQuery",
    "type": "system",
    "nodeId": <nodeId>
}'

# 3. 激活 prompt
curl -X PUT http://localhost:3000/api/v1/admin/prompts/activate/<promptId>
```

- [ ] **Step 6: Commit**

```
feat(retrieval): 添加 LLM 意图分类服务（search_intent_router 节点）
```

---

### Task 10: 统一检索路由器

**Files:**
- Create: `server/services/retrieval/retrievalRouter.service.ts`
- Test: `tests/server/retrieval/retrievalRouter.test.ts`

- [ ] **Step 1: 写失败测试**

测试场景：
1. intent=exact + 命中 → 返回精确结果（不经 Rerank）
2. intent=exact + 未命中 → 降级到 hybrid（经 Rerank）
3. intent=hybrid → BM25+Vector+RRF+Rerank
4. intent=semantic → Vector+Rerank
5. postFilters 应用 — isEffective/日期过滤在 rerank 之后、slice 之前执行

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 retrievalRouter.service.ts**

核心函数：`retrievalRouterService(request: RetrievalRequest)` → `RetrievalResult[]`

关键流程：
1. `classifyIntentService(query, type)` — LLM 意图路由
2. switch 分发到 exactSearch / hybridSearch / semanticSearch
3. exact 无命中降级：构建 fallbackIntent（keywords 从 legalName+articleRef 提取，rewrittenQuery 回退到原始 query）
4. 非 exact 通道经 `rerankAndFilterService` 精排
5. **postFilters 应用**（rerank 之后、slice 之前）：调用 `isLawEffective` 和 `applyDateFilter`。注意：这两个函数在 `server/services/legal/searchLaw.tool.ts` 中是**未导出的私有函数**，需要先将它们导出（或提取到 `server/services/retrieval/postFilter.service.ts` 中复用）
6. `results.slice(0, request.k)` 返回

**前置步骤**：在实现 retrievalRouter 之前，需要先从 `searchLaw.tool.ts` 导出 `isLawEffective` 和 `applyDateFilter` 函数，或将它们提取到独立文件 `server/services/retrieval/postFilter.service.ts` 中（推荐后者，避免循环依赖）。

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```
feat(retrieval): 添加统一检索路由器（意图路由 + 多通道分发 + Rerank + 后过滤）
```

---

## Phase 3: 接入现有代码

### Task 11: searchLawTool 接入路由器

**Files:**
- Modify: `server/services/legal/searchLaw.tool.ts` (searchLaw 函数，约第168行)
- Verify: `server/services/workflow/tools/searchLaw.tool.ts` (工作流工具层自动继承，确认无需适配)
- Test: `tests/server/retrieval/searchLaw-integration.test.ts`

- [ ] **Step 1: 写集成测试**

测试改造后的 `searchLaw`：
1. 有 query → 走 retrievalRouterService
2. 无 query → 保持 SQL 查询逻辑
3. metadataFilter 使用 snake_case 键名
4. postFilters 传递 isEffective 和日期过滤

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 修改 searchLaw 函数**

在 `searchLaw(params)` 中：
- `params.query` 存在时，调用 `retrievalRouterService({...})`
- metadataFilter 键名转换：`legalId → legal_id`, `legalType → legal_type`
- `isEffective` 和日期过滤放入 `postFilters`
- 无 query 分支保持现有 SQL 逻辑不变

- [ ] **Step 4: 验证工作流工具层兼容**

检查 `server/services/workflow/tools/searchLaw.tool.ts`：该文件通过 `import { searchLaw } from '../../legal/searchLaw.tool'` 调用服务层。确认返回类型 `SearchResultItem[]` 不变（searchLaw 内部走路由器后需将 `RetrievalResult[]` 映射回 `SearchResultItem[]`）。

- [ ] **Step 5: 运行测试确认通过**

- [ ] **Step 6: Commit**

```
feat(retrieval): searchLawTool 接入统一检索路由器
```

### Task 12: searchCaseMaterialsTool 接入路由器

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts` (searchMaterialsService 函数，约第429行)
- Modify: `server/services/workflow/tools/searchCaseMaterials.tool.ts` (适配返回类型变化)
- Test: `tests/server/retrieval/searchMaterials-integration.test.ts`

- [ ] **Step 1: 写集成测试**

测试改造后的 `searchMaterialsService`：
1. 无 query → 精确获取材料完整内容（保持现有逻辑）
2. 有 query → 走 retrievalRouterService
3. metadataFilter 传 userId（简单值）
4. sourceIds 独立传递

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 修改 searchMaterialsService**

有 query 分支替换为：
```typescript
const results = await retrievalRouterService({
    query,
    type: 'case_material',
    k,
    metadataFilter: { userId: String(userId) },
    sourceIds: sourceIds.map(String),
})
```

无 query 分支保持现有 `fetchMaterialContents` 逻辑。

- [ ] **Step 4: 适配工作流工具层**

`server/services/workflow/tools/searchCaseMaterials.tool.ts` 中 `createTool` 的返回值处理：
- `searchMaterialsService` 返回类型从 `MaterialSearchToolResult[]` 变为 `RetrievalResult[]`（有 query 时）
- 需要将 `RetrievalResult` 映射回 `MaterialSearchToolResult` 格式（保持 `index`, `content`, `source`, `relevanceScore` 字段），确保 `truncateToolResults` 和 JSON 序列化逻辑兼容

- [ ] **Step 5: 运行测试确认通过**

- [ ] **Step 5: Commit**

```
feat(retrieval): searchCaseMaterialsTool 接入统一检索路由器
```

---

## Phase 4: 辅助优化

### Task 13: Embedding 文本格式优化

**Files:**
- Modify: `server/services/legal/lawEmbedding.service.ts` (buildEmbeddingText 函数，约第118行)
- Test: `tests/server/legal/lawEmbedding.service.test.ts` (修改 buildEmbeddingText 相关用例)

- [ ] **Step 1: 修改现有测试预期值**

`buildEmbeddingText` 的预期输出从旧格式改为新格式：
```
旧：文件：xxx\n类型：xxx\n章节：xxx\n内容：xxx
新：xxx内容...\n\n——《xxx》章节路径
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 修改 buildEmbeddingText**

```typescript
export function buildEmbeddingText(legal: legalMain, article: legalArticles): string {
    const hierarchyPath = buildHierarchyPath(article)
    const embeddableContent = getEmbeddableContent(article)
    return `${embeddableContent}\n\n——《${legal.name}》${hierarchyPath}`
}
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```
refactor(retrieval): 法律 embedding 文本格式改为内容优先
```

---

### Task 14: 法律向量重建脚本

**Files:**
- Create: `server/scripts/rebuildLawEmbeddings.ts`

- [ ] **Step 1: 编写重建脚本**

功能：
1. 查询所有法律 ID（`legalMain.findMany`）
2. 按批次处理（每批 10 部）
3. 每部法律：删除旧嵌入 → `updateLegalEmbeddings(legalId)` 重建
4. 断点续传：通过命令行参数 `--start-from=<legalId>` 支持
5. 进度日志

复用现有函数：
- `deleteEmbeddingsByMetadata('legal_id', legalId, 'law_embeddings')` — from `vectorStore.service.ts`
- `updateLegalEmbeddings(legalId)` — from `lawEmbedding.service.ts`

- [ ] **Step 2: 本地测试（小范围）**

Run: `bun run server/scripts/rebuildLawEmbeddings.ts --limit=10`
验证 10 部法律的向量已重建，text 格式为新格式。

- [ ] **Step 3: Commit**

```
feat(retrieval): 添加法律向量全量重建脚本
```

---

### Task 15: 案件材料分块参数调整

**Files:**
- Modify: `server/services/material/materialEmbedding.service.ts` (defaultSplitterConfig，约第73行)

- [ ] **Step 1: 修改分块参数**

```typescript
const defaultSplitterConfig: TextSplitterConfig = {
    chunkSize: 1500,     // 1000 → 1500
    chunkOverlap: 200,   // 100 → 200
}
```

- [ ] **Step 2: 运行现有测试确认不破坏**

Run: `npx vitest run tests/server/material --reporter=verbose`

- [ ] **Step 3: Commit**

```
refactor(retrieval): 案件材料分块参数调整为 1500/200
```

---

### Task 16: 材料上下文分级注入

**Files:**
- Modify: `server/services/material/materialPipeline.service.ts` (getMaterialContextService 函数)
- Modify: `server/services/workflow/middleware/caseMaterialContext.middleware.ts`
- Test: `tests/server/retrieval/materialContext.test.ts`

- [ ] **Step 1: 写失败测试**

测试 `buildGradedMaterialContext`：
1. 所有材料 token < 预算 → 全部 full 模式
2. 部分材料超预算 → 前面 full，后面 summary
3. 材料按 MATERIAL_PRIORITY 排序
4. 增量注入 — 剩余预算计算

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现分级注入**

修改 `getMaterialContextService`：
1. 新增 `MATERIAL_PRIORITY` 排序权重
2. 材料按权重降序排列
3. 逐份累加 token，预算内 → full，超出 → summary
4. `MaterialContextItem` 新增 `mode: 'full' | 'summary'` 字段
5. summary 生成：优先使用 `material.summary`（已缓存的摘要），否则调用现有的 `generateAndCacheSummaries`（from `server/services/material/materialSummary.service.ts`，通过动态 import）

修改 `buildMaterialContextMessage`：
- 全文标记 `[全文]`，摘要标记 `[摘要]`
- 头部统计：共 N 份，M 份全文 + K 份摘要

修改 `buildIncrementalMaterialMessage`：
- 接受 `remainingBudget` 参数
- 新增材料也走分级逻辑

修改 `caseMaterialContext.middleware.ts`：
- 首次注入传入 token 预算
- 增量注入计算剩余预算

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```
feat(retrieval): 材料上下文改为分级注入（全文+摘要混合）
```

---

## Phase 5: 验证

### Task 17: 全量测试 + 效果评估

- [ ] **Step 1: 运行全量测试**

Run: `npx vitest run --reporter=verbose`

确保所有现有测试和新增测试通过。

- [ ] **Step 2: 执行法律向量重建**

Run: `bun run server/scripts/rebuildLawEmbeddings.ts`

等待 4836 部法律重建完成（预计 30-60 分钟，取决于 embedding API 速度）。

- [ ] **Step 3: 手动验证精确检索**

通过 API 或管理后台测试：
- "民法典第一千条" → 应返回正确条文
- "刑法第二百六十四条" → 应返回盗窃罪条文
- "劳动合同法第四十六条" → 应返回经济补偿条文

- [ ] **Step 4: 手动验证混合检索**

- "劳动合同法关于经济补偿的规定" → BM25+Vector 结果融合
- "公司法股东权益保护" → 相关条文

- [ ] **Step 5: 手动验证语义检索**

- "员工被无故辞退后如何索赔" → 相关劳动法条文

- [ ] **Step 6: HNSW 索引验证**

```sql
EXPLAIN ANALYZE SELECT * FROM law_embeddings ORDER BY embedding <=> '[...]' LIMIT 5;
```

确认查询计划使用 HNSW 索引而非 Seq Scan。

- [ ] **Step 7: Commit 所有变更并总结**

```
docs(retrieval): 完成检索系统架构级优化
```

---

## 关键文件参考

| 现有文件 | 作用 | 复用点 |
|---------|------|--------|
| `server/services/legal/vectorStore.service.ts` | 向量存储底层 | `getPool()`, `getEmbeddingsAsync()`, `similaritySearchWithScore()` |
| `server/services/legal/searchLaw.tool.ts` | 法律搜索核心 | `searchLaw()` 改造, `isLawEffective()`, `applyDateFilter()` 复用 |
| `server/services/material/materialPipeline.service.ts` | 材料检索+上下文 | `searchMaterialsService()` 改造, `estimateTokens()` 复用 |
| `server/services/model/modelConfig.service.ts` | 模型配置 | `getEmbeddingConfigWithFallbackService()` 模式参照 |
| `server/services/node/node.service.ts` | 节点配置 | `getValidNodeConfig()` 调用 |
| `server/services/node/chatModelFactory.ts` | 模型工厂 | `createChatModel()` 调用 |
| `server/services/legal/lawEmbedding.service.ts` | 法律嵌入 | `buildEmbeddingText()` 修改, `updateLegalEmbeddings()` 复用 |
| `server/services/material/materialEmbedding.service.ts` | 材料嵌入 | 分块参数修改 |
