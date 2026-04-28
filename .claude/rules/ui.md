---
paths:
  - "app/components/**"
  - "app/pages/**"
  - "app/**/*.vue"
---

# UI 组件规范

## 技术栈

- **shadcn-vue** - UI 组件库
- **Tailwind CSS v4** - 样式框架
- **Vue 3** - 前端框架

## shadcn-vue 使用

1. 使用 shadcn 工具查询组件用法
2. **禁止修改** `app/components/ui` 中的组件（重新安装会被覆盖）
3. 自定义组件放在 `app/components/` 其他目录

## 前端自动导入

> 项目已关闭目录扫描（`imports.scan: false`），**所有 composables、store、业务组件都需要显式 import**。

### 仍自动导入（无需 import）

| 类别 | 内容 |
|------|------|
| Vue 响应式 API | `ref`、`reactive`、`computed`、`watch`、`watchEffect`、`onMounted`、`nextTick` 等 |
| Nuxt composables | `useFetch`、`useState`、`useRuntimeConfig`、`useCookie`、`useHead`、`useNuxtApp` |
| 路由 | `navigateTo`、`useRoute`、`useRouter`、`definePageMeta` |
| Pinia | `defineStore`、`storeToRefs` |
| 白名单工具 | `logger`、`resSuccess`、`resError` |
| 自动注册组件 | `app/components/ui/`（shadcn-nuxt）、`app/components/ai-elements/`（仅 `.vue`） |

### 必须显式 import

```typescript
// 业务 composables — 含 useApi / useApiFetch
import { useApi } from '~/composables/useApi'
import { useApiFetch } from '~/composables/useApiFetch'
import { useCaseMemory } from '~/composables/useCaseMemory'

// Pinia store
import { useAuthStore } from '~/store/auth'
import { useAlertDialogStore } from '~/store/alertDialog'

// 业务组件（非 ui/ 与 ai-elements/）
import CaseDetailMemory from '~/components/caseDetail/CaseDetailMemory.vue'
```

## 类型导入

```typescript
import type { UserInfo } from "#shared/types/user";
```

## 组件使用

组件按文件路径驼峰命名使用(shadcn-vue 组件除外)：
```vue
<template>
  <Button>按钮</Button>
  <DiskSpaceFileList />
</template>
```

## 页面 definePageMeta

每个页面都需要定义 `definePageMeta`：

```typescript
definePageMeta({
  layout: 'dashboard',  // 布局名称
  title: '页面标题',    // 标题栏和面包屑需要
  icon: 'IconName'     // 导航菜单图标
})
```

## 注意事项

- 使用 Tailwind v4 语法和类名
- 组件需支持深色模式
- 复杂业务逻辑应提取为 composables

## 确认 / 警告对话框

**严禁使用浏览器原生 `confirm()` / `alert()` / `prompt()`**（样式与产品脱节、阻塞主线程、移动端不友好、无法携带异步回调）。

优先使用项目内置的全局 `useAlertDialogStore`（基于 shadcn Dialog，已在 `app.vue` 全局挂载）：

```ts
const alertDialogStore = useAlertDialogStore()
alertDialogStore.showErrorDialog({
    title: '确认删除',
    message: `确认删除「${name}」？删除后无法恢复。`,
    confirmText: '确认删除',
    cancelText: '取消',
    onConfirm: async () => {
        await useApiFetch(`/api/v1/xxx/${id}`, { method: 'DELETE' })
        toast.success('已删除')
        reload()
    },
})
```

- 删除 / 不可恢复操作用 `showErrorDialog`（红色主按钮）
- 普通确认用 `showDialog` 或 `showSuccessDialog`
- 需要与页面内 shadcn Sheet/Drawer 共存时，传 `zIndex` 覆盖遮罩层级（Sheet 默认 z-[70]，传 `zIndex: 9999` 即可压过）

当确认流程需要在组件内持有独立状态（如删除前额外输入、带表单校验），才使用本地 shadcn `AlertDialog` 组件（参考 `components/cases/CasesDeleteDialog.vue`）。

## 无障碍（a11y）强制规则

### `DialogContent` 必须有 `DialogDescription`

shadcn / Radix 要求每个 `DialogContent` 必须包含 `<DialogDescription>` 或绑定 `aria-describedby`，否则浏览器控制台会持续打印告警：
`Missing Description or aria-describedby for {DialogContent}`。

```vue
<!-- ❌ 错误：缺少 DialogDescription -->
<DialogContent>
  <DialogHeader>
    <DialogTitle>保存版本</DialogTitle>
  </DialogHeader>
  ...
</DialogContent>

<!-- ✅ 正确：可见说明 -->
<DialogContent>
  <DialogHeader>
    <DialogTitle>保存版本</DialogTitle>
    <DialogDescription>为当前合同审查结果保存一个新版本。</DialogDescription>
  </DialogHeader>
  ...
</DialogContent>

<!-- ✅ 正确：视觉无说明，仅给屏幕阅读器 -->
<DialogContent>
  <DialogHeader>
    <DialogTitle>选择模型</DialogTitle>
    <DialogDescription class="sr-only">从已配置的模型中选择一个</DialogDescription>
  </DialogHeader>
  ...
</DialogContent>
```

> 历史教训：`ContractSaveVersionDialog` / `RiskEditDialog` / `ai-elements/ModelSelectorContent` 都因漏写 Description 反复触发控制台告警；新写 Dialog 时务必至少加一行 `sr-only` Description 兜底。
