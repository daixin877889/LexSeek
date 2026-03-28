# 案件创建流程简化设计

## 概述

简化 `/dashboard/cases/create` 的案件创建逻辑，默认使用 AI 对话创建，提取案件信息后展示表单让用户确认，然后进入基础分析。同时提供手动创建入口，跳过 AI 提取步骤直接进入确认表单。

## 目标

- 去掉 ModeSelector 选择页，进入即 AI 创建
- AI 创建 3 步：AI 输入 → 确认表单 → init-analysis
- 手动创建 2 步：确认表单 → init-analysis（跳过步骤 1）
- 复用现有组件，不新增重复组件

## 页面架构

### 单页面 + 步骤状态切换

`/dashboard/cases/create.vue` 通过 `step` 状态管理两个视图：

```
step: 'ai' | 'confirm'
```

#### step = 'ai'（默认）

参照 `/dashboard/analysis` 页面布局，结构和 UI 样式保持风格统一：

```
┌──────────────────────────────────────────┐
│          欢迎语                           │
│  "描述您的案件，AI 将帮您提取关键信息"     │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  输入框（支持文件上传、拖拽）     │    │
│  └──────────────────────────────────┘    │
│                                          │
│     [示例案件卡片] [示例案件卡片]          │
│                                          │
│  "手动创建 →" 链接                       │
└──────────────────────────────────────────┘
```

#### step = 'confirm'

```
┌──────────────────────────────────────────┐
│  ← 返回                                  │
│  ManualForm（优化版）                     │
│  - 案件标题（必填）                       │
│  - 案件类型（全宽下拉）                   │
│  - 原告/被告                             │
│  - 案件描述                              │
│  - 材料上传（带状态显示）                 │
│  - [创建案件]（校验不通过禁用）           │
└──────────────────────────────────────────┘
```

### 数据流

- **AI 路径**：用户提交描述 → 调用 `POST /api/v1/case/extract` → 返回 `ExtractedCaseInfo` → 映射为表单字段 → `step = 'confirm'`（预填充）
- **手动路径**：点击"手动创建" → `step = 'confirm'`（空表单）
- **确认表单返回**：`step = 'ai'`，保留之前的输入内容
- **确认提交**：调用 `POST /api/v1/case/create` → 跳转 `/dashboard/cases/init-analysis/[sessionId]`

## 组件变更

### 通用化改造

| 组件 | 改动 |
|------|------|
| `caseAnalysis/welcome.vue` | 添加 `title`、`subtitle` props，默认值保持原样，案件创建页传入不同文案 |
| `caseAnalysis/example.vue` | 添加 `examples` prop（数据外部传入）和 `select` emit（点击回调），提取硬编码数据为默认值 |
| `caseAnalysis/promptInput.vue` | 添加 `submitLabel`、`fileLabel` 等 props 解耦文案；或在案件创建页直接复用底层 `AiPromptInput` 包一层薄逻辑 |

### 表单优化

| 组件 | 改动 |
|------|------|
| `ManualForm.vue` | 1. 案件标题必填<br>2. 案件类型下拉框全宽<br>3. 接收 `initialData` props 预填充字段<br>4. 案件描述和案件材料不能都为空<br>5. 校验不通过禁用"创建案件"按钮<br>6. 移动端样式优化 |
| `MaterialUploader.vue` | 增加上传中/识别中/已识别/失败重试的状态显示（参照 `AiPromptInput` 的文件处理逻辑） |

### ManualForm 新增 props

```typescript
interface ManualFormProps {
  initialData?: {
    title?: string
    caseTypeId?: number
    plaintiff?: PartyInfo[]
    defendant?: PartyInfo[]
    content?: string
    materials?: CaseMaterialParam[]
  }
}
```

### 删除

| 组件 | 理由 |
|------|------|
| `caseCreation/ModeSelector.vue` | 不再需要模式选择 |
| `caseCreation/AiChat.vue` | 被新流程替代 |
| `caseCreation/ExtractedInfoCard.vue` | 提取结果直接映射到 ManualForm |

## Composable 改造

### `useCaseCreation.ts`

```typescript
// 之前
const mode = ref<'select' | 'manual' | 'ai'>('select')

// 之后
const step = ref<'ai' | 'confirm'>('ai')
const extractedInfo = ref<ExtractedCaseInfo | null>(null)
const isExtracting = ref(false)

// 新增方法
async function extractCaseInfo(message: string, materials?: Array<{ ossFileId: number; name: string }>) {
  // 调用 POST /api/v1/case/extract
  // 返回 ExtractedCaseInfo
  // 映射到 ManualForm 的 initialData 格式
}
```

### 提取结果映射

```typescript
function mapExtractedInfoToFormData(info: ExtractedCaseInfo, caseTypes: CaseType[]) {
  return {
    title: info.title,
    caseTypeId: caseTypes.find(t => t.name === info.caseType)?.id,
    plaintiff: info.plaintiff.map(name => ({ name })),
    defendant: info.defendant.map(name => ({ name })),
    content: info.summary,
  }
}
```

## API 变更

**后端无需改动**。现有 API 完全满足新流程：

| API | 用途 |
|-----|------|
| `POST /api/v1/case/extract` | AI 提取案件信息（已有） |
| `POST /api/v1/case/create` | 创建案件（已有） |
| `GET /api/v1/case-types` | 获取案件类型列表（已有） |

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| extract API 失败 | toast 提示错误，用户可重试或切换手动创建 |
| extract 返回不完整数据 | 已有字段预填，缺失字段留空让用户补充 |
| caseType 名称匹配不到 | 类型下拉留空，用户手动选择 |
| 确认表单返回 AI 步骤 | 保留之前的输入内容（输入框不清空） |
| 材料上传失败/识别失败 | 显示失败状态和重试按钮 |
| 表单校验不通过 | 禁用"创建案件"按钮，字段旁显示校验提示 |
| create API 失败 | toast 提示，不跳转，用户可重试 |

## 文件影响范围

### 修改

- `app/pages/dashboard/cases/create.vue` — 重写页面逻辑
- `app/composables/useCaseCreation.ts` — 重构状态管理
- `app/components/caseCreation/ManualForm.vue` — 6 项 UI 优化 + initialData props
- `app/components/caseCreation/MaterialUploader.vue` — 文件状态显示
- `app/components/caseAnalysis/welcome.vue` — 添加 props 通用化
- `app/components/caseAnalysis/example.vue` — 添加 props/emit 通用化
- `app/components/caseAnalysis/promptInput.vue` — 添加 props 解耦文案

### 删除

- `app/components/caseCreation/ModeSelector.vue`
- `app/components/caseCreation/AiChat.vue`
- `app/components/caseCreation/ExtractedInfoCard.vue`
