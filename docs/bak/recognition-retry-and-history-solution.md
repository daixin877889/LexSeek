# 识别重试与历史记录解决方案

## 问题背景

在修复识别重复记录问题时，我们需要区分两个不同的概念：

1. **识别记录**（Recognition Records）：与 `ossFileId` 关联，记录文件的识别结果
   - `docRecognitionRecords`：PDF/DOC 识别记录
   - `asrRecords`：音频识别记录
   - `imageRecognitionRecords`：图片识别记录

2. **任务记录**（Task Records）：记录每次提交到第三方服务的任务
   - `mineruTasks`：MinerU PDF 转换任务
   - `asrTasks`：ASR 音频转录任务

## 当前问题

### 问题 1：识别记录与任务记录的关系混淆

**现状**：
- 一个 `ossFileId` 只应该有一条有效的识别记录
- 但可以有多条任务记录（每次重试都会创建新任务）

**我的修复**：
- 在 `submitPdfConversionService` 和 `submitAsrTaskService` 中添加了识别记录检查
- 如果已有成功的识别记录，直接返回，不创建新任务
- 如果是失败的识别记录，软删除后重新识别

**影响**：
- ✅ 避免了重复识别已成功的文件
- ✅ 失败记录可以重试
- ❌ **但这会影响后台任务重试功能**

### 问题 2：后台任务重试的限制

#### MinerU 任务重试
- **前端直传文件**：文件直接从前端上传到 MinerU 服务
- **后台无法重试**：后台没有文件内容，无法重新生成文件 URL
- **解决方案**：应该禁用 MinerU 的后台重试功能

#### ASR 任务重试
- **非加密文件**：使用 OSS 的文件路径，可以重新生成签名 URL
  - ✅ 可以后台重试
- **加密文件**：前端解密后上传到临时文件夹
  - ❌ 临时文件在识别完成/失败后被删除
  - ❌ 无法后台重试

### 问题 3：修复后的冲突

**场景 1：前端重试失败的识别**
- 用户在前端点击"重试"按钮
- 调用 `submitPdfConversionService` 或 `submitAsrTaskService`
- ✅ 我的修复会检查识别记录，如果失败则软删除后重新识别
- ✅ 正常工作

**场景 2：后台重试失败的任务**
- 管理员在后台点击"重试任务"按钮
- 调用 `retryMineruTaskService` 或 `retryAsrTaskService`
- 这些函数会创建新的任务记录，并重新提交到第三方服务
- ❌ **问题**：如果识别记录已经存在（即使是失败的），我的修复会阻止创建新任务

## 解决方案

### 方案 1：区分前端重试和后台重试（推荐）

**核心思路**：
- 前端重试：通过识别记录判断是否需要重新识别
- 后台重试：直接操作任务记录，不检查识别记录

**实现步骤**：

#### 1. 修改 `submitPdfConversionService` 和 `submitAsrTaskService`

添加一个参数 `skipRecordCheck`，用于后台重试时跳过识别记录检查：

```typescript
export const submitPdfConversionService = async (
    ossFileId: number,
    userId: number,
    options: MineruSubmitOptions = {},
    skipRecordCheck: boolean = false  // 新增参数
): Promise<MineruSubmitResult> => {
    // ... 前面的代码 ...

    // 7. 检查是否已有识别记录（后台重试时跳过）
    if (!skipRecordCheck) {
        const existingRecord = await findDocRecognitionByOssFileIdDao(ossFileId)
        if (existingRecord) {
            // ... 现有的检查逻辑 ...
        }
    }

    // ... 后面的代码 ...
}
```

#### 2. 修改 `retryMineruTaskService` 和 `retryAsrTaskService`

在重试时传入 `skipRecordCheck: true`：

```typescript
export const retryMineruTaskService = async (
    id: number
): Promise<MineruTaskWithFile> => {
    // ... 前面的代码 ...

    // 检查是否为加密文件
    if (task.isEncrypted) {
        throw new Error('加密文件无法在后台重试，请在前端重新提交')
    }

    // ... 重新提交任务的代码 ...

    // 创建新任务记录（跳过识别记录检查）
    const newTask = await createMineruTaskService({
        taskId: newTaskId,
        ossFileId: task.ossFileId,
        userId: task.userId,
        status: MineruTaskStatus.PROCESSING,
        taskRawData: {
            ...taskRawData,
            retryAt: new Date().toISOString(),
        },
        retrySourceId: task.id,
        isEncrypted: false,
    })

    // ... 后面的代码 ...
}
```

**注意**：后台重试不需要调用 `submitPdfConversionService`，而是直接调用 MinerU/ASR API，然后创建新的任务记录。所以不需要修改重试服务。

#### 3. 禁用 MinerU 的后台重试功能

由于 MinerU 是前端直传文件，后台无法重新生成文件 URL，应该完全禁用后台重试功能：

**前端修改**：
- 在 `lexseek/app/pages/admin/mineru-tasks/index.vue` 中移除重试按钮
- 或者添加提示："MinerU 任务无法在后台重试，请在前端重新提交"

