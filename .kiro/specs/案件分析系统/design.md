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

### 进行中

- DOCX 浏览器端识别
- 图像识别（豆包多模态方案）

### 待实现

- 音频识别 API 端点（用户端）
- 音频识别前端集成
- 音频识别向量化嵌入
- 结果精简逻辑（上传原始 JSON 到 OSS）
- 模型管理集成（替换环境变量）

### 相关文件

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
