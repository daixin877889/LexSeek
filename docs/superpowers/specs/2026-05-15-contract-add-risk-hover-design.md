# 合同审查 · 左侧预览 hover 新增风险 — 设计文档

- 日期：2026-05-15
- 模块：合同审查（contract review）
- 状态：已通过 5 维度审查并修订

## 一、背景与问题

### 1.1 原始诉求

合同审查的「新增风险」功能，当前要求用户在弹框里手填「条款序号（段落 index）」。普通用户（律师 / 法务）不理解这个序号，无法正常使用。

### 1.2 调研中发现的更严重问题

实测发现**当前「新增风险」功能根本无法保存**：

- 新增风险走 `PATCH /api/v1/assistant/contract/reviews/risk-list/:id`。
- 该接口的 `patchReviewRisksDAO` 对「已迁移审查」（`currentVersionId != null`）做三向 diff，body 含数据库不存在的风险 id 时抛 `PatchReviewRisksUnknownIdsError`。
- 前端新增风险生成的是 `crypto.randomUUID()`，必被判为「未知 id」→ PATCH 失败 → 回滚 → 风险消失（已浏览器实测确认）。
- 系统中不存在「新增单条风险」的专用接口。

因此本需求的真实范围是**补全「新增风险」功能（前端交互 + 后端接口）**。

## 二、现状调研结论

### 2.1 左侧合同预览

- 组件：`app/components/assistant/contract/ContractDocxPreview.vue`，用 `docx-preview` 的 `renderAsync` 渲染。
- `docx-preview` 0.3.7 把**所有正文段落（`w:p`）统一渲染为 `<p>`**（标题样式 → `<p class>`、列表项 → `<p class="numbering">`，均非 `<h*>` / `<li>`）；`<li>` 仅用于脚注 / 尾注；表格单元格为 `<td>`、内部仍是 `<p>`。
- 当前只对「已识别出风险的段落」注入 `data-risk-id` 并挂事件（`decorateRisks`）；普通段落无交互。

### 2.2 风险定位机制

- 风险在预览中的定位靠 `clauseText`（条款原文）+ `clauseParagraphIndex`（非空段落序号，0-based）。
- **口径不一致须注意**：后端 `collectNonEmptyParagraphs`（`xmlAst.ts`）只取 `w:body` 直接子级 `w:p`，**不进表格、不含脚注**；前端 `findByParagraphIndex`（`clauseLocator.ts`）用 `querySelectorAll('p,li,h1-6')` 会数到表格 `<td>` 内的 `<p>` 与脚注 `<li>`。含表格 / 脚注的合同里两者会偏差。本设计据此把「可新增范围」限定为正文段落（见 4.1）。
- 当前弹框「条款序号」字段绑定 `clauseIndex`——是 `segmentClauses` 切出的「条款序号」（另一口径），对预览定位无用，仅供 `RiskListPanel` 排序。

### 2.3 数据库

- `contractRisks.source` 是 `VarChar(20)` 自由字符串、**无枚举约束**——新增来源值不需迁移。
- `contractRisks` 表**没有 `risk` 列**：`risk`（法律风险）是 legacy JSON 时代字段，新表用 `analysis`（条款分析）承载，AI 风险落库也不写 `risk`。
- `clauseText` NOT NULL；`clauseIndex` / `clauseParagraphIndex` / `problematicQuote` / `quoteChar*` 可空；`stance` NOT NULL（default `'balanced'`）；`suggestedClauseText` 列已存在。

## 三、目标交互

1. 用户在左侧合同预览，鼠标移到任意正文段落 → 该段左侧空白处出现圆形「＋」按钮。
2. 点「＋」→ 打开「新增风险」弹框。
3. 弹框顶部自动带入该段落**原文**（只读展示）；段落位置（序号）一并自动带入、用户不可见。
4. 用户填写风险级别、问题概述、条款分析、修改建议、风险类别、建议改写后的条款等。
5. 点确认 → 新风险保存入库 → 出现在右侧风险清单，左侧该段同步高亮。

全程不需要手填序号、不需要粘贴原文。

## 四、设计

### 4.1 交互形态

- 新增入口：**左侧行首加号**——hover 段落时段落左侧空白处浮出圆形「＋」（已与需求方确认）。
- **可新增范围**：合同正文段落，即与后端 `clauseParagraphIndex` 口径一致的段落（预览容器的直接子级 `<p>`）。**表格单元格内段落、脚注 / 尾注不支持 hover 新增**——它们不在后端段落序号体系内，强行新增会导致序号错位、导出定位失败。

### 4.2 前端改动

**ContractDocxPreview.vue**

