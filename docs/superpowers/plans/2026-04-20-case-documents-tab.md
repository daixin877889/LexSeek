# 案件文书 Tab 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/dashboard/cases/:id?tab=documents` 从"模板选择向导"重构为"本案件文书列表 + Sheet 新建入口"，并在概览 Tab 新增"案件文书"板块；清理孤儿组件 `DocumentDraftPanel` 与 `DocumentSourceInput`。

**Architecture:** 在 `useCaseDetail` composable 新增 `drafts` 响应式数据源，`cases/[id].vue` 父级持有 Sheet 实例并根据 `activeView` 写入 `returnTab` URL 参数；`DraftHistory` 扩展为"可受控"组件支持外部 items；新建的 `CaseDetailDocuments`、`DocumentTemplatePickerSheet` 都是轻量包装器；编辑页 `drafts/[id].vue` 读 `route.query.returnTab` 白名单决定返回目标 Tab。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Vitest + Tailwind CSS v4 + shadcn-vue

**Spec:** [2026-04-20-case-documents-tab-design.md](../specs/2026-04-20-case-documents-tab-design.md)

---

## 文件清单

**新增：**
- `app/components/caseDetail/CaseDetailDocuments.vue`
- `app/components/assistant/document/DocumentTemplatePickerSheet.vue`

**修改：**
- `shared/types/document.ts` — 新增 `DraftRow` 接口
- `app/components/assistant/document/DraftHistory.vue` — 扩展 props 支持受控模式 + caseId 过滤
- `app/composables/useCaseDetail.ts` — 新增 `drafts` / `refreshDrafts`
- `app/pages/dashboard/cases/[id].vue` — documents 分支改渲染 + 父级 Sheet + 文案
- `app/components/caseDetail/CaseDetailOverview.vue` — 新增"案件文书"板块
- `app/pages/dashboard/document/drafts/[id].vue` — 返回按钮读 returnTab
- `app/components/assistant/contract/ContractDocxPreview.vue` — 更新注释

**删除：**
- `app/components/assistant/document/DocumentDraftPanel.vue`
- `app/components/assistant/document/DocumentSourceInput.vue`

**测试：**
- `tests/client/components/DraftHistory.test.ts`（新增）

---

### Task 1: `DraftRow` 类型提升至 shared

**Files:**
- Modify: `shared/types/document.ts`
- Modify: `app/components/assistant/document/DraftHistory.vue` — 删除 local interface，改为 import

目的：`DraftRow` 接口会被 `DraftHistory`、`useCaseDetail`、`CaseDetailDocuments`、`CaseDetailOverview` 共用。统一 source-of-truth。

- [ ] **Step 1: 在 shared/types/document.ts 末尾追加 DraftRow 接口**

打开 `shared/types/document.ts`，在文件末尾（现有最后一个导出之后）追加：

```typescript
// ==================== 文书草稿行（列表视图专用） ====================
/**
 * 文书草稿列表视图数据结构
 *
 * 与 GET /api/v1/assistant/document/drafts 返回的 items 元素对齐。
 * 仅含列表渲染与跳转所需字段，不是 Prisma row 全量。
 */
export interface DraftRow {
    id: number
    title: string
    templateId: number
    templateName: string | null
    caseId: number | null
    status: string
    updatedAt: string
}
```

- [ ] **Step 2: DraftHistory.vue 删除内部 interface，改为 import**

编辑 `app/components/assistant/document/DraftHistory.vue`。

**原代码（第 11-23 行）：**

```ts
import { EyeIcon, FileTextIcon, Loader2Icon, Trash2Icon } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import { toast } from 'vue-sonner'

interface DraftRow {
    id: number
    title: string
    templateId: number
    templateName: string | null
    caseId: number | null
    status: string
    updatedAt: string
}
```

**改为：**

```ts
import { EyeIcon, FileTextIcon, Loader2Icon, Trash2Icon } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { DraftRow } from '#shared/types/document'
```

- [ ] **Step 3: 运行 typecheck 验证导入正确**

```bash
npx nuxi typecheck 2>&1 | tail -5
```

Expected: 无新增错误（原有的 unimport WARN 可忽略）。

- [ ] **Step 4: Commit**

```bash
git add shared/types/document.ts app/components/assistant/document/DraftHistory.vue
git commit -m "refactor(types): 提升 DraftRow 至 shared/types/document

为后续多组件共用准备"
```

---

### Task 2: `DraftHistory` 扩展为可受控模式

**Files:**
- Modify: `app/components/assistant/document/DraftHistory.vue`
- Create: `tests/client/components/DraftHistory.test.ts`

目的：原 `DraftHistory` 内部自拉 drafts；扩展后支持父组件外部传入 `items`（案件场景下由 `useCaseDetail` 持有共享状态），并支持按 `caseId` 过滤 + 隐藏"关联案件"列。

- [ ] **Step 1: 写失败测试 — props 新契约**

新建 `tests/client/components/DraftHistory.test.ts`：

