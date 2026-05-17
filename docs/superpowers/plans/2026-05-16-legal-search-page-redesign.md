# 法律法规检索页改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `~/Downloads/ui_kits/dashboard/LegalSearchPage.jsx` 设计稿重做 `/dashboard/legal` 检索 + 列表页 UI，并补齐设计稿新增的热门检索、结果排序、检索耗时三个元素。

**Architecture:** 纯前端改造。新增一个共用的 `StatusBadge.vue` 徽章组件；检索 composable 加排序参数与计时；检索面板、桌面表格、移动卡片、页面本体按设计稿重做模板与样式。后端 `legal/list.get.ts` 已支持 `sortBy/sortOrder`，仅前端接通。状态徽章用项目现有 Tailwind 调色板（蓝/绿/琥珀/灰），不动全局 CSS。

**Tech Stack:** Nuxt 4 + Vue 3 `<script setup>` + Tailwind CSS v4 + shadcn-vue。图标用 `lucide-vue-next`。

**关键约定（务必遵守）:**
- 系统 UI 禁止 emoji，一律 lucide SVG 图标。
- shadcn `app/components/ui/` 组件禁止修改。
- 业务组件需显式 import；Vue 响应式 API（`ref`/`computed`/`watch` 等）自动导入，无需 import。
- 类型检查用 `bun run typecheck`（不要用 `tsc`）。
- 设计文档：`docs/superpowers/specs/2026-05-16-legal-search-page-redesign-design.md`。

---

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `app/components/legal-search/StatusBadge.vue` | 统一的类型/状态徽章（4 色调） | 新建 |
| `shared/types/legal-search.ts` | `LegalSearchFilters` 增加排序字段 | 修改 |
| `app/composables/useLegalSearch.ts` | 加排序参数、检索耗时、`setSort` 方法 | 修改 |
| `app/composables/useArticleSearch.ts` | 加检索耗时 | 修改 |
| `app/components/legal-search/UnifiedSearchPanel.vue` | 检索面板（Tab/输入/筛选）重做 | 重写模板+脚本 |
| `app/components/legal-search/LegalList.vue` | 桌面表格 + 底部分页重做 | 重写模板+脚本 |
| `app/components/legal-search/LegalListMobile.vue` | 移动端卡片重做 | 重写模板+脚本 |
| `app/pages/dashboard/legal/index.vue` | 页头、热门检索、结果区标题/排序/耗时、法条卡片 | 重写 |

---

## Task 1: 新增 StatusBadge 徽章组件

**Files:**
- Create: `app/components/legal-search/StatusBadge.vue`

- [ ] **Step 1: 创建 StatusBadge.vue**

写入 `app/components/legal-search/StatusBadge.vue`，完整内容：

```vue
<template>
    <span class="inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium leading-5"
        :class="toneClass">
        <slot />
    </span>
</template>

<script lang="ts" setup>
/**
 * 法律法规检索通用状态徽章
 * 用于类型徽章（法律/行政法规/司法解释/指导意见）与生效状态徽章（现行有效/尚未生效/已失效）
 */

type BadgeTone = 'info' | 'success' | 'warn' | 'muted'

interface Props {
    /** 色调 */
    tone?: BadgeTone
}

const props = withDefaults(defineProps<Props>(), {
    tone: 'info',
})

/** 色调 → Tailwind 类（亮/暗双色安全） */
const TONE_CLASS: Record<BadgeTone, string> = {
    info: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-300',
    success: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-300',
    warn: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-300',
    muted: 'bg-muted text-muted-foreground border-border',
}

const toneClass = computed(() => TONE_CLASS[props.tone])
</script>
```

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 无新增报错（项目原有报错忽略）。

- [ ] **Step 3: 提交**

```bash
git add app/components/legal-search/StatusBadge.vue
git commit -m "feat(ui): 新增法律法规检索通用状态徽章组件"
```

---

## Task 2: useLegalSearch 加排序参数与检索耗时

**Files:**
- Modify: `shared/types/legal-search.ts`
- Modify: `app/composables/useLegalSearch.ts`

- [ ] **Step 1: `LegalSearchFilters` 增加排序字段**

在 `shared/types/legal-search.ts` 中，找到 `LegalSearchFilters` 接口，把它整体替换为：

```typescript
/** 法律法规搜索筛选条件 */
export interface LegalSearchFilters {
    /** 搜索关键词 */
    keyword: string
    /** 法律类型 */
    type: LegalType | null
    /** 发文机关（单选） */
    issuingAuthority: string | null
    /** 生效状态（all: 全部, valid: 现行有效, pending: 尚未生效, invalid: 已失效） */
    validityStatus: ValidityStatusFilter
    /** 发布日期起始 */
    publishDateFrom: string | null
    /** 发布日期结束 */
    publishDateTo: string | null
    /** 排序字段 */
    sortBy: 'publishDate' | 'effectiveDate' | 'name' | 'createdAt'
    /** 排序方向 */
    sortOrder: 'asc' | 'desc'
}
```

- [ ] **Step 2: `UseLegalSearchReturn` 接口增加 `searchElapsed` 与 `setSort`**

在 `app/composables/useLegalSearch.ts` 中，找到 `UseLegalSearchReturn` 接口。

把这一行：

```typescript
    issuingAuthorities: Ref<string[]>
```

替换为：

```typescript
    issuingAuthorities: Ref<string[]>
    /** 检索耗时（秒） */
    searchElapsed: Ref<number>
```

把这一行：

```typescript
    setPage: (page: number) => void
```

替换为：

```typescript
    setPage: (page: number) => void
    setSort: (sortBy: LegalSearchFilters['sortBy'], sortOrder: LegalSearchFilters['sortOrder']) => void
```

- [ ] **Step 3: 新增 `searchElapsed` 响应式状态**

找到 `const issuingAuthorities = ref<string[]>([])` 这一行，在它下面新增一行：

```typescript
    const issuingAuthorities = ref<string[]>([])
    const searchElapsed = ref(0)
```

- [ ] **Step 4: 初始 `filters` 增加排序默认值**

找到初始 `filters` 定义，整体替换为：

```typescript
    // 筛选条件
    const filters = ref<LegalSearchFilters>({
        keyword: '',
        type: null,
        issuingAuthority: null,
        validityStatus: 'all',
        publishDateFrom: null,
        publishDateTo: null,
        sortBy: 'publishDate',
        sortOrder: 'desc',
    })
```

- [ ] **Step 5: `search()` 加计时与排序参数**

在 `search` 函数内，找到：

```typescript
        try {
            loading.value = true
            clearError()
```

替换为：

```typescript
        try {
            loading.value = true
            clearError()
            const startTime = performance.now()
```

接着找到查询参数构建部分的结尾：

```typescript
            if (filters.value.publishDateTo) {
                query.publishDateTo = filters.value.publishDateTo
            }
```

替换为：

```typescript
            if (filters.value.publishDateTo) {
                query.publishDateTo = filters.value.publishDateTo
            }
            query.sortBy = filters.value.sortBy
            query.sortOrder = filters.value.sortOrder
```

接着找到响应处理块：

```typescript
            if (response) {
                // 为每个项目计算有效性
                legalList.value = response.items.map(item => ({
                    ...item,
                    isValid: computeIsValid(item),
                }))
                pagination.value = {
                    page: response.page,
                    pageSize: response.pageSize,
                    total: response.total,
                    totalPages: response.totalPages,
                }
            }
```

替换为：

```typescript
            if (response) {
                // 为每个项目计算有效性
                legalList.value = response.items.map(item => ({
                    ...item,
                    isValid: computeIsValid(item),
                }))
                pagination.value = {
                    page: response.page,
                    pageSize: response.pageSize,
                    total: response.total,
                    totalPages: response.totalPages,
                }
                searchElapsed.value = (performance.now() - startTime) / 1000
            }
```

