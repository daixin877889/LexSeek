# 案件详情页实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建案件详情页，包含侧边栏导航（桌面端）/ 底部 Tab（移动端），支持概览、材料、分析三个视图，以及小索助手 UI 外壳。

**Architecture:** 页面使用侧边栏 + 内容区布局，通过 `activeView` 状态切换视图组件。数据通过 `useCaseDetail` composable 统一获取（分析结果），`CaseInfoCard` 和 `MaterialList` 保持自加载模式。移动端通过 `hidden md:block` / `md:hidden` 切换侧边栏和底部 Tab。

**Tech Stack:** Nuxt 4, Vue 3 Composition API, Tailwind CSS v4, shadcn-vue (ResizablePanelGroup, Badge, Separator, Drawer, Button), lucide-vue-next

**Spec:** `docs/superpowers/specs/2026-03-31-case-detail-page-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/composables/useCaseDetail.ts` | 创建 | 数据获取：案件信息、材料、分析结果 |
| `app/pages/dashboard/cases/[id].vue` | 创建 | 页面入口，布局骨架，响应式切换 |
| `app/components/caseDetail/CaseDetailSidebar.vue` | 创建 | 桌面端侧边栏导航 |
| `app/components/caseDetail/CaseDetailBottomTabs.vue` | 创建 | 移动端底部 Tab 栏 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 创建 | 概览视图：复用 CaseInfoCard + MaterialList + AnalysisResults |
| `app/components/caseDetail/CaseDetailMaterials.vue` | 创建 | 材料视图：桌面端分栏 / 移动端列表+全屏预览 |
| `app/components/caseDetail/CaseDetailMaterialPreview.vue` | 创建 | 材料预览：按类型渲染内容 |
| `app/components/caseDetail/CaseDetailAnalysis.vue` | 创建 | 分析视图：包装 AnalysisResults |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | 创建 | 小索助手：悬浮按钮 + 弹窗/Drawer |

---

## Task 1: useCaseDetail composable

**Files:**
- Create: `app/composables/useCaseDetail.ts`

**参考文件：**
- `app/composables/useApiFetch.ts` — 命令式 `$fetch` 封装，返回 `Promise<T | null>`
- `app/composables/useApi.ts` — 响应式 `useFetch` 封装，返回 `{ data, error, refresh }`
- `shared/types/case.ts` — `AnalysisResult` 类型定义
- `shared/types/initAnalysis.ts` — `InitAnalysisStatusResponse`, `INIT_ANALYSIS_MODULES`

> **注意：** Spec 第 6.2 节示例使用了 `useApiFetch`，此处改用 `useApi`（基于 useFetch，响应式）。原因：页面级数据需要响应式自动更新，`useApi` 返回 `{ data, error, refresh }`，适合模板直接绑定。`useApiFetch` 返回 `Promise<T | null>`，适合事件处理中的命令式调用。

- [ ] **Step 1: 创建 composable 文件**

```typescript
// app/composables/useCaseDetail.ts
import type { AnalysisResult } from '#shared/types/case'
import type { InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'

/** 案件详情页视图类型（包含未来扩展） */
export type ActiveView = 'overview' | 'materials' | 'analysis' | 'todos' | 'documents'

/** MaterialItem 接口（与 MaterialList.vue 中定义一致） */
export interface MaterialItem {
  id: number
  name: string
  type: number
  typeText: string
  ossFileId: number | null
  isEncrypted: boolean
  status: number
  summary: string | null
  fileName: string | null
  fileSize: number | null
  fileType: string | null
}

/** 案件基本信息接口（与 API 返回对齐） */
export interface CaseDetailInfo {
  id: number
  title: string
  content: string
  caseTypeId: number
  plaintiff: string[] | Array<{ name: string }>
  defendant: string[] | Array<{ name: string }>
  status: number
  isDemo: boolean
  createdAt: string
  updatedAt: string
  caseType: { id: number; name: string; description: string } | null
  sessions: Array<{ id: number; sessionId: string; status: number; createdAt: string }>
  latestAnalyses: Array<{
    id: number
    nodeId: number
    analysisType: string
    version: number
    status: number
    createdAt: string
    node: { name: string; title: string; type: string } | null
  }>
}

export function useCaseDetail(caseId: Ref<number> | ComputedRef<number>) {
  const id = toRef(caseId)

  // 案件基本信息（响应式，用于页面头部标题等）
  const { data: caseInfo, refresh: refreshCase } = useApi<CaseDetailInfo>(
    () => `/api/v1/case/${id.value}`,
  )

  // 材料列表（响应式）
  const { data: materials, refresh: refreshMaterials } = useApi<MaterialItem[]>(
    () => `/api/v1/case/${id.value}/materials`,
  )

  // 分析状态和结果
  const { data: analysisStatus, refresh: refreshAnalysis } = useApi<InitAnalysisStatusResponse>(
    () => `/api/v1/case/init-analysis-status/${id.value}`,
  )

  // 将分析结果转换为 AnalysisResult[] 格式
  const analysisResults = computed<AnalysisResult[]>(() => {
    const status = analysisStatus.value
    if (!status?.modules) return []

    return status.modules
      .filter(m => m.status === 'complete' && m.result)
      .map(m => {
        const moduleDef = INIT_ANALYSIS_MODULES.find(def => def.name === m.name)
        return {
          nodeId: 0, // init-analysis 无持久化 nodeId，用 0 占位
          moduleName: m.name,
          moduleTitle: moduleDef?.title ?? m.name,
          content: m.result!,
          analyzedAt: '', // InitAnalysisStatusResponse 不含时间戳
        }
      })
  })

  return {
    caseInfo,
    materials,
    analysisResults,
    analysisStatus,
    refreshCase,
    refreshMaterials,
    refreshAnalysis,
  }
}
```

