# 上下文机制评测基建（Context Governance Eval）设计

- **日期**：2026-04-25
- **评测对象**：`2026-04-23-case-context-governance-design.md` 里的 M1-M4 四子系统改造效果
- **范围**：在 `tests/eval/` 下造一个独立于 vitest 的评测框架，手动触发、真 LLM 全链路跑，采六类指标、出 MD+JSON+HTML 三件套报告
- **术语更正**：原始 spec 用"5 段 prompt"描述，实际代码 `ContextSegments` 为 4 段字段（`roleAndFlow` / `caseProfile` / `moduleSummaries` / `dynamicContext`）。本 spec 全文按 **4 段**描述，与代码一致
- **不涉及**：上线前的一次性迁移验证（status 2/3 → 99 的 SQL）、基建底座的可用性探测（zhparser/chinese ts 配置 / bge-reranker 存活）—— 这些由 M1 plan 的迁移清单和 docker healthcheck 负责

---

## 0. 定位与非目标

### 0.1 一句话定位

建一个**手动触发**的端到端评测框架，对上下文机制改造（M1-M4）的六个维度 —— 成本 / 答案质量 / 任务成功 / 抽取质量 / 安全隔离 / 结构稳定性 —— 出**通过/不通过**结论 + 定量指标报告。不挂 CI、不上定时。

### 0.2 明确**不做**的事

| 不做 | 理由 |
|---|---|
| 代码版本对比（改造前 vs 改造后）| M1-M4 已合入 dev，旧代码跑不起来（M1 加了必填字段）。只设绝对阈值 |
| Feature flag 双跑 | 保留旧 `moduleContextBuilder` 污染代码 |
| 线上真实案件抽样脱敏 | 脱敏 + 标注成本大，首版不做；后续如需扩充金标集可加 |
| eval 主框架跑在 vitest 里 | vitest 要求快+确定性，eval 走真 LLM ≥ 5 分钟、有随机性。但 `metrics/*.ts` 里的纯函数指标（cacheHitRate 算法、facts 匹配等）**可**配独立 vitest 单测，不冲突 |
| CI PR 挂门禁 | 真 LLM 调用有网络抖动，会频繁误挂 PR |
| 定时跑（GitHub Action cron）| 首版 defer，纯手动；JSON 报告 schema 稳定后随时可接 |
| 旧版本 / 线上影子流量对比 | 超出一期范围 |
| 三家 cache 命中率独立基准 | 项目实际三个协议适配器都压在 DeepSeek 后端，阈值只按 DeepSeek 能力定 |

---

## 1. 整体架构 + 执行流水线

### 1.1 执行入口

```bash
DATABASE_URL='postgresql://...ls_eval...' bun run eval:context
```

- `package.json` 新增 `scripts.eval:context`
- 指向独立测试库 `ls_eval`（不复用 `ls_new_testing`，避免跟 vitest 互相污染 cache 字节序）

### 1.2 运行步骤

```
Step 1  seed fixture     → buildFixture.ts 清空 eval 库 + 写入全部 golden data（3 案件 + 提问 + 对话 + 材料 + 记忆 + 分析）
Step 2  cache warmup     → 每个模块各跑 1 次空请求预热 cache（避免第 1 次请求必然 0% 命中污染均值）
Step 3  run Part 1       → 顺序跑 29 条 retrieval/task 提问（并发=1，保证 cache 对齐）
Step 4  run Part 2       → 跑 3 段 extraction transcript + 等 consolidator flush
Step 5  run Part 3       → 跑 security/stability 独立断言（HTTP + 服务层）
Step 6  quality judge    → 对 freeform 类提问跑 DeepSeek-as-judge，每条 3 次取平均
Step 7  aggregate        → 合并所有指标，套分级阈值（CRITICAL/WARN），计算 PASS/FAIL
Step 8  write reports    → 落 MD（节选）+ JSON（完整）到 docs/eval-reports/，HTML viewer 共用
Step 9  exit             → CRITICAL 全过 exit 0；任一 CRITICAL FAIL exit 1；Runner 崩 exit 2
```

### 1.3 关键约束

- **并发度 = 1**：Part 1 串行跑，避免打乱 cache 命中顺序。单轮 eval 总耗时预估 7-10 分钟
- **失败不中断**：单条 case 抛异常 → 标 `errored`，继续；Runner 本身崩溃才退出 2
- **超时保护**：单条 case 60s，extraction transcript 180s，超时标 errored 不判 FAIL
- **LLM 全真调**：被测 + judge 都走真 DeepSeek，不 mock（否则测不到 cache 命中率 / 抽取真实性）。**例外**：§3.6 `sec-ai-autofill-preserve` 是独立于 Part 1 的安全断言 step，为验证合并服务的字段优先级逻辑，允许 mock AI 抽取返回，不违反本条主约束
- **OSS/文件存储**：走 LocalStorage adapter，跳过阿里云 OSS。**注**：项目 `server/lib/storage/adapters/` 当前**只有** aliyun-oss / qiniu / tencent-cos 三家，**需 Phase 1 新建 `local.ts` adapter 或在 eval runner 里直接 mock OSS 客户端**（推荐 mock，侵入更小），见 §5.2
- **Eval 库独立**：`ls_eval`，每次跑前 fixture builder 清表。**首次运行前需手工 `createdb ls_eval` + `DATABASE_URL='...ls_eval...' bun run prisma:push`**
- **确定性 seed**：`mulberry32(42)`，UUID/时间戳可复现（跨运行比较报告时 case id 稳定）。**项目无现成 PRNG**，需在 `tests/eval/utils/prng.ts` 新建 mulberry32 纯函数（或引 `seedrandom` npm 包，但建议纯函数避免新依赖）

