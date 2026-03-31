# 案件详情页设计方案

> 日期：2026-03-31
> 状态：待用户审核
> 审查意见：已完成（详见附录 A）

## 1. 概述

### 1.1 项目背景

参考 `/Users/daixin/work/dev/LexSeek/lexseek_web/src/views/dashboard/CaseDetail.vue` 完成 LexSeek 项目的案件详情页。

### 1.2 设计目标

- 将案件材料和各个分析模块统一为"文档"概念进行管理
- 支持多窗口并行显示，每个分析模块可独立开对话窗口
- 主 Agent "小索"作为案件全局助手，提供辅助对话功能
- 良好的扩展性，预留案件待办事项等未来功能扩展
- PC 和移动端双端适配

## 2. 整体架构

### 2.1 页面布局

```
┌─────────────────────────────────────────────────────────────────┐
│                      案件详情页                                   │
├──────────────┬──────────────────────────────────────────────────┤
│              │  [Tab 1] [Tab 2] [Tab 3] ...               [×]  │
│  文档列表     │ ┌──────────────────────────────────────────────┐ │
│  ┌─────────┐ │ │                                              │ │
│  │ 🔍 搜索  │ │ │           当前选中窗口内容                    │ │
│  ├─────────┤ │ │                                              │ │
│  │ 全部    │ │ │   (分析模块: 对话历史)                      │ │
│  │ 材料    │ │ │   (案件材料: 预览内容)                       │ │
│  │ 分析模块 │ │ │                                              │ │
│  ├─────────┤ │ │                                              │ │
│  │ 案件材料 │ │ │                                              │ │
│  │ - 材料1  │ │ │                                              │ │
│  │ - 材料2  │ │ └──────────────────────────────────────────────┘ │
│  ├─────────┤ │                                                  │
│  │ 分析模块 │ │                                        ┌─────┐ │
│  │ - 模块1  │ │                                        │ 小索 │ │
│  │ - 模块2  │ │                                        └─────┘ │
│  │ - 模块3  │ │                                                  │
│  └─────────┘ │                                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

### 2.2 移动端布局

```
┌─────────────────────────┐
│  ☰ 案件标题      [小索] │
├─────────────────────────┤
│                         │
│     全屏工作区           │
│                         │
│  [Tab 1] [Tab 2] [+]   │
│  ┌─────────────────┐   │
│  │                 │   │
│  │   当前窗口内容   │   │
│  │                 │   │
│  └─────────────────┘   │
│                         │
│                    [文档] │ ← 右下角文档列表按钮
└─────────────────────────┘

移动端文档列表（Sheet 形式）：
┌─────────────────────────┐
│  [全部] [材料] [模块]   │
├─────────────────────────┤
│ 🔍 搜索文档              │
├─────────────────────────┤
│ 案件材料                 │
│ ├─ 材料1.pdf            │
│ └─ 材料2.docx           │
│ 分析模块                 │
│ ├─ 法律分析 (v3)        │
│ ├─ 诉讼策略 (v1)        │
│ └─ 风险评估 (v2)        │
└─────────────────────────┘
```

## 3. 核心概念

### 3.1 文档类型

| 类型 | 说明 | 内容 |
|------|------|------|
| `material` | 案件材料 | PDF、图片、音频、文本等原始材料 |
| `module` | 分析模块 | 各分析模块的对话历史和结果 |

### 3.2 窗口类型

| 窗口类型 | 内容 | 组件 |
|----------|------|------|
| `material` | 材料预览 | 材料查看器（支持 PDF、图片、音频等） |
| `module` | 模块对话 | 对话历史列表 + 输入框 |

### 3.3 Agent 模型

| Agent | 范围 | 功能 |
|-------|------|------|
| 小索（主 Agent） | 案件全局 | 案件信息问答、调度子模块、待办事项管理 |
| 模块 Agent | 单个分析模块 | 专注分析该模块内容，生成分析结果 |

## 4. 数据模型

### 4.1 文档类型联合

```typescript
import { CaseMaterialType } from '#shared/types/case'

// 文档基类
interface BaseDocument {
  /** 文档标题 */
  title: string
  /** 图标 */
  icon: string
  /** 创建时间 */
  createdAt: string
}

