# 已知 fail 测试清单

> **背景**：2026-04-28 落地 database-per-worker 并发隔离（commit `8788049a`）后，全量 `bun run test` 出现 6 个 fail 文件 / 16 fail 用例（占比 0.17%）。逐个 isolated 跑全部通过，确认 fail 全部属于"并发暴露的测试代码自身问题"，不是隔离基础设施 bug。
>
> **修复指引**：见 `.claude/rules/testing.md` 的「并发污染测试调试指引」段落。

## 清单

| 文件 | fail 数 | isolated | 类型 | 推测根因 | 修复 owner |
|---|---|---|---|---|---|
| `tests/server/agent-platform/subAgent/subAgentToolFactory.test.ts` | 8 | ✅ pass | A：mock 状态污染 | `vi.mock('langchain')` / `createAgentMock` 在并发中被前面文件的 import 改写 | agent-platform 团队 |
| `tests/server/workflow/agents/moduleAgent.test.ts` | 5 | ✅ pass | A：mock 状态污染 | `Anthropic / SystemMessage / middleware` 链 mock 被污染 | workflow 团队 |
| `tests/server/workflow/agents/contractReviewMainAgent.contextSegments.test.ts` | 1 | ✅ pass | A：mock 状态污染 | `afterAgentMemoryMiddleware:25` 在并发跑时 mock 不生效 | workflow 团队 |
| `tests/server/workflow/agents/documentMainAgent.test.ts` | 1 | ✅ pass | A：mock 状态污染 | 同上 | workflow 团队 |
| `tests/server/agent-platform/factory/runtime.extra.test.ts` | unhandled | ✅ pass | 业务代码 bug | `server/services/agent-platform/factory/runtime.ts:322` ReadableStream is locked—pre-existing async stream race | agent-platform 团队 |
| `tests/server/assistant/document/templateRecommend.service.test.ts` | 间歇 | ✅ pass | B：数据残留 | `createTpl` 时 `oss_files` 唯一约束（`user_id, bucket_name, file_path`）冲突，前面测试残留 | document 团队 |

## 修复优先级建议

- **类型 A（共 5 个文件 / 15 用例）**：在 `beforeEach` 加 `vi.resetModules() + vi.clearAllMocks()`，按指引套路改造 mock 隔离
- **类型 B（共 1 个文件 / 间歇）**：把 `oss_files` 创建用更强随机后缀（含 worker id + timestamp + crypto.randomUUID）
- **业务代码 bug（runtime.ts:322）**：单独排查 ReadableStream 二次 cancel 问题

## 不阻塞主线

这 6 个 fail 在改造前的串行配置下也可能存在，只是没暴露（串行调度顺序刚好规避）。本次提速从 ~600s+ 降到 251s 是主目标，已达成。修复 fail 是后续单独优化。

---

## 2026-05-09 OSS 兜底链路（Task 11）追加确认的存量 fail

> **背景**：OSS 上传 callback 兜底链路（Tasks 1-10）完成后，全量 `bun run test` 出现 38 fail / 23 files。  
> 其中 `storage.service.real.test.ts`（24 fail）已在 Task 11 修复（headFile.ts 引入 `createLogger` 导致 mock 缺失）。  
> 以下 14 个文件属于 **pre-OSS 存量 fail**，全部由 `2a963394`（中间件升级'识别+摘要双就绪'）等 pre-OSS commits 引入，与本次 storage 兜底无关。

