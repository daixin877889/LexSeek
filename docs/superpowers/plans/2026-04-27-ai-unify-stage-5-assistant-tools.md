# 阶段 5 · 通用问答 → 文书 / 合同（无 caseId）

> Spec 锚点：`docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §6 阶段 5
> 工程量：**2-3 周**（产品决策追加了 interrupt 透传机制 + 模板推荐卡片）
> 起点 tag：`ai-unify-stage-4-done`
> 入口 handoff：`docs/superpowers/notes/2026-04-27-stage4-to-stage5-handoff.md`

---

## 一、目标（用户视角）

让用户在「通用问答」对话里可以一句话起草文书 / 审一份合同：

- **E2E 1（文书）**：用户输入"帮我起草起诉状" → 助手弹「模板选择卡片」（推荐 3 个 + 第一个预选） → 用户点「使用此模板」 → 助手起草中... → 工具卡片"已完成" → 跳文书页 → "+ 关联案件"成功
- **E2E 2（合同）**：用户输入"审一下这份合同"（拖入 docx）→ 助手弹「立场选择卡片」 → 用户选乙方 + 填甲乙双方名 → 助手分析中... → 工具卡片"已完成"含 Top 3 风险 → 跳合同工作台 → "+ 关联案件"成功
- **返回闭环**：从子页面顶部"← 返回 通用问答"按钮可以回到原对话（用 `?sid=` 恢复 session）

---

## 二、产品决策（已拍板）

| # | 决策 | 终方案 |
|---|---|---|
| **D1** | 合同审查的「立场选择」放哪 | **interrupt 透传**：助手对话里弹交互卡片让用户选立场，用户选完后子代理 resume 继续 |
| **D2** | 文书起草的「模板选择」 | **永远弹推荐卡片**：上半部分 3 个推荐 + 第一个预选；下半折叠"浏览全部 + 搜索 + 分类筛选"；零召回时直接展开搜索 |
| **D2.匹配** | 模板推荐算法 | LLM 传 `intent + keywords + 可选 category 提示`；后端类内优先 + 跨类兜底；评分：name×10 / desc×5 / category×3 / 用户最近 30 天用过×8 |
| **D3** | assistantMain 节点 skill 接入 | **一次性接通 6 个**（docx / pptx / evidence-defense / litigation-visualization / minimax-pdf / minimax-xlsx） |
| **D4** | 工具卡片注入位置 | 通用问答聊天面板就地注入 `AiToolRenderer.toolMap`（阶段 7 收敛时再迁移） |
| **D5** | 执行模式 | **TeamCreate 4 个 teammate 并行**：tools-impl / admin-api / frontend-cards / frontend-pages |
| **顶部来源条** | 文书页 / 合同工作台顶部 | 左"← 返回 通用问答" + 右"+ 关联案件"，去重复 |
| **关联案件 Dialog** | 列表过滤 | 排除已删除 + 已归档（status≠active）案件 |

---

## 三、Mockup 沉淀（团队 UI 实施基线）

### Mockup A · 文书模板选择卡片（默认状态）

```
助手：根据「解除劳动合同通知」为您找到：

       ┌──────────────────────────────────────────────┐
       │  ⏸ 请选择文书模板                             │
       │                                               │
       │  ● 解除劳动合同通知书              ← 已预选     │
       │  ○ 解除合同协议（通用）                        │
       │  ○ 终止合作关系函                              │
       │                                               │
       │  ▾ 没找到？浏览全部 247 个模板                 │
       │                                               │
       │             [使用此模板]                       │
       └──────────────────────────────────────────────┘
```

### Mockup A2 · 文书模板选择卡片（展开状态）

```
       ┌──────────────────────────────────────────────┐
       │  ⏸ 请选择文书模板                             │
       │                                               │
       │  ─── 推荐 ───                                  │
       │  ● 解除劳动合同通知书                          │
       │  ○ 解除合同协议（通用）                        │
       │  ○ 终止合作关系函                              │
       │                                               │
       │  ▴ 收起                                       │
       │                                               │
       │  搜索: [_____________]   分类: [全部 ▾]        │
       │                                               │
       │  ┌────────────────────────────────────────┐   │
       │  │ ○ 民事起诉状（公民提起民事诉讼用）       │   │
       │  │   起诉·应诉·上诉                         │   │
       │  │ ○ 民事答辩状（...）                     │   │
       │  │   起诉·应诉·上诉                         │   │
       │  │ ○ 申请财产保全书                        │   │
       │  │   保全·冻结·先予执行                     │   │
       │  │ ○ ...（滚动加载）                        │   │
       │  └────────────────────────────────────────┘   │
       │                                               │
       │             [使用此模板]                       │
       └──────────────────────────────────────────────┘