// 材料文档（关联 shared/types/file.ts 中的 MaterialItem）
interface MaterialDocument extends BaseDocument {
  id: number                    // 材料 ID
  type: 'material'
  materialId: number
  materialType: CaseMaterialType
  fileName: string
  fileSize: number
}

// 模块文档
interface ModuleDocument extends BaseDocument {
  id: string                   // 格式: "module-{nodeId}"
  type: 'module'
  nodeId: number
  sessionId: string
  versionCount: number         // 版本数量
  currentVersion: number       // 当前版本号
  hasNewContent: boolean      // 是否有新内容
}

// 文档联合类型
type DocumentItem = MaterialDocument | ModuleDocument
```

### 4.2 窗口状态

```typescript
interface WindowState {
  /** 窗口 ID */
  id: string
  /** 窗口类型 */
  type: 'material' | 'module'
  /** 关联文档 ID */
  documentId: string | number
  /** 窗口标题 */
  title: string
  /** 是否可关闭（主案件对话不可关闭） */
  closable?: boolean
}
```

### 4.3 页面状态

```typescript
interface CaseDetailState {
  /** 案件信息 */
  caseInfo: {
    id: number
    title: string
    caseType: string
    status: number
    createdAt: string
  }
  /** 文档列表 */
  documents: DocumentItem[]
  /** 打开的窗口列表 */
  windows: WindowState[]
  /** 当前激活的窗口 ID */
  activeWindowId: string | null
  /** 小索弹窗是否打开 */
  xiaosuoOpen: boolean
  /** 搜索关键词 */
  searchQuery: string
  /** 当前筛选类型 */
  filterType: 'all' | 'material' | 'module'
}
```

## 5. 组件设计

### 5.1 组件结构

```
CaseDetailPage/
├── CaseDetailHeader          # 页面头部（返回按钮、标题、操作按钮）
├── CaseDetailDocumentList    # 左侧文档列表
│   ├── DocumentSearch       # 搜索框
│   ├── DocumentFilter       # 类型筛选
│   ├── DocumentGroup        # 文档分组
│   └── DocumentItem         # 文档项
├── CaseDetailWorkspace      # 右侧工作区
│   ├── WorkspaceTabs        # Tab 标签栏
│   └── WorkspaceContent     # 工作区内容
│       ├── MaterialViewer   # 材料查看器
│       └── ModuleWindow     # 模块对话窗口
├── CaseDetailXiaosuo       # 右下角小索助手
│   └── XiaosuoChat         # AiChat 弹窗
└── CaseDetailMobileSheet   # 移动端文档列表 Sheet
```

### 5.2 核心组件说明

#### CaseDetailPage

页面容器组件，负责整体布局和状态管理。

| 属性/方法 | 说明 |
|-----------|------|
| `caseId` (prop) | 案件 ID |
| `caseInfo` (state) | 案件信息 |
| `documents` (state) | 文档列表 |
| `windows` (state) | 打开的窗口列表 |
| `activeWindowId` (state) | 当前激活窗口 |
| `openDocument(doc)` | 打开文档 |
| `closeWindow(windowId)` | 关闭窗口 |
| `switchWindow(windowId)` | 切换窗口 |
| `renameDocument(docId, title)` | 重命名文档 |
| `deleteDocument(docId)` | 删除文档 |

#### CaseDetailDocumentList

左侧文档列表组件，支持 PC 固定显示和移动端抽屉模式。

| 属性/方法 | 说明 |
|-----------|------|
| `documents` (prop) | 文档列表 |
| `activeDocId` (prop) | 当前激活文档 |
| `filterType` (state) | 当前筛选类型 |
| `searchQuery` (state) | 搜索关键词 |
| `@doc-click` (event) | 文档点击 |
| `@doc-rename` (event) | 文档重命名 |
| `@doc-delete` (event) | 文档删除 |

#### CaseDetailWorkspace

右侧工作区组件，管理 Tab 和内容显示。

| 属性/方法 | 说明 |
|-----------|------|
| `windows` (prop) | 窗口列表 |
| `activeWindowId` (prop) | 当前激活窗口 |
| `@tab-change` (event) | Tab 切换 |
| `@tab-close` (event) | Tab 关闭 |

#### CaseDetailModuleWindow

分析模块对话窗口组件。

| 属性/方法 | 说明 |
|-----------|------|
| `nodeId` (prop) | 节点 ID |
| `title` (prop) | 模块标题 |
| `sessionId` (prop) | 会话 ID |
| `conversations` (state) | 对话列表 |
| `sendMessage(msg)` | 发送消息 |

#### CaseDetailMaterialViewer

材料预览组件，支持多种格式。

| 属性/方法 | 说明 |
|-----------|------|
| `materialId` (prop) | 材料 ID |
| `material` (state) | 材料信息 |
| `loadMaterial()` | 加载材料 |

#### CaseDetailXiaosuo

右下角小索助手组件。

| 属性/方法 | 说明 |
|-----------|------|
| `isOpen` (state) | 是否打开 |
| `caseId` (prop) | 案件 ID |
| `toggle()` | 切换显示 |
| `openChat()` | 打开对话 |
| `closeChat()` | 关闭对话 |

## 6. 布局响应式设计

### 6.1 断点定义

| 断点 | 宽度 | 布局模式 |
|------|------|----------|
| `mobile` | < 768px | 移动端布局 |
| `tablet` | 768px - 1024px | 平板布局 |
| `desktop` | > 1024px | 桌面端布局 |

### 6.2 各断点布局

#### Desktop (>= 1024px)

```
┌─────────┬──────────────────────────────────────┐
│ 280px   │ flex-1                               │
│ 固定侧边栏│                                       │
│         │  [Tab 1] [Tab 2] [Tab 3] ...    [×] │
│         │  ┌────────────────────────────────┐  │
│         │  │                                │  │
│         │  │        工作区内容               │  │
│         │  │                                │  │
│         │  └────────────────────────────────┘  │
│         │                              ┌────┐  │
│         │                              │小索│  │
│         │                              └────┘  │
└─────────┴──────────────────────────────────────┘
```

#### Tablet (768px - 1024px)

```
┌──────────┬────────────────────────────────────┐
│ 240px    │ flex-1                            │
│ 侧边栏    │                                    │
│         │  [Tab 1] [Tab 2] ...          [×] │
│         │  ┌────────────────────────────────┐ │
│         │  │                                │ │
│         │  │        工作区内容               │ │
│         │  │                                │ │
│         │  └────────────────────────────────┘ │
│         │                              ┌────┐  │
│         │                              │小索│  │
│         │                              └────┘  │
└──────────┴────────────────────────────────────┘
```

#### Mobile (< 768px)

```
┌────────────────────────────────┐
│ 案件标题              [小索]   │
├────────────────────────────────┤
│                                │
│  [Tab 1] [Tab 2] [+]          │
│  ┌────────────────────────┐   │
│  │                        │   │
│  │      工作区内容         │   │
│  │                        │   │
│  │                        │   │
│  └────────────────────────┘   │
│                                │
│                         [文档] │
└────────────────────────────────┘

