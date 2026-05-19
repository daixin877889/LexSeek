# 积分计费体系统一改造 — 设计文档

> 日期：2026-05-19
> 状态：待评审

## 1. 背景与目标

### 1.1 现状问题

1. **扣费点覆盖不全**：图片 OCR（`ocr_recognize`）后台已配置消耗项目却从未扣减；文件摘要生成、案件记忆提取调用大模型但完全免费，也没有任何后台开关。
2. **"扣不扣"写死在代码里**：当前只有 6 个场景（4 个 token 计费 agent + MinerU + ASR）接入扣减，是否扣、按什么扣都由代码决定，运营无法在后台调整。
3. **消耗记录对用户不友好**：用户在「积分明细」页看到的"使用场景"是配置项的技术描述（含"token""词元"等黑话）；一次操作没有业务上下文（不知道对应哪个案件/文件）；按 token 计费时每轮模型调用扣一次，一次对话被拆成十几条重复记录；看不到计费依据。

### 1.2 目标

1. 所有模型调用、MinerU 调用、ASR 调用都有扣费点（代码 hook 全部就位），扣不扣由后台配置项统一管理。
2. 配置项支持"按 token / 按次量"两种计费模式，可在后台切换。
3. 现有的"直接扣"与"预扣→结算/回滚"两套机制都保留可用。
4. 用户端积分消耗记录友好化：友好场景名、业务上下文、展示层聚合。

### 1.3 不做的事（YAGNI）

- 不向用户暴露 token 用量，也不做 token→积分换算的透明化。**原因**：一旦用户把 token 和积分锚定，会拿 token 对标成本，解释成本极高。
- 不给 agent 内部中间步骤（对话历史压缩、意图识别、错误诊断、模板重排）设独立扣费点——它们发生在某个已计费 agent 运行内部，单独设点会与主操作的 token 账单重复扣费。
- 不引入"操作主记录"表，用展示层聚合替代。

## 2. 范围：九个扣费点

| # | itemKey | 场景 | 默认计费模式 | 默认状态 | 扣减方式 | 接入位置 | 现状 |
|---|---------|------|------------|---------|---------|---------|------|
| 1 | `assistant_token` | AI 法律问答 | 按 token | 启用 | 直接扣 | token 计费中间件 | 已接入，改走统一服务 |
| 2 | `case_analysis_token` | 案件智能分析 | 按 token | 启用 | 直接扣 | token 计费中间件 + `caseAnalysisV2.workflow` 主图 | 已接入，改走统一服务（含初始分析主图直接扣费处，见 §5.6） |
| 3 | `document_draft_token` | AI 文书起草 | 按 token | 启用 | 直接扣 | token 计费中间件 | 已接入，改走统一服务 |
| 4 | `contract_review_token` | 合同智能审查 | 按 token | 启用 | 直接扣 | token 计费中间件 | 已接入，改走统一服务 |
| 5 | `doc_parse` | PDF 文档解析 | 按次量（页） | 启用 | 直接扣 | `mineru.service` | 改造：维持回调里按真实页数扣减，改走统一计费服务（页数须 MinerU 解析后才可知） |
| 6 | `asr_transcribe` | 录音转文字 | 按次量（分钟） | 启用 | 预扣→结算/回滚 | `asr.service` | 已是预扣，改走统一服务 |
| 7 | `ocr_recognize` | 图片文字识别 | 按次量（张） | **停用** | 直接扣 | `ocr.service` | 新接入 |
| 8 | `summary_generate`（新增配置项） | 文件智能摘要 | 按 token | **停用** | 直接扣（best-effort） | `material.service` 的 `callSummaryLlm` | 新增 |
| 9 | `memory_extract`（新增配置项） | 案件记忆整理 | 按 token | **停用** | 直接扣（best-effort） | `memoryExtraction.service` | 新增 |

新增/补齐的 3 个场景（OCR、摘要、记忆）默认状态为**停用**——上线后行为不变（仍免费），运营在后台一键切换为启用即开始扣费，零风险。

> **扣费点 = 代码 hook**：`case_analysis_token` 实际有两处扣费代码——模块对话走 token 计费中间件，初始案件分析（7 模块）走 `caseAnalysisV2.workflow` 主图自己的扣费逻辑（见 §5.6）。两处都必须改走统一计费服务，否则初始分析这条主路径会脱离后台配置管控。

## 3. 数据模型变更

走 1 次 `prisma migrate dev`，新增以下列。

### 3.1 `pointConsumptionItems`（消耗配置项）

