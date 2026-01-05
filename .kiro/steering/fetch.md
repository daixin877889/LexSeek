---
inclusion: fileMatch
fileMatchPattern: "**/app/composables/**,**/app/pages/**,**/app/components/**"
---
# 数据请求封装

## useApi - SSR 支持
适用于组件 setup 阶段或需要 SSR 的场景。

```typescript
// setup 阶段
const { data, error, status, refresh } = await useApi('/api/v1/users/me')

// POST 请求
const { data } = await useApi('/api/v1/auth/login', {
  method: 'POST',
  body: { phone, password },
  showError: false
})

// 事件处理函数中（必须 immediate: false）
const { data, execute } = useApi('/api/v1/sms/send', {
  method: 'POST',
  body: { phone, type },
  immediate: false
})
await execute()
```

## useApiFetch - 简洁请求
适用于事件处理函数，不需要 SSR。

```typescript
// 必须检查返回值
const data = await useApiFetch('/api/v1/users/me')
if (data) {
  // 成功处理
}

// POST 请求
const result = await useApiFetch('/api/v1/action', {
  method: 'POST',
  body: { code }
})
if (result) {
  toast.success('操作成功')
}
```

## 对比

| 特性 | useApi | useApiFetch |
|------|--------|-------------|
| 基于 | useFetch | $fetch |
| 返回值 | { data, error, status } | Promise<T \| null> |
| SSR | ✅ | ❌ |
| 适用 | setup 阶段 | 事件处理 |

## 选择指南
- setup 阶段 → `useApi`
- 需要 SSR → `useApi`
- 需要响应式 → `useApi`
- 事件处理 → `useApiFetch` 或 `useApi` + `immediate: false`
