# 初始化分析页右面板 UI 对齐 — 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一初始化分析页右面板与案件详情页的 UI 风格，通过 `readonly` prop 控制只读行为

**Architecture:** 为 `CaseDetailOverview` 和 `CaseAnalysisResults` 添加 `readonly` prop，初始化分析页复用这两个组件并启用 readonly 模式。`CaseDetailOverview` 同时增加材料列表/卡片视图切换功能。

**Tech Stack:** Vue 3, TypeScript, Tailwind CSS v4, shadcn-vue

**Spec:** `docs/superpowers/specs/2026-04-11-init-analysis-readonly-panel-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/components/case/AnalysisResults.vue` | 修改 | 增加 `readonly` prop，控制卡片交互和按钮可见性 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 修改 | 增加 `readonly`/`materialsLoading` prop，材料视图切换，readonly 隐藏操作 |
| `app/pages/dashboard/cases/init-analysis/[sessionId].vue` | 修改 | 替换右面板组件，导入 `CaseDetailMaterialItem`，新增材料获取 |
| `app/components/initAnalysis/MaterialList.vue` | 删除 | 被 `CaseDetailOverview` 替代 |

---

### Task 1: CaseAnalysisResults 增加 readonly prop

**Files:**
- Modify: `app/components/case/AnalysisResults.vue:44-97` (Props), `:264-274` (handleCardClick), `:277-290` (getCardSubtext), `:420-450` (dashboard header), `:455-494` (grid cards), `:498-538` (list cards), `:567-598` (detail actions)

- [ ] **Step 1: 在 Props 接口中增加 readonly 属性**

在 `app/components/case/AnalysisResults.vue` 的 Props 接口（约第 81 行 `hasPendingInterrupt` 之后）添加：

```typescript
/** 只读模式：禁用生成操作和模块对话 */
readonly?: boolean
```

- [ ] **Step 2: 计算有效的 showRegenerate 和 showBatchButton**

在 `withDefaults` 之后（约第 97 行后），添加 computed 让 readonly 覆盖这两个 prop：

```typescript
// readonly 模式覆盖
const effectiveShowRegenerate = computed(() => props.readonly ? false : props.showRegenerate)
const effectiveShowBatchButton = computed(() => props.readonly ? false : props.showBatchButton)
```

- [ ] **Step 3: 修改 handleCardClick 函数**

在 `handleCardClick` 函数（约第 264 行）的 `if (isCardDisabled(card)) return` 之后添加 readonly 拦截：

```typescript
if (props.readonly && card.status !== 'complete') return
```

- [ ] **Step 4: 修改 getCardSubtext 函数**

在 `getCardSubtext` 函数中修改 failed 和 idle 的文案。将：

```typescript
if (card.status === 'failed') {
    if (card.locked) return '等待当前批次完成后可重试'
    return '生成失败，点击重试'
}
if (card.status === 'idle') {
    if (card.locked) return '等待执行'
    return '点击生成'
}
```

改为：

```typescript
if (card.status === 'failed') {
    if (props.readonly) return '生成失败'
    if (card.locked) return '等待当前批次完成后可重试'
    return '生成失败，点击重试'
}
if (card.status === 'idle') {
    if (props.readonly) return '未生成'
    if (card.locked) return '等待执行'
    return '点击生成'
}
```

- [ ] **Step 5: 修改 isCardDisabled 函数**

在 `isCardDisabled` 函数中，为 readonly 模式下的 idle/failed 卡片添加禁用：

```typescript
function isCardDisabled(card: AnalysisModuleCard): boolean {
    if (props.readonly && card.status !== 'complete') return true
    if (props.hasPendingInterrupt && card.status !== 'complete') return true
    if (card.locked) return true
    return false
}
```

- [ ] **Step 6: 替换模板中的 showBatchButton 和 showRegenerate 引用**

在模板中将所有 `showBatchButton` 替换为 `effectiveShowBatchButton`，`showRegenerate` 替换为 `effectiveShowRegenerate`。具体位置：

1. 约第 431 行：`v-if="showBatchButton"` → `v-if="effectiveShowBatchButton"`
2. 约第 581 行：`v-if="showRegenerate"` → `v-if="effectiveShowRegenerate"`

