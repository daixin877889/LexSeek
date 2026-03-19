# promptInput 提交逻辑抽象 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 promptInput.vue 的提交逻辑抽象为事件驱动，使其可在创建页和分析页复用。

**Architecture:** promptInput.vue 移除内部业务逻辑，通过 emit 向上传递 `PromptSubmitData`。创建页（index.vue）接收事件处理案件创建，分析页（[sessionId].vue）接收事件发送 chat 消息。同时移除 [sessionId] 页面的中断确认组件。

**Tech Stack:** Vue 3, TypeScript, Nuxt 4

**Spec:** `docs/superpowers/specs/2026-03-20-prompt-input-abstraction-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| shared/types/case.ts | 修改 | 新增 `PromptSubmitData` 类型 |
| app/components/caseAnalysis/promptInput.vue | 修改 | 抽象提交逻辑为 emit 事件 |
| app/pages/dashboard/analysis/index.vue | 修改 | 接收 submit 事件，承载创建逻辑 |
| app/pages/dashboard/analysis/[sessionId].vue | 修改 | 替换输入框，移除中断组件 |

---

### Task 1: 新增 PromptSubmitData 类型

**Files:**
- Modify: `shared/types/case.ts`

- [ ] **Step 1: 在 CaseMaterialParam 接口之后新增 PromptSubmitData 类型**

在 `shared/types/case.ts` 的 `CaseMaterialParam` 接口后面添加：

```typescript
/**
 * promptInput 提交的标准化数据
 * 由调用方决定如何处理（创建案件 or 发送补充消息）
 * text 为空字符串时表示纯附件提交，调用方应使用 data.text.trim() 判断
 */
export interface PromptSubmitData {
    /** 用户输入的文本 */
    text: string
    /** 已选材料列表 */
    materials: CaseMaterialParam[]
}
```

- [ ] **Step 2: 提交**

```bash
git add shared/types/case.ts
git commit -m "feat(analysis): 新增 PromptSubmitData 类型定义"
```

---

### Task 2: 重构 promptInput.vue — 抽象提交逻辑

**Files:**
- Modify: `app/components/caseAnalysis/promptInput.vue`

- [ ] **Step 1: 添加 props、emit、暴露 reset 方法**

在 `<script>` 顶部添加 props 和 emit 定义：

```typescript
import type { PromptSubmitData, CaseMaterialParam } from '#shared/types/case'

const props = withDefaults(defineProps<{
  placeholder?: string
  submitLabel?: string
  loading?: boolean
  disabled?: boolean
  enableWatcher?: boolean
}>(), {
  placeholder: '请输入案情信息或者上传案情材料，支持上传 文本、文档、音频、图片 四种材料。',
  submitLabel: '法索一下',
  loading: false,
  disabled: false,
  enableWatcher: true,
})

const emit = defineEmits<{
  submit: [data: PromptSubmitData]
}>()
```

- [ ] **Step 2: 添加 reset 方法并暴露**

`PromptInput` 组件通过 `usePromptInput()` composable 提供 `clearInput` 和 `clearFiles` 方法（定义在 `ai-elements/prompt-input/context.ts`）。在 `promptInput.vue` 中导入使用：

```typescript
import { usePromptInput } from '@/components/ai-elements/prompt-input/context'

const { clearInput, clearFiles } = usePromptInput()

function reset() {
  selectedFiles.value = []
  fileRecognitionStatus.value.clear()
  stopAllPolling()
  clearInput()
  clearFiles()
}

