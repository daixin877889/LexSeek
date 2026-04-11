# 未生成分析模块入口设计

## 背景

案件详情页 `/dashboard/cases/[caseId]` 中，用户初始化分析时只选择了部分模块（如 summary + chronicle），分析完成后 UI 仅展示已完成的模块卡片。剩余未被选中的模块（如 claim、trend、cause、defense、evidence）在界面上完全不可见，没有入口去补充生成报告。

## 目标

- 在概览视图和分析结果视图中始终展示全部 7 个模块（包括从未分析过的案件）
- 支持两条生成路径：单个生成（模块对话窗口 + 自动发消息）和批量生成（原地调用 init-analysis API）
- 生成中的模块显示加载状态且不可点击

## 设计方案

### 1. 数据模型

#### 1.1 新增类型（`shared/types/case.ts`）

```typescript
export type AnalysisModuleDisplayStatus = 'complete' | 'in_progress' | 'idle' | 'failed'

export interface AnalysisModuleCard {
  moduleName: string
  moduleTitle: string
  status: AnalysisModuleDisplayStatus
  /** 是否被 init-analysis 流程锁定（等待执行或正在执行），锁定时不可单独生成 */
  locked?: boolean
  // status=complete 时有值
  content?: string
  analyzedAt?: string
  version?: number
}
```

不修改现有 `AnalysisResult` 接口。

> **v-for key**: 卡片列表的 `:key` 使用 `moduleName`（7 个模块间唯一），不使用 `nodeId`（idle/in_progress 时为 undefined 会冲突）。

> **icon 字段**: `AnalysisModuleCard` 不存储 `icon` 字段，复用 `AnalysisResults.vue` 已有的 `iconMap`（通过 `moduleName` 映射 Lucide 组件）。

#### 1.2 `useCaseDetail.ts` 新增 `allModuleCards` 和状态标志

需要两个前端派生状态：
- `generatingModules`: 正在通过模块对话生成的模块名集合（从 `moduleChatManager.instances` 派生，见第 3 节）
- `isInitAnalysisRunning`: init-analysis 工作流是否正在运行
- `hasPendingInterrupt`: init-analysis 是否处于待处理中断态（积分不足等）
- `lockedModules`: 被 init-analysis 锁定的模块集合（status.selectedModules 中所有非 complete 的）

```typescript
function useCaseDetail(
  caseId: Ref<number>,
  options?: { generatingModules?: Ref<string[]> }
) {
  // ...
  const isInitAnalysisRunning = computed(() =>
    analysisStatus.value?.status === 'in_progress',
  )

  const hasPendingInterrupt = computed(() =>
    analysisStatus.value?.hasPendingInterrupt === true,
  )

  // init-analysis 锁定的模块：status.selectedModules 中非 complete 的全部
  // （包括已经 in_progress 和还在等待串行执行的 idle）
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

  const allModuleCards = computed<AnalysisModuleCard[]>(() => {
    const status = analysisStatus.value
    const moduleMap = new Map(status?.modules?.map(m => [m.name, m]) ?? [])
    const generating = new Set(options?.generatingModules?.value ?? [])
    const locked = lockedModules.value

    return INIT_ANALYSIS_MODULES.map(def => {
      const m = moduleMap.get(def.name)
      const isLocked = locked.has(def.name)

      // complete
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
      // failed
      if (m?.status === 'failed') {
        return {
          moduleName: def.name,
          moduleTitle: def.title,
          status: 'failed' as const,
          locked: isLocked,
        }
      }
      // in_progress：API 返回 in_progress，或前端模块对话正在生成
      if (m?.status === 'in_progress' || generating.has(def.name)) {
        return {
          moduleName: def.name,
          moduleTitle: def.title,
          status: 'in_progress' as const,
          locked: isLocked,
        }
      }
      // idle（可能被 init-analysis 等待执行锁定）
      return {
        moduleName: def.name,
        moduleTitle: def.title,
        status: 'idle' as const,
        locked: isLocked,
      }
    })
  })

  return {
    // ...
    allModuleCards,
    isInitAnalysisRunning,
    hasPendingInterrupt,
    lockedModules,
  }
}
```

