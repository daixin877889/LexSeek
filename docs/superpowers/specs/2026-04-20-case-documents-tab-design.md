# 案件文书 Tab 优化设计

> **Goal：** 将案件详情页 `?tab=documents` 从"模板选择向导"改造为"本案件文书列表 + 新建入口"，复用独立文书模块已有组件；同时在概览 Tab 加入"案件文书"板块；清理孤儿组件 `DocumentDraftPanel`/`DocumentSourceInput`。

---

## 1. 背景与问题

### 1.1 现状

- `/dashboard/cases/:id?tab=documents` 当前仅渲染 `<AssistantDocumentDraftPanel :case-id="caseId" />`，即"选模板 → 填材料 → AI 填充 → 编辑"的完整向导。
- 用户进入此 Tab 看不到"本案件已生成哪些文书"，每次都要从头走一遍。
- 独立文书模块 `/dashboard/document` 已具备完整组件：
  - `TemplateBrowser`（分类摊开 + 搜索）
  - `DraftHistory`（桌面表格 / 移动卡片）
  - `drafts/[id].vue`（草稿编辑页：标题/字段/预览/版本/快照/Agent 对话）
- 后端 `GET /api/v1/assistant/document/drafts` 已支持 `caseId` 过滤；`POST /drafts` 已接收 `caseId`。
- 概览 Tab 没有文书相关内容，用户在概览页无法感知本案件的文书产出。

### 1.2 问题

1. 体验割裂：案件 Tab 里的"文书"与独立文书模块的"文书"看到的视图完全不同。
2. 重复轮子：`DocumentDraftPanel` 只在这一处被调用，独立文书模块已不使用；其子组件 `DocumentSourceInput` 也只被 Panel 内部使用。
3. 概览 Tab 信息缺失：`case → overview` 没有文书摘要，与已展示的"材料 / 分析结果"不对称。

---

## 2. 目标

- 案件文书 Tab 默认展示本案件所有文书列表；顶部提供「+ 新建文书」入口。
- 新建文书走弹出层选模板 → 后端创建草稿 → 跳转至 `drafts/:id`。
- 概览 Tab 在"分析结果"下方新增"案件文书"板块，展示全部草稿（对齐 materials/analysis 板块"显示全部"的现状）。
- 编辑页 `drafts/:id` 识别 `draft.caseId` 后常驻"返回案件"链接，并能回到跳转前的 Tab。
- 删除孤儿组件 `DocumentDraftPanel`、`DocumentSourceInput`。
- 案件详情内所有导航/板块文案使用"**案件文书**"。

---

## 3. 架构

### 3.1 路由与视图

```
/dashboard/cases/:id?tab=documents         ← 案件文书 Tab（本次重构）
  顶部: [案件文书 · Badge N]  [+ 新建文书]
  主体: <DraftHistory :case-id="caseId" :items="drafts" :loading />
  弹层: <DocumentTemplatePickerSheet v-model:open @select>

/dashboard/cases/:id?tab=overview          ← 概览 Tab（新增板块）
  ├─ 案件基本信息 (旧)
  ├─ 案件材料    (旧)
  ├─ 分析结果    (旧)
  └─ 案件文书    (新)  顶部: [+ 新建文书] [查看全部]；列表为精简版 DraftHistory

/dashboard/document/drafts/:id             ← 编辑页（新增返回按钮）
  标题栏: [← 返回案件 #caseId]（仅 draft.caseId 存在时显示）
```

底部 Tab 栏顺序不变：`概览 / 材料 / 分析 / 文书 / 合同`。

### 3.2 数据层

在 `useCaseDetail` composable 中新增 `drafts` 状态，与 `materials` / `analysisResults` 同级：

```ts
// 伪代码
const drafts = ref<DraftRow[]>([])

async function loadDrafts() {
  const result = await useApiFetch<{ items: DraftRow[]; total: number }>(
    '/api/v1/assistant/document/drafts',
    { query: { caseId, take: 100 } },
  )
  if (result) drafts.value = result.items
}

// 初始化并行触发
Promise.all([loadMaterials(), loadAnalysisResults(), loadDrafts()])
```

- `cases/[id].vue` 持有 `drafts` 与 `loadDrafts`，分别传给 `CaseDetailOverview` 和 `CaseDetailDocuments`。
- 创建 / 删除后由父组件调用 `loadDrafts()` 刷新，两端视图共享同一份数据。

### 3.3 组件改动

**新增：**

| 文件 | 职责 |
| --- | --- |
| `app/components/caseDetail/CaseDetailDocuments.vue` | 案件文书 Tab 容器：顶部栏 + DraftHistory + Sheet |
| `app/components/assistant/document/DocumentTemplatePickerSheet.vue` | Sheet 包装 TemplateBrowser，emit `select:[templateId]` |

