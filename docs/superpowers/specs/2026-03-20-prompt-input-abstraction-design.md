# promptInput 提交逻辑抽象设计

## 背景

`[sessionId]` 页面底部输入框目前是手写的 `Textarea` + `Button`，需要改用 `CaseAnalysisPromptInput` 组件。但该组件当前 `handleSubmit` 内硬编码了创建案件的业务逻辑（调用创建 API、跳转路由），无法在分析页面复用。

需要将 promptInput.vue 的提交逻辑抽象化，使其只负责收集和校验输入数据，由调用者处理具体业务。

同时移除 `[sessionId]` 页面的中断确认组件（`CaseInterruptConfirmation`），后续再实现。

## 方案：事件抽象

promptInput.vue 只做 UI + 校验，通过 emit 向上传递标准化数据，业务逻辑由父组件处理。

## 数据类型

在 `shared/types/case.ts` 新增：

```typescript
export interface PromptSubmitData {
  text: string                        // 用户输入的文本（纯附件提交时为空字符串 ""）
  materials: CaseMaterialParam[]      // 已选材料列表（可为空数组）
}
```

复用已有的 `CaseMaterialParam`（包含 type、name、ossFileId）。

**空值约定**：纯附件提交时 `text` 为空字符串 `""`，调用方应使用 `data.text.trim()` 判断是否有文本内容。

## promptInput.vue 改动

### 新增 Props

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| placeholder | string | 原有默认值 | 输入框占位文本 |
| submitLabel | string | "法索一下" | 提交按钮文案 |
| loading | boolean | false | 外部控制 loading 状态 |
| disabled | boolean | false | 外部控制禁用状态 |
| enableWatcher | boolean | true | 是否启用 PromptInputWatcher |

### 新增 Emit

```typescript
emit('submit', data: PromptSubmitData)
```

### 暴露方法

```typescript
defineExpose({ reset })
```

`reset()` 的完整职责：
1. 清空输入文本
2. 清空已选文件列表（`selectedFiles`）
3. 清除文件识别状态（`fileRecognitionStatus`）
4. 停止所有轮询（`stopAllPolling()`）

### handleSubmit 重构

**改动前**：校验 → 生成标题 → 调用创建 API → 跳转路由
**改动后**：校验 → 构建 `PromptSubmitData` → emit `submit`

保留：
- 文本/附件非空校验
- 识别中文件拦截校验
- 文件选择、预览、识别等所有 UI 交互逻辑

移除：
- 创建案件 API 调用（`useApiFetch('/api/v1/case/create'...)`）
- 路由跳转（`router.push`）及 `useRouter()` 调用
- 标题生成逻辑

### status 与 loading 的映射

移除内部 `status` ref，改用外部 `loading` prop 控制 `PromptInputSubmit` 的状态：

```typescript
// 内部派生 status，用于 PromptInputSubmit 组件
const submitStatus = computed(() => {
  if (props.loading) return 'streaming'
  return 'ready'
})
```

模板中：`:status="submitStatus"`

### enableWatcher 控制

```vue
<CaseAnalysisPromptInputWatcher v-if="enableWatcher" />
```

`[sessionId]` 页面不需要将输入状态同步到 store，设为 false。

## index.vue（创建页）调整

```vue
<CaseAnalysisPromptInput ref="promptInputRef" @submit="handleCreate" />
```

新增 `handleCreate(data: PromptSubmitData)` 方法，包含从 promptInput 移出的创建逻辑：
1. 生成案件标题（从 `data.text` 截取前 50 字符，或取第一个材料文件名）
2. 调用 `/api/v1/case/create` API
3. 成功后调用 `promptInputRef.value.reset()` 清空组件状态
4. 跳转到 `/dashboard/analysis/${sessionId}`
5. 失败时通过 toast 显示错误

## [sessionId].vue 调整

### 移除

- 手写的 `Textarea` + `Button` 输入框
- `CaseInterruptConfirmation` 组件及相关代码：
  - `currentInterrupt` ref
  - `showInterruptConfirmation` computed
  - `isSubmittingInterrupt` ref
  - `handleInterruptSubmit` / `handleInterruptCancel` 方法
  - `InterruptData` 类型导入
- `userInput` ref
- `SendIcon` import

### 新增

```vue
<CaseAnalysisPromptInput
  ref="promptInputRef"
  placeholder="输入补充信息或问题..."
  submit-label="发送"
  :loading="isAnalyzing"
  :disabled="isComplete"
  :enable-watcher="false"
  @submit="handlePromptSubmit"
/>
```

### handlePromptSubmit 实现

```typescript
async function handlePromptSubmit(data: PromptSubmitData) {
  if (isAnalyzing.value || isComplete.value) return

  // 发送消息继续分析
  sendMessage({ text: data.text || '开始分析' })

  // 重置输入组件
  promptInputRef.value?.reset()
}
```

**说明**：
- `materials` 的传递：当前 chat stream API 暂不支持追加材料，text 中可携带材料引用信息。后续 stream API 支持 materials 参数时再扩展。
- `isAnalyzing` 由页面自身维护，通过 `loading` prop 传入 promptInput 控制其禁用状态。

## 影响范围

| 文件 | 改动类型 |
|------|----------|
| shared/types/case.ts | 新增 `PromptSubmitData` 类型 |
| app/components/caseAnalysis/promptInput.vue | 重构：抽象提交逻辑 |
| app/pages/dashboard/analysis/index.vue | 适配：接收 submit 事件，承载创建逻辑 |
| app/pages/dashboard/analysis/[sessionId].vue | 替换输入框、移除中断组件 |
