# 案件相关功能迭代设计

- 日期：2026-05-14
- 状态：Spec 待审
- 涉及模块：案件详情页、案件创建/编辑、文书页、案件分析 Agent 与 workflow 上下文

## 1. 背景与目标

针对案件功能的四项体验和能力升级：

1. **下拉式批量分析入口**：让用户能从案件详情页直接看到并跳回此前跑过的批量分析会话，而不是每次都新建。
2. **案件基础信息补全**：详情页"基本信息"卡片当前只展示 4 个字段，缺失诉讼信息、状态、案件描述等字段，让律师无法一眼看清案件全貌。
3. **新建文书自动启动 AI 生成**：用户点"新建文书"选好模板后，进入文书页应自动唤起 AI 对话框并按案件信息开始生成，少 2 次点击。
4. **新增"分析立场"字段**：让用户在创建案件时选定原告 / 被告 / 中立视角，分析时跟随案件档案一起喂给 Agent，使分析结果更贴近用户实际诉求。

每项都是局部增量改动，不改变现有数据模型语义、不破坏已有会话与分析结果。

## 2. 总览

| 修改 | 用户感知 | 是否要 prisma migrate | 改动范围 |
|------|---------|---------------------|---------|
| §3.1 批量分析下拉 | 详情页批量分析按钮变下拉 | 否 | 1 新组件 + 1 新 API + 详情页连接 |
| §3.2 基础信息补全 | 详情页基本信息卡片字段更全、可编辑 | 否（字段已存在） | UI 卡片 + 编辑表单 + PUT API |
| §3.3 文书自动 AI 生成 | 跳文书页后自动唤起对话框并发送指令 | 否 | 跳转 URL 协议 + 文书页 query 处理 |
| §3.4 分析立场字段 | 创建/编辑/分析时多一个三段式立场选择 | **是**（cases 表加 stance） | schema + 表单 + 详情页 + Agent 上下文 |

## 3. 设计细节

### 3.1 批量分析按钮改下拉

#### 3.1.1 用户感知

- 详情页右上角原「+ 批量分析」按钮替换为下拉浮层（点击触发，参考 `app/components/case/SessionListPopover.vue` 风格）。
- 浮层内容自上而下：
  - **会话列表**：该案件下所有 `caseSessions.type=2`、`scope='case'`、未删除的会话，按 `updatedAt` 倒序，每行显示标题 + 相对时间（dayjs.fromNow）+ 若有 active run 则一个进行中状态点。
  - **底部操作**：「+ 新建批量分析」一项。当 `showBatchButton===false`（即所有模块已完成）时禁用，hover 提示「所有模块已完成，无需新建」。
- 点击列表中任意会话 → 跳 `/dashboard/cases/init-analysis/:sessionId`。
- 点击「+ 新建批量分析」（可用时）→ 跳 `/dashboard/cases/init-analysis?caseId=:caseId`（保持现按钮跳转逻辑）。

#### 3.1.2 技术落地

- **新组件** `app/components/case/BatchAnalysisPopover.vue`
  - props：`caseId: number`、`showBatchButton: boolean`、`isAnalysisRunning: boolean`
  - emits：`new-batch`（点击底部新建项时触发）、`open-session(sessionId)`（点击列表项时触发）
  - 内部用 shadcn-vue `Popover` + `PopoverContent`，复用 `SessionListPopover.vue` 的列表样式（手抄而非组件复用——后者 trigger 写死「显示当前 currentId 对应 title」，与本场景「+ 批量分析」按钮形态不匹配，强行复用需要加 ≥5 个新 prop 让原组件变三用，反而难维护）。
  - **Popover 禁用规则**：`showBatchButton===false` 时，禁用**底部「+ 新建批量分析」按钮**（直接给 `<button>` 元素加 `:disabled` + tooltip），而**不是**给 `PopoverTrigger` 加 disabled——trigger 始终可点开查看历史会话。参考 `SessionListPopover.vue:91-100` 的写法。
