# 材料处理管道

材料处理管道负责将用户上传的多种格式文件（PDF、图片、音频、DOCX、Markdown/TXT）转换为可供 AI 检索的向量化文本，是案件分析的数据基础设施。

## 管道总览

```
上传 → 类型检测 → 识别路由 → 内容提取 → Embedding → 摘要
         │            │
         │    ┌───────┼────────┬──────────┐
         │    PDF     图片     音频       DOCX/MD/TXT
         │    │       │        │          │
         │  MinerU   OCR     ASR       mammoth/直读
         │    │       │        │          │
         │    └───────┼────────┴──────────┘
         │            ↓
         │     markdownContent
         │            ↓
         └──→  向量化 (Embedding)
                      ↓
               case_material_embeddings
```

## 源码路径

所有文件位于 `server/services/material/`。

| 文件 | 职责 |
|------|------|
| `fileDetect.service.ts` | 根据扩展名判断材料类型 |
| `materialProcess.service.ts` | 编排函数：授权、状态校验、分发处理、结果更新 |
| `materialPipeline.service.ts` | 批量就绪保障：识别 + 嵌入 + 上下文构建 + 材料检索（`searchMaterialsService`） |
| `materialEmbedding.service.ts` | 向量化：分块、存储、检索、状态查询 |
| `materialSummary.service.ts` | LLM 摘要生成与缓存 |
| `mineru.service.ts` | MinerU PDF 转换：提交、轮询、结果处理 |
| `mineruResult.service.ts` | MinerU ZIP 解压、图片上传、Markdown 替换 |
| `mineruTask.service.ts` | MinerU 任务 CRUD |
| `mineruTask.dao.ts` | MinerU 任务数据访问 |
| `mineruToken.service.ts` | MinerU API Token 管理（脱敏、切换） |
| `mineruToken.dao.ts` | MinerU Token 数据访问 |
| `mineru.dao.ts` | 文档识别记录数据访问 |
| `ocr.service.ts` | 图片 OCR 识别 |
| `ocr.dao.ts` | 图片识别记录数据访问 |
| `asr.service.ts` | 音频 ASR 转录 |
| `asr.dao.ts` | ASR 记录数据访问 |
| `asrTask.service.ts` | ASR 任务管理 |
| `asrTask.dao.ts` | ASR 任务数据访问 |
| `docxRecognition.service.ts` | DOCX 文件解析（mammoth） |
| `textReader.service.ts` | MD/TXT 文件直接读取 |
| `imageProcessor.ts` | Markdown 中的图片处理（base64/URL → OSS） |
| `fileProcess.service.ts` | 文件粒度识别（不关联案件，用于提取阶段） |
| `textContentRecords.service.ts` | 文本内容记录服务 |
| `textContentRecords.dao.ts` | 文本内容记录数据访问 |
| `material.service.ts` | 材料基础 CRUD |
| `material.dao.ts` | 材料数据访问 |
| `materialConstants.ts` | 轮询配置、退避算法、常量 |

## 数据模型

### 核心表

| 表 | 说明 |
|----|------|
| `caseMaterials` | 材料元信息（名称、类型、状态、caseId、ossFileId） |
| `ossFiles` | OSS 文件记录 |
| `textContentRecords` | 文本材料内容（CASE_CONTENT 类型） |
| `docRecognitionRecords` | 文档识别结果（markdownContent、htmlContent） |
| `imageRecognitionRecords` | 图片识别结果（markdownContent） |
| `asrRecords` | 音频识别结果（summary、result JSON） |
| `asrTasks` | ASR 任务记录 |
| `mineruTasks` | MinerU 任务记录 |
| `mineruTokens` | MinerU API Token |
| `case_material_embeddings` | 向量存储表（PostgreSQL + pgvector） |

### 材料状态枚举

```typescript
enum MaterialStatus {
  PENDING = 1,     // 待处理
  PROCESSING = 2,  // 处理中
  COMPLETED = 3,   // 已完成
  FAILED = 4,      // 失败
}
```