### 1.4 单次跑成本估算

- 被测模型（DeepSeek-chat）：29 提问 × 平均 ~2K input + ~500 output tokens = ~73K tokens ≈ $0.01
- Judge（DeepSeek-chat，~5 freeform case × 3 重复 × ~1K tokens）= ~15K tokens ≈ $0.002
- 抽取（consolidator 真 LLM）：3 transcript × ~2K tokens = ~6K tokens ≈ $0.001
- **总计 ~$0.015/run**，可忽略

---

## 2. Fixture 数据模型

### 2.1 三个案件构成

```
案件 A（主案件，民商事合同纠纷，二审阶段）
├── 5 个扩展字段（courtName/firstInstanceCaseNo/secondInstanceCaseNo/firstInstanceJudge/secondInstanceJudge）全填
├── status = SECOND_TRIAL (4)
├── 材料 8 份（合同×2 + 证据×4 + 笔录×2），每份含预生成 summary
├── 案件记忆 15 条（fact×5 + preference×5 + topic×5）
├── 分析产物 3 份 × 每份 2 个版本（active + 历史），共 6 条 caseAnalyses
├── **旧分析产物 1 条**（`summary IS NULL` + 无 case_analysis_embeddings 行，模拟 M4 上线前已有的旧数据）
└── 历史对话 20 轮（分 3 个模块，每模块约 6-7 轮）

案件 B（诱饵，测跨案件隔离）
├── status = CONSULTING (1)
├── 材料 3 份、记忆 3 条（含与 A 容易混淆的 subjectKey）、分析 2 份
└── 同 owner（确保不是被 owner 过滤挡住的假阳性）

案件 C（ARCHIVED，测只读守卫）
├── status = ARCHIVED (999)
├── 材料 1 份 + 记忆 1 条
└── 同 owner
```

### 2.2 Fixture Builder 接口

```ts
// tests/eval/fixtures/buildFixture.ts

export interface FixtureResult {
  caseA: {
    id: string
    ownerId: string
    materialIds: string[]
    memoryIds: string[]
    analysisIds: string[]           // 3 active 版本 id
    analysisHistoricalIds: string[] // 3 历史版本 id
    sessionIds: Record<string, string> // moduleId → sessionId
  }
  caseB: { id: string; materialIds: string[]; memoryIds: string[]; analysisIds: string[] }
  caseC: { id: string; ownerId: string; materialId: string; memoryId: string }
}

export async function buildFixture(opts: {
  database: PrismaClient
  cleanFirst: boolean        // Step 1 前清空相关表（只清 ls_eval 库，不碰生产/testing）
  deterministicSeed: number  // mulberry32 种子，默认 42
}): Promise<FixtureResult>
```

**清表范围**（`cleanFirst=true` 时）：只清 cases / caseMaterials / caseMaterialEmbeddings / case_memories / caseAnalyses / case_analysis_embeddings / chatSessions / agent_runs 这些业务表，不动 users / systemConfigs / 模板表。

### 2.3 Dataset 三部分

#### Part 1 · Retrieval + Task 提问（29 条）

| 组 | 条数 | answerType | 覆盖 M 维度 |
|---|---|---|---|
| ① 档案题（profile） | 5 | facts | M1 五字段 + status 进 A 层 prompt |
| ② 材料题（material） | 4 facts + 1 freeform | 混合 | M2 清单+摘要策略，触发 `search_case_materials` |
| ③ 记忆题（memory） | 5 | facts | M3 `search_case_memory` 召回 |
| ④ 分析产物题（analysis） | 4 facts + 1 freeform（版本切换前后对比）| 混合 | M4 `search_case_analysis` + switchActiveVersion |
| ⑤ 跨层题（cross） | 3 freeform + 2 facts | 混合 | ABCD 四层信息混合提问 |
| ⑥ 工具写入题（tool-write） | 2 | task | Agent 主动调 `write_case_memory` / `update_case_memory` |
| ⑦ 隔离题（security） | 2 | security | 提问含案件 B 的线索，断言返回 0 条 B 数据 |

**每条 case 的 schema**：

```ts
interface EvalCase {
  id: string                            // "q-profile-01"
  group: 'profile' | 'material' | 'memory' | 'analysis' | 'cross' | 'tool-write' | 'security'
  moduleId: string                      // 决定 prompt 走哪个模块 system
  question: string                      // 用户提问
  answerType: 'facts' | 'freeform'
  mustHave: string[]                    // facts 必须命中；freeform 给 judge 参考
  mustNotHave?: string[]                // 命中即幻觉
  expectedTools?: string[]              // 必须调的工具名
  forbiddenCaseIds?: string[]           // security 断言：返回结果不能含这些 caseId
  postRunAssertions?: Array<(ctx: RunContext) => { pass: boolean; message?: string }>
}
```

#### Part 2 · Extraction 对话脚本（3 段）

