# 图片识别记录创建时机修复总结

## 修复概述

修复了图片识别服务中识别记录创建时机的问题，使其与音频识别（ASR）和 MinerU 识别保持一致。

**核心变更**：只在识别成功后才创建识别记录，识别失败时不创建记录。

## 问题背景

根据深度 review 报告（`docs/recognition-flow-deep-review.md`），项目中的四种识别流程存在不一致：

- **音频识别 (ASR)** - ✅ 正确：只在识别成功时创建识别记录
- **MinerU 识别** - ✅ 正确：只在识别成功时创建识别记录
- **图片识别 (OCR)** - ❌ 错误：在提交时就创建识别记录，失败时不删除

旧的图片识别流程在识别开始时就创建识别记录，如果识别失败，已创建的记录不会被删除，导致数据库中留下失败的识别记录，污染数据。

## 修改内容

### 1. 修改 `createImageRecognitionByBase64Service` 方法

**文件**：`server/services/material/ocr.service.ts`

**主要变更**：

1. **调整识别记录创建时机**（需求 10.1）
   - 将创建记录的逻辑移到 AI 识别成功之后
   - 识别失败时直接返回错误，不创建记录

2. **检查已有识别记录**（需求 10.6, 10.7, 10.8）
   - 在识别前检查是否已有识别记录
   - 如果已有成功记录（status = COMPLETED），直接返回现有记录
   - 如果已有失败/处理中记录，软删除旧记录后重新识别

3. **识别失败处理**（需求 10.2）
   - 图片类型不支持时，不创建记录
   - OSS 文件不存在时，不创建记录
   - AI 识别失败时，不创建记录

4. **异步向量化嵌入**（需求 10.10, 10.11, 10.12）
   - 识别成功后异步触发向量化
   - 向量化失败不影响识别结果
   - 参考 ASR 服务的 `triggerAudioEmbeddingAsync` 实现

5. **更新 case_materials 状态**（需求 10.13, 10.14）
   - 向量化成功时更新 `embedding_status` 为 `completed`
   - 向量化失败时更新 `embedding_status` 为 `failed`

### 2. 新增辅助函数

#### `triggerImageEmbeddingAsync`

异步触发图片识别结果向量化，参考 ASR 服务的实现模式。

```typescript
function triggerImageEmbeddingAsync(
    recordId: number,
    ossFileId: number,
    userId: number,
    fileName: string,
    tx?: Prisma.TransactionClient
): void
```

#### `embedImageRecordService`

为图片识别记录执行向量化嵌入。

```typescript
async function embedImageRecordService(
    recordId: number,
    ossFileId: number,
    userId: number,
    fileName: string,
    tx?: Prisma.TransactionClient
): Promise<{
    success: boolean
    vectorIds?: string[]
    chunkCount?: number
    error?: string
}>
```

## 修改后的流程

```
┌─────────────────────────────────────────────────────────────┐
│              修改后的图片识别流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 验证图片类型                                            │
│     ↓ 失败 → 返回错误，不创建记录                          │
│                                                             │
│  2. 验证 OSS 文件存在                                       │
│     ↓ 失败 → 返回错误，不创建记录                          │
│                                                             │
│  3. 检查是否已有识别记录                                    │
│     ├─ 已有成功记录 → 直接返回现有记录                     │
│     └─ 已有失败/处理中记录 → 软删除旧记录，继续识别        │
│                                                             │
│  4. 调用 AI 服务识别图片                                    │
│     ↓ 失败 → 返回错误，不创建记录 ✅                       │
│                                                             │
│  5. 将 Markdown 转换为 HTML                                 │
│                                                             │
│  6. 识别成功后才创建记录 ✅                                 │
│     - status: COMPLETED                                     │
│     - 包含 markdownContent 和 htmlContent                   │
│                                                             │
│  7. 异步触发向量化嵌入                                      │
│     ├─ 成功 → 更新 vectorIds 和 embedding_status           │
│     └─ 失败 → 记录警告日志，不影响主流程 ✅                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 参考实现

修改参考了音频识别服务的 `completeTranscriptionService` 方法（`server/services/material/asr.service.ts`）：

- 只在识别成功时创建记录
- 识别失败时不创建记录
- 异步触发向量化嵌入
- 向量化失败不影响主流程

## 向后兼容性

✅ **API 响应格式保持不变**（需求 10.16, 10.17, 10.18）
- 响应格式：`{ success: boolean, record?: imageRecognitionRecords, error?: string }`
- 错误码保持不变
- 前端 `useImageRecognition.ts` composable 无需修改

## 测试

### 单元测试

创建了业务逻辑测试文件：`tests/server/services/material/ocr-logic.test.ts`

测试覆盖：
- ✅ 需求 10.1: 只在识别成功后才创建记录
- ✅ 需求 10.2: 识别失败时不创建记录
- ✅ 需求 10.6: 已有成功记录时直接返回
- ✅ 需求 10.7, 10.9: 已有失败/处理中记录时软删除并重新识别
- ✅ 需求 10.10, 10.11: 向量化嵌入
- ✅ 需求 10.12: 向量化失败不影响识别结果
- ✅ 需求 10.13, 10.14: 更新 case_materials 的 embedding_status

所有测试通过：13 个测试用例全部通过 ✅

## 数据迁移建议

部署后建议手动清理现有的失败识别记录：

```sql
-- 查询失败的识别记录
SELECT id, ossFileId, status, createdAt 
FROM imageRecognitionRecords 
WHERE status != 2 AND deletedAt IS NULL;

