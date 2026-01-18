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
- **ASR**: 自动语音识别（Automatic Speech Recognition），将音频转换为文本
- **Paraformer**: 阿里云百炼的语音识别模型，支持中英文混合识别
- **DashScope**: 阿里云大模型服务平台 SDK

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

### 需求 6：音频识别

**用户故事：** 作为用户，我希望能够识别音频文件中的语音内容，以便在案件分析中使用录音证据。

#### 验收标准

1. THE System SHALL 支持常见音频格式（MP3、WAV、M4A、AAC、FLAC、OGG、WEBM、AMR、OPUS）
2. THE System SHALL 使用阿里云百炼 paraformer-v2 模型进行语音识别
3. THE System SHALL 通过环境变量（DASHSCOPE_API_KEY）管理 ASR API 密钥
4. THE System SHALL 支持异步任务处理（提交任务 → 轮询状态 → 获取结果）
5. THE System SHALL 将识别结果转换为带时间戳的文本格式（句子级别）
6. THE System SHALL 对识别结果进行向量化嵌入
7. THE System SHALL 支持识别结果的编辑和更新（说话人名称、关键词、摘要）
8. THE System SHALL 在案件分析流程中自动触发音频识别
9. THE System SHALL 支持中英文混合语音识别
10. THE System SHALL 支持说话人分离（diarization）
11. THE System SHALL 支持加密存储的音频文件（通过签名 URL 访问）
12. THE System SHALL 精简识别结果（移除词级别时间戳，仅保留句子级别）

#### 技术方案

**阿里云百炼 paraformer-v2 API**：
- 直接调用 DashScope REST API（不使用 SDK）
- 异步调用方式：POST 提交任务，GET 轮询状态
- 支持批量文件识别（最多 100 个音频文件）
- 返回带时间戳的识别结果（句子级别）

**模型管理集成**：
- 通过项目的模型管理系统管理 ASR 模型配置（modelType: 'asr'）
- 通过节点系统（`audioRecognition` 节点）管理模型和 API Key 配置
- API Key 通过模型提供商管理，不使用环境变量

**加密文件处理**：
- OSS 文件可能是加密存储的，无法直接通过公网 URL 访问
- 使用 `generateSignedUrlService` 生成带签名的临时访问 URL
- 签名 URL 有效期设置为 2 小时（音频转录可能需要较长时间）

**结果精简策略**（参考旧项目 lexseekApi）：
- 原始结果包含词级别时间戳，数据量较大
- 精简后仅保留句子级别信息：`begin_time`、`end_time`、`text`、`sentence_id`、`speaker_id`
- 原始 JSON 上传到 OSS 保存，精简后的结果存入数据库

**数据流**：
1. 客户端上传音频文件 → 上传到 OSS
2. 提交 ossFileId 到服务端 → 生成签名 URL
3. 服务端获取节点配置（模型、API Key）→ 调用 DashScope API 提交识别任务
4. 轮询任务状态（指数退避）→ 获取识别结果
5. 下载结果 JSON → 上传到 OSS → 精简后存入数据库
6. 扣减积分（按分钟计费）→ 向量化嵌入

**识别结果格式（精简后）**：
```json
{
  "file_url": "https://xxx.oss.aliyuncs.com/audio.wav",
  "properties": {
    "audio_format": "pcm_s16le",
    "original_sampling_rate": 16000,
    "original_duration_in_milliseconds": 4726
  },
  "transcripts": [
    {
      "channel_id": 0,
      "content_duration_in_milliseconds": 4726,
      "sentences": [
        {
          "begin_time": 680,
          "end_time": 4480,
          "text": "句子文本",
          "sentence_id": 0,
          "speaker_id": 0
        }
      ]
    }
  ]
}
```

**积分消耗**：
- 按音频时长（分钟）计费
- 消耗项目标识符：`asr_transcribe`
- 转录失败不扣减积分

**现有组件复用**：
- 音频可视化组件：`app/components/general/audio/AudioVisualization.vue`
- 支持多说话人显示、时间同步高亮、点击跳转、说话人编辑等功能

### 需求 7：案件创建增强

**用户故事：** 作为用户，我希望在创建案件时能够同时上传案件材料，以便一次性完成案件的初始化。

#### 验收标准