- [ ] **Step 7: 验证案件详情页不受影响**

运行开发服务器 `bun dev`，打开案件详情页，验证：
- 概览中分析结果卡片正常可点击
- 批量分析按钮正常显示
- 详情视图中模块对话按钮正常显示

- [ ] **Step 8: 提交**

```bash
git add app/components/case/AnalysisResults.vue
git commit -m "feat(analysis): CaseAnalysisResults 增加 readonly prop"
```

---

### Task 2: CaseDetailOverview 增加 readonly prop 和材料视图切换

**Files:**
- Modify: `app/components/caseDetail/CaseDetailOverview.vue`

**依赖:** Task 1（CaseAnalysisResults 的 readonly prop 已就绪）

- [ ] **Step 1: 在 Props 中增加 readonly 和 materialsLoading**

在 `defineProps` 的接口中增加：

```typescript
readonly?: boolean
materialsLoading?: boolean
```

- [ ] **Step 2: 在 import 区增加 LayoutGridIcon 和 ListIcon**

在 lucide-vue-next 的 import 中添加 `LayoutGridIcon` 和 `ListIcon`。

- [ ] **Step 3: 增加 materialViewMode ref**

在 script 区添加：

```typescript
const materialViewMode = ref<'grid' | 'list'>('grid')
```

- [ ] **Step 4: 修改案件信息 header — readonly 隐藏编辑按钮**

将案件信息区域的 header 部分（约第 152-179 行）中的编辑/保存/取消按钮用 `v-if="!readonly"` 包裹：

```vue
<div class="p-4 flex items-center justify-between pb-2">
  <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
    <FileTextIcon class="size-4" />
    案件基本信息
  </h3>
  <div v-if="!readonly" class="flex items-center gap-2">
    <!-- 现有的编辑/保存/取消按钮保持不变 -->
  </div>
</div>
```

- [ ] **Step 5: InitAnalysisCaseInfoCard 条件传 editable**

将第 181 行：

```vue
<InitAnalysisCaseInfoCard ref="infoCardRef" :case-id="caseId" editable hide-header
```

改为：

```vue
<InitAnalysisCaseInfoCard ref="infoCardRef" :case-id="caseId" :editable="!readonly" hide-header
```

- [ ] **Step 6: 修改材料 header — readonly 隐藏操作按钮，增加视图切换**

替换材料区域的 header 部分（约第 186-215 行）。readonly 时只显示标题和视图切换按钮：

```vue
<div class="p-4 flex items-center justify-between pb-0">
  <h3 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
    <FileTextIcon class="size-4" />
    案件材料
    <Badge v-if="materials.length > 0" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">
      {{ materials.length }}
    </Badge>
  </h3>
  <div class="flex items-center gap-4">
    <template v-if="!readonly">
      <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        :disabled="isAddingMaterials" @click="openMaterialSelector">
        <Loader2Icon v-if="isAddingMaterials" class="size-3 animate-spin" />
        <PlusIcon v-else class="size-3" />
        添加材料
      </button>
      <div class="w-px h-3 bg-border"></div>
      <button v-if="materials.length > 0"
        class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        @click="emit('navigateToSelectMode')">
        <CheckSquareIcon class="size-3" />
        批量管理
      </button>
      <div v-if="materials.length > 0" class="w-px h-3 bg-border"></div>
      <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        @click="emit('navigateView', 'materials')">
        <EyeIcon class="size-3" />
        查看全部
      </button>
      <div class="w-px h-3 bg-border"></div>
    </template>
    <!-- 视图切换（始终显示） -->
    <div class="flex items-center bg-muted/50 rounded-lg p-0.5">
      <button class="size-7 flex items-center justify-center rounded-md transition-all"
        :class="materialViewMode === 'grid' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="materialViewMode = 'grid'">
        <LayoutGridIcon class="size-3.5" />
      </button>
      <button class="size-7 flex items-center justify-center rounded-md transition-all"
        :class="materialViewMode === 'list' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="materialViewMode = 'list'">
        <ListIcon class="size-3.5" />
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 7: 添加材料加载骨架屏**

在材料网格区域（约第 218 行）的 `<div class="p-4 pt-3">` 内最前面增加加载状态。`Skeleton` 组件由 Nuxt 自动导入（`app/components/ui/skeleton`），无需手动 import：

```vue
<!-- 加载状态 -->
<div v-if="materialsLoading" class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
  <div v-for="i in 4" :key="i" class="p-3 rounded-xl bg-muted/40 flex flex-col items-center text-center space-y-2">
    <Skeleton class="size-11 rounded-lg" />
    <div class="space-y-1.5 w-full">
      <Skeleton class="h-3 w-3/4 mx-auto" />
      <Skeleton class="h-2.5 w-1/2 mx-auto" />
    </div>
  </div>
