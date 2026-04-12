# 法条搜索性能优化设计

## 概述

法条搜索（`/api/v1/legal/search-articles`）当前响应慢（2-3s），主要瓶颈是每次搜索都调用 LLM 做意图分类（500-2000ms）。本方案通过 query 归一化 + 正则前置 + Redis 缓存三层优化，显著降低搜索延迟。同时修复复合查询（如"民法典第1001条 合同约定"）中语义部分被 exact 通道丢弃的问题。

## 背景

### 当前搜索链路

```
用户查询
  → classifyIntentService()          ← LLM 意图分类（500-2000ms）
  → retrievalRouter
    ├─ exact: exactSearch             ← 纯数据库查询
    ├─ hybrid: BM25 ∥ vector → RRF   ← 已并行
    └─ semantic: vector search
  → rerank（非 exact 时）
  → postFilter
```

### 问题

1. **每次搜索必调 LLM**：意图分类无缓存，即使相同查询也重复调用
2. **纯 exact 查询浪费 LLM**："民法典第100条"这类查询模式明确，不需要 LLM 判断
3. **复合查询语义丢失**："民法典第1001条 合同约定"被分类为 exact 后，"合同约定"被忽略

### 项目现状

- Redis 已集成（`ioredis`），用于分布式锁和定时任务调度，基础设施成本为零
- 意图分类模型 `temperature=0`，同一输入输出确定性，适合缓存
- `server/lib/redis.ts` 提供 `getRedisClient()` 单例

## 设计

### 架构总览

```
用户查询
  ↓
① normalizeQuery()                    ← 新增：归一化（< 1ms）
  ↓
② tryExactRegex(normalized)           ← 新增：正则前置
  ├─ 命中纯 exact → 直接返回 intent，跳过 LLM + Redis
  └─ 未命中 ↓
③ checkRedisCache(type, normalized)   ← 新增：Redis 缓存
  ├─ 缓存命中 → 返回缓存 intent
  └─ 未命中 ↓
④ LLM 意图分类（原有逻辑）
  ↓
⑤ 写入 Redis 缓存                      ← 新增
  ↓
⑥ retrievalRouter                     ← 改进：复合 exact 支持
  ├─ 纯 exact → exactSearch（不变）
  ├─ 复合 exact → exact ∥ hybrid → merge → rerank（新增）
  ├─ hybrid → BM25 ∥ vector → RRF → rerank（不变）
  └─ semantic → vector → rerank（不变）
```

### 模块一：Query 归一化

**新文件**：`server/services/retrieval/queryNormalizer.ts`

归一化规则（按顺序执行）：

1. **去空白**：trim + 合并连续空格为单个空格
2. **去冗余前缀**：去掉"中华人民共和国"（数据库存简称如"民法典"）
3. **中文数字转阿拉伯**：`第一千零七十九条` → `第1079条`，`第二百六十四条` → `第264条`
4. **全角转半角**：`１２３` → `123`

关键约束：
- 归一化只影响缓存 key 和正则匹配，**不改变传给 LLM 的原始 query**
- 归一化是纯函数，无副作用

导出函数：

```typescript
/** 归一化查询文本（用于缓存 key 和正则匹配） */
export function normalizeQuery(query: string): string

/** 中文数字转阿拉伯数字 */
export function chineseNumberToArabic(text: string): number

/** 阿拉伯数字转中文数字 */
export function arabicToChineseNumber(num: number): string
```

`arabicToChineseNumber` 用于正则前置模块：匹配到阿拉伯数字后转回中文，因为 `exactSearch` 的数据库查询用 `l5/l3 contains`，数据库存的是中文（"第一千零七十九条"）。

### 模块二：正则前置

**位置**：`server/services/retrieval/intentClassifier.service.ts` 内新增函数

对归一化后的 query 做模式匹配：

```
^(?<legalName>.+?)第(?<articleNum>\d+)条(第(?<clauseNum>\d+)款)?$
```

