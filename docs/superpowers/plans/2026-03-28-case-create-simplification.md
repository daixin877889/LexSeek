# 案件创建流程简化 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 简化案件创建流程，默认 AI 提取 → 确认表单 → 基础分析，同时提供手动创建快捷入口。

**Architecture:** 单页面 `create.vue` 通过 `step` 状态切换 AI 输入视图和确认表单视图。复用现有 `AiPromptInput`、`welcome`、`example` 组件（通过 props 通用化），改造 `ManualForm` 增加预填充和校验，重构 `useCaseCreation` composable。

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Tailwind CSS v4, shadcn-vue, Vitest

**Spec:** `docs/superpowers/specs/2026-03-28-case-create-simplification-design.md`

**并行关系:** Task 1-5 互相独立，可并行执行。Task 6 依赖 Task 1-5 的接口设计但不强依赖代码。Task 7 消费 Task 1-6 的成果。Task 8 在 Task 7 之后。Task 9 最后执行。

**类型说明:** `ExtractedCaseInfo`、`CaseMaterialType`、`CaseMaterialParam`、`CaseTypeOption` 等类型已存在于 `shared/types/case.ts`，无需新增类型文件。

---

## 文件结构

### 修改

| 文件 | 职责 |
|------|------|
| `app/components/ai/AiPromptInput.vue` | 添加 `submitLabel` prop |
| `app/components/caseAnalysis/welcome.vue` | 添加 `title`、`subtitle` props |
| `app/components/caseAnalysis/example.vue` | 添加 `examples` prop + `select` emit |
| `app/components/caseCreation/ManualForm.vue` | `initialData` props + 6 项 UI 优化 + 校验 |
| `app/components/caseCreation/MaterialUploader.vue` | 增加文件识别状态显示 |
| `app/composables/useCaseCreation.ts` | `mode` → `step`，新增 `extractCaseInfo` |
| `app/pages/dashboard/cases/create.vue` | 重写页面逻辑 |

### 删除

| 文件 | 理由 |
|------|------|
| `app/components/caseCreation/ModeSelector.vue` | 不再需要 |
| `app/components/caseCreation/AiChat.vue` | 被新流程替代 |
| `app/components/caseCreation/ExtractedInfoCard.vue` | 提取结果映射到 ManualForm |

---

## Task 1: AiPromptInput 添加 submitLabel prop

**Files:**
- Modify: `app/components/ai/AiPromptInput.vue`

- [ ] **Step 1: 添加 `submitLabel` prop**

在 props 定义中添加：

```typescript
const props = withDefaults(defineProps<{
  placeholder?: string
  loading?: boolean
  disabled?: boolean
  enableFileUpload?: boolean
  showThinkingToggle?: boolean
  minRows?: number
  maxRows?: number
  submitLabel?: string  // 新增：提交按钮文字，不传则只显示图标
}>(), {
  placeholder: '输入消息...',
  loading: false,
  disabled: false,
  enableFileUpload: true,
  showThinkingToggle: true,
  minRows: 1,
  maxRows: 4,
})
```

- [ ] **Step 2: 修改提交按钮渲染**

将模板中的提交按钮区域改为：

```vue
<PromptInputSubmit
  class="h-9 px-4! rounded-md shadow-lg shadow-primary/20 active:scale-95 transition-all"
  :status="submitStatus"
  :disabled="isSubmitDisabled"
  size="xs">
  <SendHorizontal class="size-4" />
  <span v-if="submitLabel" class="ml-1">{{ submitLabel }}</span>
</PromptInputSubmit>
```

- [ ] **Step 3: 验证现有使用不受影响**

确认 `submitLabel` 默认不传时行为与之前一致（仅图标），在 analysis 页面和其他使用处无副作用。

Run: `bun dev`，访问 `/dashboard/analysis`，确认输入框和提交按钮正常。

- [ ] **Step 4: Commit**