</div>
```

然后将现有的空状态 `v-if="materials.length === 0"` 改为 `v-else-if="materials.length === 0"`，网格改为 `v-else`。

- [ ] **Step 8: 材料网格区域增加视图切换和列表视图**

替换材料网格的整个区域，支持 grid/list 切换。将现有的网格 `<div v-else class="grid ...">` 区域替换为带 Transition 的切换：

```vue
<Transition v-else name="view-fade" mode="out-in">
  <!-- 网格视图 -->
  <div v-if="materialViewMode === 'grid'" key="grid" class="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
    <!-- 现有的卡片渲染，保持不变 -->
  </div>

  <!-- 列表视图 -->
  <div v-else key="list" class="space-y-1">
    <div v-for="material in materials" :key="material.id"
      class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group border border-transparent hover:border-border/50 cursor-pointer"
      @click="emit('previewMaterial', material)">
      <div :class="['flex items-center justify-center size-9 rounded-lg shrink-0', getMaterialBgColor(material.type)]">
        <component :is="getMaterialIcon(material.type)" :class="['size-5', getMaterialIconColor(material.type)]" />
      </div>
      <div class="flex-1 min-w-0 text-left">
        <div class="text-sm font-medium truncate group-hover:text-primary transition-colors">
          {{ material.name }}
        </div>
        <div class="text-[11px] text-muted-foreground/60 flex items-center gap-2">
          <span>{{ material.typeText }}</span>
          <span v-if="material.fileSize" class="size-0.5 rounded-full bg-muted-foreground/30"></span>
          <span v-if="material.fileSize">{{ formatByteSize(material.fileSize, 0) }}</span>
          <template v-if="getMaterialDisplayStatus(material)">
            <span class="size-0.5 rounded-full bg-muted-foreground/30"></span>
            <span v-if="!getMaterialDisplayStatus(material)!.showRetry || readonly"
              :class="getMaterialDisplayStatus(material)!.color" class="flex items-center gap-0.5">
              <Loader2Icon v-if="getMaterialDisplayStatus(material)!.spinning" class="size-2.5 animate-spin" />
              {{ getMaterialDisplayStatus(material)!.text }}
            </span>
            <button v-else class="text-destructive hover:text-primary transition-colors flex items-center gap-0.5"
              @click.stop="emit('retryMaterial', material.id, material.ossFileId!)">
              {{ getMaterialDisplayStatus(material)!.text }}
              <RefreshCwIcon class="size-2.5" />
            </button>
          </template>
        </div>
      </div>
      <button v-if="!readonly"
        class="size-8 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
        title="删除" @click.stop="confirmDelete(material.id)">
        <Trash2Icon class="size-3.5" />
      </button>
    </div>
  </div>
</Transition>
```

- [ ] **Step 9: 网格视图卡片中 readonly 隐藏删除和重试按钮**

在网格视图的卡片中：

1. 删除按钮：将 `<button class="absolute top-1 right-1 ..."` 的现有代码包裹 `v-if="!readonly"`
2. 识别失败的重试按钮：在状态显示模板中，将重试按钮的条件从 `v-else` 改为 `v-else-if="!readonly"`，并添加 readonly 时的纯文本展示

- [ ] **Step 10: readonly 时隐藏分析结果区域**

将分析结果区域（从 `<Separator class="mx-4 opacity-50" />` 到 `CaseAnalysisResults` 结束，约第 265-293 行）用 `v-if="!readonly"` 的 `<template>` 包裹：

```vue
<template v-if="!readonly">
  <Separator class="mx-4 opacity-50" />
  <!-- 分析结果 header + CaseAnalysisResults -->
  ...
