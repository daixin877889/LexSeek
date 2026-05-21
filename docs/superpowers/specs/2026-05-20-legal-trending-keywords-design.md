# 法律法规检索页 - 默认列表 + 动态热门检索 设计稿

- 日期：2026-05-20
- 影响范围：`/dashboard/legal` 搜全文 tab、`server/api/v1/legal/**`
- 状态：待 review

## 一、背景

`/dashboard/legal` 当前存在两个体验问题：

1. **搜全文 tab 默认空白**：未输入关键词时，列表区为空（受 `hasSearchResults` 开关控制），用户进入页面看不到任何法律法规，必须先搜一次。
2. **热门检索是死的**：页面顶部「热门检索」一栏目前是前端硬编码的 5 个词（`TRENDING_KEYWORDS`），无法反映真实的用户搜索热度。

需求：
- 搜全文 tab 进入即按 `publishDate desc` 加载第一页法律法规，作为默认浏览列表。
- 热门检索改为基于过去 7 天用户搜索关键词热度动态展示，两个 tab（搜全文 / 搜法条）**分别统计**。
- 全量保留搜索日志（含命中数、命中条目 ID），用于后续数据分析（零结果搜索分析、语义召回质量验证等）。

## 二、目标与非目标

### 目标
- 搜全文 tab 默认即看到一页法律法规（按发布日期倒序）。
- 默认状态下隐藏「找到 X 部法律法规（耗时 X 秒）+ 排序」标题行，只在用户输入关键词后才显示。
- 热门检索 7 天滑动窗口，按 tab 分桶，缓存 60 秒。
- DB 全量日志，含 `keyword / scope / userId / resultCount / resultIds`，支持后续数据分析。
- 冷启动（库里数据不足 5 条）时前端用 5 个硬编码兜底词补齐。

### 非目标
- 不做管理端热搜管理（黑名单、置顶推荐、运营干预）。
- 不做搜索 → 点击 → 转化的链路分析（仅在 schema 上预留 `resultIds`）。
- 不做日志清理 cron（数据分析需要历史）。

## 三、整体架构

```
用户输入关键词 → 点检索
       │
       ├─► [GET] /api/v1/legal/list             ┐
       │                                         ├─► trendingService.recordSearch()
       └─► [POST] /api/v1/legal/search-articles ┘        │
                                                          ├─► Redis NX 防刷 (30s)
                                                          │      ├── 命中 → 跳过
                                                          │      └── 未命中 → 并行：
                                                          │             ├─► Redis ZINCRBY 时间桶
                                                          │             └─► Prisma INSERT legal_search_logs
                                                          │
默认进入页面 / 切到搜全文 ──► useLegalSearch.search() 立即拉 list（keyword 为空，按 publishDate desc）

热门检索区 ──► [GET] /api/v1/legal/trending-keywords?scope=legal|article
                            │
                            ├── Redis GET trending:cache:{scope} 命中（60s TTL）
                            └── 未命中 → ZUNIONSTORE 最近 7 天桶 → ZREVRANGE 0 4 → 缓存 60s
```

## 四、数据库设计

### 4.1 新增表 `legal_search_logs`

`prisma/models/legal.prisma` 追加：

```prisma
model legal_search_logs {
  id          String   @id @default(cuid())
  scope       String   // 'legal' | 'article'
  keyword     String   // 归一化后（trim / 合并空格）
  userId      String?
  resultCount Int?     // 本次搜索命中总数
  resultIds   Json?    // { ids: string[], scores?: number[] } —— jsonb
  createdAt   DateTime @default(now())

  @@index([scope, createdAt])
  @@index([keyword, scope])
  @@index([userId, createdAt])
}
```

**`resultIds` 写入边界**：
- 搜全文：`ids` 为第一次返回的当前页前 20 条 `legalMain.id`，按返回顺序；不存 `scores`。
- 搜法条：`ids` 为前 20 条 `articles_id`，按返回顺序；`scores` 为对应的语义相似度。

**迁移命令**：
```bash
bun run prisma:migrate --name add_legal_search_logs
```

## 五、Redis 协议

| Key | 类型 | TTL | 用途 |
|---|---|---|---|
| `dedupe:trending:{userId}:{scope}:{keyword}` | string | 30s | 防刷去重：30 秒内同一用户对同 (scope, keyword) 的重复搜索不计入热搜 / 不写日志 |
| `trending:bucket:{scope}:{YYYYMMDD}` | zset | 8 天 | 当日热搜计数桶；member = keyword，score = 累计次数 |
| `trending:cache:{scope}` | string (JSON) | 60s | top N 热搜查询结果缓存 |
| `trending:tmp:{scope}:{ts}` | zset | 60s | ZUNIONSTORE 临时合并结果（使用后 DEL） |

`{userId}` 在未登录用户访问搜索接口时不会触发（接口要求登录）。键统一用 userId，不引入 IP 兜底。

> 注：`legal_search_logs.userId` 设为可空只是为了未来扩展（如离线脚本回灌、管理端工具搜索），当前线上写入路径都来自鉴权后的接口，实际不会落 NULL。