**后端修改**：
- 在 `retryMineruTaskService` 中直接抛出错误：
  ```typescript
  throw new Error('MinerU 任务无法在后台重试，因为文件是前端直传的。请在前端重新提交识别任务。')
  ```

#### 4. ASR 加密文件的处理

对于 ASR 加密文件，已经有检查逻辑：

```typescript
// 检查是否为加密文件
if (task.isEncrypted) {
    throw new Error('加密文件无法在后台重试，请在前端重新提交')
}
```

这个逻辑是正确的，保持不变。

### 方案 2：完全禁用后台重试（不推荐）

如果不想区分前端和后台重试，可以完全禁用后台重试功能：

1. 移除后台管理页面的重试按钮
2. 移除 `retryMineruTaskService` 和 `retryAsrTaskService` 函数
3. 移除相关的 API 路由

**缺点**：
- 非加密的 ASR 任务本来可以后台重试，但也被禁用了
- 管理员无法在后台管理失败的任务

## 推荐实施方案

### 第一步：禁用 MinerU 后台重试 ✅ 已完成

**原因**：MinerU 是前端直传文件，后台无法重新生成文件 URL

**实施**：

1. ✅ 修改 `retryMineruTaskService`：
```typescript
export const retryMineruTaskService = async (
    id: number
): Promise<MineruTaskWithFile> => {
    throw new Error('MinerU 任务无法在后台重试。原因：文件是前端直传到 MinerU 服务的，后台没有文件内容。请在前端重新提交识别任务。')
}
```

2. ✅ 修改前端页面 `lexseek/app/pages/admin/mineru-tasks/index.vue`：
   - 移除了下拉菜单中的重试按钮
   - 移除了详情对话框中的重试按钮
   - 添加了注释说明原因

### 第二步：保留 ASR 非加密文件的后台重试 ✅ 已确认

**原因**：非加密文件使用 OSS 路径，可以重新生成签名 URL

**实施**：
- ✅ 保持 `retryAsrTaskService` 的现有逻辑
- ✅ 已经有 `isEncrypted` 检查，会阻止加密文件的后台重试

### 第三步：确保前端重试正常工作 ✅ 已确认

**验证**：
- ✅ 前端重试调用的是 `submitPdfConversionService` 和 `submitAsrTaskService`
- ✅ 这些函数会检查识别记录，如果失败则重新识别
- ✅ 不受后台重试逻辑的影响

## 总结

### 关键区别

| 类型 | 入口函数 | 检查对象 | 创建对象 | 适用场景 |
|------|---------|---------|---------|---------|
| 前端重试 | `submitPdfConversionService`<br/>`submitAsrTaskService` | 识别记录 | 任务记录 + 识别记录 | 用户在前端重新提交识别 |
| 后台重试 | `retryMineruTaskService`<br/>`retryAsrTaskService` | 任务记录 | 新任务记录 | 管理员在后台重试失败任务 |

### 修复影响

我的修复主要影响**前端重试**流程：
- ✅ 避免重复识别已成功的文件
- ✅ 失败记录可以重新识别
- ✅ 保留历史记录

对**后台重试**的影响：
- ❌ MinerU 任务本来就无法后台重试（前端直传文件）
  - **解决方案**：完全禁用 MinerU 后台重试功能
- ✅ ASR 非加密文件可以后台重试（使用 OSS 路径）
  - **现状**：已有 `isEncrypted` 检查，正常工作
- ❌ ASR 加密文件无法后台重试（临时文件已删除）
  - **现状**：已有 `isEncrypted` 检查，会抛出错误

### 需要修改的地方

1. **禁用 MinerU 后台重试** ✅ 已完成：
   - 修改 `retryMineruTaskService` 直接抛出错误
   - 修改前端页面移除或禁用重试按钮

2. **保持 ASR 后台重试** ✅ 已完成：
   - 非加密文件：保持现有逻辑
   - 加密文件：已有检查，无需修改

3. **前端重试** ✅ 已完成：
   - 无需修改，我的修复已经正确处理

4. **修复识别记录查询逻辑** ✅ 已完成：
   - **问题**：使用 `SUPERSEDED` 状态标记被替代的记录，但查询时没有排除这些记录
   - **影响**：可能导致一个 `ossFileId` 有多条记录（多条 `SUPERSEDED` + 1 条新记录）
   - **修复**：
     - 修改 `findAsrRecordByOssFileIdDao`：添加 `status: { not: AsrRecordStatus.SUPERSEDED }` 条件
     - 修改 `findDocRecognitionByOssFileIdDao`：添加 `status: { not: DocRecognitionStatus.SUPERSEDED }` 条件
   - **效果**：
     - 查询时只返回有效的识别记录（排除被替代的记录）
     - 保留完整的历史记录（被替代的记录仍在数据库中）
     - 确保一个 `ossFileId` 只有一条有效记录
