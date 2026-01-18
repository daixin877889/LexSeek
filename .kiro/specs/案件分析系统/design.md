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
│       ├── mineru/            # MinerU 服务
│       └── audio/             # 音频识别 API（新增）
├── services/
│   ├── case/                  # 案件服务
│   └── material/              # 材料服务
│       ├── materialEmbedding.service.ts
│       ├── mineruToken.service.ts
│       └── asr.service.ts     # 音频识别服务（新增）
app/
├── pages/dashboard/analysis/  # 案件分析页面
├── composables/
│   ├── useDocxRecognition.ts  # DOCX 识别
│   ├── useMineruRecognition.ts # MinerU 识别
│   ├── useLocalFileCache.ts   # 本地文件缓存
│   ├── useFileReader.ts       # 文件读取
│   └── useAudioRecognition.ts # 音频识别（新增）
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

### 音频识别服务

```typescript
// 音频识别接口（已实现于 server/services/material/asr.service.ts）
interface AudioRecognitionService {
  // 提交音频转录任务（主入口）
  transcribeAudioService(
    ossFileId: number,
    userId: number,
    options?: AsrSubmitOptions
  ): Promise<AsrSubmitResult>;
  
  // 获取 ASR 识别记录
  getAsrRecordByOssFileIdService(ossFileId: number): Promise<asrRecords | null>;
  getAsrRecordByIdService(id: number): Promise<asrRecords | null>;
  getAsrRecordsByOssFileIdsService(ossFileIds: number[]): Promise<asrRecords[]>;
  
  // 更新识别记录（说话人、关键词、摘要）
  updateAsrRecordService(
    id: number,
    data: { speakers?: Speaker[]; keywords?: any; summary?: string }
  ): Promise<asrRecords>;
}

// ASR 任务提交选项
interface AsrSubmitOptions {
  timestampAlignmentEnabled?: boolean;  // 时间戳对齐
  languageHints?: string[];             // 语言提示，默认 ['zh', 'en']
  disfluencyRemovalEnabled?: boolean;   // 语气词过滤
  diarizationEnabled?: boolean;         // 说话人分离，默认 true
}

// ASR 任务状态
enum AsrTaskStatus {
  PENDING = 0,    // 待处理
  PROCESSING = 1, // 处理中
  SUCCESS = 2,    // 成功
  FAILED = 3      // 失败
}

// ASR 识别记录状态
enum AsrRecordStatus {
  PENDING = 0,    // 待处理
  PROCESSING = 1, // 处理中
  SUCCESS = 2,    // 成功
  FAILED = 3      // 失败
}

// 说话人信息
interface Speaker {
  id: number;
  name: string;
  color?: string;
}
```

### 模型管理集成

通过项目的模型管理系统管理 ASR 模型配置，不使用环境变量：

```typescript
// 节点配置结构（通过 getNodeConfigService 获取）
interface NodeConfig {
  id: number;
  name: string;                    // 'audioRecognition'
  modelName: string;               // 'paraformer-v2'
  modelType: string;               // 'asr'
  modelProviderBaseUrl: string;    // 'https://dashscope.aliyuncs.com/api/v1'
  modelApiKeys: { apiKey: string }[];  // API Key 通过模型提供商管理
}

// 获取节点配置
const nodeConfig = await getNodeConfigService('audioRecognition')
const apiKey = nodeConfig.modelApiKeys[0].apiKey
```

### 阿里云百炼 DashScope API 调用

直接调用 DashScope REST API（不使用 SDK），通过模型管理获取 API Key：

```typescript
// 获取节点配置
const nodeConfig = await getNodeConfigService('audioRecognition')
const apiKey = nodeConfig.modelApiKeys[0].apiKey

// 提交异步识别任务
const response = await $fetch<{
  request_id?: string
  output?: {
    task_id: string
    task_status: string
  }
  code?: string
  message?: string
}>('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,  // 使用模型管理中的 API Key
    'Content-Type': 'application/json',
    'X-DashScope-Async': 'enable',
  },
  body: {
    model: nodeConfig.modelName,  // 'paraformer-v2'
    input: {
      file_urls: [signedAudioUrl],  // 使用签名 URL
    },
    parameters: {
      timestamp_alignment_enabled: false,
      language_hints: ['zh', 'en'],
      disfluency_removal_enabled: false,
      diarization_enabled: true,  // 启用说话人分离
    },
  },
})

// 轮询任务状态
const statusResponse = await $fetch<{
  output?: {
    task_id: string
    task_status: string  // PENDING, RUNNING, SUCCEEDED, FAILED
    results?: Array<{
      file_url: string
      subtask_status: string
      transcription_url?: string  // 转录结果 JSON URL
    }>
  }
}>(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
})

// 下载并处理转录结果
if (statusResponse.output?.task_status === 'SUCCEEDED') {
  const transcriptionUrl = statusResponse.output.results[0].transcription_url
  const result = await $fetch(transcriptionUrl)
  // 精简结果（移除词级别时间戳）
  const simplified = simplifyAsrResult(result)
}
```

### 结果精简逻辑

参考旧项目 `lexseekApi/src/services/ai/asr/asrRecord.service.ts` 的实现：

```typescript
/**
 * 精简识别结果（移除词级别时间戳，仅保留句子级别）
 */
function simplifyAsrResult(resJson: any): any {
  return {
    file_url: resJson.file_url,
    properties: resJson.properties,
    transcripts: resJson.transcripts.map((item: any) => ({
      channel_id: item.channel_id,
      content_duration_in_milliseconds: item.content_duration_in_milliseconds,
      sentences: item.sentences.map((sentence: any) => ({
        begin_time: sentence.begin_time,
        end_time: sentence.end_time,
        text: sentence.text,
        sentence_id: sentence.sentence_id,
        speaker_id: sentence.speaker_id,
      })),
    })),
  }
}
```

### 加密文件处理

由于项目采用端对端加密，服务端无法解密文件。音频识别需要区分处理：

#### 未加密文件
服务端直接生成 OSS 签名 URL 提交识别：

```typescript
import { generateSignedUrlService } from '../storage/storage.service'

// 生成签名 URL（2 小时有效期）
const signedUrl = await generateSignedUrlService(ossFile.filePath, {
  expires: 7200,  // 音频转录可能需要较长时间
})
```

#### 加密文件处理流程

加密文件需要前端解密后上传到临时目录：

```
┌─────────────────────────────────────────────────────────────┐
│                  加密音频文件识别流程                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ 检测文件加密状态 │───▶│ encrypted: true  │               │
│  └─────────────────┘    └────────┬─────────┘               │
│                                  │                          │
│                                  ▼                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              前端下载加密文件                        │   │
│  │   使用 file.url 下载 .age 加密文件                 │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              前端解密文件                            │   │
│  │   使用 useFileDecryption / useAgeCrypto 解密       │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              获取临时上传签名                        │   │
│  │   POST /api/v1/recognition/audio/temp-upload       │   │
│  │   返回临时目录上传签名（不创建 ossFiles 记录）      │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              前端直传解密后音频到 OSS               │   │
│  │   目录：temp/asr/{年}/{月}/{日}/{uuid}.{ext}       │   │
│  │   使用 useFileUploadWorker 上传                    │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              提交识别任务                            │   │
│  │   POST /api/v1/recognition/audio                   │   │
│  │   { ossFileId, tempFilePath }                      │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              识别完成后清理临时文件                  │   │
│  │   服务端删除 temp/asr/... 中的临时文件             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 临时文件上传 API

```typescript
// POST /api/v1/recognition/audio/temp-upload
// 请求体
{
  ossFileId: number,      // 原始加密文件的 OSS 文件 ID
  fileName: string,       // 原始文件名（用于获取扩展名）
  fileSize: number,       // 解密后文件大小
  mimeType: string,       // 音频 MIME 类型
}