### 识别记录状态

各识别记录表使用独立的 status 字段：
- `1` = PROCESSING
- `2` = SUCCESS
- `3` = FAILED

注意：材料的"真实状态"由识别记录表决定，不依赖 `caseMaterials.status`（通过 `getMaterialsByCaseIdWithStatusService` 查询）。

## 文件类型检测

`detectFileTypeService(fileName)` 根据扩展名返回 `CaseMaterialType` 枚举：

| 扩展名 | 类型 |
|--------|------|
| jpg/jpeg/png/gif/webp/heic/heif | `IMAGE` (3) |
| mp3/wav/m4a/aac/ogg/flac | `AUDIO` (4) |
| 其他（pdf/doc/docx/md/txt 等） | `DOCUMENT` (2) |

纯文本材料（案情描述）使用 `CASE_CONTENT` (1) 类型，由前端直接创建。

`fileProcess.service.ts` 中的 `getMaterialTypeFromMime` 提供基于 MIME 类型的检测（用于提取阶段的文件粒度处理）。

## 识别路由

`processMaterialService` 是编排入口，按材料类型分发到对应处理函数：

```
materialType 分发:
  DOCUMENT → processPdfMaterial → convertPdfService (MinerU)
  IMAGE    → processImageMaterial → createImageConversionService (OCR)
  AUDIO    → processAudioMaterial → transcribeAudioService (ASR)
```

处理流程：

1. 获取材料信息，校验存在性
2. 授权检查：材料所属案件必须属于当前用户
3. 状态检查：已完成或处理中的材料拒绝重复处理
4. 无 OSS 文件的材料检查 textContentRecords 是否已有内容
5. 更新状态为 PROCESSING
6. 按类型分发到具体处理服务
7. 同步处理（OCR）：直接返回内容并更新状态
8. 异步处理（MinerU/ASR）：返回 PROCESSING 状态，内容通过轮询后更新
9. 嵌入（如果启用 enableEmbedding）
10. 异常时回退状态为 PENDING

特殊分支：DOCX 文件走 `recognizeDocxService`（mammoth 库），MD/TXT 文件走 `readTextFileService`（直接读取）。这两类在 `fileProcess.service.ts` 中通过 MIME 类型路由。

### DOCX 识别

`recognizeDocxService(ossFileId, userId)` 流程：

1. 检查已有成功识别记录
2. 从 OSS 下载文件
3. mammoth 转换为 Markdown
4. 处理图片（base64/URL → OSS 占位符）
5. 清理 Word 锚点标签（`<a id="_Hlk...">`）
6. 修复图片格式（alt 文本中的换行）
7. Markdown 转 HTML
8. 创建/更新识别记录
9. 向量化嵌入

### MD/TXT 直读

`readTextFileService(ossFileId, userId)` 流程：

1. 从 OSS 下载文件（UTF-8 编码）
2. txt 文件添加标题；md 文件保持原样
3. md 文件处理内嵌图片
4. 简单 HTML 转换
5. 创建识别记录
6. 向量化嵌入

### 文件粒度处理（提取阶段）

`processFileMaterials(ossFileIds, userId)` 在 AI 信息提取前确保文件已识别，不关联案件：

1. 批量查询 OSS 文件和已有识别记录
2. 构建 Map 加速查找（O(1)）
3. 并行处理所有文件
4. 异步处理（PDF/音频）会轮询等待 DB 状态变化（最长 5 分钟）

## MinerU 集成

### 任务提交

`convertPdfService` 是对外主接口，整合提交和轮询：

1. 调用 `submitPdfConversionService`
2. 如果没有回调 URL 且是新任务，启动 `startTaskPollingService`

`submitPdfConversionService` 流程：

