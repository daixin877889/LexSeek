# 需求文档

## 简介

本文档定义了 LexSeek 案件分析系统需求，包括案件分析、文档识别等功能。

本文档整合自以下原始 spec：
- case-analysis（案件分析）
- docx-browser-recognition（DOCX 浏览器端识别）
- mineru-batch-upload（MinerU 批量上传）
- local-file-recognition（本地文件识别）

## 术语表

- **Case_Analysis**: 案件分析，AI 辅助的法律案件分析功能
- **Document_Recognition**: 文档识别，将文档转换为结构化文本
- **MinerU**: 文档识别服务，支持 PDF、图片等格式

## 需求

### 需求 1：案件分析

**用户故事：** 作为用户，我希望能够使用 AI 分析法律案件，以便获得专业的法律建议。

#### 验收标准

1. THE System SHALL 支持创建案件分析任务
2. THE System SHALL 支持上传案件相关材料
3. THE System SHALL 使用 AI 模型分析案件
4. THE System SHALL 返回结构化的分析结果

### 需求 2：DOCX 浏览器端识别

**用户故事：** 作为用户，我希望能够在浏览器端识别 DOCX 文档，以便快速提取文档内容。

#### 验收标准

1. THE System SHALL 支持在浏览器端解析 DOCX 文件
2. THE System SHALL 提取文档的文本内容
3. THE System SHALL 保留文档的基本格式
4. THE System SHALL 支持文档预览

### 需求 3：MinerU 批量上传

**用户故事：** 作为用户，我希望能够批量上传文档进行识别，以便提高工作效率。

#### 验收标准

1. THE System SHALL 支持批量上传文档到 MinerU 服务
2. THE System SHALL 支持查询识别任务状态
3. THE System SHALL 支持获取识别结果
4. THE System SHALL 支持识别结果的回调处理

### 需求 4：本地文件识别

**用户故事：** 作为用户，我希望能够识别本地文件，以便在案件分析中使用。

#### 验收标准

1. THE System SHALL 支持本地文件的上传和识别
2. THE System SHALL 支持多种文件格式（PDF、图片、DOCX 等）
3. THE System SHALL 缓存识别结果以提高性能

### 需求 5：图像识别

**用户故事：** 作为用户，我希望能够识别图片中的内容，以便在案件分析中使用图片证据。

#### 验收标准

1. THE System SHALL 支持常见图片格式（PNG、JPG、JPEG、GIF、WEBP、HEIC、HEIF）
2. THE System SHALL 使用豆包多模态模型进行图像识别
3. THE System SHALL 使用统一的提示词处理不同类型的图片（文档类识别内容，照片类生成描述）
4. THE System SHALL 将识别结果转换为 Markdown 和 HTML 格式
5. THE System SHALL 对识别结果进行向量化嵌入
6. THE System SHALL 支持识别结果的编辑和更新
7. THE System SHALL 在案件分析流程中自动触发图像识别
8. THE System SHALL 复用现有的节点、提示词、模型管理系统

#### 技术方案

**统一识别策略**：
- 使用豆包（Doubao）多模态模型进行图像识别
- 通过节点系统（`extractImageInfo` 节点）管理模型和提示词配置
- 使用统一的提示词，AI 自动判断图片类型并输出对应格式：
  - **文档类图片**：识别文档内容，提取文字、表格等结构化信息
  - **照片类图片**：生成图片内容描述，描述场景、物体、人物等

**数据流**：
1. 客户端上传图片 → 转换为 base64 格式
2. 提交 base64 数据到服务端 → 获取节点配置（模型、提示词）
3. 服务端调用豆包多模态 API（传入 base64 图片）
4. AI 自动判断图片类型并返回结构化结果
5. 保存识别结果（Markdown + HTML）→ 向量化嵌入

**为什么使用 base64**：
- OSS 文件可能是加密存储的，无法直接通过 URL 访问
- 客户端可以直接读取本地文件转换为 base64
- 避免服务端额外的文件下载和解密操作

## 实现状态

- 案件分析：✅ 已完成
- DOCX 浏览器端识别：🔄 进行中
- MinerU 批量上传：✅ 已完成
- 本地文件识别：✅ 已完成
- 图像识别：🔄 进行中
