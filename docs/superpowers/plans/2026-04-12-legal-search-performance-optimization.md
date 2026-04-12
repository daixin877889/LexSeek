# 法条搜索性能优化 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 query 归一化 + 正则前置 + Redis 缓存三层优化，将法条搜索延迟从 2-3s 降至 200ms-1s；同时修复复合 exact 查询语义丢失问题。

**Architecture:** 在 `classifyIntentService` 内部新增三层前置拦截（归一化→正则→Redis 缓存），命中即返回跳过 LLM。Router 层新增复合 exact 分支（exact ∥ hybrid 并行搜索+合并去重）。评估脚本同步更新。

**Tech Stack:** TypeScript, ioredis, Node.js crypto, [nzh](https://www.npmjs.com/package/nzh)（中文数字 ↔ 阿拉伯数字转换）, Vitest

**Spec:** `docs/superpowers/specs/2026-04-12-legal-search-performance-optimization-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `server/services/retrieval/queryNormalizer.ts` | **新增** | normalizeQuery + tryExactRegex + 内部数字转换 |
| `server/services/retrieval/intentClassifier.service.ts` | 修改 | 签名加 options, 调用 normalizeQuery/tryExactRegex/Redis 缓存 |
| `server/services/retrieval/retrievalRouter.service.ts` | 修改 | 复合 exact 分支 + mergeAndDedup 导出 |
| `scripts/eval/search_law_tool/evalRetrievalQuality.ts` | 修改 | 同步复合 exact + --no-cache + Redis mock |
| `scripts/eval/search_law_tool/evalDataset.json` | 修改 | 新增 6 条评估用例 |
| `tests/server/retrieval/queryNormalizer.test.ts` | **新增** | 归一化 + 数字转换 + 正则前置测试 |
| `tests/server/retrieval/intentClassifier.test.ts` | 修改 | Redis 缓存 + skipCache 测试 |
| `tests/server/retrieval/retrievalRouter.test.ts` | 修改 | 复合 exact 测试 |

---

### Task 1: Query 归一化 — 纯函数与测试

**Files:**
- Create: `server/services/retrieval/queryNormalizer.ts`
- Create: `tests/server/retrieval/queryNormalizer.test.ts`

**前置准备：安装依赖 + 确认数据库格式**

- [ ] **Step 1: 安装 nzh 库**

```bash
bun add nzh
```

`nzh` 用于中文数字 ↔ 阿拉伯数字双向转换，避免自行实现边界 case 多的转换逻辑。

- [ ] **Step 2: 查询数据库确认 l5 字段格式**

```bash
docker exec $(docker ps -q --filter "ancestor=postgres" | head -1) psql -U daixin -d ls_new -c "SELECT DISTINCT l5 FROM \"legalArticles\" WHERE l5 LIKE '%第%条%' AND l5 IS NOT NULL LIMIT 20;"
```

记录输出格式（如"第十条"、"第一百零一条"等），用于对齐 `arabicToChineseNumber` 的输出。

**TDD: 归一化函数**

- [ ] **Step 3: 编写 normalizeQuery 失败测试**

`tests/server/retrieval/queryNormalizer.test.ts`:

```typescript
/**
 * Query 归一化测试
 *
 * **Feature: retrieval**
 * **Validates: Requirements queryNormalizer**
 */
import { describe, it, expect } from 'vitest'
import { normalizeQuery, tryExactRegex } from '../../../server/services/retrieval/queryNormalizer'

describe('normalizeQuery', () => {
    it('去空白：trim + 合并连续空格', () => {
        expect(normalizeQuery('  民法典  第100条  ')).toBe('民法典 第100条')
    })

    it('去 Unicode 控制字符', () => {
        expect(normalizeQuery('民法典\u200B第100条')).toBe('民法典第100条')
        expect(normalizeQuery('民法典\uFEFF第100条')).toBe('民法典第100条')
    })

    it('去冗余前缀"中华人民共和国"', () => {
        expect(normalizeQuery('中华人民共和国民法典第一百条')).toBe('民法典第100条')
    })

    it('中文数字转阿拉伯仅作用于"第X条/款"', () => {
        expect(normalizeQuery('民法典第一千零七十九条')).toBe('民法典第1079条')
        expect(normalizeQuery('刑法第二百六十四条第二款')).toBe('刑法第264条第2款')
        expect(normalizeQuery('民法典第三编 合同')).toBe('民法典第三编 合同')  // 不转换"编"
    })

    it('全角转半角', () => {
        expect(normalizeQuery('民法典第１００条')).toBe('民法典第100条')
    })

    it('不同写法归一化为相同结果', () => {
        const expected = '民法典第100条'
        expect(normalizeQuery('民法典第一百条')).toBe(expected)
        expect(normalizeQuery('民法典第100条')).toBe(expected)
        expect(normalizeQuery('中华人民共和国民法典第一百条')).toBe(expected)
        expect(normalizeQuery('民法典第１００条')).toBe(expected)
    })

    it('空字符串安全处理', () => {
        expect(normalizeQuery('')).toBe('')
        expect(normalizeQuery('   ')).toBe('')
    })
})
```

- [ ] **Step 4: 运行测试确认失败**

```bash
npx vitest run tests/server/retrieval/queryNormalizer.test.ts --reporter=verbose
```

预期：FAIL（模块不存在）

- [ ] **Step 5: 实现 normalizeQuery**

`server/services/retrieval/queryNormalizer.ts`:

实现 `normalizeQuery` 函数，包含 5 步归一化规则。使用 `nzh` 库进行中文数字双向转换。

关键点：
- 中文数字转换用正则 `/第([零〇一二两三四五六七八九十百千万]+)([条款])/g` 匹配，只替换"条"和"款"前的中文数字
- 中文→阿拉伯：`Nzh.cn.decodeS("一千零七十九")` → `1079`
- 阿拉伯→中文：`Nzh.cn.encodeS(1079)` → `"一千零七十九"`（`nzh` 默认 `tenMin=true`，10→"十" 而非 "一十"）
- **转换失败防护**：`decodeS` 对非标准写法（如"十十"）返回 NaN 或 0，需校验 `num > 0`，转换失败时保留原文不替换
- Step 2 查到的 DB 格式用于验证 `nzh` 输出是否一致，如有差异需 wrapper 调整
- 全角转半角用 `String.fromCharCode(charCode - 0xFEE0)` 处理 `0xFF01-0xFF5E` 范围

- [ ] **Step 6: 运行测试确认通过**

```bash
npx vitest run tests/server/retrieval/queryNormalizer.test.ts --reporter=verbose
```

预期：所有 normalizeQuery 测试 PASS

**TDD: tryExactRegex（数字转换边界 + 正则边界合并为一个 RED→GREEN 循环）**

- [ ] **Step 7: 编写 tryExactRegex 全部测试（数字边界 + 正则边界）**

在同一测试文件中追加：

```typescript
describe('tryExactRegex — 数字转换边界', () => {
    const cases: [string, string][] = [
        ['第10条', '第十条'],      // 非"第一十条"
        ['第11条', '第十一条'],
        ['第20条', '第二十条'],
        ['第100条', '第一百条'],
        ['第101条', '第一百零一条'],
        ['第110条', '第一百一十条'],
        ['第1000条', '第一千条'],
        ['第1001条', '第一千零一条'],
        ['第1010条', '第一千零一十条'],
        ['第1079条', '第一千零七十九条'],
    ]

    for (const [arabic, chinese] of cases) {
        it(`tryExactRegex: "${arabic}" → articleRef="${chinese}"`, () => {
            const result = tryExactRegex(arabic.replace('第', '民法典第'))
            expect(result).not.toBeNull()
            expect(result!.articleRef).toBe(chinese)
        })
    }
})

describe('tryExactRegex — 匹配/不匹配边界', () => {
    it('纯 exact 命中', () => {
        const r = tryExactRegex('民法典第100条')
        expect(r).toEqual({ intent: 'exact', legalName: '民法典', articleRef: '第一百条' })
    })

    it('带款号 — articleRef 只到条', () => {
        const r = tryExactRegex('刑法第264条第2款')
        expect(r).toEqual({ intent: 'exact', legalName: '刑法', articleRef: '第二百六十四条' })
    })

    it('名称与条号间有空格 — trim legalName', () => {
        const r = tryExactRegex('民法典 第100条')
        expect(r?.legalName).toBe('民法典')
    })

    it('复合查询不匹配', () => {
        expect(tryExactRegex('民法典第100条 合同约定')).toBeNull()
    })

    it('仅条文号不匹配', () => {
        expect(tryExactRegex('第100条')).toBeNull()
    })

    it('legalName 单字不匹配', () => {
        expect(tryExactRegex('法第1条')).toBeNull()
    })

    it('无"第N条"模式不匹配', () => {
        expect(tryExactRegex('合同解除的法定条件')).toBeNull()
    })

    it('不含 rewrittenQuery/keywords', () => {
        const r = tryExactRegex('民法典第100条')
        expect(r?.rewrittenQuery).toBeUndefined()
        expect(r?.keywords).toBeUndefined()
    })
})
```

- [ ] **Step 8: 运行测试确认失败**（tryExactRegex 尚未实现）

- [ ] **Step 9: 实现 tryExactRegex**

在 `queryNormalizer.ts` 中新增 `tryExactRegex` 导出函数。逻辑：
1. 正则匹配 `^(?<legalName>.+?)第(?<articleNum>\d+)条(第(?<clauseNum>\d+)款)?$`
2. legalName trim + 长度 >= 2 校验
3. articleRef 只取"条"部分（丢弃"款"），调用 `arabicToChineseNumber` 转回中文
4. 返回 `IntentClassification | null`

- [ ] **Step 10: 运行测试确认通过**

```bash
npx vitest run tests/server/retrieval/queryNormalizer.test.ts --reporter=verbose
```

预期：全部 PASS

- [ ] **Step 11: Commit**

```bash
git add server/services/retrieval/queryNormalizer.ts tests/server/retrieval/queryNormalizer.test.ts
git commit -m "feat(retrieval): 新增 query 归一化和正则前置模块

- normalizeQuery: 空白清理、Unicode控制字符、去前缀、中文数字转阿拉伯、全角转半角
- tryExactRegex: 纯 exact 模式正则识别，articleRef 只到条（不含款）
- arabicToChineseNumber 格式与 DB legalArticles.l5 对齐"
```

---

### Task 2: Redis 缓存意图分类

**Files:**
- Modify: `server/services/retrieval/intentClassifier.service.ts`
- Modify: `tests/server/retrieval/intentClassifier.test.ts`

**TDD: 正则前置和 Redis 缓存**

- [ ] **Step 1: 添加 Redis mock 并编写正则前置跳过 LLM 的测试**

在 `tests/server/retrieval/intentClassifier.test.ts` 中，现有 mock 区域新增 Redis mock（防止测试中真实连接 Redis 导致不稳定）：

```typescript
// Mock Redis（防止测试中真实连接 Redis）
vi.mock('../../../server/lib/redis', () => ({
    getRedisClient: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(null),  // 默认缓存 miss
        set: vi.fn().mockResolvedValue('OK'),
    }),
}))
```

然后追加测试：

```typescript
describe('正则前置 + Redis 缓存', () => {
    it('type=law 纯 exact 查询 — 正则命中，跳过 LLM', async () => {
        const result = await classifyIntentService('民法典第100条', 'law')
        expect(result.intent).toBe('exact')
        expect(result.legalName).toBe('民法典')
        expect(createChatModel).not.toHaveBeenCalled()
    })

    it('type=case_material — 正则跳过，走 LLM', async () => {
        const llmResult = { intent: 'hybrid', keywords: ['民法典'] }
        const { model } = makeMockModel(llmResult)
        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('民法典第100条', 'case_material')
        expect(result.intent).toBe('hybrid')
        expect(createChatModel).toHaveBeenCalledOnce()
    })

    it('skipCache=true — 跳过 Redis 缓存', async () => {
        const llmResult = { intent: 'hybrid', keywords: ['合同'] }
        const { model } = makeMockModel(llmResult)
        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('合同解除条件', 'law', { skipCache: true })
        expect(result.intent).toBe('hybrid')
        expect(createChatModel).toHaveBeenCalledOnce()
    })

    it('Redis 连接失败 — 透明降级到 LLM', async () => {
        const { getRedisClient } = await import('../../../server/lib/redis')
        vi.mocked(getRedisClient().get).mockRejectedValueOnce(new Error('ECONNREFUSED'))

        const llmResult = { intent: 'semantic', rewrittenQuery: '合同纠纷' }
        const { model } = makeMockModel(llmResult)
        vi.mocked(getValidNodeConfig).mockResolvedValue(makeNodeConfig() as never)
        vi.mocked(createChatModel).mockReturnValue(model as never)

        const result = await classifyIntentService('合同纠纷', 'law')
        expect(result.intent).toBe('semantic')
        expect(createChatModel).toHaveBeenCalledOnce()
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/retrieval/intentClassifier.test.ts --reporter=verbose
```

预期：新测试 FAIL（classifyIntentService 签名不接受 options）

- [ ] **Step 3: 实现意图分类器改造**

修改 `server/services/retrieval/intentClassifier.service.ts`：

1. 新增 import: `normalizeQuery`, `tryExactRegex` from `./queryNormalizer`，`createHash` from `node:crypto`，`getRedisClient` from `../../lib/redis`
2. 签名加 `options?: { skipCache?: boolean }`
3. 函数开头：
   - `normalizedQuery = normalizeQuery(query)`
   - `if (type === 'law')` 调用 `tryExactRegex(normalizedQuery)`，命中直接 return
   - `if (!options?.skipCache)` 尝试 Redis GET + JSON.parse + intent 校验 + case_material 降级，整体在 try-catch 内
4. 原有 LLM 逻辑不变
5. LLM 返回后、case_material 降级前：`if (!options?.skipCache)` 写 Redis SET EX 86400（存 LLM 原始结果）
6. case_material 降级逻辑保持在最后

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/retrieval/intentClassifier.test.ts --reporter=verbose
```

预期：全部 PASS（现有测试因 Redis 透明降级不受影响，新测试 PASS）

- [ ] **Step 5: Commit**

```bash
git add server/services/retrieval/intentClassifier.service.ts tests/server/retrieval/intentClassifier.test.ts
git commit -m "feat(retrieval): 意图分类加正则前置和 Redis 缓存

- type=law 时正则前置拦截纯 exact 查询，跳过 LLM（~10x 加速）
- Redis 缓存意图分类结果（TTL 1天，透明降级）
- 签名新增 options.skipCache 供评估脚本使用
- 缓存存 LLM 原始结果，降级在读取端执行"
```

---

### Task 3: Router 复合 exact 查询支持

**Files:**
- Modify: `server/services/retrieval/retrievalRouter.service.ts`
- Modify: `tests/server/retrieval/retrievalRouter.test.ts`

- [ ] **Step 1: 编写 mergeAndDedup 独立单元测试 + 复合 exact 集成测试**

在 `tests/server/retrieval/retrievalRouter.test.ts` 中追加：

```typescript
// 先导入 mergeAndDedup（Task 3 实现后导出）
import { mergeAndDedup } from '../../../server/services/retrieval/retrievalRouter.service'

describe('mergeAndDedup', () => {
    it('无重复时拼接（exact 在前 hybrid 在后）', () => {
        const exact = [makeRetrievalResult({ metadata: { articles_id: 'a1' } })]
        const hybrid = [makeRetrievalResult({ metadata: { articles_id: 'a2' }, retrievalMode: 'hybrid' })]
        const result = mergeAndDedup(exact, hybrid)
        expect(result).toHaveLength(2)
        expect(result[0].metadata.articles_id).toBe('a1')
        expect(result[1].metadata.articles_id).toBe('a2')
    })

    it('重复时保留 exact 结果', () => {
        const exact = [makeRetrievalResult({ score: 1.0, metadata: { articles_id: 'a1' } })]
        const hybrid = [makeRetrievalResult({ score: 0.7, metadata: { articles_id: 'a1' }, retrievalMode: 'hybrid' })]
        const result = mergeAndDedup(exact, hybrid)
        expect(result).toHaveLength(1)
        expect(result[0].score).toBe(1.0)
    })

    it('空数组安全处理', () => {
        expect(mergeAndDedup([], [])).toEqual([])
        const exact = [makeRetrievalResult({ metadata: { articles_id: 'a1' } })]
        expect(mergeAndDedup(exact, [])).toHaveLength(1)
        expect(mergeAndDedup([], [makeRetrievalResult({ metadata: { articles_id: 'a1' } })])).toHaveLength(1)
    })

    it('articles_id 不存在时 fallback 到 content 去重', () => {
        const exact = [makeRetrievalResult({ content: '相同内容', metadata: {} })]
        const hybrid = [makeRetrievalResult({ content: '相同内容', metadata: {}, retrievalMode: 'hybrid' })]
        const result = mergeAndDedup(exact, hybrid)
        expect(result).toHaveLength(1)
    })
})

describe('intent=exact + 复合查询（有 rewrittenQuery）', () => {
    it('并行 exact + hybrid，合并去重后 rerank', async () => {
        const exactResults: RetrievalResult[] = [
            makeRetrievalResult({ content: '精确条文', score: 1.0, metadata: { articles_id: 'a1' } }),
        ]
        const hybridItems: SearchResultItem[] = [
            makeSearchItem({ content: '语义相关条文', score: 0.8, metadata: { articles_id: 'a2' } }),
            makeSearchItem({ content: '精确条文重复', score: 0.7, metadata: { articles_id: 'a1' } }),
        ]
        const rerankedItems: SearchResultItem[] = [
            makeSearchItem({ content: '精确条文', score: 0.95, metadata: { articles_id: 'a1' } }),
            makeSearchItem({ content: '语义相关条文', score: 0.85, metadata: { articles_id: 'a2' } }),
        ]

        mocks.classifyIntentService.mockResolvedValue({
            intent: 'exact',
            legalName: '民法典',
            articleRef: '第一千零一条',
            rewrittenQuery: '民法典合同约定',
            keywords: ['合同约定'],
        } satisfies IntentClassification)
        mocks.exactSearchService.mockResolvedValue(exactResults)
        mocks.hybridSearchService.mockResolvedValue(hybridItems)
        mocks.rerankAndFilterService.mockResolvedValue(rerankedItems)

        const result = await retrievalRouterService(makeRequest())

        expect(mocks.exactSearchService).toHaveBeenCalledOnce()
        expect(mocks.hybridSearchService).toHaveBeenCalledOnce()
        expect(mocks.rerankAndFilterService).toHaveBeenCalledOnce()
    })

    it('纯 exact（无 rewrittenQuery）— 不走复合分支', async () => {
        mocks.classifyIntentService.mockResolvedValue({
            intent: 'exact',
            legalName: '民法典',
            articleRef: '第一百条',
        } satisfies IntentClassification)
        mocks.exactSearchService.mockResolvedValue([makeRetrievalResult()])

        await retrievalRouterService(makeRequest())

        expect(mocks.hybridSearchService).not.toHaveBeenCalled()
        expect(mocks.rerankAndFilterService).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 mergeAndDedup 和复合 exact 分支**

修改 `server/services/retrieval/retrievalRouter.service.ts`：

1. 新增导出函数 `mergeAndDedup(exactResults: RetrievalResult[], hybridResults: RetrievalResult[]): RetrievalResult[]`
   - 去重 ID 提取：`(r.metadata.articles_id as string) || r.content.slice(0, 50)`（与 `hybridSearch.service.ts` 中 `extractDocId` 的 fallback 策略一致）
   - exact 结果先入 Set，hybrid 中重复的跳过
   - exact 结果在前，hybrid 追加在后
2. 修改 `case 'exact'` 分支：
   - 判断 `isCompound = !!(intent.rewrittenQuery || intent.keywords?.length)`
   - 复合：`Promise.all([exactSearch, hybridSearch])`，类型转换 hybridRaw，`mergeAndDedup`，走 rerank
   - 纯 exact：保持原有逻辑

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/retrieval/retrievalRouter.test.ts --reporter=verbose
```

- [ ] **Step 5: Commit**

```bash
git add server/services/retrieval/retrievalRouter.service.ts tests/server/retrieval/retrievalRouter.test.ts
git commit -m "feat(retrieval): Router 支持复合 exact 查询

- 复合 exact（有 rewrittenQuery/keywords）并行跑 exact + hybrid
- mergeAndDedup 按 articles_id 去重，exact 结果优先
- 修复语义部分在 exact 通道中被丢弃的问题"
```

---

### Task 4: 评估脚本同步

**Files:**
- Modify: `scripts/eval/search_law_tool/evalRetrievalQuality.ts`
- Modify: `scripts/eval/search_law_tool/evalDataset.json`

- [ ] **Step 1: 更新评估脚本 useRuntimeConfig mock**

在 `evalRetrievalQuality.ts` 第 42-57 行的 `g.useRuntimeConfig` mock 中新增 Redis 配置：

```typescript
redis: {
    url: process.env.NUXT_REDIS_URL || process.env.REDIS_URL || '',
},
```

- [ ] **Step 2: 新增 --no-cache 参数支持**

在 `main()` 函数的参数解析部分（第 389 行附近）新增：

```typescript
const noCache = args.includes('--no-cache')
```

`searchWithoutRerank` 中直接调 `classifyIntentService` 时传 `{ skipCache: noCache }`。`retrievalRouterService` 调用不透传（主流程用缓存，评估脚本中 `retrievalRouterService` 通过完整链路模拟真实场景）。

- [ ] **Step 3: 同步复合 exact 逻辑到 searchWithoutRerank**

导入 `mergeAndDedup` from `retrievalRouter.service`，在 `case 'exact'` 分支中加入复合 exact 判断（参照 spec 模块五代码片段）。复合 exact 在 searchWithoutRerank 中不做 rerank，仅 mergeAndDedup 后直接返回。

**类型处理**：`searchWithoutRerank` 中 `results` 变量类型为 `SearchResultItem[]`，但 `mergeAndDedup` 返回 `RetrievalResult[]`。需在复合 exact 分支中将 `mergeAndDedup` 返回值 map 去掉 `retrievalMode` 转回 `SearchResultItem[]`：

```typescript
const merged = mergeAndDedup(
    exactResults.map(r => ({ ...r, retrievalMode: 'exact' as const })),
    hybridResults.map(r => ({ ...r, retrievalMode: 'hybrid' as const })),
)
results = merged.map(({ retrievalMode, ...rest }) => rest)
```

- [ ] **Step 4: 查询数据库创建真实评估用例**

```bash
docker exec $(docker ps -q --filter "ancestor=postgres" | head -1) psql -U daixin -d ls_new -c "
SELECT lm.name, la.l5, LEFT(la.content, 50) as content_preview
FROM \"legalArticles\" la
JOIN \"legalMain\" lm ON la.\"legalId\" = lm.id
WHERE la.l5 LIKE '%第一千条%' OR la.l5 LIKE '%第二百六十四条%'
LIMIT 10;
"
```

基于真实数据创建 6 条新用例：3 条 `compound-exact` + 2 条 `normalize` + 1 条 `case-material-exact`

- [ ] **Step 5: 更新 evalDataset.json**

- [ ] **Step 6: Commit**

```bash
git add scripts/eval/search_law_tool/evalRetrievalQuality.ts scripts/eval/search_law_tool/evalDataset.json
git commit -m "chore(eval): 同步复合 exact 逻辑和新增评估用例

- useRuntimeConfig mock 补充 redis.url
- 新增 --no-cache 参数跳过 Redis 缓存
- searchWithoutRerank 同步复合 exact 分支
- 新增 6 条评估用例覆盖 compound-exact/normalize/case-material-exact"
```

---

### Task 5: 全量测试验证

- [ ] **Step 1: 运行全部检索模块测试**

```bash
npx vitest run tests/server/retrieval/ --reporter=verbose
```

预期：全部 PASS

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

预期：无类型错误

- [ ] **Step 3: 运行全量测试套件**

```bash
bun run test
```

预期：全部 PASS

- [ ] **Step 4: Commit（如有修复）**

---

## 验证计划

### 自动化验证
1. `npx vitest run tests/server/retrieval/` — 所有检索模块测试通过
2. `npx nuxi typecheck` — 无类型错误
3. `bun run test` — 全量测试通过

### 手动验证（可选）
1. 启动开发服务器 `bun dev`
2. 在 dashboard 法律法规页面搜索"民法典第100条"，确认响应时间 < 500ms
3. 重复搜索同一查询，确认第二次更快（缓存命中）
4. 搜索"中华人民共和国民法典第一百条"，确认全称前缀 + 中文数字归一化端到端工作
5. 搜索"民法典第1001条 合同约定"，确认结果中同时包含精确条文和语义相关条文

### 评估脚本验证（可选）
```bash
bun ./scripts/eval/search_law_tool/evalRetrievalQuality.ts --tags=compound-exact --no-cache --verbose
```
