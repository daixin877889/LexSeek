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
  text: string                        // 用户输入的文本
  materials: CaseMaterialParam[]      // 已选材料列表（可为空数组）
}
```

复用已有的 `CaseMaterialParam`（包含 type、name、ossFileId）。

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
defineExpose({ reset })  // 清空文本和已选文件
```

### handleSubmit 重构

**改动前**：校验 → 生成标题 → 调用创建 API → 跳转路由
**改动后**：校验 → 构建 `PromptSubmitData` → emit `submit`

保留：
- 文本/附件非空校验
- 识别中文件拦截校验
- 文件选择、预览、识别等所有 UI 交互逻辑

移除：
- 创建案件 API 调用（`useApiFetch('/api/v1/case/create'...)`）
- 路由跳转（`router.push`）
- 标题生成逻辑
- 内部的 `status` ref（改用外部 `loading` prop 控制）

### enableWatcher 控制

```vue
<CaseAnalysisPromptInputWatcher v-if="enableWatcher" />
```

`[sessionId]` 页面不需要将输入状态同步到 store，设为 false。

## index.vue（创建页）调整

```vue
<CaseAnalysisPromptInput @submit="handleCreate" />
```

新增 `handleCreate` 方法，包含从 promptInput 移出的创建逻辑：
- 生成案件标题
- 调用 `/api/v1/case/create` API
- 跳转到 `/dashboard/analysis/${sessionId}`

## [sessionId].vue 调整

### 移除

- 手写的 `Textarea` + `Button` 输入框
- `CaseInterruptConfirmation` 组件及相关代码：
  - `currentInterrupt` ref
  - `showInterruptConfirmation` computed
  - `isSubmittingInterrupt` ref
  - `handleInterruptSubmit` / `handleInterruptCancel` 方法
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

`handlePromptSubmit(data: PromptSubmitData)` 接收标准化数据，发送给 chat stream。

## 影响范围

| 文件 | 改动类型 |
|------|----------|
| shared/types/case.ts | 新增 `PromptSubmitData` 类型 |
| app/components/caseAnalysis/promptInput.vue | 重构：抽象提交逻辑 |
| app/pages/dashboard/analysis/index.vue | 适配：接收 submit 事件 |
| app/pages/dashboard/analysis/[sessionId].vue | 替换输入框、移除中断组件 |