```typescript
/**
 * DraftHistory 组件测试
 *
 * 验证点：
 * - 传入 items 时不调用 API（受控模式）
 * - 未传 items 时内部自拉（兼容独立文书页）
 * - hideCaseColumn=true 时不渲染"关联案件"列
 * - 有 caseId 时空态文案为"本案件还没有文书..."
 * - 无 caseId 时空态文案为"还没有历史文书..."
 */

import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DraftHistory from '~/components/assistant/document/DraftHistory.vue'

// 用 hoisted 变量 + vi.mock，避免 Nuxt 自动导入问题
const { useApiFetchMock, toastMock } = vi.hoisted(() => ({
    useApiFetchMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
}))
vi.stubGlobal('useApiFetch', useApiFetchMock)
vi.stubGlobal('navigateTo', vi.fn())
vi.stubGlobal('useFormatters', () => ({ formatDate: (v: string) => v }))
vi.stubGlobal('useAlertDialogStore', () => ({ showErrorDialog: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast: toastMock }))

const commonStubs = {
    Loader2Icon: { template: '<span />' },
    FileTextIcon: { template: '<span />' },
    Trash2Icon: { template: '<span />' },
    EyeIcon: { template: '<span />' },
    Table: { template: '<div><slot /></div>' },
    TableHeader: { template: '<div><slot /></div>' },
    TableBody: { template: '<div><slot /></div>' },
    TableRow: { template: '<div><slot /></div>' },
    TableHead: { template: '<div><slot /></div>' },
    TableCell: { template: '<div><slot /></div>' },
    Button: { template: '<button><slot /></button>' },
    NuxtLink: { template: '<a><slot /></a>' },
    GeneralPagination: { template: '<div />' },
}

describe('DraftHistory', () => {
    it('传入 items 时不调用 API', async () => {
        useApiFetchMock.mockClear()
        mount(DraftHistory, {
            props: {
                items: [
                    { id: 1, title: '起诉状', templateId: 10, templateName: '起诉状模板', caseId: null, status: 'ready', updatedAt: '2026-04-20' },
                ],
            },
            global: { stubs: commonStubs },
        })
        await flushPromises()
        expect(useApiFetchMock).not.toHaveBeenCalled()
    })

    it('未传 items 时内部自拉', async () => {
        useApiFetchMock.mockClear()
        useApiFetchMock.mockResolvedValue({ items: [], total: 0 })
        mount(DraftHistory, { global: { stubs: commonStubs } })
        await flushPromises()
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts',
            expect.objectContaining({ query: expect.any(Object) }),
        )
    })

    it('caseId 传入时查询带 caseId', async () => {
        useApiFetchMock.mockClear()
        useApiFetchMock.mockResolvedValue({ items: [], total: 0 })
        mount(DraftHistory, {
            props: { caseId: 41 },
            global: { stubs: commonStubs },
        })
        await flushPromises()
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts',
            { query: expect.objectContaining({ caseId: 41 }) },
        )
    })

    it('有 caseId 时空态文案变化', () => {
        const w = mount(DraftHistory, {
            props: {
                items: [],
                loading: false,
                caseId: 41,
            },
            global: { stubs: commonStubs },
        })
        expect(w.text()).toContain('本案件还没有文书')
    })

    it('无 caseId 时保留原空态文案', () => {
        const w = mount(DraftHistory, {
            props: { items: [], loading: false },
            global: { stubs: commonStubs },
        })
        expect(w.text()).toContain('还没有历史文书')
    })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/client/components/DraftHistory.test.ts --reporter=verbose
```

Expected: FAIL（组件尚未支持 items / caseId / 条件空态文案）。

- [ ] **Step 3: 改造 DraftHistory.vue — 扩展 props 与逻辑**

打开 `app/components/assistant/document/DraftHistory.vue`。

**A. 删除原 `displayName` 之前的 state 声明（第 25-31 行 `loading/drafts/pagination`），改为：**

```ts
const props = defineProps<{
    /** 外部传入列表数据；未传则组件内部自拉 */
    items?: DraftRow[]
    /** 外部控制 loading 态（仅受控模式有效） */
    loading?: boolean
    /** 按 caseId 过滤（仅内部自拉模式有效） */
    caseId?: number
    /** 隐藏"关联案件"列（桌面表格） */
    hideCaseColumn?: boolean
}>()

const emit = defineEmits<{
    /** 删除完成（父组件据此触发刷新） */
    changed: []
}>()

const { formatDate } = useFormatters()

const innerLoading = ref(false)
const innerDrafts = ref<DraftRow[]>([])
const pagination = ref({ page: 1, pageSize: 10, total: 0 })

/** 是否受控：有 items prop 即受控 */
const controlled = computed(() => props.items !== undefined)

/** 对外暴露的列表 / loading 来源 */
const drafts = computed(() => (controlled.value ? (props.items ?? []) : innerDrafts.value))
const loading = computed(() => (controlled.value ? !!props.loading : innerLoading.value))

const isDesktop = useMediaQuery('(min-width: 768px)')
```