```ts
interface ExtractionTranscript {
  id: string                             // "ex-01" / "ex-02" / "ex-03"
  caseId: string                         // 指向 fixture.caseA.id
  sessionId: string                      // 独立 session，避免跟 Part 1 混
  turns: { role: 'user' | 'assistant'; content: string }[]
  expectedExtractions: {
    subjectKey: string                   // 期望抽取的记忆 key
    valueKeywords: string[]              // 抽取 text 必须包含的关键词（any-of 判定）
    minConfidence: number
    optional?: boolean                   // optional 不计入 recall 分母
  }[]
  forbiddenExtractions: string[]         // 这些 subjectKey 抽出来就是幻觉
}
```

- **ex-01**：基础抽取。5 轮对话，用户陈述 5 条事实 / 偏好 → 期望抽 5 条
- **ex-02**：跑在 ex-01 之后，同 subjectKey 的**更新事实**（"甲方更正为李四公司"）→ 期望旧记忆 invalidate + 新记忆 active
- **ex-03**：幻觉陷阱。包含假设语气（"如果对方提出赔偿..."）→ 期望不抽取

#### Part 3 · Security + Stability 断言

独立于 Part 1/2，不依赖 LLM 回答，直接调服务层 + 工具 handler + HTTP。

```ts
interface SecurityAssertion {
  id: string
  category: 'cross-case-leak' | 'archived-guard' | 'ai-autofill' | 'prompt-hash' | 'switch-atomic'
  run: (fx: FixtureResult) => Promise<{ pass: boolean; detail: string }>
  severity: 'CRITICAL' | 'WARN'
}
```

详细断言清单见 §3.5 + §3.6。

### 2.4 目录结构

```
tests/eval/
├── fixtures/
│   ├── buildFixture.ts           # TS builder（3 案件）
│   ├── testDataset.ts            # Part 1 的 29 条
│   ├── extractionDataset.ts      # Part 2 的 3 段 transcript
│   └── securityDataset.ts        # Part 3 的独立断言配置
├── metrics/
│   ├── costMetrics.ts            # token / cache / latency 采集
│   ├── qualityMetrics.ts         # facts 匹配 + LLM-judge
│   ├── taskMetrics.ts            # 工具调用 trace 解析
│   ├── extractionMetrics.ts      # recall / precision / 版本链
│   ├── securityMetrics.ts        # 跨案件隔离 / ARCHIVED 守卫
│   ├── stabilityMetrics.ts       # prompt hash / switchActive 原子
│   └── judgePrompt.ts            # DeepSeek judge prompt 模板
├── report/
│   ├── markdownReporter.ts       # 节选 MD
│   ├── jsonReporter.ts           # 完整 JSON
│   └── reportTypes.ts            # shared schema
├── runEval.ts                    # 入口
└── README.md                     # 使用说明

docs/eval-reports/
├── viewer.html                   # 静态可视化页面（永久）
├── index.json                    # 自动生成的报告索引
├── 2026-04-25-1430-context-governance.md
└── 2026-04-25-1430-context-governance.json
```

---

## 3. 指标算法 + 分级阈值

### 3.1 指标分类总表

| 类别 | 指标数 | CRITICAL 数 | WARN 数 |
|---|---|---|---|
| 1. 成本（Cost） | 7 | 1（cacheHitRate） | 6 |
| 2. 答案质量（Quality） | 3 | 1（hallucinationRate） | 2 |
| 3. 任务成功（Task） | 2 | 2 | 0 |
| 4. 抽取质量（Extraction） | 4 | 2 | 2 |
| 5. 安全/隔离（Security） | 5 | 5 | 0 |
| 6. 稳定性（Stability） | 4 | 3 | 1 |
| **合计** | **25** | **14** | **11** |

### 3.2 成本（Cost）

**采集方式**：**新建** `server/services/workflow/callbacks/LLMUsageCallbackHandler.ts`（项目当前无现成 LLM usage 统一 callback）。在 eval runner 里把 handler 注册到 chat model 的 callbacks 数组，handler 在 `handleLLMEnd(output)` 中从 **`output.generations[0][0].message.response_metadata.usage`** 读**供应商原始 usage**（含 DeepSeek 的 `prompt_cache_hit_tokens`）。**不要**走 LangChain 标准化的 `usage_metadata.input_token_details.cache_read` —— 那里只有 Anthropic/OpenAI 的 cache_read，**没有** DeepSeek 的 `prompt_cache_hit_tokens` 字段。

| 指标 | 算法 | 阈值 | 分级 |
|---|---|---|---|
| `systemPromptTokensAvg` | 取 `ContextSegments` 4 段（roleAndFlow + caseProfile + moduleSummaries + dynamicContext）拼串 → 用 `server/utils/tokenCounter.ts` 的 `countTokensSync`（js-tiktoken `cl100k_base`，不走 LLM API）| < 4,000 | WARN |
| `totalPromptTokensAvg` | LLM response `usage.prompt_tokens`（DeepSeek）/ `usage.input_tokens`（Anthropic）均值 | < 6,000 | WARN |
| `cacheHitRate` | DeepSeek 协议：`Σ usage.prompt_cache_hit_tokens / Σ usage.prompt_tokens`（跨整个 run 聚合）| **≥ 60%** | **CRITICAL** |
| `anthropicCacheStructureOk` | Anthropic 协议端点：第 2 次请求 `usage.cache_read_input_tokens > 0` 布尔 | true | WARN |
| `openaiCacheStructureOk` | OpenAI 协议端点：第 2 次请求 `usage.prompt_tokens_details.cached_tokens > 0` 布尔 | true | WARN |
| `memoryRecallLatencyP95` | 每次 `recallMemoryService` 记时间，p95 | < 500ms | WARN |
| `analysisSummaryLatencyP95` | 同上，针对 `generateSummaryService` | < 3000ms | WARN |