- [ ] **Step 6: `resetFilters()` 增加排序默认值**

找到 `resetFilters` 函数内的 `filters.value = {...}` 赋值，整体替换为：

```typescript
        filters.value = {
            keyword: '',
            type: null,
            issuingAuthority: null,
            validityStatus: 'all',
            publishDateFrom: null,
            publishDateTo: null,
            sortBy: 'publishDate',
            sortOrder: 'desc',
        }
```

- [ ] **Step 7: 新增 `setSort` 方法**

找到 `setPage` 函数定义（`const setPage = (page: number) => {...}`），在它之后、`refresh` 之前新增：

```typescript
    /**
     * 设置排序并重新检索
     */
    const setSort = (sortBy: LegalSearchFilters['sortBy'], sortOrder: LegalSearchFilters['sortOrder']) => {
        filters.value.sortBy = sortBy
        filters.value.sortOrder = sortOrder
        pagination.value.page = 1
        search()
    }
```

- [ ] **Step 8: return 暴露 `searchElapsed` 与 `setSort`**

找到 return 语句中的：

```typescript
        issuingAuthorities,
```

替换为：

```typescript
        issuingAuthorities,
        searchElapsed: readonly(searchElapsed),
```

找到 return 语句中的：

```typescript
        setPage,
```

替换为：

```typescript
        setPage,
        setSort,
```

- [ ] **Step 9: 类型检查**

Run: `bun run typecheck`
Expected: 无新增报错。

- [ ] **Step 10: 提交**

```bash
git add shared/types/legal-search.ts app/composables/useLegalSearch.ts
git commit -m "feat(api): 法规检索 composable 支持排序与检索耗时"
```

---

## Task 3: useArticleSearch 加检索耗时

**Files:**
- Modify: `app/composables/useArticleSearch.ts`

- [ ] **Step 1: `UseArticleSearchReturn` 接口增加 `searchElapsed`**

在 `app/composables/useArticleSearch.ts` 中，找到：

```typescript
    filters: Ref<ArticleSearchFilters>
    total: Ref<number>
```

替换为：

```typescript
    filters: Ref<ArticleSearchFilters>
    total: Ref<number>
    /** 检索耗时（秒） */
    searchElapsed: Ref<number>
```

- [ ] **Step 2: 新增 `searchElapsed` 响应式状态**

找到：

```typescript
    const query = ref('')
    const total = ref(0)
```

替换为：

```typescript
    const query = ref('')
    const total = ref(0)
    const searchElapsed = ref(0)
```

- [ ] **Step 3: `searchArticles()` 加计时**

找到：

```typescript
        try {
            loading.value = true
            clearError()
```

替换为：

```typescript
        try {
            loading.value = true
            clearError()
            const startTime = performance.now()
```

找到：

```typescript
            if (response) {
                // 更新状态
                results.value = response.items
                total.value = response.total
            }
```

替换为：

```typescript
            if (response) {
                // 更新状态
                results.value = response.items
                total.value = response.total
                searchElapsed.value = (performance.now() - startTime) / 1000
            }
```

- [ ] **Step 4: return 暴露 `searchElapsed`**

找到 return 语句中的：

```typescript
        total: readonly(total),
```

替换为：

```typescript
        total: readonly(total),
        searchElapsed: readonly(searchElapsed),
```

- [ ] **Step 5: 类型检查**

Run: `bun run typecheck`
Expected: 无新增报错。

- [ ] **Step 6: 提交**

```bash
git add app/composables/useArticleSearch.ts
git commit -m "feat(api): 法条检索 composable 支持检索耗时"
```

---

## Task 4: 重做检索面板 UnifiedSearchPanel.vue

**Files:**
- Modify: `app/components/legal-search/UnifiedSearchPanel.vue`（整体替换文件内容）

- [ ] **Step 1: 整体替换 UnifiedSearchPanel.vue**

把 `app/components/legal-search/UnifiedSearchPanel.vue` 全文替换为：