- 在 `containerRef` 上做**事件委托**（不逐段挂监听器）——`containerRef` 元素跨 docx 重渲染始终存在，避免 `loadDocx` 每次 `innerHTML=''` 重渲染后逐段监听器失效。
- 维护**单个浮动「＋」按钮**：hover 到正文段落时定位到该段左侧 gutter（`section.docx` 有 48px 左 padding，按段落 `offsetTop` 在滚动容器内定位以随滚动跟随）。
- 「＋」点击 → 计算该段落 `clauseParagraphIndex` + 取段落 `textContent` 作 `clauseText` → emit 新事件 `addRiskFromParagraph`，携带 `{ clauseParagraphIndex, clauseText }`；点击需 `stopPropagation`，避免与风险段已有的 `click → focusRisk` 冲突。

**shared/utils/clauseLocator.ts**

- 新增段落序号**反查**函数（element → index），与现有 `findByParagraphIndex`（index → element）同文件、复用 `PARA_BLOCK_SELECTOR` 与同一遍历算法，保持单一数据源、避免口径漂移。

**RiskEditDialog.vue**

- 新增模式接收预填的 `clauseText` + `clauseParagraphIndex`。
- 去掉「条款序号」输入框（新增、编辑两个模式均去掉，该字段彻底退出）。
- 「原文条款」在新增模式改为顶部**只读展示**；编辑模式维持现状。
- **去掉「法律风险」字段**——该字段在新版风险表无对应列、且与「问题概述」「条款分析」内容高度重叠（已与需求方确认）。
- 其余字段（风险级别、问题概述、法律依据、条款分析、修改建议、风险类别、建议改写后的条款）保持不变。

**RiskListPanel.vue**

- **移除顶部「新增风险」按钮及 `openCreate` 函数**——新增统一走 hover 入口（已与需求方确认）；顶部按钮不绑定段落、无原文与位置，与新方案矛盾，且当前因后端缺接口本就不可用。
- 风险排序见 4.4。

**ContractReviewPanel.vue / useContractReviewRisksEditing.ts**

- 串接预览的 `addRiskFromParagraph` 事件 → 以预填数据打开 `RiskEditDialog` 新增模式。
- 区分「新增」与「编辑」两条提交路径：新增走新接口（4.3），编辑维持 `PATCH risk-list`。
- 新增成功后用接口返回的风险数据并入本地 `review.risks`，触发右侧清单与左侧预览高亮刷新。

### 4.3 后端改动

**新建接口** `POST /api/v1/assistant/contract/reviews/add-risk/:id`（`:id` = reviewId，命名参照现有 `add-annotation/:id`）

- 鉴权：owner-only（`loadOwnedReview`）。
- 前置：review 状态为 `completed`（`REVIEW_EDITABLE_STATUSES`），**且 `currentVersionId != null`（已迁移）**——未迁移的存量审查 GET 仍读 legacy JSON、看不到新表插入，对其返回明确错误（实现时也可选择写入前调用兜底迁移，二选一）。
- 分层（遵循 `api.md`：DAO 仅被 Service 调用，handler 不直连 DAO）：
  - **handler**：zod 校验 body（请求体 schema 内联，参照 `add-annotation`；校验规则与 `RISK_SHAPE` 对齐，如 high/medium 必填 `suggestedClauseText`）。
  - **service**：`contractRisk.service.ts` 新增 `addManualRiskService`，做字段映射后调 DAO，参照 `persistAiRisksAsContractRows` 的映射规则。
  - **DAO**：**复用现有 `createContractRiskDAO`**；仅扩展 `CreateContractRiskInput` 增加 `suggestedClauseText`（表中该列已存在，无需迁移）。
- 响应：返回新风险数据（复用 `ContractRiskEntity` 类型或其子集）。

**新风险字段落库**（service 层映射）

| 字段 | 值 |
|---|---|
| `source` | `'manual'`（在 shared `RISK_SOURCES` 增加该值；DB 无约束、不需迁移） |
| `clauseText` | 前端传入的段落原文 |
| `clauseParagraphIndex` | 前端传入的段落序号 |
| `clauseIndex` | 同 `clauseParagraphIndex` 值（保持非空、单调） |
| `stance` | `DEFAULT_AI_RISK_STANCE`（`'balanced'`，显式传，满足 `CreateContractRiskInput` / NOT NULL 列要求） |
| `level` / `category` / `problem` / `legalBasis` / `analysis` / `suggestion` / `suggestedClauseText` | 用户填写值 |
| `code` / `problematicQuote` / `quoteCharStart` / `quoteCharEnd` / `quoteMatchSource` / `archivedStatus` | 留空（落 null / default） |