**cacheHitRate 60% CRITICAL 的推导**：4 段结构下，同模块多轮对话理论命中率 `3000 cached / 4500 total ≈ 67%`；减 7% 网络/抖动 margin = 60%。低于 60% 基本表示 prompt 结构字节不稳（典型根因：某字段序列化带了时间戳/随机值），回归意义重大。

**为什么不区分三家 cache 命中率**：项目 `chatModelFactory` 允许 baseUrl 可配（所有协议适配器都压到同一后端，通常 DeepSeek），独立三家无物理意义。保留三家**结构正确性**（布尔）WARN 断言，仅验证 `cache_read_input_tokens` / `cached_tokens` / `prompt_cache_hit_tokens` 三种协议字段都能正确回传。

**样本量要求**：Anthropic/OpenAI 协议每个只跑 2 次同模块同提问（验证 2nd hit），DeepSeek 原生协议跑全部 29 case。

**tiktoken 精度说明**：js-tiktoken 的 `cl100k_base` 是 OpenAI 编码，DeepSeek/Anthropic 用的是各自私有 tokenizer，对中文 DeepSeek 真实 tokens 约为 tiktoken 估算的 70-80%（tiktoken 会偏高 20-40%）。`systemPromptTokensAvg < 4000` 是**保守上界**估算 —— 当它达标时 DeepSeek 真实 tokens 必然也达标；当它未达标时需对照 LLM response 的真实 `usage.prompt_tokens` 再判（Cross-check 逻辑在 aggregator 里实现）。

**协议字段参考来源**：
- DeepSeek：`usage.prompt_cache_hit_tokens` + `prompt_cache_miss_tokens`；命中率语义 `hit / (hit+miss) = hit / prompt_tokens`（数学等价）；自动缓存，最小 prefix 64 tokens；无固定 TTL（best-effort LRU）
- Anthropic：`usage.cache_read_input_tokens` + `cache_creation_input_tokens`（创建不算命中）；5m 默认 `{type:'ephemeral'}`，1h 需显式 `{type:'ephemeral', ttl:'1h'}`；cache_control 必须放 `messages` 里的 content block（放 system string 无效）
- OpenAI：`usage.prompt_tokens_details.cached_tokens`；自动缓存，最小 prefix 1024 tokens

### 3.3 答案质量（Quality）

**路径 A · `answerType = 'facts'`（纯字符串匹配，零 LLM 调用）**

```
对每条 mustHave 关键词：
  answerNormalized = answer.replace(/\s+/g,'').toLowerCase()  // 去空格、大小写、全半角统一
  if keywordNormalized in answerNormalized:
    hits++
  else:
    misses++

factsHitRate = hits / mustHave.length

对每条 mustNotHave 关键词：
  if keywordNormalized in answerNormalized:
    hallucinations++

score = factsHitRate * 5  // 0-5 分制
```

**路径 B · `answerType = 'freeform'`（DeepSeek judge 打分）**

Judge prompt 模板见 `metrics/judgePrompt.ts`。判分 4 个维度：事实覆盖、引用正确、无幻觉、切题。输出 JSON `{score_facts, score_citation, score_no_hallucination, score_relevance, overall, reasoning}`。

- `temperature=0`
- **每条重复 3 次取算术平均**（抑制尾部随机性）
- 3 次 `overall` 标准差 > 1.0 → 报告标 `judgeUnstable: true`，需人工复查

**匿名化**：judge prompt 不告诉 judge 谁是 AI 的答案谁是 golden reference，只给 `question + mustHave（参考事实清单）+ answer（被评答案）`。

**聚合指标**：

| 指标 | 算法 | 阈值 | 分级 |
|---|---|---|---|
| `qualityScore` | 所有 case 的 score 算术平均（facts 类 `factsHitRate×5`，freeform 用 judge `overall`）| ≥ 4.0 | WARN |
| `factsHitRate` | 所有 facts 类 case 的总命中率 | ≥ 80% | WARN |
| `hallucinationRate` | `(mustNotHave 命中总数 + freeform 中 score_no_hallucination ≤ 2 的 case 数) / 总 case 数` | **≤ 5%** | **CRITICAL** |

### 3.4 任务成功（Task）

```ts
// 从 agent_runs 表读 thread 的 tool_calls 轨迹
const trace = await getToolCallTrace(threadId)

for each EvalCase where expectedTools is defined:
  if trace.includes(each expectedTool):
    toolCallHits++
  else:
    toolCallMisses++

for each EvalCase where postRunAssertions is defined:
  if all postRunAssertions() pass:
    scenarioPasses++
```

| 指标 | 算法 | 阈值 | 分级 |
|---|---|---|---|
| `toolCallAccuracy` | `toolCallHits / cases_with_expectedTools` | **≥ 80%** | **CRITICAL** |
| `scenarioPassRate` | `scenarioPasses / cases_with_postRunAssertions` | **≥ 90%** | **CRITICAL** |

### 3.5 抽取质量（Extraction）