1. 检查已有成功识别记录 → 返回 `taskId: 'existing'`（跳过重复识别）
2. 检查可用 MinerU Token（`hasActiveTokenService`）
3. 获取 OSS 文件信息（通过 DAO 层）
4. 检查用户积分（`checkPointsService`）
5. 生成文件签名 URL（1 小时有效期）
6. 构建请求参数（enable_ocr/formula/table/page_range）
7. 调用 MinerU API（`POST https://mineru.net/api/v4/extract/task`）
8. 创建 `mineruTasks` 记录（状态 PROCESSING）

转换选项：

```typescript
interface MineruSubmitOptions {
  enableOcr?: boolean       // 是否启用 OCR
  enableFormula?: boolean   // 是否启用公式识别
  enableTable?: boolean     // 是否启用表格识别
  pageRange?: string        // 页码范围（如 "1-10"）
  callbackUrl?: string      // 回调 URL
}
```

### 轮询机制

使用指数退避策略：

```typescript
const MINERU_POLLING_CONFIG = {
  initialDelay: 5000,     // 5 秒
  backoffFactor: 1.5,
  maxDelay: 300000,       // 5 分钟
  maxRetries: 20,
}
```

`pollTaskStatusService` 查询 MinerU API，根据 `state` 处理：
- `done` → 下载 ZIP → 解析 → 保存 → 嵌入 → 扣积分
- `failed` → 标记失败，不扣积分
- 其他 → 继续轮询

### 结果解析

`processConversionResultService` 流程：

1. 下载 ZIP（ofetch，60 秒超时）
2. 解压提取 `full.md` 和图片文件（JSZip）
3. 上传图片到 OSS，替换 Markdown 中的路径为占位符 `{{OSS_IMAGE:bucket:ossFileId}}`
4. 处理外部 URL 图片（`processUrlImagesInMarkdown`）
5. Markdown 转 HTML（marked 库，启用 GFM 和 breaks）

`completeConversionService` 保存结果：

1. 更新 `mineruTasks` 状态为 SUCCESS
2. 创建或更新 `docRecognitionRecords`
3. 执行向量化嵌入
4. 扣减积分（失败不影响转换结果，仅记录日志）

### 批量轮询保底

`pollPendingTasksService` 批量检查待处理任务（最多 50 条），跳过 `taskId === 'existing'` 的记录。

### Token 管理

`mineruToken.service.ts` 管理 MinerU API Token：
- Token 脱敏存储（只显示前 4 后 4）
- 支持启用/禁用状态切换
- `getActiveTokenValueService` 获取当前启用的 Token 值
- `hasActiveTokenService` 检查是否有可用 Token

## ASR 集成

### 任务提交

`transcribeAudioService` 流程：
1. 检查已有成功识别记录（防重复）
2. 预扣积分
3. 生成文件签名 URL
4. 调用阿里云百炼 ASR API 提交转录任务
5. 创建 asrTasks 和 asrRecords 记录
6. 启动异步轮询

### 轮询配置

```typescript
const ASR_POLLING_CONFIG = {
  initialDelay: 5000,
  backoffFactor: 1.5,
  maxDelay: 300000,
  maxRetries: 30,
}
```

### 结果处理

ASR 结果格式化为带时间戳的转录文本：

```
[00:00-00:03]说话人1：我家里的情况是...
[00:03-00:11]说话人1：我父亲他目前是欠债一百多W...
```

支持两种结果格式（由 `extractTextFromAsrResult` 兼容）：
- 扁平格式：`{ sentences: [{ text }] }`
- 嵌套格式：`{ transcripts: [{ sentences: [{ text }] }] }`

## OCR 服务

`createImageConversionService` 使用 AI 视觉模型识别图片内容：

1. 检查已有成功识别记录（防重复）
2. 获取图片签名 URL
3. 通过 node 系统获取 OCR 模型配置（节点名 `extractImageInfo`）
4. 使用结构化输出调用 LLM：返回 `{ imgType, imageInfo }`
5. `imgType` 分为 `doc`（文档类图片）和 `photo`（照片类图片）
6. 保存识别记录、执行嵌入

内置 429 限流重试机制（最多 3 次，指数退避，基础延迟 2000ms）。