- **新 API** `GET /api/v1/cases/analysis/init-sessions?caseId=:caseId`
  - 文件：`server/api/v1/cases/analysis/init-sessions.get.ts`
  - 实现照抄 `module-sessions.get.ts`，只是 `type=2`、不带 `metadataFilter`，底层共用 `listSessionsWithActiveRunDAO`。
  - **鉴权**：用户端接口，必须 `userId: user.id` 严格过滤；未登录返 401；案件不存在或非本人返 404（参照 module-sessions.get.ts 第 22-30 行）。**无需**在管理后台 RBAC api_permissions 表登记（用户端接口不走 03.permission 中间件强制拦截）。
  - 返回 `{ sessionId, title, hasActiveRun, createdAt, updatedAt }[]`。title 取 `caseSessions.title`，为空时回退为「批量分析 #N」（N 为按创建顺序的序号，前端拼）。
- **替换按钮**：`app/components/case/AnalysisResults.vue:463-469` 这段模板替换为 `<BatchAnalysisPopover>`，把 props 透传过去。
- **父级连接**：`app/pages/dashboard/cases/[id].vue` 复用现有 `handleBatchGenerate()` 作为 `new-batch` 回调；新增 `handleOpenInitSession(sessionId)` 跳 `/dashboard/cases/init-analysis/:sessionId`。
- **现有行为保留**：`showBatchButton` 计算逻辑、跨标签广播 (`postCrossTabEvent`)、`SessionListPopover.vue` 本身不变。

#### 3.1.3 验收

- 详情页右上角下拉里能看到该案件历史所有 `type=2` 会话，按时间倒序。
- 所有模块都已完成的状态下，「新建批量分析」项禁用并显示提示。
- 点已有会话项 → 进入对应 init-analysis 详情页继续看 / 操作。
- 跨标签同步逻辑不受影响：另一个 tab 创建了新会话后，本下拉刷新（通过现有 `analysis:updated` 跨标签事件触发 refetch）能看到新会话。

---

### 3.2 案件基础信息补全

#### 3.2.1 用户感知

详情页「案件基本信息」卡片在保留现有字段（标题 / 类型 / 原告 / 被告 / 概述 / 动态字段）的基础上，追加：

| 新增字段 | 渲染方式 |
|---------|---------|
| 案件状态 (`status`) | 彩色徽章（CaseStatus 字典） |
| 法院 (`courtName`) | 文本 |
| 一审案号 (`firstInstanceCaseNo`) | 文本 |
| 一审法官 (`firstInstanceJudge`) | 文本 |
| 二审案号 (`secondInstanceCaseNo`) | 文本 |
| 二审法官 (`secondInstanceJudge`) | 文本 |
| 案件描述 (`content`) | 卡片末尾独立段落，默认折叠 3 行 + 「展开/收起」按钮 |

「编辑信息」表单同步支持编辑上述 7 个字段（与基本信息一致的输入控件）。

#### 3.2.2 技术落地

- **UI**：修改 `app/components/initAnalysis/CaseInfoCard.vue`
  - 在现有字段下方追加 6 行（状态 + 4 个诉讼字段 + 描述折叠区块）。
  - 展示态：空字段隐藏整行（避免空表格）。
  - 编辑态：状态用 shadcn-vue `Select` 复用 `CaseStatusText` 字典；其余用 `Input`；案件描述用 `Textarea`。
- **API**：修改 `server/api/v1/cases/[caseId].put.ts` 的 zod bodySchema
  - 现有 3 字段 + 新增 7 个可选字段：`content` / `status` / `courtName` / `firstInstanceCaseNo` / `firstInstanceJudge` / `secondInstanceCaseNo` / `secondInstanceJudge`。
  - 对应 service 把这些字段透传到 `prisma.cases.update`。
- **数据查询**：`composables/useCaseDetail.ts` 拉案件信息的 select 列表新增上述 7 个字段（如果之前没选）。
- **共享类型**：`shared/types/case.ts` 的 `CaseInfo` interface 同步补这些字段。

#### 3.2.3 验收

- 详情页基本信息卡片展示这 7 个字段，空字段自动隐藏行。
- 「编辑信息」可以改这 7 个字段，保存后刷新仍生效。
- 创建案件页（已有这些字段，无需改动）正常工作。
- PUT API 单元测试覆盖新字段。

---

### 3.3 新建文书跳转 + 自动 AI 生成

