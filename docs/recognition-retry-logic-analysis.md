# 文件识别重试逻辑分析

## 概述

本文档分析三种文件识别方式的重试逻辑和记录处理机制:
1. 图片识别 (浏览器端 base64)
2. PDF/DOC 识别 (MinerU 服务)
3. DOCX/TXT/Markdown 识别 (浏览器端)
4. 音频识别 (阿里云百炼 ASR)

## 1. 图片识别 (浏览器端 base64)

### 文件位置
- API: `lexseek/server/api/v1/recognition/image.post.ts`
- Service: `lexseek/server/services/material/ocr.service.ts` - `createImageRecognitionByBase64Service`

### 重试逻辑

```typescript
// 2. 检查是否已有识别记录
const existingRecord = await findImageRecognitionByOssFileIdDao(ossFileId, tx)
if (existingRecord) {
    // ✅ 如果已有成功的识别记录,直接返回
    if (existingRecord.status === ImageRecognitionStatus.COMPLETED) {
        return {
            record: existingRecord,
            success: true,
        }
    }
    
    // ✅ 如果是失败或处理中的记录,删除旧记录,重新识别
    logger.info('检测到失败的识别记录,将重新识别', {
        recordId: existingRecord.id,
        ossFileId,
        oldStatus: existingRecord.status,
    })
    
    // 软删除旧记录
    await (tx || prisma).imageRecognitionRecords.update({
        where: { id: existingRecord.id },
        data: { deletedAt: new Date() },
    })
}

// 继续创建新的识别记录...
```

### 记录处理
- **成功记录**: 保留不变,直接返回
- **失败记录**: 软删除(设置 `deletedAt`),创建新记录
- **处理中记录**: 软删除,创建新记录

### 优点
- 避免重复识别已成功的图片
- 失败记录可以无限次重试
- 保留历史记录,方便追溯和调试

---

## 2. PDF/DOC 识别 (MinerU 服务)

### 文件位置
- Service: `lexseek/server/services/material/mineru.service.ts` - `submitPdfConversionService`

### 重试逻辑

```typescript
// ❌ 没有检查是否已有识别记录,直接创建新记录

// 7. 创建任务记录
const task = await createMineruTaskService({
    taskId,
    ossFileId,
    userId,
    status: MineruTaskStatus.PROCESSING,
    taskRawData: {...},
})

// 8. 创建文档识别记录
await createDocRecognitionRecordDao({
    userId,
    ossFileId,
    status: DocRecognitionStatus.PROCESSING,
})
```

### 记录处理
- **任何情况**: 都会创建新的 `mineruTasks` 记录和 `docRecognitionRecords` 记录
- **问题**: 重试时会创建重复的记录

### 潜在问题
1. 数据库中会有多条相同 `ossFileId` 的记录
2. 可能导致数据不一致
3. 浪费数据库空间

### 建议修复
应该添加检查逻辑:
```typescript
// 检查是否已有识别记录
const existingRecord = await findDocRecognitionByOssFileIdDao(ossFileId)
if (existingRecord) {
    // 如果已有成功的记录,直接返回
    if (existingRecord.status === DocRecognitionStatus.SUCCESS) {
        return { success: true, task: null }
    }
    
    // 如果是失败或处理中的记录,软删除后重新识别
    await (tx || prisma).docRecognitionRecords.update({
        where: { id: existingRecord.id },
        data: { deletedAt: new Date() },
    })
}
```

---

## 3. DOCX/TXT/Markdown 识别 (浏览器端)

### 文件位置
- API: `lexseek/server/api/v1/recognition/doc/save.post.ts`
- Composable: `lexseek/app/composables/useDocxRecognition.ts`

### 重试逻辑

```typescript
// 查询是否已有识别记录
let record = await findDocRecognitionByOssFileIdDao(ossFileId)

if (record) {
    // ✅ 更新现有记录
    record = await updateDocRecognitionRecordDao(record.id, {
        status: DocRecognitionStatus.SUCCESS,
        htmlContent,
        markdownContent,
    })
} else {
    // 创建新记录
    record = await createDocRecognitionRecordDao({
        userId: user.id,
        ossFileId,
        status: DocRecognitionStatus.SUCCESS,
    })

    // 更新内容
    record = await updateDocRecognitionRecordDao(record.id, {
        htmlContent,
        markdownContent,
    })
}
```

### 记录处理
- **已有记录**: 更新现有记录的内容和状态
- **无记录**: 创建新记录

### 优点
- 不会创建重复记录
- 重试时会覆盖之前的失败结果
- 数据库中每个 `ossFileId` 只有一条记录

---

## 4. 音频识别 (阿里云百炼 ASR)

### 文件位置
- API: `lexseek/server/api/v1/recognition/audio/index.post.ts`
- Service: `lexseek/server/services/material/asr.service.ts` - `submitAsrTaskService`

### 重试逻辑

