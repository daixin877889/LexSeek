# MinerU 识别流程完整审查报告

## 审查日期
2026-01-18

## 审查目的
按照 ASR 识别流程的 review 标准，完整审查 MinerU（doc/pdf 识别）流程，查找设计问题和不合理之处。

---

## 一、流程概述

### 1.1 MinerU 识别流程

```
前端提交 → 上传文件到 MinerU → MinerU 处理 → 回调通知 → 服务端处理结果 → 前端轮询获取
```

### 1.2 涉及的数据表

1. **任务记录表**（`mineruTasks`）：记录 MinerU API 任务状态
2. **识别记录表**（`docRecognitionRecords`）：记录识别结果（只在成功时创建）

### 1.3 关键区别：MinerU vs ASR

| 特性 | MinerU | ASR |
|------|--------|-----|
| 文件上传方式 | 前端直传到 MinerU OSS | 前端上传到项目 OSS |
| 后台重试支持 | ❌ 不支持（前端直传） | ✅ 支持（非加密文件） |
| 轮询方式 | ✅ 使用 ossFileId 轮询识别记录 | ✅ 使用 taskId 轮询任务状态 |
| 识别记录创建时机 | ✅ 只在成功时创建 | ✅ 只在成功时创建 |

---

## 二、核心问题分析

### 🔴 问题 1：轮询机制不一致

**问题描述**：
- ASR：前端使用 `taskId` 轮询任务状态（`/api/v1/recognition/audio/task/:taskId`）
- MinerU：前端使用 `ossFileId` 轮询识别记录状态（`/api/v1/recognition/doc/status/:ossFileId`）

**为什么这是问题**：
1. **设计不一致**：同样的识别流程，使用不同的轮询方式
2. **API 混淆**：`/api/v1/recognition/doc/status/:ossFileId` 同时返回识别记录和任务信息，职责不清
3. **前端逻辑复杂**：需要理解两种不同的轮询机制

**当前实现**：

```typescript
// MinerU 前端轮询（useMineruRecognition.ts）
const pollStatus = async (ossFileId: number) => {
    while (retryCount < config.maxRetries) {
        // ❌ 使用 ossFileId 轮询识别记录
        const statusResult = await checkRecognitionStatus(ossFileId)
        
        if (statusResult.recognized) {
            return  // 识别成功
        }
        
        await sleep(delay)
    }
}

// ASR 前端轮询（useAudioRecognition.ts）
const pollTaskStatus = async (taskId: string) => {
    while (retryCount < config.maxRetries) {
        // ✅ 使用 taskId 轮询任务状态
        const result = await getTaskStatus(taskId)
        
        if (result.status === AsrTaskStatus.SUCCESS) {
            return result.recordId
        }
        
        await sleep(delay)
    }
}
```

**建议修复**：
1. 创建专门的任务状态查询 API：`GET /api/v1/recognition/mineru/task/:taskId`
2. 修改前端轮询逻辑，使用 `taskId` 而不是 `ossFileId`
3. 保持 `/api/v1/recognition/doc/status/:ossFileId` 仅用于查询识别记录（不包含任务信息）

---

### 🟡 问题 2：API 职责混乱

**问题描述**：
`/api/v1/recognition/doc/status/:ossFileId` API 同时返回：
1. 识别记录信息（`record`）
2. MinerU 任务信息（`mineruTask`）
3. 图像识别记录信息（`imageRecord`）

**为什么这是问题**：
1. **单一职责原则违反**：一个 API 做了太多事情
2. **维护困难**：修改任务查询逻辑会影响识别记录查询
3. **性能问题**：每次查询都要关联查询多个表

**当前实现**：

```typescript
// lexseek/server/api/v1/recognition/doc/status/[ossFileId].get.ts
export default defineEventHandler(async (event) => {
    // 查询文档识别记录
    let docRecord = await findDocRecognitionByOssFileIdDao(ossFileId)
    
    // 查询图像识别记录
    let imageRecord = null
    if (!docRecord) {
        imageRecord = await findImageRecognitionByOssFileIdDao(ossFileId)
    }
    
    // ❌ 还要查询 MinerU 任务
    const mineruTask = await prisma.mineruTasks.findFirst({
        where: { ossFileId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
    })
    
    // 返回所有信息
    return resSuccess(event, '查询成功', {
        recognized: isRecognized,
        status: record.status,
        recordType: docRecord ? 'doc' : 'image',
        record: { ... },
        mineruTask: { ... },  // ❌ 混合了任务信息
    })
})
```

**建议修复**：
1. 拆分 API：
   - `GET /api/v1/recognition/doc/status/:ossFileId` - 只返回识别记录
   - `GET /api/v1/recognition/mineru/task/:taskId` - 只返回任务状态