> **前端 in_progress 状态**: 单个生成走模块对话路径时，数据库中没有 analysis 记录（`init-analysis-status` API 仍返回 idle）。通过 `generatingModules` 参数叠加前端本地状态，确保正在通过模块对话生成的模块正确显示 `in_progress`。

> **加载态**: `analysisStatus` 基于 `useApi` 异步加载，初始时 `allModuleCards` 返回全部 idle，API 返回后响应式更新。这是 Vue 响应式的正常行为，无需特殊处理。

> **not_started 场景**: 从未分析过的案件，`analysisStatus.modules` 为空数组，`moduleMap` 为空，全部返回 idle。用户可直接通过卡片入口开始首次生成。


保留原 `analysisResults`（仅 complete），供导出、版本管理等场景使用。

### 2. UI 四态卡片

#### 2.1 卡片状态样式

| 状态 | 图标区 | 标题/文字 | 边框 | 交互 |
|------|--------|-----------|------|------|
| complete | 实色图标，hover 放大 | 正常色，显示版本号+时间 | `border-transparent hover:border-primary` | 可点击进入详情 |
| in_progress（模块对话） | Loader2Icon 旋转动画 | 正常色，底部"生成中..." | `border-primary/30` | 可点击 → 重新展开对话窗口（不重复发消息） |
| in_progress（init-analysis 锁定） | Loader2Icon 旋转动画 | 正常色，底部"生成中..." | `border-primary/30` | `pointer-events-none`（受 init-analysis 串行流程管理，不可手动干预） |
| idle（普通） | 灰色图标 `text-muted-foreground/40` | 灰色，底部"点击生成" | `border-dashed border-muted-foreground/30` | 可点击触发单个生成 |
| idle（init-analysis 锁定） | 灰色图标 + 小时钟图标叠加 | 灰色，底部"等待 init-analysis 执行" | `border-dashed border-muted-foreground/30 opacity-60` | `pointer-events-none` |
| idle（hasPendingInterrupt 时） | 灰色图标 | 灰色，底部"等待处理中断" | `border-dashed opacity-60` | `pointer-events-none` |
| failed | 红色错误图标（`AlertCircleIcon text-destructive`） | 底部"生成失败，点击重试" | `border-destructive/30` | 可点击触发重新生成（走单个生成路径，模块对话） |

**交互优先级**：
1. `hasPendingInterrupt === true` → 所有 idle 和 failed 卡片禁用
2. `locked === true` → idle/in_progress/failed 卡片禁用手动点击
3. 否则按卡片状态的默认交互

#### 2.2 排列顺序

按 `INIT_ANALYSIS_MODULES` 定义的固定顺序排列，不按状态分组。用户始终看到一致的模块顺序。

#### 2.3 详情视图翻页

详情视图中的前/后翻页只在 complete 模块间切换，idle 和 in_progress 模块不可进入详情视图。

实现方式：维护 `completeIndices: number[]`（complete 模块在 `allModuleCards` 中的索引列表），翻页在此数组内导航。

### 3. 交互路径

#### 3.1 `generatingModules` 派生

`moduleChatManager.instances` 是 `shallowReactive`，只追踪顶层 key 增删，不追踪嵌套 `isLoading.value` 变化。因此不能直接用 computed 派生，需改用 watch + ref 模式：

```typescript
// useModuleChatManager 新增
const generatingModules = ref<string[]>([])

// 每个 instance 创建后，watch 其 isLoading 变化
function watchInstanceLoading(instance: ModuleChatInstance) {
  watch(() => instance.isLoading.value, () => {
    generatingModules.value = Object.keys(instances)
      .filter(name => instances[name]?.isLoading?.value)
  }, { immediate: true })
}
```

在 `getOrCreateModuleManager` 中创建 instance 后调用 `watchInstanceLoading(instance)`（在 effectScope 内，确保清理）。

`[id].vue` 传递给 `useCaseDetail`：