## 六、服务端实现

### 6.1 新增 service：`server/services/legal/trending.service.ts`

```ts
import { getRedisClient } from '~~/server/lib/redis'
import { prisma } from '~~/server/utils/db'
import dayjs from 'dayjs'

const MAX_TOP = 5
const DEDUPE_TTL = 30
const BUCKET_TTL = 60 * 60 * 24 * 8   // 8 天
const CACHE_TTL = 60

export interface TrendingItem {
  keyword: string
  count: number
}

/** 关键词归一化：trim、连续空格合并、长度 [2, 50]，否则返回 null */
export function normalizeKeywordService(raw: string): string | null { /* ... */ }

/** 记录一次有效搜索（含 Redis 计数 + DB 日志），失败吞，不影响主流程 */
export async function recordSearchService(params: {
  scope: 'legal' | 'article'
  rawKeyword: string
  userId: string | null
  resultCount?: number
  resultIds?: { ids: string[]; scores?: number[] }
}): Promise<void> { /* ... */ }

/** 取近 7 天 top N 热搜，60s 缓存；失败时返回 [] 让前端兜底 */
export async function getTrendingKeywordsService(
  scope: 'legal' | 'article',
  limit = MAX_TOP,
): Promise<TrendingItem[]> { /* ... */ }
```

**关键实现细节**：

- `normalizeKeywordService`：`raw.trim().replace(/\s+/g, ' ')`；长度 < 2 或 > 50 返回 null；纯标点也返回 null。
- `recordSearchService`：
  1. 调 `normalizeKeywordService`，拿到 null 直接 return
  2. `redis.set(dedupeKey, '1', 'EX', 30, 'NX')` → 返回 null 表示命中防刷，return
  3. 并行：
     - `redis.zincrby(bucketKey, 1, keyword)` + `redis.expire(bucketKey, BUCKET_TTL)`
     - `prisma.legal_search_logs.create({ data: { scope, keyword, userId, resultCount, resultIds } })`
  4. 整体 try/catch，失败 logger.warn 不抛
- `getTrendingKeywordsService`：
  1. `redis.get(cacheKey)` 命中直接 JSON.parse 返回
  2. 算最近 7 天的 7 个 bucket key（今天 + 过去 6 天）
  3. `redis.zunionstore(tmpKey, 7, ...bucketKeys, 'AGGREGATE', 'SUM')`
  4. `redis.zrevrange(tmpKey, 0, limit - 1, 'WITHSCORES')` → 解析为 `[{ keyword, count }]`
  5. `redis.del(tmpKey)`
  6. `redis.set(cacheKey, JSON.stringify(items), 'EX', CACHE_TTL)`
  7. return items

### 6.2 改造 `legal/list.get.ts`

在原响应构造完成、`resSuccess` 之前插入：

```ts
if (keyword?.trim()) {
  await recordSearchService({
    scope: 'legal',
    rawKeyword: keyword,
    userId: user.id ?? null,
    resultCount: total,
    resultIds: { ids: items.slice(0, 20).map(i => i.id) },
  })
}
```

> `await` 不阻塞返回——service 内部错误吞，p95 增量 < 5ms。

### 6.3 改造 `legal/search-articles.post.ts`

同样在响应前插入，scope 改 `'article'`，`resultIds` 含 `scores`（来源是返回结果里的 `score` 字段，取前 20 条）。

### 6.4 新增接口 `legal/trending-keywords.get.ts`

```
GET /api/v1/legal/trending-keywords?scope=legal|article&limit=5
```

- 参数校验：zod，`scope` 必填，`limit` 默认 5、范围 1-20
- 鉴权：要求登录
- 调 `getTrendingKeywordsService(scope, limit)` 返回 `{ items: TrendingItem[] }`

## 七、前端实现

### 7.1 新增 composable：`app/composables/useTrendingKeywords.ts`

```ts
import { useApiFetch } from '~/composables/useApiFetch'

const FALLBACK_KEYWORDS = ['中华人民共和国民法典', '劳动合同法', '公司法', '工程施工', '招标投标法']

export function useTrendingKeywords() {
  const keywords = ref<string[]>([])
  const loading = ref(false)

  /** 拉取指定 scope 的热搜，不足 5 条时用 FALLBACK 去重补齐 */
  async function load(scope: 'legal' | 'article') {
    loading.value = true
    try {
      const data = await useApiFetch<{ items: { keyword: string; count: number }[] }>(
        '/api/v1/legal/trending-keywords',
        { query: { scope } },
      )
      const dynamic = data?.items?.map(i => i.keyword) ?? []
      const merged: string[] = []
      for (const kw of [...dynamic, ...FALLBACK_KEYWORDS]) {
        if (!merged.includes(kw)) merged.push(kw)
        if (merged.length >= 5) break
      }
      keywords.value = merged
    } finally {
      loading.value = false
    }
  }

  return { keywords, loading, load }
}
```

### 7.2 改造 `app/pages/dashboard/legal/index.vue`