**B. 改造 `loadDrafts` — 受控时跳过**

```ts
async function loadDrafts() {
    if (controlled.value) return  // 受控模式由父组件刷新
    innerLoading.value = true
    try {
        const skip = (pagination.value.page - 1) * pagination.value.pageSize
        const query: Record<string, number> = {
            skip,
            take: pagination.value.pageSize,
        }
        if (props.caseId != null) query.caseId = props.caseId
        const result = await useApiFetch<{ items: DraftRow[]; total: number }>(
            '/api/v1/assistant/document/drafts',
            { query },
        )
        if (result) {
            innerDrafts.value = result.items
            pagination.value.total = result.total
        }
    } finally {
        innerLoading.value = false
    }
}

onMounted(() => {
    if (!controlled.value) loadDrafts()
})
```

**C. 改造 `handleDelete` — 受控时 emit changed，自控时本地刷新**

```ts
async function handleDelete(row: DraftRow) {
    const alertDialogStore = useAlertDialogStore()
    alertDialogStore.showErrorDialog({
        title: '确认删除',
        message: `确认删除「${titleLabel(row)}」？删除后无法恢复。`,
        confirmText: '确认删除',
        cancelText: '取消',
        onConfirm: async () => {
            const ok = await useApiFetch(
                `/api/v1/assistant/document/drafts/${row.id}`,
                { method: 'DELETE' },
            )
            if (ok !== null) {
                toast.success('已删除')
                if (controlled.value) emit('changed')
                else loadDrafts()
            }
        },
    })
}
```

**D. 模板 — 空态文案按 caseId 分支**

找到原空态 `<div v-else-if="!drafts.length" ...>` 段（`还没有历史文书...`），改为：

```vue
<div
    v-else-if="!drafts.length"
    class="flex flex-col items-center justify-center py-10 text-muted-foreground"
>
    <FileTextIcon class="size-10 mb-2 opacity-40" />
    <p class="text-sm">
        {{ caseId != null ? '本案件还没有文书，点「+ 新建文书」开始' : '还没有历史文书，去「文书模板」开始吧' }}
    </p>
</div>
```

**E. 模板 — 桌面表格的"关联案件"列条件渲染**

找到原 `<TableHead class="w-[120px]">关联案件</TableHead>`，改为：

```vue
<TableHead v-if="!hideCaseColumn" class="w-[120px]">关联案件</TableHead>
```

找到对应 `<TableCell>{{ row.caseId ? ... }}</TableCell>`，改为：

```vue
<TableCell v-if="!hideCaseColumn">{{ row.caseId ? `#${row.caseId}` : '—' }}</TableCell>
```

**F. 模板 — 分页控件仅在非受控时显示**

找到 `<GeneralPagination v-if="drafts.length" ...>`，改为：

```vue
<GeneralPagination
    v-if="!controlled && drafts.length"
    :current-page="pagination.page"
    :page-size="pagination.pageSize"
    :total="pagination.total"
    @change="changePage"
/>
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/client/components/DraftHistory.test.ts --reporter=verbose
```

Expected: 5/5 PASS。

- [ ] **Step 5: 运行 typecheck**

```bash
npx nuxi typecheck 2>&1 | tail -5
```

Expected: 无新增错误。

- [ ] **Step 6: 回归 — 独立文书页仍能自拉**

手动：`bun dev` 启动，访问 `/dashboard/document?tab=history`，应看到全部草稿列表（即使没传 items 也能渲染）。

- [ ] **Step 7: Commit**

```bash
git add app/components/assistant/document/DraftHistory.vue tests/client/components/DraftHistory.test.ts
git commit -m "feat(document): DraftHistory 支持受控模式 + caseId 过滤

新增 props: items / loading / caseId / hideCaseColumn
空态文案按 caseId 分支
删除完成时 emit changed 让父组件刷新"
```

---

### Task 3: `useCaseDetail` 新增 drafts 状态

**Files:**
- Modify: `app/composables/useCaseDetail.ts`

目的：把本案件的文书列表纳入 `useCaseDetail`，让 documents Tab 和 overview 板块共享同一份数据，避免两处各自请求。

- [ ] **Step 1: 追加 drafts 响应式状态与刷新方法**

打开 `app/composables/useCaseDetail.ts`。

**A. 在文件顶部 imports 处新增：**

```ts
import type { DraftRow } from '#shared/types/document'
```

**B. 在 `useCaseDetail` 函数体内、`refreshMaterials` 定义之后、`analysisStatus` 之前插入：**

```ts
  // 文书草稿列表（响应式，按 caseId 过滤）
  const { data: draftsResp, refresh: refreshDrafts } = useApi<{ items: DraftRow[]; total: number }>(
    () => `/api/v1/assistant/document/drafts`,
    { query: computed(() => ({ caseId: id.value, take: 100 })) },
  )
  const drafts = computed<DraftRow[]>(() => draftsResp.value?.items ?? [])