```typescript
const moduleChatManager = useModuleChatManager(caseId, { onAnalysisSaved: refreshAnalysis })
const { allModuleCards, ... } = useCaseDetail(caseId, {
  generatingModules: moduleChatManager.generatingModules,
})
```

页面刷新后 `restoreActiveSessions()` 重建 instances，`isLoading` 自动反映流式状态，`generatingModules` 派生正确无需额外处理。

#### 3.2 单个生成（点击 idle 卡片）

**前置条件**：卡片未被锁定（`!card.locked && !hasPendingInterrupt`）。

1. 用户点击 idle 卡片
2. `AnalysisResults` emit `generateModule(moduleName, moduleTitle)`
3. `[id].vue` 调用 `moduleChatManager.getOrCreateInstance(moduleName, moduleTitle, { autoMessage: ... })`
4. 展开模块对话窗口
5. 自动发送生成消息（`useModuleChatManager.getOrCreateInstance` 新增 `autoMessage?: string` 参数），消息模板：`"请为本案件生成{moduleTitle}分析报告"`
6. 完成后通过 `onAnalysisSaved` 回调触发 `refreshAnalysis()`，卡片 idle → complete

> **生成中状态派生**：步骤 3-5 期间，`instances[moduleName].isLoading` 为 true，`generatingModules` 计算属性自动包含该模块，`allModuleCards` 将其标记为 `in_progress`。

#### 3.3 重新展开生成中对话（点击 in_progress 卡片）

**条件**：`status === 'in_progress' && !card.locked`（即该 in_progress 来自模块对话而非 init-analysis 锁定）。

1. 用户点击 in_progress 卡片
2. `AnalysisResults` emit `generateModule(moduleName, moduleTitle)`
3. `[id].vue` 调用 `moduleChatManager.getOrCreateInstance(moduleName, moduleTitle)` **不传 `autoMessage`**
4. `getOrCreateInstance` 返回已存在的 instance（第 43 行 `if (instances[moduleName]) return instances[moduleName]`），不会重复创建也不会重复发消息
5. 调用 `moduleChatManager.expandModule(moduleName)` 重新展开窗口

> **关键**：复用现有 `getOrCreateInstance` 的幂等性，单个生成路径和重新展开路径使用同一个事件。`[id].vue` 中 `handleGenerateModule` 根据当前卡片状态决定是否传 `autoMessage`。

#### 3.4 失败重试（点击 failed 卡片）

**前置条件**：`!hasPendingInterrupt`。

与单个生成路径完全相同：
1. 用户点击 failed 卡片
2. emit `generateModule(moduleName, moduleTitle)`
3. `handleGenerateModule` 通过模块对话重新生成
4. 模块对话完成后保存新的 `caseAnalyses` 记录（`isActive=true`），覆盖旧的 failed 记录
5. `refreshAnalysis()` 后卡片从 failed → complete

#### 3.5 批量生成（"批量分析"按钮）

**按钮显示条件**：
```typescript
const showBatchButton = computed(() =>
  !isInitAnalysisRunning.value
  && !hasPendingInterrupt.value
  && allModuleCards.value.some(c => c.status === 'idle' && !c.locked),
)
```

- 全部 7 个模块完成（无 idle）→ 隐藏
- init-analysis 正在运行 → 隐藏（同一案件同时只能有一个 init-analysis 工作流）
- 存在 pending interrupt → 隐藏
- 其他情况 → 显示

**点击行为**：
1. 从 `allModuleCards` 过滤出 `status === 'idle' && !locked` 的模块列表作为 `selectedModules`
2. 原地调用 `init-analysis` API（参考 `useInitAnalysis.startAnalysis` 的模式）
3. 复用 SSE 流消费逻辑，在分析结果区域显示生成进度
4. 完成后 `refreshAnalysis()` 刷新

> **排除 in_progress 和 failed**：
> - `in_progress` 模块已经在生成（或被 init-analysis 锁定），不重复生成
> - `failed` 模块由用户单独重试，不混入批量流程

### 4. 组件改动清单