| 归一化后 query | 匹配？ | 结果 |
|---|---|---|
| `民法典第1079条` | 是 | `{ intent: 'exact', legalName: '民法典', articleRef: '第一千零七十九条' }` |
| `刑法第264条第2款` | 是 | `{ intent: 'exact', legalName: '刑法', articleRef: '第二百六十四条第二款' }` |
| `民法典第1001条 合同约定` | 否 | 走 LLM |
| `合同解除的法定条件` | 否 | 走 LLM |

匹配后 `articleRef` 转回中文数字格式（调用 `arabicToChineseNumber`），与数据库存储格式一致。

命中后返回的 `IntentClassification` 不含 `rewrittenQuery`/`keywords` → router 走纯 exact 快通道。

### 模块三：Redis 缓存意图分类

**位置**：`server/services/retrieval/intentClassifier.service.ts`

缓存策略：

| 配置 | 值 | 说明 |
|------|-----|------|
| key 格式 | `intent:{type}:{sha256_16(normalizedQuery)}` | type 区分 law/case_material |
| hash 算法 | `crypto.createHash('sha256').digest('hex').slice(0, 16)` | Node.js 内置，16 位 hex 足够 |
| TTL | 7 天（604800 秒） | 意图分类不依赖法条数据，节点配置变更频率极低 |
| 缓存值 | `JSON.stringify(IntentClassification)` | 完整的意图分类结果 |
| 失效策略 | TTL 自然过期 | 不做主动失效。节点配置变更后最多 7 天刷新 |
| Redis 异常 | 透明降级 | try-catch 包裹，异常时跳过缓存直接调 LLM |

`classifyIntentService` 内部流程变更：

```
classifyIntentService(query, type)
  → normalizedQuery = normalizeQuery(query)
  → 正则前置 → 命中则直接返回（不写缓存，因为正则结果是确定的）
  → cacheKey = buildCacheKey(type, normalizedQuery)
  → try { Redis GET } catch { 跳过 }
  → 缓存命中 → JSON.parse → 返回
  → 调 LLM（用原始 query，不是归一化后的）
  → try { Redis SET EX 604800 } catch { 跳过 }
  → 返回结果
```

### 模块四：Router 复合 exact 查询支持

**位置**：`server/services/retrieval/retrievalRouter.service.ts`

**判断依据**：`intent.intent === 'exact'` 且 `intent.rewrittenQuery` 或 `intent.keywords?.length > 0`

纯 exact（无 rewrittenQuery/keywords）：

```
exactSearch → 有结果则直接返回（不变）
           → 无结果则降级 hybrid（不变）
```

复合 exact（有 rewrittenQuery 或 keywords）：

```
Promise.all([
  exactSearch(intent),
  hybridSearch(intent, request),
])
→ 合并去重（exact 结果优先，按 articles_id 去重）
→ rerank 精排（用原始 query）
→ 返回 top-k
```

去重规则：
- 以 `metadata.articles_id` 为唯一键
- exact 和 hybrid 都命中同一条文时，保留 exact 结果（score=1.0）
- exact 结果排在前面，hybrid 结果追加在后

### 模块五：评估脚本同步

**位置**：`scripts/eval/search_law_tool/`

#### 5.1 evalRetrievalQuality.ts 更新

`searchWithoutRerank()` 函数（第 171-205 行）是 `retrievalRouter` 的镜像实现，有自己的 exact 分支。需同步复合 exact 逻辑：

```
case 'exact': {
  const isCompound = !!(intent.rewrittenQuery || intent.keywords?.length)
  if (isCompound) {
    // 并行 exact + hybrid（与 router 一致）
    const [exactResults, hybridResults] = await Promise.all([
      exactSearchService(intent),
      hybridSearchService(intent, request),
    ])
    results = mergeAndDedup(exactResults, hybridResults)
  } else {
    // 纯 exact（原有逻辑不变）
    ...
  }
}
```