**consolidator flush 方式**：在 `server/services/memory/consolidator.service.ts`（已验证存在，含 `scheduleConsolidation` + `drainDueSessions`）**新增 public `processNowService(caseId: string)`** 方法，先 drain 该 caseId 的 ZSET 队列再同步执行抽取，跳过 30s debounce。生产端预留给管理后台"立刻整理"按钮使用，eval 里同步调用。

**对齐算法**：

```ts
for each expected in transcript.expectedExtractions:
  const match = extracted.find(e =>
    e.subjectKey === expected.subjectKey &&
    expected.valueKeywords.every(kw => e.text.includes(kw))  // 一期用关键词子串匹配
  )
  if match && match.confidence >= expected.minConfidence:
    recallHits++
  else if expected.optional:
    // skip
  else:
    recallMisses++

for each e in extracted:
  if e.subjectKey in transcript.forbiddenExtractions:
    precisionMisses++

extractionRecall = recallHits / (recallHits + recallMisses)
extractionPrecision = 1 - precisionMisses / extracted.length
```

**版本链断言**（跑完 ex-02 后）：

- 查 `case_memories` 里同 `subjectKey` 的所有行
- 断言：active（`invalidatedAt IS NULL`）只有 1 条，其他都已 invalidate
- 调 `search_case_memory({ include_history: false })`：只返回 active 那条
- 调 `search_case_memory({ include_history: true })`：同 subjectKey 的所有条目都返回

| 指标 | 算法 | 阈值 | 分级 |
|---|---|---|---|
| `extractionRecall` | 上 | ≥ 70% | WARN |
| `extractionPrecision` | 上 | **≥ 95%** | **CRITICAL** |
| `versionChainCorrect` | 上 3 个子断言全过 | true | **CRITICAL** |
| `confidenceFilterCorrect` | `< minConfidence` 的条目未入库的比例 | = 100% | WARN |

**Precision 为 CRITICAL 而 Recall 为 WARN 的理由**：抽错（往记忆库写幻觉）会污染后续所有召回，单向恶化；抽漏下次对话还能补。

### 3.6 安全 / 隔离（Security）

独立阶段（Step 5），不依赖 LLM 生成，直接调服务 + HTTP。**项目接口 HTTP 状态码恒为 200，错误码走 JSON `{ code, message }` 的 code 字段**（见 `.claude/rules/architecture.md`），下述所有 HTTP 断言的"不允许"都指"JSON code 字段非 200"。

**`sec-ai-autofill-preserve` 注**：此断言是独立于 Part 1 的安全 step，为验证合并服务的字段优先级逻辑，**允许 mock AI 抽取返回**，不违反 §1.3 "LLM 全真调" 的 Part 1 约束。

| 断言 ID | 触发方式 | 断言内容 | 分级 |
|---|---|---|---|
| `sec-cross-case-leak` | 跑 ⑦ 组 2 题，解析返回 JSON | 所有 caseId 均等于主案件 A 的 id，无 B 的数据 | **CRITICAL** |
| `sec-archived-updateCase` | 直接调 `updateCaseService(caseC.id, { title: '...' })` | 抛 `案件已归档` 异常 | **CRITICAL** |
| `sec-archived-write-memory` | 直接调 `writeMemoryService` 工具 handler，传 caseC 的 ctx | 返回拒绝消息（**首跑预期 FAIL：业务 bug，service 层缺 isCaseReadOnly**） | **CRITICAL** |
| `sec-archived-update-memory` | 直接调 `updateMemoryService` 工具 handler，传 caseC 的 ctx | 返回拒绝消息（**首跑预期 FAIL：同上业务 bug**） | **CRITICAL** |
| `sec-ai-autofill-preserve` | 预置案件 `firstInstanceJudge='张三'`，**mock AI 抽取**返回 `firstInstanceJudge='李四'`，调合并服务 | 最终字段值仍为 `'张三'`（用户输入优先） | **CRITICAL** |

### 3.7 稳定性（Stability）

| 断言 ID | 触发方式 | 断言内容 | 分级 |
|---|---|---|---|
| `stab-prompt-hash` | 同案件同模块两次连发，取 `moduleContextBuilder` 返回的前 4 段 | `sha256` 两次相等 | **CRITICAL** |
| `stab-switch-active-atomic` | Part 1 ④ 组第 5 题后手动触发 `switchActiveVersionService` | `caseAnalyses.isActive=true` 行数=1；同 caseAnalysisId 的 `case_analysis_embeddings.metadata.isActive=true` 行数全部同步 | **CRITICAL** |
| `stab-old-data-graceful` | 用 fixture 中那条 `summary IS NULL` 的旧分析触发：① `search_case_analysis` 直接查；② moduleContextBuilder 渲染含此旧分析的 caseId | ① 不抛异常（召回不到也算合规）；② moduleSummaries 段不出现 `null` / `undefined` 字面量 | **CRITICAL** |
| `stab-profile-key-order` | 拿 `buildCaseProfileJson` 输出 | `JSON.stringify` 后 key 顺序等于按字典序排后的顺序 | WARN |

---

## 4. Runner + Reporter + 门禁

### 4.1 Runner 伪代码

