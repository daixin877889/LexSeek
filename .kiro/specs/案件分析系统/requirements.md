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

## 实现状态

- 案件分析：✅ 已完成
- DOCX 浏览器端识别：🔄 进行中
- MinerU 批量上传：✅ 已完成
- 本地文件识别：✅ 已完成
- 图像识别：🔄 进行中
- 音频识别：🔄 进行中（服务层已完成，API 和前端待实现）
