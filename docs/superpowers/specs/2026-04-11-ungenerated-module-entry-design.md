# 未生成分析模块入口设计

## 背景

案件详情页 `/dashboard/cases/[caseId]` 中，用户初始化分析时只选择了部分模块（如 summary + chronicle），分析完成后 UI 仅展示已完成的模块卡片。剩余未被选中的模块（如 claim、trend、cause、defense、evidence）在界面上完全不可见，没有入口去补充生成报告。

## 目标

- 在概览视图和分析结果视图中始终展示全部 7 个模块（包括从未分析过的案件）
- 支持两条生成路径：单个生成（模块对话窗口 + 自动发消息）和批量生成（跳转初始化分析页面）
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

#### 1.2 `useCaseDetail.ts` 新增 `allModuleCards`

```typescript
const allModuleCards = computed<AnalysisModuleCard[]>(() => {
  const status = analysisStatus.value
  const moduleMap = new Map(status?.modules?.map(m => [m.name, m]) ?? [])

  return INIT_ANALYSIS_MODULES.map(def => {
    const m = moduleMap.get(def.name)
    if (m?.status === 'complete' && m.result) {
      return {
        moduleName: def.name,
        moduleTitle: def.title,
        icon: def.icon,
        status: 'complete' as const,
        content: m.result,
        analyzedAt: m.analyzedAt ?? '',
        version: m.version ?? 1,
        nodeId: 0,
      }
    }
    if (m?.status === 'in_progress') {
      return {
        moduleName: def.name,
        moduleTitle: def.title,
        icon: def.icon,
        status: 'in_progress' as const,
      }
    }
    return {
      moduleName: def.name,
      moduleTitle: def.title,
      icon: def.icon,
      status: 'idle' as const,
    }
  })
})
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

### 3. 交互路径

#### 3.1 单个生成（点击 idle 卡片）

1. 用户点击 idle 卡片
2. `AnalysisResults` emit `generateModule(moduleName, moduleTitle)`
3. `[id].vue` 调用 `moduleChatManager.getOrCreateInstance(moduleName, moduleTitle)`
4. 展开模块对话窗口
5. 自动发送"开始生成"消息（`useModuleChatManager` 新增 `autoMessage` 支持）
6. 完成后 `refreshAnalysis()` 刷新，卡片 idle → complete

#### 3.2 批量生成（"补充分析"按钮）

1. 分析结果仪表盘头部，当存在 idle 模块时显示"补充分析"按钮
2. 点击后跳转初始化分析页面，query 携带 `caseId` + 预选 idle 模块列表
3. 复用现有 `init-analysis` 流程
4. 完成后返回案件详情页，状态自动更新

### 4. 组件改动清单

| 文件 | 改动 |
|------|------|
| `shared/types/case.ts` | 新增 `AnalysisModuleDisplayStatus`、`AnalysisModuleCard` 类型 |
| `app/composables/useCaseDetail.ts` | 新增 `allModuleCards` computed，导出 |
| `app/components/case/AnalysisResults.vue` | 新增 `moduleCards` prop；三态卡片渲染；emit `generateModule`；"补充分析"按钮 |
| `app/components/caseDetail/CaseDetailOverview.vue` | 传入 `allModuleCards`；透传 `generateModule` emit |
| `app/components/caseDetail/CaseDetailAnalysis.vue` | 传入 `allModuleCards`；透传 `generateModule`、`batchGenerate` emit |
| `app/pages/dashboard/cases/[id].vue` | 新增 `handleGenerateModule`、`handleBatchGenerate` 事件处理 |
| `app/composables/useModuleChatManager.ts` | `getOrCreateInstance` 新增 `autoMessage?: string` 参数 |

### 5. 不改动的部分

- 服务端所有 API（`init-analysis`、`init-analysis-status` 等）
- `useInitAnalysis.ts`
- `ModuleSelector.vue`
- `AnalysisVersionSheet`
- `shared/types/initAnalysis.ts`（模块列表保持硬编码，动态化后续单独处理）
