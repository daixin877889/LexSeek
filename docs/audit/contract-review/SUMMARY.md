# 合同审查模块审计汇总

**审计日期**：2026-04-24
**审计组**：contract-review-audit 团队（4 个并行审计员）
**权威需求源**（5 份 spec）：
- `2026-04-17-contract-review-design.md`（M1-M5 主 spec）
- `2026-04-21-m6-1-contract-review-overview-and-progress-design.md`（总览 + 流式进度）
- `2026-04-21-contract-review-playbook-design.md`（M7 Playbook）
- `2026-04-22-contract-review-versioning-design.md`（Phase A 版本管理）
- `2026-04-22-contract-review-versioning-phase-b-design.md`（Phase B 客户回传）

**分维度报告**：
- [core-audit.md](./core-audit.md) - auditor-core：13 条
- [docx-audit.md](./docx-audit.md) - auditor-docx：31 条
- [ux-version-audit.md](./ux-version-audit.md) - auditor-ux-version：12 条
- [playbook-admin-audit.md](./playbook-admin-audit.md) - auditor-playbook-admin：5 条

**合计 ~61 条偏差**。

---

## 核心洞察

**高危偏差集中在两个根因**：

1. **迭代中擅自偏离 spec**（违反客户需求 #1 铁律）
   - DOCX-C1 把客户改批注文本实现成了 external reply，但 spec §6.2 明文写"Phase B 统一以系统库为准"，这是 Phase C 特性被擅自前移
   - CORE-C1/C2 把 `GET /reviews/:id/download` 改成每次全量 rebuild，但 spec §8.5 只要求"取签名 URL"
   - 两处都是开发者在修某个具体 bug 时，没回头对 spec，把新逻辑直接塞进旧路径

2. **索引/语义空间错配**
   - DOCX-C4 `newIndependent.paraIdx < newClauses.length`：paragraphIndex 是"非空段落序号"，clauseIndex 是"segmentClauses 切出来的条款序号"，两者**不是同一空间**
   - DOCX-C3 global_review 风险硬写 `anchorParagraphIndex: 0`（和之前 external_new 的同类 bug 复现）
   - CORE-C2 + H3 PATCH 和 download 走了不同底层（legacy risks JSON vs new contract_risks 表）

---

## 综合优先级表

### P0 · 立即修（阻塞 Phase B 正式上线，共 10 条）

| # | 代号 | 一句话 | 文件 | 预估 |
|---|---|---|---|---|
| 1 | **DOCX-C1** | 客户改批注文本升格 external reply，违反 spec §6.2 "以系统库为准" | `uploadClientVersion.service.ts:321-332, 563-581` | 0.5h |
| 2 | **DOCX-C2** | Phase A 存量 snapshot 缺 clauses，历史锚点迁移失效 | `uploadClientVersion.service.ts:164-166` | 1h（backfill migration + fallback）|
| 3 | **DOCX-C3** | global_review 风险 `anchorParagraphIndex: 0` 硬编码 | `uploadClientVersion.service.ts`（global_review 分支）| 0.5h |
| 4 | **DOCX-C4** | `newIndependent` 段落索引/条款索引语义错配 | `uploadClientVersion.service.ts` external_new 创建处 | 0.5h |
| 5 | **CORE-C1** | `GET /reviews/:id/download` 每次全量 rebuild（违反 spec §8.5）+ 并发撞 rebuild-docx 占位锁 + OSS 孤儿 | `api/v1/.../reviews/[id]/download.get.ts` | 1h |
| 6 | **CORE-C2** | `setCompletedAfterRebuildDAO` 无 rebuilding 守卫 | `contractReview.dao.ts` setCompletedAfterRebuildDAO | 0.3h |
| 7 | **CORE-H3**（升 P0） | PATCH 写 legacy `contract_reviews.risks`，GET 已迁移读 ContractRisk 新表 → 已迁移 review 编辑静默丢失 | `api/v1/.../reviews/[id]/index.patch.ts` | 1.5h |
| 8 | **UX-S1** | summarize 异常分支只发 `running` 未发 `done`，进度条永停（需刷新自愈）| `contractReviewMainAgent.ts:462-473, 498-504` | 0.5h |
| 9 | **UX-S2** | `highlights.riskId` 为空或不存在时点击无反应（静默失效）| `summarizeOverview.ts` schema + `OverviewPanel.vue` focusRisk | 0.5h |
| 10 | **UX-S3** | SSE 事件无 `seq` 字段，断线重连 risk 重复 append / stage 回退 | `shared/types/contract.ts` ContractReviewEvent + 发送端 + 消费端 | 1.5h |