```bash
git add app/components/ai/AiPromptInput.vue
git commit -m "feat(ui): AiPromptInput 添加 submitLabel prop 支持自定义按钮文字"
```

---

## Task 2: welcome.vue 通用化

**Files:**
- Modify: `app/components/caseAnalysis/welcome.vue`

- [ ] **Step 1: 添加 props**

```typescript
const props = withDefaults(defineProps<{
  title?: string
  subtitle?: string
}>(), {
  title: '你好，我是小索，你的案件分析助手',
  subtitle: '在下方输入框输入你的案件信息，我会为你分析案件',
})
```

- [ ] **Step 2: 替换硬编码文案**

将模板中的硬编码文字替换为 `{{ title }}` 和 `{{ subtitle }}`。

- [ ] **Step 3: 验证 analysis 页面不受影响**

Run: `bun dev`，访问 `/dashboard/analysis`，确认欢迎语显示正常（使用默认值）。

- [ ] **Step 4: Commit**

```bash
git add app/components/caseAnalysis/welcome.vue
git commit -m "refactor(ui): welcome 组件添加 title/subtitle props 支持通用化"
```

---

## Task 3: example.vue 通用化

**Files:**
- Modify: `app/components/caseAnalysis/example.vue`

- [ ] **Step 1: 定义 props 和 emit**

```typescript
interface ExampleItem {
  id: number
  title: string
  description: string
  content?: string
}

const props = withDefaults(defineProps<{
  examples?: ExampleItem[]
  title?: string
}>(), {
  title: '✨ 或者你可以点击下方案例体验分析流程',
})

const emit = defineEmits<{
  select: [example: ExampleItem]
}>()
```

- [ ] **Step 2: 提取硬编码数据为默认值**

将现有的 4 个案例数据提取到组件外部作为默认 `examples`。如果 `examples` prop 未传，使用这些默认数据。

```typescript
const defaultExamples: ExampleItem[] = [
  { id: 'demo-1', title: '消费者诉健身房', description: '消费者权益纠纷案...', content: '...(现有长文本)' },
  { id: 'demo-2', title: '劳动合同纠纷', description: '劳动者与用人单位...' },
  { id: 'demo-3', title: '民间借贷纠纷', description: '借款人与出借人...' },
  { id: 'demo-4', title: '房屋买卖合同', description: '买方与卖方...' },
]

const displayExamples = computed(() => props.examples ?? defaultExamples)
```

- [ ] **Step 3: 添加点击事件**

在卡片上添加 `@click="emit('select', example)"`。

- [ ] **Step 4: 替换模板中的硬编码**

标题文字替换为 `{{ title }}`，`v-for` 遍历 `displayExamples`。

- [ ] **Step 5: 验证 analysis 页面不受影响**

Run: `bun dev`，访问 `/dashboard/analysis`，确认示例卡片显示正常、点击行为正常。

- [ ] **Step 6: Commit**

```bash
git add app/components/caseAnalysis/example.vue
git commit -m "refactor(ui): example 组件添加 examples prop 和 select emit 支持通用化"
```

---

## Task 4: ManualForm 改造

**Files:**
- Modify: `app/components/caseCreation/ManualForm.vue`

- [ ] **Step 1: 添加 `initialData` prop**

```typescript
interface InitialData {
  title?: string
  caseTypeId?: number
  plaintiff?: string[]
  defendant?: string[]
  content?: string
  materials?: CaseMaterialParam[]
}

const props = defineProps<{
  caseTypes: CaseTypeOption[]
  isSubmitting?: boolean
  initialData?: InitialData
}>()
```

- [ ] **Step 2: 使用 initialData 预填充表单**

在 `onMounted` 或 `watch(props.initialData)` 中，将 `initialData` 映射到 `form` 的各字段：

```typescript
watch(() => props.initialData, (data) => {
  if (!data) return
  if (data.title) form.title = data.title
  if (data.caseTypeId) form.caseTypeId = String(data.caseTypeId)  // Select 组件使用 string
  if (data.plaintiff?.length) form.plaintiff = [...data.plaintiff]
  if (data.defendant?.length) form.defendant = [...data.defendant]
  if (data.content) form.content = data.content
  // materials 由 MaterialUploader 处理
}, { immediate: true })
```

