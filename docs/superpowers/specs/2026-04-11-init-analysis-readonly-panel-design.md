# 初始化分析页右面板 UI 对齐案件详情页

## 背景

当前初始化分析页（`init-analysis/[sessionId].vue`）右面板使用独立的 `InitAnalysisCaseInfoCard` 和 `InitAnalysisMaterialList` 组件展示案件信息和材料，与案件详情页（`cases/[id].vue`）的 `CaseDetailOverview` 样式不一致。需要统一两个页面的视觉风格，同时确保初始化分析页仅为只读模式——不可编辑、不可添加/删除材料、不可触发分析操作。

## 需求

1. 初始化分析页右面板的案件信息和材料 UI **对齐案件详情页的样式**
2. 案件材料增加**列表和卡片视图切换**
3. 初始化分析页中**所有操作功能禁用**：
   - 案件信息：不可编辑
   - 材料：不可添加、删除、多选
   - 分析结果：不可批量分析、不可点击 idle/failed 模块触发生成、详情视图中隐藏模块对话按钮
4. **保留的功能**：
   - 材料卡片点击预览
   - 分析结果 complete 卡片点击进入 detail 模式查看
   - 分析结果 detail 模式的复制、历史版本、翻页按钮
   - 分析结果 detail 模式返回 dashboard 模式

## 方案选择

评估了三种方案，选择**方案 A：为 `CaseDetailOverview` 和 `CaseAnalysisResults` 添加 `readonly` prop**。

理由：改动集中，一个 prop 统一控制只读行为，两个页面样式自然一致，维护成本最低。

## 设计

### 1. CaseDetailOverview 组件改造

**文件**：`app/components/caseDetail/CaseDetailOverview.vue`

新增 prop：

```typescript
readonly?: boolean  // 默认 false
```

**readonly=true 时隐藏的元素：**

| 区域 | 隐藏内容 |
|------|---------|
| 案件信息 header | "编辑信息"按钮、保存/取消编辑按钮 |
| 材料 header | "添加材料"按钮、"批量管理"按钮、"查看全部"按钮 |
| 材料卡片 | 每张卡片的删除图标（Trash2Icon） |
| 底部弹窗 | `CaseAnalysisMaterialSelector` 弹窗、删除确认 `AlertDialog` |

**新增功能：为材料区添加列表/卡片视图切换**

当前 `CaseDetailOverview` 的材料区只有网格视图。需要引入视图切换控件和列表视图模板，样式复用 `CaseDetailMaterials` 组件中的实现。

实现方式：
- 新增 `materialViewMode` ref（`'grid' | 'list'`，默认 `'grid'`）
- 在材料 header 右侧添加切换按钮组（与 `CaseDetailMaterials` 样式一致）
- 添加列表视图模板，复用 `CaseDetailMaterials` 中的列表行样式
- readonly 和非 readonly 模式下视图切换均可用

**传递给子组件的控制：**
- `InitAnalysisCaseInfoCard`：readonly=true 时不传 `editable` prop
- `CaseAnalysisResults`：传递 `readonly` prop

**不需要的 props/emits（readonly=true 时）：**
- `isAddingMaterials`、`disabledOssFileIds`：不会触发添加操作
- `navigateToSelectMode`、`deleteMaterials`、`addMaterials`：不会触发
- `navigateView`（材料的"查看全部"）：隐藏
- `batchGenerate`、`generateModule`：传递给 `CaseAnalysisResults` 但被其 readonly 控制

### 2. CaseAnalysisResults 组件改造

**文件**：`app/components/case/AnalysisResults.vue`

新增 prop：

```typescript
readonly?: boolean  // 默认 false
```

**readonly=true 时的行为变化：**

| 区域 | 变化 |
|------|------|
| Dashboard header | 隐藏"批量分析"按钮 |
| Dashboard 卡片 | idle/failed 状态卡片不可点击（`pointer-events-none`），仅 complete 可进入 detail |
| `handleCardClick` | 当 `readonly && card.status !== 'complete'` 时 return |
| Detail header actions | 隐藏"模块对话"按钮（`MessageCircleIcon`） |
| Detail header actions | 保留：复制、历史版本、翻页 |
| `getCardSubtext` | idle 状态：显示"未生成"（而非"点击生成"）；failed 状态：显示"生成失败"（而非"生成失败，点击重试"） |

### 3. 初始化分析页右面板改造

**文件**：`app/pages/dashboard/cases/init-analysis/[sessionId].vue`

**替换前（right-panel slot）：**
```
InitAnalysisCaseInfoCard
Separator
InitAnalysisMaterialList
Separator
CaseAnalysisResults
```

**替换后：**
```
CaseDetailOverview (readonly, 不含分析结果)
Separator
CaseAnalysisResults (readonly)
```

具体实现：

```vue
<template #right-panel>
  <div class="h-full flex flex-col bg-background border-l">
    <div v-show="rightPanelViewMode === 'dashboard'" class="flex-1 overflow-y-auto">
      <CaseDetailOverview
        v-if="caseId > 0"
        :case-id="caseId"
        :materials="materials"
        :analysis-results="[]"
        :readonly="true"
        :file-recognition-status="fileRecognitionStatus"
        :get-recognition-status="getRecognitionStatus"
        @preview-material="openMaterialPreview"
      />
      <Separator class="opacity-50" />
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

### 4. 数据适配

**材料数据获取**

当前 `InitAnalysisMaterialList` 组件内部通过 `useApiFetch` 获取材料数据。替换为 `CaseDetailOverview` 后，需要在初始化分析页面层获取材料并传入。

方案：在 `[sessionId].vue` 中新增材料获取逻辑：
- 监听 `caseId` 变化，调用 `/api/v1/case/${caseId}/materials` 获取材料列表
- 将材料数据转换为 `CaseDetailMaterialItem[]` 格式传入 `CaseDetailOverview`
- 可选：引入 `useFileRecognition` composable 来获取识别状态

**CaseDetailOverview 分析结果区**

传入空的 `analysisResults` 数组并配合右面板的独立 `CaseAnalysisResults` 实例展示分析结果。这样分析结果区的 dashboard/detail 切换不受 `CaseDetailOverview` 内部逻辑影响。

为实现这一点，`CaseDetailOverview` 需要支持在 `analysisResults` 为空时隐藏分析结果区域（已有 `v-if` 判断，传空数组即可不渲染分析区域的内容）。

### 5. 可删除的旧组件

实施完成后可移除：
- `app/components/initAnalysis/MaterialList.vue` — 被 `CaseDetailOverview` 的材料区替代

`InitAnalysisCaseInfoCard` 仍被 `CaseDetailOverview` 内部使用，保留。

## 影响范围

| 文件 | 改动类型 |
|------|---------|
| `app/components/caseDetail/CaseDetailOverview.vue` | 修改：增加 readonly prop、材料视图切换 |
| `app/components/case/AnalysisResults.vue` | 修改：增加 readonly prop |
| `app/pages/dashboard/cases/init-analysis/[sessionId].vue` | 修改：替换右面板组件、新增材料数据获取 |
| `app/components/initAnalysis/MaterialList.vue` | 删除（可选，实施完成后清理） |

## 不变更

- `CaseDetailMaterials.vue` — 不修改，案件详情页的材料 Tab 仍用此组件
- `InitAnalysisCaseInfoCard.vue` — 不修改，仍作为子组件被使用
- `AiChat.vue` — 不修改，布局容器不变
- 分析结果的 dashboard/detail 切换行为 — 保持现有逻辑
- 所有 API 接口 — 不变更
