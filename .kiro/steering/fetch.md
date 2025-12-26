# 数据请求封装说明

项目封装了两个数据请求 composable，用于不同场景：

## useApi - 基于 useFetch 的封装

适用于组件 setup 阶段或需要 SSR 支持的场景。

### 特性
- 基于 Nuxt 的 `useFetch` 封装
- 支持 SSR 数据预取
- 自动处理 401 未授权跳转
- 自动提取响应中的 `data` 字段
- 统一错误提示（可通过 `showError: false` 禁用）

### 使用示例

```typescript
// GET 请求（组件 setup 阶段）
const { data, error, status, refresh } = await useApi('/api/v1/users/me')

// POST 请求
const { data, error, status } = await useApi('/api/v1/auth/login', {
  method: 'POST',
  body: { phone, password },
  showError: false  // 可选：禁用自动错误提示
})

// 延迟执行（组件挂载后调用，如事件处理函数中）
const { data, error, execute } = useApi('/api/v1/sms/send', {
  method: 'POST',
  body: { phone, type },
  immediate: false  // 必须设置，避免 "Component is already mounted" 警告
})
await execute()
```

### 重要提示
- 在组件 setup 阶段直接调用时，可以使用 `await useApi()`
- 在组件挂载后（如 `onMounted`、事件处理函数、`watch` 回调中）调用时，**必须**使用 `immediate: false` 配合 `execute()` 延迟执行，否则会出现警告：`[nuxt] [useFetch] Component is already mounted, please use $fetch instead`

---

## useApiFetch - 基于 $fetch 的封装

适用于组件挂载后的事件处理函数中调用 API，不需要 SSR 支持的场景。

### 特性
- 基于 Nuxt 的 `$fetch` 封装
- 返回 Promise，使用更简洁
- 自动处理 401 未授权跳转
- 自动提取响应中的 `data` 字段
- 统一错误提示（可通过 `showError: false` 禁用）

### 使用示例

```typescript
// GET 请求
const data = await useApiFetch('/api/v1/users/me')

// POST 请求
const data = await useApiFetch('/api/v1/auth/login', {
  method: 'POST',
  body: { phone, password },
  showError: false  // 可选：禁用自动错误提示
})

// 带类型的请求
interface UserInfo {
  id: number
  name: string
}
const user = await useApiFetch<UserInfo>('/api/v1/users/me')
```

---

## 选择指南

| 场景 | 推荐使用 |
|------|---------|
| 组件 setup 阶段获取数据 | `useApi` |
| 需要 SSR 数据预取 | `useApi` |
| 需要响应式数据（data, error, status） | `useApi` |
| 需要 refresh 刷新功能 | `useApi` |
| 事件处理函数中调用 | `useApiFetch` 或 `useApi` + `immediate: false` |
| 简单的一次性请求 | `useApiFetch` |

---

## 配置选项

### 通用选项
- `showError`: boolean - 是否显示错误提示，默认 `true`
- `method`: string - 请求方法，默认 `GET`
- `body`: object - 请求体（POST/PUT/PATCH）
- `query`: object - URL 查询参数

### useApi 特有选项
- `immediate`: boolean - 是否立即执行，默认 `true`。设为 `false` 时需手动调用 `execute()`
- `key`: string - 请求的唯一标识，用于缓存和去重
- `transform`: function - 自定义数据转换函数

### useApiFetch 特有选项
- `transform`: function - 自定义数据转换函数