点击"文档"按钮 → 底部 Sheet：
┌────────────────────────────────┐
│  [全部] [材料] [模块]           │
├────────────────────────────────┤
│  🔍 搜索文档                    │
├────────────────────────────────┤
│  案件材料                       │
│  ├─ 材料1.pdf                  │
│  └─ 材料2.docx                 │
│  分析模块                       │
│  ├─ 法律分析 (v3)              │
│  ├─ 诉讼策略 (v1)              │
│  └─ 风险评估 (v2)              │
└────────────────────────────────┘
```

## 7. 交互流程

### 7.1 打开文档

```
用户点击文档项
       ↓
检查是否已存在对应窗口
       ↓
    ┌─────────────────┐
    │ 窗口已存在？     │
    └─────────────────┘
       ↓              ↓
     Yes            No
       ↓              ↓
  切换到该窗口    创建新窗口
       ↓         添加到 Tab 列表
  设置为激活窗口  设置为激活窗口
```

### 7.2 关闭 Tab

```
用户点击 Tab 关闭按钮
       ↓
检查是否为最后一个窗口
       ↓
    ┌─────────────────┐
    │ 是最后一个窗口？ │
    └─────────────────┘
       ↓              ↓
     Yes            No
       ↓              ↓
   提示无法关闭    从窗口列表移除
   或转为最小化    激活前一个窗口
```

### 7.3 小索对话

```
用户点击小索按钮
       ↓
打开 AiChat 弹窗
       ↓
用户输入问题
       ↓
Agent 处理请求
       ↓
