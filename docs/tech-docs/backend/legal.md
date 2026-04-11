# 法律法规模块

法律法规模块提供法律法规主表管理、条文解析拆分、层级排序、向量嵌入和语义搜索的完整数据管线。

## 模块架构

```
server/services/legal/
├── legalMain.dao.ts          # 法律主表 DAO
├── legalMain.service.ts      # 法律主表 Service
├── legalArticles.dao.ts      # 条文列表 DAO（分页/排序/层级筛选）
├── legalArticles.service.ts  # 条文列表 Service + 排序树
├── article.dao.ts            # 条文批量 DAO（解析后批量写入）
├── article.service.ts        # 条文批量 Service（事务保存）
├── articleSorting.service.ts  # 条文层级排序算法
├── parser.service.ts         # 法律文档解析器（Markdown / 司法解释）
├── lawEmbedding.service.ts   # 条文向量嵌入 Service
├── lawEmbeddings.dao.ts      # 嵌入记录 DAO（原生 SQL 操作 law_embeddings 表）
├── vectorStore.service.ts    # PGVectorStore 封装（嵌入模型 + 向量存储）
└── searchLaw.tool.ts         # 法律搜索工具（LangChain Tool + API Service）
```

## 1. 法律主表管理

### legalMain.dao.ts

| 方法 | 说明 |
|------|------|
| `createLegalMainDao` | 创建法律法规 |
| `findLegalMainByIdDao` | 按 ID 查询（软删除过滤） |
| `findLegalMainWithArticlesByIdDao` | 按 ID 查询并 include 条文 |
| `findLegalMainByCodeDao` | 按法律代码查询 |
| `findLegalMainListDao` | 分页列表（keyword/type/status 筛选，状态通过 effectiveDate/invalidDate 计算） |
| `updateLegalMainDao` | 更新（自动刷新 lastEditedAt） |
| `updateLegalMainEmbeddingTimeDao` | 更新 lastEmbeddingAt |
| `deleteLegalMainDao` | 软删除 |
| `findInvalidLegalMainIdsDao` | 查询已失效法律 ID 列表 |

**状态筛选逻辑**（在 DAO 层实现）：
- `valid`：无失效日期或失效日期 >= now，且无生效日期或生效日期 <= now
- `invalid`：失效日期 < now
- `pending`：生效日期 > now

### legalMain.service.ts

| 方法 | 说明 |
|------|------|
| `getLegalMainListService` | 列表查询，返回 `PaginatedResponse<LegalMainListItem>` |
| `getLegalMainDetailService` | 详情查询 |
| `createLegalMainService` | 创建，**检查 code 唯一性** |
| `updateLegalMainService` | 更新，**失效日期变更时级联同步条文和嵌入** |
| `deleteLegalMainService` | 软删除法律 + 级联软删除所有条文 |
| `syncInvalidStatusService` | 同步失效状态到条文（updateLegalArticlesInvalidDateDao）和嵌入元数据（updateEmbeddingsValidStatus） |
| `getLegalStatisticsService` | 统计：总条文数、已嵌入数、按类型分布（原生 SQL 查询 law_embeddings） |

**关键行为**：更新法律的 `invalidDate` 时，自动调用 `syncInvalidStatusService`，批量更新所有条文的 `invalidDate`，并通过原生 SQL 更新 `law_embeddings` 表中对应记录的 `metadata.invalid_date`。

**日期格式化**：所有日期字段在 Service 层格式化为字符串输出：
- 日期字段（publishDate/effectiveDate/invalidDate）：`YYYY-MM-DD`
- 日期时间字段（lastEditedAt/lastEmbeddingAt/createdAt/updatedAt）：`YYYY-MM-DD HH:mm:ss`

**统计信息**（`getLegalStatisticsService`）返回结构：

```typescript
interface LegalStatistics {
    totalArticles: number       // 条文总数
    embeddedArticles: number    // 已向量化条文数（通过原生 SQL 统计 DISTINCT articles_id）
    notEmbeddedArticles: number // 未向量化条文数
    articlesByType: {           // 按类型分布
        l1: number; l2: number; l3: number; l4: number; l5: number
        notice: number; header: number; footer: number; annex: number
    }
    lastEditedAt: string | null
    lastEmbeddingAt: string | null
}
```

## 2. 法律条文管理

### legalArticles.dao.ts

提供条文的标准 CRUD 和按 legalId 的批量操作。

| 方法 | 说明 |
|------|------|
| `createLegalArticleDao` / `createManyLegalArticlesDao` | 单条/批量创建 |
| `findLegalArticlesListDao` | 分页列表，支持 type/keyword/l1~l5 筛选，**查询后调用 `sortArticlesByHierarchy` 重排** |
| `findAllLegalArticlesDao` | 不分页全量查询，同样排序 |
| `findArticlesNeedingEmbeddingDao` | 查询需要重新嵌入的条文（lastEmbeddingAt 为 null 或 < lastEditedAt） |
| `findLegalArticlesForSortTreeDao` | 查询排序树所需字段 |
| `batchUpdateLegalArticlesOrderDao` | 批量更新 order 字段（事务） |
| `updateLegalArticlesInvalidDateDao` | 按 legalId 批量更新失效日期 |
| `deleteLegalArticlesByLegalIdDao` | 按 legalId 批量软删除 |