</template>
```

- [ ] **Step 11: readonly 时不渲染弹窗组件**

将 `CaseAnalysisMaterialSelector` 和删除确认 `AlertDialog` 用 `v-if="!readonly"` 包裹。

- [ ] **Step 12: 添加 view-fade transition 样式**

在 `<style scoped>` 区域添加（如果尚不存在）：

```css
.view-fade-enter-active,
.view-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.view-fade-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.99);
}
.view-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.99);
}
```

- [ ] **Step 13: 验证案件详情页不受影响**

打开案件详情页概览，验证：
- 编辑按钮正常显示
- 材料区有视图切换控件（新功能）
- 添加/删除/批量管理功能正常
- 分析结果区正常显示

- [ ] **Step 14: 提交**

```bash
git add app/components/caseDetail/CaseDetailOverview.vue
git commit -m "feat(ui): CaseDetailOverview 增加 readonly prop 和材料视图切换"
```

---

### Task 3: 初始化分析页替换右面板组件

**Files:**
- Modify: `app/pages/dashboard/cases/init-analysis/[sessionId].vue`

**依赖:** Task 1, Task 2

- [ ] **Step 1: 导入 CaseDetailMaterialItem 类型**

在 script 区的 import 部分添加：

```typescript
import type { CaseDetailMaterialItem } from '~/composables/useCaseDetail'
```

- [ ] **Step 2: 移除局部 MaterialItem 接口**

删除第 151-164 行的 `interface MaterialItem { ... }` 定义。

- [ ] **Step 3: 替换所有 MaterialItem 类型引用为 CaseDetailMaterialItem**

将以下位置的 `MaterialItem` 改为 `CaseDetailMaterialItem`：
1. `previewMaterial` 的 ref 声明：`ref<MaterialItem | null>(null)` → `ref<CaseDetailMaterialItem | null>(null)`
2. `openMaterialPreview` 函数参数类型：`(material: MaterialItem)` → `(material: CaseDetailMaterialItem)`

- [ ] **Step 4: 新增材料获取逻辑**

移除 `materialListRef` ref（不再需要），添加材料获取相关代码：

```typescript
// 材料数据
const materials = ref<CaseDetailMaterialItem[]>([])
const materialsLoading = ref(false)

async function loadMaterials(id: number) {
  if (id <= 0) return
  materialsLoading.value = true
  try {
    const data = await useApiFetch<CaseDetailMaterialItem[]>(`/api/v1/case/${id}/materials`)
    if (data) materials.value = data
  } finally {
    materialsLoading.value = false
  }
}
```

在现有的 `watch(caseId, ...)` 中调用 `loadMaterials(id)`：

```typescript
watch(caseId, async (id) => {
  if (id <= 0) return
  // 加载材料
  loadMaterials(id)
  // 现有的加载案件标题和已完成模块逻辑保持不变
  ...
}, { immediate: true })
```

- [ ] **Step 5: 替换 right-panel 模板**

将 `<template #right-panel>` 的内容替换为：

```vue
<template #right-panel>
  <div class="h-full flex flex-col bg-background border-l">
    <!-- 仪表盘模式：可滚动 -->
    <div v-show="rightPanelViewMode === 'dashboard'" class="flex-1 overflow-y-auto">
      <div class="flex flex-col">
        <!-- 案件信息 + 材料（复用 CaseDetailOverview 只读模式） -->
        <CaseDetailOverview
          v-if="caseId > 0"
          :case-id="caseId"
          :materials="materials"
          :materials-loading="materialsLoading"
          :analysis-results="[]"
          :readonly="true"
          @preview-material="openMaterialPreview"
        />

        <Separator class="opacity-50" />

        <!-- 分析结果（独立渲染，readonly） -->
        <CaseAnalysisResults
          v-if="phase !== 'select'"
          :results="completedResults"
          v-model:active-index="activeIndex"
          v-model:view-mode="rightPanelViewMode"
          :is-analyzing="phase === 'running'"
          :readonly="true"
          empty-title="分析结果处理中"
          empty-description="AI 正在读取案件材料并生成分析建议，请稍等..."
        />
      </div>
    </div>

    <!-- 详情模式：沉浸式阅读 -->
    <div v-if="rightPanelViewMode === 'detail'" class="flex-1 overflow-hidden">
      <CaseAnalysisResults
        :results="completedResults"
        v-model:active-index="activeIndex"
        v-model:view-mode="rightPanelViewMode"
        :is-analyzing="phase === 'running'"
        :readonly="true"
      />
    </div>
  </div>
</template>
```