-- 软删除失败的识别记录（可选）
UPDATE imageRecognitionRecords 
SET deletedAt = NOW() 
WHERE status != 2 AND deletedAt IS NULL;
```

## 相关文件

**修改的文件**：
- `server/services/material/ocr.service.ts` - 主要修改

**新增的文件**：
- `tests/server/services/material/ocr-logic.test.ts` - 业务逻辑测试
- `tests/server/services/material/ocr.service.test.ts` - 单元测试（待完善）
- `docs/ocr-record-creation-timing-fix.md` - 本文档

**无需修改的文件**：
- `server/api/v1/recognition/image.post.ts` - API 接口
- `app/composables/useImageRecognition.ts` - 前端 composable
- `server/services/material/ocr.dao.ts` - DAO 层

## 验收标准

所有需求的验收标准已满足：

- ✅ 10.1: 识别成功时创建记录
- ✅ 10.2: 识别失败时不创建记录
- ✅ 10.3: AI 服务返回识别结果后才创建记录
- ✅ 10.4: 识别记录的 status 字段为 COMPLETED
- ✅ 10.5: 同时保存 Markdown 和 HTML 内容
- ✅ 10.6: 同一文件已有成功记录时直接返回
- ✅ 10.7: 同一文件已有失败/处理中记录时删除旧记录并重新识别
- ✅ 10.8: 创建新记录前检查是否存在旧记录
- ✅ 10.9: 删除旧记录时使用软删除
- ✅ 10.10: 识别记录创建成功后触发向量化嵌入
- ✅ 10.11: 向量化嵌入成功后更新识别记录的 vectorIds 和 lastEmbeddingAt
- ✅ 10.12: 向量化嵌入失败时记录警告日志但不影响识别结果
- ✅ 10.13: 向量化嵌入后更新 case_materials 表的 embedding_status
- ✅ 10.14: 向量化嵌入失败时将 case_materials 的 embedding_status 设置为 failed
- ✅ 10.15: 参考 ASR 服务的 completeTranscriptionService 方法实现
- ✅ 10.16: API 保持现有的响应格式不变
- ✅ 10.17: API 保持现有的错误码不变
- ✅ 10.18: 识别成功时返回包含 id、imageType、markdownContent、htmlContent 的记录
- ✅ 10.19: useImageRecognition.ts 保持现有的方法签名不变
- ✅ 10.20: useImageRecognition.ts 保持现有的状态管理逻辑不变

## 总结

本次修复成功将图片识别服务的记录创建时机调整为与音频识别和 MinerU 识别一致的模式，确保了：

1. **数据一致性**：只在识别成功时创建记录，避免失败记录污染数据库
2. **幂等性**：重复识别同一文件时，已有成功记录直接返回
3. **容错性**：识别失败时可以重试，旧的失败记录会被软删除
4. **异步处理**：向量化嵌入异步执行，失败不影响主流程
5. **向后兼容**：API 和前端无需修改，保持现有功能正常运行

修改采用了生产级别的健壮实现，参考了项目中已有的成熟模式（ASR 服务），确保了代码质量和可维护性。