#### 3.3.1 用户感知

- 案件详情页点「+ 新建文书」→ 模板选择 Sheet 弹出（不变）。
- 选好模板 → POST 创建草稿（不变） → 跳文书页（不变）。
- 文书页进入后：
  - AI 浮窗自动展开（等同于自动点了「AI 生成」按钮）。
  - 自动发送一条消息「请根据当前案件信息生成《{模板名}》」。
  - 浮窗立即开始流式输出生成结果。
- 刷新文书页：不会重复触发自动生成（query 已被清除）。

#### 3.3.2 技术落地

- **跳转 URL 协议**：`app/pages/dashboard/cases/[id].vue:270 handleTemplateSelect` 修改跳转 URL 增加一个 boolean query：
  ```
  /dashboard/document/drafts/{draftId}
    ?from=case
    &caseId={caseId}
    &returnTab={returnTab}
    &autoAi=1
  ```
  **不**额外携带 `autoPrompt` / 模板名——文书页本身就要加载草稿数据（`GET /api/v1/assistant/document/drafts/:id` 返回值已含 `templateName`，见 `server/api/v1/assistant/document/drafts.get.ts:39`），让文书页自己从草稿对象拿模板名即可。这也意味着**不需要修改** `DocumentTemplatePickerSheet` 的 emit 协议。
- **文书页处理**：`app/pages/dashboard/document/drafts/[id].vue`
  - 在 `onMounted` 里（**不放 `watch(route.query)`**——避免 router.replace 时多余触发）注册一个一次性副作用：等草稿数据 + `useDocumentAgent()` 都就绪后执行。
  - 若 `route.query.autoAi === '1'`：`openAgent()` → `nextTick` → 从草稿对象取 `templateName` → `handleChatSubmit({ text: '请根据当前案件信息生成《' + templateName + '》' })` → `router.replace({ query: { from, caseId, returnTab } })` 清除 `autoAi` 防刷新重复触发。
  - **兜底**：若 `templateName` 缺失（理论上不应发生），回退为「请根据当前案件信息开始生成本文书」。
- **不修改**：`AssistantDocumentTemplatePickerSheet` / `ChatWindowShell.vue` / `AiChat.vue` / `useDocumentAgent` — 自动发送复用现有 `handleChatSubmit` 路径，等同于用户手动输入。

#### 3.3.3 验收

- 走详情页「新建文书」全链路：选模板 → 文书页打开后 1 秒内浮窗自动展开 + 看到自动发送的指令气泡 + Agent 开始流式输出。
- 同链路完成后，浏览器地址栏 URL 已经不带 `autoAi`。
- 直接复制此前 draft URL（不带 autoAi）在新 tab 打开：浮窗不会自动打开，行为同改造前。

---

### 3.4 分析立场字段

#### 3.4.1 用户感知

- 创建案件表单（`app/components/caseCreation/ManualForm.vue`）在「案件类型」下方新增「分析立场」字段，三个选项水平平铺：
  - 原告（plaintiff）
  - 被告（defendant）
  - 中立（neutral）
- 默认选中「原告」。
- 详情页基本信息卡片增加一行「分析立场」+ 彩色徽章（与状态字段同样的徽章风格）。
- 编辑信息时使用同一个三段式控件可改立场。
- 改完立场后，下一次跑批量分析或模块对话时，Agent 会按对应视角分析。

#### 3.4.2 技术落地

##### 数据库

- Prisma：`prisma/models/case.prisma` 的 `cases` model 加字段：
  ```prisma
  /// 分析立场：plaintiff（原告）/ defendant（被告）/ neutral（中立）
  stance String @default("plaintiff") @db.VarChar(20)
  ```
