# 合同审查 · 左侧预览 hover 新增风险 — 设计文档

- 日期：2026-05-15
- 模块：合同审查（contract review）
- 状态：已与需求方确认交互形态，待评审

## 一、背景与问题

### 1.1 原始诉求

合同审查的「新增风险」功能，当前要求用户在弹框里手填一个「条款序号（段落 index）」。普通用户（律师 / 法务）不理解这个序号是什么、该填几，无法正常使用。

### 1.2 调研中发现的更严重问题

排查时实测发现：**当前「新增风险」功能根本无法保存**。

- 新增风险走 `PATCH /api/v1/assistant/contract/reviews/risk-list/:id`。
- 该接口的 `patchReviewRisksDAO` 对「已迁移审查」（`currentVersionId != null`，即几乎所有正常完成的审查）做 keep/new/removed 三向 diff，body 中出现数据库不存在的风险 id 时抛 `PatchReviewRisksUnknownIdsError` 返回错误。
- 前端新增风险生成的 id 是 `crypto.randomUUID()`，必然被判定为「未知 id」。
- 结果：用户填完点确认 → 前端乐观插入 → PATCH 失败 → 回滚 → 风险消失。已用浏览器实测确认。
- 系统中**不存在**「新增单条风险」的专用接口。

因此本需求的真实范围是：**补全「新增风险」功能（前端交互 + 后端接口）**，而非单纯的交互优化。

## 二、现状调研结论

### 2.1 左侧合同预览

- 组件：`app/components/assistant/contract/ContractDocxPreview.vue`。
- 用 `docx-preview` 的 `renderAsync` 把合同 .docx 渲染成 HTML；每个 Word 段落渲染成 `<p>` / `<li>` / `<h1-6>` 块级元素。
- 当前只对「已识别出风险的段落」注入 `data-risk-id` 并挂 mouseenter / click 事件（`decorateRisks`）；普通段落无任何交互。

### 2.2 风险定位机制

- 风险在预览中的定位靠 `clauseText`（条款原文）+ `clauseParagraphIndex`（非空段落序号，0-based）。
- `clauseParagraphIndex` 口径：容器内第 N 个非空块级元素（`shared/utils/clauseLocator.ts` 的 `findByParagraphIndex`），前后端同算法。
- 当前弹框「条款序号」字段绑定的是 `clauseIndex`——它是 `segmentClauses` 切出的「条款序号」（另一口径），对预览定位无用，仅用于 `RiskListPanel` 排序。

### 2.3 数据库

- `contractRisks.source` 是 `VarChar(20)` 自由字符串，**无枚举约束**——新增一个来源值不需要数据库迁移。
- `clauseText` NOT NULL；`clauseIndex` / `clauseParagraphIndex` / `problematicQuote` / `quoteCharStart` / `quoteCharEnd` 均可空。

## 三、目标交互

1. 用户在左侧合同预览，鼠标移到任意一段 → 该段左侧空白处出现圆形「＋」按钮。
2. 点「＋」→ 打开「新增风险」弹框。
3. 弹框顶部自动带入该段落的**原文**（只读展示）；段落位置（序号）一并自动带入、用户不可见。
4. 用户填写风险级别、问题概述、条款分析、法律风险、修改建议、风险类别、建议改写后的条款等。
5. 点确认 → 新风险保存入库 → 出现在右侧风险清单，左侧该段同步高亮。

全程不需要手填序号、不需要粘贴原文。

## 四、设计

### 4.1 交互形态

- 新增入口：**左侧行首加号**——hover 段落时，段落左侧空白处浮出圆形「＋」（已与需求方确认选定）。
- 可新增范围：所有非空段落（含条款标题段）。

### 4.2 前端改动

**ContractDocxPreview.vue**

- 渲染完成后，给容器内**所有非空块级段落**挂 hover 行为，hover 时在段落左侧显示「＋」按钮。
- 「＋」按钮点击 → 计算该段落的 `clauseParagraphIndex`（遍历 `PARA_BLOCK_SELECTOR` 非空块级元素求序号，即 `findByParagraphIndex` 的反向）+ 取段落 `textContent` 作为 `clauseText`。
- emit 新事件（如 `addRiskFromParagraph`），携带 `{ clauseParagraphIndex, clauseText }`。

**RiskEditDialog.vue**

- 新增模式接收预填的 `clauseText` + `clauseParagraphIndex`。
- 去掉「条款序号」输入框——新增模式也去掉（编辑模式上一轮已去掉，至此该字段彻底退出两个模式）。
- 「原文条款」在新增模式改为顶部**只读展示**（自动带入的段落原文），不可编辑；编辑模式不在本次范围内，维持现状。
- 其余字段（风险级别、问题概述、法律依据、条款分析、法律风险、修改建议、风险类别、建议改写后的条款）保持不变。