defineExpose({ reset })
```

注意：`usePromptInput()` 必须在 `<PromptInputProvider>` 内部调用（组件已满足此条件）。



- [ ] **Step 3: 用 computed 派生 submitStatus 替换内部 status ref**

移除 `const status = ref<...>("ready")`，替换为：

```typescript
const submitStatus = computed(() => {
  if (props.loading) return 'streaming'
  return 'ready'
})
```

模板中 `:status="status"` 改为 `:status="submitStatus"`。

- [ ] **Step 4: 重构 handleSubmit 方法**

将 `handleSubmit` 中的业务逻辑替换为 emit：

```typescript
async function handleSubmit(message: PromptInputMessage) {
  const hasText = !!message.text?.trim()
  const hasAttachments = selectedFiles.value.length > 0

  if (!hasText && !hasAttachments) {
    toast.warning("请输入案情信息或选择案情材料")
    return
  }

  // 检查是否有正在识别的文件
  const recognizingFiles = selectedFiles.value.filter(f => {
    const isRecognizable = isRecognizableDocFile(f.fileName) || isImageFile(f.fileName) || isAudioFile(f.fileName)
    return isRecognizable && getRecognitionStatus(f.id) === 'recognizing'
  })
  if (recognizingFiles.length > 0) {
    toast.warning("请等待文件识别完成后再提交")
    return
  }

  // 构建标准化数据
  const materials: CaseMaterialParam[] = selectedFiles.value.map(file => ({
    type: getMaterialType(file.fileType),
    name: file.fileName,
    ossFileId: file.id,
  }))

  emit('submit', {
    text: message.text?.trim() || '',
    materials,
  })
}
```

- [ ] **Step 5: 移除不再需要的代码**

移除：
- `const router = useRouter()` — 不再需要路由跳转
- `status` ref 及其所有赋值（`status.value = "submitted"` 等）
- `handleSubmit` 中的创建 API 调用、标题生成、路由跳转、错误处理相关代码

- [ ] **Step 6: 更新模板 — 使用 props**

1. `PromptInputWatcher` 加条件渲染：
```vue
<CaseAnalysisPromptInputWatcher v-if="enableWatcher" />
```

2. `PromptInputTextarea` 使用 placeholder prop：
```vue
<PromptInputTextarea :placeholder="placeholder" class="min-h-32" />
```

3. `PromptInputSubmit` 使用 submitStatus 和 submitLabel：
```vue
<PromptInputSubmit class="h-9 px-4! rounded-md" :status="submitStatus" size="xs"
  :disabled="disabled">
  <SendHorizontal class="size-4" />
  <span class="ml-1.5">{{ submitLabel }}</span>
</PromptInputSubmit>
```

- [ ] **Step 7: 验证类型检查通过**

Run: `npx vue-tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无错误输出

- [ ] **Step 8: 提交**

```bash
git add app/components/caseAnalysis/promptInput.vue
git commit -m "refactor(analysis): 抽象 promptInput 提交逻辑为 emit 事件"
```

---

### Task 3: 适配 index.vue — 承载创建逻辑

**Files:**
- Modify: `app/pages/dashboard/analysis/index.vue`

- [ ] **Step 1: 添加 submit 事件处理和创建逻辑**

```vue
<template>
  <div>
    <CaseAnalysisWelcome />
    <CaseAnalysisPromptInput ref="promptInputRef" :loading="isCreating" @submit="handleCreate" />
    <CaseAnalysisExample v-if="!hasPromptInput" />
    <CaseAnalysisModuleSelector v-else id="analysis-module-selector" />
  </div>
</template>

<script lang="ts" setup>
import type { PromptSubmitData } from '#shared/types/case'
import { toast } from 'vue-sonner'

definePageMeta({
  title: "案件分析",
  layout: "dashboard-layout",
})

const router = useRouter()
const store = useCaseAnalysisStore()
const { hasPromptInput } = storeToRefs(store)

const promptInputRef = ref<{ reset: () => void } | null>(null)
const isCreating = ref(false)

async function handleCreate(data: PromptSubmitData) {
  isCreating.value = true
  try {
    // 生成案件标题
    const title = data.text.trim()
      ? data.text.trim().slice(0, 50) + (data.text.trim().length > 50 ? '...' : '')
      : data.materials[0]?.name || '新案件'

    const createResult = await useApiFetch<{
      caseId: number
      sessionId: string
    }>('/api/v1/case/create', {
      method: 'POST',
      body: {
        title,
        content: data.text.trim() || undefined,
        caseTypeId: 1,
        materials: data.materials.length > 0 ? data.materials : undefined,
      },
    })

    if (!createResult) return

    promptInputRef.value?.reset()
    await router.push(`/dashboard/analysis/${createResult.sessionId}`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '操作失败，请重试'
    toast.error(errorMessage)
  } finally {
    isCreating.value = false
  }
}
</script>
```

