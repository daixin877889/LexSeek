---
paths:
  - "app/**/*.ts"
  - "app/**/*.vue"
---

# 数据请求规范

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

### ⚠️ 重要：返回值自动提取 data 字段

**`useApiFetch` 会自动提取响应中的 `data` 字段返回**：

```typescript
// 假设 API 返回：{ code: 0, success: true, data: { id: 1, name: 'test' } }

// ❌ 错误：不要再次访问 .data
const wrong = await useApiFetch('/api/xxx')
wrong?.data?.id // 永远是 undefined！

// ✅ 正确：直接使用返回值
const correct = await useApiFetch('/api/xxx')
correct?.id // 正确获取到值
```

**关键原则**：定义类型时直接使用实际数据类型，不要包装外层 `data` 字段。

```typescript
// ❌ 错误：类型多嵌套了一层 data
const response = await useApiFetch<{
  code: number;
  data?: { recognized: boolean };
}>(`/api/xxx`)
response?.data?.recognized // 永远是 undefined！

// ✅ 正确：类型直接对应实际返回
const response = await useApiFetch<{
  recognized: boolean;
}>(`/api/xxx`)
response?.recognized // 正确获取到值
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
