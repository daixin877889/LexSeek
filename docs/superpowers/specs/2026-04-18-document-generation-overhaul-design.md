# 文书生成体验升级（Overhaul）

> 日期：2026-04-18
> 状态：Draft
> 相关 spec：[2026-04-17-document-generation-design.md](./2026-04-17-document-generation-design.md)

## 背景

文书生成模块上线后用户反馈 7 个问题，分为 3 类：

| 分类 | 问题 |
| --- | --- |
| **布局/体验重构** | #5 左右分栏 + 悬浮 Agent 窗、#2 材料弹框对齐、#3 手填入口、#4 Agent 对话可见 |
| **功能缺口** | #1 草稿持久化与二次进入（多轮修改） |
| **Bug** | #6 我的文书模板页上传无反馈且不显示、#7 AI 分析完预览占位符未替换 |

本 spec 统一处理这 7 个问题。bug 类不预判根因，实施阶段以 spike 形式先定位再修。

## 目标 / 非目标

**目标**
- 文书生成支持多轮修改：生成后退出、再次进入同一草稿继续改并重新导出
- 左右分栏工作区 + 悬浮 Agent 窗，用户可手填也可调 AI 帮填
- 材料选择走弹框，复用"我的云盘"避免重复上传
- Agent 过程对用户可见（对话流、思考、工具状态均呈现）
- 修复 #6/#7 bug（根因待定位）

**非目标**
- 多会话管理（本次仅单会话，结构预留扩展点）
- 协同编辑 / 版本历史
- 模板市场 / 模板审核流

## 信息架构

```
/dashboard/document                  首页：新建 + 我的草稿列表
/dashboard/document/drafts/:id       草稿工作区（左表单 + 右预览 + 悬浮 Agent）
/dashboard/document/templates        我的文书模板（管理页，已有，不改）
```

### /dashboard/document 首页改版

两区布局：

- **顶部「新建文书」卡片**：内嵌 `DocumentTemplatePicker`；用户选中模板后立即 `POST /api/v1/assistant/document/drafts`（不再强制先输材料，body 可仅含 `templateId`），拿到 `draftId` 即 `navigateTo(/dashboard/document/drafts/{draftId})`
- **「我的草稿」列表**：最近 10 条草稿（列：模板名 / 关联案件 / 更新时间 / 状态 / 操作[进入|删除]）；分页；点击"进入"跳 `/dashboard/document/drafts/:id`
- **入口按钮**：顶部右上角保留「管理我的模板」跳 `/dashboard/document/templates`

### 草稿工作区 `/dashboard/document/drafts/:id`

```
┌─────────────────────────────────────────────────────┐
│ [← 返回] 模板名 · 关联案件    [✨ AI 生成] [导出 .docx] │
├──────────────────┬──────────────────────────────────┤
│                  │                                   │
│   左：字段表单    │     右：实时预览                  │
│   DocumentField  │     DocumentPreview               │
│   Form           │     (docx-preview)                │
│                  │                                   │
│                  │                                   │
└──────────────────┴──────────────────────────────────┘
                                  ┌── 悬浮 Agent 窗 ──┐
                                  │   AiChat          │
                                  └───────────────────┘
                                     [✨ 悬浮按钮]
```

- **左表单**：复用现有 `DocumentFieldForm`；用户可手填；每次 `@change` 走 debounce 500ms `PATCH /drafts/:id`（现有 `useDocumentDraft.onFieldChange`）
- **右预览**：复用 `DocumentPreview`（修复 #7 后占位符会正确替换）
- **顶部「✨ AI 生成」按钮**：主操作按钮位，点击 = 打开悬浮 Agent 窗
- **不再强制 `DocumentSourceInput`**：材料输入改为 Agent 窗内的 `AiPromptInput`（走弹框选文件），手填路径可完全绕开 Agent

## 悬浮 Agent 窗

**复用**：`CaseChatWindowShell` + `AiChat`（与小索同款），底部悬浮 Icon 按钮可收起 / 展开。

### 会话模型

- **单会话起步，结构预留多会话**：
  - 新增 composable `useDocumentAgent(draftId)`，内部管理 `currentSessionId`、消息、队列、中断
  - UI 层只消费 `messages / send / stop / queue / interrupt`，不直接持有 sessionId
  - 后端保留 `documentSessions`（1:N draft→session 的表结构；当前业务约束 1:1 但 schema 不加 unique）
  - 未来加多会话：①composable 返回 `sessions[]` + `switchSession`；②标题栏挂 `CaseSessionListPopover`；③后端新增 sessions CRUD API（无需迁移 schema）
- **消息持久化**：复用 LangGraph checkpointer，页面重进时 `submit(undefined)` 回放历史
- **队列**：复用 `chatQueueActions` + `AiChatQueueChips`（用户可连续提要求入队）
- **中断确认**：复用 `CaseInterruptConfirmation` Dialog

