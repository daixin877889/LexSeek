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
| `caseAnalysis/example.vue` | 添加 `examples` prop（数据外部传入）和 `select` emit（点击回调），提取硬编码数据为默认值。案件创建场景：点击示例后将示例文本填入输入框 |
| `ai/AiPromptInput.vue` | 直接复用通用组件。需新增 `submitLabel` prop 支持自定义提交按钮文字（案件创建场景显示"创建案件"，默认仅显示发送图标）。FileSource 复用 `CASE_ANALYSIS`，无需改动。`enableFileUpload: true`、`showThinkingToggle: false`、`placeholder: '请描述您的案件情况...'` |

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
    plaintiff?: string[]      // ManualForm 内部使用 string[]，提交时才转为 { name: string }[]
    defendant?: string[]
    content?: string
    materials?: CaseMaterialParam[]  // AI 步骤上传的文件也传入
  }
}
```

### 校验规则

ManualForm 完整校验规则（全部通过才启用提交按钮）：

| 规则 | 类型 | 说明 |
|------|------|------|
| 案件标题非空 | 必填 | 字段旁 inline 提示 |
| 案件类型已选择 | 必填 | 字段旁 inline 提示 |
| 描述和材料至少一项 | 组合必填 | 两个字段都为空时，在描述字段下方提示 |

### 删除

| 组件 | 理由 |
|------|------|
| `caseCreation/ModeSelector.vue` | 不再需要模式选择 |
| `caseCreation/AiChat.vue` | 被新流程替代（ExtractedInfoCard 仅在此组件中引用，一并删除） |
| `caseCreation/ExtractedInfoCard.vue` | 提取结果直接映射到 ManualForm |

### 保留不变

| 组件 | 说明 |
|------|------|
| `caseCreation/PartyInput.vue` | ManualForm 内部使用，保持不变 |

### 页面配置

`create.vue` 保持 `definePageMeta({ layout: 'dashboard-layout' })`，与现有一致。

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
    caseTypeId: caseTypes.find(t => t.name === info.caseType || t.name.includes(info.caseType))?.id,
    plaintiff: info.plaintiff,   // string[] 直接赋值
    defendant: info.defendant,   // string[] 直接赋值
    content: info.summary,
  }
}
```

### AI 上传材料的传递

AI 步骤中用户上传的文件需要在切换到 confirm 时一并传递。在 `useCaseCreation.ts` 中维护一个 `uploadedMaterials` ref：

```typescript
const uploadedMaterials = ref<CaseMaterialParam[]>([])

async function extractCaseInfo(message: string, materials?: Array<{ ossFileId: number; name: string }>) {
  // 1. 保存用户上传的材料到 uploadedMaterials
  if (materials?.length) {
    uploadedMaterials.value = materials.map(m => ({
      type: CaseMaterialType.DOCUMENT,
      name: m.name,
      ossFileId: m.ossFileId,
    }))
  }
  // 2. 调用 extract API
  // 3. 映射结果到 formData（包含 materials: uploadedMaterials.value）
}
```

ManualForm 的 `initialData.materials` 传入后，MaterialUploader 回显这些已上传文件。

### AI 提取中的 UI 反馈

用户点击提交后到提取完成期间：
- 提交按钮显示 loading 状态（转圈 + "正在分析..."）
- 输入框禁用，防止重复提交
- 提取失败时恢复输入框，toast 提示错误

## API 变更

**后端基本无需改动**，现有 API 满足新流程：

| API | 用途 | 备注 |
|-----|------|------|
| `POST /api/v1/case/extract` | AI 提取案件信息 | `message` 字段当前必填（`z.string().min(1)`），前端需保证提交时有文本 |
| `POST /api/v1/case/create` | 创建案件 | 无变更 |
| `GET /api/v1/case-types` | 获取案件类型列表 | 无变更 |

**注意**：如果用户仅上传文件不输入文字，前端应自动生成占位文本（如"请根据上传的材料提取案件信息"），避免 extract API 返回 400。

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| extract API 失败 | toast 提示错误，用户可重试或切换手动创建 |
| extract 返回不完整数据 | 已有字段预填，缺失字段留空让用户补充 |
| caseType 名称匹配不到 | 类型下拉留空，用户手动选择 |
| 确认表单返回 AI 步骤 | 保留 promptInput 中的文本和已上传文件列表（不清空） |
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
- `app/components/ai/AiPromptInput.vue` — 添加 `submitLabel` prop 支持自定义按钮文字

### 删除

- `app/components/caseCreation/ModeSelector.vue`
- `app/components/caseCreation/AiChat.vue`
- `app/components/caseCreation/ExtractedInfoCard.vue`
