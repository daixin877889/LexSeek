# 案件详情页设计方案

> 日期：2026-03-31
> 版本：v2（完全重写）
> 状态：待用户审核

## 1. 概述

### 1.1 背景

LexSeek 当前缺少案件详情页。初始化分析完成后，"进入案件详情"按钮指向一个不存在的页面。旧项目 `lexseek_web` 有完整的案件详情实现（Tab 切换 + 左右分栏），但架构和技术栈与当前项目不同，需要重新设计。

### 1.2 目标

- **UI 优先**：先搭建完整的页面结构和交互，再对接数据
- **复用现有**：最大限度复用已有组件（`AnalysisResults`、`CaseInfoCard`、`MaterialList`）和 API
- **可扩展**：侧边栏导航架构支持未来新增功能（待办事项、文书生成等）
- **渐进式**：小索助手先完成 UI 外壳，Agent 后端后续实现

### 1.3 不在本期范围

- Agent 后端逻辑（小索对话的 AI 能力）
- 模块对话功能（在分析模块中发送消息）
- 材料上传/编辑功能
- 导出文档功能

## 2. 页面路由

```
app/pages/dashboard/cases/[id].vue
```

通过 `caseId`（整数）访问，URL 示例：`/dashboard/cases/42`

```typescript
// 页面中获取路由参数
const route = useRoute()
const caseId = computed(() => Number(route.params.id))
```

## 3. 整体布局

采用**侧边栏 + 内容区**布局。侧边栏为扁平导航菜单，不展开子项，所有内容在右侧内容区呈现。