```typescript
// ❌ 没有检查是否已有识别记录,直接创建新记录

// 9. 创建 ASR 任务记录
const task = await createAsrTaskService({
    taskId,
    status: AsrTaskStatus.PROCESSING,
    taskRawData: {...},
})

// 10. 创建 ASR 识别记录（包含临时文件路径，用于后续清理）
const record = await createAsrRecordDao({
    userId,
    ossFileId,
    asrTasksId: task.id,
    status: AsrRecordStatus.PROCESSING,
    audioUrl,
    tempFilePath: tempFilePath || undefined,
})
```

### 临时文件处理
- **加密文件**: 前端解密后上传到 `temp/asr/` 目录
- **识别完成**: 临时文件会被自动删除
- **识别失败**: 临时文件也会被删除

### 重试机制问题

#### 问题 1: 临时文件已删除
当识别失败后,临时文件已被删除,重试时:
1. 前端需要重新解密文件
2. 重新上传到临时目录
3. 获取新的临时文件路径
4. 提交新的识别任务

#### 问题 2: 重复记录
每次重试都会创建新的 `asrTasks` 和 `asrRecords` 记录

### 前端重试流程

查看 `lexseek/app/composables/useAudioRecognition.ts`:

```typescript
// 先检查是否已有识别记录（不会触发新任务）
const existingRecord = await checkAudioRecognitionStatus(file.id);

if (existingRecord.hasRecord && existingRecord.recordId) {
    // 已有识别记录，根据状态处理
    if (existingRecord.status === AsrRecordStatus.SUCCESS) {
        // 已识别成功，直接标记成功
        return;
    }

    if (existingRecord.status === AsrRecordStatus.FAILED) {
        // 之前识别失败，需要重新提交
        // ✅ 会重新解密、上传、提交
    } else if (existingRecord.status === AsrRecordStatus.PROCESSING) {
        // 正在处理中，直接开始轮询
        await pollAudioTaskStatus(existingRecord.recordId);
        return;
    }
}

// 提交新任务
if (file.encrypted) {
    // ✅ 加密文件：前端解密后上传临时文件
    submitResult = await submitEncryptedAudioRecognition(file, ...);
} else {
    // 未加密文件：直接提交
    submitResult = await submitAudioRecognition(file.id);
}
```

### 记录处理
- **任何情况**: 都会创建新的 `asrTasks` 和 `asrRecords` 记录
- **临时文件**: 每次重试都会重新上传

### 潜在问题
1. 数据库中会有多条相同 `ossFileId` 的记录
2. 重试成本高(需要重新解密和上传)
3. 可能导致数据不一致

### 建议修复
应该添加检查逻辑:
```typescript
// 检查是否已有识别记录
const existingRecord = await findAsrRecordByOssFileIdDao(ossFileId)
if (existingRecord) {
    // 如果已有成功的记录,直接返回
    if (existingRecord.status === AsrRecordStatus.SUCCESS) {
        return { success: true, task: null, record: existingRecord }
    }
    
    // 如果是失败或处理中的记录,软删除后重新识别
    await (tx || prisma).asrRecords.update({
        where: { id: existingRecord.id },
        data: { deletedAt: new Date() },
    })
    
    // 同时软删除关联的任务记录
    if (existingRecord.asrTasksId) {
        await (tx || prisma).asrTasks.update({
            where: { id: existingRecord.asrTasksId },
            data: { deletedAt: new Date() },
        })
    }
}
```

---

## 总结对比

| 识别类型 | 检查已有记录 | 成功记录处理 | 失败记录处理 | 是否创建重复记录 |
|---------|------------|------------|------------|----------------|
| 图片识别 | ✅ 是 | 直接返回 | 软删除,创建新记录 | ❌ 否 |
| PDF/DOC | ❌ 否 | - | - | ✅ 是 |
| DOCX/TXT/MD | ✅ 是 | 更新现有记录 | 更新现有记录 | ❌ 否 |
| 音频识别 | ❌ 否 | - | - | ✅ 是 |

## 建议

### 立即修复
1. **PDF/DOC 识别**: 添加记录检查逻辑,避免重复记录
2. **音频识别**: 添加记录检查逻辑,避免重复记录

### 统一标准
建议所有识别服务采用统一的重试逻辑:
1. 检查是否已有识别记录
2. 如果有成功记录,直接返回
3. 如果有失败/处理中记录,软删除后重新识别
4. 保留历史记录,方便追溯和调试

---

## 修复实施 ✅

### 1. PDF/DOC 识别（MinerU）- ✅ 已修复

**文件**: `lexseek/server/services/material/mineru.service.ts`  
**函数**: `submitPdfConversionService`  
**修复时间**: 2026-01-17

**修复内容**:
- 在创建文档识别记录前（第 7 步）添加了记录检查逻辑
- 成功记录：直接返回虚拟 task 对象，避免重复识别
- 失败/处理中记录：软删除旧记录和关联任务，重新识别

