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

- [x] 3. DOCX 浏览器端识别
  - [x] 3.1 实现 DOCX 解析逻辑
  - [x] 3.2 实现文档预览组件
  - [x] 3.3 集成到材料选择器

- [x] 4. MinerU 批量上传（PDF/DOC）
  - [x] 4.1 实现 MinerU Token 服务
  - [x] 4.2 实现批量上传 API
  - [x] 4.3 实现回调处理
  - [x] 4.4 实现结果处理和向量化嵌入

- [x] 5. 图像识别
  - [x] 5.1 现有 OCR 服务基础（ocr.service.ts，已使用节点系统）
  - [x] 5.2 配置豆包多模态模型和统一提示词
  - [x] 5.3 实现 base64 图像识别 API
  - [x] 5.4 为图像识别添加向量化嵌入
  - [x] 5.5 在案件分析流程中集成图像识别触发
  - [x] 5.6 实现图像识别结果预览组件

- [x] 6. 音频识别
  - [x] 6.1 ASR 服务层（已实现）
    - [x] 6.1.1 `server/services/material/asr.dao.ts` 数据访问层
    - [x] 6.1.2 `server/services/material/asr.service.ts` 业务逻辑层
    - [x] 6.1.3 `server/services/material/asrTask.dao.ts` 任务数据访问层
    - [x] 6.1.4 `server/services/material/asrTask.service.ts` 任务业务逻辑层
    - [x] 6.1.5 DashScope REST API 调用封装
    - [x] 6.1.6 轮询机制（指数退避）
    - [x] 6.1.7 积分扣减集成
  - [x] 6.2 模型管理集成
    - [x] 6.2.1 在模型提供商中添加阿里云百炼（DashScope）
    - [x] 6.2.2 在模型管理中添加 paraformer-v2 模型（modelType: asr）
    - [x] 6.2.3 创建 `audioRecognition` 节点并关联模型
    - [x] 6.2.4 修改 `asr.service.ts` 使用节点配置获取 API Key
  - [x] 6.3 结果精简和存储优化
    - [x] 6.3.1 实现结果精简逻辑（移除词级别时间戳）
    - [x] 6.3.2 上传原始 JSON 到 OSS 保存
    - [x] 6.3.3 更新 `processTranscriptionResultService` 集成精简逻辑
  - [x] 6.4 实现音频识别 API
    - [x] 6.4.1 创建 `POST /api/v1/recognition/audio` 提交识别任务
    - [x] 6.4.2 创建 `GET /api/v1/recognition/audio/[id]` 查询任务状态和结果
    - [x] 6.4.3 创建 `PUT /api/v1/recognition/audio/[id]` 更新识别结果（说话人名称等）
  - [x] 6.5 为音频识别添加向量化嵌入
    - [x] 6.5.1 实现 `embedAudioService` 方法
    - [x] 6.5.2 在识别完成后自动触发向量化
  - [x] 6.6 前端集成
    - [x] 6.6.1 创建 `app/composables/useAudioRecognition.ts`
    - [x] 6.6.2 在案件分析流程中集成音频识别触发
    - [x] 6.6.3 音频识别结果预览组件（已实现：`AudioVisualization.vue`）
  - [x] 6.7 加密音频文件处理
    - [x] 6.7.1 创建临时文件上传签名 API `POST /api/v1/recognition/audio/temp-upload`
    - [x] 6.7.2 修改 `submitAsrTaskService` 支持 `tempFilePath` 参数
    - [x] 6.7.3 实现临时文件清理逻辑（识别完成后删除）
    - [x] 6.7.4 扩展 `useAudioRecognition.ts` 添加 `submitEncryptedAudioRecognition` 方法
    - [x] 6.7.5 修改 `promptInput.vue` 中的 `triggerAudioRecognition` 处理加密文件

## 实现状态

- ✅ 案件分析核心功能：已完成
- ✅ 本地文件识别：已完成
- ✅ DOCX 浏览器端识别：已完成
- ✅ MinerU 批量上传：已完成
- ✅ 图像识别：已完成
- 🔄 音频识别：进行中（加密文件处理待实现）

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

## 音频识别详细任务

### 6.1 ASR 服务层（✅ 已完成）