```vue
<template>
    <div class="bg-card rounded-xl border overflow-hidden">
        <!-- 模式切换 Tab（下划线式） -->
        <div class="flex gap-1 px-4 pt-3.5">
            <button v-for="t in TAB_OPTIONS" :key="t.value" type="button"
                class="mr-3.5 border-b-2 px-1 pb-2 text-sm transition-colors"
                :class="activeTab === t.value
                    ? 'border-primary text-primary font-semibold'
                    : 'border-transparent text-muted-foreground font-medium hover:text-foreground'"
                @click="emit('update:activeTab', t.value)">
                {{ t.label }}
            </button>
        </div>

        <!-- 搜索输入行 -->
        <div class="flex items-center gap-2.5 border-t px-4 py-3.5">
            <Search class="h-5 w-5 shrink-0 text-muted-foreground" />
            <input :value="activeTab === 'legal' ? keyword : articleQuery" :disabled="loading"
                :placeholder="activeTab === 'legal'
                    ? '输入法律名称或文号进行检索，例如：建设工程、民法典…'
                    : '输入法条内容或相关描述进行语义检索，例如：违约金过高如何调整…'"
                class="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
                @input="handleInput" @keyup.enter="handleSearch" />
            <Button class="shrink-0 bg-gradient-brand-button" :disabled="!canSearch || loading" @click="handleSearch">
                <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
                检索
            </Button>
        </div>

        <!-- 筛选条件 -->
        <div class="border-t bg-muted/40 px-4 py-3">
            <!-- 法律类型胶囊组 -->
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs font-semibold text-muted-foreground">法律类型</span>
                <button v-for="lt in LEGAL_TYPE_OPTIONS" :key="lt.value" type="button"
                    class="rounded-md px-3 py-1 text-[13px] transition-colors"
                    :class="internalType === lt.value
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-foreground font-medium hover:bg-muted'"
                    @click="handleTypeChange(lt.value)">
                    {{ lt.label }}
                </button>
            </div>

            <!-- 发文机关 + 生效状态 + 重置 -->
            <div class="mt-3 flex flex-wrap items-center gap-4">
                <!-- 发文机关（仅搜全文） -->
                <div v-if="activeTab === 'legal'" class="flex items-center gap-2">
                    <span class="whitespace-nowrap text-xs font-semibold text-muted-foreground">发文机关</span>
                    <Popover v-model:open="authorityPopoverOpen">
                        <PopoverTrigger as-child>
                            <Button variant="outline" role="combobox" size="sm"
                                class="w-[200px] justify-between px-3 font-normal">
                                <span class="truncate" :class="!issuingAuthority ? 'text-muted-foreground' : ''">
                                    {{ issuingAuthority || '全部机关' }}
                                </span>
                                <ChevronsUpDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent class="w-[300px] p-0" align="start">
                            <!-- 搜索框 -->
                            <div class="border-b p-2">
                                <Input v-model="authoritySearchTerm" placeholder="搜索发文机关..." class="h-8" />
                            </div>
                            <!-- 选项列表 -->
                            <div class="max-h-[250px] overflow-y-auto p-1">
                                <div class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                                    @click="selectAuthority(null)">
                                    <Check class="h-4 w-4" :class="!issuingAuthority ? 'opacity-100' : 'opacity-0'" />
                                    <span>全部机关</span>
                                </div>
                                <Separator class="my-1" />
                                <div v-if="filteredAuthorities.length === 0"
                                    class="py-6 text-center text-sm text-muted-foreground">
                                    未找到匹配的发文机关
                                </div>
                                <div v-for="authority in filteredAuthorities" :key="authority"
                                    class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                                    @click="selectAuthority(authority)">
                                    <Check class="h-4 w-4"
                                        :class="issuingAuthority === authority ? 'opacity-100' : 'opacity-0'" />
                                    <span class="truncate">{{ authority }}</span>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>

                <!-- 生效状态 -->
                <div class="flex items-center gap-2">
                    <span class="whitespace-nowrap text-xs font-semibold text-muted-foreground">生效状态</span>
                    <Select :model-value="internalValidityStatus"
                        @update:model-value="handleValidityStatusChange($event as string)">
                        <SelectTrigger class="w-[140px]">
                            <SelectValue placeholder="选择状态..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="valid">现行有效</SelectItem>
                            <SelectItem value="pending">尚未生效</SelectItem>
                            <SelectItem value="invalid">已失效</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <Button variant="outline" size="sm" class="ml-auto" @click="handleReset">
                    重置筛选
                </Button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Search, ChevronsUpDown, Check, Loader2 } from 'lucide-vue-next'
import type { ValidityStatusFilter } from '#shared/types/legal-search'
import { LegalType } from '#shared/types/legal'

// ==================== Props ====================

interface Props {
    /** 当前激活的 Tab */
    activeTab: 'legal' | 'article'
    /** 搜全文关键词 */
    keyword?: string
    /** 搜法条查询 */
    articleQuery?: string
    /** 法律类型（搜全文） */
    type?: LegalType | null
    /** 法律类型（搜法条） */
    articleType?: LegalType | null
    /** 选中的发文机关 */
    issuingAuthority?: string | null
    /** 生效状态（搜全文） */
    validityStatus?: ValidityStatusFilter
    /** 生效状态（搜法条） */
    articleValidityStatus?: ValidityStatusFilter
    /** 发文机关选项列表 */
    issuingAuthoritiesOptions?: string[]
    /** 加载状态 */
    loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    keyword: '',
    articleQuery: '',
    type: null,
    articleType: null,
    issuingAuthority: null,
    validityStatus: 'valid',
    articleValidityStatus: 'valid',
    issuingAuthoritiesOptions: () => [],
    loading: false,
})

// ==================== Emits ====================

const emit = defineEmits<{
    'update:activeTab': [value: 'legal' | 'article']
    'update:keyword': [value: string]
    'update:articleQuery': [value: string]
    'update:type': [value: LegalType | null]
    'update:articleType': [value: LegalType | null]
    'update:issuingAuthority': [value: string | null]
    'update:validityStatus': [value: ValidityStatusFilter]
    'update:articleValidityStatus': [value: ValidityStatusFilter]
    search: []
    reset: []
}>()

// ==================== 常量 ====================

/** 模式切换 Tab 选项 */
const TAB_OPTIONS = [
    { value: 'legal', label: '搜全文' },
    { value: 'article', label: '搜法条' },
] as const

/** 法律类型筛选选项 */
const LEGAL_TYPE_OPTIONS = [
    { value: 'all', label: '全部' },
    { value: 'law', label: '法律' },
    { value: 'regulation', label: '行政法规' },
    { value: 'judicial_interp', label: '司法解释' },
    { value: 'guideline', label: '指导意见' },
] as const

// ==================== 响应式状态 ====================

/** 发文机关下拉框是否打开 */
const authorityPopoverOpen = ref(false)

/** 发文机关搜索关键词 */
const authoritySearchTerm = ref('')

// ==================== 计算属性 ====================

/** 是否可以搜索 */
const canSearch = computed(() => {
    if (props.activeTab === 'legal') {
        return !!props.keyword?.trim()
    } else {
        return !!props.articleQuery?.trim()
    }
})

/** 筛选后的发文机关列表 */
const filteredAuthorities = computed(() => {
    if (!authoritySearchTerm.value.trim()) {
        return props.issuingAuthoritiesOptions
    }
    const query = authoritySearchTerm.value.toLowerCase()
    return props.issuingAuthoritiesOptions.filter(authority =>
        authority.toLowerCase().includes(query)
    )
})

/** 法律类型内部值 */
const internalType = computed(() => {
    if (props.activeTab === 'legal') {
        return props.type || 'all'
    } else {
        return props.articleType || 'all'
    }
})

/** 生效状态内部值 */
const internalValidityStatus = computed(() => {
    if (props.activeTab === 'legal') {
        return props.validityStatus || 'valid'
    } else {
        return props.articleValidityStatus || 'valid'
    }
})

// ==================== 方法 ====================

/** 处理搜索框输入 */
const handleInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value
    if (props.activeTab === 'legal') {
        emit('update:keyword', value)
    } else {
        emit('update:articleQuery', value)
    }
}

/** 选择发文机关 */
const selectAuthority = (authority: string | null) => {
    emit('update:issuingAuthority', authority)
    authorityPopoverOpen.value = false
    authoritySearchTerm.value = ''
}

/** 处理法律类型变化 */
const handleTypeChange = (val: string) => {
    const newType = val === 'all' ? null : val as LegalType
    if (props.activeTab === 'legal') {
        emit('update:type', newType)
    } else {
        emit('update:articleType', newType)
    }
}

/** 处理生效状态变化 */
const handleValidityStatusChange = (val: string) => {
    const newStatus = val as ValidityStatusFilter
    if (props.activeTab === 'legal') {
        emit('update:validityStatus', newStatus)
    } else {
        emit('update:articleValidityStatus', newStatus)
    }
}

/** 处理搜索 */
const handleSearch = () => {
    if (!canSearch.value) return
    emit('search')
}

/** 处理重置 */
const handleReset = () => {
    authoritySearchTerm.value = ''
    emit('reset')
}
</script>
```

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 无新增报错。

- [ ] **Step 3: 提交**

```bash
git add app/components/legal-search/UnifiedSearchPanel.vue
git commit -m "feat(ui): 法规检索面板按设计稿重做"
```

---

## Task 5: 重做桌面表格 LegalList.vue

**Files:**
- Modify: `app/components/legal-search/LegalList.vue`（整体替换文件内容）

说明：移除组件内原有的「法律法规列表 / 共 N 条」表头（结果计数移到页面级 h2）；类型与生效状态徽章改用 `StatusBadge`；底部分页改为原生按钮，当前页用品牌渐变高亮。

- [ ] **Step 1: 整体替换 LegalList.vue**

把 `app/components/legal-search/LegalList.vue` 全文替换为：