**修复后的逻辑**:
```typescript
// 7. 检查是否已有识别记录
const existingRecord = await findDocRecognitionByOssFileIdDao(ossFileId)
if (existingRecord) {
    // 如果已有成功的识别记录，直接返回
    if (existingRecord.status === DocRecognitionStatus.SUCCESS) {
        logger.info(`文档已存在成功的识别记录，直接返回：ossFileId=${ossFileId}, recordId=${existingRecord.id}`)
        return {
            success: true,
            // 返回一个虚拟的 task 对象，表示任务已完成
            task: {
                id: 0,
                taskId: 'existing',
                ossFileId,
                userId,
                status: MineruTaskStatus.SUCCESS,
            } as any,
        }
    }

    // 如果是失败或处理中的记录，软删除旧记录，重新识别
    logger.info(`检测到失败/处理中的识别记录，将重新识别：recordId=${existingRecord.id}, ossFileId=${ossFileId}, oldStatus=${existingRecord.status}`)

    // 软删除旧的文档识别记录
    await prisma.docRecognitionRecords.update({
        where: { id: existingRecord.id },
        data: { deletedAt: new Date() },
    })

    // 查找并软删除关联的任务记录
    const relatedTasks = await prisma.mineruTasks.findMany({
        where: {
            ossFileId,
            deletedAt: null,
        },
    })
    for (const relatedTask of relatedTasks) {
        await prisma.mineruTasks.update({
            where: { id: relatedTask.id },
            data: { deletedAt: new Date() },
        })
        logger.info(`软删除关联的 MinerU 任务记录：taskId=${relatedTask.taskId}`)
    }
}
```

### 2. 音频识别 - ✅ 已修复

**文件**: `lexseek/server/services/material/asr.service.ts`  
**函数**: `submitAsrTaskService`  
**修复时间**: 2026-01-17

**修复内容**:
- 修改了第 4 步的记录检查逻辑
- 成功记录：直接返回现有记录和虚拟 task 对象，避免重复识别
- 失败/处理中记录：软删除旧记录、关联任务和临时文件，重新识别

**修复后的逻辑**:
```typescript
// 4. 检查是否已有识别记录
const existingRecord = await findAsrRecordByOssFileIdDao(ossFileId)
if (existingRecord) {
    // 如果已有成功的识别记录，直接返回
    if (existingRecord.status === AsrRecordStatus.SUCCESS) {
        logger.info(`音频已存在成功的识别记录，直接返回：ossFileId=${ossFileId}, recordId=${existingRecord.id}`)
        return {
            success: true,
            record: existingRecord,
            // 返回一个虚拟的 task 对象，表示任务已完成
            task: {
                id: existingRecord.asrTasksId || 0,
                taskId: 'existing',
                status: AsrTaskStatus.SUCCESS,
            } as any,
        }
    }

    // 如果是失败或处理中的记录，软删除旧记录，重新识别
    logger.info(`检测到失败/处理中的识别记录，将重新识别：recordId=${existingRecord.id}, ossFileId=${ossFileId}, oldStatus=${existingRecord.status}`)

    // 软删除旧的 ASR 识别记录
    await prisma.asrRecords.update({
        where: { id: existingRecord.id },
        data: { deletedAt: new Date() },
    })

    // 如果有关联的任务记录，也软删除
    if (existingRecord.asrTasksId) {
        const relatedTask = await prisma.asrTasks.findFirst({
            where: { id: existingRecord.asrTasksId, deletedAt: null },
        })
        if (relatedTask) {
            await prisma.asrTasks.update({
                where: { id: relatedTask.id },
                data: { deletedAt: new Date() },
            })
            logger.info(`软删除关联的 ASR 任务记录：taskId=${relatedTask.taskId}`)
        }
    }

    // 清理旧记录的临时文件（如果有）
    if (existingRecord.tempFilePath) {
        try {
            await deleteFileService(existingRecord.tempFilePath)
            logger.info(`清理旧记录的临时音频文件：${existingRecord.tempFilePath}`)
        } catch (deleteError) {
            // 删除失败只记录日志，不影响主流程
            logger.warn(`清理旧记录的临时音频文件失败：${existingRecord.tempFilePath}`, deleteError)
        }
    }
}
```

### 修复效果

修复后，所有识别服务都采用了统一的重试逻辑：

| 识别类型 | 检查已有记录 | 成功记录处理 | 失败记录处理 | 是否创建重复记录 |
|---------|------------|------------|------------|----------------|
| 图片识别 | ✅ 是 | 直接返回 | 软删除,创建新记录 | ❌ 否 |
| PDF/DOC | ✅ 是 | 直接返回 | 软删除,创建新记录 | ❌ 否 |
| DOCX/TXT/MD | ✅ 是 | 更新现有记录 | 更新现有记录 | ❌ 否 |
| 音频识别 | ✅ 是 | 直接返回 | 软删除,创建新记录 | ❌ 否 |

**关键改进**:
1. ✅ 避免了重复识别已成功的文件
2. ✅ 失败记录可以无限次重试
3. ✅ 保留历史记录，方便追溯和调试
4. ✅ 统一了所有识别服务的重试逻辑
5. ✅ 音频识别会自动清理旧的临时文件
