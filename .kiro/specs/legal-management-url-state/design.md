# 设计文档：法律法规管理页面 URL 状态保持

## 概述

本功能为法律法规管理页面提供 URL 状态保持能力。通过将筛选条件同步到 URL 查询参数，实现以下目标：

1. **状态持久化**：用户的筛选条件保存在 URL 中，刷新页面后状态不丢失
2. **可分享性**：用户可以复制 URL 分享给他人，他人打开后看到相同的筛选结果
3. **浏览器导航支持**：支持浏览器的前进/后退按钮
4. **良好的用户体验**：URL 简洁可读，参数验证完善

核心设计思想：
- 使用 Vue Router 的查询参数管理 URL 状态
- 使用 watch 监听筛选条件变化，自动同步到 URL
- 页面加载时从 URL 恢复筛选条件
- 使用 replaceState 避免创建过多历史记录

## 架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    法律法规管理页面                          │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              UI 组件（筛选表单）                       │  │
│  │  - 搜索关键字输入框                                   │  │
│  │  - 类型下拉选择                                       │  │
│  │  - 状态下拉选择                                       │  │
│  │  - 发文机关输入框                                     │  │
│  │  - 分页组件                                           │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                  │
│                            ▼                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Composable: useUrlState                        │  │
│  │  - syncToUrl(): 同步状态到 URL                        │  │
│  │  - restoreFromUrl(): 从 URL 恢复状态                  │  │
│  │  - validateParams(): 验证 URL 参数                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                  │
│                            ▼                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Vue Router (useRoute, useRouter)               │  │
│  │  - route.query: 读取 URL 参数                         │  │
│  │  - router.replace(): 更新 URL（不创建历史记录）       │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                  │
│                            ▼                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              浏览器 URL                                │  │
│  │  /admin/legal-main?keyword=xxx&type=law&page=2        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户操作
    │
    ├─> 修改筛选条件（输入、选择、分页）
    │       │
    │       ▼
    │   watch 监听变化
    │       │
    │       ▼
    │   syncToUrl()
    │       │
    │       ├─> 构建查询参数对象
    │       ├─> 移除默认值参数
    │       ├─> URL 编码特殊字符
    │       └─> router.replace() 更新 URL
    │
    └─> 页面加载/刷新
            │
            ▼
        onMounted()
            │
            ▼
        restoreFromUrl()
            │
            ├─> 读取 route.query
            ├─> validateParams() 验证参数
            ├─> 恢复到 UI 状态
            └─> 触发数据加载
```


## 组件和接口

### 核心 Composable: useUrlState

这是一个可复用的 composable，用于管理 URL 状态同步。

**职责**：
- 将筛选状态同步到 URL
- 从 URL 恢复筛选状态
- 验证 URL 参数的有效性
- 处理默认值和特殊字符

**接口设计**：

```typescript
interface FilterState {
  keyword: string
  type: string  // 'all' | 'law' | 'regulation' | 'judicial_interp' | 'guideline'
  status: string  // 'all' | 'valid' | 'invalid' | 'pending'
  issuingAuthority: string
  page: number
  pageSize: number
}

interface UrlStateOptions {
  defaultValues: Partial<FilterState>
  validValues?: {
    type?: string[]
    status?: string[]
  }
  onRestore?: (state: FilterState) => void
}

function useUrlState(options: UrlStateOptions) {
  // 同步状态到 URL
  const syncToUrl = (state: Partial<FilterState>) => void
  
  // 从 URL 恢复状态
  const restoreFromUrl = () => FilterState
  
  // 验证参数
  const validateParams = (params: Record<string, any>) => FilterState
  
  return {
    syncToUrl,
    restoreFromUrl,
    validateParams
  }
}
```

### 核心函数

#### 1. syncToUrl

**职责**：将筛选状态同步到 URL 查询参数。

**签名**：
```typescript
function syncToUrl(state: Partial<FilterState>): void
```

**算法流程**：
1. 创建查询参数对象
2. 遍历状态对象的每个字段
3. 如果字段值等于默认值，跳过该字段
4. 如果字段值为空字符串，跳过该字段
5. 将非默认值添加到查询参数对象
6. 使用 router.replace() 更新 URL（不创建新历史记录）

**示例**：
```typescript
// 输入状态
const state = {
  keyword: '民法典',
  type: 'law',
  status: 'all',  // 默认值，会被移除
  page: 1,  // 默认值，会被移除
  pageSize: 20  // 默认值，会被移除
}