支持的图片 MIME 类型：`image/jpeg`、`image/png`、`image/gif`、`image/webp`、`image/heic`、`image/heif`。

结构化输出 schema：

```typescript
const imageInfoSchema = z.object({
  imgType: z.enum(['doc', 'photo']),
  imageInfo: z.string(), // Markdown 格式
})
```

## 图片预处理

`imageProcessor.ts` 提供统一的图片处理能力：

- `processAllImagesInMarkdown`：处理 Markdown 中的 base64 和 URL 图片
- `processUrlImagesInMarkdown`：仅处理 URL 图片

处理方式：base64 图片解码、URL 图片下载 → 上传到 OSS → 替换为占位符 `{{OSS_IMAGE:bucket:ossFileId}}`。

## 材料就绪管道 (Pipeline)

`ensureMaterialsReadyService` 确保案件所有材料已完成识别和嵌入，是案件分析的前置保障：

1. 获取案件全部材料
2. **识别阶段**：`batchCheckMaterialRecognizedService` 检查识别状态 → 对未识别的并行调用 `processMaterialService`
3. **嵌入阶段**：`batchCheckMaterialEmbeddedService` 检查嵌入状态 → 对未嵌入的并行调用 `embedMaterialUnifiedService`
4. 排除已失败的材料，收集失败信息

### 识别状态检查

`batchCheckMaterialRecognizedService` 按类型查对应识别记录表：
- CASE_CONTENT → `textContentRecords.content` 非空
- DOCUMENT → `docRecognitionRecords.status === 2`
- IMAGE → `imageRecognitionRecords.status === 2`
- AUDIO → `asrRecords.status === 2`

### 嵌入状态检查

`batchCheckMaterialEmbeddedService` 按类型查 `lastEmbeddingAt` 字段：
- CASE_CONTENT → `textContentRecords.lastEmbeddingAt`
- DOCUMENT → `docRecognitionRecords.lastEmbeddingAt`
- IMAGE → `imageRecognitionRecords.lastEmbeddingAt`
- AUDIO → `asrRecords.lastEmbeddingAt`

## Embedding 向量化

### 统一入口

`embedMaterialUnifiedService(materialId, userId)` 按材料类型分发：

| 类型 | 内容来源 | 嵌入函数 | sourceId |
|------|----------|----------|----------|
| CASE_CONTENT (1) | textContentRecords.content | `embedTextContentByMaterialIdService` | materialId |
| DOCUMENT (2) | docRecognitionRecords.markdownContent | `embedDocumentService` | ossFileId |
| IMAGE (3) | imageRecognitionRecords.markdownContent | `embedImageService` | ossFileId |
| AUDIO (4) | asrRecords.summary | `embedAudioService` | ossFileId |

嵌入完成后更新对应识别记录的 `lastEmbeddingAt` 字段。

### 分块与存储

- 分割器：`RecursiveCharacterTextSplitter.fromLanguage('markdown')`
- 默认配置：chunkSize=1500，chunkOverlap=200
- ID 生成：UUIDv7
- 向量表：`case_material_embeddings`
- 元数据结构：

```typescript
interface ContentEmbeddingMetadata {
  source: 'doc' | 'audio' | 'image' | 'text'
  userId: number
  sourceId: number       // ossFileId 或 materialId
  sourceName: string     // 原始文件名或材料名称
  last_embedding_at: string
  chunkIndex: number
}
```

### 去重机制

每次嵌入前先删除已有向量记录（`deleteContentEmbeddings`），避免重复嵌入产生冗余数据。

### 批量嵌入

`ensureMaterialsEmbeddedService(materials, userId)` 并行嵌入所有未嵌入材料，返回统计：

```typescript
{ total, success, failed, skipped }
```

内容为空或材料不存在时标记为 `skipped`。

## 摘要生成

`materialSummary.service.ts` 在上下文超出 token 阈值时为材料生成 LLM 摘要：

