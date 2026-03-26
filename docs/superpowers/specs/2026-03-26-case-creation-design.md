# 案件创建功能设计

## 概述

为 LexSeek 添加完整的案件创建流程，支持手动创建和 AI 对话创建两种模式，创建完成后可选执行初始化分析（7 大分析模块串行执行）。

## 页面路由

| 页面 | 路由 | 说明 |
|------|------|------|
| 案件列表 | `/dashboard/cases` | 已有，新增「创建案件」入口 |
| 创建案件 | `/dashboard/cases/create` | 手动/AI 两种模式，同一页面切换 |
| 初始化分析 | `/dashboard/cases/init-analysis/[caseId]` | 模块选择 + Pipeline 进度 |
| 案件详情 | `/dashboard/cases/[caseId]` | 已有 |

## 整体流程

```
案件列表 → 创建案件页 ─┬─ 手动模式 ─── 提交 ──┬─→ 初始化分析页 ─→ 案件详情
                       │                      │   （可选，可跳过）
                       └─ AI 模式 ── 确认 ───┘
```

---

## 一、创建案件页面 (`/dashboard/cases/create`)

### 1.1 页面布局

单页面，顶部 segmented control 切换手动/AI 两种模式。

**设计风格**：向导式引导，非传统后台表单风格。
- 页面中央欢迎区域，大标题「创建新案件」+ 引导副标题
- 两个选项为大面积可点击卡片（图标 + 标题 + 描述），hover 有微妙动效
- 选中后页面过渡到对应模式，顶部保留小的 segmented control 方便随时切换
- 使用 ai-elements-vue 组件库，响应式兼容 web 和移动端

### 1.2 手动创建模式

居中单列布局（max-w-2xl），表单字段分区：

**必填**
- 案件类型：下拉选择（`GET /api/v1/case-types`）

**选填**
- 案件标题：文本输入
- 原告信息：动态增减输入组（支持多个原告）
- 被告信息：同上
- 案件描述：文本域

**材料上传区**
- 大面积拖拽区域，支持拖拽多文件一次性上传
- 支持点击选择文件
- 已上传文件列表（文件名、大小、进度、删除按钮）
- 复用现有 OSS 上传逻辑，上传完成后持有 `ossFileId` 列表

**底部操作**
- 「创建案件」主按钮
- 调用 `POST /api/v1/case/create` → 跳转初始化分析页

### 1.3 AI 对话创建模式

对话界面，复用 ai-elements-vue 组件：

**界面元素**
- `AiElementsConversation` 消息流区域
- 初始 AI 欢迎消息：「请描述您的案件情况，或直接上传案件材料，我来帮您提取关键信息」
- 底部 `CaseAnalysisPromptInput`（文本 + 附件上传）

**对话流程**
1. 用户输入案件描述 + 上传材料
2. 调用 `POST /api/v1/case/extract`（SSE），提取 Agent 分析材料和描述
3. Agent 返回提取结果，以**可编辑信息确认卡片**嵌入对话流：
   - 案件类型（下拉选择）
   - 案件标题（可编辑）
   - 原告列表（可编辑/增删）
   - 被告列表（可编辑/增删）
   - 案件摘要（可编辑）
   - 底部「确认并创建案件」按钮
4. 用户在卡片上直接编辑后点击确认
5. 调用 `POST /api/v1/case/create` → 跳转初始化分析页

---

## 二、初始化分析页面 (`/dashboard/cases/init-analysis/[caseId]`)

### 2.1 阶段一：模块选择

页面居中布局，延续创建页的引导式风格：

- 标题 + 副标题引导文案
- 7 个模块卡片网格（桌面端 2-3 列，移动端单列）
- 每张卡片：模块图标 + 名称 + 简短描述 + 选中状态
- `summary`（生成案件概要）和 `chronicle`（提取案件大事记）默认选中
- 底部：「开始分析」按钮 + 「跳过，进入案件详情」链接

**七大分析模块（固定顺序）：**

| 模块名 | 标题 |
|--------|------|
| summary | 生成案件概要 |
| chronicle | 提取案件大事记 |
| claim | 预分析案件请求权 |
| trend | 判决趋势预测 |
| cause | 预选案由 |
| defense | 抗辩分析及应对策略预测 |
| evidence | 证据清单预梳理 |

### 2.2 阶段二：Pipeline 进度展示

**顶部 Pipeline Progress Bar**
- 只显示用户选中的模块，按固定顺序排列
- 状态色：灰色(idle) → 蓝色脉动(streaming) → 绿色(complete) / 红色(failed)
- 点击节点锚点跳转到对应模块区域
- 移动端横向滚动

**模块结果区域**
- 垂直排列，不折叠，模块间明显分隔
- 等待中：模块名 + 灰色等待态
- 执行中：模块名 + 蓝色运行态 + 实时流式 Markdown 渲染（`AiElementsMessageResponse`）
- 已完成：模块名 + 绿色完成态 + 完整结果
- 失败：模块名 + 红色失败态 + 错误信息 + 重试按钮
- 全部完成后底部显示「进入案件详情」按钮

### 2.3 断线重连 & 页面刷新