返回结果并显示
```

### 7.4 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + W` | 关闭当前 Tab |
| `Cmd/Ctrl + Tab` | 切换到下一个 Tab |
| `Cmd/Ctrl + Shift + Tab` | 切换到上一个 Tab |
| `Cmd/Ctrl + 1-9` | 快速切换到指定 Tab |
| `Cmd/Ctrl + B` | 切换侧边栏显示/隐藏 |
| `Esc` | 关闭弹窗（AiChat、Sheet） |

## 8. 样式规范

### 8.1 颜色使用

在 Tailwind CSS v4 项目中，使用 Tailwind 类而非自定义 CSS 变量：

```vue
<!-- 文档类型颜色 - 使用 Tailwind 类 -->
<div class="bg-muted border-border">           <!-- 材料 -->
<div class="bg-primary/10 border-primary/20">   <!-- 分析模块 -->

<!-- 状态颜色 -->
<span class="bg-green-100 text-green-800">已完成</span>
<span class="bg-blue-100 text-blue-800">进行中</span>
```

### 8.2 间距规范

```css
/* 页面内边距 */
--page-padding: 1rem;          /* 移动端 */
--page-padding: 1.5rem;        /* PC 端 */

/* 文档列表宽度 */
--doc-list-width: 280px;       /* PC 端 */
--doc-list-width: 240px;      /* 平板 */
--doc-list-width: 100%;        /* 移动端 Sheet */

/* 工作区 */
--workspace-gap: 1rem;
--tab-gap: 0.25rem;

/* 小索按钮 */
--xiaosuo-size: 48px;
--xiaosuo-icon-size: 24px;
--xiaosuo-position: fixed bottom-4 right-4;
--xiaosuo-mobile-bottom: env(safe-area-inset-bottom, 1rem);
```

### 8.3 动画规范

```vue
<!-- Tab 切换 -->
<Transition enter-active-class="transition duration-150 ease-out"
           leave-active-class="transition duration-150 ease-in">
  <!-- 内容 -->
</Transition>

<!-- Sheet 展开 -->
<Transition enter-active-class="transition-transform duration-300 ease-out"
           enter-from-class="translate-y-full"
           enter-to-class="translate-y-0"
           leave-active-class="transition-transform duration-200 ease-in"
           leave-from-class="translate-y-0"
           leave-to-class="translate-y-full">
  <!-- Sheet 内容 -->
</Transition>
```

### 8.4 移动端安全区域

```vue
<!-- 移动端底部安全区域适配 -->
<div class="fixed bottom-4 right-4 pb-[env(safe-area-inset-bottom)]">
  <!-- 小索按钮 -->
</div>

<!-- Sheet 底部安全区域 -->
<Sheet class="pb-safe-area">
  <!-- 内容 -->
</Sheet>
```

## 9. 扩展性设计

### 9.1 待办事项扩展

未来可通过以下方式添加待办事项功能：

1. 在 `DocumentType` 中添加 `todo` 类型
2. 新增 `CaseDetailTodoList` 组件
3. 扩展左侧文档列表支持新类型
4. 添加相关 API 接口

### 9.2 组件插槽设计

```vue
<!-- 页面扩展插槽 -->
<CaseDetailPage>
  <template #header-actions>
    <!-- 扩展头部操作按钮区域 -->
  </template>

  <template #document-item-extra="{ doc }">
    <!-- 扩展文档项额外内容（如版本数徽章） -->
  </template>

  <template #document-item-actions="{ doc }">
    <!-- 每个文档项的额外操作按钮 -->
  </template>

  <template #workspace-toolbar="{ activeWindow }">
    <!-- 工作区工具栏扩展 -->
  </template>

  <template #xiaosuo-header>
    <!-- 小索弹窗头部自定义 -->
  </template>
</CaseDetailPage>
```

### 9.3 状态持久化策略

| 状态 | 持久化方式 | 说明 |
|------|------------|------|
| 侧边栏宽度 | localStorage | 用户调整后的宽度比例 |
| 最后激活的 Tab | localStorage | 下次访问时恢复 |
| 打开的窗口列表 | 不持久化 | 每次进入页面从初始状态开始 |
| 文档搜索筛选 | 不持久化 | 每次进入页面重置 |