- [ ] **Step 3: 案件标题改为必填**

在表单中将标题 label 添加必填标识，校验时检查 `form.title.trim()` 非空。

- [ ] **Step 4: 案件类型下拉框全宽**

移除下拉框的宽度限制，改为 `w-full`。

- [ ] **Step 5: 完善校验规则和按钮禁用**

```typescript
const canSubmit = computed(() => {
  // 标题必填
  if (!form.title.trim()) return false
  // 类型必填
  if (!form.caseTypeId) return false
  // 描述和材料至少一项
  const hasContent = !!form.content.trim()
  const hasMaterials = uploadedFiles.value.length > 0
  if (!hasContent && !hasMaterials) return false
  return true
})
```

给提交按钮绑定 `:disabled="!canSubmit || isSubmitting"`。

- [ ] **Step 6: 添加 inline 校验提示**

在标题、类型字段旁显示校验提示文字（仅在用户交互后显示，避免初始加载时就报错）：

```vue
<p v-if="touched.title && !form.title.trim()" class="text-sm text-destructive mt-1">
  请输入案件标题
</p>
```

用 `touched` ref 追踪用户是否已交互过该字段。

- [ ] **Step 7: 移动端样式优化**

- 表单字段在移动端使用单列布局
- 按钮区域在小屏幕上全宽
- 增加适当的间距

```vue
<div class="grid grid-cols-1 gap-4 sm:gap-6">
  <!-- 表单字段 -->
</div>
<div class="mt-6">
  <Button :disabled="!canSubmit || isSubmitting" class="w-full sm:w-auto">
    创建案件
  </Button>
</div>
```

- [ ] **Step 8: 验证手动填写和预填充两种场景**

Run: `bun dev`，测试：
1. 不传 `initialData` 时，表单为空，校验生效
2. 传入 `initialData` 时，字段正确预填充

- [ ] **Step 9: Commit**

```bash
git add app/components/caseCreation/ManualForm.vue
git commit -m "feat(ui): ManualForm 支持 initialData 预填充、校验优化和移动端适配"
```

---

## Task 5: MaterialUploader 文件识别状态

**Files:**
- Modify: `app/components/caseCreation/MaterialUploader.vue`

- [ ] **Step 1: 添加文件识别状态追踪**

参照 `AiPromptInput.vue` 的实现，添加：

```typescript
import { isRecognizableDocFile, isImageFile, isAudioFile } from '~~/shared/utils/fileType'

// 文件识别状态映射
const fileRecognitionStatus = ref<Map<number, 'idle' | 'recognizing' | 'success' | 'error'>>(new Map())
const pollingTimers = ref<Map<number, NodeJS.Timeout>>(new Map())
const POLLING_INTERVAL = 2000
const MAX_POLLING_ATTEMPTS = 60
```

- [ ] **Step 2: 实现识别触发和轮询逻辑**

文件上传成功后，对可识别文件（文档、图片、音频）自动调用 `/api/v1/recognition/start` 并启动状态轮询：

```typescript
async function startRecognition(ossFileIds: number[]) {
  ossFileIds.forEach(id => fileRecognitionStatus.value.set(id, 'recognizing'))
  try {
    const response = await useApiFetch<{
      results: Array<{ ossFileId: number; status: 'processing' | 'completed' | 'failed' }>
    }>('/api/v1/recognition/start', {
      method: 'POST',
      body: { ossFileIds }
    })
    // 处理响应...（参照 AiPromptInput 的 handleFilesSelected 逻辑）
  } catch {
    ossFileIds.forEach(id => fileRecognitionStatus.value.set(id, 'error'))
  }
}
```

复用 `AiPromptInput` 中的 `pollFileStatus` 逻辑。

