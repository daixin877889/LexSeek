# 实现计划：案件分析系统

## 概述

本实现计划将案件分析系统设计转化为可执行的编码任务。

## 任务列表

- [x] 1. 案件分析核心功能
  - [x] 1.1 创建案件数据模型
  - [x] 1.2 实现案件分析服务
  - [x] 1.3 实现案件分析 API
  - [x] 1.4 实现案件分析页面

- [x] 2. 本地文件识别
  - [x] 2.1 实现文件读取 composable
  - [x] 2.2 实现本地文件缓存
  - [x] 2.3 集成到案件分析流程

- [ ] 3. DOCX 浏览器端识别
  - [x] 3.1 实现 DOCX 解析逻辑
  - [ ] 3.2 实现文档预览组件
  - [ ] 3.3 集成到材料选择器

- [x] 4. MinerU 批量上传（PDF/DOC）
  - [x] 4.1 实现 MinerU Token 服务
  - [x] 4.2 实现批量上传 API
  - [x] 4.3 实现回调处理
  - [x] 4.4 实现结果处理和向量化嵌入

- [ ] 5. 图像识别
  - [x] 5.1 现有 OCR 服务基础（ocr.service.ts，已使用节点系统）
  - [ ] 5.2 配置豆包多模态模型和统一提示词
  - [x] 5.3 实现 base64 图像识别 API
  - [x] 5.4 为图像识别添加向量化嵌入
  - [x] 5.5 在案件分析流程中集成图像识别触发
  - [x] 5.6 实现图像识别结果预览组件

## 实现状态

- ✅ 案件分析核心功能：已完成
- ✅ 本地文件识别：已完成
- 🔄 DOCX 浏览器端识别：进行中
- ✅ MinerU 批量上传：已完成
- 🔄 图像识别：进行中

## 图像识别详细任务

### 5.2 配置豆包多模态模型和统一提示词

**操作**：在后台管理系统中配置

**任务**:
1. 在模型管理中添加豆包多模态模型（如已有则跳过）
2. 更新 `extractImageInfo` 节点，关联豆包多模态模型
3. 配置统一的系统提示词，让 AI 自动判断图片类型并输出对应格式：
   - 文档类：识别文档内容，提取文字、表格等
   - 照片类：描述图片场景、人物、物体等

**提示词设计要点**：
- 统一的提示词处理所有图片类型
- AI 自动判断是文档类还是照片类
- 输出结构化结果：`{ imgType: 'doc'|'photo', imageInfo: 'Markdown内容' }`

### 5.3 实现 base64 图像识别 API

**文件**: 
- `server/api/v1/recognition/image.post.ts`（新建）
- `server/services/material/ocr.service.ts`（修改）

**任务**:
1. 创建新的 API 端点接收 base64 图片数据
2. 修改 OCR 服务，新增 `extractImageInfoByBase64` 方法
3. 构建 base64 格式的图片 URL：`data:${mimeType};base64,${base64Data}`
4. 调用豆包多模态 API 进行图像识别

**API 设计**:
```typescript
// POST /api/v1/recognition/image
// 请求体
{
  base64Data: string,  // 图片 base64 数据（不含前缀）
  mimeType: string,    // 图片 MIME 类型（如 image/jpeg）
  ossFileId: number    // 关联的 OSS 文件 ID
}

// 响应
{
  code: 0,
  message: '识别成功',
  data: {
    id: number,
    imageType: 'doc' | 'photo',
    markdownContent: string,
    htmlContent: string
  }
}
```

**豆包 API 调用格式**:
```typescript
import { z } from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

// 结构化输出 Schema
const imageInfoSchema = z.object({
  imgType: z.enum(['doc', 'photo']).describe('图片的类型：doc-文档类图片，photo-照片类图片'),
  imageInfo: z.string().describe('图片包含的内容信息，使用 Markdown 格式'),
})

// 创建模型实例
const model = new ChatOpenAI({
  model: nodeConfig.modelName,  // 如 doubao-1.5-vision-pro-32k
  apiKey: nodeConfig.modelApiKeys[0].apiKey,
  configuration: {
    baseURL: nodeConfig.modelProviderBaseUrl,
  },
})
const modelWithStructure = model.withStructuredOutput(imageInfoSchema)

// 构建消息
const messages = [
  new SystemMessage(systemPrompt),
  new HumanMessage([
    {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${base64Data}`,
      },
    },
  ]),
]

// 调用并获取结构化结果
const result = await modelWithStructure.invoke(messages)
// result: { imgType: 'doc' | 'photo', imageInfo: string }
```

### 5.4 为图像识别添加向量化嵌入

**文件**: `server/services/material/ocr.service.ts`

**任务**:
1. 在 `createImageRecognitionService` 中调用 `embedImageService`
2. 更新 `imageRecognitionRecords` 的 `vectorIds` 和 `lastEmbeddingAt` 字段
3. 嵌入失败不影响识别结果保存

### 5.3 为图像识别添加向量化嵌入

**文件**: `server/services/material/ocr.service.ts`

**任务**:
1. 在 `createImageRecognitionService` 中调用 `embedImageService`
2. 更新 `imageRecognitionRecords` 的 `vectorIds` 和 `lastEmbeddingAt` 字段
3. 嵌入失败不影响识别结果保存

### 5.4 在案件分析流程中集成图像识别

**文件**: `app/components/caseAnalysis/promptInput.vue`

**任务**:
1. 检测图像文件类型（PNG/JPG/JPEG/GIF/WEBP/HEIC/HEIF）
2. 调用现有的 OCR 服务进行图像识别
3. 触发识别流程并更新状态

### 5.5 实现图像识别结果预览

**文件**: `app/components/caseAnalysis/imagePreview.vue`（新建）

**任务**:
1. 显示原始图片
2. 显示识别结果（Markdown/HTML）
3. 支持编辑识别结果
