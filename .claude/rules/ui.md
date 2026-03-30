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

**Composables**（无需 import）：
- `useApi` - SSR 数据请求
- `useApiFetch` - 客户端数据请求
- `useAgeCrypto` - Age 加密
- `useFileEncryption` / `useFileDecryption` - 文件加解密
- `useFileUploadWorker` - 文件上传
- `useUserNavigation` - 用户导航

**Vue/Nuxt 核心**：
- `ref`, `reactive`, `computed`, `watch`
- `useState`, `useFetch`, `useRuntimeConfig`
- `navigateTo`, `useRoute`, `useRouter`

**Store**：
- 所有 `store/` 目录下的 Pinia store

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