### legalArticles.service.ts

| 方法 | 说明 |
|------|------|
| `getLegalArticlesListService` | 列表 + 每个条文附带 `hierarchyPath` 和 `isEmbedded` |
| `createLegalArticleService` | 创建条文，默认 `triggerEmbedding=true` 自动嵌入 |
| `updateLegalArticleService` | 更新条文，**仅 content 变更时**触发重新嵌入 |
| `deleteLegalArticleService` | 删除嵌入 + 软删除条文 |
| `triggerArticleEmbeddingService` | 手动触发嵌入 |
| `getSortTreeService` | 获取排序树（自动检测顶层类型） |
| `batchSortArticlesService` | 批量更新条文排序 |

### article.dao.ts / article.service.ts

用于文档解析后的**批量保存**场景：

- `buildArticlesDataDao`：构建条文插入数据（使用 uuidv7 生成 ID）
- `batchSaveArticlesService`：**事务操作**，依次执行：
  1. 更新法律 content 字段
  2. 软删除所有旧条文
  3. 批量创建新条文

## 3. 条文排序算法

### articleSorting.service.ts

核心函数 `sortArticlesByHierarchy`：**深度优先遍历**的树形排序算法。

**算法步骤**：
1. 收集所有节点路径（`getNodePath`）
2. 计算每个条文的父级路径（`getParentPath`），若父节点不存在则视为顶层
3. 按父级路径分组，组内按 order 排序
4. 从根节点空路径开始深度优先遍历

**层级映射**：
- l1（编）→ l2（分编）→ l3（章）→ l4（节）→ l5（条）
- 支持跳级：l1→l3、l3→l5
- 非层级类型（notice/header/footer/annex）始终作为顶层节点

**复杂度**：时间 O(n log n)，空间 O(n)

## 4. 法律文档解析器

### parser.service.ts

提供两套解析系统：

| 函数 | 适用场景 | 识别方式 |
|------|---------|---------|
| `parseDocument` | Markdown 标题格式（#、##、###） | 正文以 `#` 开头 |
| `parseJudicialDocument` | 司法解释格式（一、二、/ 1. 2.） | 正文不含 `#` |
| `parseContent` | 自动选择解析器 | 自动判断 |

**特殊标记**：
- `>notice<` — 通知标记
- `>header<` — 正文头部标记
- `>footer<` — 正文尾部标记
- `>annex<` — 附件标记

**中文数字转换**：`convertChineseNumberToArabic` 支持将"一"到"亿"的中文数字转为阿拉伯数字。

**系统一解析流程**（`parseDocument`）：

```
1. 移除 frontmatter（---...---）
2. 分离附件部分（>annex< 标记之后的内容）
3. 找到正文起始位置（第一个 # 标题）
4. 处理前言区域：
   - 有 >notice< / >header< 标记 → 分别创建 notice / header 条文
   - 无标记 → 整个前言作为 header
5. 解析主内容（# ~ ##### 标题 → l1 ~ l5 条文）
6. 处理底部内容（>footer< / >annex< 混合区域）
```

**系统二解析流程**（`parseJudicialDocument`）：

```
1. 与系统一相同的 frontmatter 和附件处理
2. 前言处理同上
3. 核心内容识别："一、" 开头的行 → l1，"1．" 开头的行 → l2
4. 底部内容处理同上
```

**条文类型说明**：

| 类型 | 说明 | 来源 |
|------|------|------|
| `notice` | 法律公告/通知 | `>notice<` 标记 |
| `header` | 正文头部（如总则前的说明） | `>header<` 标记或无标题前言 |
| `l1` ~ `l5` | 编/分编/章/节/条 | Markdown 标题层级或中文数字标题 |
| `footer` | 正文尾部（如施行日期说明） | `>footer<` 标记 |
| `annex` | 附件 | `>annex<` 标记 |

## 5. 法律向量嵌入

### lawEmbedding.service.ts

| 方法 | 说明 |
|------|------|
| `buildEmbeddingText` | 构建嵌入文本：`{content}\n\n——《{法律名}》{层级路径}` |
| `buildEmbeddingMetadata` | 构建 snake_case 元数据（兼容旧系统） |
| `embedLawArticle` | 嵌入单个条文：文本分割（2000/200 重叠）→ 添加到向量存储 |
| `embedSingleArticle` | 对外接口：删除旧嵌入 → 创建新嵌入 → 更新 lastEmbeddingAt |
| `updateLegalEmbeddings` | 批量更新法律所有条文嵌入（检查是否需要更新） |
| `deleteEmbeddingsByArticleId` | 按条文 ID 删除嵌入 |
| `updateEmbeddingsValidStatus` | 原生 SQL 更新 metadata.invalid_date |