```vue
<template>
    <div class="bg-card rounded-xl border overflow-hidden">
        <!-- 表格内容 -->
        <div class="overflow-x-auto">
            <table class="w-full min-w-[720px]">
                <thead>
                    <tr class="bg-muted/50">
                        <th v-for="h in TABLE_HEADERS" :key="h"
                            class="border-b px-4 py-3 text-left text-xs font-semibold text-muted-foreground">
                            {{ h }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <!-- 加载骨架 -->
                    <template v-if="loading">
                        <tr v-for="i in pageSize" :key="`skeleton-${i}`" class="border-b">
                            <td class="px-4 py-3"><Skeleton class="h-4 w-48" /></td>
                            <td class="px-4 py-3"><Skeleton class="h-4 w-16" /></td>
                            <td class="px-4 py-3"><Skeleton class="h-4 w-24" /></td>
                            <td class="px-4 py-3"><Skeleton class="h-4 w-20" /></td>
                            <td class="px-4 py-3"><Skeleton class="h-4 w-12" /></td>
                        </tr>
                    </template>

                    <!-- 数据行 -->
                    <template v-else-if="items.length > 0">
                        <tr v-for="item in items" :key="item.id"
                            class="cursor-pointer border-b transition-colors hover:bg-muted/50"
                            :class="{ 'bg-muted/30': selectedId === item.id }" @click="handleRowClick(item)">
                            <td class="px-4 py-3" style="max-width: 420px">
                                <div class="font-semibold text-foreground">{{ item.name }}</div>
                                <div v-if="item.documentNumber" class="mt-0.5 text-xs text-muted-foreground">
                                    {{ item.documentNumber }}
                                </div>
                            </td>
                            <td class="px-4 py-3">
                                <LegalSearchStatusBadge :tone="getTypeTone(item.type)">
                                    {{ getTypeLabel(item.type) }}
                                </LegalSearchStatusBadge>
                            </td>
                            <td class="px-4 py-3">
                                <div v-if="item.issuingAuthority" class="flex flex-wrap gap-1">
                                    <span v-for="(authority, index) in parseIssuingAuthorities(item.issuingAuthority)"
                                        :key="index"
                                        class="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                        {{ authority }}
                                    </span>
                                </div>
                                <span v-else class="text-sm text-muted-foreground">-</span>
                            </td>
                            <td class="px-4 py-3 text-sm text-muted-foreground">
                                {{ formatDate(item.effectiveDate) }}
                            </td>
                            <td class="px-4 py-3">
                                <LegalSearchStatusBadge :tone="getValidityTone(item)">
                                    {{ getValidityLabel(item) }}
                                </LegalSearchStatusBadge>
                            </td>
                        </tr>
                    </template>

                    <!-- 空状态 -->
                    <template v-else>
                        <tr>
                            <td colspan="5" class="px-4 py-12 text-center">
                                <div class="flex flex-col items-center justify-center gap-3">
                                    <FileText class="h-12 w-12 text-muted-foreground" />
                                    <div class="text-muted-foreground">
                                        <div class="font-medium">暂无数据</div>
                                        <div class="text-sm">请尝试调整搜索条件</div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>

        <!-- 分页 -->
        <div v-if="!loading && items.length > 0"
            class="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <span class="text-xs text-muted-foreground">
                显示第 {{ (currentPage - 1) * pageSize + 1 }}–{{ Math.min(currentPage * pageSize, total) }} 条，共 {{ total }} 条
            </span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button type="button" :disabled="currentPage <= 1"
                    class="rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(currentPage - 1)">
                    上一页
                </button>
                <template v-for="(page, idx) in visiblePages" :key="idx">
                    <span v-if="page === '...'" class="px-1 text-muted-foreground">…</span>
                    <button v-else type="button"
                        class="min-w-8 rounded-md px-2 py-1.5 text-[13px] transition-colors"
                        :class="page === currentPage
                            ? 'bg-gradient-brand-button font-semibold text-white'
                            : 'border font-medium hover:bg-muted'"
                        @click="handlePageChange(page as number)">
                        {{ page }}
                    </button>
                </template>
                <button type="button" :disabled="currentPage >= totalPages"
                    class="rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(currentPage + 1)">
                    下一页
                </button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { FileText } from 'lucide-vue-next'
import type { LegalListItemWithValidity } from '~/composables/useLegalSearch'
import { LegalType } from '#shared/types/legal'
import LegalSearchStatusBadge from '~/components/legal-search/StatusBadge.vue'
import dayjs from 'dayjs'

// ==================== Props ====================

interface Props {
    /** 列表数据 */
    items: LegalListItemWithValidity[]
    /** 加载状态 */
    loading?: boolean
    /** 总数量 */
    total: number
    /** 当前页码 */
    currentPage: number
    /** 每页数量 */
    pageSize: number
    /** 总页数 */
    totalPages: number
    /** 选中的项目 ID */
    selectedId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
    loading: false,
    selectedId: null,
})

// ==================== Emits ====================

const emit = defineEmits<{
    rowClick: [item: LegalListItemWithValidity]
    pageChange: [page: number]
}>()

// ==================== 常量 ====================

/** 表头列名 */
const TABLE_HEADERS = ['法律名称', '类型', '发文机关', '生效日期', '生效状态']

// ==================== 计算属性 ====================

/** 可见的页码列表 */
const visiblePages = computed(() => {
    const pages: (number | string)[] = []
    const { currentPage, totalPages } = props

    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) {
            pages.push(i)
        }
    } else {
        if (currentPage <= 4) {
            for (let i = 1; i <= 5; i++) {
                pages.push(i)
            }
            pages.push('...')
            pages.push(totalPages)
        } else if (currentPage >= totalPages - 3) {
            pages.push(1)
            pages.push('...')
            for (let i = totalPages - 4; i <= totalPages; i++) {
                pages.push(i)
            }
        } else {
            pages.push(1)
            pages.push('...')
            for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                pages.push(i)
            }
            pages.push('...')
            pages.push(totalPages)
        }
    }

    return pages
})

// ==================== 方法 ====================

/** 获取法律类型标签 */
const getTypeLabel = (type: LegalType): string => {
    const labels: Record<LegalType, string> = {
        law: '法律',
        regulation: '行政法规',
        judicial_interp: '司法解释',
        guideline: '指导意见',
    }
    return labels[type] || type
}

/** 获取法律类型徽章色调 */
const getTypeTone = (type: LegalType): 'info' | 'success' | 'warn' | 'muted' => {
    const tones: Record<LegalType, 'info' | 'success' | 'warn' | 'muted'> = {
        law: 'info',
        regulation: 'success',
        judicial_interp: 'warn',
        guideline: 'muted',
    }
    return tones[type] || 'info'
}

/** 格式化日期 */
const formatDate = (date: string | Date | null): string => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD')
}

/** 获取生效状态标签 */
const getValidityLabel = (item: LegalListItemWithValidity): string => {
    const now = new Date()
    const effectiveDate = item.effectiveDate ? new Date(item.effectiveDate) : null
    const invalidDate = item.invalidDate ? new Date(item.invalidDate) : null
    if (invalidDate && invalidDate <= now) {
        return '已失效'
    }
    if (effectiveDate && effectiveDate > now) {
        return '尚未生效'
    }
    return '现行有效'
}

/** 获取生效状态徽章色调 */
const getValidityTone = (item: LegalListItemWithValidity): 'info' | 'success' | 'muted' => {
    const now = new Date()
    const effectiveDate = item.effectiveDate ? new Date(item.effectiveDate) : null
    const invalidDate = item.invalidDate ? new Date(item.invalidDate) : null
    if (invalidDate && invalidDate <= now) {
        return 'muted'
    }
    if (effectiveDate && effectiveDate > now) {
        return 'info'
    }
    return 'success'
}

/** 解析发文机关（支持全角和半角逗号分隔） */
const parseIssuingAuthorities = (authority: string): string[] => {
    return authority.split(/[,，]/).map(s => s.trim()).filter(s => s.length > 0)
}

/** 处理行点击 */
const handleRowClick = (item: LegalListItemWithValidity) => {
    emit('rowClick', item)
}

/** 处理页码变化 */
const handlePageChange = (page: number) => {
    if (page >= 1 && page <= props.totalPages && page !== props.currentPage) {
        emit('pageChange', page)
    }
}
</script>
```

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 无新增报错。

- [ ] **Step 3: 提交**

```bash
git add app/components/legal-search/LegalList.vue
git commit -m "feat(ui): 法规检索桌面表格按设计稿重做"
```

---

## Task 6: 重做移动端卡片 LegalListMobile.vue

**Files:**
- Modify: `app/components/legal-search/LegalListMobile.vue`（整体替换文件内容）

说明：移除组件内原有的「法律法规 / 共 N 条」头部；卡片圆角 `rounded-xl`，徽章改用 `StatusBadge`；分页逻辑与「加载更多」保持不变，仅按钮换成原生按钮重新配色。

- [ ] **Step 1: 整体替换 LegalListMobile.vue**

把 `app/components/legal-search/LegalListMobile.vue` 全文替换为：