```
┌──────────────────────────────────────────────────────────────┐
│  ← 返回  案件标题                                    [操作] │
├────────────┬─────────────────────────────────────────────────┤
│            │                                                 │
│  侧边栏     │              内容区                             │
│            │                                                 │
│  ◉ 概览    │   根据侧边栏选中项切换内容：                     │
│  ○ 材料    │                                                 │
│  ○ 分析    │   概览 → 案件信息 + 材料摘要 + 分析摘要          │
│            │   材料 → 材料列表（左）+ 材料预览（右）          │
│  ─────     │   分析 → 结果网格 / 详情阅读                    │
│  ○ 待办    │                                                 │
│  (未来)    │                                                 │
│  ○ 文书    │                                          🤖     │
│  (未来)    │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

### 3.1 断点定义

| 断点 | 宽度 | 布局模式 |
|------|------|----------|
| `mobile` | < 768px | 底部 Tab 栏 + 全屏内容区 |
| `desktop` | >= 768px | 侧边栏 + 内容区 |

### 3.2 桌面端侧边栏（>= 768px）

- 宽度固定 `w-56`（224px），背景 `bg-muted/30`
- 菜单项为图标 + 文字，选中态高亮
- 底部分隔线下方放置未来功能入口（灰色禁用态 + "即将推出"标签）

### 3.3 移动端底部 Tab 栏（< 768px）

侧边栏隐藏，底部显示固定 Tab 栏。

```
┌──────────────────────┐
│ ←  案件标题      🤖  │
├──────────────────────┤
│                      │
│    全屏内容区        │
│                      │
│  （概览/材料/分析）  │
│                      │
├──────────────────────┤
│ 概览 │ 材料 │ 分析   │
└──────────────────────┘
```

- Tab 栏固定在底部，高度 `h-14`，背景 `bg-background`，顶部 `border-t`
- 每个 Tab 显示图标 + 文字标签
- 选中态：图标和文字变为 `text-primary`
- 安全区域：底部添加 `pb-[env(safe-area-inset-bottom)]`
- 未来扩展的 Tab 项（待办、文书）以相同方式追加

### 3.4 头部

- 左侧：返回按钮（→ 案件列表）+ 案件标题（可编辑，后续实现）
- 右侧：操作按钮区（删除案件等，后续实现）
- 移动端：标题截断显示，右侧仅显示小索按钮
- 高度固定，与 dashboard 布局一致

## 4. 各视图设计

### 4.1 概览视图（默认）

进入案件详情页时默认显示。纵向滚动，分三个区块展示案件全貌。

```
┌─────────────────────────────────────────────┐
│ 案件信息                                     │
│ ┌─────────────────────────────────────────┐ │
│ │ 案件类型: 民事纠纷    状态: 进行中       │ │
│ │ 原告: 张三           被告: 李四          │ │
│ │ 创建时间: 2026-03-20                    │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ 案件材料 (3)                         [查看] │
│ ┌────┐ ┌────┐ ┌────┐                       │
│ │ 📄 │ │ 🖼️ │ │ 🎤 │                       │
│ │起诉 │ │证据 │ │录音 │                       │
│ └────┘ └────┘ └────┘                       │
├─────────────────────────────────────────────┤
│ 分析结果 (5)                         [查看] │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐               │
│ │ 📝 │ │ 📅 │ │ ⚖️ │ │ 📈 │               │
│ │概要 │ │大事 │ │请求 │ │趋势 │               │
│ └────┘ └────┘ └────┘ └────┘               │
└─────────────────────────────────────────────┘
```

**组件复用策略：**

| 区块 | 复用组件 | 数据来源 | 说明 |
|------|----------|----------|------|
| 案件信息 | `InitAnalysisCaseInfoCard` | 组件自行加载（传入 `caseId` prop） | 组件内部调用 useApiFetch 获取数据 |
| 材料摘要 | `InitAnalysisMaterialList` | 组件自行加载（传入 `caseId` prop） | 复用卡片网格，添加"查看"链接 |
| 分析摘要 | `CaseAnalysisResults` | `useCaseDetail` composable 提供 `analysisResults` | 复用 `dashboard` 模式，数据从 composable 传入 |

> **数据流说明**：`CaseInfoCard` 和 `MaterialList` 保持现有的自加载模式（传 `caseId`），不改造为 props 驱动。`useCaseDetail` composable 仅负责获取分析结果数据和其他需要跨视图共享的状态。概览视图中存在少量重复请求（caseInfo 被 CaseInfoCard 和 composable 各获取一次），但实际影响可忽略（HTTP 缓存 + 同页面去重），不值得为此改造现有组件。

**交互：**
- 点击材料区域的"查看"或任意材料卡片 → 切换侧边栏到"材料"
- 点击分析区域的"查看"或任意分析卡片 → 切换侧边栏到"分析"，并定位到对应模块

**移动端概览：** 布局不变（纵向滚动），卡片网格自动适应为更少列（`auto-fill, minmax(120px, 1fr)`）。

### 4.2 材料视图

左右分栏布局，左侧材料列表，右侧材料预览。

```
┌─────────────────────┬───────────────────────────────┐
│ 材料列表             │  材料预览                      │
│                     │                               │
│ ┌────┐ ┌────┐      │  ┌───────────────────────────┐ │
│ │ 📄 │ │ 🖼️ │      │  │                           │ │
│ │起诉 │ │证据 │      │  │                           │ │
│ └────┘ └────┘      │  │    选中材料的预览内容       │ │
│ ┌────┐             │  │                           │ │
│ │ 🎤 │             │  │                           │ │
│ │录音 │             │  │                           │ │
│ └────┘             │  └───────────────────────────┘ │
└─────────────────────┴───────────────────────────────┘
```

**左侧材料列表：**
- 新建材料列表子组件（不直接复用 `InitAnalysisMaterialList`，因为需要选中态支持）
- 参考 `InitAnalysisMaterialList` 的卡片网格样式
- 新增选中态：卡片边框高亮 `border-primary`
- 数据来源：`useCaseDetail` composable 的 `materials`
- 无选中时显示引导提示："点击材料查看详情"

> **为什么不复用 `InitAnalysisMaterialList`**：现有组件不支持 `selectedId` prop 和选中态样式，改造它会影响 init-analysis 页面。材料列表本身代码量不大，新建一个针对详情页的版本更干净。

**右侧材料预览：**
- 新建 `CaseDetailMaterialPreview` 组件
- 头部：材料名称 + 类型标签 + 文件大小
- 内容区根据材料类型切换：
  - **文本** (`CASE_CONTENT`)：直接显示文本内容（来自 `MaterialItem.summary` 或创建时的原始文本）
  - **文档** (`DOCUMENT`)：显示 `summary` 摘要（如果有），否则显示"文档内容预览功能即将上线"
  - **图片** (`IMAGE`)：如果有 `ossFileId`，显示图片预览（通过 OSS URL）；否则显示占位
  - **音频** (`AUDIO`)：显示基本信息（文件名、大小），音频播放功能后续实现
- 未选中时显示空状态

> **数据限制说明**：现有 `GET /api/v1/case/{caseId}/materials` 返回的 `MaterialItem` 包含 `summary`、`fileName`、`fileSize`、`ossFileId` 等元信息，但不包含完整的文档解析内容或识别文本。本期材料预览以元信息展示为主，完整内容预览需要后续新增 API 支持。

**分栏比例：** 使用 `ResizablePanelGroup`（shadcn-vue），默认 40:60，可拖拽调整。

**移动端材料视图：**

取消左右分栏，全屏显示材料卡片网格列表。点击材料卡片后全屏覆盖显示预览内容，顶部有返回按钮。

```
列表状态：                    预览状态：
┌──────────────────────┐    ┌──────────────────────┐
│ ← 案件材料           │    │ ← 起诉状.pdf         │
├──────────────────────┤    ├──────────────────────┤
│ ┌────┐ ┌────┐       │    │                      │
│ │ 📄 │ │ 🖼️ │       │    │  材料预览内容         │
│ │起诉 │ │证据 │       │    │                      │
│ └────┘ └────┘       │    │  （文本/图片/摘要）   │
│ ┌────┐              │    │                      │
│ │ 🎤 │              │    │                      │
│ │录音 │              │    │                      │
│ └────┘              │    │                      │
├──────────────────────┤    ├──────────────────────┤
│ 概览 │ 材料 │ 分析   │    │ 概览 │ 材料 │ 分析   │
└──────────────────────┘    └──────────────────────┘
```

- 使用 Vue 的路由式导航或组件内状态管理（`selectedMaterialId`）控制列表/预览切换
- 预览状态下，返回按钮清空 `selectedMaterialId` 回到列表
- 底部 Tab 栏始终可见

### 4.3 分析视图

直接复用 `CaseAnalysisResults` 组件的双模式：

**Dashboard 模式（默认）：**
- 卡片网格展示所有分析结果
- 点击卡片进入 Detail 模式

**Detail 模式：**
- 全屏显示单个分析结果的 Markdown 内容
- 顶部返回按钮回到 Dashboard 模式
- 底部圆点导航切换模块
- 复制、重新生成按钮

**与 init-analysis 页面的区别：**
- 不在 AiChat 的 `#right-panel` slot 中，而是作为独立的内容区视图
- `showRegenerate` 默认开启
- 无 `isAnalyzing` 状态（详情页只显示已完成的结果）