// 生成的 URL
// /admin/legal-main?keyword=%E6%B0%91%E6%B3%95%E5%85%B8&type=law
```

#### 2. restoreFromUrl

**职责**：从 URL 查询参数恢复筛选状态。

**签名**：
```typescript
function restoreFromUrl(): FilterState
```

**算法流程**：
1. 读取 route.query 获取 URL 参数
2. 调用 validateParams() 验证参数
3. 对于每个参数：
   - 如果参数存在且有效，使用参数值
   - 如果参数不存在或无效，使用默认值
4. 返回完整的筛选状态对象

**示例**：
```typescript
// URL: /admin/legal-main?keyword=%E6%B0%91%E6%B3%95%E5%85%B8&type=law&page=2

// 恢复的状态
const state = {
  keyword: '民法典',  // 从 URL 解码
  type: 'law',  // 从 URL 读取
  status: 'all',  // 使用默认值
  issuingAuthority: '',  // 使用默认值
  page: 2,  // 从 URL 读取
  pageSize: 20  // 使用默认值
}
```

#### 3. validateParams

**职责**：验证 URL 参数的有效性。

**签名**：
```typescript
function validateParams(params: Record<string, any>): FilterState
```

**验证规则**：
- **keyword**: 任意字符串，自动 trim
- **type**: 必须是 ['all', 'law', 'regulation', 'judicial_interp', 'guideline'] 之一，否则使用 'all'
- **status**: 必须是 ['all', 'valid', 'invalid', 'pending'] 之一，否则使用 'all'
- **issuingAuthority**: 任意字符串，自动 trim
- **page**: 必须是正整数，否则使用 1
- **pageSize**: 必须是正整数且在合理范围内（10-100），否则使用 20

**示例**：
```typescript
// 输入参数（包含无效值）
const params = {
  keyword: '  民法典  ',
  type: 'invalid_type',  // 无效
  page: '-1',  // 无效
  pageSize: '1000'  // 超出范围
}

// 验证后的状态
const state = {
  keyword: '民法典',  // trim 后
  type: 'all',  // 使用默认值
  status: 'all',  // 使用默认值
  issuingAuthority: '',  // 使用默认值
  page: 1,  // 使用默认值
  pageSize: 20  // 使用默认值
}
```


## 数据模型

### FilterState 类型

```typescript
/**
 * 筛选状态
 */
interface FilterState {
  /** 搜索关键字 */
  keyword: string
  
  /** 法律类型 */
  type: 'all' | 'law' | 'regulation' | 'judicial_interp' | 'guideline'
  
  /** 状态筛选 */
  status: 'all' | 'valid' | 'invalid' | 'pending'
  
  /** 发文机关 */
  issuingAuthority: string
  
  /** 当前页码 */
  page: number
  
  /** 每页数量 */
  pageSize: number
}

/**
 * 默认筛选状态
 */