- [ ] **Step 2: 验证类型检查通过**

Run: `npx vue-tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
git add app/pages/dashboard/analysis/index.vue
git commit -m "feat(analysis): 创建页适配 promptInput submit 事件"
```

---

### Task 4: 改造 [sessionId].vue — 替换输入框并移除中断组件

**Files:**
- Modify: `app/pages/dashboard/analysis/[sessionId].vue`

- [ ] **Step 1: 移除中断相关代码**

从 `<script>` 中移除：
- `InterruptData` 类型导入（从 `import type { AnalysisResult, InterruptData }` 中移除 `InterruptData`）
- `SendIcon` 从 lucide import 中移除
- `isSubmittingInterrupt` ref
- `currentInterrupt` ref
- `showInterruptConfirmation` computed
- `handleInterruptSubmit` / `handleInterruptCancel` 方法
- `userInput` ref
- `handleSendMessage` 方法

从模板中移除 `<CaseInterruptConfirmation>` 标签及其属性（Nuxt 自动导入组件，无需处理 import）。

- [ ] **Step 2: 新增 promptInput 相关代码**

添加类型导入和 ref：

```typescript
import type { PromptSubmitData } from '#shared/types/case'

const promptInputRef = ref<{ reset: () => void } | null>(null)
```

添加提交处理方法：

```typescript
async function handlePromptSubmit(data: PromptSubmitData) {
  if (isAnalyzing.value || isComplete.value) return

  // 发送消息继续分析（materials 暂不传递，当前 stream API 不支持追加材料）
  sendMessage({ text: data.text || '开始分析' })

  promptInputRef.value?.reset()
}
```

- [ ] **Step 3: 替换模板中的底部输入区域**

将原有的底部输入区域（`<!-- 底部输入区域（固定） -->` 部分）替换为（移除外层 `p-3` 是因为 promptInput 组件自带内边距）：

```vue
<!-- 底部输入区域（固定） -->
<div class="shrink-0 border-t bg-background">
  <CaseAnalysisPromptInput
    ref="promptInputRef"
    placeholder="输入补充信息或问题..."
    submit-label="发送"
    :loading="isAnalyzing"
    :disabled="isComplete"
    :enable-watcher="false"
    @submit="handlePromptSubmit"
  />

  <!-- 状态提示 -->
  <div v-if="isAnalyzing" class="flex items-center justify-center pb-2">
    <Loader2Icon class="size-4 animate-spin text-primary mr-2" />
    <span class="text-xs text-muted-foreground">AI 正在分析中...</span>
  </div>
</div>
```

- [ ] **Step 4: 验证类型检查通过**

Run: `npx vue-tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无错误输出

- [ ] **Step 5: 启动开发服务器验证页面渲染**

Run: `bun dev`
手动验证：
1. 访问 `/dashboard/analysis` 创建页，输入框正常显示，提交能创建案件并跳转
2. 访问 `/dashboard/analysis/[sessionId]` 分析页，底部输入框使用 promptInput 组件，显示"发送"按钮

- [ ] **Step 6: 提交**

```bash
git add app/pages/dashboard/analysis/\[sessionId\].vue
git commit -m "feat(analysis): [sessionId] 页面改用 promptInput 组件并移除中断确认"
```
