# Context Governance Eval

> 评测设计 spec：`docs/superpowers/specs/2026-04-25-context-governance-eval-design.md`
> 评测对象 spec：`docs/superpowers/specs/2026-04-23-case-context-governance-design.md`
> 实施计划：`docs/superpowers/plans/2026-04-25-context-governance-eval-plan-v2.md`

本评测验证案件上下文治理（context governance）的 25 项指标，分 6 类：成本（Cost）、答案质量（Quality）、任务成功（Task）、抽取质量（Extraction）、安全/隔离（Security）、稳定性（Stability）。

## 一次性初始化

`ls_eval` 库与生产库 `ls_new`、测试库 `ls_new_testing` 物理隔离。初始化共 4 步：

```bash
# 1) 创建空库（已存在则忽略）
createdb ls_eval || echo "exists"

# 2) 推 Prisma schema 到 ls_eval
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' \
  bun run prisma:push --accept-data-loss

# 3) 生成 Prisma client（push 一般会自动跑一次，重跑无副作用）
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' \
  bun run prisma:generate

# 4) 灌入项目种子数据（caseTypes / models / nodes 等业务必备数据）
psql 'postgresql://daixin:daixin88@localhost:5432/ls_eval' -f prisma/seeds/seedData.sql
# 或（容器化 PG）
# docker exec postgres-postgres-1 psql -U daixin -d ls_eval -f /path/to/seedData.sql
```

测试用户、3 个评测案件、记忆、旧分析等数据由 `buildFixture` 在每次评测开始时自动 upsert / 重建，**无需手工 seed 用户**。

## 运行

```bash
EVAL_DEEPSEEK_KEY=sk-xxx REDIS_PASSWORD=daixin88 bun run eval:context
```

## 运行时依赖

- PostgreSQL `ls_eval` 库（独立于 `ls_new` / `ls_new_testing`）
- Redis 实例可达；评测使用独立 ioredis 客户端切到 `db=15`，与生产 `db=0` 物理隔离，跑前会 `flushdb`
- 环境变量：
  - `EVAL_DEEPSEEK_KEY` —— DeepSeek API key（必填，缺失直接 fail-fast）
  - `REDIS_PASSWORD` / `REDIS_HOST` / `REDIS_PORT` —— Redis 连接信息（视环境补齐）
  - `DATABASE_URL` —— Runner 自动覆盖为 `ls_eval` 连接串，无需手工设置

## 报告三件套

每次跑完产物落到 `tests/eval/report/output/<timestamp>/`：

| 文件 | 用途 |
|---|---|
| `report.md` | 节选关键指标 + FAIL 列表，适合 `git diff` / PR review 直接贴 |
| `report.json` | 25 项指标完整结构化数据，机器分析 / viewer 加载 |
| `viewer.html` | 交互式查看器，加载同目录 JSON 渲染指标和 trace |

查看 viewer：

```bash
cd tests/eval/report/output/<timestamp>
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/viewer.html
```

## 25 项指标速查（spec §3.1）

| 类别 | 指标 | 阈值 | 分级 |
|---|---|---|---|
| Cost | `systemPromptTokensAvg` | < 4,000 | WARN |
| Cost | `totalPromptTokensAvg` | < 6,000 | WARN |
| Cost | `cacheHitRate` | ≥ 60% | **CRITICAL** |
| Cost | `anthropicCacheStructureOk` | true | WARN |
| Cost | `openaiCacheStructureOk` | true | WARN |
| Cost | `memoryRecallLatencyP95` | < 500ms | WARN |
| Cost | `analysisSummaryLatencyP95` | < 3000ms | WARN |
| Quality | `qualityScore` | ≥ 4.0 | WARN |
| Quality | `factsHitRate` | ≥ 80% | WARN |
| Quality | `hallucinationRate` | ≤ 5% | **CRITICAL** |
| Task | `toolCallAccuracy` | ≥ 80% | **CRITICAL** |
| Task | `scenarioPassRate` | ≥ 90% | **CRITICAL** |
| Extraction | `extractionRecall` | ≥ 70% | WARN |
| Extraction | `extractionPrecision` | ≥ 95% | **CRITICAL** |
| Extraction | `versionChainCorrect` | true | **CRITICAL** |
| Extraction | `confidenceFilterCorrect` | = 100% | WARN |
| Security | `sec-cross-case-leak` | 主案 caseId 一致 | **CRITICAL** |
| Security | `sec-archived-updateCase` | 抛"案件已归档" | **CRITICAL** |
| Security | `sec-archived-write-memory` | 拒绝写入 | **CRITICAL** |
| Security | `sec-archived-update-memory` | 拒绝更新 | **CRITICAL** |
| Security | `sec-ai-autofill-preserve` | 用户输入优先 | **CRITICAL** |
| Stability | `stab-prompt-hash` | 两次 sha256 相等 | **CRITICAL** |
| Stability | `stab-switch-active-atomic` | active 行数同步 | **CRITICAL** |
| Stability | `stab-old-data-graceful` | 旧分析不抛 + 不渲 null | **CRITICAL** |
| Stability | `stab-profile-key-order` | key 字典序稳定 | WARN |

合计：25 项 / CRITICAL 14 / WARN 11。

## 已知业务缺陷预告

首跑必报这 2 项 CRITICAL FAIL（**不是 eval 故障，是 eval 在做它该做的事**）：

- `sec-archived-write-memory`
- `sec-archived-update-memory`

反映 M3 spec §12 ARCHIVED 守卫在 `writeMemoryService` / `updateMemoryService` 未落实 —— 已归档案件本应拒绝写入，但当前 service 入口缺校验。