```

**C. 在 `return { ... }` 对象中追加（放在 `refreshAnalysis` 之后）：**

```ts
    drafts,
    refreshDrafts,
```

- [ ] **Step 2: 运行 typecheck 验证**

```bash
npx nuxi typecheck 2>&1 | tail -5
```

Expected: 无新增错误。

- [ ] **Step 3: 手动 smoke-test**

启动 `bun dev`，打开一个有草稿的案件详情页，用浏览器 devtools console 检查 `window.__NUXT__` 或在组件里 `console.log(drafts.value)` 确认数据可加载。不强制。

- [ ] **Step 4: Commit**

```bash
git add app/composables/useCaseDetail.ts
git commit -m "feat(case): useCaseDetail 新增 drafts / refreshDrafts

按 caseId 过滤拉取本案件草稿列表，供文书 Tab 与概览板块共享"
```

---

### Task 4: 新增 `DocumentTemplatePickerSheet` 组件

**Files:**
- Create: `app/components/assistant/document/DocumentTemplatePickerSheet.vue`

目的：Sheet 包装 `TemplateBrowser`，在案件页里弹出用。没有自己的业务逻辑，仅透传。

- [ ] **Step 1: 写新组件**

创建 `app/components/assistant/document/DocumentTemplatePickerSheet.vue`：

```vue
<script setup lang="ts">
/**
 * 文书模板选择 Sheet
 *
 * 案件详情页里点「+ 新建文书」弹出：内嵌 TemplateBrowser；用户选中模板后
 * emit('select', templateId)，由父级负责 POST 创建草稿并跳转。
 *
 * 本组件仅做布局包装，无业务状态。
 */
defineProps<{
    open: boolean
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    select: [templateId: number]
}>()

function onOpenChange(v: boolean) {
    emit('update:open', v)
}

function onSelect(templateId: number) {
    emit('select', templateId)
}
</script>

<template>
    <Sheet :open="open" @update:open="onOpenChange">
        <SheetContent
            side="right"
            class="w-full sm:w-[60vw] sm:max-w-[900px] z-[70] p-0 flex flex-col"
        >
            <SheetHeader class="shrink-0 p-4 border-b">
                <SheetTitle>选择文书模板</SheetTitle>
                <SheetDescription>
                    选中模板后会自动新建草稿并跳转到编辑页
                </SheetDescription>
            </SheetHeader>
            <div class="flex-1 min-h-0 overflow-y-auto p-4">
                <AssistantDocumentTemplateBrowser @select="onSelect" />
            </div>
        </SheetContent>
    </Sheet>
</template>
```

- [ ] **Step 2: 运行 typecheck**

```bash
npx nuxi typecheck 2>&1 | tail -5
```

Expected: 无新增错误。

- [ ] **Step 3: Commit**

```bash
git add app/components/assistant/document/DocumentTemplatePickerSheet.vue
git commit -m "feat(document): 新增 DocumentTemplatePickerSheet

Sheet 包装 TemplateBrowser，供案件详情页复用"
```

---

### Task 5: 新增 `CaseDetailDocuments` 组件

**Files:**
- Create: `app/components/caseDetail/CaseDetailDocuments.vue`

目的：案件详情 Tab 的容器组件。顶部栏（标题 + Badge + 新建按钮）+ 下方 DraftHistory。Sheet 由父级持有（§ 4.1 决议），本组件仅 emit 事件。

- [ ] **Step 1: 写新组件**

创建 `app/components/caseDetail/CaseDetailDocuments.vue`：

```vue
<script setup lang="ts">
/**
 * 案件详情 - 案件文书 Tab
 *
 * 布局对齐 CaseDetailMaterials：
 * - 顶部栏：标题徽章 + 数量 Badge + 「+ 新建文书」按钮
 * - 下方：DraftHistory（受控模式，items 由父级传入）
 *
 * Sheet 不在本组件内持有，而是由 cases/[id].vue 父级统一管理（与 overview 板块共享）。
 */
import { FileEditIcon, PlusIcon } from 'lucide-vue-next'
import type { DraftRow } from '#shared/types/document'

defineProps<{
    caseId: number
    drafts: DraftRow[]
    loading?: boolean
}>()

const emit = defineEmits<{
    /** 点击「+ 新建文书」— 由父级打开 Sheet */
    createDocument: []
    /** DraftHistory 内部删除完成，父级据此刷新 */
    refresh: []
}>()
</script>

<template>
    <div class="h-full overflow-y-auto p-4 md:p-6 space-y-4">
        <!-- 顶部栏 -->
        <header class="flex items-center justify-between gap-2">
            <h2 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
                <FileEditIcon class="size-4" />
                案件文书
                <Badge
                    v-if="drafts.length"
                    variant="secondary"
                    class="font-normal px-1.5 py-0 h-4 text-[10px]"
                >
                    {{ drafts.length }}
                </Badge>
            </h2>
            <button
                class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                title="新建文书"
                @click="emit('createDocument')"
            >
                <PlusIcon class="size-3" />
                <span class="hidden lg:inline">新建文书</span>
            </button>
        </header>

        <!-- 列表 -->
        <AssistantDocumentDraftHistory
            :case-id="caseId"
            :items="drafts"
            :loading="loading"
            hide-case-column
            @changed="emit('refresh')"
        />
    </div>