```vue
<template>
    <div class="space-y-3">
        <!-- 加载骨架 -->
        <template v-if="loading">
            <div v-for="i in pageSize" :key="`skeleton-${i}`" class="bg-card rounded-xl border p-4 space-y-3">
                <div class="flex items-start justify-between">
                    <Skeleton class="h-5 w-48" />
                    <Skeleton class="h-6 w-16" />
                </div>
                <Skeleton class="h-4 w-32" />
                <Skeleton class="h-4 w-24" />
            </div>
        </template>

        <!-- 列表项 -->
        <template v-else-if="items.length > 0">
            <div v-for="item in items" :key="item.id"
                class="bg-card rounded-xl border p-4 space-y-3 cursor-pointer transition-colors hover:bg-muted/40"
                :class="{ 'ring-2 ring-primary': selectedId === item.id }" @click="handleItemClick(item)">
                <!-- 标题和类型 -->
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <h4 class="font-semibold leading-tight">{{ item.name }}</h4>
                        <div v-if="item.documentNumber" class="mt-1 text-xs text-muted-foreground">
                            {{ item.documentNumber }}
                        </div>
                    </div>
                    <LegalSearchStatusBadge :tone="getTypeTone(item.type)">
                        {{ getTypeLabel(item.type) }}
                    </LegalSearchStatusBadge>
                </div>

                <!-- 发文机关 -->
                <div v-if="item.issuingAuthority" class="flex flex-wrap gap-1">
                    <span v-for="(authority, index) in parseIssuingAuthorities(item.issuingAuthority)" :key="index"
                        class="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {{ authority }}
                    </span>
                </div>

                <!-- 底部信息 -->
                <div class="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>{{ formatDate(item.effectiveDate) }}</span>
                    <LegalSearchStatusBadge :tone="getValidityTone(item)">
                        {{ getValidityLabel(item) }}
                    </LegalSearchStatusBadge>
                </div>
            </div>
        </template>

        <!-- 空状态 -->
        <template v-else>
            <div class="bg-card rounded-xl border p-8">
                <div class="flex flex-col items-center justify-center gap-3 text-center">
                    <FileText class="h-12 w-12 text-muted-foreground" />
                    <div class="text-muted-foreground">
                        <div class="font-medium">暂无数据</div>
                        <div class="text-sm">请尝试调整搜索条件</div>
                    </div>
                </div>
            </div>
        </template>

        <!-- 分页 -->
        <div v-if="!loading && items.length > 0" class="bg-card rounded-xl border p-4">
            <div class="mb-3 text-center text-sm text-muted-foreground">
                第 {{ currentPage }} / {{ totalPages }} 页，共 {{ total }} 条记录
            </div>
            <div class="flex items-center justify-center gap-1.5">
                <button type="button" :disabled="currentPage <= 1"
                    class="rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(1)">
                    首页
                </button>
                <button type="button" :disabled="currentPage <= 1"
                    class="rounded-md border p-1.5 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(currentPage - 1)">
                    <ChevronLeft class="h-4 w-4" />
                </button>
                <div class="flex items-center gap-2">
                    <Input :model-value="pageInputValue" @update:model-value="handlePageInput"
                        @keyup.enter="handlePageInputConfirm" type="number" :min="1" :max="totalPages"
                        class="w-16 text-center" />
                    <span class="text-sm text-muted-foreground">/ {{ totalPages }}</span>
                </div>
                <button type="button" :disabled="currentPage >= totalPages"
                    class="rounded-md border p-1.5 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(currentPage + 1)">
                    <ChevronRight class="h-4 w-4" />
                </button>
                <button type="button" :disabled="currentPage >= totalPages"
                    class="rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    @click="handlePageChange(totalPages)">
                    末页
                </button>
            </div>
        </div>

        <!-- 加载更多按钮（可选） -->
        <div v-if="showLoadMore && !loading && items.length > 0 && currentPage < totalPages" class="text-center">
            <Button variant="outline" @click="handleLoadMore" :disabled="loadingMore">
                <template v-if="loadingMore">
                    <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                    加载中...
                </template>
                <template v-else>
                    加载更多
                </template>
            </Button>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { FileText, ChevronLeft, ChevronRight, Loader2 } from 'lucide-vue-next'
import type { LegalListItemWithValidity } from '~/composables/useLegalSearch'
import { LegalType } from '#shared/types/legal'
import LegalSearchStatusBadge from '~/components/legal-search/StatusBadge.vue'
import dayjs from 'dayjs'

// ==================== Props ====================

interface Props {
    /** 列表数据 */
    items: LegalListItemWithValidity[]
    /** 加载状态 */
    loading?: boolean
    /** 加载更多状态 */
    loadingMore?: boolean
    /** 总数量 */
    total: number
    /** 当前页码 */
    currentPage: number
    /** 每页数量 */
    pageSize: number
    /** 总页数 */
    totalPages: number
    /** 选中的项目 ID */
    selectedId?: string | null
    /** 是否显示加载更多按钮 */
    showLoadMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    loading: false,
    loadingMore: false,
    selectedId: null,
    showLoadMore: false,
})

// ==================== Emits ====================

const emit = defineEmits<{
    itemClick: [item: LegalListItemWithValidity]
    pageChange: [page: number]
    loadMore: []
}>()

// ==================== 响应式状态 ====================

/** 页码输入值 */
const pageInputValue = ref(props.currentPage.toString())

// ==================== 监听器 ====================

watch(() => props.currentPage, (newPage) => {
    pageInputValue.value = newPage.toString()
})

// ==================== 方法 ====================

/** 获取法律类型标签 */
const getTypeLabel = (type: LegalType): string => {
    const labels: Record<LegalType, string> = {
        law: '法律',
        regulation: '行政法规',
        judicial_interp: '司法解释',
        guideline: '指导意见',
    }
    return labels[type] || type
}

/** 获取法律类型徽章色调 */
const getTypeTone = (type: LegalType): 'info' | 'success' | 'warn' | 'muted' => {
    const tones: Record<LegalType, 'info' | 'success' | 'warn' | 'muted'> = {
        law: 'info',
        regulation: 'success',
        judicial_interp: 'warn',
        guideline: 'muted',
    }
    return tones[type] || 'info'
}

/** 格式化日期 */
const formatDate = (date: string | Date | null): string => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD')
}

/** 获取生效状态标签 */
const getValidityLabel = (item: LegalListItemWithValidity): string => {
    const now = new Date()
    const effectiveDate = item.effectiveDate ? new Date(item.effectiveDate) : null
    const invalidDate = item.invalidDate ? new Date(item.invalidDate) : null
    if (invalidDate && invalidDate <= now) {
        return '已失效'
    }
    if (effectiveDate && effectiveDate > now) {
        return '尚未生效'
    }
    return '现行有效'
}

/** 获取生效状态徽章色调 */
const getValidityTone = (item: LegalListItemWithValidity): 'info' | 'success' | 'muted' => {
    const now = new Date()
    const effectiveDate = item.effectiveDate ? new Date(item.effectiveDate) : null
    const invalidDate = item.invalidDate ? new Date(item.invalidDate) : null
    if (invalidDate && invalidDate <= now) {
        return 'muted'
    }
    if (effectiveDate && effectiveDate > now) {
        return 'info'
    }
    return 'success'
}

/** 解析发文机关（支持全角和半角逗号分隔） */
const parseIssuingAuthorities = (authority: string): string[] => {
    return authority.split(/[,，]/).map(s => s.trim()).filter(s => s.length > 0)
}

/** 处理项目点击 */
const handleItemClick = (item: LegalListItemWithValidity) => {
    emit('itemClick', item)
}

/** 处理页码变化 */
const handlePageChange = (page: number) => {
    if (page >= 1 && page <= props.totalPages && page !== props.currentPage) {
        emit('pageChange', page)
    }
}

/** 处理页码输入 */
const handlePageInput = (value: string | number) => {
    pageInputValue.value = String(value)
}

/** 处理页码输入确认 */
const handlePageInputConfirm = () => {
    const page = parseInt(pageInputValue.value)
    if (!isNaN(page)) {
        handlePageChange(page)
    } else {
        pageInputValue.value = props.currentPage.toString()
    }
}

/** 处理加载更多 */
const handleLoadMore = () => {
    emit('loadMore')
}
</script>
```

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 无新增报错。