// 响应
{
  code: 0,
  data: {
    // OSS 直传签名（与现有 presigned-url API 格式一致）
    host: string,
    policy: string,
    signature: string,
    key: string,           // temp/asr/{年}/{月}/{日}/{uuid}.{ext}
    // ... 其他签名字段
  }
}
```

#### 临时文件存储规则

- **目录格式**：`temp/asr/{年}/{月}/{日}/{uuid}.{ext}`
- **不创建 ossFiles 记录**：临时文件不占用用户云盘空间
- **不显示在用户云盘**：用户无法看到临时文件
- **识别完成后删除**：无论成功或失败，都删除临时文件
- **定时清理**：可配置定时任务清理超过 24 小时的临时文件（兜底机制）

#### 修改后的音频识别 API

```typescript
// POST /api/v1/recognition/audio
// 请求体
{
  ossFileId: number,           // OSS 文件 ID
  tempFilePath?: string,       // 临时文件路径（加密文件解密后上传的路径）
  options?: {
    languageHints?: string[],
    diarizationEnabled?: boolean
  }
}
```

#### 前端 useAudioRecognition 扩展

```typescript
// useAudioRecognition.ts 新增方法

/**
 * 获取临时文件上传签名
 */
const getTempUploadSignature = async (params: {
  ossFileId: number,
  fileName: string,
  fileSize: number,
  mimeType: string,
}): Promise<TempUploadSignature | null> => {
  return await useApiFetch('/api/v1/recognition/audio/temp-upload', {
    method: 'POST',
    body: params,
  })
}

/**
 * 提交加密音频识别任务
 * 
 * 1. 下载加密文件
 * 2. 解密文件
 * 3. 获取临时上传签名
 * 4. 上传解密后的文件到临时目录
 * 5. 提交识别任务
 */
const submitEncryptedAudioRecognition = async (
  file: OssFileItem,
  options?: AsrSubmitOptions
): Promise<SubmitRecognitionResponse | null> => {
  // 实现流程...
}
```

### 现有组件复用

音频可视化组件已实现于 `app/components/general/audio/AudioVisualization.vue`，支持：

- **音频播放器**：播放/暂停、进度控制、音量调节
- **ASR 对话记录**：多说话人支持、时间同步高亮、点击跳转
- **说话人编辑**：点击头像编辑说话人姓名
- **键盘快捷键**：空格播放/暂停、方向键导航
- **全屏模式**：沉浸式音频分析体验
- **文档下载**：打包下载音频和识别结果

```vue
<template>
  <AudioVisualization 
    :asr-data="asrData"
    :audio-url="audioUrl"
    :material-title="materialTitle"
    :asr-record-id="asrRecordId"
    @speaker-updated="handleSpeakerUpdated"
  />
</template>
```

**ASR 数据格式**（与组件兼容）：
```typescript
interface AsrData {
  id: number;
  status: number;  // 0-待处理, 1-处理中, 2-成功, 3-失败
  result: Array<{
    text: string;
    begin_time: number;   // 毫秒
    end_time: number;     // 毫秒
    speaker_id: number;
    sentence_id: number;
  }>;
  audioDuration: number;  // 毫秒
  speakers: Array<{
    id: number;
    name: string;
  }>;
}
```

### 音频识别流程

```
┌─────────────────────────────────────────────────────────────┐
│                      音频识别流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ 客户端上传音频   │───▶│ 上传到 OSS       │               │
│  │ 文件             │    │ 获取 ossFileId   │               │
│  └─────────────────┘    └────────┬─────────┘               │
│                                  │                          │
│                                  ▼                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              提交到服务端 API                        │   │
│  │   POST /api/v1/recognition/audio                   │   │
│  │   { ossFileId, options }                           │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌──────────────────┐    ┌───────────────┐                 │
│  │ 生成签名 URL      │───▶│ 创建 ASR 任务  │                 │
│  │ (2小时有效期)     │    │ 和识别记录     │                 │
│  └──────────────────┘    └───────────────┘                 │
│                                  │                          │
│                                  ▼                          │
│              ┌─────────────────────────────────────┐       │
│              │     DashScope REST API 调用         │       │
│              │   POST /services/audio/asr/...     │       │
│              │   model: paraformer-v2             │       │
│              │   X-DashScope-Async: enable        │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │     轮询任务状态（指数退避）          │       │
│              │   GET /tasks/{taskId}              │       │
│              │   初始 5s，最大 5min，最多 30 次    │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │     下载转录结果 JSON               │       │
│              │   transcription_url                │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │     精简结果 + 上传原始 JSON        │       │
│              │   移除词级别时间戳                  │       │
│              │   保留句子级别 + 说话人信息         │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │     保存识别结果 + 扣减积分         │       │
│              │   按分钟计费（asr_transcribe）      │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │        向量化嵌入（待实现）          │       │
│              │   (embedAudioService)              │       │
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
- DOCX 浏览器端识别
- 图像识别（豆包多模态方案）
- 音频识别（服务层、API、前端集成）
- 案件创建增强（支持同时添加材料）
- 文本材料向量化嵌入（自动触发、异步处理）

### 待实现

无

## 案件创建增强设计

### 概述

增强案件创建功能，支持在创建案件时同时添加案件材料（文本内容、文档、图片、音频）。使用数据库事务确保案件和材料创建的原子性。

### 材料类型

```typescript
/**
 * 案件材料类型枚举
 */
export enum CaseMaterialType {
  /** 文本内容 */
  CASE_CONTENT = 1,
  /** 文档 */
  DOCUMENT = 2,
  /** 图片 */
  IMAGE = 3,
  /** 音频 */
  AUDIO = 4,
}

/**
 * 案件材料参数接口
 */
export interface CaseMaterialParam {
  /** 材料类型 */
  type: CaseMaterialType
  /** 材料名称（可选，默认使用文件名） */
  name?: string
  /** 文本内容（type=CASE_CONTENT 时必填） */
  content?: string
  /** OSS 文件 ID（type!=CASE_CONTENT 时必填） */
  ossFileId?: number
  /** 材料分组（可选） */
  materialGroup?: string
}
```

### API 设计

#### 请求参数

```typescript
// POST /api/v1/case/create
{
  title?: string,              // 案件标题（可选）
  content?: string,            // 案件内容（可选）
  caseTypeId: number,          // 案件类型 ID（必填）
  plaintiff?: PartyInfo[],     // 原告信息（可选）
  defendant?: PartyInfo[],     // 被告信息（可选）
  materials?: CaseMaterialParam[]  // 案件材料（可选）
}
```

#### 响应格式