</template>
```

- [ ] **Step 2: 运行 typecheck**

```bash
npx nuxi typecheck 2>&1 | tail -5
```

Expected: 无新增错误。

- [ ] **Step 3: Commit**

```bash
git add app/components/caseDetail/CaseDetailDocuments.vue
git commit -m "feat(case): 新增 CaseDetailDocuments 组件

案件详情 documents Tab 容器，布局对齐 Materials；
Sheet 由父级 cases/[id].vue 管理"
```

---

### Task 6: `cases/[id].vue` — 父级 Sheet + documents Tab 重构

**Files:**
- Modify: `app/pages/dashboard/cases/[id].vue`

目的：
1. `documents` 分支改渲染 `<CaseDetailDocuments>`
2. 父级挂 `<DocumentTemplatePickerSheet>` + `handleCreateDocument` + `handleTemplateSelect`（POST 时带 caseId，跳转时 returnTab 来自 `activeView`）
3. viewLabelMap `'文书生成'` → `'案件文书'`

- [ ] **Step 1: 从 useCaseDetail 解构 drafts/refreshDrafts**

定位 `app/pages/dashboard/cases/[id].vue` 第 58-83 行 `const { ... } = useCaseDetail(...)`。

**原代码（节选）：**

```ts
const {
  caseInfo,
  materials,
  analysisResults,
  // ...
  toggleMaterialSelection,
} = useCaseDetail(caseId, { ... })
```

**在 `toggleMaterialSelection,` 之前追加两行：**

```ts
  drafts,
  refreshDrafts,
```

- [ ] **Step 2: viewLabelMap 文案修正**

定位第 88-95 行：

```ts
const viewLabelMap: Record<ActiveView, string> = {
  overview: '概览',
  materials: '案件材料',
  analysis: '分析结果',
  todos: '待办事项',
  documents: '文书生成',
  contracts: '合同审查',
}
```

**改为：**

```ts
const viewLabelMap: Record<ActiveView, string> = {
  overview: '概览',
  materials: '案件材料',
  analysis: '分析结果',
  todos: '待办事项',
  documents: '案件文书',
  contracts: '合同审查',
}
```

- [ ] **Step 3: 新增 Sheet 状态与创建/删除处理函数**

在 `onMounted(() => { moduleChatManager.restoreActiveSessions() })` 之前插入：

```ts
// --- 案件文书：Sheet + 创建流程 ---
const documentSheetOpen = ref(false)

function handleCreateDocument() {
  documentSheetOpen.value = true
}

async function handleTemplateSelect(templateId: number) {
  const result = await useApiFetch<{ draftId: number; sessionId: string }>(
    '/api/v1/assistant/document/drafts',
    { method: 'POST', body: { templateId, caseId: caseId.value } },
  )
  if (!result) return
  documentSheetOpen.value = false
  // activeView 当前值作为 returnTab（documents 或 overview）
  const returnTab = activeView.value === 'overview' ? 'overview' : 'documents'
  navigateTo(
    `/dashboard/document/drafts/${result.draftId}`
    + `?from=case&caseId=${caseId.value}&returnTab=${returnTab}`,
  )
}
```

- [ ] **Step 4: documents 分支改渲染 CaseDetailDocuments**

定位第 301-303 行：

```vue
<div v-else-if="activeView === 'documents'" :key="'documents'" class="h-full overflow-y-auto p-4 md:p-6">
  <AssistantDocumentDraftPanel :case-id="caseId" />
</div>
```

**改为：**

```vue
<CaseDetailDocuments
  v-else-if="activeView === 'documents'"
  :key="'documents'"
  :case-id="caseId"
  :drafts="drafts"
  @create-document="handleCreateDocument"
  @refresh="refreshDrafts"
/>
```

- [ ] **Step 5: 在模板末尾挂 Sheet**

定位模板最底部 `<!-- 导出文档弹窗 -->` 块之后（或 `</template>` 之前）添加：

```vue
<!-- 案件文书：模板选择 Sheet（documents Tab + overview 板块共享） -->
<AssistantDocumentDocumentTemplatePickerSheet
  v-model:open="documentSheetOpen"
  @select="handleTemplateSelect"
/>
```

- [ ] **Step 6: 给 overview 绑定 drafts 与新 emit**

定位第 259-276 行的 `<CaseDetailOverview ... />`。

**在 props 末尾追加（`:get-recognition-status` 之后）：**

```vue
  :drafts="drafts"
```

**在事件列表追加（`@go-to-interrupt` 之后）：**

```vue
  @create-document="handleCreateDocument"