**移动端分析视图：**

Dashboard 模式下卡片网格自动适应窄屏。Detail 模式全屏显示 Markdown 内容，与桌面端行为一致（`AnalysisResults` 组件已支持全屏）。

## 5. 小索助手

### 5.1 UI 形态

右下角悬浮按钮，点击弹出对话窗口。

```
                                        ┌─────────────────┐
                                        │ 小索 · AI 助手   × │
                                        ├─────────────────┤
                                        │                 │
                                        │  对话消息列表     │
                                        │                 │
                                        │                 │
                                        ├─────────────────┤
                                        │ [输入框] [发送]  │
                                        └─────────────────┘
                                                    🤖 ← 悬浮按钮
```

### 5.2 组件设计

新建 `CaseDetailXiaosuo` 组件：

- **悬浮按钮**：使用 `sticky` 定位在内容区右下角（`sticky bottom-4 right-4`），确保滚动时始终可见
- **对话弹窗**：使用 `Popover` 或自定义定位，宽度 380px、高度 500px
- **对话界面**：复用 `AiChat` 组件的消息列表和输入框样式
- **本期实现**：仅 UI 外壳。输入消息后显示占位回复"功能开发中，敬请期待"
- **后续集成**：对接 `useCaseChat` composable，接入 Agent 后端