服务层已完整实现，包括：
- `asr.dao.ts` - ASR 识别记录 CRUD
- `asr.service.ts` - 核心业务逻辑（提交任务、轮询、结果处理、积分扣减）
- `asrTask.dao.ts` - ASR 任务 CRUD
- `asrTask.service.ts` - 任务管理逻辑

**主要入口函数**：`transcribeAudioService(ossFileId, userId, options)`

### 6.2 模型管理集成

**操作**：在后台管理系统中配置 + 修改服务代码

**任务**:
1. 在模型提供商管理中添加阿里云百炼（DashScope）
   - 名称：阿里云百炼
   - Base URL：`https://dashscope.aliyuncs.com/api/v1`
   - API Key：配置 DashScope API Key
2. 在模型管理中添加 paraformer-v2 模型
   - 名称：paraformer-v2
   - 显示名称：Paraformer V2 语音识别
   - 模型类型：asr
3. 创建 `audioRecognition` 节点并关联 paraformer-v2 模型
4. 修改服务代码，使用 `getNodeConfigService('audioRecognition')` 获取 API Key

**需要修改的文件**（确保后台管理页面正常工作）:
- `server/services/material/asr.service.ts`
  - `submitAsrTaskService` 函数
  - `pollAsrTaskStatusService` 函数
- `server/services/material/asrTask.service.ts`
  - `queryAsrTaskStatusService` 函数
  - `retryAsrTaskService` 函数

**代码修改示例**:
```typescript
// 修改前（使用环境变量）
const asrToken = process.env.DASHSCOPE_API_KEY

// 修改后（使用模型管理）
const nodeConfig = await getNodeConfigService('audioRecognition')
const asrToken = nodeConfig.modelApiKeys[0].apiKey
```

### 6.3 结果精简和存储优化

**文件**: `server/services/material/asr.service.ts`

**任务**:
1. 参考旧项目 `lexseekApi/src/services/ai/asr/asrRecord.service.ts` 的 `simplifyAsrRecordJsonData` 函数
2. 在 `processTranscriptionResultService` 中集成精简逻辑
3. 上传原始 JSON 到 OSS，记录 `jsonOssFileId`

**精简逻辑**:
```typescript
// 移除词级别时间戳，仅保留句子级别
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

### 6.4 实现音频识别 API

**文件**:
- `server/api/v1/recognition/audio/index.post.ts`（新建）
- `server/api/v1/recognition/audio/[id].get.ts`（新建）
- `server/api/v1/recognition/audio/[id].put.ts`（新建）

**API 设计**:

```typescript
// POST /api/v1/recognition/audio - 提交识别任务
// 请求体
{
  ossFileId: number,           // OSS 文件 ID
  options?: {
    languageHints?: string[],  // 语言提示，默认 ['zh', 'en']
    diarizationEnabled?: boolean  // 说话人分离，默认 true
  }
}

// 响应
{
  code: 0,
  message: '任务已提交',
  data: {
    taskId: string,
    recordId: number,
    status: number  // 0-待处理, 1-处理中, 2-成功, 3-失败
  }
}

// GET /api/v1/recognition/audio/:id - 查询任务状态和结果
// 响应
{
  code: 0,
  data: {
    id: number,
    status: number,
    audioUrl: string,
    audioDuration: number,
    speakers: Array<{ id: number, name: string, color: string }>,
    result: Array<{
      text: string,
      begin_time: number,
      end_time: number,
      speaker_id: number,
      sentence_id: number
    }>
  }
}