```

完整参考（替换原 CaseDetailOverview 标签的 props/emits）：

```vue
<CaseDetailOverview v-if="activeView === 'overview'" :key="'overview'" :case-id="caseId" :analysis-results="analysisResults"
  :module-cards="allModuleCards"
  :show-batch-button="showBatchButton"
  :has-pending-interrupt="hasPendingInterrupt"
  :materials="materials ?? []"
  :disabled-oss-file-ids="disabledOssFileIds"
  :is-adding-materials="isAddingMaterials"
  :file-recognition-status="fileRecognitionStatus"
  :get-recognition-status="getRecognitionStatus"
  :drafts="drafts"
  @navigate-view="navigateToView" @preview-material="openMaterialPreview"
  @navigate-analysis="navigateToAnalysis" @updated="refreshCase"
  @add-materials="addMaterials"
  @delete-materials="deleteMaterials"
  @retry-material="retryMaterial"
  @navigate-to-select-mode="navigateToSelectMode"
  @generate-module="handleGenerateModule"
  @batch-generate="handleBatchGenerate"
  @go-to-interrupt="handleGoToInterrupt"
  @create-document="handleCreateDocument" />
```

- [ ] **Step 7: 运行 typecheck 验证**

```bash
npx nuxi typecheck 2>&1 | tail -10
```

Expected: 无新增错误（`CaseDetailOverview` 暂时会报缺少 drafts prop，因 Task 7 还没写，如报错跳过到下一 step 继续）。如果只是 `CaseDetailOverview` 相关错误，可接受，Task 7 会解决。

- [ ] **Step 8: Commit**

```bash
git add app/pages/dashboard/cases/[id].vue
git commit -m "feat(case): 文书 Tab 改用 CaseDetailDocuments + 父级 Sheet

- documents 分支渲染新的列表组件
- 父级持有模板选择 Sheet，documents/overview 共享
- activeView 写入 returnTab，编辑页读取后可返回正确 Tab
- viewLabelMap 文书生成 → 案件文书"
```

---

### Task 7: `CaseDetailOverview` 新增"案件文书"板块

**Files:**
- Modify: `app/components/caseDetail/CaseDetailOverview.vue`

目的：在分析结果板块之后新增"案件文书"板块；顶部按钮布局对齐 materials 块；列表复用 `DraftHistory`（受控模式 + hideCaseColumn）。

- [ ] **Step 1: 新增 props / emits**

打开 `app/components/caseDetail/CaseDetailOverview.vue`。

**A. 顶部 imports 追加（Task 7 新增）：**

找到第 9-25 行的 `lucide-vue-next` import 列表，加入 `FileEditIcon`：

```ts
import {
  EyeIcon,
  FileTextIcon,
  FileEditIcon,      // 新增：文书板块图标
  FileIcon,
  // ... 其他原有图标保持不变
}
```

**B. 在 `import type` 行之后追加：**

```ts
import type { DraftRow } from '#shared/types/document'
```

**C. 在 defineProps 对象末尾追加（原 `materialsLoading?` 之后）：**

```ts
  materialsLoading?: boolean
  drafts?: DraftRow[]    // 新增
```

**D. 在 defineEmits 对象末尾追加（原 `goToInterrupt` 之后）：**

```ts
  goToInterrupt: []
  createDocument: []     // 新增
```

- [ ] **Step 2: 模板 — 在分析结果之后插入文书板块**

定位文件末尾 `<CaseAnalysisResults ... @view-all="emit('navigateView', 'analysis')" />` 这一段，在它的 **闭合标签之后**、`<!-- 材料选择器弹窗 -->` 之前，插入：

```vue
      <Separator class="mx-4 opacity-50" />

      <!-- 案件文书 -->
      <div class="p-4 flex items-center justify-between pb-0">
        <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
          <FileEditIcon class="size-4" />
          案件文书
          <Badge v-if="(drafts?.length ?? 0) > 0" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">
            {{ drafts!.length }}
          </Badge>
        </h3>
        <div class="flex items-center gap-2 lg:gap-4">
          <button
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            title="新建文书"
            @click="emit('createDocument')"
          >
            <PlusIcon class="size-3" />
            <span class="hidden lg:inline">新建文书</span>
          </button>
          <div v-if="(drafts?.length ?? 0) > 0" class="w-px h-3 bg-border" />
          <button
            v-if="(drafts?.length ?? 0) > 0"
            class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            title="查看全部"
            @click="emit('navigateView', 'documents')"
          >
            <EyeIcon class="size-3" />
            <span class="hidden lg:inline">查看全部</span>
          </button>
        </div>
      </div>

      <div class="p-4 pt-3">
        <AssistantDocumentDraftHistory
          :items="drafts ?? []"
          :loading="false"
          hide-case-column
        />
      </div>
```

> 注意：这里 `DraftHistory` 传入 `items`（即便为空数组也触发受控模式，不会自拉），空态文案不带 caseId 分支（因为组件内 `caseId` prop 未传，回退到通用文案"还没有历史文书..."）。这与 § 4.4 spec 一致——overview 板块不进入"本案件还没有文书"的专属文案。如果要求专属文案，传 `:case-id="caseId"`，但 spec 未要求，此处不加以免过度设计。

- [ ] **Step 3: 运行 typecheck**

```bash
npx nuxi typecheck 2>&1 | tail -10
```

Expected: 无新增错误。

- [ ] **Step 4: Commit**

```bash
git add app/components/caseDetail/CaseDetailOverview.vue
git commit -m "feat(case): 概览 Tab 新增案件文书板块