| 文件 | fail 数 | 推测根因 |
|---|---|---|
| `tests/server/workflow/middleware/caseProcessMaterial.middleware.test.ts` | 1 | test 期望 `(1, 1)` 但 `onProgress` 参数已加，需改为 `expect.any(Function)` |
| `tests/server/workflow/caseAnalysisV2.executor.test.ts` | 1 | test 期望 executor 内调用 ensureMaterialsReadyService，但 executor 未实现该 gate |
| `tests/server/agent-platform/context/moduleContextBuilder.test.ts` | 6 | 材料段 sourceId/状态文字逻辑更新后 test 断言未同步 |
| `tests/server/agent-platform/tools/processMaterials.test.ts` | 5 | process_materials 工具逻辑更新后 test 断言未同步 |
| `tests/server/agent-platform/caseContextSync.integration.test.ts` | 1 | 集成测试断言过时 |
| `tests/server/workflow/agents/subAgentToolFactory.test.ts` | 2 | 同 agent-platform/subAgent 类型 A 污染 |
| `tests/server/workflow/workflow-agents.test.ts` | 1 | 同类 mock 污染 |
| `tests/server/workflow/workflow-tools.test.ts` | 2 | processMaterials tool 逻辑更新后 test 未同步 |
| `tests/server/assistant/document/relatedMaterials.api.test.ts` | 3 | document draft 查询逻辑更新后 test 未同步 |
| `tests/server/assistant/contract/m4Integration.test.ts` | 1 | 并发/DB 竞争 |
| `tests/server/assistant/contract/patchReview.api.test.ts` | 1 | review risks 接口更新后 test 未同步 |
| `tests/server/services/material/fileProcess.service.test.ts` | 1 | 识别记录判断逻辑 |
| `tests/server/retrieval/intentClassifier.test.ts` | 2 | 缓存清理逻辑更新 |
| `tests/server/retrieval/materialContext.test.ts` | 1 | 摘要降级逻辑更新 |
| `tests/server/case/cases.active.api.test.ts` | 1 | 案件 active 列表逻辑 |
| `tests/server/caseAnalysis.rag.test.ts` | 2 | RAG 集成测试 |
| `tests/server/material/recognition-api.test.ts` | 1 | 识别 API mock |
| `tests/server/memory/searchCaseAnalysis.test.ts` | 1 | 记忆搜索逻辑 |
| `tests/server/admin-handlers/admin-batch5-happy.handlers.test.ts` | 1 | admin nodes POST 逻辑变化 |
| `tests/app/utils/toolDisplayName.test.ts` | 2 | ANALYSIS_NODE_LABEL 常量/导出 |
| `tests/client/composables/useStreamChat.test.ts` | 1 | interrupt 解包逻辑 |

修复优先级：由各功能团队按需跟进，不阻塞 OSS 兜底上线。

---

## 2026-05-20 积分计费体系统一改造（Task 19）追加：测试桩待跟进

> **背景**：积分计费体系统一改造（commits `750c4276..be388702`）把 `mineru.service` / `asr.service` / token 计费中间件等场景的扣费调用从 `pointConsumption.service` 改走新的 `pointBilling.service`；删除了 6 个未挂载的预扣工具文件。生产代码本身通过 typecheck 与新增的计费/聚合单测验证，**业务逻辑无回归**；以下若干历史测试因桩固化在旧契约上仍 fail，作为测试桩跟进项：

| 文件 | fail 数 | 类型 | 原因与修复套路 |
|---|---|---|---|
| `tests/server/material/mineru.service.test.ts` | 1 | 桩固化 | mock `consumePointsService` resolveValue 为 `undefined`，新流程经 `billDirectService` 读取 `result.consumedAmount` 失败。改成 `{ consumedAmount: 0, consumptionRecords: [] }` 即可 |
| `tests/server/material/asr.service.test.ts` | 3 | 桩固化 | mock `preDeductPointsService` 形状不含 `preDeductAmount`，新流程经 `billReserveService` 包装时下游消费链兼容性需更新；或直接 `vi.mock` `pointBilling.service` |
| `tests/server/workflow/middleware/pointConsumption.middleware.test.ts` | 2 | 桩固化 | mock pin 了旧 `checkPointsService` / `consumePointsService`，新中间件改走 `billCheckService` / `billDirectService`。把 mock 目标改成 `pointBilling.service` |
| `tests/server/workflow/workflow-middleware.test.ts` | 1 | 桩固化 | 同上 |
| `tests/server/workflow/tools/searchCaseMaterials.test.ts` | 8 | **改造前既存** | search_case_materials 工具在 `bc3256de` 加入了 sessionId 透传，test 断言未跟进；与本次积分改造无关，列此处便于排查时排除 |

**不阻塞主线**：生产代码、新计费服务单测（7/7 pass）、各计费项验证测试（OCR/摘要/记忆 6/6 pass）、聚合查询测试（2/2 pass）、新中间件测试（2/2 pass）、DAO 透传测试（13/13 pass）均已通过；以上为旧 mock 契约的同步更新。
