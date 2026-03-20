# 音频识别任务轮询修复

## 修复日期
2026-01-18

## 问题描述
前端提交音频识别任务后，无法获取 `recordId` 进行轮询，导致无法实时查看识别状态。

## 根本原因
**设计混淆**：前端错误地使用 `recordId`（识别记录 ID）轮询，但应该使用 `taskId`（任务 ID）轮询。

**正确的设计**：
1. **任务记录**（`asrTasks`）：记录 ASR API 任务状态，提交时创建
2. **识别记录**（`asrRecords`）：记录识别结果，只在成功时创建
3. **前端应该轮询任务状态**，而不是识别记录状态

## 修复内容

### 1. 修改 API 返回值

**文件**：`lexseek/server/api/v1/recognition/audio/index.post.ts`

**修改前**：
```typescript
return resSuccess(event, '任务已提交', {
    taskId: submitResult.task?.taskId || null,
    recordId: submitResult.record?.id || null,  // ❌ 错误：返回 recordId
    status: submitResult.record?.status ?? AsrRecordStatus.PENDING,
})
```

**修改后**：
```typescript
return resSuccess(event, '任务已提交', {
    taskId: submitResult.task?.taskId || null,  // ✅ 返回 taskId
    taskStatus: submitResult.task?.status || AsrTaskStatus.PROCESSING,
})
```

### 2. 添加任务状态查询 API

**文件**：`lexseek/server/api/v1/recognition/audio/task/[taskId].get.ts`（新建）

**功能**：根据任务 ID 查询任务状态

**返回值**：
```typescript
{
    taskId: string,          // 任务 ID
    status: number,          // 任务状态（PROCESSING, SUCCESS, FAILED）
    recordId: number | null, // 识别记录 ID（成功时返回）
    recordStatus: number | null, // 识别记录状态（成功时返回）
}
```

### 3. 修改前端 Composable

**文件**：`lexseek/app/composables/useAudioRecognition.ts`

**修改内容**：

#### 3.1 修改提交响应类型
```typescript
// ❌ 修改前
interface SubmitRecognitionResponse {
    taskId: string | null
    recordId: number | null
    status: AsrRecordStatus
}

// ✅ 修改后
interface SubmitRecognitionResponse {
    taskId: string | null
    taskStatus: number
}
```

#### 3.2 添加任务状态查询方法
```typescript
const getTaskStatus = async (taskId: string): Promise<TaskStatusResponse | null> => {
    return await useApiFetch<TaskStatusResponse>(`/api/v1/recognition/audio/task/${taskId}`)
}
```

#### 3.3 修改轮询方法
```typescript
// ❌ 修改前：使用 recordId 轮询识别记录
const pollTaskStatus = async (
    recordId: number,  // ❌ 错误：使用 recordId
    onProgress?: (status: AsrRecordStatus) => void,
    config: PollingConfig = DEFAULT_POLLING_CONFIG
): Promise<AsrRecordStatus> => {
    // 轮询识别记录状态
    const result = await getResult(recordId)
    // ...
}

// ✅ 修改后：使用 taskId 轮询任务状态
const pollTaskStatus = async (
    taskId: string,  // ✅ 正确：使用 taskId
    onProgress?: (status: number) => void,
    config: PollingConfig = DEFAULT_POLLING_CONFIG
): Promise<number | null> => {  // 返回 recordId 或 null
    // 轮询任务状态
    const result = await getTaskStatus(taskId)
    
    if (result.status === AsrTaskStatus.SUCCESS) {
        return result.recordId  // 成功时返回 recordId
    }
    
    if (result.status === AsrTaskStatus.FAILED) {
        return null  // 失败时返回 null
    }
    
    // 继续轮询
}
```

### 4. 修改前端 Vue 组件

**文件**：`lexseek/app/components/caseAnalysis/promptInput.vue`

**修改内容**：

```typescript
// ❌ 修改前
const submitResult = await submitAudioRecognition(file.id)
if (submitResult.recordId) {
    const finalStatus = await pollAudioTaskStatus(submitResult.recordId, ...)
}

// ✅ 修改后
const submitResult = await submitAudioRecognition(file.id)
if (submitResult.taskId) {
    const recordId = await pollAudioTaskStatus(submitResult.taskId, ...)
    if (recordId) {
        // 识别成功
    } else {
        // 识别失败
    }
}
```

## 设计原则

### 1. 任务记录 vs 识别记录

| 记录类型 | 创建时机 | 用途 | 状态 |
|---------|---------|------|------|
| 任务记录（`asrTasks`） | 提交时创建 | 记录 ASR API 任务状态 | PROCESSING, SUCCESS, FAILED |
| 识别记录（`asrRecords`） | 成功时创建 | 记录识别结果和用户数据 | SUCCESS（只有成功状态） |

### 2. 为什么不在提交时创建识别记录？

**原因**：
1. **避免无效数据**：识别失败时不应该有识别记录
2. **数据一致性**：识别记录只包含成功的识别结果
3. **清晰的职责分离**：任务记录管理任务状态，识别记录管理识别结果

### 3. 前端轮询流程

```
1. 提交任务 → 获取 taskId
2. 使用 taskId 轮询任务状态
3. 任务成功 → 获取 recordId → 查询识别结果
4. 任务失败 → 显示失败信息
```

## 积分预扣机制

### 1. 前端必须传递音频时长

**原因**：
- 预扣积分需要知道音频时长
- 前端解密后可以准确获取音频时长
- 后端使用前端传递的时长进行预扣

**实现**：
```typescript
// 前端获取音频时长
const audioDuration = await getAudioDurationFromBuffer(decryptedData, mimeType)

// 提交时传递音频时长
const submitResult = await useApiFetch('/api/v1/recognition/audio', {
    method: 'POST',
    body: {
        ossFileId: file.id,
        audioDuration,  // ✅ 必须传递
        tempFilePath: signature.key,
        options,
    },
})
```

### 2. 预扣流程

```
1. 提交时：预扣积分（使用前端传递的时长）
2. 识别成功：结算积分（使用识别结果中的时长）
3. 识别失败：回滚积分
```

### 3. 如果前端无法获取时长？

**处理方式**：
- 前端应该在无法获取时长时提示用户
- 或者使用默认值（如 60 分钟），但要明确告知用户
- 不应该静默失败

## 测试建议

### 1. 测试加密音频识别
- 上传加密音频文件
- 验证前端可以获取 `taskId`
- 验证前端可以轮询任务状态
- 验证识别完成后可以获取 `recordId`
- 验证可以查询识别结果

### 2. 测试非加密音频识别
- 上传非加密音频文件
- 验证识别流程正常
- 验证积分正确扣减

### 3. 测试识别失败场景
- 上传无效音频文件
- 验证任务状态为 `FAILED`
- 验证积分正确回滚
- 验证不创建识别记录

### 4. 测试积分不足场景
- 设置用户积分不足
- 上传音频文件
- 验证提交时积分检查失败
- 验证不创建任务

## 相关文档

- `lexseek/docs/fix-point-deduction-error-handling.md` - 积分扣减修复文档
- `lexseek/docs/recognition-record-fix-summary.md` - 识别记录修复总结
