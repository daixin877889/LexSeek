# 文书生成体验升级（Overhaul）

> 日期：2026-04-18
> 状态：Draft
> 相关 spec：[2026-04-17-document-generation-design.md](./2026-04-17-document-generation-design.md)

## 背景

文书生成模块上线后用户反馈 7 个问题：

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
- 多会话管理（本次仅单会话；代码结构不阻塞未来扩展，但不实现多会话 API/UI）
- 协同编辑 / 版本历史
- 模板市场 / 模板审核流
- **案件详情页（`caseDetail`）内嵌的文书 tab 保持现状**，本次只改独立场景（`/dashboard/document`）

## 信息架构

```
/dashboard/document                  首页：新建 + 我的草稿列表
/dashboard/document/drafts/:id       草稿工作区（左表单 + 右预览 + 悬浮 Agent）
/dashboard/document/templates        我的文书模板（管理页，已有，不改）
```

### /dashboard/document 首页改版

两区布局：

- **顶部「新建文书」卡片**：内嵌现有 `DocumentTemplatePicker`；选中模板后立即 `POST /api/v1/assistant/document/drafts`（body 仅含 `templateId`），拿到 `draftId` 即 `navigateTo(/dashboard/document/drafts/{draftId})`
- **「我的草稿」列表**：消费现有 `GET /api/v1/assistant/document/drafts`，分页复用 `GeneralPagination`；列：模板名 / 关联案件 / 更新时间 / 状态 / 操作[进入|删除]
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
└──────────────────┴──────────────────────────────────┘
                                  ┌── 悬浮 Agent 窗 ──┐
                                  │   AiChat          │
                                  └───────────────────┘
                                     [✨ 悬浮按钮]
```

- **左表单**：复用 `DocumentFieldForm`；用户进入即可直接手填（不依赖 Agent，无需先输材料）；每次 `@change` 走 debounce 500ms `PATCH /drafts/:id`（已有 `useDocumentDraft.onFieldChange` 逻辑，内部用 `useApiFetch`）
- **右预览**：复用 `DocumentPreview`（修复 #7 后占位符正确替换）
- **顶部「✨ AI 生成」按钮**：点击 = 打开悬浮 Agent 窗
- **不再强制 `DocumentSourceInput`**：手填路径可完全绕开 Agent；材料输入改走 Agent 窗内的 `AiPromptInput`

## 悬浮 Agent 窗

**复用**：`CaseChatWindowShell` + `AiChat`（与小索同款），底部悬浮 Icon 可收起 / 展开。

### 不新建 composable

**扩展现有 `useDocumentDraft.ts`**，追加：
- 队列接入：接入 `chatQueueActions`（复用）
- 中断接入：接入 `CaseInterruptConfirmation` 数据流
- `sessionId` 内部化：当前从 `draft.sessionId` 单条读取，不对外暴露切换 API

> 不新增 `useDocumentAgent` —— 现有 `useDocumentDraft` 已持有 `mountStream / onCustomEvent / draft 值回灌 / onStart`，补齐队列和中断即可。

### 多会话预留（仅 schema 层）

- `documentSessions` 表 schema 保留 1:N 结构（不加 unique on draftId）
- **当前不实现**：sessions CRUD API、UI 切换器、composable 的 sessions 数组
- 未来需要时直接在后端加 API + 前端换 composable 返回值，不涉及数据迁移

### 消息持久化

LangGraph checkpointer 已负责；页面重进时由 composable 在 `onMounted` 内部 `submit(undefined)` 触发回放（不在事件处理中调用，无 `immediate` 配置问题）。

### 值回灌

后端 `draftResultPersistenceMiddleware` 发送 SSE `draft_update` 事件（已具备） → composable 的 `handleCustomEvent` 捕获 → 更新 `draft.values` → 左表单自动刷新。

### 队列与中断

- 队列：复用 `chatQueueActions` + `AiChatQueueChips`
- 中断：复用 `CaseInterruptConfirmation` Dialog + `useInterruptToast`

## 材料弹框（#2）

完全照抄 `app/pages/dashboard/cases/create.vue` 的模式，复用 `CaseAnalysisMaterialSelector`（不限 caseId）：

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

**文件类型过滤（用户追加约束）**：需和案件材料白名单一致。落地时先跑通现有组件的默认行为，如白名单不匹配文书场景，再通过给 `CaseAnalysisMaterialSelector` 加 prop 透出（**不改组件内部默认值**）。

## 草稿持久化与恢复（#1）

### 已有基础
- `documentDrafts` 表已记录 `templateId / values / sessionId / caseId / status / metadata`
- `GET /drafts` 已支持按用户 + caseId 分页查询
- `GET /drafts/:id` 已返回单条草稿详情
- `POST /drafts` body 的 `sourceText` / `sourceFileIds` 已为可选（无需改 zod schema）

### 需新增
- 前端 `/dashboard/document` 首页 "我的草稿" 列表组件
- 前端 `/dashboard/document/drafts/:id` 工作区页面
- `DELETE /api/v1/assistant/document/drafts/[id].ts`（软删除，用于首页列表的"删除"操作）

### 退出与回放
- 工作区页面无"完成"按钮，任何时候离开都保留当前 state
- 二次进入：`/dashboard/document/drafts/:id` 在 `onMounted` 加载 `GET /drafts/:id` + `GET /templates/:id`，checkpointer 回放消息
- 导出后仍保留草稿（`status='exported'`），允许再次改 + 导出

## Bug 修复策略（#6 / #7）

不预判根因，两个独立 spike，每个 spike：**复现 → 定位 → 和用户确认修复方向 → 修 + 补一个测试**。

## 数据模型

无新增字段。如 spike 定位的 bug 需加字段，单独走 Prisma schema 修改 + `bun run prisma:migrate`。

## 测试策略

**TDD：每步先写测试再写代码**。
- **后端**：`DELETE /drafts/:id` 权限校验 + 软删除行为的集成测试
- **前端**：`useDocumentDraft` 扩展后的队列 / 中断 / 值回灌单测
- **E2E**（Playwright）：选模板 → 建草稿 → 退出 → 从列表回来 → 手填 + AI 填 → 导出
- **回归**：现有 `DocumentDraftPanel` 测试（案件详情页仍挂载）保持通过

## 交付物

**新增文件**
- `app/pages/dashboard/document/drafts/[id].vue` — 工作区页面
- `app/components/assistant/document/DraftList.vue` — 首页草稿列表
- `server/api/v1/assistant/document/drafts/[id].delete.ts` — 软删除 API

**改动文件**
- `app/pages/dashboard/document/index.vue` — 首页改版（模板选择 + 草稿列表）
- `app/composables/useDocumentDraft.ts` — 扩展队列/中断/draft 恢复
- `app/components/assistant/document/DocumentDraftPanel.vue` — 保留（案件详情页继续用），不改
- `app/components/assistant/document/DocumentPreview.vue` — #7 修复
- `app/pages/dashboard/document/templates.vue` — #6 修复

## 迁移与兼容

- 旧入口 `/dashboard/document` 的 "提供材料" 单页流改为 "新建 + 草稿列表"——用户刷新即进入新流
- 案件详情页的文书 tab 继续用 `DocumentDraftPanel`，**不受本次改动影响**