```ts
// tests/eval/runEval.ts
export async function runEval() {
  try {
    const fx = await buildFixture({ database: prisma, cleanFirst: true, deterministicSeed: 42 })

    await warmupCache({ caseId: fx.caseA.id, moduleIds: fx.caseA.sessionIds })

    const part1 = await runRetrievalTaskDataset(fx, testDataset)          // 29 case
    const part2 = await runExtractionDataset(fx, extractionDataset)       // 3 transcripts
    const part3 = await runSecurityStabilityChecks(fx, securityDataset)   // 独立断言
    const judge = await runQualityJudge(
      part1.filter(r => r.case.answerType === 'freeform'),
      { repeat: 3, temperature: 0 }
    )

    const report = aggregate([part1, part2, part3, judge])

    await writeMarkdownReport(report, { excerptAnswers: true })
    await writeJsonReport(report, { fullAnswers: true })
    await updateReportIndex()  // docs/eval-reports/index.json

    logger.info(`Done. Critical failures: ${report.criticalFailures.length}`)
    process.exit(report.criticalFailures.length > 0 ? 1 : 0)
  } catch (err) {
    logger.error('[eval] runner crashed before producing a report', err)
    process.exit(2)  // Runner 本身崩溃
  }
}
```

### 4.2 Markdown 报告（节选版，~15KB）

**报告文本不使用 emoji**（`CLAUDE.md §3` 铁律："纯文案里也不使用 emoji"），改用纯文字标签 `[PASS]` / `[FAIL]` / `[WARN]`。

```markdown
# 上下文机制评测报告
- 跑批时间：2026-04-25 14:30:12 +08:00
- Commit：93771108
- 总耗时：7 分 42 秒
- **结论：[FAIL]（2 项 CRITICAL 未达标）**

## 分级摘要
| 级别 | 总数 | 通过 | 未通过 |
|---|---|---|---|
| CRITICAL | 15 | 13 | 2 [FAIL] |
| WARN | 11 | 10 | 1 [WARN] |

## CRITICAL 未通过项
1. **sec-cross-case-leak**：q-sec-02 返回了案件 B 的 2 条记忆
2. **stab-prompt-hash**：module-1 两次 hash 不等（疑似 caseProfile.updatedAt 未脱敏）

## 各类指标摘要
### 1. 成本（Cost）
| 指标 | 实测 | 阈值 | 状态 |
|---|---|---|---|
| cacheHitRate | 42% | ≥ 60% | [FAIL] CRITICAL |
| ... | | | |

（其他类别同样表格化）

## 逐 case 摘要表（节选 AI 回答前 200 字）
| ID | 组 | 提问 | 回答节选 | facts | 工具 | 耗时 | 结果 |
|---|---|---|---|---|---|---|---|
| q-profile-01 | profile | 本案一审法官是谁？ | "本案一审法官为张三..." | 2/2 | - | 1.4s | [PASS] |

> 完整回答、judge reasoning、trace 链接请打开 `viewer.html` 加载本 JSON 查看。
```

### 4.3 JSON 报告（完整版，~80KB）

```json
{
  "version": "1.0",
  "runAt": "2026-04-25T14:30:12+08:00",
  "commit": "93771108",
  "durationMs": 462000,
  "summary": {
    "totalCritical": 15,
    "passedCritical": 13,
    "totalWarn": 11,
    "passedWarn": 10,
    "criticalFailures": ["sec-cross-case-leak", "stab-prompt-hash"],
    "overallPass": false
  },
  "metrics": { /* 6 类所有指标 */ },
  "cases": [
    {
      "id": "q-profile-01",
      "group": "profile",
      "question": "...",
      "answer": "...",                 // 完整
      "factsHitRate": 1.0,
      "mustHaveHits": ["张三", "广州..."],
      "toolCalls": [],
      "tokens": { "input": 3214, "output": 187, "cached": 2800 },
      "latencyMs": 1432,
      "threadId": "uuid",
      "judgeResult": null,             // freeform 才有
      "result": "pass"
    }
  ],
  "extractions": [/* Part 2 结果 */],
  "securityAssertions": [/* Part 3 结果 */],
  "errored": [/* 跑挂的 case */]
}
```

### 4.4 HTML Viewer（`docs/eval-reports/viewer.html`）

**定位**：永久存在的单文件静态页面，双击打开即用（file:// 或 `python3 -m http.server`）。

**技术栈**：vanilla JS + Tailwind CDN + fetch API，**零构建步骤**。

**能力**：

1. **Report 选择器**：顶部下拉框列出 `index.json` 里记录的所有历史报告，选中后 `fetch(./YYYY-MM-DD-xxxx.json)` 渲染
2. **Overview 面板**：PASS/FAIL 大徽章 + 6 类指标卡片 + CRITICAL 失败项红色醒目
3. **逐 case 表格**：
   - 列：id / group / question / result / factsHitRate / latencyMs
   - 可按 group 过滤、按各列排序
   - 点击行展开：完整问题 + 完整 AI 回答 + judge reasoning + 工具调用轨迹 + 原始 trace 链接（`/admin/analysis/trace/{threadId}`）
4. **Part 2 / Part 3 面板**：各列断言结果，失败项展开看 detail
5. **趋势图占位**（一期不实现）：JSON schema 稳定后，未来在多份报告时间轴上画指标折线

**不做**：SPA 框架、复杂动画、服务端渲染、用户登录。

**`index.json` 维护**：每次 `runEval` 跑完后追加一行 `{ date, filename, summary }`，viewer.html 从 `./index.json` 读列表。

### 4.5 报告 3 件套职责分离总表