| 文件 | 改动 |
|------|------|
| `shared/types/case.ts` | 新增 `AnalysisModuleDisplayStatus`（四态：complete/in_progress/idle/failed）、`AnalysisModuleCard`（含 `locked` 字段，无 `error`/`nodeId`） |
| `app/composables/useCaseDetail.ts` | 新增 `allModuleCards` computed（接收 `generatingModules` 参数，支持四态 + 锁定逻辑）；新增 `isInitAnalysisRunning`、`hasPendingInterrupt`、`lockedModules` 派生状态；全部导出 |
| `app/components/case/AnalysisResults.vue` | 新增 `moduleCards` prop（`AnalysisModuleCard[]`，与原 `results` 并存）；新增 `activeModule: string \| null` v-model（与 `activeIndex` 双 v-model 共存）；四态卡片渲染（`:key="card.moduleName"`）；locked 和 pendingInterrupt 时卡片不可点击；emit `generateModule`（单个生成/重试/重新展开统一事件）；"批量分析"按钮 emit `batchGenerate`；详情翻页维护 `completeIndices`；翻页时同时 emit 两个 update 事件 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 新增 `moduleCards`、`showBatchButton` props；内部状态 `analysisActiveIndex` 迁移为 `analysisActiveModule: string \| null`；`navigateAnalysis` emit 签名从 `[index: number]` 改为 `[moduleName: string]`；`<CaseAnalysisResults>` 改用 `v-model:active-module`；透传 `generateModule`、`batchGenerate` emit |
| `app/components/caseDetail/CaseDetailAnalysis.vue` | 新增 `moduleCards`、`showBatchButton` props；`defineModel<number>('activeIndex')` 改为 `defineModel<string \| null>('activeModule')`；模板绑定从 `v-model:active-index` 改为 `v-model:active-module`；透传 `generateModule`、`batchGenerate` emit |
| `app/pages/dashboard/cases/[id].vue` | `?ai` 参数改为 moduleName（含白名单校验 `VALID_MODULE_NAMES`）；`analysisIndex` 改为 `analysisModule: string \| null`；`navigateToAnalysis` 签名改为 `(moduleName: string)`；query 同步条件为 `if (am) query.ai = am`；`<CaseDetailAnalysis>` 改用 `v-model:active-module`；idle 模块直达 URL 时自动降级为 dashboard 模式；传递 `allModuleCards`、`showBatchButton` 给子组件；新增 `handleGenerateModule`（根据卡片状态决定是否传 `autoMessage`：idle/failed 传消息，in_progress 只展开）、`handleBatchGenerate`（原地调用 init-analysis API） |
| `app/composables/useModuleChatManager.ts` | `getOrCreateInstance` 新增 `autoMessage?: string` 参数，仅在首次创建 instance 且参数存在时自动 sendMessage；新增 `generatingModules: Ref<string[]>` 导出（watch + ref 模式，监听每个 instance 的 `isLoading` 变化，解决 `shallowReactive` 嵌套追踪问题） |

> **不改动 `init-analysis/[sessionId].vue` 和 `analysis/[sessionId].vue`**：这两个页面继续使用 `AnalysisResults.vue` 的旧 `activeIndex` v-model。`useInitAnalysis.ts` 内部的 `activeIndex: Ref<number>` 保持不变。

### 5. URL 参数改用 moduleName

当前 `[id].vue` 中 `?ai=<index>` 用数字索引定位分析结果。随着模块补充生成，索引会漂移（如原本 `?ai=0` 指向 chronicle，补充生成 summary 后变成指向 summary）。

**改动范围**：只在案件详情页 `[id].vue` 的 URL 参数链路上改用 moduleName。`AnalysisResults.vue` 采用**双 v-model 共存**策略避免破坏其他调用方。

#### 5.1 `AnalysisResults.vue` 保留双 v-model（不破坏现有调用方）

`AnalysisResults.vue` 被三个页面共享：
- `app/pages/dashboard/cases/[id].vue`（案件详情，本次改动对象）
- `app/pages/dashboard/cases/init-analysis/[sessionId].vue`（初始化分析）
- `app/pages/dashboard/analysis/[sessionId].vue`（分析结果单独页面）

