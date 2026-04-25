# Eval 首跑业务问题发现

> 基于 `2026-04-25-1550-context-governance.md` 报告（commit 15b2c139），
> eval 框架成功跑通 11 分钟真 LLM 全链路，抓出以下问题。
>
> **状态更新（2026-04-25 17:00）**：B1/B2/B3 全部修复，6 个 agent 全接入 buildContextSegments。
> 详见 plan `~/.claude/plans/jiggly-dancing-locket.md`。Phase 7 eval 回归数据：
> - Phase 6 commit：移除 moduleContextMiddleware
> - 待 eval 完成更新最终对比（baseline 1606 → 新报告）

## [B1/B2/B3 已修复] 重大业务 bug（M1-M4 改造落地缺口）

### B1. M2 改造未真正接入主链路 [已修复 ✓]

- **现状**：`server/services/workflow/context/moduleContextBuilder.ts` 的
  `buildContextSegments` 写好了 4 段 prompt（roleAndFlow / caseProfile /
  moduleSummaries / dynamicContext），并把 M1 新加的 5 字段（courtName /
  firstInstance{CaseNo,Judge} / secondInstance{CaseNo,Judge}）注入 caseProfile
- **问题**：`caseMainAgent.ts` 实际跑链路用的是 `moduleContextMiddleware`，
  这个 middleware **完全没调用 `buildContextSegments`**，自己拼 `## 案件材料
  上下文` / `## 案件分析上下文` 段
- **后果**：
  - LLM 不知道法官/案号/法院（spec §1.1 期望进 prompt 的字段）
  - prompt 高达 26K-61K tokens（spec §8 要求 < 4K）
  - cache 命中字节稳定性测试 PASS（buildContextSegments 字节稳）但跟实际 prompt
    无关（实际 prompt 由 moduleContextMiddleware 拼）
- **修复方向**：把 caseMainAgent 的 systemPrompt 拼装改用 buildContextSegments
  作为 base，再通过 moduleContextMiddleware 注入"动态增量"内容（材料新增、
  分析模块完成等），保持 spec 设计意图

### B2. M2 材料上下文未压缩

- **现状**：`getMaterialContextService` 把材料内容塞进 system prompt
- **问题**：spec §2 / §0.5 明确要求"材料只塞清单 + 100 字摘要"，全文按需
  调 `search_case_materials` 工具召回。当前实现把材料正文塞进 prompt 导致
  膨胀
- **eval 表征**：`totalPromptTokensAvg = 25382`（CRITICAL 超 6K）；某些
  case prompt 高达 61K
- **修复方向**：`getMaterialContextService` 改输出"materialId + name +
  summary（100 字）"列表

### B3. M3 ARCHIVED 守卫缺失（已知）

- **现状**：`writeMemoryService` / `updateMemoryService` 在 service 层无
  `isCaseReadOnly` 守卫
- **eval 表征**：`sec-archived-write-memory` / `sec-archived-update-memory`
  CRITICAL FAIL
- **修复方向**：两个 service 入口加 `if (isCaseReadOnly(caseRecord.status))
  throw new Error('案件已归档')`，等价 case.service.ts:245 写法

## 🟡 LLM 答案质量问题（指标反映）

### Q1. 幻觉率超阈值

- `hallucinationRate = 10.34%`（CRITICAL ≤ 5%）
- 表征：q-profile-03 编造"甲方：天利达科技集团有限公司"（fixture 无此条目）
- 根因猜测：上下文不完整（B1 / B2 导致 LLM 不知道真实档案，开始编造）
- 解决路径：B1 / B2 修完后预期改善

### Q2. LLM 不调工具直接答

- 16 条 expectedTools 但 toolCalls 全空
- 表征：LLM 看到 fixture 的 summary 直接答"材料未解析"，不调
  `search_case_materials` / `search_case_memory` 全文搜索
- 根因：fixture 的材料 content 字段为空 + LLM 觉得 summary 不够详细就直接
  说"无法获取"
- 解决路径：fixture 加材料真实 chunks（真触发 search 工具命中），或调整
  Agent prompt 鼓励工具优先

## 🟡 eval 框架剩余 bug

### E1. `threadId` 全空

- 现状：sseConsumer 期望从 `event: custom` data.threadId 拿
- 实际：所有 case `threadId: ""`
- 根因待查：可能 SSE 协议里没专门发 threadId，或字段在别处

### E2. `toolCalls` 全空（traceReader）

- 即便 LLM 真调了工具（部分 case 中应当），traceReader 拿不到
- 真实路径已知：`langgraph.checkpoint_blobs` schema，channel='messages'，
  blob 是 LangChain serialized messages，tool_calls 在 `kwargs.tool_calls`
- 修复方向：再核对 traceReader 实现 vs 真实 blob 结构

### E3. `versionChainCorrect = false`

- 根因：extraction Part 2 的 ex-01/ex-02 跑完后 consolidator 未真触发抽取
  （processNowService 调用了但 ZSET drain 后没消息可处理？）
- 修复方向：诊断 ex-02 跑完时 case_memories 表是否真有新增 active 行

### E4. `stab-switch-active-atomic = false`

- 根因待查：fixture seedAnalysisWithVersions 可能没正确设 isActive
  （写了 active=true 又写了 historical isActive=false，但同 type 实际可能
  ≥2 active 行）
- 修复方向：检查 fixture seed 时同 analysisType 是否唯一 active

## 路径建议

1. **优先 B1 + B2**（业务侧改造未落地，影响最大，eval 抓出来的最有价值）
2. **B3 独立 PR**（已知业务 bug 修复）
3. **E1-E4 eval 框架小 bug**（修完报告更准确）
4. **Q1 / Q2 LLM 答案问题** B1+B2 修完后预期自动改善
