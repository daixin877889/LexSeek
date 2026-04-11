# 未生成分析模块入口 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在案件详情页始终展示全部 7 个分析模块卡片（四态：complete/in_progress/idle/failed），支持单个生成（模块对话 + 自动发消息）和批量生成（原地调用 init-analysis API）。

**Architecture:** 纯前端改动。新增 `AnalysisModuleCard` 类型 + `useCaseDetail.allModuleCards` computed（四态 + 锁定逻辑），`AnalysisResults.vue` 支持双 v-model（`activeIndex`/`activeModule`）和四态卡片渲染，`useModuleChatManager` 新增 `generatingModules`（watch + ref）和 `autoMessage` 支持。URL `?ai` 参数从数字索引改为 moduleName。

**Tech Stack:** Vue 3, TypeScript, Nuxt 4, Tailwind CSS v4, shadcn-vue

**Spec:** `docs/superpowers/specs/2026-04-11-ungenerated-module-entry-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `shared/types/case.ts` | 修改 | 新增 `AnalysisModuleDisplayStatus` + `AnalysisModuleCard` 类型 |
| `app/composables/useModuleChatManager.ts` | 修改 | 新增 `generatingModules`（watch+ref）+ `autoMessage` 参数 |
| `app/composables/useCaseDetail.ts` | 修改 | 新增 `allModuleCards` + 状态标志（`isInitAnalysisRunning` 等） |
| `app/components/case/AnalysisResults.vue` | 修改 | 四态卡片渲染 + 双 v-model + `generateModule`/`batchGenerate` emit |
| `app/components/caseDetail/CaseDetailAnalysis.vue` | 修改 | `activeIndex` → `activeModule` + 新 props 透传 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 修改 | `navigateAnalysis` emit 迁移 + 新 props 透传 |
| `app/pages/dashboard/cases/[id].vue` | 修改 | URL 参数迁移 + `handleGenerateModule` + `handleBatchGenerate` |

---

## Task 1: 新增类型定义

**Files:**
- Modify: `shared/types/case.ts:399-407`

- [ ] **Step 1: 在 `AnalysisResult` 接口之后添加新类型**

在 `shared/types/case.ts` 的 `AnalysisResult` 接口后（约 408 行）插入：

```typescript
/** 分析模块展示状态 */
export type AnalysisModuleDisplayStatus = 'complete' | 'in_progress' | 'idle' | 'failed'

/** 分析模块卡片数据（四态 + 锁定） */
export interface AnalysisModuleCard {
  moduleName: string
  moduleTitle: string
  status: AnalysisModuleDisplayStatus
  /** 是否被 init-analysis 流程锁定 */
  locked?: boolean
  /** status=complete 时有值 */
  content?: string
  analyzedAt?: string
  version?: number
}
```

- [ ] **Step 2: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: PASS（新增类型不影响现有代码）

- [ ] **Step 3: 提交**

```bash
git add shared/types/case.ts
git commit -m "feat(types): 新增 AnalysisModuleCard 四态卡片类型"
```

---

## Task 2: useModuleChatManager 新增 generatingModules + autoMessage

**Files:**
- Modify: `app/composables/useModuleChatManager.ts`

- [ ] **Step 1: 新增 `generatingModules` ref 和 `watchInstanceLoading` 函数**

在 `useModuleChatManager` 函数体开头（`const instances = ...` 之后）添加：

```typescript
const generatingModules = ref<string[]>([])

