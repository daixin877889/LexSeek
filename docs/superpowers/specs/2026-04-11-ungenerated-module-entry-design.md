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
export type AnalysisModuleDisplayStatus = 'complete' | 'in_progress' | 'idle'

export interface AnalysisModuleCard {
  moduleName: string
  moduleTitle: string
  status: AnalysisModuleDisplayStatus
  // status=complete 时有值
  content?: string
  analyzedAt?: string
  version?: number
  nodeId?: number
}
```

不修改现有 `AnalysisResult` 接口。

> **v-for key**: 卡片列表的 `:key` 使用 `moduleName`（7 个模块间唯一），不使用 `nodeId`（idle/in_progress 时为 undefined 会冲突）。

> **icon 字段**: `AnalysisModuleCard` 不存储 `icon` 字段，复用 `AnalysisResults.vue` 已有的 `iconMap`（通过 `moduleName` 映射 Lucide 组件）。

#### 1.2 `useCaseDetail.ts` 新增 `allModuleCards`

需要一个额外的前端状态源来标记正在通过模块对话生成的模块。通过参数接收 `moduleChatManager` 的活跃模块列表：

```typescript
function useCaseDetail(
  caseId: Ref<number>,
  options?: { generatingModules?: Ref<string[]> }
) {
  // ...
  const allModuleCards = computed<AnalysisModuleCard[]>(() => {
    const status = analysisStatus.value
    const moduleMap = new Map(status?.modules?.map(m => [m.name, m]) ?? [])
    const generating = new Set(options?.generatingModules?.value ?? [])

    return INIT_ANALYSIS_MODULES.map(def => {
      const m = moduleMap.get(def.name)
      if (m?.status === 'complete' && m.result) {
        return {
          moduleName: def.name,
          moduleTitle: def.title,
          status: 'complete' as const,
          content: m.result,
          analyzedAt: m.analyzedAt ?? '',
          version: m.version ?? 1,
          nodeId: 0,
        }
      }
      // API 返回 in_progress（init-analysis 流程中），或前端标记正在模块对话生成
      if (m?.status === 'in_progress' || generating.has(def.name)) {
        return {
          moduleName: def.name,
          moduleTitle: def.title,
          status: 'in_progress' as const,
        }
      }
      return {
        moduleName: def.name,
        moduleTitle: def.title,
        status: 'idle' as const,
      }
    })
  })
}
```

> **前端 in_progress 状态**: 单个生成走模块对话路径时，数据库中没有 analysis 记录（`init-analysis-status` API 仍返回 idle）。通过 `generatingModules` 参数叠加前端本地状态，确保正在通过模块对话生成的模块正确显示 `in_progress`。

> **加载态**: `analysisStatus` 基于 `useApi` 异步加载，初始时 `allModuleCards` 返回全部 idle，API 返回后响应式更新。这是 Vue 响应式的正常行为，无需特殊处理。

> **not_started 场景**: 从未分析过的案件，`analysisStatus.modules` 为空数组，`moduleMap` 为空，全部返回 idle。用户可直接通过卡片入口开始首次生成。


保留原 `analysisResults`（仅 complete），供导出、版本管理等场景使用。

### 2. UI 三态卡片

#### 2.1 卡片状态样式

| 状态 | 图标区 | 标题/文字 | 边框 | 交互 |
|------|--------|-----------|------|------|
| complete | 实色图标，hover 放大 | 正常色，显示版本号+时间 | `border-transparent hover:border-primary` | 可点击进入详情 |
| in_progress | Loader2Icon 旋转动画 | 正常色，底部"生成中..." | `border-primary/30` | `pointer-events-none opacity-70` |
| idle | 灰色图标 `text-muted-foreground/40` | 灰色，底部"点击生成" | `border-dashed border-muted-foreground/30` | 可点击触发生成 |

#### 2.2 排列顺序

按 `INIT_ANALYSIS_MODULES` 定义的固定顺序排列，不按状态分组。用户始终看到一致的模块顺序。

#### 2.3 详情视图翻页

详情视图中的前/后翻页只在 complete 模块间切换，idle 和 in_progress 模块不可进入详情视图。

实现方式：维护 `completeIndices: number[]`（complete 模块在 `allModuleCards` 中的索引列表），翻页在此数组内导航。

### 3. 交互路径

#### 3.1 单个生成（点击 idle 卡片）

1. 用户点击 idle 卡片
2. `AnalysisResults` emit `generateModule(moduleName, moduleTitle)`
3. `[id].vue` 调用 `moduleChatManager.getOrCreateInstance(moduleName, moduleTitle)`
4. 展开模块对话窗口
5. 自动发送生成消息（`useModuleChatManager` 新增 `autoMessage` 支持），消息模板：`"请为本案件生成{moduleTitle}分析报告"`
6. 完成后 `refreshAnalysis()` 刷新，卡片 idle → complete

> **生成中状态**: 步骤 3-5 期间，`moduleChatManager` 将模块名加入 `generatingModules`，`allModuleCards` 中该模块变为 `in_progress`，卡片显示加载状态且不可点击。

#### 3.2 批量生成（"补充分析"按钮）

1. 分析结果仪表盘头部，当存在 idle 模块时显示"补充分析"按钮
2. 点击后在案件详情页内原地调用 `init-analysis` API（参考 `useInitAnalysis.startAnalysis` 的模式），传入 idle 模块列表作为 `selectedModules`
3. 复用现有 SSE 流消费逻辑（`useStreamChat`），在分析结果区域显示生成进度
4. 完成后 `refreshAnalysis()` 刷新，卡片状态更新

> **不做页面跳转**: 当前初始化分析页面 (`init-analysis/[sessionId].vue`) 需要已创建的 sessionId 路由参数，且不支持从 query 读取预选模块。在案件详情页内直接调用 API 更简单，避免额外的页面跳转和参数传递改动。

### 4. 组件改动清单

| 文件 | 改动 |
|------|------|
| `shared/types/case.ts` | 新增 `AnalysisModuleDisplayStatus`、`AnalysisModuleCard` 类型（不含 icon 字段） |
| `app/composables/useCaseDetail.ts` | 新增 `allModuleCards` computed（接收 `generatingModules` 参数），导出 |
| `app/components/case/AnalysisResults.vue` | 新增 `moduleCards` prop（`AnalysisModuleCard[]`，与原 `results` 并存）；新增 `activeModule: string \| null` v-model（与 `activeIndex` 双 v-model 共存）；三态卡片渲染（`:key="card.moduleName"`）；emit `generateModule`；"补充分析"按钮 emit `batchGenerate`；详情翻页维护 `completeIndices`；翻页时同时 emit 两个 update 事件 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 新增 `moduleCards` prop；内部状态 `analysisActiveIndex` 迁移为 `analysisActiveModule: string \| null`；`navigateAnalysis` emit 签名从 `[index: number]` 改为 `[moduleName: string]`；`<CaseAnalysisResults>` 改用 `v-model:active-module`；透传 `generateModule` emit |
| `app/components/caseDetail/CaseDetailAnalysis.vue` | 新增 `moduleCards` prop；`defineModel<number>('activeIndex')` 改为 `defineModel<string \| null>('activeModule')`；模板绑定从 `v-model:active-index` 改为 `v-model:active-module`；透传 `generateModule`、`batchGenerate` emit |
| `app/pages/dashboard/cases/[id].vue` | `?ai` 参数改为 moduleName（含白名单校验 `VALID_MODULE_NAMES`）；`analysisIndex` 改为 `analysisModule: string \| null`；`navigateToAnalysis` 签名改为 `(moduleName: string)`；query 同步条件为 `if (am) query.ai = am`；`<CaseDetailAnalysis>` 改用 `v-model:active-module`；idle 模块直达 URL 时自动降级为 dashboard 模式；传递 `allModuleCards` 给子组件；新增 `handleGenerateModule`（单个生成 → moduleChatManager + autoMessage）、`handleBatchGenerate`（原地调用 init-analysis API） |
| `app/composables/useModuleChatManager.ts` | `getOrCreateInstance` 新增 `autoMessage?: string` 参数；新增 `generatingModules: Ref<string[]>` 导出 |

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

### 6. 不改动的部分

- 服务端所有 API（`init-analysis`、`init-analysis-status` 等）
- `useInitAnalysis.ts`
- `ModuleSelector.vue`
- `AnalysisVersionSheet`
- `shared/types/initAnalysis.ts`（模块列表保持硬编码，动态化后续单独处理）