1. THE System SHALL 支持在创建案件时同时提交案件材料
2. THE System SHALL 支持多种材料类型（文本内容、文档、图片、音频）
3. THE System SHALL 验证材料的有效性和权限
4. THE System SHALL 使用事务确保案件和材料的原子性创建
5. THE System SHALL 返回完整的案件和材料信息

#### 技术方案

**材料类型**：
- **CASE_CONTENT**（文本内容）：直接保存文本内容
- **DOCUMENT**（文档）：关联 OSS 文件 ID
- **IMAGE**（图片）：关联 OSS 文件 ID
- **AUDIO**（音频）：关联 OSS 文件 ID

**数据流**：
1. 客户端提交案件信息和材料列表
2. 服务端验证案件类型、材料格式和文件权限
3. 使用数据库事务创建案件和材料记录
4. 返回完整的案件和材料信息

**验证规则**：
- 案件类型必须存在且已启用
- 文件材料必须验证 OSS 文件存在且用户有权限
- 文本材料必须包含内容
- 所有材料必须指定类型和名称

### 需求 8：文本材料向量化嵌入

**用户故事：** 作为用户，我希望文本材料能够被向量化，以便在案件分析中进行语义搜索和相关性匹配。

#### 验收标准

1. THE System SHALL 对 CASE_CONTENT 类型的材料进行向量化嵌入
2. THE System SHALL 在材料创建后自动触发向量化
3. THE System SHALL 支持批量向量化处理
4. THE System SHALL 将向量存储到 materialEmbeddings 表
5. THE System SHALL 支持向量化失败的重试机制

#### 技术方案

**向量化时机**：
- 材料创建后立即触发（异步处理）
- 支持手动触发重新向量化

**数据流**：
1. 创建 CASE_CONTENT 材料 → 保存到 caseMaterials 表
2. 触发向量化任务 → 调用嵌入模型
3. 生成向量 → 保存到 materialEmbeddings 表
4. 更新材料状态 → 标记为已向量化

**向量化服务**：
- 复用现有的 `materialEmbedding.service.ts`
- 使用项目配置的嵌入模型
- 支持批量处理以提高效率

### 需求 9：前端页面对接新版创建案件 API

**用户故事：** 作为用户，我希望在案件分析页面提交案情信息和材料时，能够使用新版创建案件 API，以便同时创建案件和上传材料。

#### 验收标准

1. THE System SHALL 在提交案情信息时调用新版创建案件 API
2. THE System SHALL 支持同时提交文本内容和文件材料
3. THE System SHALL 将已识别的文件材料转换为 API 所需的格式
4. THE System SHALL 在创建案件成功后跳转到分析页面
5. THE System SHALL 在创建失败时显示友好的错误提示
6. THE System SHALL 在提交前验证必填字段（content 或 materials 至少一个）
7. THE System SHALL 在提交前检查文件识别状态（不允许提交识别中的文件）

#### 技术方案

**API 调用**：
- 使用 `useApiFetch` 调用 `POST /api/v1/case/create`
- 请求体包含：`title`、`content`、`caseTypeId`、`materials`

**材料转换**：
- 文本内容：转换为 `CASE_CONTENT` 类型材料（通过 API 的 `content` 字段）
- 文件材料：根据 MIME 类型转换为对应的材料类型
  - 图片文件（通过 `isImageType(mimeType)` 判断）→ `IMAGE`
  - 音频文件（通过 `isAudioType(mimeType)` 判断）→ `AUDIO`
  - 其他文件 → `DOCUMENT`

**注意**：项目中已在 `shared/utils/file.ts` 定义了允许上传的文件类型（`ASR_ACCEPT`、`DOC_ACCEPT`、`IMAGE_ACCEPT`），通过 MIME 类型判断自动生效，无需手动维护文件类型列表。

**数据流**：
1. 用户输入案情信息和选择材料
2. 点击"法索一下"按钮
3. 验证输入（文本或材料至少一个）
4. 检查文件识别状态（不允许识别中的文件）
5. 构建 API 请求参数
6. 调用创建案件 API
7. 创建成功后跳转到分析页面
8. 创建失败时显示错误提示

**错误处理**：
- 参数验证失败：显示具体的错误信息
- 网络错误：显示"网络错误，请重试"
- 服务器错误：显示服务器返回的错误信息

