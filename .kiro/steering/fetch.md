# 数据请求示例
```javascript
// GET 请求
const { data, error, status, refresh } = await useApi('/api/v1/users/me')

// POST 请求
const { data, error, status } = await useApi('/api/v1/auth/login', {
  method: 'POST',
  body: { phone, password },
  showError: false  // 可选：禁用自动错误提示
})

// 延迟执行
const { data, error, execute } = useApi('/api/v1/sms/send', {
  method: 'POST',
  body: { phone, type },
  immediate: false  // 使用 immediate: false 替代原来的 lazy: true
})
await execute()

```