- 迁移：`bun run prisma:migrate --name add_cases_stance`。
- **存量行行为**：DEFAULT 'plaintiff' 自动回填，存量案件下次跑分析按"原告视角"进行（与新建默认一致）。这是与用户在 brainstorm 阶段明确确认过的选择；如果以后需要存量保持隐式中立，仅需把 DEFAULT 改为 'neutral'，前端默认仍为 plaintiff。
- **DEFAULT 安全性说明**：Prisma 对"加 NOT NULL + DEFAULT 字段"会生成单步 SQL `ALTER TABLE cases ADD COLUMN stance VARCHAR(20) NOT NULL DEFAULT 'plaintiff'`，PostgreSQL 11+ 对该形式做元数据级回填（不重写表数据，立即生效）。项目内 `add_thinking_fields`、`add_contract_review_phase_b_fields` 等 5 处迁移已验证此模式可用。**实施时**：跑 `prisma migrate dev --name add_cases_stance` 后，先看 `prisma/migrations/<ts>_add_cases_stance/migration.sql` 确认 SQL 是单步 ADD COLUMN with DEFAULT，再 commit。

##### 类型

- `shared/types/case.ts`：
  ```typescript
  export enum CaseStance {
    PLAINTIFF = 'plaintiff',
    DEFENDANT = 'defendant',
    NEUTRAL = 'neutral',
  }
  export const CaseStanceText: Record<CaseStance, string> = {
    [CaseStance.PLAINTIFF]: '原告',
    [CaseStance.DEFENDANT]: '被告',
    [CaseStance.NEUTRAL]: '中立',
  }
  ```
- `CaseInfo` interface 加 `stance: CaseStance`。

##### UI 控件

- 复用 shadcn-vue `ToggleGroup`（`type="single"`、`variant="outline"`）实现三段式平铺。
- **先安装组件**：`ls app/components/ui/` 当前**未安装** `toggle-group`，实施前先跑 `npx shadcn-vue@latest add toggle-group`（产物落到 `app/components/ui/toggle-group/`，禁止手改）。
- 提取通用子组件 `app/components/caseCreation/StanceToggleGroup.vue`（创建页和编辑表单共用，封装空值拦截逻辑）。
- **空值拦截**：shadcn-vue `ToggleGroup type="single"` 允许用户再次点击当前项"取消选中"，v-model 会变为空字符串。StanceToggleGroup 内部 `watch` 监听 v-model：若变为空，立刻还原为上一个有效值（确保始终有立场被选中，符合业务约束）。

##### 表单与 API

- 创建表单（ManualForm.vue）：reactive 加 `stance: CaseStance.PLAINTIFF`，渲染 StanceToggleGroup。
- 创建 API（`server/api/v1/cases/create.post.ts`）zod schema 加 `stance: z.nativeEnum(CaseStance).default(CaseStance.PLAINTIFF)`，create service 透传。
- 编辑表单（`CaseInfoCard.vue` 编辑态）：加 StanceToggleGroup。
- 编辑 API（`server/api/v1/cases/[caseId].put.ts`）zod schema 加 `stance: z.nativeEnum(CaseStance).optional()`，update service 透传。

##### Agent 上下文透传

- 修改 `server/agents/case-analysis/_shared/moduleContextBuilder.ts:115-129` 的 `profile` 对象拼装：
  - 加 `stance: caseRecord.stance ?? CaseStance.PLAINTIFF` 字段（兜底防止 DB 异常返 null）。
- 同文件的 `roleAndFlow` system prompt 段（或同等位置）追加固定说明：
  > 请以案件档案中 `stance` 字段作为分析视角：`plaintiff`=站在原告角度论证主张和反驳被告抗辩、`defendant`=站在被告角度组织抗辩和反驳原告主张、`neutral`=客观中立同时分析双方立场。
- Workflow state（`caseAnalysisV2.workflow.ts:39 WorkflowState`）**不需要**单独加 stance 字段——立场已在 caseProfile JSON 中，Agent 整轮分析都能读到。

#### 3.4.3 验收

- 创建案件页能看到三段式平铺立场控件，默认「原告」高亮。
- 创建案件后，DB 中 `cases.stance` 字段为对应值；存量案件 stance='plaintiff'。
- 详情页基本信息卡片展示立场徽章。
- 编辑信息可改立场，保存后刷新仍生效。
- 跑批量分析时，从 LangSmith / Langfuse trace 能看到 system prompt 含 `"stance": "plaintiff"` 字段以及对应的立场说明文案。
- 切换不同立场（原告 / 被告 / 中立）后，案件分析结果的论证视角能体现差异（人工验证）。

---

## 4. 范围外（明确不做）