| 字段 | 类型 | 说明 |
|------|------|------|
| `billingMode` | 枚举（非空，默认按次量） | `TOKEN`=按 token / `COUNT`=按次量 |
| `displayName` | 字符串（可空） | 用户友好场景名，无技术黑话；为空时回退用 `name` |

`status`（启用/停用）字段不变，但**代码行为变更**见 §6。`name` / `description` 保留为后台管理用途。

> 管理后台已有完整的「消耗项目」管理模块（页面 `app/pages/admin/point-items/`、表单 `app/components/admin/point-items/FormDialog.vue`、API `server/api/v1/admin/point-consumption-items/`）。`billingMode` / `displayName` 两个新字段须沿这套现成 CRUD 透传，使运营可在后台编辑（见 §5.7），无需新建页面。

### 3.2 `pointConsumptionRecords`（消耗记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| `operationId` | 字符串（可空，加索引） | 操作关联标识，聚合展示用。一次用户操作内的所有碎记录共享同一值 |
| `contextLabel` | 字符串（可空） | 业务上下文快照，如「劳动合同纠纷案」「起诉状.pdf」。写入时快照，不依赖关联查询 |
| `usageAmount` | 整数（可空） | 计费用量。仅按次量模式填充（页/分钟/张）；按 token 模式留空 |

计费用量的单位直接取关联配置项的 `unit`，不再单独存列。

### 3.3 数据级变更（走 `seedData.sql`，不走迁移）

- 现有 15 个配置项：回填 `billingMode`（`agentToken` 组 4 个 → `TOKEN`，其余 → `COUNT`）与 `displayName`。
- 新增 2 个配置项：`summary_generate`、`memory_extract`，状态停用。
- 8 个废弃的「案件分析模块」配置项（`title`/`summary`/`chronicle`/`claim`/`cause`/`trend`/`defense`/`evidence`）：`status` 改为停用。

### 3.4 死代码清理

`reserve_points` / `confirm_points` / `rollback_points` 三个工具已注册但未挂载到任何节点，预扣改由统一计费服务驱动后彻底无用。清理对象共 **6 个文件**：

- `agent-platform/tools/` 下 3 个工具实体文件；
- `workflow/tools/` 下 3 个对应的 re-export shim（`export *` 转发，删实体后会悬空，须同删）。

并从 `agent-platform/tools/index.ts` 注销三个工具的注册。已全仓 grep 确认无任何业务代码 import 这些工具，删除安全。

## 4. 统一计费服务

新建 `server/services/point/pointBilling.service.ts`，作为所有场景的统一计费入口。它是对现有三阶段消耗引擎的"配置感知封装"——**底层 `consumePointsService` / `preDeductPointsService` / `settlePointsService` / `rollbackPreDeductService` / `checkPointsService` 不动**。

### 4.1 接口

```
billCheck(userId, itemKey, usage)                  → { skipped, sufficient, required, available }
billDirect(userId, itemKey, usage, context)        → { skipped, consumedAmount, operationId }
billReserve(userId, itemKey, usage, context)       → { skipped, batchId, preDeductAmount }
billSettle(batchId, actualUnits?)                  → { consumedAmount }
billRollback(batchId)                              → { releasedAmount }
```

- `usage`：`{ tokens?: number; units?: number }`
- `context`：`{ contextLabel?: string; sourceId?: number; operationId?: string }`
- `billSettle` 只需 `batchId` 与实际用量 `actualUnits`——预扣记录写入时已快照 `contextLabel`，结算无需再传上下文。

### 4.2 行为

1. 读取配置项（用宽容读取，见 §6），`status=停用` → 直接返回 `{ skipped: true }`，不扣减、不写消耗记录。
2. 按 `billingMode` 算消耗数量：
   - `TOKEN` → `quantity = ceil(usage.tokens / 1000)`；消耗记录的 `usageAmount` 留空。
   - `COUNT` → `quantity = usage.units`；消耗记录写入 `usageAmount = units`。
3. 降级容错：模式为 `TOKEN` 但拿不到 `tokens`（或模式为 `COUNT` 但拿不到 `units`）→ 用另一个量并打告警日志，保证不崩。
4. `operationId`：`context` 未传则生成 uuid；同一次操作的多次 `billDirect` 由调用方持有并复用同一值。预扣场景下 `operationId` 与 `batchId` 取相同值。
5. 委托底层引擎执行扣减，并把 `operationId` / `contextLabel` / `usageAmount` 透传落库。

底层 `consumePointsService` 等需扩展入参以接收并存储这三个新字段。

## 5. 各场景接入

### 5.1 token 计费中间件（场景 1、3、4 与模块对话）

`pointConsumptionMiddleware` 内部 `afterModel` 改为调用 `billDirect`。