- [ ] **Step 2: 验证类型检查通过**

Run: `npx nuxi typecheck`
Expected: 无与 `useCaseDetail.ts` 相关的错误

- [ ] **Step 3: Commit**

```bash
git add app/composables/useCaseDetail.ts
git commit -m "feat(cases): 添加案件详情页数据 composable"
```

---

## Task 2: 页面骨架 + 侧边栏 + 底部 Tab

**Files:**
- Create: `app/pages/dashboard/cases/[id].vue`
- Create: `app/components/caseDetail/CaseDetailSidebar.vue`
- Create: `app/components/caseDetail/CaseDetailBottomTabs.vue`

**参考文件：**
- `docs/superpowers/specs/2026-03-31-case-detail-page-design.md` — 第 3 节布局、第 8.1 节布局类、第 8.2 节菜单项样式
- `app/pages/dashboard/cases/init-analysis/[sessionId].vue` — 现有页面结构参考

- [ ] **Step 1: 创建侧边栏组件**

```vue
<!-- app/components/caseDetail/CaseDetailSidebar.vue -->
<script lang="ts" setup>
import type { Component } from 'vue'
import type { ActiveView } from '~/composables/useCaseDetail'
import {
  LayoutDashboardIcon,
  FolderIcon,
  SparklesIcon,
  ListTodoIcon,
  FileEditIcon,
} from 'lucide-vue-next'

interface SidebarMenuItem {
  id: ActiveView
  label: string
  icon: Component
  disabled?: boolean
  badge?: string
}

const modelValue = defineModel<ActiveView>({ required: true })

const menuItems: SidebarMenuItem[] = [
  { id: 'overview', label: '概览', icon: LayoutDashboardIcon },
  { id: 'materials', label: '案件材料', icon: FolderIcon },
  { id: 'analysis', label: '分析结果', icon: SparklesIcon },
]

const futureItems: Array<{ label: string; icon: Component }> = [
  { label: '待办事项', icon: ListTodoIcon },
  { label: '文书生成', icon: FileEditIcon },
]
</script>

<template>
  <nav class="flex flex-col h-full p-3 space-y-1">
    <button
      v-for="item in menuItems"
      :key="item.id"
      class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
      :class="[
        modelValue === item.id
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      ]"
      @click="modelValue = item.id"
    >
      <component :is="item.icon" class="size-4 shrink-0" />
      <span>{{ item.label }}</span>
      <Badge v-if="item.badge" variant="secondary" class="ml-auto px-1.5 py-0 h-4 text-[10px]">
        {{ item.badge }}
      </Badge>
    </button>

    <!-- 未来功能 -->
    <Separator class="my-2" />
    <button
      v-for="item in futureItems"
      :key="item.label"
      class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground/50 cursor-not-allowed"
      disabled
    >
      <component :is="item.icon" class="size-4 shrink-0" />
      <span>{{ item.label }}</span>
      <span class="ml-auto text-[9px] bg-muted rounded px-1">即将推出</span>
    </button>
  </nav>
</template>
```

- [ ] **Step 2: 创建底部 Tab 栏组件**