位置置于分析结果下方，对齐 materials 块布局；
+ 新建文书 emit createDocument；查看全部 emit navigateView('documents')"
```

---

### Task 8: 编辑页返回按钮读取 returnTab

**Files:**
- Modify: `app/pages/dashboard/document/drafts/[id].vue`

目的：编辑页的返回按钮根据 `draft.caseId` + `route.query.returnTab` 决定跳转目标。无 caseId 时回独立文书页（现有行为）。

- [ ] **Step 1: 改造 goBack 函数**

定位 `app/pages/dashboard/document/drafts/[id].vue:134-136`：

```ts
function goBack() {
    navigateTo('/dashboard/document')
}
```

**改为：**

```ts
function goBack() {
    const cid = caseId.value
    if (cid != null) {
        const returnTab = route.query.returnTab === 'overview' ? 'overview' : 'documents'
        navigateTo(`/dashboard/cases/${cid}?tab=${returnTab}`)
        return
    }
    navigateTo('/dashboard/document')
}
```

（`route` 和 `caseId` 都已在文件顶部定义，无需新增 import。）

- [ ] **Step 2: 改按钮文案与图标（可选但与 spec 文案清单一致）**

定位第 393-396 行：

```vue
<Button variant="ghost" size="sm" @click="goBack">
    <ArrowLeftIcon class="size-4 mr-1" />
    返回
</Button>
```

**改为：**

```vue
<Button variant="ghost" size="sm" @click="goBack">
    <ArrowLeftIcon class="size-4 mr-1" />
    {{ caseId != null ? `返回案件 #${caseId}` : '返回' }}
</Button>
```

- [ ] **Step 3: 第 398-400 行"· 案件 #N"冗余标签可删**

原：

```vue
<span v-if="caseId" class="hidden md:inline text-sm text-muted-foreground">
    · 案件 #{{ caseId }}
</span>
```

按钮文案已包含 caseId，删除此段避免重复。整体删除。

- [ ] **Step 4: 运行 typecheck**

```bash
npx nuxi typecheck 2>&1 | tail -5
```

Expected: 无新增错误。

- [ ] **Step 5: 手动 smoke-test**

启动 `bun dev`：
- 从独立文书页 `/dashboard/document?tab=history` 点一条草稿 → 编辑页 → 点返回 → 回到 `/dashboard/document`（独立页）
- 从案件详情 `?tab=documents` 新建文书 → 编辑页 URL 应带 `&returnTab=documents` → 返回按钮回到 `?tab=documents`
- 从案件详情 `?tab=overview` 新建文书 → URL 应带 `&returnTab=overview` → 返回按钮回到 `?tab=overview`

- [ ] **Step 6: Commit**

```bash
git add app/pages/dashboard/document/drafts/[id].vue
git commit -m "feat(document): 编辑页返回按钮区分来源

draft.caseId 存在时按 route.query.returnTab 白名单（overview|documents）决定跳转；
按钮文案集成 caseId 显示，移除冗余的"· 案件 #N"标签"
```

---

### Task 9: 清理孤儿组件

**Files:**
- Delete: `app/components/assistant/document/DocumentDraftPanel.vue`
- Delete: `app/components/assistant/document/DocumentSourceInput.vue`

目的：`DocumentDraftPanel` 原唯一调用处 `cases/[id].vue:302` 已在 Task 6 被替换；`DocumentSourceInput` 只被 Panel 内部使用，Panel 删后孤立。

- [ ] **Step 1: 再次确认无引用**

```bash
rg "DocumentDraftPanel|AssistantDocumentDraftPanel" app tests --type vue --type ts 2>&1 | head -20
rg "DocumentSourceInput|AssistantDocumentSourceInput" app tests --type vue --type ts 2>&1 | head -20
```

Expected：只剩下 `DocumentDraftPanel.vue` 和 `DocumentSourceInput.vue` 文件本身内部的自我引用（import 自己的子组件）；没有其它业务文件引用。

- [ ] **Step 2: 删除文件**

```bash
rm app/components/assistant/document/DocumentDraftPanel.vue
rm app/components/assistant/document/DocumentSourceInput.vue
```

- [ ] **Step 3: typecheck 验证无断链**

```bash
npx nuxi typecheck 2>&1 | tail -10
```

Expected: 无新增错误（如果报错说明还有地方引用，根据报错定位处理）。

- [ ] **Step 4: Commit**

```bash
git add -A app/components/assistant/document/
git commit -m "chore(document): 清理孤儿组件 DocumentDraftPanel + DocumentSourceInput