| 产物 | 给谁看 | 体积/份 | 入 git |
|---|---|---|---|
| `*.md` | 人 + PR review + git diff | ~15KB | [OK] 节选 |
| `*.json` | 机器 + HTML viewer | ~80KB | [OK] 完整 |
| `viewer.html` | 人（交互查看）| ~20KB | [OK]（只有一份，永久）|
| `index.json` | viewer 的报告索引 | ~2KB | [OK] |

一年按每周跑 1 次估算，git 增量约 5MB，可接受。

### 4.6 Exit code 定义

| Exit | 条件 |
|---|---|
| 0 | 所有 CRITICAL 通过（WARN 可失败） |
| 1 | 任一 CRITICAL 未通过 |
| 2 | Runner 本身崩溃（fixture seed 失败、DB 连不上等）|

---

## 5. 新建基建清单（项目现状已验证，需 Phase 1 补齐）

### 5.1 `processNowService` 接口

**位置**：`server/services/memory/consolidator.service.ts`（已验证存在，含 `scheduleConsolidation` + `drainDueSessions`）

```ts
/**
 * 立即处理指定案件的对话抽取，跳过 debounce 窗口。
 *
 * 用途：
 * - eval 跑 extraction dataset 时同步等待结果
 * - 管理后台的"立刻整理记忆"按钮（未来）
 *
 * 与 debounced 入队是互斥的：processNowService 会先 drain 该 caseId 的 ZSET 队列再执行。
 */
export async function processNowService(caseId: string): Promise<ConsolidatorResult>
```

**与正常路径的区别**：
- 正常：`enqueue(caseId) → 30s debounce → CronScheduler tick → process`
- processNowService：`drain ZSET(caseId) → process（同步 await）→ 返回结果`

**生产端可见性**：作为公共 service 暴露，eval 路径不是唯一调用方；管理后台未来加"立刻整理"按钮可复用。

### 5.2 `LLMUsageCallbackHandler` 新建

**位置**：`server/services/workflow/callbacks/LLMUsageCallbackHandler.ts`（新目录 + 新文件）

**能力**：实现 `BaseCallbackHandler` 的 `handleLLMEnd(output, runId)`，从 `output.generations[0][0].message.response_metadata.usage` 读原始 usage（含 DeepSeek `prompt_cache_hit_tokens` / Anthropic `cache_read_input_tokens` / OpenAI `cached_tokens`）。附带 `isWarmup?` flag 让 eval 的 warmup 阶段请求不计入统计。

**生产端使用**：作为可选 observability middleware，生产也可挂上用于线上 cache 命中率监控（非必须）。

### 5.3 `local.ts` 存储 adapter 或 mock OSS

**问题**：`server/lib/storage/adapters/` 只有 aliyun-oss / qiniu / tencent-cos 三家，无 local。eval 不能真的上传到阿里云 OSS。

**推荐方案（侵入最小）**：eval runner 启动时 `vi.mock` 掉存储 adapter 模块（或用依赖注入替换），返回固定伪文件 URL，不真的走网络。

**备选方案**：新建 `server/lib/storage/adapters/local.ts`，走 `fs.writeFile` + `file://` URL。如果生产有本地部署需求可复用；纯为 eval 建就略重。

**决策**：一期走 mock；如需 local adapter 后续再提需求。

### 5.4 `getToolCallTrace` 读取函数

**位置**：`tests/eval/utils/traceReader.ts`（eval 专用，不污染业务代码）

**能力**：从 `agent_runs` 表的 LangGraph checkpoint JSON 解析 `tool_calls` 列表，返回 `{ name, arguments, result }[]`。

### 5.5 `mulberry32` PRNG

**位置**：`tests/eval/utils/prng.ts`（纯函数，约 10 行）

**能力**：确定性 PRNG，`mulberry32(seed)` 返回 `() => number` 在 [0, 1)。用于 fixture id / 时间戳生成。

### 5.6 术语修正

原 spec `2026-04-23-case-context-governance-design.md` 把 prompt 结构描述为"5 段"。实际代码 `server/services/workflow/context/moduleContextBuilder.ts` 的 `ContextSegments` 接口是 **4 段**：`roleAndFlow` / `caseProfile` / `moduleSummaries` / `dynamicContext`。本 eval spec 全文按**实际的 4 段**描述，不跟随原 spec 术语错误。

---

## 6. 实施阶段（估算 ~5-7 天）

```
Phase 1 · 骨架 + 新建基建 + Fixture + Cost 指标  ~2.5 天
  - tests/eval/ 目录 + package.json script + prng.ts + traceReader.ts
  - 新建 server/services/workflow/callbacks/LLMUsageCallbackHandler.ts
  - 手工 createdb ls_eval + DATABASE_URL=...ls_eval bun run prisma:push
  - 验证 bun runtime 能否解析 ~~/ 别名（如不能，回退到相对路径 import）
  - buildFixture.ts（3 案件完整数据）+ OSS mock
  - runEval 主循环 + LLMUsageCallbackHandler 注册到 chat model
  - Cost 指标采集
  - markdown/json reporter 雏形
  - 目标：能从头跑到尾产出仅含 Cost 的报告

Phase 2 · Dataset 扩展 + Quality + Task         ~1.5 天
  - testDataset.ts 29 条完整写出
  - facts 路径匹配
  - judgePrompt + 3 次重复平均
  - task trace 解析（读 agent_runs）

Phase 3 · Extraction + Security + Stability     ~1.5 天
  - consolidator.processNowService 新接口
  - extractionDataset.ts 3 段 transcript
  - security 6 个断言 + stability 3 个断言
  - 版本链专项（ex-02 后续断言）

Phase 4 · HTML Viewer + 首次全量跑 + 阈值校准   ~1 天
  - viewer.html（含 Tailwind CDN）
  - index.json 自动维护
  - 首次全量跑 2-3 次，校准阈值（WARN 允许轻微调整，CRITICAL 不放松）
  - tests/eval/README.md 使用说明

Phase 5（可选，defer）· GitHub Action 定时      暂不做
```