**修改：**

| 文件 | 改动 |
| --- | --- |
| `app/components/assistant/document/DraftHistory.vue` | 新增 `caseId?: number`、`items?: DraftRow[]`、`loading?: boolean`、`hideCaseColumn?: boolean` props；外部传 items 时不自拉；空态文案按 caseId 分支 |
| `app/pages/dashboard/cases/[id].vue` | `tab=documents` 分支改渲染 `<CaseDetailDocuments :case-id>`；`overview` 分支多传 `drafts` 和 `createDocument`/`navigateView` 相关 emit |
| `app/components/caseDetail/CaseDetailOverview.vue` | 分析结果下方新增"案件文书"板块；新增 `documents` prop；emit 新增 `createDocument`、`navigateView('documents')` |
| `app/composables/useCaseDetail.ts` | 新增 `drafts` 状态、`loadDrafts` 方法；暴露给页面 |
| `app/pages/dashboard/document/drafts/[id].vue` | 标题栏左侧新增"← 返回案件 #caseId"链接 |
| `app/components/assistant/contract/ContractDocxPreview.vue` | 第 8 行注释"参照 DocumentDraftPanel" → "参照 DocumentPreview" |

**删除：**

| 文件 | 理由 |
| --- | --- |
| `app/components/assistant/document/DocumentDraftPanel.vue` | 唯一调用处 `cases/[id].vue:302` 本次改动移除；无测试；独立文书页不再使用 |
| `app/components/assistant/document/DocumentSourceInput.vue` | 只被 `DocumentDraftPanel` 内部使用，Panel 删后孤立 |

**不动：**

- 后端所有接口（`drafts.get/post/delete`）已满足诉求。
- `DocumentFieldForm`、`DocumentPreview`、`useDocumentDraft`：`drafts/[id].vue` 仍在使用。

---

## 4. 组件契约

### 4.1 `CaseDetailDocuments.vue`

```ts
props: {
  caseId: number
  drafts: DraftRow[]
  loading: boolean
}
emits: {
  createDocument: []   // 点击「+ 新建文书」时触发，由父级打开 Sheet
  refresh: []          // 删除后触发，父级调用 loadDrafts
}
```

**模板结构：**

```
<div class="p-4 md:p-6 space-y-4">
  <header class="flex items-center justify-between">
    <h2 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
      <FileEditIcon class="size-4" />
      案件文书
      <Badge v-if="drafts.length">{{ drafts.length }}</Badge>
    </h2>
    <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" @click="$emit('createDocument')">
      <PlusIcon class="size-3" /> 新建文书
    </button>
  </header>

  <AssistantDocumentDraftHistory
    :case-id="caseId"
    :items="drafts"
    :loading="loading"
    hide-case-column
    @changed="$emit('refresh')"
  />
</div>
```

**Sheet 不由本组件持有。** Sheet 与新建→POST→跳转的完整流程放在 `cases/[id].vue` 父级（与 overview 板块共享），避免两套 Sheet 状态。

### 4.2 `DocumentTemplatePickerSheet.vue`

```ts
props: {
  open: boolean
}
emits: {
  'update:open': [value: boolean]
  'select': [templateId: number]
}
```

**模板结构：**

```vue
<Sheet :open @update:open="(v) => $emit('update:open', v)">
  <SheetContent side="right" class="w-full sm:w-[60vw] sm:max-w-[900px] z-[70] p-0 flex flex-col">
    <SheetHeader class="shrink-0 p-4 border-b">
      <SheetTitle>选择文书模板</SheetTitle>
      <SheetDescription>选中模板后会自动新建草稿并跳转到编辑页</SheetDescription>
    </SheetHeader>
    <div class="flex-1 min-h-0 overflow-y-auto p-4">
      <AssistantDocumentTemplateBrowser @select="(id) => $emit('select', id)" />
    </div>
  </SheetContent>
</Sheet>
```

### 4.3 `DraftHistory.vue`（改动）

新增 props：

```ts
defineProps<{
  caseId?: number
  items?: DraftRow[]
  loading?: boolean
  hideCaseColumn?: boolean
}>()
```

**行为变化：**

- 当 `items` 传入：跳过内部 `loadDrafts`，直接用 props 渲染，分页交由父组件决定（简单起见，父传满即可）。
- 当 `caseId` 传入但 `items` 未传：内部 `loadDrafts` 时 query 带上 `caseId`。
- 当 `hideCaseColumn = true`：表格不渲染"关联案件"列。
- 空态文案按 caseId 分支：
  - 有 caseId：「本案件还没有文书，点「+ 新建文书」开始」
  - 无 caseId：保留原文案「还没有历史文书，去「文书模板」开始吧」

删除后需 emit `changed`（命名保留现有语义，父可据此刷新）。

