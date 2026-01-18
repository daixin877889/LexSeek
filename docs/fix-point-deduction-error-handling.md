# 修复积分扣减失败时的错误处理

## 问题描述

### 问题 1：识别完成后积分扣减失败

在 ASR 和 MinerU 识别服务中，当识别成功但积分扣减失败时：

1. **后端行为**：只记录日志，但任务状态仍然标记为"成功"
2. **前端行为**：通过轮询看到"成功"状态，没有任何错误提示
3. **用户体验**：用户看到识别成功，但实际上积分扣减失败了

**错误日志示例**：
```
ERROR  [22:13:40.700][LexSeek][ERROR] ASR 转录积分扣减失败： Error: 积分不足，需要 50，可用 10
```

### 问题 2：提交时积分检查不准确（更严重）

**最严重的问题**：

1. **提交时检查**：只检查了 1 分钟的积分（因为不知道实际时长）
2. **识别执行**：任务提交成功，识别服务开始处理
3. **完成时扣减**：根据实际时长扣减积分，可能需要 50 分钟
4. **结果**：提交时积分检查通过（有 10 积分 > 1 分钟所需），但完成时积分不足（10 积分 < 50 分钟所需）

**问题根源**：
- 在提交时无法知道音频的实际时长
- 只能按 1 分钟进行积分检查
- 导致资源浪费：识别已经完成，但积分不足

## 解决方案

### 方案 1：前端传递音频时长（已实施）

**实现方式**：
1. 前端在上传音频文件时获取音频时长
2. 在提交识别任务时，将音频时长作为参数传递给后端
3. 后端使用实际时长进行积分检查
4. 如果积分不足，直接拒绝提交，不创建任务

**优点**：
- 避免浪费识别资源
- 用户在提交时就知道积分不足
- 不会出现"识别成功但积分扣减失败"的情况
- 前端已经有音频文件，可以轻松获取时长

**缺点**：
- 需要修改前端代码，传递音频时长参数

### 方案 2：识别完成后积分扣减失败时标记为失败（已实施）

当积分扣减失败时：
1. 将任务状态标记为"失败"
2. 将识别记录状态标记为"失败"
3. 清理临时文件（ASR 加密文件）
4. 抛出错误，让调用方知道失败了

## 修复内容

### 1. API 接口 (`/api/v1/recognition/audio/index.post.ts`)

添加 `audioDuration` 参数验证：

```typescript
const bodySchema = z.object({
    ossFileId: z.number()
        .int()
        .positive('ossFileId 必须为正整数')
        .describe('OSS 文件 ID'),
    audioDuration: z.number()  // ✅ 新增：音频时长（秒）
        .int()
        .positive('audioDuration 必须为正整数')
        .describe('音频时长（秒）'),
    tempFilePath: z.string()
        .optional()
        .describe('临时文件路径（加密文件解密后上传的路径）'),
    options: z.object({
        languageHints: z.array(z.string())
            .optional()
            .default(['zh', 'en'])
            .describe('语言提示，默认 ["zh", "en"]'),
        diarizationEnabled: z.boolean()
            .optional()
            .default(true)
            .describe('是否启用说话人分离，默认 true'),
    }).optional().default({}),
})
```

调用服务时传递音频时长：

```typescript
const submitResult = await transcribeAudioService(
    ossFileId,
    user.id,
    audioDuration,  // ✅ 传递音频时长
    {
        languageHints: options.languageHints,
        diarizationEnabled: options.diarizationEnabled,
    },
    tempFilePath
)
```

### 2. ASR 服务 (`asr.service.ts`)

#### 2.1 更新 `transcribeAudioService` 函数签名

```typescript
export const transcribeAudioService = async (
    ossFileId: number,
    userId: number,
    audioDuration: number,  // ✅ 新增参数
    options: AsrSubmitOptions = {},
    tempFilePath?: string
): Promise<AsrSubmitResult> => {
    const submitResult = await submitAsrTaskService(
        ossFileId, 
        userId, 
        audioDuration,  // ✅ 传递音频时长
        options, 
        tempFilePath
    )
    // ...
}
```