注意：`CaseDetailOverview` 的 `fileRecognitionStatus` 和 `getRecognitionStatus` props 是可选的。初始化分析页不传入这两个 prop，材料识别状态将通过 API 返回的 `status` 字段展示（1=待识别, 2=识别中, 3=已完成, 4=识别失败），这与原 `InitAnalysisMaterialList` 的行为一致。如果后续需要前端实时轮询识别状态，可引入 `useFileRecognition` composable 并传入对应 props。

- [ ] **Step 6: 清理不再需要的 import**

如果 `FileTextIcon` 和 `Loader2Icon` 仅被 `InitAnalysisMaterialList` 相关代码使用，检查是否仍需要。注意 `FileTextIcon` 在文本预览弹窗中仍被使用，`Loader2Icon` 在文本加载中仍被使用——保留它们。

- [ ] **Step 7: 验证初始化分析页**

运行 `bun dev`，打开初始化分析页，验证：
- 右面板案件信息样式与案件详情页一致
- 案件信息不可编辑
- 材料以网格展示，可切换到列表视图
- 材料无添加/删除/批量管理按钮
- 点击材料卡片可预览
- 分析结果展示正常，idle/failed 卡片不可操作
- complete 卡片可点击进入 detail 模式
- detail 模式无"模块对话"按钮
- detail 模式有复制、翻页按钮

- [ ] **Step 8: 提交**

```bash
git add app/pages/dashboard/cases/init-analysis/[sessionId].vue
git commit -m "feat(analysis): 初始化分析页右面板复用 CaseDetailOverview 只读模式"
```

---

### Task 4: 清理旧组件

**Files:**
- Delete: `app/components/initAnalysis/MaterialList.vue`

**依赖:** Task 3

- [ ] **Step 1: 确认 MaterialList 无其他引用**

搜索项目中 `InitAnalysisMaterialList` 或 `MaterialList` 的引用：

```bash
grep -r "InitAnalysisMaterialList\|initAnalysis/MaterialList" app/ --include="*.vue" --include="*.ts"
```

确认仅在已修改的 `[sessionId].vue` 中有引用（已移除）。

- [ ] **Step 2: 删除 MaterialList.vue**

```bash
rm app/components/initAnalysis/MaterialList.vue
```

- [ ] **Step 3: 验证构建无报错**

```bash
npx nuxi typecheck
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore(analysis): 移除不再使用的 InitAnalysisMaterialList 组件"
```

---

### Task 5: 端到端验证

**依赖:** Task 1-4

- [ ] **Step 1: 验证案件详情页**

打开案件详情页，检查：
- 概览视图：案件信息可编辑、材料可添加/删除/预览、视图切换可用（新功能）
- 分析结果：正常交互、批量分析可用、模块对话可用

- [ ] **Step 2: 验证初始化分析页**

打开初始化分析页，从模块选择开始完整走一遍流程：
- 右面板展开后：案件信息只读、材料只读可切换视图、无操作按钮
- 分析进行中：分析结果卡片正确显示状态
- 分析完成：complete 卡片可进入 detail、detail 中无模块对话按钮

- [ ] **Step 3: typecheck**

```bash
npx nuxi typecheck
```

- [ ] **Step 4: 最终提交（如有修复）**

```bash
git add -A
git commit -m "fix(analysis): 修复端到端验证发现的问题"
```
