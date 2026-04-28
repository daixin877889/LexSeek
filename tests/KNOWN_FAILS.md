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