复用现有 Redis + SSE 事件推送机制：
1. 页面加载时调用 `GET /api/v1/case/init-analysis/status/[caseId]` 获取当前状态
2. 分析进行中 → 连接 SSE 端点（重连模式）→ 补发缺失事件 + 订阅实时事件
3. 前端根据事件流恢复 Progress Bar 和各模块结果

---

## 三、后端架构

### 3.1 初始化分析 LangGraph 工作流

新建 `server/services/workflow/initAnalysis.workflow.ts`，替代现有 `caseAnalysis.workflow.ts`。

**State 定义：**
```typescript
interface InitAnalysisState {
  caseId: number
  sessionId: string
  userId: number
  selectedModules: string[]
  currentModuleIndex: number
  completedResults: Record<string, string>  // 已完成模块结果，供后续节点引用
  failedModules: Record<string, string>
}
```

**图结构：**
```
START → executeModule（循环）→ END
```

单循环节点 `executeModule`，每次执行一个模块：
1. 从 `selectedModules[currentModuleIndex]` 取模块名
2. 从 nodes 表加载模块配置（提示词、模型、工具、outputSchema）
3. 将 `completedResults` 注入 Agent 上下文（后续模块依赖前面的结果）
4. 调用单分析 Agent（复用 `caseAnalysis.ts` 模式）
5. 积分扣减（pointConsumptionMiddleware）
6. 结果写入 `caseAnalyses` 表 + `completedResults`
7. `currentModuleIndex++`，还有下一个则路由回自身，否则到 END

### 3.2 API 端点

**`POST /api/v1/case/init-analysis`**
- 入参：`caseId: number`, `selectedModules: string[]`
- 验证：用户权限、案件存在、模块名合法
- 创建 `caseSession`（type=2 初始化分析）
- 启动 LangGraph 工作流
- 复用 SSE + Redis 事件推送机制
- 支持重连：无活跃 run + 无消息 → 订阅现有 run + 补发历史

**`GET /api/v1/case/init-analysis/status/[caseId]`**
- 返回初始化分析状态：进行中/已完成/未开始
- 包含每个模块的状态和结果摘要
- 用于页面刷新后快速恢复 UI

**`POST /api/v1/case/extract`**（SSE）
- 入参：message（文本描述）、materials（ossFileId 列表）
- 调用 `extract_info` 节点的单分析 Agent
- 返回结构化 `ExtractedCaseInfo`
- 走 SSE + Redis 机制

### 3.3 数据模型变更

**caseSessions 表新增字段：**
```prisma
type    Int    @default(1)  // 1-普通对话, 2-初始化分析
```

其余模型（cases、caseMaterials、caseAnalyses、nodes）无需修改。

需确保 nodes 表中 7 个分析模块已配置：summary、chronicle、claim、trend、cause、defense、evidence。

---

## 四、前端组件结构

### 4.1 新增页面

```
app/pages/dashboard/cases/
├── create.vue                    # 创建案件页（手动/AI 切换）
└── init-analysis/
    └── [caseId].vue              # 初始化分析页
```

### 4.2 新增组件

```
app/components/caseCreation/
├── ModeSelector.vue              # 创建模式选择卡片
├── ManualForm.vue                # 手动创建表单
├── AiChat.vue                    # AI 对话创建界面
├── ExtractedInfoCard.vue         # 提取信息确认卡片（嵌入对话流）
├── MaterialUploader.vue          # 材料拖拽上传区
└── PartyInput.vue                # 当事人（原告/被告）动态输入组

app/components/initAnalysis/
├── ModuleSelector.vue            # 分析模块选择界面
├── PipelineProgress.vue          # 顶部进度条
└── ModuleResult.vue              # 单个模块结果展示区
```

### 4.3 新增 Composables

```
app/composables/
├── useCaseCreation.ts            # 案件创建状态管理
└── useInitAnalysis.ts            # 初始化分析状态管理（SSE 连接、进度追踪）
```

---

## 五、关键交互细节

### 5.1 材料上传时机

- 手动创建 & AI 对话创建：材料先上传到 OSS 获取 `ossFileId`
- 材料与案件不是一对一关系，多个案件可引用同一份材料
- 仅在用户确认创建案件时，调用 `POST /api/v1/case/create` 将材料与案件关联

### 5.2 AI 对话创建的提取 Agent

- 复用 nodes 表中 `extract_info` 节点的配置
- 作为独立的单分析 Agent 运行，支持结构化输出
- 返回 `ExtractedCaseInfo`：title、plaintiff[]、defendant[]、caseType、summary

### 5.3 初始化分析的模块依赖

7 个模块串行执行，后续模块可访问前面模块的完整分析结果：
- `completedResults` 在 State 中累积
- 每个模块执行时，将已完成的结果注入到 Agent 的系统提示或上下文中
- 例如：`defense`（抗辩分析）可以引用 `claim`（请求权）和 `trend`（判决趋势）的结果

### 5.4 错误处理

- 单个模块失败不阻塞后续模块执行
- 失败模块记录到 `failedModules`，前端显示错误信息和重试按钮
- 重试时从失败模块处继续，不需要重跑已完成的模块