#### 2.2 更新 `submitAsrTaskService` 函数签名

```typescript
export const submitAsrTaskService = async (
    ossFileId: number,
    userId: number,
    audioDuration: number,  // ✅ 新增参数
    options: AsrSubmitOptions = {},
    tempFilePath?: string
): Promise<AsrSubmitResult> => {
    // ...
}
```

#### 2.3 使用实际时长进行积分检查

```typescript
// ❌ 修复前：只检查 1 分钟
const pointCheck = await checkUserPointsForAsrService(userId, 1)
if (!pointCheck.sufficient) {
    return { success: false, error: '积分不足，请先充值' }
}

// ✅ 修复后：使用实际时长
const durationMinutes = Math.ceil(audioDuration / 60)
const pointCheck = await checkUserPointsForAsrService(userId, durationMinutes)
if (!pointCheck.sufficient) {
    return { 
        success: false, 
        error: `积分不足，需要 ${pointCheck.required}，可用 ${pointCheck.available}` 
    }
}
```

#### 2.4 积分扣减失败时标记为失败

```typescript
try {
    await consumePointsService(userId, ASR_TRANSCRIBE_ITEM_KEY, durationMinutes, { sourceId: record.id })
    logger.info(`ASR 转录积分扣减成功：userId=${userId}, minutes=${durationMinutes}`)
} catch (pointError) {
    // ✅ 积分扣减失败，标记任务和识别记录为失败
    logger.error('ASR 转录积分扣减失败：', pointError)
    
    const errorMsg = pointError instanceof Error ? pointError.message : '积分扣减失败'
    
    // 更新任务状态为失败
    await updateAsrTaskService(task.id, {
        status: AsrTaskStatus.FAILED,
        result: {
            error: errorMsg,
            failed_at: new Date().toISOString(),
        },
    })
    
    // 更新识别记录状态为失败
    await updateAsrRecordDao(record.id, {
        status: AsrRecordStatus.FAILED,
    })
    
    // 清理临时文件
    if (tempFilePath) {
        try {
            await deleteFileService(tempFilePath)
            logger.info(`临时音频文件已删除：${tempFilePath}`)
            await updateAsrRecordDao(record.id, { tempFilePath: null })
        } catch (deleteError) {
            logger.warn(`临时音频文件删除失败：${tempFilePath}`, deleteError)
        }
    }
    
    // 抛出错误，让调用方知道失败了
    throw new Error(errorMsg)
}
```

### 3. MinerU 服务 (`mineru.service.ts`)

积分扣减失败时标记为失败：

```typescript
try {
    await consumePointsService(task.userId, PDF_PARSE_ITEM_KEY, pageCount, { sourceId: task.id })
    logger.info(`PDF 转换积分扣减成功：userId=${task.userId}, pages=${pageCount}`)
} catch (pointError) {
    // ✅ 积分扣减失败，标记任务和识别记录为失败
    logger.error('PDF 转换积分扣减失败：', pointError)
    
    const errorMsg = pointError instanceof Error ? pointError.message : '积分扣减失败'
    
    // 更新任务状态为失败
    await updateMineruTaskService(task.id, {
        status: MineruTaskStatus.FAILED,
        errorMsg,
        completedAt: new Date(),
    })
    
    // 更新识别记录状态为失败
    if (docRecord) {
        await updateDocRecognitionRecordDao(docRecord.id, {
            status: DocRecognitionStatus.FAILED,
        })
    }
    
    // 抛出错误，让调用方知道失败了
    throw new Error(errorMsg)
}
```

### 4. MinerU DAO (`mineru.dao.ts`)

更新 `createDocRecognitionRecordDao` 函数的类型定义，支持创建时传入 `markdownContent` 和 `htmlContent`：