```typescript
{
  code: 0,
  message: '创建案件成功',
  data: {
    caseId: number,
    sessionId: string,
    case: { /* 案件信息 */ },
    session: { /* 会话信息 */ }
  }
}
```

### 验证规则

1. **材料类型验证**：
   - 材料类型必须是 1-4 之间的整数
   - 对应 CASE_CONTENT、DOCUMENT、IMAGE、AUDIO

2. **文本材料验证**：
   - type = CASE_CONTENT 时，content 字段必填
   - name 可选，默认为"案情描述"

3. **文件材料验证**：
   - type != CASE_CONTENT 时，ossFileId 字段必填
   - 验证 OSS 文件存在
   - 验证文件属于当前用户（权限检查）
   - name 可选，默认使用文件名

### 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                    案件创建增强流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ 客户端提交请求   │───▶│ API 参数验证     │               │
│  │ (案件+材料)      │    │ (Zod Schema)     │               │
│  └─────────────────┘    └────────┬─────────┘               │
│                                  │                          │
│                                  ▼                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              材料参数验证                            │   │
│  │   - 验证材料类型（1-4）                             │   │
│  │   - 文本材料：验证 content 存在                     │   │
│  │   - 文件材料：验证 ossFileId 存在                   │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              开启数据库事务                          │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              创建案件记录                            │   │
│  │   (case.service.ts → case.dao.ts)                  │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              创建会话记录                            │   │
│  │   (生成 sessionId)                                  │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              批量创建材料记录                        │   │
│  │   (caseMaterial.service.ts)                        │   │
│  │   - 验证 OSS 文件权限                               │   │
│  │   - 构建材料数据                                    │   │
│  │   - 批量插入数据库                                  │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              提交事务                                │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              返回完整结果                            │   │
│  │   { caseId, sessionId, case, session }             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 服务层设计

#### caseMaterial.service.ts

```typescript
/**
 * 批量添加案件材料
 * 
 * @param caseId 案件 ID
 * @param userId 用户 ID
 * @param materials 材料参数列表
 * @param tx 事务对象（可选）
 */
export async function batchAddCaseMaterialsService(
  caseId: number,
  userId: number,
  materials: CaseMaterialParam[],
  tx?: any
): Promise<void>
```

**职责**：
1. 遍历材料参数列表
2. 对于文本材料：直接构建材料数据
3. 对于文件材料：
   - 查询 OSS 文件记录
   - 验证文件存在
   - 验证文件属于当前用户
   - 使用文件名作为默认材料名称
4. 调用 DAO 层批量创建

#### caseMaterial.dao.ts

```typescript
/**
 * 批量添加案件材料
 * 
 * @param caseId 案件 ID
 * @param userId 用户 ID
 * @param materials 材料数据列表
 * @param tx 事务对象（可选）
 */
export async function batchAddCaseMaterialsDAO(
  caseId: number,
  userId: number,
  materials: any[],
  tx?: any
): Promise<void>

/**
 * 查询案件材料
 * 
 * @param caseId 案件 ID
 * @param tx 事务对象（可选）
 */
export async function findByCaseIdDAO(
  caseId: number,
  tx?: any
): Promise<any[]>
```

#### case.service.ts 修改

```typescript
/**
 * 创建案件（增强版）
 * 
 * @param params 创建参数（包含 materials）
 */
export async function createCaseService(params: {
  title?: string
  content: string | null
  userId: number
  caseTypeId: number
  plaintiff?: PartyInfo[]
  defendant?: PartyInfo[]
  materials?: CaseMaterialParam[]  // 新增
}): Promise<CreateCaseResult>
```

**修改要点**：
1. 使用 `prisma.$transaction` 包裹所有操作
2. 创建案件和会话后，调用 `batchAddCaseMaterialsService`
3. 确保事务内所有操作使用同一个事务对象

### 错误处理

1. **参数验证错误**：
   - 材料类型无效 → 400 "无效的材料类型"
   - 文本材料缺少 content → 400 "文本材料必须包含内容"
   - 文件材料缺少 ossFileId → 400 "文件材料必须提供 OSS 文件 ID"

2. **权限错误**：
   - OSS 文件不存在 → 500 "OSS 文件不存在"
   - 文件不属于当前用户 → 500 "无权使用该文件，请检查文件权限"

3. **事务错误**：
   - 任何步骤失败都会回滚整个事务
   - 确保数据一致性

### 相关文件

**类型定义**:
- `shared/types/case.ts` - 添加 `CaseMaterialType` 和 `CaseMaterialParam`

**服务层**:
- `server/services/case/case.service.ts` - 修改 `createCaseService`
- `server/services/case/caseMaterial.service.ts` - 新建，材料业务逻辑
- `server/services/case/caseMaterial.dao.ts` - 新建，材料数据访问

**API 层**:
- `server/api/v1/case/create.post.ts` - 修改，添加材料参数验证

**参考实现（旧项目）**:
- `LexSeek/lexseekApi/src/services/case/case.service.ts` - `createNewCase` 方法
- `LexSeek/lexseekApi/src/services/socket/case.ts` - `handleCreateCase` 方法

### 其他相关文件

**服务层**:
- `server/services/case/*.ts`
- `server/services/material/*.ts`
- `server/services/material/ocr.service.ts` - 图像识别服务（豆包多模态）
- `server/services/material/ocr.dao.ts` - 图像识别 DAO
- `server/services/material/mineruResult.service.ts` - MinerU 结果处理（PDF/DOC）
- `server/services/material/materialEmbedding.service.ts` - 向量化嵌入
- `server/services/material/asr.service.ts` - 音频识别服务（✅ 已实现）
- `server/services/material/asr.dao.ts` - 音频识别 DAO（✅ 已实现）
- `server/services/material/asrTask.service.ts` - ASR 任务服务（✅ 已实现）
- `server/services/material/asrTask.dao.ts` - ASR 任务 DAO（✅ 已实现）
- `server/services/storage/storage.service.ts` - 存储服务（签名 URL 生成）

**API 层**:
- `server/api/v1/case/*.ts`
- `server/api/v1/recognition/*.ts`
- `server/api/v1/callback/mineru-batch.post.ts` - MinerU 回调
- `server/api/v1/recognition/audio/*.ts` - 音频识别 API（待实现，用户端）
- `server/api/v1/admin/asr-tasks/*.ts` - ASR 任务管理 API（✅ 已实现，后台管理）

**前端**:
- `app/pages/dashboard/analysis/*.vue`
- `app/pages/admin/asr-tasks/index.vue` - ASR 任务管理页面（✅ 已实现，后台管理）
- `app/composables/useDocxRecognition.ts`
- `app/composables/useMineruRecognition.ts`
- `app/composables/useAudioRecognition.ts` - 音频识别（待实现）
- `app/components/general/audio/AudioVisualization.vue` - 音频可视化组件（✅ 已实现）
- `app/components/general/audio/AudioPlayer.vue` - 音频播放器组件（✅ 已实现）

**数据模型**:
- `prisma/models/recognition.prisma` - 识别记录表（docRecognitionRecords, imageRecognitionRecords, asrTasks, asrRecords）