2. 前端根据需要调用不同的 API

---

### 🟢 正确的设计：识别记录创建时机

**当前实现**：✅ 正确

MinerU 服务在识别成功时才创建识别记录：

```typescript
// lexseek/server/services/material/mineru.service.ts
export async function completeConversionService(params: CompleteConversionParams) {
    // ... 处理 ZIP 文件，提取内容 ...
    
    // ✅ 只在成功时创建或更新识别记录
    let record = await findDocRecognitionByOssFileIdDao(ossFileId)
    
    if (record) {
        // 更新现有记录
        record = await updateDocRecognitionRecordDao(record.id, {
            status: DocRecognitionStatus.SUCCESS,
            htmlContent,
            markdownContent,
        })
    } else {
        // 创建新记录
        record = await createDocRecognitionRecordDao({
            userId,
            ossFileId,
            status: DocRecognitionStatus.SUCCESS,
        })
        
        record = await updateDocRecognitionRecordDao(record.id, {
            htmlContent,
            markdownContent,
        })
    }
}
```

**对比 ASR**：✅ 一致

```typescript
// lexseek/server/services/material/asr.service.ts
export async function completeTranscriptionService(params: CompleteTranscriptionParams) {
    // ✅ 只在成功时创建或更新识别记录
    let record = await findAsrRecordByOssFileIdDao(ossFileId)
    
    if (record) {
        record = await updateAsrRecordDao(record.id, {
            status: AsrRecordStatus.SUCCESS,
            content: transcription,
        })
    } else {
        record = await createAsrRecordDao({
            userId,
            ossFileId,
            status: AsrRecordStatus.SUCCESS,
        })
        
        record = await updateAsrRecordDao(record.id, {
            content: transcription,
        })
    }
}
```

---

### 🟡 问题 3：前端轮询逻辑不一致

**问题描述**：
- MinerU：前端直接轮询识别记录（`checkRecognitionStatus`）
- ASR：前端轮询任务状态（`getTaskStatus`）

**当前实现**：

```typescript
// MinerU 前端（useMineruRecognition.ts）
const recognize = async (options: MineruRecognitionOptions) => {
    // 1. 检查是否已识别
    const statusCheck = await checkRecognitionStatus(ossFileId)
    
    if (statusCheck.recognized) {
        return { ... }  // 已识别，直接返回
    }
    
    // 2. 上传文件到 MinerU
    await uploadToMineru(uploadUrl, fileContent, fileName)
    
    // 3. ❌ 轮询识别记录状态
    await pollStatus(ossFileId)
    
    // 4. 获取最终结果
    const finalStatus = await checkRecognitionStatus(ossFileId)
    return { ... }
}

// ASR 前端（useAudioRecognition.ts）
const submitEncryptedAudioRecognition = async (file: OssFileItem) => {
    // 1. 提交任务
    const submitResult = await useApiFetch('/api/v1/recognition/audio', {
        method: 'POST',
        body: { ... },
    })
    
    // 2. ✅ 返回 taskId 和 taskStatus
    return {
        taskId: submitResult.taskId,
        taskStatus: submitResult.taskStatus,
    }
}

// 前端 Vue 组件（promptInput.vue）
const submitResult = await submitAudioRecognition(file.id)

if (submitResult.taskId) {
    // ✅ 使用 taskId 轮询任务状态
    const recordId = await pollAudioTaskStatus(submitResult.taskId)
}
```

**建议修复**：
1. MinerU 提交 API 应该返回 `taskId`
2. 前端使用 `taskId` 轮询任务状态
3. 任务成功后，使用 `ossFileId` 查询识别记录

---

### 🔴 问题 4：未识别时创建了识别记录

**问题描述**：
用户报告"现在出现了未识别时创建了识别记录的问题"。

**可能的原因**：

1. **浏览器端识别（docx/markdown/txt）**：
   - 在 `saveRecognitionResult` 中，如果识别失败但仍然调用了保存 API，会创建识别记录
   - 需要检查前端是否在识别失败时仍然调用了保存 API

2. **MinerU 识别（doc/pdf）**：
   - 服务端在 `completeConversionService` 中创建识别记录
   - 如果 MinerU 回调时任务状态不是成功，但仍然调用了 `completeConversionService`，会创建识别记录

**需要验证的代码**：

```typescript
// lexseek/app/composables/useDocxRecognition.ts
const recognizeInBrowser = async (options: DocxRecognitionOptions) => {
    try {
        // ... 识别逻辑 ...
        
        // ❓ 如果识别失败，是否会调用 saveRecognitionResult？
        await saveRecognitionResult(ossFileId, htmlContent, markdownContent, fileName)
        
        updateStatus('success', 100)
        return { ... }
    } catch (error) {
        // ❌ 如果这里抛出异常，saveRecognitionResult 不会被调用
        updateStatus('error', 0, errorMessage)
        throw error
    }
}
```