修复路径：在两个 service 入口加：

```ts
const caseRecord = await prisma.cases.findUnique({ where: { id: caseId } })
if (caseRecord && isCaseReadOnly(caseRecord.status)) {
  throw new Error('案件已归档，不可写入记忆')
}
```

补完守卫后这 2 项 CRITICAL 自动转 PASS。

**eval 的价值正在于此 —— 暴露 spec 与代码的偏差，让回归测试持续守住已修补的口子。**

## 首跑预期 exit code

| Exit | 含义 |
|---|---|
| 0 | 所有 CRITICAL 通过（少见，需先补完上述 2 项守卫且 cache 已暖机） |
| 1 | 有 CRITICAL FAIL（首跑常态：`cacheHitRate` 冷启动 + 上述 2 项业务缺陷） |
| 2 | Runner 本身崩溃（DB 连不上 / `EVAL_DEEPSEEK_KEY` 缺失 / fixture 写入失败等） |

`exit 1` 是首跑预期行为，**不要靠改阈值绕过**；先看 `report.md` 的 FAIL 段落，再决定是修代码还是调 spec。

## 常见误挂排查

| 现象 | 排查方向 |
|---|---|
| `cacheHitRate` 偏低 | 看 `stab-prompt-hash` 结果 —— 通常根因是 4 段 prompt 某段带了时间戳 / 随机字段 / Map 序列化乱序，先把它修稳 |
| `toolCallAccuracy` 偏低 | dataset 里某条提问 LLM 选了不调工具直接答；打开 `report.json` 找该 case 的 trace，对比 `expectedTools` |
| `sec-cross-case-leak` FAIL | 跨案件数据泄漏，检查 `metadataFilter.caseId` 是否在召回 / 检索链路中失效；优先看 `recallMemoryService` 和 `search_case_analysis` 工具 |
| `versionChainCorrect` FAIL | `case_memories` 同 `subjectKey` 出现多条 `invalidatedAt IS NULL`，看 `updateMemoryService` 的 invalidate 逻辑 |
| `stab-switch-active-atomic` FAIL | `caseAnalyses.isActive` 与 `case_analysis_embeddings.metadata.isActive` 未同步，检查 `switchActiveVersionService` 是否在事务里更新 embeddings 元数据 |

## 已知限制

- **tiktoken 精度**：js-tiktoken `cl100k_base` 是 OpenAI 编码，对 DeepSeek 中文 token 数偏高 20-40%。`systemPromptTokensAvg < 4000` 为**保守上界**；达标必稳，不达标需对照 LLM response 的真实 `usage.prompt_tokens`。
- **三家协议 cache 验证**：仅看 `cache_read_input_tokens` / `cached_tokens` / `prompt_cache_hit_tokens` 字段是否回传（布尔，结构正确性），**不**对比三家命中率 —— `chatModelFactory` 允许 baseUrl 可配，三家通常压同一后端，独立测算无物理意义。
- **latency p95**：一期 `memoryRecallLatencyP95` / `analysisSummaryLatencyP95` 作 WARN-only。等 service 加 timer 埋点后再填充实测值，目前为占位。

## 故意破坏验证（巡检手法）

确认 eval 真在守口子，可手工破坏一条数据看 FAIL 是否触发：

```bash
# 在 ls_eval 库手动改一条 case_memories 的 metadata.caseId 到诱饵 caseId
psql 'postgresql://daixin:daixin88@localhost:5432/ls_eval' <<'SQL'
UPDATE case_memories
SET metadata = jsonb_set(metadata, '{caseId}', '99999')
WHERE id = (SELECT id FROM case_memories LIMIT 1);
SQL

# 期望：sec-cross-case-leak 转 FAIL
EVAL_DEEPSEEK_KEY=sk-xxx bun run eval:context

# 恢复：再跑一次评测，fixture 自动 truncate + 重建 case_memories
EVAL_DEEPSEEK_KEY=sk-xxx bun run eval:context
```

## Phase 1-4 实施状态（已完成）

| Phase | Task | Commit |
|---|---|---|
| 1 | T1 骨架 + ls_eval + Redis db=15 隔离 | `70847d7f` |
| 1 | T2 mulberry32 PRNG + UUID v4 | `760679cc` |
| 1 | T3 LLMUsageCallbackHandler | `e560e316` |
| 1 | T4 caseMainAgent 透传 callbacks | `3de04ae1` |
| 1 | T5 traceReader 从 agent_runs 读 tool_calls | `6790145f` |
| 1 | T6 SSE named-event 消费器 | `01bc09fa` |
| 1 | T7 报告三件套（json + markdown） | `283e6abb` |
| 1 | T8 StorageFactory eval-only override + ossMock | `82fbda58` |
| 2 | T9 fixture builder（3 案件 + 旧分析 + 记忆 raw SQL） | `342de50f` |
| 2 | T10 testDataset 29 条提问 | `23db7699` |
| 2 | T11 datasetRunner 真 SSE 消费 + token 采集 | `6ef5474e` |
| 2 | T12 cost 指标聚合 | `9dd42c2d` |
| 3 | T14 quality 指标 + judge runner | `06cf1a25` |
| 3 | T15 task 指标（toolCallAccuracy / scenarioPassRate） | `10129360` |
| 3 | T17 consolidator processNowService | `745723ae` |
| 3 | T18 extraction 指标 | `23720944` |
| 3 | T19 security 5 断言 | `1a4bfcc7` |
| 3 | T20 stability 4 断言 | `953a0948` |
| 4 | T21 runEval 主循环 | `b37c134c` |
| 4 | T23 README 完整版（本文件） | 当前 commit |
