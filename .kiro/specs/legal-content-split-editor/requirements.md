# 需求文档：法律法规内容编辑和自动拆分

## 简介

本功能为法律法规管理系统提供全量内容编辑和自动拆分能力。用户可以在编辑器中修改法律法规的完整内容，系统将自动按照预定义的规则将内容拆分成条文，并保存到数据库中，同时自动触发向量化处理。

## 术语表

- **System**: 法律法规内容编辑和拆分系统
- **Editor**: Markdown 内容编辑器（使用 RichTextEditor 组件）
- **Preview**: Markdown 内容预览器（使用 markstream-vue 组件）
- **Parser**: 法律内容拆分解析器
- **Article**: 法律条文
- **Vectorization**: 向量化处理，将条文内容转换为向量嵌入用于语义检索
- **Full_Update_Mode**: 全量更新模式，用户编辑完整法律内容并重新拆分的工作流程

## 需求

### 需求 1：全量更新入口

**用户故事：** 作为法律法规管理员，我想要通过"全量更新"按钮进入编辑模式，以便修改法律法规的完整内容。

#### 验收标准

1. WHEN 用户在法律法规编辑页面点击"全量更新"按钮，THEN THE System SHALL 进入全量更新编辑模式
2. WHEN 进入全量更新模式，THEN THE System SHALL 显示左右分栏布局（桌面端）或编辑/预览切换模式（移动端）
3. WHEN 用户在移动端，THEN THE System SHALL 提供编辑模式和预览模式的切换按钮

### 需求 2：内容编辑器

**用户故事：** 作为法律法规管理员，我想要使用 Markdown 编辑器编辑法律内容，以便灵活地组织和格式化法律文本。

#### 验收标准

1. WHEN 编辑器加载，THEN THE Editor SHALL 使用 RichTextEditor 组件（outputFormat="markdown"）编辑内容
2. WHEN 用户编辑内容，THEN THE Editor SHALL 实时保存编辑状态
3. WHEN 法律内容为空，THEN THE Editor SHALL 显示占位提示文本
4. WHEN 用户输入 Markdown 语法，THEN THE Editor SHALL 提供富文本编辑功能

### 需求 3：Markdown 预览组件

**用户故事：** 作为系统，我需要安装 markstream-vue 组件，以便在预览区渲染 Markdown 格式的法律内容。

#### 验收标准

1. WHEN 安装依赖，THEN THE System SHALL 使用 bun 安装 markstream-vue 包
2. WHEN 组件加载，THEN THE Preview SHALL 使用 markstream-vue 渲染 Markdown 内容
3. WHEN Markdown 内容包含标题、列表、表格等语法，THEN THE Preview SHALL 正确渲染格式化内容
4. WHEN Markdown 内容更新，THEN THE Preview SHALL 实时更新渲染结果

### 需求 4：实时拆分预览

**用户故事：** 作为法律法规管理员，我想要在编辑时实时看到拆分效果，以便验证内容结构是否正确。

#### 验收标准

1. WHEN 用户编辑左侧内容，THEN THE System SHALL 在右侧实时显示拆分后的条文结构
2. WHEN 内容包含 Markdown 标题（#），THEN THE Parser SHALL 使用系统一（Markdown 解析器）进行拆分
3. WHEN 内容包含中文数字标题（一、），THEN THE Parser SHALL 使用系统二（司法文档解析器）进行拆分
4. WHEN 拆分失败，THEN THE System SHALL 在预览区显示错误信息和原因
5. WHEN 预览区显示条文，THEN THE System SHALL 按层级缩进展示条文结构

### 需求 5：响应式布局

**用户故事：** 作为法律法规管理员，我想要在不同设备上都能流畅使用编辑功能，以便随时随地进行内容维护。

#### 验收标准

1. WHEN 用户在桌面端（≥768px），THEN THE System SHALL 显示左右分栏布局，左侧编辑器，右侧预览
2. WHEN 用户在移动端（<768px），THEN THE System SHALL 显示单栏布局，提供编辑/预览模式切换
3. WHEN 用户在桌面端调整窗口大小，THEN THE System SHALL 支持拖拽调整左右分栏宽度
4. WHEN 用户在移动端切换模式，THEN THE System SHALL 平滑过渡到目标模式

### 需求 6：保存和拆分