```vue
<!-- app/components/caseDetail/CaseDetailBottomTabs.vue -->
<script lang="ts" setup>
import type { Component } from 'vue'
import type { ActiveView } from '~/composables/useCaseDetail'
import {
  LayoutDashboardIcon,
  FolderIcon,
  SparklesIcon,
} from 'lucide-vue-next'

interface TabItem {
  id: ActiveView
  label: string
  icon: Component
}

const modelValue = defineModel<ActiveView>({ required: true })

const tabs: TabItem[] = [
  { id: 'overview', label: '概览', icon: LayoutDashboardIcon },
  { id: 'materials', label: '材料', icon: FolderIcon },
  { id: 'analysis', label: '分析', icon: SparklesIcon },
]
</script>

<template>
  <nav class="h-14 flex items-center justify-around bg-background border-t pb-[env(safe-area-inset-bottom)]">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="flex flex-col items-center gap-0.5 py-2 px-4 text-xs transition-colors"
      :class="[
        modelValue === tab.id
          ? 'text-primary'
          : 'text-muted-foreground'
      ]"
      @click="modelValue = tab.id"
    >
      <component :is="tab.icon" class="size-5" />
      <span>{{ tab.label }}</span>
    </button>
  </nav>
</template>
```

- [ ] **Step 3: 创建页面骨架**

```vue
<!-- app/pages/dashboard/cases/[id].vue -->
<script lang="ts" setup>
import type { ActiveView } from '~/composables/useCaseDetail'
import { ArrowLeftIcon, BotIcon } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
})

const route = useRoute()
const caseId = computed(() => Number(route.params.id))

const activeView = ref<ActiveView>('overview')
const selectedMaterialId = ref<number | null>(null)
const xiaosuoOpen = ref(false)

const { caseInfo, materials, analysisResults } = useCaseDetail(caseId)

const pageTitle = computed(() => caseInfo.value?.title ?? '案件详情')

// 从概览跳转到指定视图
function navigateToView(view: ActiveView) {
  activeView.value = view
}

function navigateToMaterial(materialId: number) {
  activeView.value = 'materials'
  selectedMaterialId.value = materialId
}

function navigateToAnalysis(index: number) {
  activeView.value = 'analysis'
  // 分析视图通过 AnalysisResults 的 activeIndex 定位
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 头部 -->
    <header class="h-12 shrink-0 border-b flex items-center px-4 gap-3">
      <Button variant="ghost" size="icon" class="size-8 shrink-0" @click="navigateTo('/dashboard/cases')">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <h1 class="text-sm font-medium truncate flex-1">{{ pageTitle }}</h1>
      <!-- 移动端小索按钮 -->
      <Button variant="ghost" size="icon" class="size-8 shrink-0 md:hidden" @click="xiaosuoOpen = true">
        <BotIcon class="size-4" />
      </Button>
    </header>

    <!-- 主体 -->
    <div class="flex flex-1 min-h-0">
      <!-- 侧边栏 - 仅桌面端 -->
      <aside class="hidden md:block w-56 shrink-0 border-r bg-muted/30">
        <CaseDetailSidebar v-model="activeView" />
      </aside>

      <!-- 内容区 -->
      <main class="flex-1 min-w-0 overflow-hidden relative">
        <!-- 占位内容 - 后续 Task 替换 -->
        <div class="flex items-center justify-center h-full text-muted-foreground">
          当前视图：{{ activeView }}
        </div>
      </main>
    </div>

    <!-- 底部 Tab 栏 - 仅移动端 -->
    <div class="md:hidden shrink-0">
      <CaseDetailBottomTabs v-model="activeView" />
    </div>
  </div>
</template>
```

- [ ] **Step 4: 启动开发服务器验证布局**

Run: `bun dev`

验证项：
1. 访问 `/dashboard/cases/1`，页面正常渲染
2. 桌面端显示侧边栏 + 内容区，移动端显示底部 Tab
3. 点击侧边栏/Tab 项，内容区占位文字切换
4. 头部返回按钮跳转到案件列表
5. 调整浏览器窗口宽度，768px 断点处切换布局

- [ ] **Step 5: Commit**

```bash
git add app/pages/dashboard/cases/\[id\].vue app/components/caseDetail/
git commit -m "feat(cases): 创建案件详情页骨架和导航组件"
```

---

## Task 3: 概览视图

**Files:**
- Create: `app/components/caseDetail/CaseDetailOverview.vue`
- Modify: `app/pages/dashboard/cases/[id].vue` — 替换占位内容

**参考文件：**
- `app/components/initAnalysis/CaseInfoCard.vue` — 接口：`props: { caseId: number }`，自行加载数据
- `app/components/initAnalysis/MaterialList.vue` — 接口：`props: { caseId: number }`，`emit('preview', material)`
- `app/components/case/AnalysisResults.vue` — 接口：`props: { results, viewMode, activeIndex, ... }`，`emit('update:viewMode', ...)`

- [ ] **Step 1: 创建概览视图组件**