```typescript
export const createDocRecognitionRecordDao = async (
    data: {
        userId: number
        ossFileId: number
        status?: number
        markdownContent?: string  // ✅ 新增
        htmlContent?: string      // ✅ 新增
    },
    tx?: Prisma.TransactionClient
): Promise<docRecognitionRecords> => {
    try {
        const record = await (tx || prisma).docRecognitionRecords.create({
            data: {
                userId: data.userId,
                ossFileId: data.ossFileId,
                status: data.status ?? DocRecognitionStatus.PENDING,
                markdownContent: data.markdownContent,  // ✅ 新增
                htmlContent: data.htmlContent,          // ✅ 新增
            },
        })
        return record
    } catch (error) {
        logger.error('创建文档识别记录失败：', error)
        throw error
    }
}
```

## 前端行为变化

### 修复前

1. 用户提交识别任务（只传递 ossFileId）
2. 后端检查 1 分钟的积分（通过）
3. 识别任务提交成功
4. 识别完成，需要 50 分钟积分
5. 积分扣减失败（只有 10 积分）
6. 前端看到"成功"状态 ✅
7. 用户以为识别成功了

### 修复后

1. 用户提交识别任务（传递 ossFileId 和 audioDuration）
2. 后端检查实际时长的积分（50 分钟）
3. 积分不足（只有 10 积分）
4. 后端直接拒绝提交 ❌
5. 前端显示错误提示："积分不足，需要 50，可用 10"
6. 用户知道需要充值

## 前端需要修改的内容

### 1. 获取音频时长

在上传音频文件时，获取音频时长：

```typescript
// 使用 HTML5 Audio API 获取音频时长
const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
        const audio = new Audio()
        audio.onloadedmetadata = () => {
            resolve(Math.ceil(audio.duration))  // 返回秒数，向上取整
        }
        audio.onerror = () => {
            reject(new Error('无法获取音频时长'))
        }
        audio.src = URL.createObjectURL(file)
    })
}
```

### 2. 提交识别任务时传递音频时长

```typescript
// 修改 useAudioRecognition.ts 中的 submitRecognition 函数
const submitRecognition = async (
    ossFileId: number,
    audioDuration: number,  // ✅ 新增参数
    options?: AsrSubmitOptions
): Promise<SubmitRecognitionResponse | null> => {
    return await useApiFetch<SubmitRecognitionResponse>('/api/v1/recognition/audio', {
        method: 'POST',
        body: { 
            ossFileId, 
            audioDuration,  // ✅ 传递音频时长
            options 
        },
    })
}
```

### 3. 加密音频识别时传递音频时长

```typescript
// 修改 submitEncryptedAudioRecognition 函数
const submitResult = await useApiFetch<SubmitRecognitionResponse>('/api/v1/recognition/audio', {
    method: 'POST',
    body: {
        ossFileId: file.id,
        audioDuration,  // ✅ 传递音频时长
        tempFilePath: signature.key,
        options,
    },
})
```

## 影响范围

### 用户体验

- **优点**：用户在提交时就知道积分不足，不会浪费时间等待识别完成
- **缺点**：需要前端获取音频时长，可能增加一点点延迟

### 数据一致性

- **识别记录**：积分不足时，不会创建识别记录
- **任务记录**：积分不足时，不会创建任务记录

### 资源使用

- **识别服务**：积分不足时，不会调用识别服务，节省资源
- **临时文件**：积分不足时，不会上传临时文件（加密文件）

## 测试建议

1. **测试积分不足场景（提交时）**：
   - 设置用户积分为 10
   - 上传一个 60 秒的音频文件
   - 提交识别任务
   - 验证提交失败，前端显示"积分不足，需要 1，可用 0"（假设 1 分钟需要 1 积分）

2. **测试积分充足场景**：
   - 设置用户积分为 100
   - 上传一个 60 秒的音频文件
   - 提交识别任务
   - 验证识别成功，积分正确扣减

3. **测试音频时长获取**：
   - 上传不同格式的音频文件（MP3、WAV、M4A 等）
   - 验证能正确获取音频时长

4. **测试加密音频**：
   - 上传加密音频文件
   - 验证解密后能正确获取音频时长
   - 验证积分检查正确

## 修复日期

2026-01-17

## 相关文档

- `lexseek/docs/recognition-record-fix-summary.md`：识别记录修复总结
- `lexseek/docs/recognition-retry-logic-analysis.md`：识别重试逻辑分析