另外，评估时 Redis 缓存会干扰延迟测量（重复 query 命中缓存显示虚假低延迟）。新增 `--no-cache` 参数：
- 传入时，在评估开始前调用 `disableIntentCache()` 临时禁用缓存
- 默认不传时使用缓存（模拟真实用户体验）

在 `intentClassifier.service.ts` 中导出缓存控制函数：
```typescript
/** 禁用意图缓存（评估脚本用） */
export function disableIntentCache(): void
/** 启用意图缓存（默认状态） */
export function enableIntentCache(): void
```

#### 5.2 evalDataset.json 补充复合 exact 用例

当前数据集有 exact/hybrid/semantic/edge 四类共 100 条用例，但没有复合 exact 场景。新增用例：

```json
{
  "id": "compound-exact-001",
  "query": "民法典第一千条 人格权保护",
  "type": "law",
  "expectedMode": "exact",
  "k": 10,
  "expectedHits": [
    { "match": { "legal_name": "中华人民共和国民法典", "content_contains": "人格权" }, "mustBeInTopN": 3 },
    { "match": { "content_contains": "人格权" }, "mustBeInTopN": 10 }
  ],
  "tags": ["compound-exact", "civil"]
}
```

新增 5 条左右复合 exact 用例，tag 为 `compound-exact`，验证：
- 精确条文出现在 top-3
- 语义相关条文也出现在结果中（不被丢弃）

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/services/retrieval/queryNormalizer.ts` | **新增** | 归一化 + 中文数字转换 |
| `server/services/retrieval/intentClassifier.service.ts` | 修改 | 加正则前置 + Redis 缓存 + 缓存控制函数 |
| `server/services/retrieval/retrievalRouter.service.ts` | 修改 | 复合 exact 并行搜索 |
| `scripts/eval/search_law_tool/evalRetrievalQuality.ts` | 修改 | 同步复合 exact 逻辑 + `--no-cache` 参数 |
| `scripts/eval/search_law_tool/evalDataset.json` | 修改 | 补充 compound-exact 用例 |
| `tests/server/retrieval/queryNormalizer.test.ts` | **新增** | 归一化和数字转换测试 |
| `tests/server/retrieval/intentClassifier.test.ts` | 修改 | 缓存和正则前置测试 |
| `tests/server/retrieval/retrievalRouter.test.ts` | 修改 | 复合 exact 测试 |

## 预期效果

| 场景 | 优化前 | 优化后 | 加速比 |
|------|--------|--------|--------|
| 纯 exact（"民法典第100条"） | 2-3s | 200-300ms | ~10x |
| 重复查询（缓存命中） | 2-3s | 500-1000ms | ~3x |
| 首次语义查询 | 2-3s | 2-3s | 无变化 |
| 复合 exact（"民法典第1001条 合同约定"） | 2-3s（语义丢失） | 2-3s（语义保留） | 质量提升 |

## 决策记录

| 决策 | 选项 | 选择 | 原因 |
|------|------|------|------|
| 缓存失效策略 | 主动清除 / 短 TTL / 版本号 / 长 TTL | 长 TTL（7天） | 节点配置变更频率极低，不值得增加耦合 |
| Redis 异常处理 | 透明降级 / 强依赖 | 透明降级 | 缓存是加速层，不应成为单点故障 |
| 归一化传给 LLM | 是 / 否 | 否 | LLM 自身有数字转换能力，传原始 query 更完整 |
| 复合查询策略 | 只走 exact / exact ∥ hybrid | exact ∥ hybrid | 修复语义部分丢失问题 |
| 正则匹配范围 | 纯 exact / 含复合 | 纯 exact | 复合查询需要 LLM 提取 rewrittenQuery，正则无法替代 |

## 不做的事

- **不缓存完整搜索结果**：法条搜索带各种 filter 组合（日期、法律类型、有效性），缓存 key 爆炸且命中率低
- **不换轻量模型**：需要评估准确率，可以后续独立进行
- **不做 embedding 并行化**：意图分类会输出 rewrittenQuery 供后续 embedding 使用，并行化会用错 query
