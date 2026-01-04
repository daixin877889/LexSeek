# 设计文档

## 概述

法律法规详情页是一个信息展示和导航中心页面，用于展示法律法规的完整信息、统计数据，并提供各个子功能的快速入口。该页面采用卡片式布局，信息层次清晰，操作便捷。

## 架构

### 页面结构

```
详情页 (detail/[id].vue)
├── 页面头部
│   ├── 返回按钮
│   ├── 标题和描述
│   └── 操作按钮组
├── 基本信息卡片
│   ├── 法律名称
│   ├── 法律代码
│   ├── 类型和状态
│   └── 其他元数据
├── 统计信息卡片
│   ├── 条文总数
│   ├── 向量化状态
│   └── 类型分布
└── 功能入口卡片
    ├── 查看条文
    ├── 添加条文
    ├── 编辑法律法规
    ├── 全量更新
    └── 嵌入记录
```

### 路由设计

- 路径: `/admin/legal-main/detail/[id]`
- 参数: `id` - 法律法规 ID
- 布局: `admin-layout`

## 组件和接口

### 页面组件

**LegalDetailPage** (`app/pages/admin/legal-main/detail/[id].vue`)

职责：
- 获取并展示法律法规详情
- 获取并展示统计信息
- 提供功能导航入口
- 处理加载和错误状态

Props: 无（通过路由参数获取 ID）

State:
- `loading: boolean` - 加载状态
- `legalData: LegalMainInfo | null` - 法律法规数据
- `statistics: LegalStatistics | null` - 统计数据
- `batchEmbedding: boolean` - 批量向量化进行中

Methods:
- `loadLegalData()` - 加载法律法规详情
- `loadStatistics()` - 加载统计信息
- `handleBatchEmbed()` - 执行批量向量化
- `navigateToArticles()` - 导航到条文列表
- `navigateToEdit()` - 导航到编辑页面
- `navigateToFullUpdate()` - 导航到全量更新页面
- `navigateToEmbeddings()` - 导航到嵌入记录页面

### API 接口

#### 1. 获取法律法规详情

**现有接口**: `GET /api/v1/admin/legal-main/:id`

返回数据: `LegalMainInfo`

#### 2. 获取统计信息

**新增接口**: `GET /api/v1/admin/legal-main/:id/statistics`

返回数据:
```typescript
interface LegalStatistics {
  // 条文统计
  totalArticles: number
  embeddedArticles: number
  notEmbeddedArticles: number
  
  // 类型分布
  articlesByType: {
    l1: number  // 编
    l2: number  // 分编
    l3: number  // 章
    l4: number  // 节
    l5: number  // 条
    notice: number  // 通知
    header: number  // 正文头部
    footer: number  // 正文尾部
    annex: number   // 附件
  }
  
  // 时间信息
  lastEditedAt: string | null
  lastEmbeddingAt: string | null
}
```

#### 3. 批量向量化

**现有接口**: `POST /api/v1/admin/legal-articles/batch-embed`

请求参数:
```typescript
{
  legalId: string
  forceAll: boolean
}
```

## 数据模型

### LegalStatistics 类型定义

需要在 `shared/types/legal.ts` 中添加：

```typescript
/** 法律法规统计信息 */
export interface LegalStatistics {
  /** 条文总数 */
  totalArticles: number
  /** 已向量化条文数 */
  embeddedArticles: number
  /** 未向量化条文数 */
  notEmbeddedArticles: number
  /** 各类型条文数量分布 */
  articlesByType: {
    l1: number
    l2: number
    l3: number
    l4: number
    l5: number
    notice: number
    header: number
    footer: number
    annex: number
  }
  /** 最后编辑时间 */
  lastEditedAt: string | null
  /** 最后向量化时间 */
  lastEmbeddingAt: string | null
}
```

## 正确性属性

*属性是一个特征或行为，应该在系统的所有有效执行中保持为真——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### 属性 1: 统计数据一致性

*对于任何* 法律法规，已向量化条文数 + 未向量化条文数应该等于条文总数

**验证: 需求 2.1, 2.2, 2.3**