```vue
<!-- app/components/caseDetail/CaseDetailOverview.vue -->
<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'
import type { ActiveView } from '~/composables/useCaseDetail'
import { EyeIcon } from 'lucide-vue-next'

const props = defineProps<{
  caseId: number
  analysisResults: AnalysisResult[]
}>()

const emit = defineEmits<{
  navigateView: [view: ActiveView]
  navigateAnalysis: [index: number]
}>()

// 概览中分析结果始终为 dashboard 模式
const analysisViewMode = ref<'dashboard' | 'detail'>('dashboard')

// 拦截分析结果卡片点击：切换到分析视图并重置
function handleAnalysisCardClick(mode: 'dashboard' | 'detail') {
  if (mode === 'detail') {
    // 先重置为 dashboard，防止返回概览时停留在 detail 态
    nextTick(() => { analysisViewMode.value = 'dashboard' })
    emit('navigateView', 'analysis')
  }
}

watch(analysisViewMode, handleAnalysisCardClick)
</script>

<template>
  <div class="overflow-y-auto h-full">
    <!-- 案件信息 -->
    <InitAnalysisCaseInfoCard :case-id="caseId" />
    <Separator class="opacity-50" />

    <!-- 案件材料 -->
    <div class="relative">
      <button
        class="absolute top-4 right-4 z-10 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        @click="emit('navigateView', 'materials')"
      >
        <EyeIcon class="size-3" />
        查看
      </button>
      <InitAnalysisMaterialList
        :case-id="caseId"
        @preview="emit('navigateView', 'materials')"
      />
    </div>
    <Separator class="opacity-50" />

    <!-- 分析结果 -->
    <div class="relative">
      <button
        v-if="analysisResults.length > 0"
        class="absolute top-4 right-4 z-10 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        @click="emit('navigateView', 'analysis')"
      >
        <EyeIcon class="size-3" />
        查看
      </button>
      <CaseAnalysisResults
        :results="analysisResults"
        v-model:view-mode="analysisViewMode"
        :show-regenerate="false"
        :show-copy="false"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 2: 更新页面引用概览组件**

在 `app/pages/dashboard/cases/[id].vue` 中，将内容区占位替换为：

```vue
<!-- 内容区 -->
<main class="flex-1 min-w-0 overflow-hidden relative">
  <CaseDetailOverview
    v-if="activeView === 'overview'"
    :case-id="caseId"
    :analysis-results="analysisResults"
    @navigate-view="navigateToView"
  />
  <!-- 其他视图占位 -->
  <div v-else class="flex items-center justify-center h-full text-muted-foreground">
    当前视图：{{ activeView }}
  </div>
</main>
```

- [ ] **Step 3: 验证概览视图**

Run: `bun dev`

验证项：
1. 访问有效案件 ID 的详情页（如 `/dashboard/cases/1`）
2. 概览视图显示案件信息卡片、材料列表、分析结果
3. 点击材料区域"查看"或任意材料卡片 → activeView 切换到 "materials"
4. 点击分析结果卡片 → activeView 切换到 "analysis"
5. 数据加载错误时显示空状态而不是白屏

- [ ] **Step 4: Commit**

```bash
git add app/components/caseDetail/CaseDetailOverview.vue app/pages/dashboard/cases/\[id\].vue
git commit -m "feat(cases): 实现案件详情概览视图"
```

---

## Task 4: 材料视图

**Files:**
- Create: `app/components/caseDetail/CaseDetailMaterials.vue`
- Create: `app/components/caseDetail/CaseDetailMaterialPreview.vue`
- Modify: `app/pages/dashboard/cases/[id].vue` — 添加材料视图渲染

**参考文件：**
- `app/components/initAnalysis/MaterialList.vue` — 卡片网格样式、图标/颜色映射函数
- `shared/types/case.ts` — `CaseMaterialType` 枚举
- `shared/utils/unitConverision.ts` — `formatByteSize` 函数

- [ ] **Step 1: 创建材料预览组件**

```vue
<!-- app/components/caseDetail/CaseDetailMaterialPreview.vue -->
<script lang="ts" setup>
import type { MaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType, CaseMaterialTypeText } from '#shared/types/case'
import { formatByteSize } from '#shared/utils/unitConverision'
import {
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
  InboxIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  material: MaterialItem | null
}>()

const materialTypeText = computed(() => {
  if (!props.material) return ''
  return CaseMaterialTypeText[props.material.type as CaseMaterialType] ?? '未知'
})

const fileSizeText = computed(() => {
  if (!props.material?.fileSize) return null
  return formatByteSize(props.material.fileSize, 1)
})
</script>