- [ ] **Step 3: 添加状态徽章到已上传文件列表**

在已上传文件项旁添加识别状态徽章（参照 `AiPromptInput` 模板中的 Badge 组件）：

```vue
<Badge v-if="getRecognitionStatus(file.id) === 'recognizing'" variant="outline"
  class="text-xs px-1 h-5 text-blue-500 border-blue-500 animate-pulse bg-blue-50/50 dark:bg-blue-500/10">
  <Loader2Icon class="size-3 animate-spin mr-0.5" />
  识别中
</Badge>
<!-- success 和 error 徽章同理 -->
```

- [ ] **Step 4: 添加失败重试功能**

```typescript
async function retryRecognition(fileId: number) {
  fileRecognitionStatus.value.set(fileId, 'recognizing')
  await startRecognition([fileId])
}
```

- [ ] **Step 5: 清理轮询定时器**

```typescript
onUnmounted(() => {
  pollingTimers.value.forEach(clearTimeout)
  pollingTimers.value.clear()
})
```

- [ ] **Step 6: 支持回显 initialData 中的材料**

添加 `initialFiles` prop，接收从 AI 步骤传入的已上传文件列表：

```typescript
const props = defineProps<{
  initialFiles?: OssFileItem[]
}>()

watch(() => props.initialFiles, (files) => {
  if (files?.length) {
    // 将已有文件添加到已上传列表，避免重复
  }
}, { immediate: true })
```

- [ ] **Step 7: Commit**

```bash
git add app/components/caseCreation/MaterialUploader.vue
git commit -m "feat(ui): MaterialUploader 增加文件识别状态显示和回显支持"
```

---

## Task 6: useCaseCreation composable 重构

**Files:**
- Modify: `app/composables/useCaseCreation.ts`

- [ ] **Step 1: 重构状态管理**

将 `mode` 替换为 `step`，添加提取相关状态：

```typescript
export function useCaseCreation() {
  const step = ref<'ai' | 'confirm'>('ai')
  const isSubmitting = ref(false)
  const isExtracting = ref(false)
  const caseTypes = ref<CaseTypeOption[]>([])
  const extractedFormData = ref<{
    title?: string
    caseTypeId?: number
    plaintiff?: string[]
    defendant?: string[]
    content?: string
  } | null>(null)
  const uploadedMaterials = ref<CaseMaterialParam[]>([])

  // loadCaseTypes 保持不变
  // createCase 保持不变
```

- [ ] **Step 2: 实现 extractCaseInfo 方法**

```typescript
async function extractCaseInfo(message: string, files?: OssFileItem[]) {
  isExtracting.value = true
  try {
    // 保存上传的材料
    if (files?.length) {
      uploadedMaterials.value = files.map(f => ({
        type: CaseMaterialType.DOCUMENT,
        name: f.fileName,
        ossFileId: f.id,
      }))
    }

    // 保证 message 非空
    const text = message.trim() || '请根据上传的材料提取案件信息'

    const result = await useApiFetch<{
      message: string
      extractedInfo?: ExtractedCaseInfo
    }>('/api/v1/case/extract', {
      method: 'POST',
      body: {
        message: text,
        materials: files?.map(f => ({ ossFileId: f.id, name: f.fileName })),
      },
    })

    if (result?.extractedInfo) {
      extractedFormData.value = mapExtractedInfoToFormData(result.extractedInfo, caseTypes.value)
      step.value = 'confirm'
    } else {
      toast.warning(result?.message || '未能提取到案件信息，请尝试补充描述或手动创建')
    }
  } catch (error) {
    toast.error('提取失败，请重试或切换到手动创建')
  } finally {
    isExtracting.value = false
  }
}
```

- [ ] **Step 3: 实现映射函数**

```typescript
function mapExtractedInfoToFormData(info: ExtractedCaseInfo, types: CaseTypeOption[]) {
  return {
    title: info.title,
    caseTypeId: types.find(t => t.name === info.caseType || t.name.includes(info.caseType))?.id,
    plaintiff: info.plaintiff,
    defendant: info.defendant,
    content: info.summary,
  }
}
```