**建议修复**：
1. 确保只在识别成功时调用 `saveRecognitionResult`
2. 在 `saveRecognitionResult` API 中添加状态验证
3. 在 `completeConversionService` 中添加任务状态检查

---

### 🟡 问题 5：缺少任务提交 API

**问题描述**：
MinerU 没有统一的任务提交 API，前端直接调用多个 API：
1. 申请上传链接（`/api/v1/recognition/mineru/upload-url`）
2. 上传文件（`/api/v1/recognition/mineru/upload`）
3. 轮询状态（`/api/v1/recognition/doc/status/:ossFileId`）

**对比 ASR**：
ASR 有统一的提交 API（`POST /api/v1/recognition/audio`），返回 `taskId`。

**建议修复**：
创建统一的 MinerU 提交 API：
```typescript
// POST /api/v1/recognition/mineru/submit
{
    ossFileId: number,
    fileName: string,
    encrypted?: boolean,
    // ... 其他参数
}

// 返回
{
    taskId: string,
    taskStatus: number,
}
```

---

## 三、设计对比总结

### 3.1 ASR 流程（✅ 正确）

```
1. 前端提交任务 → 返回 taskId
2. 前端使用 taskId 轮询任务状态
3. 任务成功 → 返回 recordId
4. 前端使用 recordId 查询识别结果
```

**优点**：
- 职责清晰：任务记录管理任务状态，识别记录管理识别结果
- 轮询简单：只需要 taskId
- 易于扩展：可以添加任务重试、取消等功能

### 3.2 MinerU 流程（❌ 需要改进）

```
1. 前端申请上传链接
2. 前端上传文件到 MinerU
3. 前端使用 ossFileId 轮询识别记录状态（❌ 混合了任务和识别记录）
4. 识别成功 → 直接返回识别记录
```

**缺点**：
- 职责混乱：识别记录 API 包含任务信息
- 轮询复杂：需要理解识别记录和任务的关系
- 难以扩展：无法单独查询任务状态

---

## 四、修复建议

### 4.1 短期修复（最小改动）

1. **修改 `/api/v1/recognition/doc/status/:ossFileId` API**：
   - 移除 `mineruTask` 字段
   - 只返回识别记录信息

2. **创建新的任务状态查询 API**：
   - `GET /api/v1/recognition/mineru/task/:taskId`
   - 返回任务状态和 recordId（成功时）

3. **修改前端轮询逻辑**：
   - 使用 `taskId` 轮询任务状态
   - 任务成功后，使用 `ossFileId` 查询识别记录

### 4.2 长期优化（推荐）

1. **统一提交 API**：
   - 创建 `POST /api/v1/recognition/mineru/submit`
   - 返回 `taskId` 和 `taskStatus`

2. **统一轮询机制**：
   - MinerU 和 ASR 使用相同的轮询方式（taskId）
   - 前端可以复用轮询逻辑

3. **拆分 API 职责**：
   - 任务 API：管理任务状态
   - 识别记录 API：管理识别结果
   - 不要混合两者

---

## 五、具体修复步骤

### 步骤 1：创建任务状态查询 API

**文件**：`lexseek/server/api/v1/recognition/mineru/task/[taskId].get.ts`（新建）

```typescript
/**
 * 查询 MinerU 任务状态 API
 *
 * GET /api/v1/recognition/mineru/task/:taskId
 */

import { z } from 'zod'

const paramsSchema = z.object({
    taskId: z.string().min(1, 'taskId 不能为空'),
})

interface TaskStatusResponse {
    taskId: string
    status: number  // 0-待处理，1-处理中，2-成功，3-失败
    recordId: number | null  // 识别记录 ID（成功时返回）
    errorMsg: string | null  // 错误信息（失败时返回）
}

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    const params = getRouterParams(event)
    const paramsResult = paramsSchema.safeParse(params)
    if (!paramsResult.success) {
        return resError(event, 400, paramsResult.error.issues[0]?.message || '参数错误')
    }

    const { taskId } = paramsResult.data

    try {
        // 查询任务记录
        const task = await prisma.mineruTasks.findFirst({
            where: {
                taskId,
                deletedAt: null,
            },
        })

        if (!task) {
            return resError(event, 404, '任务不存在')
        }

        // 如果任务成功，查询识别记录
        let recordId: number | null = null
        if (task.status === 2) {  // SUCCESS
            const record = await findDocRecognitionByOssFileIdDao(task.ossFileId)
            recordId = record?.id || null
        }

        const response: TaskStatusResponse = {
            taskId: task.taskId || '',
            status: task.status,
            recordId,
            errorMsg: task.errorMsg,
        }

        return resSuccess(event, '查询成功', response)
    } catch (error) {
        logger.error('查询 MinerU 任务状态失败:', error)
        return resError(event, 500, '查询任务状态失败')
    }
})
```