### 属性 2: 类型分布总和一致性

*对于任何* 法律法规，所有类型的条文数量之和应该等于条文总数

**验证: 需求 2.1, 2.4**

### 属性 3: 状态显示正确性

*对于任何* 法律法规，如果失效日期早于当前日期，则应显示"已失效"状态；如果生效日期晚于当前日期，则应显示"未生效"状态；否则显示"有效"状态

**验证: 需求 1.3, 1.4**

### 属性 4: 导航路径正确性

*对于任何* 功能入口按钮，点击后应导航到正确的目标页面，且 URL 中包含正确的法律法规 ID

**验证: 需求 3.1, 3.2, 3.3, 3.4, 3.5**

### 属性 5: 数据加载完整性

*对于任何* 有效的法律法规 ID，页面加载时应成功获取法律法规详情和统计信息，或显示明确的错误提示

**验证: 需求 5.1, 5.2, 5.3, 7.1, 7.2**

## 错误处理

### 1. 法律法规不存在

- 显示友好的错误提示："未找到该法律法规"
- 提供返回列表按钮
- 记录错误日志

### 2. 网络请求失败

- 显示加载失败提示
- 提供重试按钮
- 记录错误日志

### 3. 批量向量化失败

- 显示具体的错误信息
- 不刷新统计数据
- 允许用户重试

### 4. 路由参数无效

- 重定向到法律法规列表页
- 显示错误提示

## 测试策略

### 单元测试

使用 Vitest 进行单元测试：

1. **状态计算测试**
   - 测试根据日期计算状态的逻辑
   - 测试边界情况（当天生效/失效）

2. **数据格式化测试**
   - 测试日期格式化
   - 测试数字格式化

3. **导航逻辑测试**
   - 测试各个导航函数生成正确的路径

### 属性测试

使用 fast-check 进行属性测试：

1. **属性 1: 统计数据一致性**
   - 生成随机的统计数据
   - 验证 `embeddedArticles + notEmbeddedArticles === totalArticles`

2. **属性 2: 类型分布总和一致性**
   - 生成随机的类型分布数据
   - 验证所有类型数量之和等于总数

3. **属性 3: 状态显示正确性**
   - 生成随机的日期组合
   - 验证状态计算逻辑正确

### UI 测试

使用 Vibium 进行 UI 测试：

1. **页面加载测试**
   - 访问详情页
   - 验证基本信息显示
   - 验证统计信息显示

2. **导航测试**
   - 点击各个功能入口按钮
   - 验证导航到正确页面

3. **响应式测试**
   - 在不同屏幕尺寸下测试布局
   - 验证移动端可用性

4. **批量向量化测试**
   - 点击批量向量化按钮
   - 验证按钮禁用状态
   - 验证完成后统计数据更新

## UI 设计规范

### 布局

- 使用 `space-y-6` 间距
- 卡片使用 `bg-card rounded-lg border` 样式
- 桌面端使用网格布局，移动端使用堆叠布局

### 颜色方案

- 状态标签：
  - 有效: `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
  - 已失效: `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
  - 未生效: `bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`

- 类型标签：
  - 法律: `bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400`
  - 行政法规: `bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400`
  - 司法解释: `bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400`
  - 指导意见: `bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400`

### 图标

- 返回: `ArrowLeft`
- 编辑: `Pencil`
- 查看: `FileText`
- 添加: `Plus`
- 数据库: `Database`
- 向量化: `Zap`
- 刷新: `RefreshCw`
- 统计: `BarChart3`

### 响应式断点

- 桌面端: `md:` 及以上
- 移动端: 默认样式

## 实现注意事项

1. **性能优化**
   - 统计数据可以考虑缓存
   - 避免不必要的重复请求

2. **用户体验**
   - 加载状态要明确
   - 错误提示要友好
   - 操作反馈要及时

3. **代码规范**
   - 使用 TypeScript 类型定义
   - 遵循项目的代码风格
   - 添加必要的中文注释

4. **可访问性**
   - 按钮要有明确的 title 属性
   - 使用语义化的 HTML 标签
   - 确保键盘导航可用