**参考实现（旧项目）**:
- `LexSeek/lexseekApi/src/services/ai/asr/asrRecord.service.ts` - 结果精简逻辑参考

### 后台管理兼容性

后台已有 ASR 任务管理功能（`/admin/asr-tasks`），包括：
- 任务列表查询（分页、筛选）
- 任务详情查看
- 单个/批量查询任务状态
- 失败任务重试

**注意事项**：
1. 模型管理集成时，需要同时更新 `asrTask.service.ts` 中的 `queryAsrTaskStatusService` 和 `retryAsrTaskService` 函数
2. 新的用户端 API（`/api/v1/recognition/audio/*`）与后台管理 API（`/api/v1/admin/asr-tasks/*`）共用服务层
3. 数据结构保持一致，确保后台管理页面正常工作


## 文本材料向量化嵌入设计

### 概述

为 CASE_CONTENT 类型的材料提供向量化嵌入功能，支持语义搜索和相关性匹配。

### 向量化服务接口

```typescript
/**
 * 文本材料向量化服务
 */
interface TextMaterialEmbeddingService {
  /**
   * 为单个文本材料生成向量嵌入
   * @param materialId 材料 ID
   * @param userId 用户 ID
   */
  embedTextMaterialService(materialId: number, userId: number): Promise<EmbeddingResult>;
  
  /**
   * 批量为文本材料生成向量嵌入
   * @param materialIds 材料 ID 列表
   * @param userId 用户 ID
   */
  batchEmbedTextMaterialsService(materialIds: number[], userId: number): Promise<BatchEmbeddingResult>;
}

// 嵌入结果
interface EmbeddingResult {
  success: boolean;
  materialId: number;
  embeddingId?: number;
  error?: string;
}

// 批量嵌入结果
interface BatchEmbeddingResult {
  total: number;
  success: number;
  failed: number;
  results: EmbeddingResult[];
}
```

### 向量化流程