**P0 合计预估：~8h（1 个工作日内可完成）**

### P1 · 本周内修（11 条，偏行为/体验类 bug）

| # | 代号 | 摘要 | 估时 |
|---|---|---|---|
| 11 | CORE-H1 | createAgent 缺 responseFormat，主路径绕过 spec §6.3 | 0.5h |
| 12 | CORE-H2 | 用户路由 `/dashboard/contract/:id` 与 spec 约定 `/dashboard/assistant/contract` 不一致 | 0.3h（路由改名 + 重定向）|
| 13 | DOCX-H1 | Step 4 AI/global_review 在事务外，与 Step 5+6 事务失败时部分提交 | 1h |
| 14 | DOCX-H2 | existingRisk 用 `.find` 只更新首条，同条款多风险时漏更新 | 0.5h |
| 15 | DOCX-H3 | **"恢复推送"后端 API + 前端入口完全未实现**（spec §6.3 / §12.6 铁律未闭环）| 2h |
| 16 | DOCX-H4 | fallbackFail（系统 ref 指向已删 annotation）静默丢弃 | 0.3h |
| 17 | DOCX-H5 | NO_ANNOTATION_MATCH 阈值过松（无 wordCommentRef 过滤 + 不卡比例）| 0.5h |
| 18 | DOCX-H6 | upload 链路未注入 segmentClauses 的 LLM fallback | 1h |
| 19 | DOCX-H7 | customXml 路径非标准（Word "删除个人信息"可能清）| 0.5h（改到 `/customXml/`）|
| 20 | DOCX-H8 | 前端 `uploadNewVersion` SSE 无 AbortController，dialog 关闭后流继续 | 0.5h |
| 21 | UX-M1 | `POST /reviews/:id/versions` body=undefined 时 400（无备注快存会踩）| 0.2h |

**P1 合计预估：~7h**

### P2 · 迭代清理（17 条 Medium）

CORE-M1 ~ M4、DOCX-M1 ~ M11、UX-M2 ~ M5、PLAYBOOK-M1 / M2 —— 大多是边界兜底、日志、索引重复定义、约束缺失、seed 数据补齐。可合并成 2-3 个 "cleanup" commit 批量处理。**合计预估：~6h**

### P3 · 记录不修（15+ 条 Low）

重复代码、spec 未定义但无伤大雅的行为、降级文案、未来优化项。留在报告里作为技术债清单。

---

## 建议修复分工（如果要并行）

| 阶段 | 工作包 | 负责人建议 | 阻塞关系 |
|---|---|---|---|
| **S1 (P0 批 1)** | CORE-C1 / C2 / H3（download 路径 + PATCH 数据一致性）| 熟悉 DAO 层 + download 路径的人 | 无 |
| **S1 (P0 批 2)** | DOCX-C1 / C2 / C3 / C4（uploadClientVersion 服务内 4 处 spec 偏离）| 熟悉 Phase B spec + uploadClientVersion 的人 | 无 |
| **S1 (P0 批 3)** | UX-S1 / S2 / S3（SSE + 进度条 + 总评跳转）| 熟悉 workflow event + 前端的人 | 无 |
| **S2 (P1)** | 11 条 High 并发领 | 任意 | 依赖 S1 完成 |
| **S3 (P2/P3)** | 批量 cleanup | 任意 | 依赖 S1/S2 |

三批 P0 之间**完全无交叉文件冲突**，可以三人并行。

---

## 对比执行前约定

用户 #1 铁律："不许修改客户的需求"——这次审计发现 **2 处被违反**（DOCX-C1、CORE-C1/H3 的数据一致性链路偏移）。修复时必须**先看 spec**，不能为了修 A 而擅自改动 B 的约定。

用户 #2 铁律："严禁重复造轮子"——重复代码（CORE-L1 runAnnotateAndUpload vs rebuildDocxService，STANCE_LABELS 两处）虽然是 Low，但属于技术债累积，应当一并清理。

---

## 下一步

等用户确认执行顺序后：
- 方案 A：**三批 P0 并行**（最快出结果，约 3-4h 完成全部 P0）
- 方案 B：**顺序修 P0**（逐条对着 spec 讲，最稳但慢）
- 方案 C：**只修 P0 Top-5**（CORE-C1/C2/H3 + DOCX-C1 + UX-S1），其余留到下个迭代

默认推荐：**方案 A**（P0 并行），然后**顺序处理 P1**，P2/P3 作为后续专项迭代。