- **operationId**：中间件签名新增可选 `operationId` 参数。`beforeAgent` 优先用传入值，未传则自生成 uuid，存入中间件 state（新增 `_billingOperationId`），`afterModel` 每轮复用。
  - AI 法律问答 / 文书起草 / 合同审查：一次用户发问 = 一次 agent 运行 = 一行，中间件自生成 uuid 即可。
  - 案件分析模块对话：moduleAgent 与其专家子代理（`ask_*_expert`）属同一次用户发问，须共享 operationId——由 `subAgentToolFactory` 把上层 `context` 里贯穿该次运行的标识透传给专家子代理的中间件，聚合成一行。
- **contextLabel**：中间件签名新增可选 `contextLabel` 参数，由各 vertical 装配中间件处解析后传入。各来源（调研确认均可在装配作用域内取得）：
  - AI 法律问答（assistantAgent）：仅有 `sessionId` → 会话标题（`caseSessions.title`），可空。
  - 案件分析模块（moduleAgent / subAgentToolFactory）：有 `caseId` → 案件名（`cases.title`），兜底「案件_{id}」。
  - 文书起草（documentMainAgent）：已加载 draft → 文书标题（`draft.title`），兜底 `draft.name`。
  - 合同审查（contractReviewMainAgent）：已加载 review → 原合同文件名（`ossFiles.fileName` by `review.originalFileId`），兜底合同类型。
- 配置项停用时：跳过扣减，且**不** interrupt，agent 正常执行。

### 5.2 PDF 解析（场景 5）

PDF 页数须等 MinerU 解析完成才能拿到，提交时无法预扣，维持回调里直接扣减：

- `completeConversionService` 回调中，解析成功后按真实页数 `billDirect`，改走统一计费服务。
- 解析失败不扣。

> 预扣→结算/回滚机制由录音转文字（ASR）场景代表，依然保留可用。

### 5.3 录音转文字（场景 6）

已是预扣流程，把直接调用底层服务改为走 `billReserve` / `billSettle` / `billRollback`。

### 5.4 图片文字识别（场景 7）

识别成功后 `billDirect`（`units=1`，`contextLabel`=图片文件名）。识别失败不扣。

### 5.5 文件摘要、案件记忆（场景 8–9）

后台静默任务，`billDirect` 以 best-effort 方式调用：积分不足或扣减异常时记日志并跳过，**不抛错、不影响主流程**。

文件摘要的扣费 hook 放在 LLM 收口函数 `callSummaryLlm` 内，**同时覆盖两条路径**：

- `ossFileId` 路径（文档 / 图片 / 音频识别后触发）：归属用户取 `ossFiles.userId`。
- `materialId` 路径：用户粘贴的纯文本材料（`CASE_CONTENT`）`ossFileId` 恒为空、只能走此路径，**是真实计费路径不可跳过**。归属用户经 `caseMaterials` 解析——`caseId` → `cases.userId`（主路径），`draftId` / `sessionId` 兜底；都解析不到则 best-effort 跳过。

### 5.6 初始案件分析（caseAnalysisV2 主图）

初始案件分析（一次"开始分析"批量跑 7 个分析模块）走 `caseAnalysisV2.workflow.ts` 的 stateGraph，**不经 token 计费中间件**——主图自己在每模块完成后直接调 `consumePointsService('case_analysis_token')` 扣费。本次必须把这处一并改走 `billDirect`，否则这条主路径脱离统一计费、不受后台配置管控。

- 主图每模块扣费处（`consumePointsService`）改为 `billDirect`；积分预检处（`checkPointsService`）改为 `billCheck`。
- **operationId 统一**：一次"开始分析"贯穿一个 `runId`（`agentRuns.id`）。7 个模块的 `billDirect` 全部传入同一 `runId` 作 operationId，使整次分析在消耗记录里聚合成**一行**。
- `contextLabel`：取案件名（`cases.title`）。

### 5.7 管理端配置编辑（沿用现有 CRUD）

让运营能在后台编辑 `billingMode` / `displayName`，沿现有「消耗项目」管理模块透传两个字段即可，不新建页面：

- 增改接口 `server/api/v1/admin/point-consumption-items/index.post.ts`、`[id].put.ts` 的 zod schema 加两字段。
- `pointConsumptionItems.service.ts` 的 Create / Update Input 接口与 DAO 的 `data` 字面量加两字段。
- 表单组件 `app/components/admin/point-items/FormDialog.vue` 加「计费模式」下拉与「友好名」输入。

## 6. "扣不扣"语义与错误处理

### 6.1 状态语义