const DEFAULT_FILTER_STATE: FilterState = {
  keyword: '',
  type: 'all',
  status: 'all',
  issuingAuthority: '',
  page: 1,
  pageSize: 20
}
```

### URL 参数映射

| 状态字段 | URL 参数名 | 默认值 | 说明 |
|---------|-----------|--------|------|
| keyword | keyword | '' | 搜索关键字 |
| type | type | 'all' | 法律类型 |
| status | status | 'all' | 状态筛选 |
| issuingAuthority | issuingAuthority | '' | 发文机关 |
| page | page | 1 | 当前页码 |
| pageSize | pageSize | 20 | 每页数量 |

**注意**：默认值不会出现在 URL 中，以保持 URL 简洁。

## 正确性属性

*属性是一个特征或行为，应该在系统的所有有效执行中保持为真——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### 属性 1：Round-trip 一致性

*对于任何*有效的筛选状态，将其同步到 URL 再从 URL 恢复，应该得到等价的筛选状态（忽略默认值）。

**验证：需求 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

### 属性 2：默认值不出现在 URL

*对于任何*筛选状态，如果某个字段的值等于默认值，则该字段不应出现在 URL 的查询参数中。

**验证：需求 2.3, 2.4, 2.5, 2.6, 2.7**

### 属性 3：URL 编码正确性

*对于任何*包含特殊字符的参数值，同步到 URL 后应正确编码，从 URL 恢复后应得到原始值。

**验证：需求 2.2**

### 属性 4：参数验证正确性

*对于任何*无效的 URL 参数值，系统应使用对应字段的默认值，不抛出异常。

**验证：需求 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 10.2, 10.4**

### 属性 5：URL 格式标准性

*对于任何*筛选状态，生成的 URL 应符合标准的查询字符串格式 `?key=value&key2=value2`。

**验证：需求 2.1**

### 属性 6：参数顺序一致性

*对于任何*筛选状态，生成的 URL 参数应按照固定顺序排列（keyword, type, status, issuingAuthority, page, pageSize）。

**验证：需求 8.3**

### 属性 7：URL 长度限制

*对于任何*筛选状态，生成的 URL 总长度不应超过 2000 字符。

**验证：需求 8.4**

### 属性 8：默认值恢复

*对于任何*不包含某个参数的 URL，从 URL 恢复状态时，该字段应使用默认值。

**验证：需求 3.7**

### 属性 9：使用 replaceState 更新

*对于任何*筛选条件的改变，系统应使用 `router.replace()` 更新 URL，不创建新的浏览器历史记录。

**验证：需求 4.4**

### 属性 10：批量更新优化

*对于任何*多个筛选条件同时改变的情况，系统应只更新一次 URL，避免多次更新。

**验证：需求 7.5**


## 错误处理

### 1. URL 参数解析失败

**场景**：URL 参数格式错误或包含无法解析的内容。

**处理**：
- 记录警告日志
- 使用默认值替代无效参数
- 不影响页面正常加载

### 2. 无效的参数值

**场景**：URL 参数值不在有效范围内（如 type='invalid_type'）。

**处理**：
- 使用对应字段的默认值
- 记录警告日志
- 继续正常加载页面

### 3. 超出范围的数值参数

**场景**：page 或 pageSize 参数超出合理范围。

**处理**：
- page 超出范围：使用最大有效页码
- pageSize 超出范围：使用默认值 20
- 记录警告日志

### 4. 恶意参数内容

**场景**：URL 参数包含 XSS 攻击代码或其他恶意内容。

**处理**：
- 自动过滤特殊字符
- 使用默认值
- 记录安全警告日志

### 5. URL 长度超限

**场景**：生成的 URL 长度超过 2000 字符。

**处理**：
- 截断过长的参数值
- 记录警告日志
- 提示用户简化筛选条件

## 测试策略

### 单元测试

**测试范围**：
- syncToUrl 函数
- restoreFromUrl 函数
- validateParams 函数

**测试工具**：
- vitest
- fast-check（属性测试）

**测试用例**：
- 各种筛选条件的 URL 同步
- 各种 URL 参数的状态恢复
- 无效参数的验证和默认值处理
- 特殊字符的编码和解码
- 默认值的移除

### 属性测试

**测试配置**：
- 每个属性测试运行 100 次迭代
- 使用 fast-check 生成随机测试数据

**测试标签格式**：
```typescript
/**
 * Feature: legal-management-url-state
 * Property 1: Round-trip 一致性
 */
```

**关键属性测试**：
1. 属性 1：Round-trip 一致性
2. 属性 2：默认值不出现在 URL
3. 属性 3：URL 编码正确性
4. 属性 4：参数验证正确性
5. 属性 5：URL 格式标准性
6. 属性 6：参数顺序一致性
7. 属性 7：URL 长度限制
8. 属性 8：默认值恢复
9. 属性 9：使用 replaceState 更新
10. 属性 10：批量更新优化

### 集成测试（使用 Vibium）

**测试范围**：
- 完整的用户操作流程
- 浏览器前进/后退按钮
- 页面刷新后状态保持
- 不同浏览器的兼容性

**测试场景**：
1. 用户输入搜索关键字并搜索，验证 URL 更新
2. 用户选择类型筛选，验证 URL 更新
3. 用户切换分页，验证 URL 更新
4. 用户点击重置按钮，验证 URL 清空
5. 用户刷新页面，验证筛选条件保持
6. 用户点击浏览器后退按钮，验证状态恢复
7. 用户从其他页面导航到法律法规管理页面（带 URL 参数），验证状态恢复

## 实现注意事项

### 1. 使用 Vue Router

使用 Nuxt 3 的 `useRoute()` 和 `useRouter()` composables：
- `useRoute()` 用于读取当前 URL 参数
- `useRouter().replace()` 用于更新 URL（不创建历史记录）

### 2. Watch 监听策略

使用 `watch` 监听筛选条件变化：
```typescript
watch(
  () => [searchKeyword.value, typeFilter.value, statusFilter.value, ...],
  () => {
    syncToUrl({
      keyword: searchKeyword.value,
      type: typeFilter.value,
      status: statusFilter.value,
      // ...
    })
  },
  { deep: true }
)
```

**注意**：
- 搜索关键字不应在输入时立即同步，只在点击搜索或按回车时同步
- 下拉筛选和分页应立即同步

### 3. 防止循环更新

在 `restoreFromUrl()` 中恢复状态时，需要暂时禁用 watch，避免触发 `syncToUrl()`：

```typescript
const isRestoring = ref(false)