<template>
  <!-- 空状态 -->
  <div v-if="!material" class="flex flex-col items-center justify-center h-full text-muted-foreground">
    <InboxIcon class="size-12 mb-3 opacity-40" />
    <p class="text-sm">点击材料查看详情</p>
  </div>

  <!-- 预览内容 -->
  <div v-else class="flex flex-col h-full overflow-hidden">
    <!-- 头部 -->
    <div class="shrink-0 p-4 border-b space-y-1">
      <h3 class="text-sm font-medium truncate">{{ material.name }}</h3>
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary" class="px-1.5 py-0 h-4 text-[10px]">
          {{ materialTypeText }}
        </Badge>
        <span v-if="fileSizeText">{{ fileSizeText }}</span>
        <span v-if="material.fileName" class="truncate">{{ material.fileName }}</span>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 overflow-y-auto p-4">
      <!-- 文本内容 -->
      <template v-if="material.type === CaseMaterialType.CASE_CONTENT">
        <div v-if="material.summary" class="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
          {{ material.summary }}
        </div>
        <div v-else class="text-sm text-muted-foreground text-center py-8">暂无文本内容</div>
      </template>

      <!-- 文档 -->
      <template v-else-if="material.type === CaseMaterialType.DOCUMENT">
        <div v-if="material.summary" class="prose prose-sm dark:prose-invert max-w-none">
          <MessageResponse :content="material.summary" />
        </div>
        <div v-else class="text-center py-8">
          <FileTextIcon class="size-10 mx-auto mb-3 text-muted-foreground/40" />
          <p class="text-sm text-muted-foreground">文档内容预览功能即将上线</p>
        </div>
      </template>

      <!-- 图片 -->
      <template v-else-if="material.type === CaseMaterialType.IMAGE">
        <div class="text-center py-8">
          <ImageIcon class="size-10 mx-auto mb-3 text-muted-foreground/40" />
          <p class="text-sm text-muted-foreground">图片预览功能即将上线</p>
        </div>
      </template>

      <!-- 音频 -->
      <template v-else-if="material.type === CaseMaterialType.AUDIO">
        <div class="text-center py-8">
          <FileAudioIcon class="size-10 mx-auto mb-3 text-muted-foreground/40" />
          <p class="text-sm text-muted-foreground">音频播放功能即将上线</p>
          <div v-if="material.fileName" class="text-xs text-muted-foreground mt-2">
            {{ material.fileName }}
            <span v-if="fileSizeText">({{ fileSizeText }})</span>
          </div>
        </div>
      </template>

      <!-- 其他类型 -->
      <template v-else>
        <div class="text-center py-8">
          <FileIcon class="size-10 mx-auto mb-3 text-muted-foreground/40" />
          <p class="text-sm text-muted-foreground">暂不支持预览此类型文件</p>
        </div>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 创建材料视图组件**

