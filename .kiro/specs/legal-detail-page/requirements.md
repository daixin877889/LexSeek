# 需求文档

## 简介

为法律法规管理系统添加一个详情页面，用于展示法律法规的完整信息、统计数据和操作入口。该页面作为法律法规管理的中心枢纽，提供清晰的信息展示和便捷的功能导航。

## 术语表

- **System**: 法律法规详情页系统
- **Legal_Main**: 法律法规主表数据
- **Article**: 法律条文
- **Embedding**: 向量嵌入记录
- **User**: 管理员用户

## 需求

### 需求 1: 基本信息展示

**用户故事:** 作为管理员，我想查看法律法规的完整基本信息，以便了解该法律法规的详细情况。

#### 验收标准

1. WHEN 用户访问详情页，THE System SHALL 显示法律法规的名称、代码、类型、发文机关、文号、发布日期、生效日期、失效日期
2. WHEN 法律法规有分类信息，THE System SHALL 显示分类标签
3. WHEN 法律法规有失效日期且已失效，THE System SHALL 显示"已失效"状态标识
4. WHEN 法律法规有生效日期且未生效，THE System SHALL 显示"未生效"状态标识
5. THE System SHALL 使用与项目一致的 UI 风格展示信息

### 需求 2: 统计信息展示

**用户故事:** 作为管理员，我想查看法律法规的统计信息，以便了解该法律法规的数据规模和处理状态。

#### 验收标准

1. THE System SHALL 显示条文总数统计
2. THE System SHALL 显示已向量化条文数量
3. THE System SHALL 显示未向量化条文数量
4. THE System SHALL 显示各类型条文的数量分布（编、分编、章、节、条）
5. THE System SHALL 显示最后编辑时间
6. THE System SHALL 显示最后向量化时间

### 需求 3: 功能入口导航

**用户故事:** 作为管理员，我想从详情页快速访问各个功能页面，以便高效地管理法律法规。

#### 验收标准

1. THE System SHALL 提供"查看条文"入口，导航到条文列表页
2. THE System SHALL 提供"添加条文"入口，打开添加条文对话框
3. THE System SHALL 提供"编辑法律法规"入口，导航到编辑页面
4. THE System SHALL 提供"全量更新"入口，导航到全量更新页面
5. THE System SHALL 提供"嵌入记录"入口，导航到嵌入记录页面
6. THE System SHALL 提供"批量向量化"操作按钮
7. THE System SHALL 提供"返回列表"按钮，导航回法律法规列表页

### 需求 4: 响应式布局

**用户故事:** 作为管理员，我想在不同设备上都能良好地查看详情页，以便随时随地管理法律法规。

#### 验收标准

1. WHEN 在桌面端访问，THE System SHALL 使用多列布局展示信息
2. WHEN 在移动端访问，THE System SHALL 使用单列布局展示信息
3. THE System SHALL 确保所有功能按钮在移动端可正常点击
4. THE System SHALL 确保文本内容在小屏幕上可读

### 需求 5: 加载状态处理

**用户故事:** 作为管理员，我想在数据加载时看到明确的状态提示，以便了解系统正在工作。

#### 验收标准

1. WHEN 页面正在加载数据，THE System SHALL 显示加载动画
2. WHEN 数据加载失败，THE System SHALL 显示错误提示信息
3. WHEN 法律法规不存在，THE System SHALL 显示"未找到"提示并提供返回按钮
4. WHEN 批量向量化操作进行中，THE System SHALL 禁用相关按钮并显示进度提示

### 需求 6: 路由集成

**用户故事:** 作为管理员，我想通过点击列表中的法律法规名称进入详情页，以便查看完整信息。

#### 验收标准

1. WHEN 用户在列表页点击法律法规名称，THE System SHALL 导航到详情页
2. THE System SHALL 在 URL 中包含法律法规 ID 参数
3. THE System SHALL 支持通过 URL 直接访问详情页
4. THE System SHALL 在面包屑导航中显示当前法律法规名称

### 需求 7: 数据实时性

**用户故事:** 作为管理员，我想看到最新的统计数据，以便做出准确的管理决策。

#### 验收标准

1. WHEN 页面加载时，THE System SHALL 从服务器获取最新的法律法规信息
2. WHEN 页面加载时，THE System SHALL 从服务器获取最新的统计数据
3. WHEN 执行批量向量化后，THE System SHALL 刷新统计数据
4. THE System SHALL 确保统计数据与实际数据库状态一致
