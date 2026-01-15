# 设计文档

## 概述

本设计文档描述了 LexSeek 案件分析系统的技术架构和实现方案。

## 架构

### 目录结构

```
server/
├── api/v1/
│   ├── case/                  # 案件分析 API
│   └── recognition/           # 文档识别 API
│       ├── doc/               # 文档识别
│       └── mineru/            # MinerU 服务
├── services/
│   ├── case/                  # 案件服务
│   └── material/              # 材料服务
│       ├── materialEmbedding.service.ts
│       └── mineruToken.service.ts
app/
├── pages/dashboard/analysis/  # 案件分析页面
├── composables/
│   ├── useDocxRecognition.ts  # DOCX 识别
│   ├── useMineruRecognition.ts # MinerU 识别
│   ├── useLocalFileCache.ts   # 本地文件缓存
│   └── useFileReader.ts       # 文件读取
└── components/caseAnalysis/   # 案件分析组件
```

## 组件和接口

### 文档识别服务

```typescript
// 文档识别接口
interface DocumentRecognitionService {
  recognizeDocx(file: File): Promise<RecognitionResult>;
  recognizePdf(file: File): Promise<RecognitionResult>;
  recognizeImage(file: File): Promise<RecognitionResult>;
}
```

### MinerU 服务

```typescript
// MinerU 批量上传接口
interface MineruService {
  uploadBatch(files: File[]): Promise<BatchUploadResult>;
  getTaskStatus(taskId: string): Promise<TaskStatus>;
  getResult(taskId: string): Promise<RecognitionResult>;
}
```

### 图像识别服务

```typescript
// 图像识别接口
interface ImageRecognitionService {
  // 创建图像识别（通过 base64 数据）
  createImageRecognitionByBase64Service(
    base64Data: string,
    mimeType: string,
    ossFileId: number,
    userId: number
  ): Promise<OcrResult>;
  // 更新识别结果
  updateImageRecognitionService(id: number, markdownContent: string, userId: number): Promise<Record>;
  // 图像向量化嵌入
  embedImageService(recordId: number, userId: number): Promise<EmbeddingResult>;
}

// 图像类型（AI 自动判断）
enum ImageType {
  DOC = 'doc',    // 文档类（扫描件、截图）- 识别文档内容
  PHOTO = 'photo' // 照片类（证据照片）- 生成内容描述
}

// 识别结果
interface OcrResult {
  record: imageRecognitionRecords;
  success: boolean;
  error?: string;
}

// 图像识别请求参数
interface ImageRecognitionRequest {
  base64Data: string;  // 图片 base64 数据（不含 data:image/xxx;base64, 前缀）
  mimeType: string;    // 图片 MIME 类型
  ossFileId: number;   // 关联的 OSS 文件 ID
}
```

### 豆包多模态 API 调用

豆包模型兼容 OpenAI API 规范，使用 `@langchain/openai` 的 `ChatOpenAI` 进行调用。

```typescript
import { z } from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

// 结构化输出 Schema
const imageInfoSchema = z.object({
  imgType: z.enum(['doc', 'photo']).describe('图片的类型：doc-文档类图片，photo-照片类图片'),
  imageInfo: z.string().describe('图片包含的内容信息，使用 Markdown 格式'),
})

// 创建模型实例并绑定结构化输出
const model = new ChatOpenAI({
  model: nodeConfig.modelName,  // 如 doubao-1.5-vision-pro-32k
  apiKey: nodeConfig.modelApiKeys[0].apiKey,
  configuration: {
    baseURL: nodeConfig.modelProviderBaseUrl,
  },
})
const modelWithStructure = model.withStructuredOutput(imageInfoSchema)

// 图片理解请求格式（base64 方式）
const messages = [
  new SystemMessage(systemPrompt),
  new HumanMessage([
    {
      type: 'image_url',
      image_url: {
        // base64 格式：data:image/{mimeType};base64,{base64Data}
        url: `data:${mimeType};base64,${base64Data}`,
      },
    },
  ]),
]

// 调用并获取结构化结果
const result = await modelWithStructure.invoke(messages)
// result: { imgType: 'doc' | 'photo', imageInfo: string }

// 推荐模型
// - doubao-1.5-vision-pro-32k：图片理解
// - doubao-seed-1.6：多模态、深度思考、图片理解
// - doubao-1.5-thinking-vision-pro：图片理解、深度思考
```

### 节点配置（extractImageInfo）

```typescript
// 节点配置结构（通过 getNodeConfigService 获取）
interface NodeConfig {
  id: number;
  name: string;                    // 'extractImageInfo'
  modelName: string;               // 豆包多模态模型名称（如 doubao-1.5-vision-pro-32k）
  modelProviderBaseUrl: string;    // 模型 API 地址
  modelApiKeys: { apiKey: string }[];
  prompts: {
    type: 'system' | 'user' | 'assistant';
    content: string;               // 统一的图像识别提示词
  }[];
}
```

### 图像识别流程

```
┌─────────────────────────────────────────────────────────────┐
│                      图像识别流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌──────────────────┐                   │
│  │ 客户端上传   │───▶│ 转换为 base64    │                   │
│  │ 图片文件     │    │ 格式             │                   │
│  └─────────────┘    └────────┬─────────┘                   │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              提交到服务端 API                        │   │
│  │   POST /api/v1/recognition/image                   │   │
│  │   { base64Data, mimeType, ossFileId }              │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌──────────────────┐    ┌───────────────┐                 │
│  │ 获取节点配置      │───▶│ 构建 AI 请求   │                 │
│  │ (extractImageInfo)│    └───────────────┘                 │
│  └──────────────────┘           │                          │
│                                 ▼                          │
│              ┌─────────────────────────────────────┐       │
│              │     豆包多模态 API 调用              │       │
│              │   url: data:image/xxx;base64,xxx   │       │
│              │   (统一提示词，AI 自动判断类型)      │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │     结构化输出                       │       │
│              │   { imgType, imageInfo }           │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │        保存识别结果                  │       │
│              │   (Markdown + HTML)                │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │        向量化嵌入                    │       │
│              │   (embedImageService)              │       │
│              └─────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 实现状态

### 已完成

- 案件分析核心功能
- 本地文件识别
- 文件缓存机制
- MinerU 批量上传（PDF/DOC）
- MinerU 回调处理
- 文档向量化嵌入

### 进行中

- DOCX 浏览器端识别
- 图像识别（豆包多模态方案）

### 相关文件

**服务层**:
- `server/services/case/*.ts`
- `server/services/material/*.ts`
- `server/services/material/ocr.service.ts` - 图像识别服务（豆包多模态）
- `server/services/material/ocr.dao.ts` - 图像识别 DAO
- `server/services/material/mineruResult.service.ts` - MinerU 结果处理（PDF/DOC）
- `server/services/material/materialEmbedding.service.ts` - 向量化嵌入

**API 层**:
- `server/api/v1/case/*.ts`
- `server/api/v1/recognition/*.ts`
- `server/api/v1/callback/mineru-batch.post.ts` - MinerU 回调

**前端**:
- `app/pages/dashboard/analysis/*.vue`
- `app/composables/useDocxRecognition.ts`
- `app/composables/useMineruRecognition.ts`

**数据模型**:
- `prisma/models/recognition.prisma` - 识别记录表（docRecognitionRecords, imageRecognitionRecords）