```vue
<!-- app/components/caseDetail/CaseDetailMaterials.vue -->
<script lang="ts" setup>
import type { MaterialItem } from '~/composables/useCaseDetail'
import { CaseMaterialType } from '#shared/types/case'
import { formatByteSize } from '#shared/utils/unitConverision'
import { ArrowLeftIcon } from 'lucide-vue-next'
import {
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
  LockIcon,
} from 'lucide-vue-next'

const props = defineProps<{
  materials: MaterialItem[]
}>()

const selectedId = defineModel<number | null>('selectedId', { default: null })

const selectedMaterial = computed(() => {
  if (selectedId.value === null) return null
  return props.materials.find(m => m.id === selectedId.value) ?? null
})

// 移动端：选中材料后显示预览
const isMobile = useMediaQuery('(max-width: 767px)')
const showMobilePreview = computed(() => isMobile.value && selectedId.value !== null)

function selectMaterial(id: number) {
  selectedId.value = id
}

function backToList() {
  selectedId.value = null
}

// --- 样式工具函数（参考 InitAnalysisMaterialList） ---
function getMaterialIcon(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return FileTextIcon
    case CaseMaterialType.IMAGE: return ImageIcon
    case CaseMaterialType.AUDIO: return FileAudioIcon
    case CaseMaterialType.CASE_CONTENT: return FileIcon
    default: return FileIcon
  }
}

function getMaterialBgColor(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return 'bg-blue-500/10 dark:bg-blue-500/20'
    case CaseMaterialType.IMAGE: return 'bg-green-500/10 dark:bg-green-500/20'
    case CaseMaterialType.AUDIO: return 'bg-purple-500/10 dark:bg-purple-500/20'
    case CaseMaterialType.CASE_CONTENT: return 'bg-orange-500/10 dark:bg-orange-500/20'
    default: return 'bg-muted'
  }
}

function getMaterialIconColor(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return 'text-blue-600 dark:text-blue-400'
    case CaseMaterialType.IMAGE: return 'text-green-600 dark:text-green-400'
    case CaseMaterialType.AUDIO: return 'text-purple-600 dark:text-purple-400'
    case CaseMaterialType.CASE_CONTENT: return 'text-orange-600 dark:text-orange-400'
    default: return 'text-muted-foreground'
  }
}
</script>

<template>
  <div class="h-full">
    <!-- 移动端：全屏预览 -->
    <template v-if="showMobilePreview">
      <div class="flex flex-col h-full">
        <div class="shrink-0 h-10 flex items-center px-3 border-b">
          <Button variant="ghost" size="sm" class="h-7 gap-1 -ml-2" @click="backToList">
            <ArrowLeftIcon class="size-3.5" />
            返回
          </Button>
        </div>
        <div class="flex-1 min-h-0">
          <CaseDetailMaterialPreview :material="selectedMaterial" />
        </div>
      </div>
    </template>

    <!-- 移动端：材料列表 / 桌面端：分栏 -->
    <template v-else>
      <!-- 桌面端：分栏布局 -->
      <div class="hidden md:flex h-full">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel :default-size="40" :min-size="25">
            <div class="h-full overflow-y-auto p-4">
              <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileTextIcon class="size-4" />
                案件材料
                <Badge v-if="materials.length > 0" variant="secondary" class="ml-auto font-normal px-1.5 py-0 h-4 text-[10px]">
                  {{ materials.length }}
                </Badge>
              </h3>
              <div class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                <button
                  v-for="material in materials"
                  :key="material.id"
                  class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border text-center"
                  :class="[
                    selectedId === material.id
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:border-primary/10'
                  ]"
                  @click="selectMaterial(material.id)"
                >
                  <div :class="['flex items-center justify-center size-11 rounded-xl shrink-0 transition-transform group-hover:scale-105 mb-1.5', getMaterialBgColor(material.type)]">
                    <component :is="getMaterialIcon(material.type)" :class="['size-6', getMaterialIconColor(material.type)]" />
                  </div>
                  <div class="flex-1 min-w-0 w-full">
                    <div class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 group-hover:text-primary transition-colors px-1">
                      {{ material.name }}
                    </div>
                    <div class="text-[10px] text-muted-foreground/60 flex items-center justify-center gap-1">
                      <span v-if="material.fileSize" class="shrink-0">{{ formatByteSize(material.fileSize, 0) }}</span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel :default-size="60" :min-size="30">
            <CaseDetailMaterialPreview :material="selectedMaterial" />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <!-- 移动端：全屏材料列表 -->
      <div class="md:hidden h-full overflow-y-auto p-4">
        <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider mb-3 flex items-center gap-2">
          <FileTextIcon class="size-4" />
          案件材料
          <Badge v-if="materials.length > 0" variant="secondary" class="ml-auto font-normal px-1.5 py-0 h-4 text-[10px]">
            {{ materials.length }}
          </Badge>
        </h3>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
          <button
            v-for="material in materials"
            :key="material.id"
            class="group relative flex flex-col items-center p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-all border border-transparent hover:border-primary/10 text-center"
            @click="selectMaterial(material.id)"
          >
            <div :class="['flex items-center justify-center size-11 rounded-xl shrink-0 mb-1.5', getMaterialBgColor(material.type)]">
              <component :is="getMaterialIcon(material.type)" :class="['size-6', getMaterialIconColor(material.type)]" />
            </div>
            <div class="flex-1 min-w-0 w-full">
              <div class="text-[12px] font-medium line-clamp-1 leading-tight mb-1 px-1">{{ material.name }}</div>
              <div class="text-[10px] text-muted-foreground/60">
                <span v-if="material.fileSize">{{ formatByteSize(material.fileSize, 0) }}</span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 3: 更新页面添加材料视图渲染**

在 `[id].vue` 的内容区添加：

```vue
<CaseDetailMaterials
  v-else-if="activeView === 'materials'"
  :materials="materials ?? []"
  v-model:selected-id="selectedMaterialId"
/>
```

- [ ] **Step 4: 验证材料视图**

Run: `bun dev`

验证项：
1. 桌面端：左右分栏，左侧材料网格，右侧预览
2. 点击材料卡片，左侧高亮选中，右侧显示预览
3. 拖拽分割线调整比例
4. 移动端（<768px）：全屏材料网格，点击后全屏预览
5. 移动端预览有返回按钮回到列表
6. 空材料列表显示空状态

- [ ] **Step 5: Commit**

```bash
git add app/components/caseDetail/CaseDetailMaterials.vue app/components/caseDetail/CaseDetailMaterialPreview.vue app/pages/dashboard/cases/\[id\].vue
git commit -m "feat(cases): 实现案件详情材料视图"
```

---

## Task 5: 分析视图

**Files:**
- Create: `app/components/caseDetail/CaseDetailAnalysis.vue`
- Modify: `app/pages/dashboard/cases/[id].vue` — 添加分析视图渲染

**参考文件：**
- `app/components/case/AnalysisResults.vue` — Props 接口（第 35-71 行）

- [ ] **Step 1: 创建分析视图组件**

```vue
<!-- app/components/caseDetail/CaseDetailAnalysis.vue -->
<script lang="ts" setup>
import type { AnalysisResult } from '#shared/types/case'