### 4.4 `CaseDetailOverview.vue`（新增板块）

- 在分析结果板块下方、`AlertDialog` 之前新增"案件文书"板块。
- 头部按钮按 materials 模式排布：

```
[📄 案件文书] [Badge N]   [+ 新建文书]  |  [查看全部]
```

- 主体：复用 `DraftHistory`（`hide-case-column`），列表全量展示（对齐 materials 做法）。
- 空态：`<FileTextIcon size-8 opacity-50 /> + "暂无文书"`。
- Emits 新增 `createDocument`、`navigateView('documents')`。
  - 「+ 新建文书」emit `createDocument`，由 `cases/[id].vue` 父级统一打开 Sheet（与 documents Tab 共享 Sheet 实例）。
  - 「查看全部」emit `navigateView('documents')`，父级切换 activeView。

### 4.5 `drafts/[id].vue`（返回链接）

```vue
<NuxtLink
  v-if="draft?.caseId"
  :to="backToCase"
  class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
>
  <ArrowLeftIcon class="size-4" />
  返回案件 #{{ draft.caseId }}
</NuxtLink>
```

```ts
const backToCase = computed(() => {
  const caseId = draft.value?.caseId
  if (!caseId) return '/dashboard/cases'
  const tab = route.query.returnTab && typeof route.query.returnTab === 'string'
    ? route.query.returnTab
    : 'documents'
  return `/dashboard/cases/${caseId}?tab=${tab}`
})
```

位置：标题栏左侧、与现有面包屑同行。

---

## 5. 接口契约（无需改后端）

| 接口 | 用途 | 参数 |
| --- | --- | --- |
| `GET /api/v1/assistant/document/drafts?caseId=X&take=100` | 拉本案件草稿列表 | 已支持 |
| `POST /api/v1/assistant/document/drafts` `{ templateId, caseId }` | 新建草稿，返回 `draftId` | 已支持 |
| `DELETE /api/v1/assistant/document/drafts/:id` | 删除草稿 | 已支持 |

---

## 6. URL 契约

**跳转 Query：** 从案件进入编辑页时：

```
/dashboard/document/drafts/:id?from=case&caseId=:caseId&returnTab=documents
```

**返回规则：**

| `route.query.from` | `route.query.returnTab` | 跳转目标 |
| --- | --- | --- |
| `"case"` | 任意非空字符串 | `/dashboard/cases/:caseId?tab=:returnTab` |
| 其它 | — | `/dashboard/cases/:caseId?tab=documents`（只要 `draft.caseId` 存在） |

> 说明：`returnTab` 机制预留扩展性——以后若从 overview 直接跳编辑页，可带 `returnTab=overview`，自动回到概览。

---

## 7. 文案清单

| 位置 | 文案 |
| --- | --- |
| BottomTabs label | 文书 |
| Documents Tab 标题 | 案件文书 |
| Overview 板块标题 | 案件文书 |
| Sheet 标题 / 描述 | 选择文书模板 / 选中模板后会自动新建草稿并跳转到编辑页 |
| 新建按钮 | 新建文书 |
| 查看全部按钮 | 查看全部 |
| 空态（有 caseId） | 本案件还没有文书，点「+ 新建文书」开始 |
| 空态（无 caseId，独立文书页） | 还没有历史文书，去「文书模板」开始吧（保持现状） |
| 编辑页返回链接 | 返回案件 #{caseId} |

---

## 8. 测试

- **单元：**
  - `DraftHistory.vue`：验证 `caseId` 传参走 query、`items` 传入时不自拉、`hideCaseColumn` 隐藏列、空态文案分支
  - `DocumentTemplatePickerSheet.vue`：select emit 透传
- **E2E（手工）：**
  - 进入 `/dashboard/cases/N?tab=documents` → 看到本案件草稿列表
  - 点「+ 新建文书」→ Sheet 弹出 → 选模板 → 跳到 `drafts/:id?from=case&...`
  - 编辑页点「返回案件」→ 回到 `/dashboard/cases/N?tab=documents`
  - 进入 `/dashboard/cases/N?tab=overview` → "案件文书"板块展示同样的列表
  - overview 点「查看全部」→ 切到 documents Tab
  - 进入 `/dashboard/document`（独立文书页）行为不变（DraftHistory 空 items 仍自拉）

## 9. 回滚策略

本次改动均为 UI 层：

- 保留 `useDocumentDraft`、`DocumentFieldForm`、`DocumentPreview`（编辑页依赖，不动）
- 仅新增路由 Query 参数，现有直链 `/drafts/:id` 依然工作（返回按钮按 `draft.caseId` 兜底）
- 若需回滚，`git revert` 单次提交即可恢复原 `DocumentDraftPanel` 调用与孤儿组件