---

## 7. 风险与回归点

| 风险 | 缓解 |
|---|---|
| 首次跑 CRITICAL 全挂 → 阈值定得激进 vs 改造真有问题区分不清 | Phase 4 留校准时间；首跑报告作为 baseline，阈值按实测分布做温和收紧（但 CRITICAL 项如跨案件隔离不放松） |
| DeepSeek API 临时抖动导致 `cacheHitRate` 误挂 CRITICAL | 允许重跑（`bun run eval:context --retry-critical`）；连续 2 次失败才视为真回归 |
| eval 库 `ls_eval` 与生产误操作 | fixture builder 强制检查 `DATABASE_URL` 包含 `ls_eval` 才允许清表；否则 refuse + log |
| consolidator `processNowService` 暴露给生产端可能被误调用 | 作为公共 service 方法，不加额外守卫（现有 Service 层本来就在 server scope 内不会被随意外部调用）。管理后台若未来接按钮需走 admin 路由 + admin middleware，与 service 实现解耦 |
| viewer.html 在 file:// 下 fetch 本地 JSON 被 CORS 拦 | README 注明用 `python3 -m http.server` 起静态服务；或在 HTML 内用 `<input type=file>` 让用户本地选择 JSON |
| Cache warmup 本身污染命中率统计 | warmup 请求不计入统计（response callback 带 `isWarmup=true` flag 过滤）|
| 评测框架代码没测试、eval 结果本身假阳性 | Phase 4 对 `metrics/*.ts` 的纯函数部分写 vitest 单测（覆盖边界：空数组、并列分、NaN）|

---

## 8. 验收标准

Phase 4 完成后，应满足：

- [ ] `bun run eval:context` 一条命令跑完，无手动干预
- [ ] 首次跑产出 `docs/eval-reports/YYYY-MM-DD-HHmm-context-governance.md/.json`
- [ ] `viewer.html` 双击打开能选择报告、展开 case 看完整内容
- [ ] 至少有 1 次成功跑出 `overallPass=true` 的报告（证明阈值可达）
- [ ] 至少有 1 次故意破坏（手动把 `case_memories.metadata.caseId` 改掉某行）能触发 `sec-cross-case-leak` CRITICAL FAIL
- [ ] `tests/eval/README.md` 说明如何本地跑、如何打开 viewer、阈值含义、常见误挂排查

---

## 9. 铁律清单（编码时逐条核验）

- [ ] `DATABASE_URL` 不含 `ls_eval` 时拒绝清表（防误删生产/testing）
- [ ] fixture builder 用 `mulberry32(42)` 确定性 seed，每次跑 case id 稳定
- [ ] 并发度严格 = 1（Part 1 串行跑，否则 cache 顺序错乱）
- [ ] Cost 采集走新建的 `LLMUsageCallbackHandler`，从 `response_metadata.usage` 读（非 `usage_metadata`），不侵入 `moduleContextBuilder` / `runCaseChat`
- [ ] Judge prompt 匿名化：不告诉 judge 谁是 golden 谁是被评
- [ ] Judge 3 次重复 + 标准差 > 1.0 标 `judgeUnstable`
- [ ] security 断言跑在**独立 step**，与 Part 1/2 结果无耦合
- [ ] `processNowService` 跳过 debounce 但先 drain 队列，不抢跑
- [ ] viewer.html 不引入构建步骤、不使用 ESM import（CDN Tailwind + vanilla 即可）
- [ ] MD 报告节选 AI 回答前 200 字；完整文本只进 JSON
- [ ] 报告文本无 emoji（[PASS]/[FAIL]/[WARN] 纯文字）；viewer 图标走 lucide SVG inline
- [ ] 报告时区固定 `Asia/Shanghai`
- [ ] eval 不跑 mock LLM，全真调（否则 cache 命中率统计失真）；**例外**：`sec-ai-autofill-preserve` 允许 mock AI 抽取，因其是独立安全 step
- [ ] 单条 case 超时 60s / extraction 180s，超时标 errored 不判 FAIL
- [ ] Exit code 严格：0 全 CRITICAL 过 / 1 CRITICAL 挂 / 2 Runner 崩（需 try-catch 映射 exit 2）
- [ ] Security HTTP 断言用 `JSON code 字段 !== 200` 判定（HTTP status 恒 200，项目规范）
- [ ] Security HTTP 路由使用单数 `/api/v1/case/...`（非 `/api/v1/cases/...`）
- [ ] moduleContextBuilder 描述按**4 段**（实际代码），不跟随原 spec 的"5 段"措辞错误
- [ ] `systemPromptTokensAvg` 阈值是 tiktoken 估算的**保守上界**，DeepSeek 真实 tokens 实际会比这个低 20-40%