- 使用 `material_summarizer` 节点获取模型和提示词配置
- 内容超过 50000 字符时截断
- 并发限制 5 路
- 生成的摘要缓存到 `caseMaterials.summary` 字段
- 失败时回退到内容前 200 字符截断

## 材料上下文构建

`getMaterialContextService` 按 token 预算构建材料上下文，供 Agent/Workflow 使用：

1. 按优先级排序材料：CASE_CONTENT(10) > DOCUMENT(8) > IMAGE(5) > AUDIO(3)
2. 逐份材料累加 token，预算内注入全文，超出降级为摘要
3. Token 阈值默认 32000
4. Token 估算：中文约 2 字符/token，英文约 4 字符/token

输出模式：`full`（全部全文）、`summary`（全部摘要）、`graded`（混合）、`empty`

### 内容获取

`fetchMaterialContents` 按类型从不同表并行获取内容：
- 文本 → `textContentRecords.content`（按 materialId）
- 文档 → `docRecognitionRecords.markdownContent`（按 ossFileId，取最新）
- 图片 → `imageRecognitionRecords.markdownContent`（按 ossFileId，取最新）
- 音频 → `asrRecords.summary`（按 ossFileId，优先 summary，fallback 到 result JSON）

### 上下文消息格式化

`buildMaterialContextMessage` 生成供 Agent 使用的上下文消息：

```
以下是本案件的材料内容（共 N 份，X 份全文 + Y 份摘要）。
摘要材料需要详细内容时请使用 search_case_materials 工具，传入 sourceId 精确检索。

## [sourceId=123] 证据材料.pdf [全文]
（完整内容）

## [sourceId=456] 录音证据.mp3 [摘要]
（摘要内容）
```

`buildIncrementalMaterialMessage` 用于增量材料场景（新增材料时的上下文更新）。

## 材料检索

`searchMaterialsService` 支持三种模式：

1. **query only**：语义搜索，通过 caseId 限定材料范围
2. **query + sourceId**：语义搜索，限定到指定 sourceId
3. **sourceId only**（无 query）：精确查询完整内容

有 query 时调用 `retrievalRouterService`（统一检索路由器），无 query 时直接从识别表获取完整内容。

## 已知陷阱

1. **重复识别防护**：所有识别服务都检查已有成功记录，通过 `taskId: 'existing'` 标记跳过
2. **图片大小限制**：OCR 模型有 10MB 限制，超大图片可能失败
3. **识别记录只在成功时创建**：MinerU 失败不创建 `docRecognitionRecords`，不扣积分
4. **嵌入失败不影响主流程**：向量化失败仅记录日志，材料仍标记为 COMPLETED
5. **异步处理返回 PROCESSING**：MinerU 和 ASR 是异步的，`processMaterialService` 返回 PROCESSING 状态，pipeline 后续嵌入会因内容为空而失败（预期行为）
6. **异常时状态回退**：处理异常时材料状态回退为 PENDING，允许重试
7. **MinerU 任务不可后台重试**：文件通过签名 URL 访问，URL 过期后无法重新提交
8. **ASR 使用预扣积分模式**：提交时预扣，完成时结算，失败时回滚
9. **OSS 回调失败兜底（2026-05-08）**：OSS 直传成功但 LexSeek `/storage/callback` 写入失败时，`useFileUploadWorker` 自动调 `POST /api/v1/storage/confirm-upload`，由后端 `verifyAndFixOssFileService` head OSS 校对真实状态并修复 `ossFiles.status`。前端不会再报"上传失败"。详见 [infra/storage-oss.md §5.4](../infra/storage-oss.md)

## 相关文档

- [tech-docs/backend/retrieval.md](./retrieval.md) - 检索系统（材料检索的底层实现）
- [tech-docs/backend/agent.md](./agent.md) - Agent Worker（调用材料处理的上层）
- [tech-docs/patterns/service-dao.md](../patterns/service-dao.md) - Service-DAO 分层模式
- [tech-docs/architecture/data-model.md](../architecture/data-model.md) - 数据模型