- [ ] **Step 4: 导出所有状态和方法**

```typescript
  return {
    step,
    isSubmitting,
    isExtracting,
    caseTypes,
    extractedFormData,
    uploadedMaterials,
    loadCaseTypes,
    createCase,
    extractCaseInfo,
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add app/composables/useCaseCreation.ts
git commit -m "refactor(cases): useCaseCreation 重构为 step 模式，新增 extractCaseInfo"
```

---

## Task 7: create.vue 页面重写

**Files:**
- Modify: `app/pages/dashboard/cases/create.vue`

- [ ] **Step 1: 重写页面模板**

参照 `/dashboard/analysis/index.vue` 的布局风格。使用 `v-show` 而非 `v-if` 切换 AI 视图，避免组件销毁导致输入内容丢失：

```vue
<template>
  <div class="flex h-full flex-col">
    <!-- step = 'ai': AI 创建视图（v-show 保留 DOM 避免输入丢失） -->
    <div v-show="step === 'ai'" class="flex flex-1 flex-col items-center justify-center gap-6 p-4">
      <!-- 欢迎语 -->
      <CaseAnalysisWelcome
        title="描述您的案件"
        subtitle="AI 将帮您提取关键信息，快速创建案件"
      />

      <!-- 输入框 -->
      <div class="w-full max-w-3xl">
        <AiPromptInput
          ref="promptInputRef"
          placeholder="请描述您的案件情况，例如：张三与李四因房屋租赁合同产生纠纷..."
          :enable-file-upload="true"
          :show-thinking-toggle="false"
          :loading="isExtracting"
          :disabled="isExtracting"
          submit-label="提取信息"
          @submit="handleAiSubmit"
        />
      </div>

      <!-- 示例卡片 -->
      <div class="w-full max-w-3xl">
        <CaseAnalysisExample
          title="✨ 或者点击下方案例快速体验"
          @select="handleExampleSelect"
        />
      </div>

      <!-- 手动创建入口 -->
      <div class="w-full max-w-3xl text-right">
        <Button variant="link" @click="goToManual" class="text-muted-foreground">
          手动创建
          <ArrowRightIcon class="size-4 ml-1" />
        </Button>
      </div>
    </div>

    <!-- step = 'confirm': 确认表单视图 -->
    <div v-if="step === 'confirm'" class="flex flex-1 flex-col p-4 sm:p-6">
      <!-- 返回按钮 -->
      <Button variant="ghost" size="sm" class="self-start mb-4" @click="step = 'ai'">
        <ArrowLeftIcon class="size-4 mr-1" />
        返回
      </Button>

      <!-- 表单 -->
      <div class="mx-auto w-full max-w-2xl">
        <CaseCreationManualForm
          :case-types="caseTypes"
          :is-submitting="isSubmitting"
          :initial-data="formInitialData"
          @submit="handleCreate"
        />
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 实现页面脚本**

```typescript
<script setup lang="ts">
import { ArrowRightIcon, ArrowLeftIcon } from 'lucide-vue-next'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'

definePageMeta({
  layout: 'dashboard-layout',
  title: '创建案件',
})

const {
  step, isSubmitting, isExtracting, caseTypes,
  extractedFormData, uploadedMaterials,
  loadCaseTypes, createCase, extractCaseInfo,
} = useCaseCreation()

const promptInputRef = ref()

onMounted(() => {
  loadCaseTypes()
})

// AI 提交处理
async function handleAiSubmit(data: AiPromptSubmitData) {
  await extractCaseInfo(data.text, data.files)
}

// 示例选择处理
function handleExampleSelect(example: { content?: string; title?: string; description?: string }) {
  // 将示例文本填入输入框（通过 ref 操作）
  // 或直接调用 extractCaseInfo
  if (example.content) {
    extractCaseInfo(example.content)
  }
}