**移动端小索：**
- 悬浮按钮显示在头部右侧（非内容区悬浮），避免遮挡底部 Tab 栏
- 点击后弹窗改为全屏 Drawer（从底部滑出），高度 90vh
- Drawer 顶部有拖拽条和关闭按钮

### 5.3 状态

- `isOpen: boolean` — 弹窗开关
- `messages: Message[]` — 对话历史（本期为空数组 + 占位欢迎消息）

## 6. 数据流

### 6.1 使用的现有 API

| API | 用途 | 返回数据 |
|-----|------|----------|
| `GET /api/v1/case/{caseId}` | 案件详情 | 案件信息、会话列表、最新分析结果摘要 |
| `GET /api/v1/case/{caseId}/materials` | 材料列表 | `MaterialItem[]` |
| `GET /api/v1/case/init-analysis-status/{caseId}` | 分析状态 | 各模块状态和结果内容 |

### 6.2 数据获取策略

```typescript
// 页面 composable: useCaseDetail
export function useCaseDetail(caseId: Ref<number>) {
  // 案件基本信息（供页面头部标题等使用）
  const { data: caseInfo, refresh: refreshCase } = useApiFetch(
    computed(() => `/api/v1/case/${caseId.value}`)
  )

  // 材料列表（供材料视图使用）
  const { data: materials, refresh: refreshMaterials } = useApiFetch(
    computed(() => `/api/v1/case/${caseId.value}/materials`)
  )

  // 分析状态和结果
  const { data: analysisStatus, refresh: refreshAnalysis } = useApiFetch(
    computed(() => `/api/v1/case/init-analysis-status/${caseId.value}`)
  )

  // 将分析结果转换为 AnalysisResult[] 格式
  const analysisResults = computed<AnalysisResult[]>(() => {
    // 从 analysisStatus.modules 中提取 status === 'complete' 的结果
    // 结合 INIT_ANALYSIS_MODULES 映射 moduleTitle
    // 返回 { nodeId, moduleName, moduleTitle, content, analyzedAt }
  })

  return {
    caseInfo,
    materials,
    analysisResults,
    refreshCase,
    refreshMaterials,
    refreshAnalysis,
  }
}
```

> **注意**：概览视图中 `CaseInfoCard` 和 `MaterialList` 各自内部也会调用 API 获取数据（它们接收 `caseId` prop 后自行加载）。这与 composable 的数据存在重复获取，但 Nuxt 的 `useApiFetch`（基于 `useFetch`）对相同 URL 有去重机制，实际不会产生额外网络请求。

### 6.3 需要新增的 API

**本期不需要新增 API。** 现有三个 API 覆盖了案件信息、材料列表、分析结果所有数据需求。

后续功能可能需要的 API（仅记录，不在本期实现）：
- 材料内容获取（文档解析结果、图片识别结果）— 材料预览深度集成时
- 小索对话 — Agent 后端集成时
- 待办事项 CRUD — 待办功能实现时

## 7. 组件结构