后两者基于 `useInitAnalysis.ts` 的内部 number 状态（非 URL 绑定），改为 moduleName 会引入不必要的重构。因此 `AnalysisResults.vue` **同时保留两种 v-model**：

```typescript
// props（两个互斥）
interface Props {
  results: AnalysisResult[]          // 旧 prop，保留
  moduleCards?: AnalysisModuleCard[] // 新 prop
  activeIndex?: number                // 旧 v-model，number
  activeModule?: string | null        // 新 v-model，string
  // ...
}

// emits
defineEmits<{
  (e: 'update:activeIndex', index: number): void
  (e: 'update:activeModule', moduleName: string | null): void
}>()
```

- 调用方传 `activeIndex` → 内部使用索引模式（旧行为，兼容 init-analysis / analysis 页面）
- 调用方传 `activeModule` → 内部使用 moduleName 模式（新行为，case detail 页面）
- 组件内部维护统一的 `currentModuleName` 计算属性，从两个来源解析；翻页时同时 emit 两个 update 事件（向后兼容）

#### 5.2 `[id].vue` 的 URL 参数迁移

```typescript
// 之前
const analysisIndex = ref(route.query.ai ? Number(route.query.ai) : 0)

// 之后：带白名单校验（防御 URL 注入）
import { VALID_MODULE_NAMES } from '#shared/types/initAnalysis'

const rawAi = route.query.ai
const analysisModule = ref<string | null>(
  typeof rawAi === 'string' && VALID_MODULE_NAMES.includes(rawAi)
    ? rawAi
    : null,
)
```

query 同步逻辑：

```typescript
// 之前：if (ai > 0) query.ai = String(ai)
// 之后：非 null 时写入；null 表示使用默认（不写入 query）
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

`navigateToAnalysis` 函数签名：

```typescript
// 之前：function navigateToAnalysis(index: number)
// 之后：
function navigateToAnalysis(moduleName: string) {
  analysisModule.value = moduleName
  analysisMode.value = 'detail'
  activeView.value = 'analysis'
}
```

#### 5.3 `CaseDetailOverview.vue` 的 emit 契约迁移

```typescript
// 之前：navigateAnalysis: [index: number]
// 之后：navigateAnalysis: [moduleName: string]

// 内部状态也迁移
// 之前：const analysisActiveIndex = ref(0)
// 之后：const analysisActiveModule = ref<string | null>(null)

// 绑定改用新 v-model
// 之前：<CaseAnalysisResults v-model:active-index="analysisActiveIndex" ... />
// 之后：<CaseAnalysisResults v-model:active-module="analysisActiveModule" ... />