```

零召回兜底：助手 LLM 一个候选都没召回时，**直接进入展开状态**，搜索框为空、列表按"用户最近使用"排序。

### Mockup B · 合同立场选择卡片

```
用户：帮我审一下这份合同 [contract.docx]
助手：好的，开始审查...

       ┌──────────────────────────────────────────────┐
       │  ⏸ 请确认审查立场                             │
       │                                               │
       │  以哪一方的视角审查 contract.docx？             │
       │                                               │
       │  ○ 甲方（保护甲方利益）                        │
       │  ● 乙方（保护乙方利益）                        │
       │  ○ 中立（客观分析双方）                        │
       │                                               │
       │  甲方名称（可选）: [阿里云_______]            │
       │  乙方名称（可选）: [我方_________]            │
       │                                               │
       │            [开始审查] [取消]                   │
       └──────────────────────────────────────────────┘
```

### Mockup C · 合同审查工具结果卡片

```
       ┌──────────────────────────────────────────────┐
       │  ✓ 已完成审查 contract.docx                   │
       │  甲方：阿里云 / 乙方：我方                      │
       │  风险：高 2 / 中 3 / 低 1                       │
       │  Top 风险：① 终止条款 / ② 责任分配 / ③ 违约金 │
       │  [打开合同审查工作台]                          │
       └──────────────────────────────────────────────┘
```

### Mockup D · 文书起草工具结果卡片

```
       ┌──────────────────────────────────────────────┐
       │  ✓ 已完成起草《民事起诉状》                    │
       │  字数 1,280 · 摘要: 原告张三诉被告李四...      │
       │  [在文书页继续编辑]                            │
       └──────────────────────────────────────────────┘