watch(
  () => [...],
  () => {
    if (!isRestoring.value) {
      syncToUrl(...)
    }
  }
)

function restoreFromUrl() {
  isRestoring.value = true
  // 恢复状态
  nextTick(() => {
    isRestoring.value = false
  })
}
```

### 4. URL 编码

使用浏览器原生的 URL 编码：
- Vue Router 会自动处理 URL 编码和解码
- 不需要手动调用 `encodeURIComponent()` 和 `decodeURIComponent()`

### 5. 性能优化

- 使用 `debounce` 处理搜索关键字输入（如果需要实时同步）
- 批量更新多个筛选条件时，只调用一次 `syncToUrl()`
- 使用 `router.replace()` 而不是 `router.push()`，避免创建过多历史记录

### 6. 类型安全

- 使用 TypeScript 严格模式
- 为所有函数添加类型注解
- 使用类型守卫验证参数

### 7. 可复用性

将 `useUrlState` 设计为通用的 composable，可以在其他页面复用：
- 通过配置项传入默认值和有效值
- 支持自定义参数名映射
- 支持自定义验证规则

## 部署和配置

### 环境变量

无需额外的环境变量。

### 路由配置

无需修改路由配置，使用现有的 `/admin/legal-main` 路由。

### 依赖版本

使用项目现有的依赖版本：
- Vue 3
- Nuxt 3
- Vue Router（Nuxt 内置）

## 未来扩展

### 1. URL 参数压缩

对于复杂的筛选条件，可以使用压缩算法减少 URL 长度：
- 使用 Base64 编码
- 使用短参数名（如 `k` 代替 `keyword`）
- 使用位标志表示布尔值

### 2. 筛选条件预设

支持保存和加载筛选条件预设：
- 用户可以保存常用的筛选条件组合
- 通过 URL 参数 `preset=xxx` 加载预设

### 3. 高级筛选

支持更复杂的筛选条件：
- 日期范围筛选
- 多选筛选
- 自定义筛选表达式

### 4. 筛选历史

记录用户的筛选历史：
- 在本地存储中保存最近的筛选条件
- 提供快速访问历史筛选的入口

### 5. 分享功能

提供一键分享当前筛选结果的功能：
- 复制 URL 到剪贴板
- 生成二维码
- 分享到社交媒体

## 实现示例

### 示例 1：基本使用

```typescript
// 在 /admin/legal-main/index.vue 中使用

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
  },
  onRestore: (state) => {
    // 恢复状态后的回调
    loadLegalList()
  }
})

// 页面加载时恢复状态
onMounted(() => {
  const state = restoreFromUrl()
  searchKeyword.value = state.keyword
  typeFilter.value = state.type
  statusFilter.value = state.status
  issuingAuthorityFilter.value = state.issuingAuthority
  pagination.value.page = state.page
  pagination.value.pageSize = state.pageSize
})

// 监听筛选条件变化
watch(
  () => [typeFilter.value, statusFilter.value, pagination.value.page],
  () => {
    syncToUrl({
      keyword: searchKeyword.value,
      type: typeFilter.value,
      status: statusFilter.value,
      issuingAuthority: issuingAuthorityFilter.value,
      page: pagination.value.page,
      pageSize: pagination.value.pageSize
    })
  }
)

// 搜索按钮点击
const handleSearch = () => {
  pagination.value.page = 1
  syncToUrl({
    keyword: searchKeyword.value,
    type: typeFilter.value,
    status: statusFilter.value,
    issuingAuthority: issuingAuthorityFilter.value,
    page: 1,
    pageSize: pagination.value.pageSize
  })
  loadLegalList()
}

// 重置按钮点击
const handleReset = () => {
  searchKeyword.value = ''
  typeFilter.value = 'all'
  statusFilter.value = 'all'
  issuingAuthorityFilter.value = ''
  pagination.value.page = 1
  syncToUrl({})  // 清空所有参数
  loadLegalList()
}
```

### 示例 2：URL 示例

```
# 默认状态（无参数）
/admin/legal-main

# 搜索"民法典"
/admin/legal-main?keyword=%E6%B0%91%E6%B3%95%E5%85%B8

# 筛选法律类型
/admin/legal-main?type=law

# 组合筛选
/admin/legal-main?keyword=%E6%B0%91%E6%B3%95%E5%85%B8&type=law&status=valid&page=2

# 完整筛选
/admin/legal-main?keyword=%E6%B0%91%E6%B3%95%E5%85%B8&type=law&status=valid&issuingAuthority=%E5%85%A8%E5%9B%BD%E4%BA%BA%E5%A4%A7&page=2&pageSize=50
```