// PUT /api/v1/recognition/audio/:id - 更新识别结果
// 请求体
{
  speakers?: Array<{ id: number, name: string, color?: string }>,  // 更新说话人名称
  keywords?: any,    // 关键词
  summary?: string   // 摘要
}
```

### 6.5 为音频识别添加向量化嵌入

**文件**: `server/services/material/asr.service.ts`

**任务**:
1. 创建 `embedAudioService` 方法
2. 提取识别文本，调用 `materialEmbedding.service.ts` 进行向量化
3. 更新 `asrRecords` 的 `vectorIds` 和 `lastEmbeddingAt` 字段
4. 在 `completeTranscriptionService` 中调用向量化（异步，失败不影响主流程）

### 6.6 前端集成

**文件**:
- `app/composables/useAudioRecognition.ts`（新建）
- `app/components/general/audio/AudioVisualization.vue`（✅ 已实现）

**Composable 任务**:
```typescript
// useAudioRecognition.ts
export const useAudioRecognition = () => {
  // 提交识别任务
  const submitRecognition = async (ossFileId: number, options?: AsrSubmitOptions) => {
    return await useApiFetch('/api/v1/recognition/audio', {
      method: 'POST',
      body: { ossFileId, options }
    })
  }
  
  // 轮询任务状态（每 3 秒，最多 60 次）
  const pollTaskStatus = async (recordId: number, onProgress?: (status: number) => void) => {
    // 轮询直到完成或失败
  }
  
  // 获取识别结果
  const getResult = async (recordId: number) => {
    return await useApiFetch(`/api/v1/recognition/audio/${recordId}`)
  }
  
  // 更新说话人名称
  const updateSpeakers = async (recordId: number, speakers: Speaker[]) => {
    return await useApiFetch(`/api/v1/recognition/audio/${recordId}`, {
      method: 'PUT',
      body: { speakers }
    })
  }
  
  return { submitRecognition, pollTaskStatus, getResult, updateSpeakers }
}
```

**音频可视化组件（✅ 已实现）**:

组件位于 `app/components/general/audio/AudioVisualization.vue`，支持：
- 音频播放器（播放/暂停、进度控制、音量调节）
- ASR 对话记录（多说话人、时间同步高亮、点击跳转）
- 说话人编辑（点击头像编辑姓名）
- 键盘快捷键（空格播放/暂停、方向键导航）
- 全屏模式
- 文档下载（打包音频和识别结果）

**使用方式**:
```vue
<AudioVisualization 
  :asr-data="asrData"
  :audio-url="audioUrl"
  :material-title="materialTitle"
  :asr-record-id="asrRecordId"
  @speaker-updated="handleSpeakerUpdated"
/>
```


## 加密音频文件处理详细任务

### 6.7.1 创建临时文件上传签名 API

**文件**: `server/api/v1/recognition/audio/temp-upload.post.ts`（新建）

**任务**:
1. 创建 API 端点接收临时文件上传请求
2. 验证原始 ossFileId 存在且为加密音频文件
3. 生成临时目录上传签名（不创建 ossFiles 记录）
4. 临时文件路径格式：`temp/asr/{年}/{月}/{日}/{uuid}.{ext}`

**API 设计**:
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
    host: string,
    policy: string,
    signature: string,
    key: string,           // temp/asr/{年}/{月}/{日}/{uuid}.{ext}
    // ... 其他签名字段
  }
}
```

### 6.7.2 修改 submitAsrTaskService 支持 tempFilePath

**文件**: `server/services/material/asr.service.ts`

**任务**:
1. 添加 `tempFilePath` 可选参数
2. 如果提供 `tempFilePath`，使用临时文件路径生成签名 URL
3. 如果未提供，使用原有逻辑（从 ossFile.filePath 生成）
4. 在 ASR 记录中保存 `tempFilePath` 用于后续清理

**代码修改**:
```typescript
export const submitAsrTaskService = async (
    ossFileId: number,
    userId: number,
    options: AsrSubmitOptions = {},
    tempFilePath?: string  // 新增：临时文件路径（加密文件解密后上传的路径）
): Promise<AsrSubmitResult> => {
    // ...
    
    // 6. 生成签名 URL
    let audioUrl: string
    if (tempFilePath) {
        // 使用临时文件路径
        audioUrl = await generateSignedUrlService(tempFilePath, { expires: 7200 })
    } else {
        // 使用原始文件路径
        audioUrl = await generateSignedUrlService(ossFile.filePath, { expires: 7200 })
    }
    
    // ...
}
```

### 6.7.3 实现临时文件清理逻辑

**文件**: `server/services/material/asr.service.ts`

**任务**:
1. 在 `completeTranscriptionService` 中添加临时文件删除逻辑
2. 在 `failTranscriptionService` 中添加临时文件删除逻辑
3. 使用 `deleteFileService` 删除 OSS 临时文件