```typescript
// 状态持久化示例
const savedSidebarWidth = useLocalStorage('case-detail-sidebar-width', 280)
const lastActiveWindowId = useLocalStorage('case-detail-last-window', null)
```

## 10. API 接口

### 10.1 案件详情

```
GET /api/v1/case/:caseId
```

响应：
```typescript
{
  code: 200,
  data: {
    id: number
    title: string
    caseTypeId: number
    status: number
    createdAt: string
    caseType: { id, name }
  }
}
```

### 10.2 获取文档列表

```
GET /api/v1/cases/:caseId/documents
```

响应：
```typescript
{
  code: 200,
  data: {
    materials: Array<{
      id: number
      name: string
      materialType: CaseMaterialType
      fileSize: number
      createdAt: string
    }>
    modules: Array<{
      nodeId: number
      name: string
      title: string
      sessionId: string
      versionCount: number
      currentVersion: number
      hasNewContent: boolean
      createdAt: string
    }>
  }
}
```

### 10.3 材料相关操作

```
# 重命名材料
PATCH /api/v1/cases/:caseId/materials/:materialId

# 删除材料
DELETE /api/v1/cases/:caseId/materials/:materialId
```

### 10.4 模块相关操作

```
# 获取模块对话历史
GET /api/v1/cases/:caseId/modules/:nodeId/history

# 获取模块所有版本
GET /api/v1/cases/:caseId/modules/:nodeId/versions

# 切换激活版本
POST /api/v1/cases/:caseId/modules/:nodeId/versions/:versionId/activate
```

### 10.5 小索对话

```
# 小索对话使用现有 AiChat 组件
# API: /api/v1/case/analysis/chat
# 具体接口定义参考 useCaseChat composable
```

## 11. 实现计划

### Phase 1: 基础框架

- [ ] 创建页面路由 `app/pages/dashboard/cases/[id].vue`
- [ ] 创建 `CaseDetailPage` 组件结构
- [ ] 实现基础布局和响应式框架
- [ ] 添加模拟数据验证布局

### Phase 2: 文档列表

- [ ] 实现 `CaseDetailDocumentList` 组件
- [ ] 添加搜索和筛选功能
- [ ] 实现文档项操作（点击、重命名、删除）
- [ ] 移动端 Sheet 适配

### Phase 3: 工作区

- [ ] 实现 `CaseDetailWorkspace` 组件
- [ ] 实现 Tab 切换和关闭功能
- [ ] 创建 `MaterialViewer` 材料预览组件
- [ ] 创建 `ModuleWindow` 模块对话组件

### Phase 4: 小索助手

- [ ] 实现 `CaseDetailXiaosuo` 组件
- [ ] 集成 `AiChat` 组件
- [ ] 实现弹窗交互逻辑

### Phase 5: 数据对接

- [ ] 对接真实 API 接口
- [ ] 实现状态管理（Pinia store）
- [ ] 完善错误处理和加载状态

## 12. 参考文件

- 参考实现：`/Users/daixin/work/dev/LexSeek/lexseek_web/src/views/dashboard/CaseDetail.vue`
- 现有组件：`/app/components/case/SplitLayout.vue`
- 现有组件：`/app/components/case/AnalysisResults.vue`
- 现有组件：`/app/components/case/MaterialUploader.vue`
- 类型定义：`/shared/types/case.ts`
- 对话组件：`/app/components/ai/AiChat.vue`

## 附录 A：审查意见处理

### 已处理

| 问题 | 处理方式 |
|------|----------|
| CSS 变量语法问题 | 改用 Tailwind 类，移除非标准 CSS 变量语法 |
| 数据模型与现有类型对齐 | 复用 `CaseMaterialType` 枚举，定义联合类型 |
| API 接口设计 | 区分材料/模块接口，引用现有对话 API |
| 移动端安全区域 | 添加 `env(safe-area-inset-bottom)` 适配 |
| 键盘快捷键 | 在交互流程章节补充快捷键设计 |
| 状态持久化策略 | 添加 9.3 节明确持久化范围 |

### 待实现

| 问题 | 状态 | 说明 |
|------|------|------|
| 文件上传功能 | 本期不实现 | 后续扩展 |
| 平板断点侧边栏交互 | 待定 | 根据实际使用反馈调整 |
| 搜索功能细节 | 待定 | 全文搜索待后端支持 |