// 手动创建
function goToManual() {
  extractedFormData.value = null
  uploadedMaterials.value = []
  step.value = 'confirm'
}

// 表单初始数据
const formInitialData = computed(() => {
  if (!extractedFormData.value) return undefined
  return {
    ...extractedFormData.value,
    materials: uploadedMaterials.value,
  }
})

// 创建案件
async function handleCreate(params: {
  caseTypeId: number
  title?: string
  plaintiff?: Array<{ name: string }>
  defendant?: Array<{ name: string }>
  content?: string
  materials?: Array<{ type: number; name?: string; ossFileId?: number }>
}) {
  await createCase(params)
}
</script>
```

- [ ] **Step 3: 验证完整流程**

Run: `bun dev`，测试以下场景：

1. **AI 路径**：输入描述 → 点击"提取信息" → 跳转确认表单（预填充）→ 创建案件 → 跳转 init-analysis
2. **手动路径**：点击"手动创建" → 空表单 → 填写 → 创建案件 → 跳转 init-analysis
3. **返回**：确认表单点返回 → AI 视图（输入保留）
4. **示例选择**：点击示例卡片 → 自动提取
5. **错误处理**：提取失败 toast 提示、表单校验禁用按钮

- [ ] **Step 4: Commit**

```bash
git add app/pages/dashboard/cases/create.vue
git commit -m "feat(cases): 重写案件创建页面，默认 AI 提取 + 确认表单流程"
```

---

## Task 8: 删除废弃组件

**Files:**
- Delete: `app/components/caseCreation/ModeSelector.vue`
- Delete: `app/components/caseCreation/AiChat.vue`
- Delete: `app/components/caseCreation/ExtractedInfoCard.vue`

- [ ] **Step 1: 确认无其他引用**

```bash
# 搜索这三个组件的引用
grep -r "ModeSelector\|CaseCreationModeSelector" app/ --include="*.vue" --include="*.ts" -l
grep -r "AiChat\|CaseCreationAiChat" app/ --include="*.vue" --include="*.ts" -l
grep -r "ExtractedInfoCard\|CaseCreationExtractedInfoCard" app/ --include="*.vue" --include="*.ts" -l
```

确认搜索结果仅包含即将删除的文件本身和已修改的 create.vue。

- [ ] **Step 2: 删除文件**

```bash
git rm app/components/caseCreation/ModeSelector.vue
git rm app/components/caseCreation/AiChat.vue
git rm app/components/caseCreation/ExtractedInfoCard.vue
```

- [ ] **Step 3: 验证构建无报错**

Run: `bun dev`，确认页面正常加载无缺失组件报错。

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(cases): 删除废弃的 ModeSelector、AiChat、ExtractedInfoCard 组件"
```

---

## Task 9: 端到端验证

- [ ] **Step 1: 类型检查**

```bash
npx nuxi typecheck
```

修复所有类型错误。

- [ ] **Step 2: 完整流程测试**

手动测试以下场景并记录结果：

| 场景 | 预期 | 通过? |
|------|------|-------|
| 进入创建页，显示 AI 输入界面 | 欢迎语 + 输入框 + 示例 + 手动创建链接 | |
| 输入案件描述，点击提取 | loading 状态 → 跳转确认表单（预填充） | |
| 仅上传文件，点击提取 | 自动生成占位文本，正常提取 | |
| 提取失败 | toast 错误提示，输入框恢复 | |
| 点击手动创建 | 直接进入空表单 | |
| 确认表单点返回 | 回到 AI 视图，之前输入保留 | |
| 标题为空时提交 | 按钮禁用，提示标题必填 | |
| 描述和材料都为空 | 按钮禁用 | |
| 填写完整信息并提交 | 创建成功，跳转 init-analysis | |
| 移动端访问 | 布局正常，无溢出 | |

- [ ] **Step 3: 修复发现的问题**

根据测试结果修复问题。

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "fix(cases): 修复案件创建流程端到端测试发现的问题"
```