```
app/pages/dashboard/cases/[id].vue          # 页面入口
app/components/caseDetail/
├── CaseDetailSidebar.vue                   # 侧边栏导航（桌面端）
├── CaseDetailBottomTabs.vue                # 底部 Tab 栏（移动端）
├── CaseDetailOverview.vue                  # 概览视图
├── CaseDetailMaterials.vue                 # 材料视图（桌面端分栏 / 移动端列表+全屏预览）
├── CaseDetailMaterialPreview.vue           # 材料预览
├── CaseDetailAnalysis.vue                  # 分析视图（包装 AnalysisResults）
└── CaseDetailXiaosuo.vue                   # 小索助手（桌面端悬浮弹窗 / 移动端 Drawer）
app/composables/useCaseDetail.ts            # 页面数据 composable
```

### 7.1 组件职责

| 组件 | 职责 | 复用的现有组件 |
|------|------|---------------|
| `[id].vue` | 路由页面，获取 caseId，组装布局，响应式切换 | — |
| `CaseDetailSidebar` | 桌面端导航菜单，emit 选中项变化 | — |
| `CaseDetailBottomTabs` | 移动端底部 Tab 栏，emit 选中项变化 | — |
| `CaseDetailOverview` | 概览三区块，接收数据 props | `CaseInfoCard`, `MaterialList`, `AnalysisResults` |
| `CaseDetailMaterials` | 桌面端分栏 / 移动端列表+全屏预览 | `ResizablePanelGroup`（桌面端） |
| `CaseDetailMaterialPreview` | 根据材料类型渲染预览 | `AiElementsMessageResponse`（Markdown 渲染） |
| `CaseDetailAnalysis` | 包装 AnalysisResults，传递 props | `AnalysisResults` |
| `CaseDetailXiaosuo` | 桌面端悬浮弹窗 / 移动端底部 Drawer | shadcn `Drawer`（移动端） |
| `useCaseDetail` | 数据获取和状态管理 | `useApiFetch` |

### 7.2 页面状态

```typescript
// 视图类型定义（放在页面文件或 composable 中）
type ActiveView = 'overview' | 'materials' | 'analysis'

// [id].vue 中的核心状态
const activeView = ref<ActiveView>('overview')
const selectedMaterialId = ref<number | null>(null)
const xiaosuoOpen = ref(false)
```

状态流转简单明确：侧边栏切换 `activeView`，内容区根据 `activeView` 渲染对应视图组件。

## 8. 样式规范

### 8.1 布局类

```vue
<!-- 页面容器 -->
<div class="flex flex-col h-full">
  <!-- 头部 -->
  <header class="h-12 shrink-0 border-b flex items-center px-4">
    <!-- 返回按钮 + 标题 + 操作 -->
  </header>

  <!-- 主体 -->
  <div class="flex flex-1 min-h-0">
    <!-- 侧边栏 - 仅桌面端 -->
    <aside class="hidden md:block w-56 shrink-0 border-r bg-muted/30">
      <!-- 导航菜单 -->
    </aside>

    <!-- 内容区 -->
    <main class="flex-1 min-w-0 overflow-hidden relative">
      <!-- 视图组件 -->
    </main>
  </div>

  <!-- 底部 Tab 栏 - 仅移动端 -->
  <nav class="md:hidden shrink-0 h-14 border-t bg-background flex items-center justify-around pb-[env(safe-area-inset-bottom)]">
    <!-- Tab 项 -->
  </nav>
</div>
```

### 8.2 侧边栏菜单项

```vue
<button
  class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
  :class="[
    isActive
      ? 'bg-primary/10 text-primary font-medium'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  ]"
>
  <component :is="icon" class="size-4 shrink-0" />
  <span>{{ label }}</span>
</button>
```

### 8.3 颜色与间距

遵循项目现有的 shadcn-vue + Tailwind CSS v4 规范：
- 背景：`bg-background`, `bg-muted/30`, `bg-card`
- 边框：`border-border`
- 文字：`text-foreground`, `text-muted-foreground`
- 间距：`p-4` 页面内边距，`gap-3` 卡片间距