**嵌入内容优先级**：content > l5 > l4 > l3 > l2 > l1（`getEmbeddableContent`）

**文本分割配置**：chunkSize=2000，chunkOverlap=200（RecursiveCharacterTextSplitter）

**嵌入元数据结构**（`LawEmbeddingMetadata`）：

```typescript
interface LawEmbeddingMetadata {
    articles_id: string         // 条文 ID
    legal_id: string            // 法律 ID
    legal_name: string          // 法律名称
    legal_type: string          // 法律类型（中文：法律/法规/司法解释/指导意见）
    article_type: string        // 条文类型
    chapter_hierarchy: string[] // 章节层级数组
    issuing_authority: string   // 发布机关
    document_number: string     // 文号
    publish_date: string | null // 发布日期（ISO 8601 + 时区）
    effective_date: string | null
    invalid_date: string | null
    last_edited_at: string | null
    last_embedding_at: string   // 嵌入时间
}
```

**嵌入更新判断**（`checkArticleNeedsEmbedding`）：
1. `lastEmbeddingAt` 为 null → 需要嵌入
2. `lastEditedAt > lastEmbeddingAt` → 需要重新嵌入
3. `law_embeddings` 表中无该条文的记录 → 需要嵌入

### lawEmbeddings.dao.ts

直接操作 `law_embeddings` 表的原生 SQL DAO：
- `findEmbeddingsByLegalIdDao` — 分页查询嵌入记录
- `updateEmbeddingMetadataDao` — JSONB 字段级更新
- `countEmbeddingsByLegalIdDao` — 统计嵌入数量

## 6. 向量存储

### vectorStore.service.ts

PGVectorStore 的全局管理层，按 tableName 缓存实例。

**核心特性**：
- **嵌入模型**：优先从数据库获取配置（`getEmbeddingConfigWithFallbackService`），回退到环境变量
- **实例缓存**：按 tableName 缓存 PGVectorStore 实例，避免重复初始化
- **并发安全**：使用 `initializingTables` Set 防止同一表的并发初始化
- **配置热更新**：检测嵌入模型配置变更时自动重新创建实例

| 方法 | 说明 |
|------|------|
| `getVectorStore` | 获取或创建 PGVectorStore 实例 |
| `similaritySearch` / `similaritySearchWithScore` | 向量相似度搜索 |
| `deleteEmbeddingsByMetadata` | 按元数据字段删除嵌入 |
| `resetVectorStore` | 重置实例缓存 |

## 7. 法律搜索工具

### searchLaw.tool.ts

**双模式搜索**：

| 模式 | 触发条件 | 实现 |
|------|---------|------|
| 向量搜索 | 传入 `query` 参数 | 调用 `retrievalRouterService`（统一检索路由） |
| SQL 查询 | 不传 `query` | 原生 SQL 查询 law_embeddings + 元数据筛选 + 分页 |

**对外接口**：
- `searchLawTool` — LangChain Tool，用于 LangGraph workflow 调用
- `searchLawService` — API Service 层接口
- `searchLaw` — 底层搜索函数

**筛选参数**：legalId、legalName、legalType、articleType、isEffective、日期过滤（invalidDate/publishDate/effectiveDate）

**日期处理**：所有日期过滤使用东八区（Asia/Shanghai），通过 dayjs 转换。

## 数据流

```
法律文档 → parser.service 解析
         → article.service 事务保存（legalMain.content + legalArticles 批量创建）
         → lawEmbedding.service 向量嵌入
         → vectorStore.service 写入 PGVectorStore
         → searchLaw.tool 提供搜索
```

## 注意事项

1. **嵌入失败不阻塞**：条文创建/更新时嵌入失败只记录日志，不影响主流程
2. **软删除一致性**：删除法律时级联软删除条文，但嵌入记录是物理删除
3. **元数据命名**：嵌入元数据使用 snake_case（articles_id、legal_id 等），兼容旧系统
4. **法律类型映射**：数据库存 law/regulation/judicial_interp/guideline，嵌入元数据转为中文名称
5. **条文 ID 生成**：批量创建条文时使用 uuidv7（基于时间排序），而非自增 ID
6. **排序树懒加载**：`getSortTreeService` 支持按 parentPath 逐层展开，避免一次加载全部条文
7. **嵌入模型热切换**：向量存储服务检测到配置变更后自动重新创建嵌入模型实例

## 相关文档

- [tech-docs/backend/model.md](./model.md) — 嵌入模型配置获取
- [tech-docs/backend/node.md](./node.md) — 节点与 ChatModelFactory
