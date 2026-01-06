# 需求文档

## 简介

本功能在 dashboard 左侧菜单"按键分析"下方新增"法律法规"菜单项，为用户提供法律法规和法条的搜索功能。用户可以查看法律法规全文（使用拆分预览样式），也可以搜索具体法条。支持多维度筛选，并展示分类统计信息。页面设计简洁专业，适配移动端和 PC 端。

## 术语表

- **Legal_Search_System**: 法律法规搜索系统，负责处理用户的搜索请求和结果展示
- **Legal_Main**: 法律法规主表，存储法律法规的基本信息
- **Legal_Article**: 法律条文，存储法律法规对应的具体条款内容
- **Legal_Type**: 法律类型，包括法律(law)、行政法规(regulation)、司法解释(judicial_interp)、指导意见(guideline)
- **Article_Preview**: 条文预览组件，使用拆分预览样式展示法律条文
- **Statistics_Panel**: 统计面板，展示法律法规的分类统计信息
- **Filter_Panel**: 筛选面板，提供多维度筛选功能

## 需求

### 需求 1：菜单导航

**用户故事：** 作为用户，我希望在 dashboard 左侧菜单中看到"法律法规"入口，以便快速访问法律搜索功能。

#### 验收标准

1. THE Legal_Search_System SHALL 在 dashboard 左侧菜单"按键分析"下方显示"法律法规"菜单项
2. WHEN 用户点击"法律法规"菜单项 THEN Legal_Search_System SHALL 导航至法律法规搜索页面
3. THE Legal_Search_System SHALL 为菜单项配置适当的图标（如 Scale 或 BookOpen 图标）

### 需求 2：统计面板

**用户故事：** 作为用户，我希望看到法律法规的分类统计，以便了解系统中法律数据的整体情况。

#### 验收标准

1. WHEN 用户访问法律法规页面 THEN Statistics_Panel SHALL 显示法律、行政法规、司法解释、指导意见的数量统计
2. THE Statistics_Panel SHALL 以卡片形式展示各类型的数量
3. THE Statistics_Panel SHALL 在移动端以紧凑布局展示统计信息
4. WHEN 统计数据加载中 THEN Statistics_Panel SHALL 显示骨架屏加载状态

### 需求 3：法律法规搜索

**用户故事：** 作为用户，我希望能够搜索法律法规，以便快速找到需要的法律文件。

#### 验收标准

1. THE Legal_Search_System SHALL 提供搜索输入框用于关键词搜索
2. WHEN 用户输入搜索关键词并提交 THEN Legal_Search_System SHALL 返回匹配的法律法规列表
3. THE Legal_Search_System SHALL 支持按法律名称、文号进行搜索
4. WHEN 搜索结果为空 THEN Legal_Search_System SHALL 显示友好的空状态提示
5. THE Legal_Search_System SHALL 支持搜索结果分页展示

### 需求 4：多维度筛选

**用户故事：** 作为用户，我希望能够通过多个维度筛选法律法规，以便精确定位所需内容。

#### 验收标准

1. THE Filter_Panel SHALL 提供法律类型筛选（法律、行政法规、司法解释、指导意见）
2. THE Filter_Panel SHALL 提供发文机关筛选
3. THE Filter_Panel SHALL 提供生效状态筛选（有效、已失效）
4. THE Filter_Panel SHALL 提供发布日期范围筛选
5. WHEN 用户选择筛选条件 THEN Legal_Search_System SHALL 实时更新搜索结果
6. THE Filter_Panel SHALL 提供重置筛选条件的功能
7. THE Filter_Panel SHALL 在移动端以折叠面板或底部抽屉形式展示

### 需求 5：法律法规列表

**用户故事：** 作为用户，我希望看到清晰的法律法规列表，以便浏览和选择查看详情。

#### 验收标准

1. THE Legal_Search_System SHALL 以列表形式展示搜索结果
2. THE Legal_Search_System SHALL 在列表项中显示法律名称、类型、发文机关、发布日期、生效状态
3. WHEN 用户点击列表项 THEN Legal_Search_System SHALL 展开显示法律全文预览
4. THE Legal_Search_System SHALL 在 PC 端使用表格布局展示列表
5. THE Legal_Search_System SHALL 在移动端使用卡片布局展示列表

### 需求 6：法律全文预览

**用户故事：** 作为用户，我希望能够查看法律法规的全文内容，以便详细了解法律条款。

#### 验收标准

1. WHEN 用户选择查看法律全文 THEN Article_Preview SHALL 使用拆分预览样式展示法律条文
2. THE Article_Preview SHALL 按层级结构（编、章、节、条）展示法律内容
3. THE Article_Preview SHALL 提供条文导航功能，支持快速跳转到指定条文
4. THE Article_Preview SHALL 支持条文内容的高亮显示
5. THE Article_Preview SHALL 在移动端以全屏模式展示法律全文

### 需求 7：法条搜索

**用户故事：** 作为用户，我希望能够搜索具体的法条内容，以便快速找到相关条款。

#### 验收标准

1. THE Legal_Search_System SHALL 提供法条内容搜索功能
2. WHEN 用户搜索法条 THEN Legal_Search_System SHALL 使用向量搜索返回语义相关的法条
3. THE Legal_Search_System SHALL 在搜索结果中显示法条所属的法律名称和章节层级
4. THE Legal_Search_System SHALL 高亮显示搜索关键词匹配的内容
5. WHEN 用户点击法条搜索结果 THEN Legal_Search_System SHALL 跳转到该法条在全文中的位置

### 需求 8：响应式设计

**用户故事：** 作为用户，我希望在不同设备上都能良好使用法律搜索功能。

#### 验收标准

1. THE Legal_Search_System SHALL 适配桌面端（宽度 >= 1024px）布局
2. THE Legal_Search_System SHALL 适配平板端（768px <= 宽度 < 1024px）布局
3. THE Legal_Search_System SHALL 适配移动端（宽度 < 768px）布局
4. THE Legal_Search_System SHALL 在移动端提供触摸友好的交互体验
5. THE Legal_Search_System SHALL 确保所有功能在各端均可正常使用

### 需求 9：加载状态与错误处理

**用户故事：** 作为用户，我希望在数据加载时看到明确的状态提示，在出错时得到友好的错误信息。

#### 验收标准

1. WHEN 数据加载中 THEN Legal_Search_System SHALL 显示加载指示器
2. WHEN 搜索请求失败 THEN Legal_Search_System SHALL 显示错误提示并提供重试选项
3. WHEN 网络连接异常 THEN Legal_Search_System SHALL 显示网络错误提示
4. THE Legal_Search_System SHALL 在列表加载时显示骨架屏效果