**代码修改**:
```typescript
// 在 completeTranscriptionService 和 failTranscriptionService 中添加
import { deleteFileService } from '../storage/storage.service'

// 清理临时文件
if (record.tempFilePath) {
    try {
        await deleteFileService(record.tempFilePath)
        logger.info(`临时音频文件已删除：${record.tempFilePath}`)
    } catch (deleteError) {
        // 删除失败只记录日志，不影响主流程
        logger.warn(`临时音频文件删除失败：${record.tempFilePath}`, deleteError)
    }
}
```

### 6.7.4 扩展 useAudioRecognition.ts

**文件**: `app/composables/useAudioRecognition.ts`

**任务**:
1. 添加 `getTempUploadSignature` 方法获取临时上传签名
2. 添加 `submitEncryptedAudioRecognition` 方法处理加密音频识别
3. 集成 `useFileDecryption` 和 `useFileUploadWorker`

**新增方法**:
```typescript
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
 * 流程：
 * 1. 下载加密文件
 * 2. 解密文件
 * 3. 获取临时上传签名
 * 4. 上传解密后的文件到临时目录
 * 5. 提交识别任务（带 tempFilePath）
 */
const submitEncryptedAudioRecognition = async (
  file: OssFileItem,
  options?: AsrSubmitOptions,
  onProgress?: (stage: string, progress: number) => void
): Promise<SubmitRecognitionResponse | null> => {
  // 1. 下载加密文件
  onProgress?.('downloading', 0)
  const response = await fetch(file.url)
  const encryptedData = await response.arrayBuffer()
  onProgress?.('downloading', 100)
  
  // 2. 解密文件
  onProgress?.('decrypting', 0)
  const { decryptFile } = useAgeCrypto()
  const decryptedData = await decryptFile(encryptedData, (p) => {
    onProgress?.('decrypting', p)
  })
  onProgress?.('decrypting', 100)
  
  // 3. 获取临时上传签名
  onProgress?.('preparing', 0)
  const originalFileName = file.fileName.replace(/\.age$/, '')
  const mimeType = file.originalMimeType || 'audio/mpeg'
  const signature = await getTempUploadSignature({
    ossFileId: file.id,
    fileName: originalFileName,
    fileSize: decryptedData.byteLength,
    mimeType,
  })
  if (!signature) return null
  onProgress?.('preparing', 100)
  
  // 4. 上传解密后的文件
  onProgress?.('uploading', 0)
  const decryptedFile = new File([decryptedData], originalFileName, { type: mimeType })
  // 使用 useFileUploadWorker 上传...
  onProgress?.('uploading', 100)
  
  // 5. 提交识别任务
  return await useApiFetch('/api/v1/recognition/audio', {
    method: 'POST',
    body: {
      ossFileId: file.id,
      tempFilePath: signature.key,
      options,
    },
  })
}
```

### 6.7.5 修改 promptInput.vue 处理加密文件

**文件**: `app/components/caseAnalysis/promptInput.vue`

**任务**:
1. 修改 `triggerAudioRecognition` 函数
2. 检测文件是否加密（`file.encrypted`）
3. 加密文件调用 `submitEncryptedAudioRecognition`
4. 未加密文件使用原有逻辑

**代码修改**:
```typescript
async function triggerAudioRecognition(file: OssFileItem) {
  // ...
  
  try {
    let submitResult: SubmitRecognitionResponse | null
    
    if (file.encrypted) {
      // 加密文件：前端解密后上传临时文件
      console.log('[triggerAudioRecognition] 检测到加密文件，开始解密流程...')
      submitResult = await submitEncryptedAudioRecognition(
        file,
        undefined,
        (stage, progress) => {
          console.log(`[triggerAudioRecognition] ${stage}: ${progress}%`)
        }
      )
    } else {
      // 未加密文件：直接提交
      submitResult = await submitAudioRecognition(file.id)
    }
    
    // ... 后续轮询逻辑
  } catch (error) {
    // ...
  }
}
```

### 数据库修改

**文件**: `prisma/models/recognition.prisma`

**任务**: 在 `asrRecords` 表添加 `tempFilePath` 字段

```prisma
model asrRecords {
  // ... 现有字段
  tempFilePath    String?   @map("temp_file_path")  // 临时文件路径（加密文件解密后上传的路径）
}
```