- `status=启用` → 正常扣减。
- `status=停用` → 计费服务跳过扣减（代码 hook 仍执行），业务操作照常完成。

当前 `getConsumptionItemByKeyService` 对停用项**抛错**。统一计费服务不复用该方法，改用宽容读取（`findConsumptionItemByKeyDao` + 自行判断状态）。管理端 CRUD 仍可用原方法，行为不变。

### 6.2 积分不足

- **用户主动操作**：
  - agent 场景（1–4）→ 维持现有 `interrupt` 机制（弹"积分不足"）。
  - OCR / PDF / ASR（5–7）→ 预检或预扣失败时返回错误，操作不执行 / 已执行部分回滚。
- **后台静默任务**（8–9）→ 记日志并跳过，不影响主流程。

### 6.3 会员门槛

维持现状：agent 场景保留"需会员"校验；OCR / PDF / ASR / 摘要 / 记忆只查积分余额，不加会员门槛。

## 7. 用户端消耗记录友好化

### 7.1 展示字段

- **使用场景** = `displayName`（为空回退 `name`） + `contextLabel`，展示为「案件智能分析 · 劳动合同纠纷案」。
- **计费依据**：
  - 按次量模式 → 展示用量，如「解析 8 页」「转写 5 分钟」「识别 3 张」。
  - 按 token 模式 → **不展示任何用量**，只展示扣减的积分。
- **消耗积分**、**状态**、**时间** 不变。

### 7.2 展示层聚合

用户端消耗记录 API（`GET /api/v1/points/usage`）按 `operationId` 聚合：

- 一行 = 一次用户操作；积分取合计，按次量模式的用量取合计。
- 状态：全部已结算 → 已完成；含预扣 → 处理中；含异常 → 异常。
- 时间取该操作最早记录的时间。
- `operationId` 为空的历史旧记录：每条独立成行（向后兼容）。
- 可下钻查看该操作的明细碎记录。

底层精确扣费的账本记录（`pointConsumptionRecords`）完全不变，聚合只发生在查询与展示层。

### 7.3 前端改造

`PointUsageTable.vue` / `PointUsageMobile.vue`：

- "使用场景"列改为 `displayName` + `contextLabel`，去掉技术描述。
- 展开行：按次量模式显示计费依据（用量）；按 token 模式只显示积分，不显示用量。

## 8. 测试策略

- **`pointBilling.service` 单测**：token / count 两模式、停用跳过、降级容错、`operationId` 复用、各错误分支——这是计费正确性的主要保障。
- **计费项验证测试**：对每个新接入场景（`ocr_recognize` / `summary_generate` / `memory_extract`）写一个计费项验证测试，确认该 key 经统一计费服务在"启用/停用"两态下行为正确。
- **场景接入代码**：各 service 内的扣费接入是 3 行 best-effort `try/catch` 直调统一计费服务，正确性由上面两类测试 + 现有 `material` / `workflow` service 回归测试顺带覆盖 + 代码评审共同保证；不为这 3 行单独 mock 整个模型栈（避免过度测试）。
- **聚合查询测试**：多碎记录按 `operationId` 合并、混合状态、空 `operationId` 旧记录兼容。
- **管理端测试**：增改接口接受并落库 `billingMode` / `displayName`。
- `agent-platform/**` 覆盖率维持 ≥90%；测试一律用 worker 级 DB 隔离（直接 `import { prisma } from '~~/server/utils/db'`），不手建客户端。
- 先各模块单测，全部任务完成后再跑全量测试。

## 9. 迁移与兼容

- 1 次 `prisma migrate dev`：`pointConsumptionItems` 加 `billingMode` / `displayName`；`pointConsumptionRecords` 加 `operationId`（索引）/ `contextLabel` / `usageAmount`。
- `seedData.sql`：见 §3.3。
- **历史消耗记录**新字段为空：展示降级（"使用场景"显示配置项 `name`、无上下文、无用量、不聚合），可接受。

## 10. 风险与注意

- token 中间件改造涉及 interrupt/resume 路径，需保证停用态下不误触发 interrupt。
- `operationId` 必须在一次操作内稳定复用，否则聚合失效——agent 单次运行靠中间件 state 持有；案件分析多模块靠主图 `runId` 统一；异步任务靠 `batchId` 兜底。
- 初始案件分析（caseAnalysisV2 主图）的扣费**不走中间件**，须单独改造，是易漏点。
- token 计费中间件测试已有夹具 mock 了 `interrupt` 与 service 层；新增"停用不中断"用例须沿用该 mock 风格（独立 mock `interrupt` 并断言调用次数），不可混用真实 service 导致会员校验提前中断。
