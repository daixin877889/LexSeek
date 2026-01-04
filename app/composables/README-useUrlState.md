# useUrlState Composable 使用说明

## 概述

`useUrlState` 是一个用于管理 URL 状态的 Vue 3 Composable，它可以将页面的筛选条件同步到 URL 查询参数中，实现以下功能：

- **状态持久化**：筛选条件保存在 URL 中，刷新页面后状态不丢失
- **可分享性**：用户可以复制 URL 分享给他人，他人打开后看到相同的筛选结果
- **浏览器导航支持**：支持浏览器的前进/后退按钮
- **良好的用户体验**：URL 简洁可读，参数验证完善

## 基本用法

```typescript
import { useUrlState } from '~/composables/useUrlState'

// 在组件中使用
const { syncToUrl, restoreFromUrl } = useUrlState({
  defaultValues: {
    keyword: '',
    type: 'all',
    status: 'all',
    issuingAuthority: '',
    page: 1,
    pageSize: 20
  },
  validValues: {
    type: ['all', 'law', 'regulation', 'judicial_interp', 'guideline'],
    status: ['all', 'valid', 'invalid', 'pending']
  }
})

// 页面加载时恢复状态
onMounted(() => {
  const state = restoreFromUrl()
  // 应用状态到 UI
  searchKeyword.value = state.keyword
  typeFilter.value = state.type
  // ...
})

// 筛选条件变化时同步到 URL
watch(() => [typeFilter.value, statusFilter.value], () => {
  syncToUrl({
    keyword: searchKeyword.value,
    type: typeFilter.value,
    status: statusFilter.value,
    page: pagination.value.page,
    pageSize: pagination.value.pageSize
  })
})
```

## API 参考

### useUrlState(options)

创建一个 URL 状态管理实例。

**参数：**

- `options.defaultValues` (必需): 默认值配置对象
- `options.validValues` (可选): 有效值配置对象，用于参数验证
- `options.onRestore` (可选): 状态恢复后的回调函数

**返回值：**

- `syncToUrl(state)`: 将状态同步到 URL
- `restoreFromUrl()`: 从 URL 恢复状态
- `validateParams(params)`: 验证 URL 参数

### FilterState 接口

```typescript
interface FilterState {
  keyword: string                // 搜索关键字
  type: string                   // 法律类型
  status: string                 // 状态筛选
  issuingAuthority: string       // 发文机关
  page: number                   // 当前页码
  pageSize: number               // 每页数量
}
```

## 完整示例

```typescript
<script setup lang="ts">
// 定义筛选状态
const searchKeyword = ref('')
const typeFilter = ref('all')
const statusFilter = ref('all')
const pagination = ref({ page: 1, pageSize: 20 })

// 初始化 URL 状态管理
const { syncToUrl, restoreFromUrl } = useUrlState({
  defaultValues: {
    keyword: '',
    type: 'all',
    status: 'all',
    issuingAuthority: '',
    page: 1,
    pageSize: 20
  },
  validValues: {
    type: ['all', 'law', 'regulation'],
    status: ['all', 'valid', 'invalid']
  }
})

// 防止循环更新
const isRestoring = ref(false)

// 监听筛选条件变化
watch(
  () => [typeFilter.value, statusFilter.value, pagination.value.page],
  () => {
    if (isRestoring.value) return
    
    syncToUrl({
      keyword: searchKeyword.value,
      type: typeFilter.value,
      status: statusFilter.value,
      page: pagination.value.page,
      pageSize: pagination.value.pageSize
    })
  }
)

// 搜索按钮处理
const handleSearch = () => {
  pagination.value.page = 1
  syncToUrl({
    keyword: searchKeyword.value,
    type: typeFilter.value,
    status: statusFilter.value,
    page: 1,
    pageSize: pagination.value.pageSize
  })
  loadData()
}

// 重置按钮处理
const handleReset = () => {
  searchKeyword.value = ''
  typeFilter.value = 'all'
  statusFilter.value = 'all'
  pagination.value.page = 1
  
  syncToUrl({
    keyword: '',
    type: 'all',
    status: 'all',
    page: 1,
    pageSize: pagination.value.pageSize
  })
  
  loadData()
}

// 页面加载时恢复状态
onMounted(() => {
  isRestoring.value = true
  const state = restoreFromUrl()
  
  searchKeyword.value = state.keyword
  typeFilter.value = state.type
  statusFilter.value = state.status
  pagination.value.page = state.page
  pagination.value.pageSize = state.pageSize
  
  nextTick(() => {
    isRestoring.value = false
  })
  
  loadData()
})
</script>
```