```

### Mockup E · 顶部来源条（文书页 / 合同工作台共用）

```
┌──────────────────────────────────────────────────┐
│ ← 返回 通用问答                       [+ 关联案件]  │
├──────────────────────────────────────────────────┤
│   （原有的文书编辑器 / 合同审查工作台界面）         │
└──────────────────────────────────────────────────┘
```

已关联状态显示「已关联 · 张三诉李四案 [更换]」。

### Mockup F · 关联案件 Dialog

```
┌─────────────────────────────────────┐
│  关联到案件                         │
├─────────────────────────────────────┤
│  搜索: [____________________]       │
│                                     │
│  ○ 张三诉李四 合同纠纷              │
│  ○ 王五工伤赔偿案                   │
│  ● 李四诉张三 名誉权                │
│  ○ 赵六劳动争议案                   │
│                                     │
│  ⓘ 仅显示进行中案件（不含已归档/删除） │
│                                     │
│  [取消]              [确认关联]      │
└─────────────────────────────────────┘
```

---

## 四、现状与盲点

### 已就位的基建（不重复造）

| 项 | 现状 | 文件 |
|---|---|---|
| `SSECustomEventType.DRAFT_SAVED` / `CONTRACT_REVIEW_SAVED` | 阶段 1 已预留 + payload 接口已声明 | `shared/types/agentEvent.ts:43-64` |
| `publishCustomEvent(event)` | 通用桥接已就位 | `server/services/agent/agentEventBridge.ts:124` |
| `assistantMain` 节点（id=15）| DB 已有，当前 tools=`["search_law"]`，无 skills 关联 | `prisma/seeds/seedData.sql:1077` |
| 通用问答 vertical | createAgent 路径，自动跑全栈中间件 + 自动挂 4 个 skill 工具 + skills middleware | `server/agents/legal-assistant/agent.config.ts` |
| `documentDraft.service.createDraftService` | 字段已含 `caseId`（默认 null） | `server/agents/document/documentDraft.service.ts:49` |
| `documentTemplates` 表 | scope=global / user，category 9 大类枚举，用户配额 20 | `prisma/models/document.prisma:2` |
| `DOCUMENT_CATEGORIES` 枚举 | 9 大类 + label 已定义 | `shared/types/document.ts:9` |
| `listDocumentTemplatesDAO` | 已支持 scope / category / q / 分页 + 用户维度过滤 | `server/agents/document/documentTemplate.dao.ts:101` |
| `runDocumentChat` / `runContractReviewChat` | 流式 `Promise<ReadableStream>` | `agent.config.ts` 双 vertical |
| `ToolContext` 类型 | 已有 `caseId? / runId? / sessionId / userId / draftId? / reviewId?` | `server/services/agent-platform/tools/types.ts:36` |
| `AiToolRenderer.toolMap` 注入机制 | 已就位但 0 业务在用 | `app/components/ai/AiToolRenderer.vue:21` |
| 16 张工具卡片样例 | 可仿写 props 协议 | `app/components/ai/tools/SaveAnalysisResultTool.vue` |

### 空白 / 需新建

| 项 | 处理 |
|---|---|
| 子代理工具 `draft_document` / `review_contract` | 新增 2 个 tool 文件 + 注册到 `tools/index.ts` |
| 子代理 stream drain helper | `server/services/agent-platform/subAgent/runAndDrain.ts` |
| **interrupt 透传机制（前后端）** | spec §4.3 的"interrupt 注册表"原本在阶段 7，本阶段提前实现部分（template_select / stance_select 两类） |
| 模板推荐 service | `server/agents/document/templateRecommend.service.ts`（两层匹配） |
| 案件选择 Dialog 组件 | `app/components/cases/CaseLinkerDialog.vue` |
| `PATCH /api/v1/assistant/document/drafts/:id { caseId }` | 现有 PATCH 只支持 `values`，扩展 `caseId` 字段 |
| `PATCH /api/v1/assistant/contract/reviews/:id { caseId }` | 全新接口 |
| 文书页 / 合同工作台顶部"来源条"区块 | 抽 `DraftSourceBar.vue` / `ReviewSourceBar.vue` 子组件 |
| 工具卡片：`DraftDocumentCard.vue` / `ReviewContractCard.vue` | `app/components/agents/document/tools/` 与 `app/components/agents/contract/tools/` |
| Interrupt 卡片：`TemplateSelectCard.vue` / `StanceSelectCard.vue` | `app/components/agents/document/interrupts/` 与 `app/components/agents/contract/interrupts/` |
| 通用问答 chat panel toolMap + interruptMap 注入 | 改 `AssistantChatPanel.vue` |

---

## 五、任务拆分（按 vertical 分组，14 个 Task）

### 子组 1 · 后端工具与 interrupt 后端（teammate **tools-impl**）

**Task 1 · sub-agent stream drain helper**
- 新建 `server/services/agent-platform/subAgent/runAndDrain.ts`
- 提供 `runAndDrainStream(stream): Promise<{ finalState, success, interrupt? }>`
- 负责消费整个 ReadableStream + 解析最后的 values 事件 + 错误兜底 + interrupt 检测
- 单测：成功 drain / 中途错误 / cancel 信号 / 检测到 interrupt 即返回

**Task 2 · 模板推荐 service**
- 新建 `server/agents/document/templateRecommend.service.ts`
- 入参：`{ userId, intent, keywords?, categoryHint? }`
- 算法：
  - 第一层（categoryHint 缩范围）：如果 LLM 给了 categoryHint，先在该 category 内召回
  - 第二层（兜底跨类）：如类内召回 < 3 个，跨全部分类（含 global + 用户私人）召回
  - 评分：name×10 + desc×5 + category×3，按 keyword 累加；用户最近 30 天用过的 +8；priority 排序
  - 返回前 5 个 + total（全库总数，给"浏览全部"按钮显示用）
- 单测覆盖各召回路径

**Task 3 · `draft_document` 工具实现**
- 新建 `server/services/agent-platform/tools/draftDocument.tool.ts`
- schema：`{ intent: string, keywords?: string[], category?: DocumentCategoryKey, additionalContext?: string }`
- 流程：
  1. 调 templateRecommend 拿候选 → publishCustomEvent 触发"模板选择 interrupt"
  2. **暂停等用户在卡片选**（通过 interrupt resume 机制）
  3. 收到用户选定的 templateId → createDraftService → runDocumentChat → drain
  4. publishCustomEvent(DRAFT_SAVED)
  5. 返回 LLM `{ success, draftId, title, summary, href }`
- 单测：mock interrupt resume + drain

**Task 4 · `review_contract` 工具实现**
- 新建 `server/services/agent-platform/tools/reviewContract.tool.ts`
- schema：`{ ossFileId: number, partyAHint?: string, partyBHint?: string }`（**不要求 LLM 提供 stance**）
- 流程：
  1. 创建 review 记录（stance 留空）
  2. publishCustomEvent 触发"立场选择 interrupt"，payload 含 `partyAHint/partyBHint`
  3. 收到用户选定的 `{ stance, partyA, partyB }` → 写入 review 记录 → runContractReviewChat → drain
  4. publishCustomEvent(CONTRACT_REVIEW_SAVED)
  5. 返回 LLM
- 关键依赖：`runContractReviewChat` 加可选参数 `{ skipStanceInterrupt?: true }`，当 review.stance 已落库时跳过原有 stance interrupt
- 单测：mock interrupt resume + drain

**Task 5 · 注册工具 + ToolContext 透传 + interrupt 后端机制**
- `server/services/agent-platform/tools/index.ts` 注册 2 个新工具
- 实现 sub-agent interrupt 透传：子代理工具内部 `interrupt({ type: 'template_select' | 'stance_select', payload })` → LangGraph 主 agent 透出
- 验证 ToolContext.runId 在 createAgent 路径正确传到工具
- 主代理 SSE 把 interrupt 事件透到前端

### 子组 2 · 关联案件后端 API（teammate **admin-api**）

**Task 6 · `PATCH /api/v1/assistant/document/drafts/:id { caseId }`**
- 修改 `server/api/v1/assistant/document/drafts/[id].patch.ts` 接受 `caseId?: number | null`
- service：`linkDraftToCaseService(draftId, userId, caseId)`：校验 case 归属（owner-only）+ 校验 draft 归属 + 校验 case 状态≠archived/deleted + 写入
- 单测：归属校验 / 解绑（caseId=null）/ 跨用户拒绝 / 已归档案件拒绝

**Task 7 · `PATCH /api/v1/assistant/contract/reviews/:id { caseId }`**
- 新建 `server/api/v1/assistant/contract/reviews/[id].patch.ts`
- 同 Task 6 的归属校验 + 状态校验 + 写入
- 单测同上

**Task 8 · 用户端「我的进行中案件」列表 API**
- 新建 `GET /api/v1/cases/active`（如不存在，确认是否复用现有）
- 返回 `{ id, title }[]`，过滤 deletedAt + status=active
- 提供搜索参数 `q`（title 子串）

### 子组 3 · 前端工具卡片 + interrupt 卡片 + 案件 Dialog（teammate **frontend-cards**）

**Task 9 · `CaseLinkerDialog.vue`**
- 新建 `app/components/cases/CaseLinkerDialog.vue`
- props: `{ open, currentCaseId?, onConfirm: (caseId: number | null) => Promise<void> }`
- 列出"我的进行中案件"+ 搜索框 + 单选 + 确认按钮
- 复用 shadcn Dialog（注意 z-index 与外层 Sheet 共存）
- 单测：选择 + 确认 callback / 取消 / 搜索过滤

**Task 10 · `TemplateSelectCard.vue` + `StanceSelectCard.vue`（interrupt 卡片）**
- 新建：
  - `app/components/agents/document/interrupts/TemplateSelectCard.vue` — 推荐 + 浏览全部双态（按 Mockup A / A2）
  - `app/components/agents/contract/interrupts/StanceSelectCard.vue`（按 Mockup B）
- props: `{ interrupt: { type, payload }, onResolve: (value: any) => Promise<void> }`
- 状态：未操作 / 提交中 / 已确认（disabled）
- TemplateSelectCard 内部：默认显示 payload.recommendations；展开后调 `GET /api/v1/assistant/document/templates`（已有接口），分页/搜索/分类筛选

**Task 11 · `DraftDocumentCard.vue` + `ReviewContractCard.vue`（结果卡片）**
- 新建：
  - `app/components/agents/document/tools/DraftDocumentCard.vue`（按 Mockup D）
  - `app/components/agents/contract/tools/ReviewContractCard.vue`（按 Mockup C）
- 仿现有 `SaveAnalysisResultTool.vue` props 协议：`{ toolName, input?, output?, state }`
- 状态：执行中（spinner + 文案）/ 已完成（结果数据）/ 失败
- 跳转按钮：`navigateTo(href)`

### 子组 4 · 前端跳转协议 + 顶部条 + 注入（teammate **frontend-pages**）

**Task 12 · 文书页顶部"来源条"**
- 修改 `app/pages/dashboard/document/drafts/[id].vue`
- 解析 `route.query.from / caseId / sessionId`
- 抽子组件 `app/components/agents/document/DraftSourceBar.vue`（也复用给阶段 6）
- 顶部按 Mockup E 渲染：左侧返回链接 + 右侧"+ 关联案件"按钮
- 关联按钮 → 打开 CaseLinkerDialog → confirm 后调 PATCH 接口 + toast

**Task 13 · 合同工作台顶部"来源条" + assistant chat panel 注入**
- 先确认合同工作台路径（`app/pages/dashboard/assistant/contract/[id].vue` 或相近）
- 同 Task 12 模式 + 抽 `app/components/agents/contract/ReviewSourceBar.vue` 子组件
- 修改 `app/components/assistant/AssistantChatPanel.vue`（或对应入口）：
  - 把 4 张新卡片（2 工具结果卡 + 2 interrupt 卡）通过 `toolMap + interruptMap` 注入 `AiToolRenderer`
  - 监听 SSE custom 事件 DRAFT_SAVED / CONTRACT_REVIEW_SAVED，更新对应工具卡 output

### 主 lead 收尾

**Task 14 · seedData + node_skills 同步 + 集成 + 回归 + E2E**
- `prisma/seeds/seedData.sql`：
  - `nodes` 表 id=15 的 tools 改成 `["search_law", "draft_document", "review_contract"]`
  - `node_skills` 表 INSERT 6 行（id=15, 6 个 skill code，幂等 ON CONFLICT）
- 一次性同步脚本 `scripts/stage5-apply-assistant-config.ts`（仿 stage 4，PrismaPg 适配）
- 防回退测试 `tests/server/agent-platform/nodeSkills.assistant.test.ts`
- 回归脚本 `scripts/stage5-regression.sh`
- E2E 1 / E2E 2 smoke（自起 dev server + chrome-devtools）
- 出 handoff `docs/superpowers/notes/2026-04-XX-stage5-to-stage6-handoff.md`
- 打 tag `ai-unify-stage-5-done`

---

## 六、完成定义（DoD）

- [ ] `draft_document` / `review_contract` 工具注册到 `tools/index.ts`
- [ ] `assistantMain` 节点 tools = `["search_law", "draft_document", "review_contract"]`
- [ ] `assistantMain` node_skills 关联 6 个 skill
- [ ] 4 张前端卡片（2 工具结果卡 + 2 interrupt 卡）就位 + 通过 toolMap/interruptMap 注入
- [ ] `CaseLinkerDialog.vue` 就位，文书页 / 合同工作台两处都能调起并成功 PATCH
- [ ] 跳转协议 `?from=&caseId=&sessionId=` 在两个独立页落地，「返回通用问答」可恢复 session
- [ ] 2 个 PATCH 接口 + 用户端归属校验 + 已归档案件拒绝
- [ ] 模板推荐 service 单测覆盖各路径
- [ ] interrupt 透传链路（子代理 → 主代理 → SSE → 前端 → resume）端到端通
- [ ] E2E 1（文书）+ E2E 2（合同）smoke 全过
- [ ] `stage5-regression.sh` 全绿
- [ ] tag `ai-unify-stage-5-done` + handoff note

---

## 七、风险 / 约束

- **interrupt 透传是新基建**，spec §4.3 原本排在阶段 7，本阶段提前实现 2 类（template_select / stance_select）。后续阶段 7 全局收敛时再扩展到通用注册表
- contract vertical 增加 `skipStanceInterrupt` 选项需向后兼容，default `false`
- `runAndDrainStream` 用于合同分析时可能 30-60s 延迟，前端工具卡"执行中"态要有 loading 动画
- 通用问答 `useAssistantChat` 内核保留（阶段 7 收敛目标），本阶段只在 chat panel 加 toolMap/interruptMap prop
- 模板推荐的 keywords 来自 LLM，零信任（可能为空），算法必须能在零关键词下也能回退到"用户最近使用 + priority 排序"
