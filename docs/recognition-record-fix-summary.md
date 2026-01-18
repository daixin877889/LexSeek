# 识别记录修复总结

## 问题描述

之前的实现中，识别记录在提交任务时就创建了（状态为 `PROCESSING`），识别失败时会更新状态为 `FAILED`。这是错误的设计。

**正确的设计逻辑**：
- **识别记录只在识别成功时创建**
- **识别失败时不应该创建识别记录**
- ASR 和 MinerU 通过**任务记录**来记录识别状态（处理中、成功、失败）

## 修复内容

### 1. MinerU 服务 (`mineru.service.ts`)

✅ **已完成修复**

- **移除**：`submitPdfConversionService` 中创建识别记录的代码
- **修改**：`completeConversionService` 在识别成功时创建或更新识别记录
- **修改**：`failConversionService` 移除更新识别记录的逻辑
- **简化**：`submitPdfConversionService` 的检查逻辑，只检查是否已有成功记录

### 2. ASR 服务 (`asr.service.ts`)

✅ **已完成修复**

#### 2.1 移除提交时创建识别记录

- **位置**：`submitAsrTaskService` 函数
- **修改**：移除了第 10 步创建识别记录的代码
- **原因**：识别记录只在识别成功时创建

#### 2.2 在任务数据中存储必要信息

- **位置**：`submitAsrTaskService` 函数
- **修改**：在 `taskRawData` 中存储 `ossFileId`、`userId` 和 `tempFilePath`
- **原因**：识别成功时需要这些信息来创建识别记录

#### 2.3 修改识别成功处理

- **位置**：`completeTranscriptionService` 函数
- **修改**：
  1. 从 `taskRawData` 中提取 `ossFileId`、`userId` 和 `tempFilePath`
  2. 检查是否已有识别记录
  3. 如果已存在，更新识别记录
  4. 如果不存在，创建新的识别记录（识别成功时才创建）
  5. 扣减积分、触发向量化、清理临时文件

#### 2.4 修改识别失败处理

- **位置**：`failTranscriptionService` 函数
- **修改**：
  1. 移除更新识别记录的逻辑
  2. 只更新任务状态为失败
  3. 从 `taskRawData` 中提取 `tempFilePath` 并清理临时文件
  4. 不扣减积分

#### 2.5 简化提交时的检查逻辑

- **位置**：`submitAsrTaskService` 函数
- **修改**：
  1. 移除对失败/处理中记录的处理逻辑
  2. 只检查是否已有成功的识别记录
  3. 如果已有成功记录，直接返回
  4. 移除 `oldTaskId` 相关的重试逻辑

### 3. 图片识别服务 (`ocr.service.ts`)

✅ **已完成修复**

#### 3.1 修改 `createImageRecognitionByBase64Service`

- **修改**：识别失败时不创建 `FAILED` 状态的识别记录
- **原因**：识别失败时不应该有识别记录

#### 3.2 修改 `createImageConversionService`

- **修改**：识别失败时不创建 `FAILED` 状态的识别记录
- **原因**：识别失败时不应该有识别记录

## 设计原则

### 识别记录 (Recognition Records)

- **创建时机**：只在识别成功时创建
- **用途**：存储识别成功的结果（Markdown、HTML、向量 ID 等）
- **表**：
  - `docRecognitionRecords`：PDF/DOC 识别记录
  - `asrRecords`：音频识别记录
  - `imageRecognitionRecords`：图片识别记录

### 任务记录 (Task Records)

- **创建时机**：提交任务时创建
- **用途**：记录每次提交到第三方服务的任务状态（处理中、成功、失败）
- **表**：
  - `mineruTasks`：MinerU 任务记录
  - `asrTasks`：ASR 任务记录

### 查询逻辑

- 查询识别记录时，排除 `SUPERSEDED` 状态的记录
- 确保一个 `ossFileId` 只有一条有效的识别记录

## 保留的功能

- **插入识别记录时检查是否有有效记录**：保留此逻辑，用于后续可能的重新识别功能
- **更新操作**：识别成功时，如果已有识别记录则更新，否则创建新记录

## 影响范围

### 前端

- 前端提交识别任务后，不会立即获得识别记录
- 需要通过任务记录来查询识别状态
- 识别成功后才能查询到识别记录

### 后台管理

- MinerU 后台重试功能已禁用（前端直传文件，后台无法重试）
- ASR 非加密文件可以后台重试（使用 OSS 临时链接）
- ASR 加密文件不支持后台重试（临时文件已删除）

## 测试建议

1. **测试识别成功场景**：
   - 提交识别任务
   - 等待识别完成
   - 验证识别记录已创建且状态为成功

2. **测试识别失败场景**：
   - 提交识别任务（使用会失败的文件）
   - 等待识别失败
   - 验证没有创建识别记录
   - 验证任务记录状态为失败

3. **测试重复提交场景**：
   - 提交识别任务
   - 等待识别成功
   - 再次提交相同文件
   - 验证直接返回已有的识别记录

4. **测试加密文件场景**：
   - 提交加密文件识别任务
   - 验证临时文件在识别成功/失败后被清理

## 相关文档

- `lexseek/docs/recognition-retry-logic-analysis.md`：识别重试逻辑分析
- `lexseek/docs/recognition-retry-and-history-solution.md`：识别重试和历史记录解决方案
- `lexseek/docs/image-recognition-encrypted-file-issue.md`：图片识别加密文件问题

## 修复日期

2026-01-17

## 数据库 Schema 更新

### 添加 `is_encrypted` 字段

**日期**：2026-01-17

**修改内容**：
- 在 `mineruTasks` 表中添加 `isEncrypted Boolean @default(false) @map("is_encrypted")` 字段
- 在 `asrTasks` 表中添加 `isEncrypted Boolean @default(false) @map("is_encrypted")` 字段

**用途**：
- 标记任务是否为加密文件
- 用于后台重试时判断是否支持重试（加密文件不支持后台重试）

**更新方式**：
- 使用 `bun prisma db push` 直接更新数据库
- 使用 `bun prisma generate` 重新生成 Prisma Client