const props = defineProps<{
  results: AnalysisResult[]
}>()

const activeIndex = ref(0)
const viewMode = ref<'dashboard' | 'detail'>('dashboard')

// 外部可以设置初始 activeIndex
function setActiveIndex(index: number) {
  if (index >= 0 && index < props.results.length) {
    activeIndex.value = index
    viewMode.value = 'detail'
  }
}

defineExpose({ setActiveIndex })
</script>

<template>
  <div class="h-full">
    <CaseAnalysisResults
      :results="results"
      v-model:active-index="activeIndex"
      v-model:view-mode="viewMode"
      :show-regenerate="true"
      :show-copy="true"
      class="h-full"
    />
  </div>
</template>
```

- [ ] **Step 2: 更新页面添加分析视图渲染**

在 `[id].vue` 的内容区添加：

```vue
<CaseDetailAnalysis
  v-else-if="activeView === 'analysis'"
  ref="analysisRef"
  :results="analysisResults"
/>
```

并添加 `const analysisRef = ref()` 到 script 中。

- [ ] **Step 3: 验证分析视图**

Run: `bun dev`

验证项：
1. 分析结果以卡片网格（dashboard 模式）展示
2. 点击卡片进入 detail 模式，显示 Markdown 内容
3. 返回按钮回到 dashboard 模式
4. 底部圆点导航可切换模块
5. 复制按钮正常工作
6. 无分析结果时显示空状态

- [ ] **Step 4: Commit**

```bash
git add app/components/caseDetail/CaseDetailAnalysis.vue app/pages/dashboard/cases/\[id\].vue
git commit -m "feat(cases): 实现案件详情分析视图"
```

---

## Task 6: 小索助手

**Files:**
- Create: `app/components/caseDetail/CaseDetailXiaosuo.vue`
- Modify: `app/pages/dashboard/cases/[id].vue` — 挂载小索组件

**参考文件：**
- `docs/superpowers/specs/2026-03-31-case-detail-page-design.md` — 第 5 节小索助手

- [ ] **Step 1: 创建小索助手组件**

```vue
<!-- app/components/caseDetail/CaseDetailXiaosuo.vue -->
<script lang="ts" setup>
import { BotIcon, XIcon, SendIcon } from 'lucide-vue-next'

const isOpen = defineModel<boolean>({ default: false })

const isMobile = useMediaQuery('(max-width: 767px)')
const inputText = ref('')