案件详情 documents Tab 改造后不再使用；独立文书页也已改走 drafts/:id 直接编辑"
```

---

### Task 10: 更新 `ContractDocxPreview.vue` 注释

**Files:**
- Modify: `app/components/assistant/contract/ContractDocxPreview.vue:8`

目的：原注释"参照 DocumentDraftPanel"指向已删除文件，修正指向实际被参照的 `DocumentPreview`（fetchSeq 机制在那里）。

- [ ] **Step 1: 替换注释行**

定位 `app/components/assistant/contract/ContractDocxPreview.vue` 第 8 行：

```
 * - fetchSeq 机制避免快速切换时过期请求覆盖最新渲染（参照 DocumentDraftPanel）
```

**改为：**

```
 * - fetchSeq 机制避免快速切换时过期请求覆盖最新渲染（参照 DocumentPreview）
```

- [ ] **Step 2: Commit**

```bash
git add app/components/assistant/contract/ContractDocxPreview.vue
git commit -m "docs(contract): 修正 ContractDocxPreview 注释指向

DocumentDraftPanel 已删除，实际参照的是 DocumentPreview"
```

---

### Task 11: 全量验证

目的：确保所有改动没有残留问题。

- [ ] **Step 1: 运行全量单测**

```bash
bun run test 2>&1 | tail -30
```

Expected: 全部 PASS，无新增失败。

- [ ] **Step 2: 运行 typecheck**

```bash
npx nuxi typecheck 2>&1 | tail -10
```

Expected: 仅保留原有 `unimport WARN`（prisma enums 路径），无 TS error。

- [ ] **Step 3: 启动 dev 服务器手动走一遍完整流程**

```bash
bun dev
```

**验证清单（按顺序执行）：**

1. 打开 `/dashboard/cases/41?tab=documents` → 看到本案件草稿列表（或空态"本案件还没有文书..."）
2. 点「+ 新建文书」→ 右侧 Sheet 滑出，展示模板分类列表
3. 选中一个模板 → 自动跳转 `/dashboard/document/drafts/:id`，URL 含 `?from=case&caseId=41&returnTab=documents`
4. 编辑页按钮文案为「返回案件 #41」，点击后回到 `/dashboard/cases/41?tab=documents`
5. 新草稿出现在列表顶部（`useApi` 访问即触发 refresh，或者点"返回"时已自动刷）
6. 切到 `?tab=overview` → 在"分析结果"下方看到"案件文书"板块，展示同样的草稿列表
7. 在 overview 板块点「+ 新建文书」→ Sheet 弹出 → 选模板 → URL 含 `returnTab=overview` → 编辑页返回跳回 `?tab=overview`
8. 在 overview 板块点「查看全部」→ 切到 documents Tab
9. 在列表里点某条草稿 → 跳到 `/dashboard/document/drafts/:id`（无 returnTab query，因为不是新建流程）→ 返回按钮因 `draft.caseId` 存在，默认回 `?tab=documents`
10. 打开独立文书页 `/dashboard/document?tab=history` → 草稿列表正常显示；点一条 → 编辑页 → 返回按钮文案为「返回案件 #X」（若该草稿有 caseId）或「返回」，跳回对应页面。测试**回归**：独立文书页行为无变化。
11. 在 documents Tab 删除一条草稿 → 确认对话框 → 确认 → toast 提示 → 列表自动刷新

- [ ] **Step 4: (可选) 截图对比关键视图**

截 documents Tab、overview 文书板块、Sheet 弹窗、编辑页返回按钮——留存备查。

- [ ] **Step 5: 若有问题，按任务编号回溯定位修复；若无，整个功能完成。**

---

## Self-Review

**1. Spec 覆盖检查：**

| Spec 要求 | 实现任务 |
| --- | --- |
| DraftRow 提升到 shared | Task 1 ✓ |
| DraftHistory 支持 items/loading/caseId/hideCaseColumn | Task 2 ✓ |
| useCaseDetail 加 drafts/refreshDrafts | Task 3 ✓ |
| DocumentTemplatePickerSheet 新组件 | Task 4 ✓ |
| CaseDetailDocuments 新组件 | Task 5 ✓ |
| cases/[id].vue documents 分支改渲染 + 父级 Sheet + viewLabelMap 文案 | Task 6 ✓ |
| CaseDetailOverview 加"案件文书"板块（在 analysis 之后） | Task 7 ✓ |
| drafts/[id].vue 返回按钮读 returnTab 白名单 | Task 8 ✓ |
| 删除 DocumentDraftPanel + DocumentSourceInput | Task 9 ✓ |
| ContractDocxPreview 注释修正 | Task 10 ✓ |

**2. 无占位符：** 全部 step 给出了实际代码/命令/断言，没有 TBD/TODO。

**3. 类型一致性：** `DraftRow` 在 Task 1 定义后，Task 2/3/5/7 均 `import type { DraftRow } from '#shared/types/document'`；`returnTab` 白名单在 Task 6（写入）和 Task 8（读取）两边都是 `'overview' | 'documents'`，兜底为 `'documents'`，一致。