- [ ] **Step 3: 提交**

```bash
git add app/components/legal-search/LegalListMobile.vue
git commit -m "feat(ui): 法规检索移动端卡片按设计稿重做"
```

---

## Task 7: 重做页面本体 index.vue

**Files:**
- Modify: `app/pages/dashboard/legal/index.vue`（整体替换文件内容）

说明：新增页头（eyebrow/标题/副标题）、热门检索区、搜全文结果标题行（计数 + 耗时 + 排序下拉）、搜法条结果卡片区。`<script>` 中保留原有 URL 状态同步、生命周期、各 handler，新增热门词常量、排序、法条卡片派生数据。

- [ ] **Step 1: 整体替换 index.vue**

把 `app/pages/dashboard/legal/index.vue` 全文替换为：

```vue
<template>
    <div class="p-4 md:p-6">
        <!-- 页面头部 -->
        <div class="mb-6">
            <!-- <p class="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-primary">
                LEGAL SEARCH · 法律法规检索
            </p> -->
            <h1 class="mb-1 text-2xl font-bold md:text-3xl">法律法规检索</h1>
            <p class="text-sm text-muted-foreground">
                覆盖法律 · 行政法规 · 司法解释 · 指导意见，支持法规全文检索与法条语义检索。
            </p>
        </div>

        <!-- 整合的搜索面板 -->
        <LegalSearchUnifiedSearchPanel v-model:active-tab="activeTab" v-model:keyword="searchKeyword"
            v-model:article-query="articleQuery" v-model:type="searchFilters.type"
            v-model:article-type="articleFilters.legalType" v-model:issuing-authority="searchFilters.issuingAuthority"
            v-model:validity-status="searchFilters.validityStatus"
            v-model:article-validity-status="articleFilters.validityStatus"
            :issuing-authorities-options="legalSearch.issuingAuthorities.value"
            :loading="activeTab === 'legal' ? legalSearch.loading.value : articleSearch.loading.value"
            @search="handleSearch" @reset="handleReset" class="mb-4" />

        <!-- 热门检索 -->
        <div class="mb-6 flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Flame class="h-3.5 w-3.5" />
                热门检索
            </span>
            <button v-for="kw in TRENDING_KEYWORDS" :key="kw" type="button"
                class="bg-card rounded-full border px-3 py-1 text-[12.5px] text-foreground transition-colors hover:bg-muted"
                @click="handleTrendingClick(kw)">
                {{ kw }}
            </button>
        </div>

        <!-- 搜全文结果区域 -->
        <template v-if="activeTab === 'legal' && hasSearchResults">
            <!-- 加载状态 -->
            <div v-if="legalSearch.loading.value" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="legalSearch.legalList.value.length === 0"
                class="bg-card rounded-xl border p-12 text-center">
                <FileText class="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 class="mb-2 text-lg font-medium">未找到相关法律法规</h3>
                <p class="mb-4 text-sm text-muted-foreground">请尝试调整搜索条件</p>
                <Button variant="outline" @click="handleReset">重置筛选</Button>
            </div>

            <!-- 结果列表 -->
            <template v-else>
                <!-- 结果标题行 -->
                <div class="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                    <h2 class="text-base font-semibold">
                        找到 {{ legalSearch.pagination.value.total.toLocaleString() }} 部法律法规（耗时
                        {{ legalSearch.searchElapsed.value.toFixed(2) }} 秒）
                    </h2>
                    <div class="flex items-center gap-2">
                        <span class="whitespace-nowrap text-xs font-semibold text-muted-foreground">排序</span>
                        <Select :model-value="sortValue" @update:model-value="handleSortChange($event as string)">
                            <SelectTrigger class="w-[140px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">
                                    {{ o.label }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <!-- 桌面端表格 -->
                <LegalSearchLegalList :items="legalSearch.legalList.value" :loading="legalSearch.loading.value"
                    :total="legalSearch.pagination.value.total" :current-page="legalSearch.pagination.value.page"
                    :page-size="legalSearch.pagination.value.pageSize"
                    :total-pages="legalSearch.pagination.value.totalPages" :selected-id="selectedLegalId"
                    @row-click="handleLegalSelect" @page-change="handlePageChange" class="hidden md:block" />

                <!-- 移动端卡片 -->
                <LegalSearchLegalListMobile :items="legalSearch.legalList.value" :loading="legalSearch.loading.value"
                    :total="legalSearch.pagination.value.total" :current-page="legalSearch.pagination.value.page"
                    :page-size="legalSearch.pagination.value.pageSize"
                    :total-pages="legalSearch.pagination.value.totalPages" :selected-id="selectedLegalId"
                    @item-click="handleLegalSelect" @page-change="handlePageChange" class="md:hidden" />
            </template>
        </template>

        <!-- 搜法条结果区域 -->
        <template v-if="activeTab === 'article' && hasArticleSearched">
            <!-- 加载状态 -->
            <div v-if="articleSearch.loading.value" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 错误状态 -->
            <div v-else-if="articleSearch.error.value" class="bg-card rounded-xl border p-12 text-center">
                <AlertCircle class="mx-auto mb-4 h-12 w-12 text-destructive" />
                <h3 class="mb-2 text-lg font-medium">搜索失败</h3>
                <p class="mb-4 text-sm text-muted-foreground">{{ articleSearch.error.value }}</p>
                <Button variant="outline" @click="handleArticleRetry">
                    <RefreshCw class="mr-2 h-4 w-4" />
                    重试
                </Button>
            </div>

            <!-- 空状态 -->
            <div v-else-if="articleSearch.results.value.length === 0"
                class="bg-card rounded-xl border p-12 text-center">
                <FileSearch class="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <h3 class="mb-2 text-lg font-medium">未找到相关法条</h3>
                <p class="mb-4 text-sm text-muted-foreground">请尝试使用不同的关键词搜索</p>
                <Button variant="outline" @click="handleReset">重置搜索</Button>
            </div>

            <!-- 结果列表 -->
            <template v-else>
                <h2 class="mb-3 text-base font-semibold">
                    找到 {{ articleSearch.total.value }} 条相关法条 · 按语义相似度排序
                    <span class="ml-1 font-normal text-muted-foreground">
                        （耗时 {{ articleSearch.searchElapsed.value.toFixed(2) }} 秒）
                    </span>
                </h2>
                <div class="flex flex-col gap-3">
                    <div v-for="card in articleCards" :key="card.id"
                        class="bg-card cursor-pointer rounded-xl border p-5 transition-colors hover:bg-muted/40"
                        @click="handleArticleResultClick(card.raw)">
                        <!-- 顶行：类型 + 法条号 + 相似度 -->
                        <div class="mb-2 flex flex-wrap items-center gap-2.5">
                            <LegalSearchStatusBadge :tone="card.typeTone">
                                {{ card.typeLabel }}
                            </LegalSearchStatusBadge>
                            <span v-if="card.articleNo" class="text-[13px] font-semibold text-primary">
                                {{ card.articleNo }}
                            </span>
                            <span v-if="card.similarity"
                                class="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <span class="h-1.5 w-1.5 rounded-full bg-primary" />
                                相似度 {{ card.similarity }}%
                            </span>
                        </div>
                        <!-- 法律名称 -->
                        <h3 class="mb-1 font-semibold">{{ card.raw.legal_name }}</h3>
                        <!-- 章节面包屑 -->
                        <div v-if="card.breadcrumb.length" class="mb-2 text-xs text-muted-foreground">
                            {{ card.breadcrumb.join('  ›  ') }}
                        </div>
                        <!-- 高亮摘录 -->
                        <p class="text-[13.5px] leading-relaxed text-foreground line-clamp-3"
                            v-html="card.excerpt" />
                    </div>
                    <p class="mt-1 text-center text-xs text-muted-foreground">
                        点击法条卡片可查看完整条文与关联案例
                    </p>
                </div>
            </template>
        </template>

        <!-- 法条详情弹框 -->
        <LegalSearchArticleDetailDialog v-model:open="articleDialogOpen" :article="selectedArticle" />
    </div>
</template>

<script lang="ts" setup>
import { Loader2, FileText, AlertCircle, RefreshCw, FileSearch, Flame } from 'lucide-vue-next'
import type { ValidityStatusFilter, ArticleSearchFilters } from '#shared/types/legal-search'
import { VALIDITY_STATUS_FILTERS } from '#shared/types/legal-search'
import type { LawSearchResultItem, LegalType } from '#shared/types/legal'
import LegalSearchArticleDetailDialog from '~/components/legal-search/ArticleDetailDialog.vue'
import LegalSearchLegalList from '~/components/legal-search/LegalList.vue'
import LegalSearchLegalListMobile from '~/components/legal-search/LegalListMobile.vue'
import LegalSearchUnifiedSearchPanel from '~/components/legal-search/UnifiedSearchPanel.vue'
import LegalSearchStatusBadge from '~/components/legal-search/StatusBadge.vue'
import { useArticleSearch } from '~/composables/useArticleSearch'
import { useLegalSearch } from '~/composables/useLegalSearch'
import { useSiteSeo } from '~/composables/useSiteSeo'

// ==================== 页面元数据 ====================

definePageMeta({
    layout: "dashboard-layout",
    title: "法律法规",
})

// ==================== SEO ====================

useSiteSeo({
    title: '法律法规 - 法律检索系统',
    description: '搜索和浏览法律法规全文，支持多维度筛选和法条语义搜索',
    path: '/dashboard/legal',
    noindex: true,
})

// ==================== 常量 ====================

/** 热门检索词（前端固定词表） */
const TRENDING_KEYWORDS = [
    '民法典 合同编',
    '劳动合同法',
    '公司法司法解释（四）',
    '建设工程施工合同 资质',
    '招标投标法',
]

/** 搜全文结果排序选项（仅保留后端支持的字段） */
const SORT_OPTIONS = [
    { value: 'publishDate', label: '按发布日期', sortBy: 'publishDate', sortOrder: 'desc' },
    { value: 'effectiveDate', label: '按生效日期', sortBy: 'effectiveDate', sortOrder: 'desc' },
    { value: 'name', label: '按名称', sortBy: 'name', sortOrder: 'asc' },
] as const

/** 法条号识别正则：以「第…条」开头 */
const ARTICLE_NO_RE = /^第[一二三四五六七八九十百千零〇\d]+条/

/** 法条类型中文名 → 徽章色调 */
const ARTICLE_TYPE_TONE: Record<string, 'info' | 'success' | 'warn' | 'muted'> = {
    '法律': 'info',
    '法规': 'success',
    '司法解释': 'warn',
    '指导意见': 'muted',
}

// ==================== 组合式函数 ====================

const route = useRoute()
const router = useRouter()
const legalSearch = useLegalSearch()
const articleSearch = useArticleSearch()

// ==================== 响应式状态 ====================

/** 当前激活的 Tab */
const activeTab = ref<'legal' | 'article'>('legal')

/** 搜索关键词 */
const searchKeyword = ref('')

/** 搜索筛选条件 */
const searchFilters = ref<{ type: LegalType | null; issuingAuthority: string | null; validityStatus: ValidityStatusFilter }>({
    type: null,
    issuingAuthority: null,
    validityStatus: 'valid',
})

/** 法条搜索查询 */
const articleQuery = ref('')

/** 法条搜索筛选条件 */
const articleFilters = ref<ArticleSearchFilters>({
    legalType: null,
    validityStatus: 'valid',
})

/** 选中的法律 ID */
const selectedLegalId = ref<string | null>(null)

/** 法条详情弹框状态 */
const articleDialogOpen = ref(false)

/** 选中的法条（用于弹框显示） */
const selectedArticle = ref<LawSearchResultItem | null>(null)

/** 是否已执行过搜索（有搜索结果） */
const hasSearchResults = ref(false)

/** 法条搜索是否已执行过 */
const hasArticleSearched = ref(false)

/** 防止循环更新的标志 */
const isRestoring = ref(false)

/** 搜全文当前排序值 */
const sortValue = ref<'publishDate' | 'effectiveDate' | 'name'>('publishDate')

// ==================== 计算属性 ====================

/** 法条卡片派生数据 */
const articleCards = computed(() =>
    articleSearch.results.value.map(result => {
        const { articleNo, breadcrumb } = splitChapter(result.chapter_hierarchy || [])
        const legalType = result.metadata?.legal_type
        return {
            id: result.articles_id,
            raw: result,
            articleNo,
            breadcrumb,
            typeLabel: legalType || '法条',
            typeTone: (legalType && ARTICLE_TYPE_TONE[legalType]) || 'info',
            similarity: result.score ? (result.score * 100).toFixed(1) : null,
            excerpt: highlightContent(extractArticleContent(result.content)),
        }
    })
)

// ==================== URL 状态同步 ====================

/** 同步状态到 URL */
const syncToUrl = () => {
    if (isRestoring.value) return

    const query: Record<string, string> = {}

    // Tab 状态
    if (activeTab.value !== 'legal') {
        query.tab = activeTab.value
    }

    // 搜全文筛选条件（始终保留）
    if (searchKeyword.value) {
        query.keyword = searchKeyword.value
    }
    if (searchFilters.value.type) {
        query.type = searchFilters.value.type
    }
    if (searchFilters.value.issuingAuthority) {
        query.issuingAuthority = searchFilters.value.issuingAuthority
    }
    if (searchFilters.value.validityStatus !== 'valid') {
        query.validityStatus = searchFilters.value.validityStatus
    }
    if (legalSearch.pagination.value.page > 1) {
        query.page = String(legalSearch.pagination.value.page)
    }

    // 搜法条筛选条件（始终保留）
    if (articleQuery.value) {
        query.articleQuery = articleQuery.value
    }
    if (articleFilters.value.legalType) {
        query.articleType = articleFilters.value.legalType
    }
    if (articleFilters.value.validityStatus !== 'valid') {
        query.articleStatus = articleFilters.value.validityStatus
    }

    router.replace({ query })
}

/** 从 URL 恢复状态 */
const restoreFromUrl = () => {
    const query = route.query

    // 恢复 Tab 状态
    if (query.tab === 'article') {
        activeTab.value = 'article'
    } else {
        activeTab.value = 'legal'
    }

    // 恢复搜全文筛选条件
    if (typeof query.keyword === 'string') {
        searchKeyword.value = query.keyword
    }
    if (typeof query.type === 'string' && ['law', 'regulation', 'judicial_interp', 'guideline'].includes(query.type)) {
        searchFilters.value.type = query.type as LegalType
    }
    if (typeof query.issuingAuthority === 'string') {
        searchFilters.value.issuingAuthority = query.issuingAuthority
    }
    if (typeof query.validityStatus === 'string' && (VALIDITY_STATUS_FILTERS as readonly string[]).includes(query.validityStatus)) {
        searchFilters.value.validityStatus = query.validityStatus as ValidityStatusFilter
    }
    if (typeof query.page === 'string') {
        const page = parseInt(query.page, 10)
        if (!isNaN(page) && page > 0) {
            legalSearch.setPage(page)
        }
    }

    // 恢复搜法条筛选条件
    if (typeof query.articleQuery === 'string') {
        articleQuery.value = query.articleQuery
    }
    if (typeof query.articleType === 'string' && ['law', 'regulation', 'judicial_interp', 'guideline'].includes(query.articleType)) {
        articleFilters.value.legalType = query.articleType as LegalType
    }
    if (typeof query.articleStatus === 'string' && (VALIDITY_STATUS_FILTERS as readonly string[]).includes(query.articleStatus)) {
        articleFilters.value.validityStatus = query.articleStatus as ValidityStatusFilter
    }

    // 如果有搜全文的关键词，自动执行搜索
    if (searchKeyword.value || searchFilters.value.type || searchFilters.value.issuingAuthority) {
        hasSearchResults.value = true
        legalSearch.setFilters({
            keyword: searchKeyword.value,
            ...searchFilters.value,
        })
    }

    // 如果有搜法条的查询，自动执行搜索
    if (articleQuery.value) {
        hasArticleSearched.value = true
        articleSearch.searchArticles(articleQuery.value, articleFilters.value)
    }
}

// ==================== 生命周期 ====================

onMounted(async () => {
    // 初始化数据：加载发文机关列表
    await legalSearch.loadIssuingAuthorities()

    // 从 URL 恢复状态
    isRestoring.value = true
    restoreFromUrl()
    nextTick(() => {
        isRestoring.value = false
    })
})

// ==================== 监听器 ====================

/** 监听 Tab 切换，同步到 URL */
watch(activeTab, () => {
    syncToUrl()
})

/** 监听搜全文分页变化，同步到 URL */
watch(() => legalSearch.pagination.value.page, () => {
    if (activeTab.value === 'legal') {
        syncToUrl()
    }
})

// ==================== 辅助方法 ====================

/** 拆分章节层级：末段若为「第…条」则作为法条号，其余作为面包屑 */
const splitChapter = (hierarchy: string[]): { articleNo: string | null; breadcrumb: string[] } => {
    if (hierarchy.length > 0) {
        const last = hierarchy[hierarchy.length - 1]!
        if (ARTICLE_NO_RE.test(last)) {
            return { articleNo: last, breadcrumb: hierarchy.slice(0, -1) }
        }
    }
    return { articleNo: null, breadcrumb: hierarchy }
}

/** 提取法条实际内容（截取 "内容：" 后的部分） */
const extractArticleContent = (content: string): string => {
    const marker = '内容：'
    const index = content.indexOf(marker)
    if (index !== -1) {
        return content.substring(index + marker.length).trim()
    }
    return content
}

/** 高亮搜索内容 */
const highlightContent = (content: string): string => {
    if (!articleQuery.value.trim()) return content

    const keywords = articleQuery.value.trim().split(/\s+/)
    let highlightedContent = content

    keywords.forEach(keyword => {
        if (keyword.length > 0) {
            const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
            highlightedContent = highlightedContent.replace(
                regex,
                '<mark class="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">$1</mark>'
            )
        }
    })

    return highlightedContent
}

// ==================== 方法 ====================

/** 处理搜索 */
const handleSearch = () => {
    if (activeTab.value === 'legal') {
        hasSearchResults.value = true
        legalSearch.setFilters({
            keyword: searchKeyword.value,
            ...searchFilters.value,
        })
    } else {
        hasArticleSearched.value = true
        articleSearch.searchArticles(articleQuery.value, articleFilters.value)
    }
    syncToUrl()
}

/** 处理重置 */
const handleReset = () => {
    if (activeTab.value === 'legal') {
        searchKeyword.value = ''
        searchFilters.value = {
            type: null,
            issuingAuthority: null,
            validityStatus: 'valid',
        }
        selectedLegalId.value = null
        hasSearchResults.value = false
        sortValue.value = 'publishDate'
        legalSearch.resetFilters()
    } else {
        articleQuery.value = ''
        articleFilters.value = {
            legalType: null,
            validityStatus: 'valid',
        }
        hasArticleSearched.value = false
        articleSearch.clearResults()
    }
    syncToUrl()
}

/** 处理热门检索词点击 */
const handleTrendingClick = (keyword: string) => {
    if (activeTab.value === 'legal') {
        searchKeyword.value = keyword
    } else {
        articleQuery.value = keyword
    }
    handleSearch()
}

/** 处理排序变化 */
const handleSortChange = (val: string) => {
    const opt = SORT_OPTIONS.find(o => o.value === val)
    if (!opt) return
    sortValue.value = opt.value
    legalSearch.setSort(opt.sortBy, opt.sortOrder)
}

/** 处理法律选择 - 跳转到预览页面 */
const handleLegalSelect = (item: { id: string }) => {
    selectedLegalId.value = item.id
    navigateTo(`/dashboard/legal/preview/${item.id}`)
}

/** 处理页码变化 */
const handlePageChange = (page: number) => {
    legalSearch.setPage(page)
}

/** 处理法条搜索结果点击 - 打开详情弹框 */
const handleArticleResultClick = (result: LawSearchResultItem) => {
    selectedArticle.value = result
    articleDialogOpen.value = true
}

/** 处理法条搜索重试 */
const handleArticleRetry = () => {
    if (articleQuery.value) {
        articleSearch.searchArticles(articleQuery.value, articleFilters.value)
    }
}
</script>
```

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 无新增报错。