### 需求 10：修复图片识别记录创建时机

**用户故事：** 作为系统，我希望只在图片识别成功后才创建识别记录，以避免失败记录污染数据库，与音频识别和 MinerU 识别保持一致。

#### 背景

根据深度 review 报告（`docs/recognition-flow-deep-review.md`），项目中的四种识别流程存在不一致：

- **音频识别 (ASR)** - ✅ 正确：只在识别成功时创建识别记录
- **MinerU 识别** - ✅ 正确：只在识别成功时创建识别记录
- **图片识别 (OCR)** - ❌ 错误：在提交时就创建识别记录，失败时不删除

当前图片识别流程（`server/services/material/ocr.service.ts` 中的 `createImageRecognitionByBase64Service` 方法）在识别开始时就创建识别记录，如果识别失败，已创建的记录不会被删除，这导致数据库中会留下失败的识别记录，污染数据。

#### 验收标准

1. WHEN 图片识别成功 THEN OCR_Service SHALL 创建识别记录
2. WHEN 图片识别失败 THEN OCR_Service SHALL NOT 创建识别记录
3. THE OCR_Service SHALL 在 AI 服务返回识别结果后才创建识别记录
4. THE OCR_Service SHALL 确保识别记录的 status 字段为 COMPLETED
5. WHEN 创建识别记录时 THEN OCR_Service SHALL 同时保存 Markdown 和 HTML 内容
6. WHEN 同一文件已有成功的识别记录 THEN OCR_Service SHALL 直接返回现有记录
7. WHEN 同一文件已有失败或处理中的识别记录 THEN OCR_Service SHALL 删除旧记录并重新识别
8. THE OCR_Service SHALL 在创建新记录前检查是否存在旧记录
9. WHEN 删除旧记录时 THEN OCR_Service SHALL 使用软删除（设置 deletedAt 字段）
10. WHEN 识别记录创建成功 THEN OCR_Service SHALL 触发向量化嵌入
11. WHEN 向量化嵌入成功 THEN OCR_Service SHALL 更新识别记录的 vectorIds 和 lastEmbeddingAt 字段
12. WHEN 向量化嵌入失败 THEN OCR_Service SHALL 记录警告日志但不影响识别结果
13. THE OCR_Service SHALL 在向量化嵌入后更新 case_materials 表的 embedding_status 字段
14. WHEN 向量化嵌入失败 THEN OCR_Service SHALL 将 case_materials 的 embedding_status 设置为 failed
15. THE OCR_Service SHALL 参考 ASR_Service 的 `completeTranscriptionService` 方法实现
16. THE API SHALL 保持现有的响应格式不变
17. THE API SHALL 保持现有的错误码不变
18. WHEN 识别成功 THEN API SHALL 返回包含 id、imageType、markdownContent、htmlContent 的记录
19. THE `useImageRecognition.ts` SHALL 保持现有的方法签名不变
20. THE `useImageRecognition.ts` SHALL 保持现有的状态管理逻辑不变

#### 技术方案

**参考实现**：
- 参考音频识别的 `completeTranscriptionService` 方法（`server/services/material/asr.service.ts`）
- 音频识别在识别成功时才创建识别记录，失败时不创建任何记录

**修改方案**：
1. 修改 `createImageRecognitionByBase64Service` 方法
2. 将识别记录创建逻辑移到 AI 识别成功之后
3. 识别失败时直接返回错误，不创建记录
4. 保持向量化嵌入逻辑不变
5. 保持 API 接口和前端 composable 不变

**涉及的文件**：
- `server/services/material/ocr.service.ts` - 主要修改文件
- `server/api/v1/recognition/image.post.ts` - API 接口（无需修改）
- `app/composables/useImageRecognition.ts` - 前端 composable（无需修改）

## 实现状态

- 案件分析：✅ 已完成
- DOCX 浏览器端识别：✅ 已完成
- MinerU 批量上传：✅ 已完成
- 本地文件识别：✅ 已完成
- 图像识别：✅ 已完成
- 音频识别：✅ 已完成
- 案件创建增强：✅ 已完成
- 文本材料向量化嵌入：✅ 已完成
- 前端页面对接新版创建案件 API：⏳ 进行中
- 修复图片识别记录创建时机：❌ 待实现