## 常见问题

### 1. 为什么需要 isRestoring 标志？

在页面加载时，我们从 URL 恢复状态到 Vue 的响应式变量。这会触发 watch 监听器，导致再次调用 `syncToUrl`，形成循环。使用 `isRestoring` 标志可以在恢复状态期间暂时禁用 watch。

### 2. 为什么默认值不出现在 URL 中？

为了保持 URL 简洁可读，等于默认值的参数不会出现在 URL 中。例如，如果 `page` 的默认值是 1，那么第一页的 URL 中不会包含 `page=1` 参数。

### 3. 如何处理无效的 URL 参数？

`validateParams` 函数会自动验证 URL 参数的有效性。对于无效的参数值，会使用对应字段的默认值，并在控制台输出警告日志。

### 4. 搜索框输入时会立即更新 URL 吗？

不会。为了性能优化，搜索框输入时不会立即更新 URL。只有在点击搜索按钮或按下回车键时，才会同步搜索关键字到 URL。

### 5. 如何支持浏览器的前进/后退按钮？

`syncToUrl` 使用 `router.replace()` 而不是 `router.push()`，这样可以更新 URL 而不创建新的浏览器历史记录。当用户点击浏览器的前进/后退按钮时，Vue Router 会自动更新 URL，触发页面重新加载或状态恢复。

## 最佳实践

### 1. 合理设置默认值

默认值应该是最常用的筛选条件，这样可以保持 URL 简洁。

```typescript
defaultValues: {
  keyword: '',        // 空字符串表示不搜索
  type: 'all',        // 'all' 表示显示所有类型
  page: 1,            // 第一页
  pageSize: 20        // 每页 20 条
}
```

### 2. 配置有效值验证

为了防止用户手动修改 URL 导致的错误，应该配置有效值列表。

```typescript
validValues: {
  type: ['all', 'law', 'regulation', 'judicial_interp', 'guideline'],
  status: ['all', 'valid', 'invalid', 'pending']
}
```

### 3. 防止循环更新

在恢复状态时，使用标志位防止触发 watch 导致的循环更新。

```typescript
const isRestoring = ref(false)

watch(() => [...], () => {
  if (isRestoring.value) return
  syncToUrl(...)
})

onMounted(() => {
  isRestoring.value = true
  restoreFromUrl()
  nextTick(() => {
    isRestoring.value = false
  })
})
```

### 4. 搜索和重置的特殊处理

搜索和重置操作需要手动调用 `syncToUrl`，因为它们可能涉及多个字段的同时更新。

```typescript
const handleSearch = () => {
  pagination.value.page = 1  // 重置页码
  syncToUrl({...})           // 同步所有筛选条件
  loadData()                 // 加载数据
}
```

### 5. 错误处理

在恢复状态时添加错误处理，确保即使 URL 参数有问题，页面也能正常加载。

```typescript
onMounted(() => {
  try {
    const state = restoreFromUrl()
    // 应用状态
  } catch (error) {
    console.error('URL 状态恢复失败:', error)
    // 使用默认值
  }
  loadData()
})
```

## 技术细节

### URL 编码

Vue Router 会自动处理 URL 编码和解码，无需手动调用 `encodeURIComponent()` 和 `decodeURIComponent()`。

### 参数顺序

为了保持 URL 的可读性，参数按照固定顺序排列：`keyword`, `type`, `status`, `issuingAuthority`, `page`, `pageSize`。

### 浏览器兼容性

使用 Vue Router 的 `router.replace()` 方法，兼容所有主流浏览器。

## 相关资源

- [Vue Router 文档](https://router.vuejs.org/)
- [Nuxt 3 文档](https://nuxt.com/)
- [设计文档](/.kiro/specs/legal-management-url-state/design.md)
- [需求文档](/.kiro/specs/legal-management-url-state/requirements.md)