**用户故事：** 作为法律法规管理员，我想要保存编辑后的内容并自动拆分成条文，以便更新法律法规的条文数据。

#### 验收标准

1. WHEN 用户点击保存按钮，THEN THE System SHALL 验证内容是否为空
2. WHEN 内容验证通过，THEN THE System SHALL 先删除该法律法规的所有现有条文
3. WHEN 现有条文删除完成，THEN THE System SHALL 将拆分后的条文批量保存到数据库
4. WHEN 条文保存成功，THEN THE System SHALL 自动触发向量化处理
5. WHEN 保存过程中发生错误，THEN THE System SHALL 回滚所有数据库操作并显示错误信息

### 需求 7：向量化处理

**用户故事：** 作为法律法规管理员，我想要在保存条文后自动进行向量化，以便条文内容可以被语义检索。

#### 验收标准

1. WHEN 条文保存成功，THEN THE System SHALL 调用批量向量化 API
2. WHEN 向量化处理开始，THEN THE System SHALL 显示处理进度提示
3. WHEN 向量化处理完成，THEN THE System SHALL 显示成功提示并返回条文列表页面
4. WHEN 向量化处理失败，THEN THE System SHALL 显示警告信息但不影响条文保存结果

### 需求 8：内容解析规则

**用户故事：** 作为系统，我需要正确解析不同格式的法律内容，以便准确拆分成条文结构。

#### 验收标准

1. WHEN 内容包含 Markdown 标题（# 到 #####），THEN THE Parser SHALL 识别为系统一格式并解析为 l1-l5 层级
2. WHEN 内容包含中文数字标题（一、二、三、），THEN THE Parser SHALL 识别为系统二格式并解析为 l1-l2 层级
3. WHEN 内容包含 >notice< 标签，THEN THE Parser SHALL 将其解析为通知类型条文
4. WHEN 内容包含 >header< 标签，THEN THE Parser SHALL 将其解析为正文头部类型条文
5. WHEN 内容包含 >footer< 标签，THEN THE Parser SHALL 将其解析为正文尾部类型条文
6. WHEN 内容包含 >annex< 标签，THEN THE Parser SHALL 将其解析为附件类型条文
7. WHEN 标题包含中文数字，THEN THE Parser SHALL 正确转换为阿拉伯数字索引（l1I-l5I）

### 需求 9：数据完整性

**用户故事：** 作为系统，我需要确保数据操作的原子性和一致性，以便避免数据损坏。

#### 验收标准

1. WHEN 执行删除和保存操作，THEN THE System SHALL 使用数据库事务确保原子性
2. WHEN 任何操作失败，THEN THE System SHALL 回滚所有已执行的数据库操作
3. WHEN 保存条文，THEN THE System SHALL 保留法律法规的发布日期、生效日期和失效日期
4. WHEN 保存条文，THEN THE System SHALL 为每个条文生成唯一的 UUID v7 标识符
5. WHEN 保存条文，THEN THE System SHALL 按顺序为条文分配 order 字段值

### 需求 10：用户体验

**用户故事：** 作为法律法规管理员，我想要获得清晰的操作反馈，以便了解系统的处理状态。

#### 验收标准

1. WHEN 用户执行保存操作，THEN THE System SHALL 显示加载状态指示器
2. WHEN 操作成功，THEN THE System SHALL 显示成功提示消息
3. WHEN 操作失败，THEN THE System SHALL 显示具体的错误信息
4. WHEN 用户尝试离开编辑页面且有未保存的更改，THEN THE System SHALL 显示确认对话框
5. WHEN 处理大量条文，THEN THE System SHALL 显示处理进度

### 需求 11：错误处理

**用户故事：** 作为系统，我需要优雅地处理各种错误情况，以便提供稳定的用户体验。

#### 验收标准

1. WHEN 内容解析失败，THEN THE System SHALL 捕获错误并显示友好的错误消息
2. WHEN 数据库操作失败，THEN THE System SHALL 回滚事务并记录错误日志
3. WHEN 向量化 API 调用失败，THEN THE System SHALL 记录错误但不阻止条文保存
4. WHEN 网络请求超时，THEN THE System SHALL 显示超时提示并允许用户重试
5. WHEN 用户权限不足，THEN THE System SHALL 显示权限错误并阻止操作
