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
  icon: string
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
```

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
| `app/components/case/AnalysisResults.vue` | 新增 `moduleCards` prop（`AnalysisModuleCard[]`，与原 `results` 并存）；三态卡片渲染（`:key="card.moduleName"`）；emit `generateModule`；"补充分析"按钮 emit `batchGenerate`；详情翻页维护 `completeIndices` |
| `app/components/caseDetail/CaseDetailOverview.vue` | 新增 `moduleCards` prop；透传 `generateModule` emit |
| `app/components/caseDetail/CaseDetailAnalysis.vue` | 新增 `moduleCards` prop；透传 `generateModule`、`batchGenerate` emit |
| `app/pages/dashboard/cases/[id].vue` | 传递 `allModuleCards` 给子组件；新增 `handleGenerateModule`（单个生成 → moduleChatManager + autoMessage）、`handleBatchGenerate`（原地调用 init-analysis API） |
| `app/composables/useModuleChatManager.ts` | `getOrCreateInstance` 新增 `autoMessage?: string` 参数；新增 `generatingModules: Ref<string[]>` 导出 |

### 5. 不改动的部分

- 服务端所有 API（`init-analysis`、`init-analysis-status` 等）
- `useInitAnalysis.ts`
- `ModuleSelector.vue`
- `AnalysisVersionSheet`
- `shared/types/initAnalysis.ts`（模块列表保持硬编码，动态化后续单独处理）