- [ ] **Step 3: 提交**

```bash
git add app/pages/dashboard/legal/index.vue
git commit -m "feat(ui): 法律法规检索页本体按设计稿重做"
```

---

## Task 8: 整体验证与代码优化

**Files:**
- 无新增改动文件（验证 + 按需修复）

- [ ] **Step 1: 全量类型检查**

Run: `bun run typecheck`
Expected: 无新增报错。若有，定位并修复后重跑。

- [ ] **Step 2: 启动开发服务器**

Run: `bun dev`（后台运行）
打开 `http://localhost:3000/dashboard/legal`（需已登录）。

- [ ] **Step 3: 浏览器实测（亮色）**

用 chrome-devtools MCP 在亮色模式下逐项核对：
- 页头 eyebrow/标题/副标题显示正确。
- 检索面板：下划线 Tab 切换「搜全文 ↔ 搜法条」；输入框 + 渐变「检索」按钮；法律类型胶囊选中态；发文机关可搜索下拉；生效状态下拉；重置筛选。
- 热门检索：标签点击后填入搜索框并触发检索。
- 搜全文：结果标题显示「找到 N 部…（耗时 X 秒）」；排序下拉切换（按发布日期/生效日期/名称）后列表刷新且回到第 1 页；表格行 hover、徽章颜色；底部分页翻页、当前页渐变高亮。
- 搜法条：结果标题 + 耗时；法条卡片类型徽章、法条号、相似度、面包屑、高亮摘录；点击卡片打开详情弹框；底部提示文案。
- 空态：清空条件检索无结果时的空态卡片；搜法条错误态。
- 移动端：缩窄视口，确认移动卡片列表与分页正常。

- [ ] **Step 4: 浏览器实测（暗色）**

切换到暗色模式，重复 Step 3 的视觉核对，重点确认：状态徽章四色、热门检索标签、渐变按钮、分页当前页、表头与卡片背景在暗色下对比度正常、无糊成一片。

- [ ] **Step 5: 用 simplify 技能优化代码**

对本次改动的 8 个文件运行 `simplify` 技能，按建议修复（复用、质量、效率问题）。

- [ ] **Step 6: 若 simplify 产生改动则提交**

```bash
git add -A
git commit -m "refactor(ui): 法律法规检索页改造代码优化"
```

（若 simplify 无改动则跳过本步。）

---

## 验收标准

- `bun run typecheck` 无新增报错。
- `/dashboard/legal` 在亮色与暗色下均符合设计稿：页头、检索面板、热门检索、搜全文表格、搜法条卡片。
- 三个新增元素均可用：热门检索标签、结果排序下拉、检索耗时显示。
- 原有功能无回归：Tab 切换、各筛选、分页、URL 状态同步、法条详情弹框、案件预览跳转。