1. **删除硬编码 `TRENDING_KEYWORDS` 常量**
2. **引入 `useTrendingKeywords`**：
   ```ts
   const trending = useTrendingKeywords()
   onMounted(() => trending.load(activeTab.value))
   watch(activeTab, val => trending.load(val))
   ```
3. **热门检索区域改用 `trending.keywords.value`**
4. **删除 `hasSearchResults` 守卫**：搜全文 tab 的列表区始终渲染：
   - 进入页面在 `onMounted` 末尾，若 `restoreFromUrl` 没有触发过 search（即 URL 没带 keyword / type / issuingAuthority），主动调一次 `legalSearch.search()` 拉默认列表
   - 切回 `legal` tab 时若 `legalSearch.legalList.value` 为空，再调一次 search 保证有数据
   - 重置按钮 `handleReset` 内的 `legalSearch.resetFilters()` 自带 search 调用，行为不变
5. **隐藏标题行的条件**：
   ```vue
   <div v-if="searchKeyword.trim()" class="mb-3 flex flex-wrap items-baseline justify-between gap-3">
     <h2>找到 {{ ... }} 部法律法规（耗时 {{ ... }} 秒）</h2>
     <Select ...>排序</Select>
   </div>
   ```
   即关键词为空时，标题行（含排序下拉）整行隐藏；用户搜了之后正常出现。
6. **空态保留但语义调整**：`legalSearch.legalList.value.length === 0` 时，文案根据是否输入了 keyword 区分：
   - 有 keyword：「未找到相关法律法规」
   - 无 keyword + 筛选条件命中 0 条：「当前筛选条件下没有法律法规」
   - 无 keyword + 无筛选 + 命中 0 条：极端兜底「暂无法律法规」（生产基本不会出现）

### 7.3 `restoreFromUrl` 调整

去掉 `hasSearchResults.value = true` 这个状态控制，因为列表已经始终渲染。原 `hasSearchResults` 这个 ref 可整体删除。

## 八、写入触发点矩阵

| 接口 | 是否写日志 | scope | resultCount | resultIds | 备注 |
|---|---|---|---|---|---|
| GET /api/v1/legal/list（keyword 非空） | ✅ | legal | total | items[0..20].id | 仅 keyword 非空时写 |
| GET /api/v1/legal/list（keyword 空） | ❌ | - | - | - | 默认浏览不计入热搜 |
| POST /api/v1/legal/search-articles | ✅ | article | total | { ids, scores } | 总是写 |
| GET /api/v1/legal/[id] | ❌ | - | - | - | 详情请求不算搜索 |
| GET /api/v1/legal/issuing-authorities | ❌ | - | - | - | 元数据 |
| GET /api/v1/legal/statistics | ❌ | - | - | - | 元数据 |
| GET /api/v1/legal/trending-keywords | ❌ | - | - | - | 自我查询 |

## 九、测试策略

### 单元测试
- `tests/server/legal/trending.service.test.ts`
  - `normalizeKeywordService`：空串/纯空格/纯标点/超长/正常输入 5+ 种 case
  - `recordSearchService`：mock Redis 与 Prisma，验证 NX 命中跳过 + NX 未命中并行写双端
  - `getTrendingKeywordsService`：缓存命中走 cache、未命中走 ZUNIONSTORE，返回结构正确

### 集成测试
- `tests/server/api/legal/trending-keywords.get.test.ts`
  - 未登录 401
  - 登录后正常返回（mock service）
  - scope 非法返回 400
- `tests/server/api/legal/list-record.test.ts`
  - keyword 空 → 不写日志（Prisma count 不变）
  - keyword 非空 → 写一条日志，结构符合预期
  - 同用户 30s 内重复搜同关键词 → 只写一条

### 前端
- `useTrendingKeywords`：接口返回 3 条时正确补齐到 5；返回空时全用兜底；接口失败时也用兜底
- 页面：搜全文 tab 首次进入应渲染列表；keyword 空时不渲染标题行

## 十、风险与回滚

| 风险 | 缓解 |
|---|---|
| Redis 故障 | service 内 try/catch 吞，热搜接口返回 `[]`，前端用兜底词；写入路径失败不影响业务接口 |
| 表无限增长 | 30 秒防刷 + 已建索引；后续如需清理另开任务（保留历史是产品诉求） |
| Postgres jsonb `resultIds` 增大行宽 | 上限 20 个 ID（≈ 500B / 行），有索引也不影响热路径 |
| 默认列表加载慢 | `legal/list` 已在生产用，按 publishDate desc 走索引，性能已知 |

回滚：
1. 关掉 trending-keywords 接口路由（404）+ 前端 composable 内置短路返回兜底词
2. 默认列表回退：恢复 `hasSearchResults` 守卫即可
3. DB 表保留即可，不需要回滚迁移

## 十一、实施顺序（高层）

1. 后端：prisma 迁移、trending.service、改造两个搜索接口、新增 trending-keywords 接口、单元 + 集成测试
2. 前端：useTrendingKeywords composable、改造 dashboard/legal/index.vue
3. 浏览器端 E2E 自检：默认列表加载、热词渲染、tab 切换刷新

详细实施步骤待 writing-plans 拆分。