### 步骤 2：修改前端 Composable

**文件**：`lexseek/app/composables/useMineruRecognition.ts`

```typescript
// 添加任务状态查询方法
const getTaskStatus = async (taskId: string): Promise<TaskStatusResponse | null> => {
    return await useApiFetch<TaskStatusResponse>(
        `/api/v1/recognition/mineru/task/${taskId}`,
        { showError: false }
    )
}

// 修改轮询方法
const pollTaskStatus = async (
    taskId: string,
    config: PollingConfig = DEFAULT_POLLING_CONFIG
): Promise<number | null> => {  // 返回 recordId 或 null
    updateStatus('processing', 30)

    let retryCount = 0

    while (retryCount < config.maxRetries) {
        // ✅ 使用 taskId 轮询任务状态
        const result = await getTaskStatus(taskId)

        if (!result) {
            throw new Error('查询任务状态失败')
        }

        // 任务成功
        if (result.status === MineruTaskStatus.SUCCESS) {
            return result.recordId
        }

        // 任务失败
        if (result.status === MineruTaskStatus.FAILED) {
            throw new Error(result.errorMsg || 'MinerU 识别失败')
        }

        // 继续轮询
        const delay = calculateBackoffDelay(retryCount, config)
        retryCount++

        const progress = 30 + Math.min(60, retryCount * 3)
        updateStatus('processing', progress)

        await sleep(delay)
    }

    throw new Error('轮询超时，请稍后重试')
}

// 修改 recognize 方法
const recognize = async (options: MineruRecognitionOptions) => {
    // ... 前面的代码保持不变 ...

    // 3.3 上传到 MinerU
    await uploadToMineru(uploadUrl, fileContent, fileName)

    // 3.4 ✅ 使用 taskId 轮询任务状态
    // 注意：需要从上传响应或其他地方获取 taskId
    const recordId = await pollTaskStatus(taskId)

    if (!recordId) {
        throw new Error('识别失败')
    }

    // 3.5 使用 ossFileId 获取识别记录
    const finalStatus = await checkRecognitionStatus(ossFileId)
    if (finalStatus.recognized && finalStatus.record) {
        updateStatus('success', 100)
        return {
            htmlContent: finalStatus.record.htmlContent || '',
            markdownContent: finalStatus.record.markdownContent || '',
            imageCount: 0,
        }
    }

    throw new Error('识别结果获取失败')
}
```

### 步骤 3：修改识别记录查询 API

**文件**：`lexseek/server/api/v1/recognition/doc/status/[ossFileId].get.ts`

```typescript
// 移除 mineruTask 字段
const response: CheckStatusResponse = {
    recognized: isRecognized,
    status: record.status,
    recordType: docRecord ? 'doc' : 'image',
    record: { ... },
    // ❌ 移除：mineruTask: { ... },
}
```

### 步骤 4：验证修复

1. 上传 doc/pdf 文件
2. 验证前端可以获取 `taskId`
3. 验证前端可以轮询任务状态
4. 验证识别完成后可以获取识别记录
5. 验证识别失败时不创建识别记录

---

## 六、总结

### 6.1 主要问题

1. **轮询机制不一致**：MinerU 使用 ossFileId，ASR 使用 taskId
2. **API 职责混乱**：识别记录 API 包含任务信息
3. **前端逻辑复杂**：需要理解两种不同的轮询机制
4. **可能存在未识别时创建识别记录的问题**

### 6.2 修复优先级

1. **高优先级**：
   - 创建任务状态查询 API
   - 修改前端轮询逻辑
   - 验证识别记录创建时机

2. **中优先级**：
   - 拆分识别记录查询 API
   - 统一提交 API

3. **低优先级**：
   - 代码重构和优化

### 6.3 设计原则

1. **职责分离**：任务记录和识别记录分开管理
2. **一致性**：MinerU 和 ASR 使用相同的设计模式
3. **简单性**：前端只需要理解一种轮询机制
4. **可扩展性**：易于添加新功能（重试、取消等）

---

## 七、相关文档

- `lexseek/docs/asr-task-polling-fix.md` - ASR 修复文档（参考标准）
- `lexseek/docs/recognition-record-fix-summary.md` - 识别记录修复总结
- `lexseek/docs/fix-point-deduction-error-handling.md` - 积分扣减修复文档