```
┌─────────────────────────────────────────────────────────────┐
│                  文本材料向量化流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ 创建文本材料     │───▶│ 保存到数据库     │               │
│  │ (CASE_CONTENT)  │    │ caseMaterials    │               │
│  └─────────────────┘    └────────┬─────────┘               │
│                                  │                          │
│                                  ▼                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              触发向量化任务（异步）                  │   │
│  │   embedTextMaterialService(materialId, userId)     │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌──────────────────┐    ┌───────────────┐                 │
│  │ 查询材料内容      │───▶│ 验证材料类型   │                 │
│  │ (content 字段)   │    │ (CASE_CONTENT) │                 │
│  └──────────────────┘    └───────────────┘                 │
│                                  │                          │
│                                  ▼                          │
│              ┌─────────────────────────────────────┐       │
│              │     调用嵌入模型 API                 │       │
│              │   (通过 materialEmbedding.service)  │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │     生成向量（1536 维）              │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │     保存到 materialEmbeddings       │       │
│              │   - materialId                     │       │
│              │   - materialType: 'text'           │       │
│              │   - embedding (vector)             │       │
│              │   - userId                         │       │
│              └────────────────┬────────────────────┘       │
│                               │                            │
│                               ▼                            │
│              ┌─────────────────────────────────────┐       │
│              │     更新材料状态                     │       │
│              │   embeddingStatus: 'completed'     │       │
│              └─────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 数据模型

#### caseMaterials 表扩展

```sql
-- 添加向量化状态字段
ALTER TABLE case_materials ADD COLUMN embedding_status VARCHAR(20) DEFAULT 'pending';
-- 可能的值：'pending', 'processing', 'completed', 'failed'
```

#### materialEmbeddings 表

```sql
-- 已存在的表，用于存储向量
CREATE TABLE material_embeddings (
  id SERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL,
  material_type VARCHAR(50) NOT NULL,  -- 'text', 'document', 'image', 'audio'
  embedding vector(1536) NOT NULL,     -- 向量数据
  user_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 服务层实现

#### 新增服务方法

在 `server/services/material/materialEmbedding.service.ts` 中添加：

```typescript
/**
 * 为文本材料生成向量嵌入
 * 
 * @param materialId 材料 ID
 * @param userId 用户 ID
 */
export async function embedTextMaterialService(
  materialId: number,
  userId: number
): Promise<EmbeddingResult> {
  try {
    // 1. 查询材料
    const material = await prisma.caseMaterials.findUnique({
      where: { id: materialId },
    })
    
    if (!material) {
      throw new Error('材料不存在')
    }
    
    if (material.type !== CaseMaterialType.CASE_CONTENT) {
      throw new Error('只能为文本材料生成向量')
    }
    
    if (!material.content) {
      throw new Error('材料内容为空')
    }
    
    // 2. 更新状态为处理中
    await prisma.caseMaterials.update({
      where: { id: materialId },
      data: { embeddingStatus: 'processing' },
    })
    
    // 3. 调用嵌入模型
    const embedding = await generateEmbedding(material.content)
    
    // 4. 保存向量
    const embeddingRecord = await prisma.materialEmbeddings.create({
      data: {
        materialId,
        materialType: 'text',
        embedding,
        userId,
      },
    })
    
    // 5. 更新状态为完成
    await prisma.caseMaterials.update({
      where: { id: materialId },
      data: { embeddingStatus: 'completed' },
    })
    
    return {
      success: true,
      materialId,
      embeddingId: embeddingRecord.id,
    }
  } catch (error) {
    // 更新状态为失败
    await prisma.caseMaterials.update({
      where: { id: materialId },
      data: { embeddingStatus: 'failed' },
    })
    
    return {
      success: false,
      materialId,
      error: error.message,
    }
  }
}

/**
 * 批量为文本材料生成向量嵌入
 * 
 * @param materialIds 材料 ID 列表
 * @param userId 用户 ID
 */
export async function batchEmbedTextMaterialsService(
  materialIds: number[],
  userId: number
): Promise<BatchEmbeddingResult> {
  const results: EmbeddingResult[] = []
  
  for (const materialId of materialIds) {
    const result = await embedTextMaterialService(materialId, userId)
    results.push(result)
  }
  
  const success = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  
  return {
    total: materialIds.length,
    success,
    failed,
    results,
  }
}
```

### 集成到案件创建流程

在 `server/services/case/case.service.ts` 中，创建材料后触发向量化：

```typescript
// 创建材料（包含从 content 转换的材料）
if (materials.length > 0) {
  await batchAddCaseMaterialsService(
    caseRecord.id,
    data.userId,
    materials,
    tx as any
  )
  
  // 获取创建的材料 ID
  const createdMaterials = await findByCaseIdDAO(caseRecord.id, tx as any)
  
  // 异步触发文本材料向量化（不阻塞事务）
  const textMaterialIds = createdMaterials
    .filter(m => m.type === CaseMaterialType.CASE_CONTENT)
    .map(m => m.id)
  
  if (textMaterialIds.length > 0) {
    // 使用 Promise.resolve 确保异步执行
    Promise.resolve().then(() => {
      batchEmbedTextMaterialsService(textMaterialIds, data.userId)
        .catch(error => {
          logger.error('文本材料向量化失败', { error, materialIds: textMaterialIds })
        })
    })
  }
}
```

### API 端点（可选）

如果需要手动触发向量化或查询向量化状态：

```typescript
// POST /api/v1/material/[id]/embed
// 手动触发材料向量化

// GET /api/v1/material/[id]/embedding
// 查询材料向量化状态和结果
```

### 错误处理

1. **材料不存在**：返回错误，不创建向量
2. **材料类型错误**：只处理 CASE_CONTENT 类型
3. **内容为空**：返回错误，标记为失败
4. **嵌入模型调用失败**：标记为失败，支持重试
5. **向量保存失败**：标记为失败，记录错误日志

### 性能优化

1. **异步处理**：向量化不阻塞案件创建流程
2. **批量处理**：支持批量向量化以提高效率
3. **失败重试**：支持手动或自动重试失败的向量化任务
4. **缓存机制**：相同内容的向量可以复用（可选）

### 监控和日志

1. **向量化成功率**：统计成功/失败的向量化任务
2. **处理时间**：记录向量化耗时
3. **错误日志**：记录失败原因和堆栈信息
4. **用户通知**：向量化完成后可选通知用户（可选）

## 前端页面对接新版创建案件 API 设计

### 概述

修改前端案件分析页面（`app/pages/dashboard/analysis/index.vue` 和 `app/components/caseAnalysis/promptInput.vue`），对接新版创建案件 API，支持同时提交文本内容和文件材料。

### 现有实现分析

#### 当前流程

1. 用户在 `promptInput.vue` 中输入案情信息和选择材料
2. 点击"法索一下"按钮提交
3. 调用 `POST /api/v1/case/create` 创建案件（仅传递 `title`、`content`、`caseTypeId`）
4. 将材料数据存储到 `sessionStorage`
5. 跳转到分析页面 `/dashboard/analysis/[sessionId]`

#### 存在的问题

1. **材料未同步创建**：材料数据仅存储在 `sessionStorage`，未保存到数据库
2. **数据不一致**：案件创建成功但材料未关联，导致数据不完整
3. **无法利用向量化**：材料未保存到数据库，无法进行向量化嵌入

### 新版 API 对接方案

#### API 调用修改

修改 `promptInput.vue` 中的 `handleSubmit` 方法，调用新版 API：

```typescript
/**
 * 处理提交
 * 创建案件和材料，然后跳转到分析页面
 */
async function handleSubmit(message: PromptInputMessage) {
  const hasText = !!message.text?.trim();
  const hasAttachments = selectedFiles.value.length > 0;

  // 验证：必须有文本或附件
  if (!hasText && !hasAttachments) {
    toast.warning("请输入案情信息或选择案情材料");
    return;
  }

  // 检查是否有正在识别的文件
  const recognizingFiles = selectedFiles.value.filter(f => {
    const isRecognizable = isRecognizableDocFile(f.fileName) || isImageFile(f.fileName) || isAudioFile(f.fileName);
    return isRecognizable && getRecognitionStatus(f.id) === 'recognizing';
  });
  if (recognizingFiles.length > 0) {
    toast.warning("请等待文件识别完成后再提交");
    return;
  }

  status.value = "submitted";

  try {
    // 生成案件标题
    const title = message.text?.trim() 
      ? message.text.trim().slice(0, 50) + (message.text.trim().length > 50 ? "..." : "") 
      : selectedFiles.value[0]?.fileName || "新案件";

    // 构建材料参数
    const materials: CaseMaterialParam[] = selectedFiles.value.map(file => {
      // 根据 MIME 类型确定材料类型
      const materialType = getMaterialType(file.fileType);
      
      return {
        type: materialType,
        name: file.fileName,
        ossFileId: file.id,
      };
    });

    // 调用新版创建案件 API
    const createResult = await useApiFetch<{
      caseId: number;
      sessionId: string;
    }>("/api/v1/case/create", {
      method: "POST",
      body: {
        title,
        content: message.text?.trim() || undefined,  // content 会被转换为 CASE_CONTENT 材料
        caseTypeId: 1, // 默认案件类型
        materials,  // 文件材料列表
      },
    });

    if (!createResult) {
      throw new Error("创建案件失败");
    }

    // 提交成功后清空已选文件列表和识别状态
    selectedFiles.value = [];
    fileRecognitionStatus.value.clear();

    // 跳转到分析页面
    await router.push(`/dashboard/analysis/${createResult.sessionId}`);
  } catch (error) {
    status.value = "error";
    const errorMessage = error instanceof Error ? error.message : "提交失败";
    toast.error(errorMessage);

    // 3 秒后恢复状态
    setTimeout(() => {
      status.value = "ready";
    }, 3000);
  }
}

/**
 * 根据 MIME 类型获取材料类型
 */
function getMaterialType(mimeType: string): CaseMaterialType {
  // 图片类型
  if (isImageType(mimeType)) {
    return CaseMaterialType.IMAGE;
  }
  
  // 音频类型
  if (isAudioType(mimeType)) {
    return CaseMaterialType.AUDIO;
  }
  
  // 文档类型（包括 PDF、Word、文本等）
  // 默认为文档类型
  return CaseMaterialType.DOCUMENT;
}
```

#### 类型导入

在 `promptInput.vue` 中添加类型导入：

```typescript
import type { CaseMaterialParam } from '#shared/types/case'
import { CaseMaterialType } from '#shared/types/case'
```

**注意**：工具函数 `isImageType` 和 `isAudioType` 已在 `app/utils/file.ts` 中定义，会自动导入，无需手动 import。

#### 移除 sessionStorage 逻辑

由于材料已在创建案件时同步保存到数据库，不再需要通过 `sessionStorage` 传递材料数据：

```typescript
// ❌ 删除以下代码
const materialData = {
  text: message.text?.trim() || "",
  fileIds: selectedFiles.value.map((f) => f.id),
  files: selectedFiles.value.map((f) => ({
    id: f.id,
    fileName: f.fileName,
    fileType: f.fileType,
    fileSize: f.fileSize,
    encrypted: f.encrypted,
  })),
};
sessionStorage.setItem(`analysis_materials_${createResult.sessionId}`, JSON.stringify(materialData));
```

### 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                  前端对接新版 API 流程                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ 用户输入案情     │───▶│ 选择材料文件     │               │
│  │ 信息             │    │ (文档/图片/音频) │               │
│  └─────────────────┘    └────────┬─────────┘               │
│                                  │                          │
│                                  ▼                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              触发文件识别                            │   │
│  │   - 文档识别（docx、pdf、md、txt）                  │   │
│  │   - 图像识别（png、jpg、jpeg、gif、webp 等）        │   │
│  │   - 音频识别（mp3、wav、m4a、aac 等）              │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              等待识别完成                            │   │
│  │   - 显示识别状态徽章（识别中/已识别/重试）          │   │
│  │   - 识别中的文件不允许提交                          │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              点击"法索一下"按钮                      │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              前端验证                                │   │
│  │   - 检查是否有文本或材料（至少一个）                │   │
│  │   - 检查文件识别状态（不允许识别中的文件）          │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              构建 API 请求参数                       │   │
│  │   - title: 案件标题（自动生成或使用文本前 50 字）   │   │
│  │   - content: 案情文本内容（可选）                   │   │
│  │   - caseTypeId: 案件类型 ID（默认 1）              │   │
│  │   - materials: 材料列表                             │   │
│  │     * type: 根据文件扩展名确定材料类型              │   │
│  │     * name: 文件名                                  │   │
│  │     * ossFileId: OSS 文件 ID                        │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              调用新版创建案件 API                    │   │
│  │   POST /api/v1/case/create                         │   │
│  │   { title, content, caseTypeId, materials }        │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              服务端处理                              │   │
│  │   - 创建案件记录                                    │   │
│  │   - 创建会话记录                                    │   │
│  │   - 将 content 转换为 CASE_CONTENT 材料             │   │
│  │   - 批量创建文件材料记录                            │   │
│  │   - 触发文本材料向量化（异步）                      │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              返回创建结果                            │   │
│  │   { caseId, sessionId, case, session }             │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              前端处理响应                            │   │
│  │   - 清空已选文件列表                                │   │
│  │   - 清空识别状态                                    │   │
│  │   - 跳转到分析页面                                  │   │
│  │     /dashboard/analysis/[sessionId]                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 错误处理

#### 前端验证错误

1. **未输入内容和材料**：
   ```typescript
   toast.warning("请输入案情信息或选择案情材料");
   ```

2. **文件识别中**：
   ```typescript
   toast.warning("请等待文件识别完成后再提交");
   ```

#### API 调用错误

1. **网络错误**：
   - `useApiFetch` 自动处理并显示错误提示
   - 设置 `status.value = "error"`
   - 3 秒后恢复为 `ready` 状态

2. **服务器错误**：
   - 显示服务器返回的错误信息
   - 例如："案件类型不存在"、"OSS 文件不存在"、"无权使用该文件"

3. **参数验证错误**：
   - 显示具体的验证错误信息
   - 例如："材料类型无效"、"文本材料必须包含内容"

### 文件类型映射

项目中已在 `shared/utils/file.ts` 定义了允许上传的文件类型：

```typescript
// 语音识别允许的文件类型
export const ASR_ACCEPT = {
  m4a: 200 * 1024 * 1024,
  mp3: 200 * 1024 * 1024,
  wav: 500 * 1024 * 1024,
}

// 文档识别允许的文件类型
export const DOC_ACCEPT = {
  pdf: 50 * 1024 * 1024,
  md: 20 * 1024 * 1024,
  mkd: 20 * 1024 * 1024,
  txt: 1 * 1024 * 1024,
  docx: 20 * 1024 * 1024,
  doc: 20 * 1024 * 1024
}

// 图片识别允许的文件类型
export const IMAGE_ACCEPT = {
  png: 10 * 1024 * 1024,
  jpg: 10 * 1024 * 1024,
  jpeg: 10 * 1024 * 1024,
  gif: 10 * 1024 * 1024,
  webp: 10 * 1024 * 1024,
  heic: 10 * 1024 * 1024,
  heif: 10 * 1024 * 1024
}
```

**材料类型映射规则**：

| MIME 类型判断 | 材料类型 | 枚举值 | 对应配置 |
|--------------|---------|--------|---------|
| `isImageType(mimeType)` | IMAGE | 3 | `IMAGE_ACCEPT` |
| `isAudioType(mimeType)` | AUDIO | 4 | `ASR_ACCEPT` |
| 其他 | DOCUMENT | 2 | `DOC_ACCEPT` |

**判断逻辑**：
- 使用项目中已有的 `isImageType(mimeType)` 判断图片（自动支持 `IMAGE_ACCEPT` 中的所有格式）
- 使用项目中已有的 `isAudioType(mimeType)` 判断音频（自动支持 `ASR_ACCEPT` 中的所有格式）
- 其他类型默认为文档类型（对应 `DOC_ACCEPT` 中的格式）

**注意**：无需手动维护文件类型列表，项目中的配置会自动通过 MIME 类型判断生效。

### 识别状态检查

在提交前检查文件识别状态，确保所有需要识别的文件都已完成识别：

```typescript
// 检查是否有正在识别的文件
const recognizingFiles = selectedFiles.value.filter(f => {
  const isRecognizable = isRecognizableDocFile(f.fileName) || isImageFile(f.fileName) || isAudioFile(f.fileName);
  return isRecognizable && getRecognitionStatus(f.id) === 'recognizing';
});

if (recognizingFiles.length > 0) {
  toast.warning("请等待文件识别完成后再提交");
  return;
}
```

### 用户体验优化

1. **提交状态反馈**：
   - 提交中：按钮显示加载状态，禁用输入
   - 成功：自动跳转到分析页面
   - 失败：显示错误提示，3 秒后恢复输入状态

2. **识别状态可视化**：
   - 识别中：显示蓝色徽章 + 加载动画
   - 已识别：显示绿色徽章 + 对勾图标
   - 识别失败：显示红色徽章 + 重试按钮

3. **文件预览**：
   - 点击文件卡片可预览识别结果
   - 仅已识别成功的文件可预览
   - 支持文档、图片和音频预览

### 相关文件

**前端组件**:
- `app/components/caseAnalysis/promptInput.vue` - 主要修改文件
- `app/pages/dashboard/analysis/index.vue` - 案件分析首页
- `app/pages/dashboard/analysis/[sessionId].vue` - 案件分析详情页

**类型定义**:
- `shared/types/case.ts` - 导入 `CaseMaterialParam` 和 `CaseMaterialType`

**API 接口**:
- `server/api/v1/case/create.post.ts` - 新版创建案件 API

**Composables**:
- `app/composables/useDocxRecognition.ts` - 文档识别
- `app/composables/useImageRecognition.ts` - 图像识别
- `app/composables/useAudioRecognition.ts` - 音频识别


## 图片识别记录创建时机修复

### 概述

本设计修复图片识别记录创建时机问题，使其与音频识别和 MinerU 识别保持一致。当前图片识别在提交时就创建识别记录，失败时不删除，导致数据库中留下失败记录。修复后，只在识别成功时才创建记录。

**参考实现**：音频识别的 `completeTranscriptionService` 方法（`server/services/material/asr.service.ts`）

### 架构

#### 当前流程（存在问题）

```
1. 接收识别请求
2. 验证图片类型
3. ❌ 立即创建识别记录（status: PROCESSING）
4. 调用 AI 服务识别
5. 如果成功：
   - 更新识别记录（status: COMPLETED）
   - 触发向量化嵌入
6. 如果失败：
   - ❌ 识别记录仍然存在（status: PROCESSING）
   - ❌ 数据库被污染
```

#### 修复后流程（正确）

```
1. 接收识别请求
2. 验证图片类型
3. 检查是否已有识别记录
   - 如果有成功记录：直接返回
   - 如果有失败/处理中记录：软删除旧记录
4. 调用 AI 服务识别
5. 如果成功：
   - ✅ 创建识别记录（status: COMPLETED）
   - 触发向量化嵌入
   - 更新 case_materials 的 embedding_status
6. 如果失败：
   - ✅ 不创建识别记录
   - 返回错误信息
```

### 组件和接口

#### 修改的服务方法

**`createImageRecognitionByBase64Service`** (`server/services/material/ocr.service.ts`)

```typescript
/**
 * 通过 base64 数据创建图片识别记录
 * 
 * 修复：只在识别成功后才创建识别记录
 * 参考：ASR 的 completeTranscriptionService 方法
 * 
 * @param base64Data 图片 base64 数据（不含前缀）
 * @param mimeType 图片 MIME 类型
 * @param ossFileId 关联的 OSS 文件 ID
 * @param userId 用户 ID
 * @param tx 事务客户端（可选）
 * @returns 识别结果
 */
export async function createImageRecognitionByBase64Service(
    base64Data: string,
    mimeType: string,
    ossFileId: number,
    userId: number,
    tx?: Prisma.TransactionClient
): Promise<OcrResult>
```

**修改要点**：

1. **检查现有记录**（在识别前）
   ```typescript
   // 检查是否已有识别记录
   const existingRecord = await findImageRecognitionByOssFileIdDao(ossFileId, tx)
   if (existingRecord) {
       // 如果已有成功的识别记录，直接返回
       if (existingRecord.status === ImageRecognitionStatus.COMPLETED) {
           return { record: existingRecord, success: true }
       }
       
       // 如果是失败或处理中的记录，删除旧记录，重新识别
       await (tx || prisma).imageRecognitionRecords.update({
           where: { id: existingRecord.id },
           data: { deletedAt: new Date() }
       })
   }
   

2. **先识别，后创建记录**
   ```typescript
   // 1. 验证 OSS 文件
   const ossFile = await (tx || prisma).ossFiles.findFirst(...)
   
   // 2. 调用 AI 服务识别（可能失败）
   const extractResult = await extractImageInfoByBase64(base64Data, mimeType)
   
   // 3. 转换 Markdown 为 HTML
   const htmlContent = await markdownToHtml(extractResult.imageInfo)
   
   // 4. ✅ 只在识别成功后才创建记录
   const record = await createImageRecognitionRecordDao({
       userId,
       ossFileId,
       status: ImageRecognitionStatus.COMPLETED, // 直接设置为 COMPLETED
       imageType: extractResult.imgType,
       htmlContent,
       markdownContent: extractResult.imageInfo,
   }, tx)
   ```

3. **向量化嵌入逻辑保持不变**
   ```typescript
   // 向量化处理（失败不影响识别结果）
   try {
       const embeddingResult = await embedImageService(...)
       await updateImageRecognitionRecordDao(record.id, {
           vectorIds: embeddingResult.ids,
           lastEmbeddingAt: new Date(embeddingResult.lastEmbeddingAt),
       }, tx)
       
       // 更新 case_materials 的 embedding_status
       const materials = await findMaterialsByOssFileIdDAO(ossFileId, tx)
       for (const material of materials) {
           await updateMaterialEmbeddingStatusDAO(material.id, 'completed', tx)
       }
   } catch (embedError) {
       // 向量化失败只记录警告，不影响识别结果
       logger.warn('图片向量化失败，但识别结果已保存', { ossFileId, error: embedError.message })
       
       // 更新 case_materials 的 embedding_status 为 failed
       const materials = await findMaterialsByOssFileIdDAO(ossFileId, tx)
       for (const material of materials) {
           await updateMaterialEmbeddingStatusDAO(material.id, 'failed', tx)
       }
   }
   ```

4. **识别失败时不创建记录**
   ```typescript
   } catch (error: any) {
       logger.error('创建图片识别记录失败（base64）', {
           ossFileId,
           userId,
           mimeType,
           error: error.message,
       })
       
       // ✅ 识别失败时不创建识别记录
       return {
           record: null as any,
           success: false,
           error: error.message,
       }
   }
   ```

#### 不需要修改的部分

1. **API 接口** (`server/api/v1/recognition/image.post.ts`)
   - 接口签名保持不变
   - 响应格式保持不变
   - 错误码保持不变

2. **前端 Composable** (`app/composables/useImageRecognition.ts`)
   - 方法签名保持不变
   - 状态管理逻辑保持不变
   - 错误处理逻辑保持不变

3. **其他服务方法**
   - `createImageConversionService` - 保持不变
   - `createImageRecognitionService` - 保持不变（内部调用 `createImageConversionService`）
   - `updateImageRecognitionService` - 保持不变
   - `findByOssFileIdService` - 保持不变

### 数据模型

#### 识别记录状态

使用现有的 `ImageRecognitionStatus` 枚举（定义在 `shared/types/recognition.ts`）：

```typescript
export enum ImageRecognitionStatus {
    PENDING = 0,      // 待处理（不再使用）
    PROCESSING = 1,   // 处理中（不再使用）
    COMPLETED = 2,    // 已完成（唯一使用的状态）
    FAILED = 3,       // 失败（不再使用）
}
```

**修复后的状态使用**：
- 创建的识别记录直接设置为 `COMPLETED` 状态
- 不再使用 `PENDING`、`PROCESSING`、`FAILED` 状态
- 识别失败时不创建记录，因此不需要 `FAILED` 状态

#### 数据库表

**`image_recognition_records` 表**（无需修改表结构）：

```prisma
model imageRecognitionRecords {
  id                 Int       @id @default(autoincrement())
  userId             Int
  ossFileId          Int       @unique
  status             Int       @default(0)
  imageType          String?   // 'doc' 或 'photo'
  htmlContent        String?   @db.Text
  markdownContent    String?   @db.Text
  vectorIds          Json?     // 向量 ID 列表
  lastEmbeddingAt    DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  deletedAt          DateTime? // 软删除
}
```

**修改后的数据流**：
1. 识别成功 → 创建记录（status: COMPLETED）
2. 识别失败 → 不创建记录
3. 重复识别 → 检查现有记录 → 如果失败则软删除 → 重新识别

### 正确性属性

*属性是一个特征或行为，应该在系统的所有有效执行中保持为真——本质上是关于系统应该做什么的正式声明。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

#### 属性 1：识别成功时创建完整记录

*对于任何*有效的图片数据和 OSS 文件 ID，当识别成功时，应该创建一条识别记录，该记录的 status 为 COMPLETED，且同时包含 markdownContent 和 htmlContent。

**验证：需求 10.1, 10.4, 10.5**

#### 属性 2：识别失败时不创建记录

*对于任何*导致识别失败的输入（无效图片、AI 服务失败、OSS 文件不存在等），识别服务应该返回错误信息，但不在数据库中创建任何识别记录。

**验证：需求 10.2**

#### 属性 3：重复识别的幂等性

*对于任何*已有成功识别记录的 OSS 文件，再次调用识别服务应该直接返回现有记录，而不创建新记录。

**验证：需求 10.6**

#### 属性 4：失败记录的重试机制

*对于任何*已有失败或处理中识别记录的 OSS 文件，再次调用识别服务应该软删除旧记录（设置 deletedAt），然后重新识别并创建新记录。

**验证：需求 10.7, 10.9**

#### 属性 5：向量化成功时的状态更新

*对于任何*识别成功且向量化成功的记录，应该同时更新识别记录的 vectorIds 和 lastEmbeddingAt 字段，以及关联的 case_materials 记录的 embedding_status 字段为 'completed'。

**验证：需求 10.11, 10.13**

#### 属性 6：向量化失败时的容错处理

*对于任何*识别成功但向量化失败的记录，识别结果应该仍然成功返回，同时记录警告日志，并将关联的 case_materials 记录的 embedding_status 字段设置为 'failed'。

**验证：需求 10.12, 10.14**

#### 属性 7：API 响应格式的兼容性

*对于任何*识别请求，API 的响应格式应该与修改前保持一致，成功时返回包含 id、imageType、markdownContent、htmlContent 的记录，失败时返回相同的错误码和错误信息。

**验证：需求 10.16, 10.17, 10.18**

### 错误处理

#### 识别失败场景

1. **图片类型不支持**
   ```typescript
   if (!validateImageType(mimeType)) {
       return {
           record: null as any,
           success: false,
           error: `图片类型 ${mimeType} 不支持识别，支持的类型: ${SUPPORTED_IMAGE_TYPES.join(', ')}`,
       }
   }
   ```

2. **OSS 文件不存在**
   ```typescript
   const ossFile = await (tx || prisma).ossFiles.findFirst({
       where: { id: ossFileId, deletedAt: null },
   })
   if (!ossFile) {
       return {
           record: null as any,
           success: false,
           error: 'OSS 文件不存在',
       }
   }
   ```

3. **AI 服务调用失败**
   ```typescript
   try {
       const extractResult = await extractImageInfoByBase64(base64Data, mimeType)
   } catch (error: any) {
       logger.error('图片识别失败', { error: error.message })
       return {
           record: null as any,
           success: false,
           error: error.message,
       }
   }
   ```

4. **向量化失败**（不影响识别结果）
   ```typescript
   try {
       await embedImageService(...)
   } catch (embedError: any) {
       // 向量化失败只记录警告，不影响识别结果
       logger.warn('图片向量化失败，但识别结果已保存', {
           ossFileId,
           error: embedError.message,
       })
       // 更新 case_materials 的 embedding_status 为 failed
   }
   ```

#### 错误日志

所有错误都应该记录详细的日志信息，包括：
- 错误类型
- 错误消息
- 相关参数（ossFileId、userId、mimeType 等）
- 堆栈跟踪（如果有）

```typescript
logger.error('创建图片识别记录失败（base64）', {
    ossFileId,
    userId,
    mimeType,
    error: error.message,
    stack: error.stack,
})
```

### 测试策略

#### 单元测试

**测试文件**：`tests/server/services/material/ocr.service.test.ts`

**测试用例**：

1. **识别成功场景**
   - 测试识别成功时创建记录
   - 验证记录的 status 为 COMPLETED
   - 验证记录包含 markdownContent 和 htmlContent
   - 验证向量化嵌入被触发

2. **识别失败场景**
   - 测试图片类型不支持时不创建记录
   - 测试 OSS 文件不存在时不创建记录
   - 测试 AI 服务失败时不创建记录
   - 验证返回正确的错误信息

3. **重复识别场景**
   - 测试已有成功记录时直接返回
   - 测试已有失败记录时软删除并重新识别
   - 验证不创建重复记录

4. **向量化场景**
   - 测试向量化成功时更新记录
   - 测试向量化失败时不影响识别结果
   - 验证 case_materials 的 embedding_status 更新

#### 属性测试

使用属性测试验证通用规则（每个测试至少 100 次迭代）：

**测试文件**：`tests/server/services/material/ocr.property.test.ts`

**属性测试用例**：

1. **属性 1：识别成功时创建完整记录**
   ```typescript
   // Feature: 案件分析系统, Property 1: 识别成功时创建完整记录
   test.prop([fc.base64String(), fc.integer()])('识别成功时创建完整记录', async (base64Data, ossFileId) => {
       // 生成随机图片数据和 OSS 文件 ID
       // 调用识别服务
       // 验证创建的记录包含完整信息且状态为 COMPLETED
   })
   ```

2. **属性 2：识别失败时不创建记录**
   ```typescript
   // Feature: 案件分析系统, Property 2: 识别失败时不创建记录
   test.prop([fc.string(), fc.integer()])('识别失败时不创建记录', async (invalidData, ossFileId) => {
       // 生成随机的无效数据
       // 调用识别服务
       // 验证数据库中没有创建记录
   })
   ```

3. **属性 3：重复识别的幂等性**
   ```typescript
   // Feature: 案件分析系统, Property 3: 重复识别的幂等性
   test.prop([fc.base64String(), fc.integer()])('重复识别的幂等性', async (base64Data, ossFileId) => {
       // 第一次识别
       // 第二次识别
       // 验证返回相同的记录 ID，没有创建新记录
   })
   ```

4. **属性 4：失败记录的重试机制**
   ```typescript
   // Feature: 案件分析系统, Property 4: 失败记录的重试机制
   test.prop([fc.base64String(), fc.integer()])('失败记录的重试机制', async (base64Data, ossFileId) => {
       // 创建一个失败的记录
       // 重新识别
       // 验证旧记录被软删除，新记录被创建
   })
   ```

#### 集成测试

**测试文件**：`tests/server/api/recognition/image.integration.test.ts`

**测试用例**：

1. **API 端到端测试**
   - 测试完整的识别流程（从 API 调用到数据库记录）
   - 验证 API 响应格式
   - 验证错误处理

2. **前端集成测试**
   - 测试前端 composable 与 API 的集成
   - 验证状态管理
   - 验证错误提示

### 相关文件

**服务层**：
- `server/services/material/ocr.service.ts` - 主要修改文件
- `server/services/material/ocr.dao.ts` - DAO 层（无需修改）
- `server/services/material/materialEmbedding.service.ts` - 向量化服务（无需修改）
- `server/services/case/caseMaterial.dao.ts` - 案件材料 DAO（无需修改）

**API 接口**：
- `server/api/v1/recognition/image.post.ts` - 图片识别 API（无需修改）

**前端**：
- `app/composables/useImageRecognition.ts` - 图片识别 composable（无需修改）

**类型定义**：
- `shared/types/recognition.ts` - 识别状态枚举（无需修改）

**测试文件**：
- `tests/server/services/material/ocr.service.test.ts` - 单元测试（新建）
- `tests/server/services/material/ocr.property.test.ts` - 属性测试（新建）
- `tests/server/api/recognition/image.integration.test.ts` - 集成测试（新建）

### 实施计划

1. **阶段 1：修改服务层**
   - 修改 `createImageRecognitionByBase64Service` 方法
   - 调整识别记录创建时机
   - 保持向量化嵌入逻辑不变

2. **阶段 2：编写测试**
   - 编写单元测试
   - 编写属性测试
   - 编写集成测试

3. **阶段 3：验证和部署**
   - 运行所有测试确保通过
   - 验证 API 兼容性
   - 验证前端功能正常
   - 部署到生产环境

### 风险和注意事项

1. **数据迁移**
   - 现有的失败记录不会自动清理
   - 建议在部署后手动清理失败的识别记录

2. **向后兼容性**
   - API 接口保持不变，确保前端无需修改
   - 前端 composable 保持不变，确保现有功能正常

3. **性能影响**
   - 修改后的流程不会增加额外的数据库查询
   - 向量化嵌入逻辑保持不变，性能不受影响

4. **错误处理**
   - 确保所有错误场景都有适当的日志记录
   - 确保错误信息对用户友好