// 点击拦截
watch(analysisViewMode, (mode) => {
  if (mode === 'detail' && analysisActiveModule.value) {
    nextTick(() => { analysisViewMode.value = 'dashboard' })
    emit('navigateAnalysis', analysisActiveModule.value)
  }
})
```

#### 5.4 `CaseDetailAnalysis.vue` 的 defineModel 迁移

```typescript
// 之前
const activeIndex = defineModel<number>('activeIndex', { default: 0 })
// 之后
const activeModule = defineModel<string | null>('activeModule', { default: null })
```

模板绑定从 `v-model:active-index` 改为 `v-model:active-module`。

#### 5.5 边界场景处理

**场景 1：翻页时 URL 同步** — 详情视图按"下一个/上一个"按钮时，`activeModule` 通过 `update:activeModule` 事件更新到父组件 ref，触发 `[id].vue` 的 watch 同步 URL。

**场景 2：idle 模块直达 URL** — 用户访问 `?ai=evidence&am=detail` 但 evidence 是 idle 状态时：
- `AnalysisResults.vue` 详情视图的 `currentResult` 查不到对应 complete 卡片
- 自动降级：`analysisMode` 重置为 `dashboard`，`analysisModule` 保留（停留在仪表盘高亮该卡片位置）
- 在 `[id].vue` 中通过 watch 实现：当 `activeView === 'analysis' && analysisMode === 'detail'` 且目标模块非 complete 时，重置 mode 为 dashboard

**场景 3：非法 moduleName** — 已在 5.2 的白名单校验中处理，非法值降级为 null。

**场景 4：数组形式 query（`?ai=a&ai=b`）** — `typeof rawAi === 'string'` 校验排除数组情况。

#### 5.6 不做向后兼容

旧的 `?ai=<index>` 书签会在迁移后失效。由于 URL 参数只在应用内部使用，无对外承诺，不做兼容处理。

### 6. 边界场景与锁定规则

#### 6.1 核心原则

- **同一模块不允许并发分析**：一个模块同一时刻只能有一个生成流程（要么 init-analysis，要么模块对话）
- **同一案件同时只能有一个 init-analysis 工作流运行**：init-analysis 运行时禁用批量按钮
- **模块对话与 init-analysis 的锁互不影响**：不在 init-analysis selectedModules 中的 idle 模块，即使 init-analysis 正在跑，也可以通过模块对话单独生成

#### 6.2 交互矩阵

| 场景 | 卡片点击 | 批量按钮 |
|------|---------|---------|
| 无 init-analysis，无 interrupt | idle/failed → 单个生成；in_progress（模块对话）→ 重新展开对话；complete → 进入详情 | 显示（若有 idle） |
| init-analysis 运行中 | selectedModules 中的模块：完全禁用；其他 idle 模块：可单个生成 | 隐藏 |
| hasPendingInterrupt | 所有 idle/failed 禁用；complete 仍可查看 | 隐藏 |
| 单个生成中（模块对话） | 该模块 in_progress → 可点击重新展开窗口 | 显示（若仍有其他 idle） |
| 全部 complete | N/A | 隐藏 |

#### 6.3 `handleGenerateModule` 的分支逻辑

```typescript
async function handleGenerateModule(card: AnalysisModuleCard) {
  // 已锁定或 interrupt 态，UI 层应已拦截，此处兜底
  if (card.locked || hasPendingInterrupt.value) return
  // 防止快速双击竞态
  if (generatingGuard.has(card.moduleName)) return
  generatingGuard.add(card.moduleName)

  try {
    if (card.status === 'in_progress') {
      // 模块对话正在生成 → 仅重新展开窗口，不重复发消息
      const instance = moduleChatManager.instances[card.moduleName]
      if (instance) moduleChatManager.expandModule(card.moduleName)
      return
    }

    // idle 或 failed → 创建/获取 instance 并自动发送生成消息
    await moduleChatManager.getOrCreateInstance(
      card.moduleName,
      card.moduleTitle,
      { autoMessage: `请为本案件生成${card.moduleTitle}分析报告` },
    )
    moduleChatManager.expandModule(card.moduleName)
  } finally {
    generatingGuard.delete(card.moduleName)
  }
}
```

> **竞态防护**：`generatingGuard: Set<string>` 用于防止快速双击同一卡片导致重复创建 instance 或重复发送 autoMessage。`getOrCreateInstance` 本身有幂等性保障（instance 已存在时直接返回），但 `autoMessage` 仅在新建 instance 时发送，守卫确保第二次点击不进入创建流程。

#### 6.4 `handleBatchGenerate` 的校验

```typescript
function handleBatchGenerate() {
  if (isInitAnalysisRunning.value || hasPendingInterrupt.value) return
  const targetModules = allModuleCards.value
    .filter(c => c.status === 'idle' && !c.locked)
    .map(c => c.moduleName)
  if (targetModules.length === 0) return
  // 原地调用 init-analysis API，参考 useInitAnalysis.startAnalysis
  // ...
}
```

#### 6.5 并发场景说明

**场景**：用户启动 init-analysis 只选 summary+chronicle，此时 claim/trend/cause/defense/evidence 不在锁定列表中。用户可以通过模块对话单独生成 claim。

- init-analysis 的 summary/chronicle 模块：`locked=true`，卡片禁用
- claim 模块：`locked=false`，可通过模块对话单独生成
- 两种生成使用不同的 session 类型（type=2 vs type=3），后端互相隔离
- 两者的分析结果都会写入 `caseAnalyses` 表，`isActive=true`
- 完成后 `refreshAnalysis()` 刷新，两者独立反映到卡片状态

#### 6.6 failed + locked 组合态

init-analysis 串行执行 `[summary, chronicle, claim]`，chronicle 失败但 init-analysis 仍在运行（正在执行 claim）。此时 chronicle 的状态为 `failed + locked`：

- 卡片显示**失败态样式**（红色错误图标），保留视觉反馈
- 但**禁用点击**（`pointer-events-none`），等待 init-analysis 整体结束后再允许重试
- 底部文案改为"等待当前批次完成后可重试"

交互优先级中 `locked === true` 优先于 failed 的默认交互（第 2.1 节第 2 条），确保不会在 init-analysis 运行期间触发模块对话重试。

#### 6.7 批量生成技术方案

批量生成在案件详情页内原地调用 `init-analysis` API，**不实例化 `useInitAnalysis`**（该 composable 包含消息分组、重连等复杂逻辑，仅适用于独立页面）。

**方案**：使用简化的 SSE 流消费 + 定时 `refreshAnalysis` 组合：

1. 通过 `$fetch` + `ReadableStream` 向 `POST /api/v1/case/init-analysis` 发起 SSE 请求，传入 `{ caseId, selectedModules }`
2. **不做前端流式状态追踪**（不消费 stream_event/values 事件细节），仅监听终态事件（`COMPLETED`/`FAILED`/`INTERRUPTED`）
3. SSE 建立后立即 `refreshAnalysis()` 触发一次 `analysisStatus` 刷新，此后 SSE 中每收到 `values` 事件（表示模块完成）就再刷一次
4. init-analysis API 返回的模块状态（in_progress/complete/failed）通过 `analysisStatus` → `allModuleCards` → 卡片 UI 自动反映进度
5. 收到终态后关闭连接，最终 `refreshAnalysis()` 确认所有状态

**优势**：
- 零状态管理开销（不需要 useStreamChat、不需要模块消息分组）
- 通过已有的 `analysisStatus` API 刷新驱动 UI 更新，复用 `allModuleCards` 的四态逻辑
- `isInitAnalysisRunning` 在 SSE 期间为 true，自动锁定 selectedModules 中的模块

**生命周期**：SSE 连接通过 `AbortController` 管理，在 `onUnmounted` 时 `abort()` 关闭。

#### 6.8 页面卸载与 SSE 清理

`useModuleChatManager` 的 `onUnmounted` 调用 `scope.stop()` 清理所有 effectScope。需要确认 `useChatSessionManager` 内部的 `useStreamChat` 在 scope 销毁时是否自动 abort SSE 连接：

- 如果 `useStreamChat` 注册了 `onScopeDispose(() => abortController.abort())`（Vue 3.5+ effectScope 清理钩子），则自动清理
- 如果没有，需要在 `useModuleChatManager.onUnmounted` 中遍历 instances，显式调用各 instance 的 `stop()` / `abort()` 方法

**实现时需验证**：检查 `useStreamChat` 的 abort 机制，必要时补充清理逻辑。此为实现细节，不影响设计方案整体方向。

#### 6.9 双 v-model emit 精确触发条件

`AnalysisResults.vue` 翻页时同时 emit `update:activeIndex` 和 `update:activeModule`，但应**仅在对应 prop 被传入时才 emit**，避免无接收方的冗余事件触发不必要的渲染：

```typescript
if (props.activeIndex !== undefined) emit('update:activeIndex', newIndex)
if (props.activeModule !== undefined) emit('update:activeModule', newModuleName)
```

#### 6.10 `useCaseDetail` 调用方确认

当前 `useCaseDetail` 仅在 `app/pages/dashboard/cases/[id].vue` 一处调用。新增的 `options?: { generatingModules }` 可选参数向后兼容，不影响任何已有代码。

### 7. 不改动的部分

- 服务端所有 API（`init-analysis`、`init-analysis-status` 等）
- `useInitAnalysis.ts`
- `ModuleSelector.vue`
- `AnalysisVersionSheet`
- `shared/types/initAnalysis.ts`（模块列表保持硬编码，动态化后续单独处理）