### 4.4 排序口径统一

- `RiskListPanel` 有 3 处按 `clauseIndex` 排序（`externalNewRisks` / `mainRisks` / `orphanedRisks`）。手动新增风险只进 `mainRisks` 分组——**本需求只把 `mainRisks` 的排序键从 `clauseIndex` 改为 `clauseParagraphIndex`**，另两处不动。
- 副作用声明：`clauseParagraphIndex` 可空（存量 AI 风险中可能为 null），排序时 null 视为最大（排末尾）。改键后，存量 `clauseParagraphIndex` 为 null 的 AI 风险会移到 `mainRisks` 末尾——这是已知且可接受的行为变更（该类风险定位本就缺失）。

### 4.5 RiskSource 消费点审计

- 新增 `RiskSource = 'manual'` 是类型联合扩展。实现时须审计所有对 `RiskSource` 做穷尽分支 / 按来源分组 / 穷尽 switch 的消费点（`RiskListPanel` 分组、`OverviewPanel`、导出、`redlineInjector` 等），确认 `'manual'` 落入正确分支——默认应与 `'ai'` 同等对待、进主风险清单。

## 五、边界情况

- 手动新增风险无精确句子锚点（`problematicQuote` 为 null）→ 导出修订模式（redline）时按既有降级逻辑以**批注**形式呈现（已核对 `redlineInjector` 跳过逻辑，符合预期，见 `docs/tech-docs/backend/contract.md` §11.6）。
- 表格单元格内段落、脚注 / 尾注不支持 hover 新增（见 4.1）。
- 新增成功后复用现有 `decorateRisks` 机制（`props.risks` 变化触发重装饰）实现右侧清单出现 + 左侧高亮。
- 含脚注的合同——前端 `findByParagraphIndex` 会把脚注 `<li>` 计入、与后端口径偏差，属**既有隐患**，非本需求引入，本需求不扩大该问题。

## 六、不做（YAGNI）

- 不重做新增弹框其余字段。
- 不改批注 / 修订导出的降级逻辑。
- 不涉及数据库迁移（`source` 列无约束、`suggestedClauseText` 列已存在）。
- 不修复「含脚注合同前端段落序号偏移」的既有隐患（独立问题）。
- `RISK_SOURCES` 仅加 `'manual'` 值；是否新建来源中文标签 map 留待 UI 有展示需求时另议。

## 七、影响文件清单

| 文件 | 改动 |
|---|---|
| `app/components/assistant/contract/ContractDocxPreview.vue` | 事件委托 + 浮动「＋」按钮 + emit `addRiskFromParagraph` |
| `shared/utils/clauseLocator.ts` | 新增段落序号反查函数 |
| `app/components/assistant/contract/RiskEditDialog.vue` | 新增模式去条款序号、原文条款只读、去掉「法律风险」字段 |
| `app/components/assistant/contract/RiskListPanel.vue` | 移除顶部新增按钮 + `openCreate`；`mainRisks` 排序键改 `clauseParagraphIndex` |
| `app/components/assistant/contract/ContractReviewPanel.vue` | 串接新增事件 → 打开弹框 → 调新接口 |
| `app/composables/contract/useContractReviewRisksEditing.ts` | 区分新增 / 编辑两条提交路径 |
| `shared/types/contract.ts` | `RISK_SOURCES` 增加 `'manual'` |
| `server/api/v1/assistant/contract/reviews/add-risk/[id].post.ts` | 新建「新增单条风险」接口（handler 层） |
| `server/agents/contract/contractRisk.service.ts` | 新增 `addManualRiskService` |
| `server/agents/contract/contractRisk.dao.ts` | 扩展 `CreateContractRiskInput` 增加 `suggestedClauseText`（复用 `createContractRiskDAO`） |
| `prisma/models/contractRiskAndAnnotation.prisma` | `source` 列文档注释补 `'manual'`（仅注释，非迁移） |

## 八、测试要点

- 后端：新接口 owner-only 鉴权、`completed` + 已迁移双重校验、入库字段正确（`source='manual'`、`stance`、定位字段）、未迁移审查返回明确错误。
- 前端：hover 正文段落出现「＋」、表格内段落不出现；点击后弹框带入正确原文与段落序号；新增模式无条款序号字段、无法律风险字段；顶部「新增风险」按钮已移除。
- 端到端：含表格的合同，验证正文段落新增的序号定位正确；新增 → 入库 → 右侧清单出现且排序位置正确 → 左侧该段高亮。
- 回归：编辑 / 删除已有风险不受影响；导出批注 / 修订对手动新增风险按降级逻辑处理。