## 9. 扩展性

### 9.1 新增功能流程

侧边栏导航架构天然支持扩展。新增功能只需：

1. 在 `activeView` 类型中添加新值（如 `'todos'`）
2. 在 `CaseDetailSidebar` 中添加菜单项
3. 创建对应的视图组件（如 `CaseDetailTodos.vue`）
4. 在页面中添加条件渲染

```typescript
// 扩展 activeView 类型
type ActiveView = 'overview' | 'materials' | 'analysis' | 'todos' | 'documents'
```

### 9.2 侧边栏菜单配置

```typescript
interface SidebarMenuItem {
  id: ActiveView         // 对应 activeView 值，类型安全
  label: string
  icon: Component
  disabled?: boolean    // 未来功能禁用态
  badge?: string        // 角标（如待办数量）
}

const menuItems: SidebarMenuItem[] = [
  { id: 'overview', label: '概览', icon: LayoutDashboardIcon },
  { id: 'materials', label: '案件材料', icon: FolderIcon },
  { id: 'analysis', label: '分析结果', icon: SparklesIcon },
  // 未来扩展：
  // { id: 'todos', label: '待办事项', icon: ListTodoIcon, badge: '3' },
  // { id: 'documents', label: '文书生成', icon: FileEditIcon, disabled: true },
]
```

## 10. 实现计划

### Phase 1：页面骨架（含响应式）

- 创建 `app/pages/dashboard/cases/[id].vue`
- 创建 `CaseDetailSidebar` 组件（桌面端）
- 创建 `CaseDetailBottomTabs` 组件（移动端）
- 实现响应式布局切换（`hidden md:block` / `md:hidden`）
- 实现视图切换逻辑（侧边栏和底部 Tab 共享 `activeView` 状态）
- 使用占位内容验证布局

### Phase 2：概览视图

- 创建 `CaseDetailOverview` 组件
- 创建 `useCaseDetail` composable，对接现有 API
- 复用 `CaseInfoCard` 展示案件信息
- 复用 `MaterialList` 展示材料摘要
- 复用 `AnalysisResults`（dashboard 模式）展示分析摘要
- 实现概览到材料/分析视图的跳转

### Phase 3：材料视图

- 创建 `CaseDetailMaterials` 组件
  - 桌面端：`ResizablePanelGroup` 左右分栏
  - 移动端：全屏材料列表，点击后全屏预览（返回按钮回到列表）
- 创建 `CaseDetailMaterialPreview` 组件
- 实现材料列表选中态
- 实现各类型材料预览（文档/图片/音频/文本）
- 对接材料数据

### Phase 4：分析视图

- 创建 `CaseDetailAnalysis` 组件
- 复用 `AnalysisResults` 组件
- 对接分析结果数据（从 init-analysis-status API 获取）
- 验证 dashboard/detail 模式切换

### Phase 5：小索助手

- 创建 `CaseDetailXiaosuo` 组件
- 桌面端：悬浮按钮 + Popover 弹窗
- 移动端：头部按钮 + 底部 Drawer（90vh）
- 实现对话 UI 外壳
- 添加占位欢迎消息和"功能开发中"回复

## 11. 参考

| 资源 | 说明 |
|------|------|
| `lexseek_web/src/views/dashboard/CaseDetail.vue` | 旧项目案件详情页（1482 行），Tab + 左右分栏布局 |
| `app/pages/dashboard/cases/init-analysis/[sessionId].vue` | 初始化分析页面，AiChat 双面板布局 |
| `app/pages/dashboard/analysis/[sessionId].vue` | 后续分析页面，小索原型 |
| `app/components/case/AnalysisResults.vue` | 分析结果组件，dashboard/detail 双模式 |
| `app/components/initAnalysis/CaseInfoCard.vue` | 案件信息卡片 |
| `app/components/initAnalysis/MaterialList.vue` | 材料列表（2列卡片网格） |