const welcomeMessage = {
  role: 'assistant' as const,
  content: '你好！我是小索，你的案件 AI 助手。有什么我可以帮你的吗？',
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const messages = ref<ChatMessage[]>([welcomeMessage])

function sendMessage() {
  const text = inputText.value.trim()
  if (!text) return

  messages.value = [
    ...messages.value,
    { role: 'user', content: text },
  ]
  inputText.value = ''

  // 本期占位回复
  setTimeout(() => {
    messages.value = [
      ...messages.value,
      { role: 'assistant', content: '功能开发中，敬请期待！' },
    ]
  }, 500)
}
</script>

<template>
  <!-- 桌面端：悬浮按钮 + Popover -->
  <template v-if="!isMobile">
    <div class="absolute bottom-4 right-4 z-20">
      <!-- 弹窗 -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 scale-95 translate-y-2"
        enter-to-class="opacity-100 scale-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 scale-100 translate-y-0"
        leave-to-class="opacity-0 scale-95 translate-y-2"
      >
        <div
          v-if="isOpen"
          class="absolute bottom-14 right-0 w-[380px] h-[500px] bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden"
        >
          <!-- 头部 -->
          <div class="shrink-0 h-10 flex items-center justify-between px-3 border-b bg-muted/30">
            <div class="flex items-center gap-2 text-sm font-medium">
              <BotIcon class="size-4 text-primary" />
              小索 · AI 助手
            </div>
            <Button variant="ghost" size="icon" class="size-6" @click="isOpen = false">
              <XIcon class="size-3.5" />
            </Button>
          </div>

          <!-- 消息列表 -->
          <div class="flex-1 overflow-y-auto p-3 space-y-3">
            <div
              v-for="(msg, i) in messages"
              :key="i"
              :class="[
                'text-sm rounded-lg px-3 py-2 max-w-[85%]',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground ml-auto'
                  : 'bg-muted'
              ]"
            >
              {{ msg.content }}
            </div>
          </div>

          <!-- 输入框 -->
          <div class="shrink-0 p-2 border-t">
            <div class="flex gap-2">
              <input
                v-model="inputText"
                class="flex-1 h-8 px-3 text-sm bg-muted rounded-md border-0 outline-none focus:ring-1 focus:ring-primary"
                placeholder="输入消息..."
                @keydown.enter="sendMessage"
              />
              <Button size="icon" class="size-8 shrink-0" :disabled="!inputText.trim()" @click="sendMessage">
                <SendIcon class="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 悬浮按钮 -->
      <Button
        size="icon"
        class="size-12 rounded-full shadow-lg"
        :variant="isOpen ? 'default' : 'outline'"
        @click="isOpen = !isOpen"
      >
        <BotIcon class="size-5" />
      </Button>
    </div>
  </template>

  <!-- 移动端：底部 Drawer -->
  <template v-else>
    <Drawer v-model:open="isOpen">
      <DrawerContent class="h-[90vh]">
        <DrawerHeader class="pb-2">
          <DrawerTitle class="flex items-center gap-2 text-sm">
            <BotIcon class="size-4 text-primary" />
            小索 · AI 助手
          </DrawerTitle>
        </DrawerHeader>

        <!-- 消息列表 -->
        <div class="flex-1 overflow-y-auto px-4 space-y-3">
          <div
            v-for="(msg, i) in messages"
            :key="i"
            :class="[
              'text-sm rounded-lg px-3 py-2 max-w-[85%]',
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground ml-auto'
                : 'bg-muted'
            ]"
          >
            {{ msg.content }}
          </div>
        </div>

        <!-- 输入框 -->
        <div class="shrink-0 p-4 border-t pb-[env(safe-area-inset-bottom)]">
          <div class="flex gap-2">
            <input
              v-model="inputText"
              class="flex-1 h-9 px-3 text-sm bg-muted rounded-md border-0 outline-none focus:ring-1 focus:ring-primary"
              placeholder="输入消息..."
              @keydown.enter="sendMessage"
            />
            <Button size="icon" class="size-9 shrink-0" :disabled="!inputText.trim()" @click="sendMessage">
              <SendIcon class="size-4" />
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  </template>
</template>
```

- [ ] **Step 2: 挂载小索组件到页面**

在 `[id].vue` 中，在 `</main>` 标签后（底部 Tab 栏之前）添加：

```vue
<!-- 小索助手 -->
<CaseDetailXiaosuo v-model="xiaosuoOpen" />
```

注意：桌面端的悬浮按钮使用 `absolute` 定位在 `<main>` 内（main 已有 `relative` 和 `overflow-hidden`）。将小索组件放在 `<main>` 标签内部末尾，`absolute` 定位不受滚动影响（各视图组件自带独立的滚动容器）。

- [ ] **Step 3: 验证小索助手**

Run: `bun dev`

验证项：
1. 桌面端：右下角显示悬浮按钮
2. 点击按钮弹出对话窗口，显示欢迎消息
3. 输入消息后出现占位回复
4. 再次点击按钮关闭弹窗
5. 移动端：头部显示小索按钮
6. 点击后从底部滑出 Drawer
7. Drawer 中对话功能正常
8. 下拉或点击遮罩关闭 Drawer

- [ ] **Step 4: Commit**

```bash
git add app/components/caseDetail/CaseDetailXiaosuo.vue app/pages/dashboard/cases/\[id\].vue
git commit -m "feat(cases): 实现小索助手 UI 外壳"
```

---

## Task 7: 类型检查与最终验证

**Files:**
- Modify: 根据类型检查结果修复

- [ ] **Step 1: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无错误

- [ ] **Step 2: 修复类型问题（如有）**

根据类型检查输出修复问题。

- [ ] **Step 3: 端到端验证**

Run: `bun dev`

完整验证清单：
1. 从案件列表进入案件详情页
2. 概览视图：案件信息、材料、分析结果正常显示
3. 概览到材料视图跳转
4. 材料视图：桌面端分栏、移动端全屏预览
5. 概览到分析视图跳转
6. 分析视图：dashboard/detail 模式切换
7. 侧边栏（桌面端）和底部 Tab（移动端）切换正常
8. 小索助手弹窗/Drawer 正常
9. 768px 断点响应式切换无闪烁
10. 从 init-analysis 完成页面点击"进入案件详情"正常跳转

- [ ] **Step 4: 最终 Commit**

```bash
git add app/composables/useCaseDetail.ts app/pages/dashboard/cases/\[id\].vue app/components/caseDetail/
git commit -m "feat(cases): 完成案件详情页全部功能"
```