- **不**为已有 type=2 会话补"初始化分析" / "批量分析"二级分类（用户已确认无此区分）。
- **不**调整 caseSessions 表结构（type 字段语义保持现状）。
- **不**为案件描述（content）做富文本编辑（保持现有 Textarea）。
- **不**针对不同立场拆分不同 workflow / nodes（保持单一 workflow，立场仅在 prompt 层影响 LLM）。
- **不**做存量案件立场的人工回填（统一 default 'plaintiff'，由 DB DEFAULT 自动处理）。
- **不**在文书页支持除 `autoAi=1` 外的其他自动触发协议（如 `autoSendOnLoad` 等通用化）。
- **不**额外引入"小索"等通用问答下拉的会话管理改造（仅改批量分析按钮一处）。

## 5. 测试策略

- **§3.1**：新增 API 单元测试覆盖 type=2 列表过滤；前端 Popover 组件做交互快照。
- **§3.2**：PUT API 单元测试覆盖每个新字段；前端编辑保存的集成测试。
- **§3.3**：文书页加载时的 query 处理做单元测试；端到端走一次完整链路（chrome-devtools MCP）。
- **§3.4**：
  - schema migration 在 worker 隔离 DB 上跑通；
  - 创建 API zod 校验测试；
  - moduleContextBuilder 单元测试断言 `profile.stance` 与 system prompt 段文案；
  - 单元测试断言 `CaseStance.PLAINTIFF === 'plaintiff'`、`CaseStance.DEFENDANT === 'defendant'`、`CaseStance.NEUTRAL === 'neutral'`，确保 enum 值与 Prisma `@default("plaintiff")` 等 DB 字符串值始终一致；
  - StanceToggleGroup 空值拦截单元测试（v-model 设为 `''` 时应立刻被还原）；
  - 人工跑一次原告 / 被告 / 中立各 1 case 看分析结果差异。

## 6. 改动文件清单

| 模块 | 新建 | 修改 |
|------|-----|------|
| 前端组件 | `app/components/case/BatchAnalysisPopover.vue`、`app/components/caseCreation/StanceToggleGroup.vue` | `app/components/case/AnalysisResults.vue`、`app/components/initAnalysis/CaseInfoCard.vue`、`app/components/caseCreation/ManualForm.vue` |
| shadcn 组件 | `app/components/ui/toggle-group/`（`npx shadcn-vue add toggle-group` 生成，禁止手改） | — |
| 页面 | — | `app/pages/dashboard/cases/[id].vue`、`app/pages/dashboard/document/drafts/[id].vue` |
| Composable / 类型 | — | `app/composables/useCaseDetail.ts`、`shared/types/case.ts` |
| 后端 API | `server/api/v1/cases/analysis/init-sessions.get.ts` | `server/api/v1/cases/[caseId].put.ts`、`server/api/v1/cases/create.post.ts` |
| Agent 上下文 | — | `server/agents/case-analysis/_shared/moduleContextBuilder.ts` |
| Prisma | — | `prisma/models/case.prisma` (+ 自动生成 migration) |

## 7. 依赖与风险

- **§3.1**：依赖 `caseSessions` 表 type=2 数据稳定，无 schema 风险。
- **§3.2**：依赖现有 schema，无迁移风险。注意编辑表单字段增多时验证 UX。
- **§3.3**：URL 仅传 `autoAi=1` 一个 boolean query（无中文 encode），不存在长度风险；模板名由文书页从草稿对象自行读取，与跳转链路解耦。
- **§3.4**：新增 DB 字段 + DEFAULT。如果用户期望存量保持中立，需把 DEFAULT 改为 'neutral'，前端默认 plaintiff 不变——本 spec 已明确选 plaintiff 一致回填。

## 8. 后续可拓展

- 若立场分析效果不理想，可升级为「中等」方案：在 prompts 表的关键模板（如 claim、defense）里显式分支立场段。
- 若用户对批量分析下拉里的会话需要重命名 / 删除 / 复制功能，可参考 `SessionListPopover.vue` 已有交互扩展。
- 案件基础信息可继续接入「联系电话」「身份证号」等当事人 partyInfoSchema 已有字段（当前仅展示 name）。