**数据流**

- 新增确认走**新的后端接口**（见 4.3），不再走 `PATCH risk-list`。
- `ContractReviewPanel` / `useContractReviewRisksEditing` 需区分「新增」与「编辑」两条提交路径。
- 新增成功后，用接口返回的风险数据并入本地 `review.risks` 列表，触发右侧清单与左侧预览高亮刷新。

### 4.3 后端改动

**新建接口** `POST /api/v1/assistant/contract/reviews/add-risk/:id`（`:id` = reviewId，命名参照现有 `add-annotation/:id`）

- 鉴权：owner-only（`loadOwnedReview`）。
- 前置：review 状态须为 `completed`（`REVIEW_EDITABLE_STATUSES`），否则 409。
- body：风险内容字段（`level` / `category` / `problem` / `legalBasis` / `analysis` / `risk` / `suggestion` / `suggestedClauseText`）+ `clauseText` + `clauseParagraphIndex`，用 zod 校验。
- 行为：向 `contractRisks` 表插入一条新风险，返回新风险数据。

**新风险的字段落库**

| 字段 | 值 |
|---|---|
| `source` | `'manual'`（新增来源值；DB 无约束，仅需在 shared `RISK_SOURCES` 增加该值与中文标签） |
| `clauseText` | 前端传入的段落原文 |
| `clauseParagraphIndex` | 前端传入的段落序号 |
| `clauseIndex` | 同 `clauseParagraphIndex` 值（保持非空、单调即可，排序见 4.4） |
| `problematicQuote` / `quoteCharStart` / `quoteCharEnd` / `quoteMatchSource` | `null`（手动新增无精确句子锚点） |
| `code` | `null` |
| `archivedStatus` | `null`（未处置） |

### 4.4 排序口径统一

- `RiskListPanel` 当前按 `clauseIndex` 排序，但 `clauseIndex`（条款序号）与 `clauseParagraphIndex`（段落序号）口径不同——AI 风险与手动新增风险混排会错位。
- 改动：`RiskListPanel` 的风险排序键从 `clauseIndex` 改为 `clauseParagraphIndex`（所有风险都有该值，真实反映在合同中的位置；为 null 时排末尾兜底）。
- 这是一个独立的小修正，随本需求一并处理。

## 五、边界情况

- 手动新增的风险没有 AI 那种「精确到句子」的锚点（`problematicQuote` 为 null）→ 导出「修订模式（redline）」时这一条按系统既有降级逻辑以**批注**形式呈现（符合预期，见 `docs/tech-docs/backend/contract.md` §11.6）。
- 所有非空段落都可新增，包括条款标题段。
- 新增成功后，右侧风险清单出现该条、左侧预览对应段落高亮——复用现有 `decorateRisks` 机制（`props.risks` 变化触发重新装饰）。
- 新增的风险默认进入主风险清单（`source !== 'external_new'`），不进「外部新增」分组。

## 六、不做（YAGNI）

- 不重做「新增风险」弹框的其余字段（需求方明确表示字段精简评估「先忽略」）。
- 不改「批注 / 修订导出」的降级逻辑。
- 不涉及数据库迁移（`source` 列无约束）。

## 七、影响文件清单（概要）

| 文件 | 改动 |
|---|---|
| `app/components/assistant/contract/ContractDocxPreview.vue` | hover「＋」按钮 + emit 新增事件 + 段落序号反查 |
| `app/components/assistant/contract/RiskEditDialog.vue` | 新增模式去条款序号 + 原文条款只读 |
| `app/components/assistant/contract/RiskListPanel.vue` | 风险排序键改 `clauseParagraphIndex` |
| `app/components/assistant/contract/ContractReviewPanel.vue` | 串接预览的新增事件 → 打开弹框 → 调新接口 |
| `app/composables/contract/useContractReviewRisksEditing.ts` | 区分新增 / 编辑两条提交路径 |
| `shared/types/contract.ts` | `RISK_SOURCES` 增加 `'manual'` |
| `server/api/v1/assistant/contract/reviews/add-risk/[id].post.ts` | 新建「新增单条风险」接口 |
| `server/agents/contract/contractRisk.dao.ts` | 新增「插入单条风险」DAO |

## 八、测试要点

- 后端：新接口的 owner-only 鉴权、状态校验、入库字段正确性（含 `source='manual'`、定位字段）。
- 前端：hover 任意段落出现「＋」；点击后弹框带入正确的原文与段落序号；新增模式无条款序号字段。
- 端到端：左侧点段落新增 → 风险入库 → 右侧清单出现该条且排序位置正确 → 左侧该段高亮。
- 回归：编辑已有风险、删除风险不受影响；导出批注 / 修订对手动新增风险按降级逻辑处理。