### 值回灌

后端 `draftResultPersistenceMiddleware` 在字段值更新时发送 SSE `draft_update` 事件（已具备）→ `useDocumentAgent.handleCustomEvent` 捕获 → 更新 `draft.values` → 左表单自动刷新。

### 文件上传

Agent 窗内 `AiPromptInput` 保持 `:enable-file-upload="true"` + `:on-file-button-click`，走弹框选择。

## 材料弹框（#2）

**完全照抄 `app/pages/dashboard/cases/create.vue`**：

```vue
<AiPromptInput
  ref="promptInputRef"
  :enable-file-upload="true"
  :on-file-button-click="openMaterialSelector"
  @submit="handleAiSubmit"
/>
<CaseAnalysisMaterialSelector
  ref="materialSelectorRef"
  :disabled-file-ids="selectedFileIds"
  @files-selected="handleFilesFromSelector"
/>
```

- `openMaterialSelector = () => materialSelectorRef.value?.openDialog()`
- `handleFilesFromSelector = (files) => promptInputRef.value?.addFiles(files)`
- **不造新组件**，现有 `caseAnalysis/materialSelector.vue` 已是"我的云盘列表 + 上传"完整实现，不限 caseId
- 如需把文件类型白名单改窄，后续加 prop 透出

## 草稿持久化与恢复（#1）

### 已有基础
- `documentDrafts` 表已记录 `templateId / values / sessionId / caseId / status / metadata`
- `GET /drafts` 已支持按用户 + caseId 分页查询
- `GET /drafts/:id` 已返回单条草稿详情

### 需新增
- 前端 `/dashboard/document` 首页 "我的草稿" 列表组件（消费 `GET /drafts`）
- 前端 `/dashboard/document/drafts/:id` 工作区页面：`onMounted` 调 `GET /drafts/:id` + `GET /templates/:id` 加载已有草稿和模板，挂载 Agent session 走 checkpointer 回放
- `POST /drafts` body 的 `sourceText` / `sourceFileIds` 改为可选（当前已可选，确认 zod schema 不变）
- `DELETE /drafts/:id`（软删除，用于首页列表的"删除"操作）——如不存在需新增

### 退出与回放
- 工作区页面无"完成"按钮，任何时候离开都保留当前 state
- 二次进入：`/dashboard/document/drafts/:id` 直接加载最新 `values` + checkpointer 历史消息
- 导出后仍保留草稿（`status='exported'`），允许再次改 + 导出

## Bug 修复策略（#6 / #7）

不预判根因。实施阶段作为两个独立 spike：

1. **复现 → 定位**：chrome-devtools 抓请求响应 + Vue DevTools 看状态；docx 样本 dump DOM 看占位符拆分情况
2. **拿到根因后和用户确认修复方向**：再动代码
3. **修完补测试覆盖**：至少一个 e2e 用例

## 实施顺序

1. #6 spike：定位上传成功但列表无反馈的根因 → 报告 → 确认方向 → 修 + 测试
2. #7 spike：定位占位符未替换的根因 → 报告 → 确认方向 → 修 + 测试
3. 新建路由骨架：`/dashboard/document/drafts/:id` 页面 + 补齐缺失 API（`DELETE /drafts/:id` 若需要）
4. `/dashboard/document` 首页改版：`DraftList` 组件 + 新建区整合
5. 工作区页面：左表单 / 右预览骨架 + 加载态 + 返回 / 导出
6. 悬浮 Agent 窗：新 composable `useDocumentAgent(draftId)` + `CaseChatWindowShell` 接入 + 队列 / 中断
7. 「AI 生成」按钮联动：点击打开窗口 + 材料弹框集成
8. E2E：选模板 → 建草稿 → 退出 → 从列表回来 → 手填 + AI 填 → 导出

每步独立可验证，间隙跑一次 `npx vitest run` + `npx nuxi typecheck`。

## 数据模型（无新增字段）

当前 `documentDrafts` / `documentSessions` / `documentTemplates` schema 可直接复用。如 spike 定位的 bug 需加字段（例如 `documentTemplates.placeholders_normalized`）再议。

## 测试

- **单元**：`useDocumentAgent` 的队列 / 中断 / 值回灌逻辑
- **集成**：`GET /drafts/:id` 的权限与数据完整性
- **E2E**（Playwright）：上述第 8 步的全链路
- **回归**：现有 `DocumentDraftPanel` 测试（在案件详情页仍挂载）保持通过

## 迁移与兼容

- 旧入口 `/dashboard/document` 的 "提供材料" 单页流改为 "新建 + 草稿列表"——若用户已在途中（浏览器里开着 idle 页面），刷新即进入新流
- `caseDetail` 页的文书 tab 继续复用 `DocumentDraftPanel`——本次 spec **只改独立场景**（无 caseId），案件场景的分栏改造留给下一轮