function watchInstanceLoading(instance: ModuleChatInstance) {
  watch(() => instance.isLoading.value, () => {
    generatingModules.value = Object.keys(instances)
      .filter(name => instances[name]?.isLoading?.value)
  }, { immediate: true })
}
```

- [ ] **Step 2: 在 effectScope 内注册 watch**

在 `getOrCreateModuleManager` 函数中，`const instance: ModuleChatInstance = ...` 赋值后、`instances[moduleName] = instance` 之前，在 scope 内注册 watch：

```typescript
scope.run(() => watchInstanceLoading(instance))
```

注意：`watchInstanceLoading` 调用需在 `scope.run()` 内确保 effectScope 管理清理。

- [ ] **Step 3: 修改 `getOrCreateModuleManager` 支持 `autoMessage`**

修改函数签名：

```typescript
async function getOrCreateModuleManager(
  moduleName: string,
  moduleTitle: string,
  options?: { autoMessage?: string },
): Promise<ModuleChatInstance> {
```

在 `await manager.init()` 之后、`return instance` 之前添加自动发消息逻辑：

```typescript
// 自动发送生成消息（仅首次创建时）
if (options?.autoMessage && manager.sendMessage) {
  await manager.sendMessage(options.autoMessage)
}
```

注意：这段逻辑在 `if (instances[moduleName]) return instances[moduleName]` **之后**才执行，确保 instance 已存在时不会重复发消息。

- [ ] **Step 4: 在 return 中导出 `generatingModules`**

```typescript
return {
  // ... 现有导出
  generatingModules,
}
```

- [ ] **Step 5: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: PASS

- [ ] **Step 6: 验证 SSE 清理机制（spec 6.8）**

检查 `useStreamChat.ts` 和 `@langchain/vue` 的 `useStream` 是否在 effectScope 销毁时自动 abort SSE 连接。搜索 `onScopeDispose`、`AbortController`、`abort` 关键词。如果没有自动清理，**替换**现有 `useModuleChatManager.ts` 第 130-134 行的 `onUnmounted`（不要新增第二个）：

```typescript
onUnmounted(() => {
  // 显式停止所有活跃的流式连接
  for (const name of Object.keys(instances)) {
    instances[name]?.stop?.()
  }
  for (const scope of scopes) {
    scope.stop()
  }
})
```

- [ ] **Step 7: 提交**

```bash
git add app/composables/useModuleChatManager.ts
git commit -m "feat(analysis): useModuleChatManager 新增 generatingModules 和 autoMessage 支持"
```

---

## Task 3: useCaseDetail 新增 allModuleCards + 状态标志

**Files:**
- Modify: `app/composables/useCaseDetail.ts`

- [ ] **Step 1: 修改函数签名，新增 options 参数**

```typescript
import type { AnalysisModuleCard } from '#shared/types/case'

export function useCaseDetail(
  caseId: Ref<number> | ComputedRef<number>,
  options?: { generatingModules?: Ref<string[]> },
) {
```

- [ ] **Step 2: 新增派生状态 computed**

在 `analysisStatus` 声明之后添加：

```typescript
const isInitAnalysisRunning = computed(() =>
  analysisStatus.value?.status === 'in_progress',
)

const hasPendingInterrupt = computed(() =>
  analysisStatus.value?.hasPendingInterrupt === true,
)

const lockedModules = computed<Set<string>>(() => {
  if (!isInitAnalysisRunning.value) return new Set()
  const status = analysisStatus.value
  if (!status?.selectedModules?.length) return new Set()
  const moduleMap = new Map(status.modules?.map(m => [m.name, m]) ?? [])
  return new Set(
    status.selectedModules.filter(name => {
      const m = moduleMap.get(name)
      return m?.status !== 'complete'
    }),
  )
})
```

- [ ] **Step 3: 新增 `allModuleCards` computed**

在 `analysisResults` computed 之后添加：

```typescript
const allModuleCards = computed<AnalysisModuleCard[]>(() => {
  const status = analysisStatus.value
  const moduleMap = new Map(status?.modules?.map(m => [m.name, m]) ?? [])
  const generating = new Set(options?.generatingModules?.value ?? [])
  const locked = lockedModules.value

  return INIT_ANALYSIS_MODULES.map(def => {
    const m = moduleMap.get(def.name)
    const isLocked = locked.has(def.name)

    if (m?.status === 'complete' && m.result) {
      return {
        moduleName: def.name,
        moduleTitle: def.title,
        status: 'complete' as const,
        content: m.result,
        analyzedAt: m.analyzedAt ?? '',
        version: m.version ?? 1,
      }
    }
    if (m?.status === 'failed') {
      return {
        moduleName: def.name,
        moduleTitle: def.title,
        status: 'failed' as const,
        locked: isLocked,
      }
    }
    if (m?.status === 'in_progress' || generating.has(def.name)) {
      return {
        moduleName: def.name,
        moduleTitle: def.title,
        status: 'in_progress' as const,
        locked: isLocked,
      }
    }
    return {
      moduleName: def.name,
      moduleTitle: def.title,
      status: 'idle' as const,
      locked: isLocked,
    }
  })
})
```

- [ ] **Step 4: 新增 `showBatchButton` computed**

```typescript
const showBatchButton = computed(() =>
  !isInitAnalysisRunning.value
  && !hasPendingInterrupt.value
  && allModuleCards.value.some(c => c.status === 'idle' && !c.locked),
)
```

- [ ] **Step 5: 更新 return 导出**

```typescript
return {
  // ... 现有导出
  allModuleCards,
  showBatchButton,
  isInitAnalysisRunning,
  hasPendingInterrupt,
  lockedModules,
}
```

- [ ] **Step 6: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add app/composables/useCaseDetail.ts
git commit -m "feat(analysis): useCaseDetail 新增 allModuleCards 四态卡片和状态标志"
```

---

## Task 4: AnalysisResults.vue 四态卡片 + 双 v-model

**Files:**
- Modify: `app/components/case/AnalysisResults.vue`

这是改动最大的组件。分 3 个子步骤：Props/Emits 改造 → 四态卡片渲染 → 详情翻页逻辑。

- [ ] **Step 1: 新增 Props 和 Emits**

新增 `moduleCards`、`activeModule`、`showBatchButton`、`hasPendingInterrupt` props；新增 `generateModule`、`batchGenerate`、`update:activeModule` emits：

```typescript
import type { AnalysisModuleCard, AnalysisModuleDisplayStatus } from '#shared/types/case'

interface Props {
  // 现有 props 保留不变
  results: AnalysisResult[]
  // 新增
  moduleCards?: AnalysisModuleCard[]
  activeModule?: string | null
  showBatchButton?: boolean
  hasPendingInterrupt?: boolean
  // ... 其他现有 props
}

const emit = defineEmits<{
  // 现有 emits 保留
  (e: 'update:activeIndex', index: number): void
  (e: 'update:viewMode', mode: 'dashboard' | 'detail'): void
  (e: 'regenerate', result: AnalysisResult): void
  (e: 'copy', result: AnalysisResult): void
  (e: 'versionChanged'): void
  // 新增
  (e: 'update:activeModule', moduleName: string | null): void
  (e: 'generateModule', moduleName: string, moduleTitle: string): void
  (e: 'batchGenerate'): void
}>()
```

- [ ] **Step 2: 新增内部双模式状态解析**

```typescript
// 数据源：优先 moduleCards（新模式），回退 results（旧模式）
const cards = computed<AnalysisModuleCard[]>(() => {
  if (props.moduleCards?.length) return props.moduleCards
  // 旧模式兼容：将 AnalysisResult[] 映射为 AnalysisModuleCard[]
  return props.results.map(r => ({
    moduleName: r.moduleName,
    moduleTitle: r.moduleTitle,
    status: 'complete' as const,
    content: r.content,
    analyzedAt: r.analyzedAt,
    version: r.version,
  }))
})

// 只有 complete 的卡片可进入详情
const completeCards = computed(() => cards.value.filter(c => c.status === 'complete'))

// 双模式 activeModule 解析
const currentModuleName = computed({
  get: () => {
    if (props.activeModule !== undefined) return props.activeModule
    // 旧模式：从 activeIndex 映射
    const idx = props.activeIndex ?? 0
    return completeCards.value[idx]?.moduleName ?? null
  },
  set: (val) => {
    if (props.activeModule !== undefined) emit('update:activeModule', val)
    if (props.activeIndex !== undefined) {
      const idx = completeCards.value.findIndex(c => c.moduleName === val)
      emit('update:activeIndex', idx >= 0 ? idx : 0)
    }
  },
})

const currentResult = computed(() => {
  if (!currentModuleName.value) return completeCards.value[0] ?? null
  return completeCards.value.find(c => c.moduleName === currentModuleName.value) ?? completeCards.value[0] ?? null
})
```

- [ ] **Step 3: 重构仪表盘视图（网格模式）— 四态卡片渲染**

替换网格模式的 `v-for` 循环，遍历 `cards` 而非 `results`。根据 `card.status` + `card.locked` + `hasPendingInterrupt` 渲染不同样式。

关键样式判断逻辑：

```typescript
function isCardDisabled(card: AnalysisModuleCard): boolean {
  if (props.hasPendingInterrupt && card.status !== 'complete') return true
  if (card.locked) return true
  return false
}

function handleCardClick(card: AnalysisModuleCard) {
  if (isCardDisabled(card)) return
  if (card.status === 'complete') {
    currentModuleName.value = card.moduleName
    currentViewMode.value = 'detail'
    return
  }
  if (card.status === 'idle' || card.status === 'failed' || card.status === 'in_progress') {
    emit('generateModule', card.moduleName, card.moduleTitle)
  }
}
```

网格卡片模板要点：
- `:key="card.moduleName"` （替代 `result.nodeId`）
- complete: 现有样式不变
- in_progress: `border-primary/30` + Loader2Icon 旋转 + "生成中..."
- idle: `border-dashed border-muted-foreground/30` + 灰色图标 + "点击生成"
- idle + locked: 加 `opacity-60` + "等待执行"
- failed: `border-destructive/30` + AlertCircleIcon + "生成失败，点击重试"
- failed + locked: 红色图标但 `pointer-events-none` + "等待当前批次完成后可重试"
- disabled 态统一 `pointer-events-none opacity-60`

- [ ] **Step 4: 重构仪表盘视图（列表模式）— 同样四态**

与网格模式相同的状态逻辑，但用列表布局。

- [ ] **Step 5: 仪表盘头部添加"批量分析"按钮**

在现有的视图切换按钮区域左侧添加：

```vue
<button
  v-if="showBatchButton"
  class="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
  @click="emit('batchGenerate')"
>
  <PlusIcon class="size-3" />
  批量分析
</button>
```

需要在 import 中添加 `PlusIcon`、`AlertCircleIcon`。

- [ ] **Step 6: 重构详情视图翻页为 complete-only 导航**

替换 `goToPrev`/`goToNext`，在 `completeCards` 内导航：

```typescript
function goToPrev() {
  const idx = completeCards.value.findIndex(c => c.moduleName === currentModuleName.value)
  if (idx > 0) currentModuleName.value = completeCards.value[idx - 1].moduleName
}

function goToNext() {
  const idx = completeCards.value.findIndex(c => c.moduleName === currentModuleName.value)
  if (idx < completeCards.value.length - 1) currentModuleName.value = completeCards.value[idx + 1].moduleName
}
```

翻页按钮的 disabled 条件也需更新。

- [ ] **Step 7: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add app/components/case/AnalysisResults.vue
git commit -m "feat(ui): AnalysisResults 支持四态卡片渲染和双 v-model"
```

---

## Task 5: CaseDetailAnalysis.vue 迁移

**Files:**
- Modify: `app/components/caseDetail/CaseDetailAnalysis.vue`

- [ ] **Step 1: 修改 Props/Emits/defineModel**

```typescript
import type { AnalysisModuleCard } from '#shared/types/case'

const props = defineProps<{
  caseId: number
  results: AnalysisResult[]
  moduleCards?: AnalysisModuleCard[]
  showBatchButton?: boolean
  hasPendingInterrupt?: boolean
}>()

const emit = defineEmits<{
  versionChanged: []
  regenerate: [result: AnalysisResult]
  generateModule: [moduleName: string, moduleTitle: string]
  batchGenerate: []
}>()

// activeIndex → activeModule
const activeModule = defineModel<string | null>('activeModule', { default: null })
const viewMode = defineModel<'dashboard' | 'detail'>('viewMode', { default: 'dashboard' })
```

- [ ] **Step 2: 更新模板**

```vue
<CaseAnalysisResults
  :results="results"
  :module-cards="moduleCards"
  :case-id="caseId"
  v-model:active-module="activeModule"
  v-model:view-mode="viewMode"
  :show-regenerate="true"
  :show-copy="true"
  :show-versions="true"
  :show-batch-button="showBatchButton"
  :has-pending-interrupt="hasPendingInterrupt"
  class="h-full"
  @version-changed="emit('versionChanged')"
  @regenerate="(result) => emit('regenerate', result)"
  @generate-module="(name, title) => emit('generateModule', name, title)"
  @batch-generate="emit('batchGenerate')"
/>
```

- [ ] **Step 3: 运行类型检查 + 提交**

```bash
npx nuxi typecheck
git add app/components/caseDetail/CaseDetailAnalysis.vue
git commit -m "feat(ui): CaseDetailAnalysis 迁移到 activeModule 和四态卡片"
```

---

## Task 6: CaseDetailOverview.vue 迁移

**Files:**
- Modify: `app/components/caseDetail/CaseDetailOverview.vue`

- [ ] **Step 1: 修改 Props/Emits**

新增 props：`moduleCards`、`showBatchButton`、`hasPendingInterrupt`。
修改 emit：`navigateAnalysis: [index: number]` → `navigateAnalysis: [moduleName: string]`。
新增 emit：`generateModule`、`batchGenerate`。

> **`hasPendingInterrupt` 透传路径**：`[id].vue` → `CaseDetailOverview` → `AnalysisResults`。需在三层组件中依次传递该 prop，用于控制卡片禁用态。

- [ ] **Step 2: 内部状态迁移**

```typescript
// 之前
const analysisActiveIndex = ref(0)
// 之后
const analysisActiveModule = ref<string | null>(null)
```

- [ ] **Step 3: 修改 watch 拦截逻辑和模板**

watch：

```typescript
watch(analysisViewMode, (mode) => {
  if (mode === 'detail' && analysisActiveModule.value) {
    nextTick(() => { analysisViewMode.value = 'dashboard' })
    emit('navigateAnalysis', analysisActiveModule.value)
  }
})
```

模板中 `<CaseAnalysisResults>` 绑定：
- `v-model:active-index` → `v-model:active-module`
- 新增 `:module-cards`、`:show-batch-button`、`:has-pending-interrupt`
- 新增 `@generate-module`、`@batch-generate` 事件透传

- [ ] **Step 4: 运行类型检查 + 提交**

```bash
npx nuxi typecheck
git add app/components/caseDetail/CaseDetailOverview.vue
git commit -m "feat(ui): CaseDetailOverview 迁移到 activeModule 和四态卡片"
```

---

## Task 7: [id].vue 主页面集成

**Files:**
- Modify: `app/pages/dashboard/cases/[id].vue`

- [ ] **Step 1: URL 参数迁移**

```typescript
import { VALID_MODULE_NAMES } from '#shared/types/initAnalysis'

// 替换 analysisIndex
const rawAi = route.query.ai
const analysisModule = ref<string | null>(
  typeof rawAi === 'string' && VALID_MODULE_NAMES.includes(rawAi)
    ? rawAi
    : null,
)
```

更新 query watch：

```typescript
watch([activeView, analysisModule, analysisMode], ([view, am, mode]) => {
  const query: Record<string, string> = {}
  if (view !== 'overview') query.tab = view
  if (view === 'analysis') {
    if (am) query.ai = am
    if (mode === 'detail') query.am = 'detail'
  }
  router.replace({ query })
})
```

- [ ] **Step 2: 传递 generatingModules 给 useCaseDetail**

```typescript
const moduleChatManager = useModuleChatManager(caseId, { onAnalysisSaved: refreshAnalysis })

const {
  // ... 现有解构
  allModuleCards,
  showBatchButton,
  isInitAnalysisRunning,
  hasPendingInterrupt,
} = useCaseDetail(caseId, {
  generatingModules: moduleChatManager.generatingModules,
})
```

注意：`useCaseDetail` 调用必须在 `useModuleChatManager` 之后（依赖 `generatingModules`）。

- [ ] **Step 3: navigateToAnalysis 签名迁移**

```typescript
function navigateToAnalysis(moduleName: string) {
  analysisModule.value = moduleName
  analysisMode.value = 'detail'
  activeView.value = 'analysis'
}
```

- [ ] **Step 4: 新增 handleGenerateModule**

> **注意**：spec 6.3 中函数签名为 `(card: AnalysisModuleCard)`，此处改为 `(moduleName, moduleTitle)` 以匹配 `AnalysisResults.vue` 的 emit 签名 `generateModule: [moduleName: string, moduleTitle: string]`。函数内通过 `allModuleCards.value.find()` 查找 card 对象获取 status/locked 信息。spec 6.4 中 `handleBatchGenerate` 声明为非 async，此处改为 async 以支持 await。

```typescript
import type { AnalysisModuleCard } from '#shared/types/case'

const generatingGuard = new Set<string>()

async function handleGenerateModule(moduleName: string, moduleTitle: string) {
  if (generatingGuard.has(moduleName)) return
  generatingGuard.add(moduleName)

  try {
    const card = allModuleCards.value.find(c => c.moduleName === moduleName)
    if (!card || card.locked || hasPendingInterrupt.value) return

    if (card.status === 'in_progress') {
      // 仅重新展开对话窗口
      const instance = moduleChatManager.instances[moduleName]
      if (instance) moduleChatManager.expandModule(moduleName)
      return
    }

    // idle 或 failed → 创建 instance + 自动发消息
    await moduleChatManager.getOrCreateInstance(
      moduleName,
      moduleTitle,
      { autoMessage: `请为本案件生成${moduleTitle}分析报告` },
    )
    moduleChatManager.expandModule(moduleName)
  } finally {
    generatingGuard.delete(moduleName)
  }
}
```

- [ ] **Step 5: 新增 handleBatchGenerate（简化 SSE 方案）**

```typescript
const batchAbortController = ref<AbortController | null>(null)

async function handleBatchGenerate() {
  if (isInitAnalysisRunning.value || hasPendingInterrupt.value) return
  const targetModules = allModuleCards.value
    .filter(c => c.status === 'idle' && !c.locked)
    .map(c => c.moduleName)
  if (targetModules.length === 0) return

  const controller = new AbortController()
  batchAbortController.value = controller

  try {
    const response = await $fetch('/api/v1/case/init-analysis', {
      method: 'POST',
      body: { input: { caseId: caseId.value, selectedModules: targetModules } },
      signal: controller.signal,
      responseType: 'stream',
    })

    await refreshAnalysis()

    const reader = (response as ReadableStream).getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 每收到 values 事件刷新一次
      if (buffer.includes('event: values')) {
        await refreshAnalysis()
        buffer = ''
      }
      // 终态退出
      if (buffer.includes('"status":"COMPLETED"') || buffer.includes('"status":"FAILED"')) {
        break
      }
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') console.error('批量生成失败:', err)
  } finally {
    batchAbortController.value = null
    await refreshAnalysis()
  }
}

// 页面卸载时清理
onUnmounted(() => {
  batchAbortController.value?.abort()
})
```

- [ ] **Step 6: 更新模板绑定**

`<CaseDetailOverview>` 新增 props 和事件：
```vue
:module-cards="allModuleCards"
:show-batch-button="showBatchButton"
:has-pending-interrupt="hasPendingInterrupt"
@generate-module="handleGenerateModule"
@batch-generate="handleBatchGenerate"
```

`<CaseDetailAnalysis>` 修改：
```vue
v-model:active-index="analysisIndex"  →  v-model:active-module="analysisModule"
```
并新增：
```vue
:module-cards="allModuleCards"
:show-batch-button="showBatchButton"
:has-pending-interrupt="hasPendingInterrupt"
@generate-module="handleGenerateModule"
@batch-generate="handleBatchGenerate"
```

- [ ] **Step 7: idle 模块直达 URL 的降级 watch**

```typescript
// idle 模块直达详情模式时自动降级为 dashboard
watch([analysisModule, analysisMode, allModuleCards], ([mod, mode, cards]) => {
  if (mode === 'detail' && mod) {
    const card = cards.find(c => c.moduleName === mod)
    if (card && card.status !== 'complete') {
      analysisMode.value = 'dashboard'
    }
  }
})
```

- [ ] **Step 8: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add app/pages/dashboard/cases/[id].vue
git commit -m "feat(analysis): 案件详情页集成四态卡片、URL 参数迁移和生成事件处理"
```

---

## Task 8: 端到端验证

- [ ] **Step 1: 启动开发服务器**

Run: `bun dev`

- [ ] **Step 2: 手动验证所有场景**

1. 打开一个从未分析过的案件 → 应看到 7 个 idle 灰色卡片
2. 点击任一 idle 卡片 → 模块对话窗口打开 + 自动发送生成消息
3. 生成中卡片显示 Loader + "生成中..." → 再次点击重新展开窗口
4. 生成完成后卡片变为 complete → 点击可进入详情视图
5. 点击"批量分析"按钮 → 批量生成开始 → 卡片逐步从 idle → in_progress → complete
6. URL `?ai=summary` 参数正确同步
7. 详情视图翻页只在 complete 模块间切换
8. init-analysis 运行时批量按钮隐藏，locked 模块不可点击
9. init-analysis 运行中，非 selectedModules 的 idle 模块可单独生成
10. hasPendingInterrupt 时所有 idle/failed 卡片禁用，complete 模块仍可查看详情
11. 全部 7 个模块 complete 时"批量分析"按钮隐藏
12. 模块生成中刷新页面，刷新后该模块卡片仍显示 in_progress
13. `init-analysis/[sessionId].vue` 和 `analysis/[sessionId].vue` 页面功能不受影响（旧 `activeIndex` 模式正常）

- [ ] **Step 3: 运行类型检查确认无回归**

Run: `npx nuxi typecheck`
Expected: PASS

- [ ] **Step 4: 最终提交（如有微调）**

---

## 验证清单

- [ ] 类型检查通过 (`npx nuxi typecheck`)
- [ ] 7 个模块始终展示（包括从未分析的案件）
- [ ] 四态卡片样式正确（complete/in_progress/idle/failed）
- [ ] 单个生成路径正常（模块对话 + 自动发消息）
- [ ] 批量生成路径正常（批量分析按钮 + SSE）
- [ ] URL `?ai=moduleName` 正确同步
- [ ] locked 模块不可点击
- [ ] hasPendingInterrupt 时所有生成入口禁用
- [ ] 旧页面（init-analysis、analysis）功能不受影响
- [ ] 页面刷新后 generatingModules 正确恢复
