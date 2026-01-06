---
inclusion: fileMatch
fileMatchPattern: "**/app/components/**,**/app/pages/**"
---
# UI 组件开发规范

## 技术栈
- **shadcn-vue** - UI 组件库
- **Tailwind CSS v4** - 样式框架
- **Vue 3** - 前端框架

## shadcn-vue 使用规范
1. 使用 shadcn 工具查询组件用法
2. **禁止修改** `app/components/ui` 中的组件（重新安装会被覆盖）
3. 自定义组件放在 `app/components/` 其他目录
4. 由于 shadcn 库经过了多轮更新，组件的使用可能变更，需要调用 shadcn 工具查询组件的使用方式。

## Tailwind v4 注意事项
- 使用 v4 语法和类名
- 注意与 v3 的差异

## 前端自动导入
以下无需手动 import：

**Composables**（`app/composables/`）：
- `useApi` - SSR 数据请求
- `useApiFetch` - 客户端数据请求
- `useAgeCrypto` - Age 加密
- `useFileEncryption` / `useFileDecryption` - 文件加解密
- `useFileUploadWorker` - 文件上传
- `useUserNavigation` - 用户导航

**Vue/Nuxt 核心**：
- `ref`, `reactive`, `computed`, `watch` 等响应式 API
- `useState`, `useFetch`, `useRuntimeConfig` 等 Nuxt composables
- `navigateTo`, `useRoute`, `useRouter` 等路由函数

**Store**：
- 所有 `store/` 目录下的 Pinia store

## 类型导入
类型需手动导入，使用 `#shared` 别名：
```typescript
import type { UserInfo } from "#shared/types/user";
```

**特别注意：app/components/ 中的组件是自动导入的，在使用时注意要按组件的文件路径驼峰命名使用组件**