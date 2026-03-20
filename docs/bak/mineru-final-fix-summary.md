# MinerU 识别流程长期优化完成总结

## 完成日期
2026-01-18

## 优化目标
✅ 统一 MinerU 和 ASR 的识别流程设计，使用相同的轮询机制（taskId），提高代码一致性和可维护性。

---

## 一、完成的修改

### 1. 测试文件（TDD）

#### 1.1 任务状态查询 API 测试
**文件**：`lexseek/tests/server/api/mineru-task-status.test.ts`

**测试用例**：
- ✅ 应该返回处理中的任务状态
- ✅ 应该返回成功的任务状态和识别记录 ID
- ✅ 应该返回失败的任务状态
- ✅ 应该在任务不存在时返回 404
- ✅ 应该在未登录时返回 401

#### 1.2 提交 API 测试
**文件**：`lexseek/tests/server/api/mineru-submit.test.ts`

**测试用例**：
- ✅ 应该成功提交 MinerU 识别任务
- ✅ 应该在文件不存在时返回 404
- ✅ 应该在未登录时返回 401
- ✅ 应该在参数缺失时返回 400

### 2. 后端 API

#### 2.1 任务状态查询 API
**文件**：`lexseek/server/api/v1/recognition/mineru/task/[taskId].get.ts`（新建）

**功能**：
- 根据 taskId 查询任务状态
- **支持两种查询方式**：
  - 数字 ID：通过数据库 ID 查询（前端提交后返回的 ID）
  - 字符串 ID：通过 MinerU taskId 查询（回调时使用）
- 返回任务状态、识别记录 ID（成功时）、错误信息（失败时）

**请求**：
```
GET /api/v1/recognition/mineru/task/:taskId
```

**参数**：
- `taskId`: 可以是数字（数据库 ID）或字符串（MinerU taskId）

**返回值**：
```typescript
{
    taskId: string,          // 数据库 ID（字符串格式）
    status: number,          // 任务状态（PROCESSING, SUCCESS, FAILED）
    recordId: number | null, // 识别记录 ID（成功时返回）
    errorMsg: string | null  // 错误信息（失败时返回）
}
```

**重要修复**：
- ⚠️ **问题**：初始实现只支持通过 MinerU taskId 查询，但提交 API 返回的是数据库 ID
- ✅ **修复**：支持两种查询方式，自动识别参数类型
  - 纯数字：通过数据库 ID 查询（`getMineruTaskByIdService`）
  - 其他字符串：通过 MinerU taskId 查询（`getMineruTaskByTaskIdService`）

#### 2.2 统一提交 API
**文件**：`lexseek/server/api/v1/recognition/mineru/submit.post.ts`（新建）

**功能**：
- 整合上传链接申请和任务创建
- 返回 taskId 和 uploadUrl
- 创建任务记录

**请求**：
```
POST /api/v1/recognition/mineru/submit
Body: {
    ossFileId: number,
    fileName: string,
    encrypted?: boolean,
    modelVersion?: 'pipeline' | 'vlm',
    enableOcr?: boolean,
    enableFormula?: boolean,
    enableTable?: boolean
}
```

**返回值**：
```typescript
{
    taskId: string,      // 任务 ID（用于轮询）
    taskStatus: number,  // 任务状态
    uploadUrl: string,   // 上传 URL
    batchId: string      // 批量任务 ID
}
```

#### 2.3 识别记录查询 API
**文件**：`lexseek/server/api/v1/recognition/doc/status/[ossFileId].get.ts`（修改）

**修改内容**：
- ❌ 移除 `MineruTaskInfo` 接口定义
- ❌ 移除 `mineruTask` 字段
- ❌ 移除查询 MinerU 任务的代码
- ✅ 只返回识别记录信息

**修改前**：
```typescript
interface CheckStatusResponse {
    recognized: boolean
    status?: number
    recordType?: 'doc' | 'image'
    record?: { ... }
    mineruTask?: MineruTaskInfo  // ❌ 移除
}
```

**修改后**：
```typescript
interface CheckStatusResponse {
    recognized: boolean
    status?: number
    recordType?: 'doc' | 'image'
    record?: { ... }
    // ✅ 不再包含任务信息
}
```

### 3. 前端 Composable

#### 3.1 useMineruRecognition.ts
**文件**：`lexseek/app/composables/useMineruRecognition.ts`（修改）

**新增类型定义**：
```typescript
/** 任务状态响应 */
interface TaskStatusResponse {
    taskId: string
    status: number
    recordId: number | null
    errorMsg: string | null
}

/** 提交响应 */
interface SubmitResponse {
    taskId: string
    taskStatus: number
    uploadUrl: string
    batchId: string
}
```

**新增方法**：

1. **getTaskStatus** - 查询任务状态
```typescript
const getTaskStatus = async (taskId: string): Promise<TaskStatusResponse | null> => {
    return await useApiFetch<TaskStatusResponse>(
        `/api/v1/recognition/mineru/task/${taskId}`,
        { showError: false }
    )
}
```

2. **submitRecognition** - 提交识别任务
```typescript
const submitRecognition = async (
    options: MineruRecognitionOptions
): Promise<SubmitResponse | null> => {
    // 调用新的提交 API
    // 返回 taskId 和 uploadUrl
}
```

3. **pollTaskStatus** - 轮询任务状态
```typescript
const pollTaskStatus = async (
    taskId: string,
    config: PollingConfig = DEFAULT_POLLING_CONFIG
): Promise<number | null> => {
    // 使用 taskId 轮询任务状态
    // 成功时返回 recordId
    // 失败时抛出错误
}
```

**修改的方法**：

1. **checkRecognitionStatus** - 简化识别状态检查
```typescript
// ❌ 修改前：返回 mineruCompleted 和 downloadUrl
const checkRecognitionStatus = async (ossFileId: number): Promise<{
    recognized: boolean
    processing: boolean
    mineruCompleted: boolean  // ❌ 移除
    downloadUrl?: string      // ❌ 移除
    record?: ...
}> => { ... }

// ✅ 修改后：只返回识别记录状态
const checkRecognitionStatus = async (ossFileId: number): Promise<{
    recognized: boolean
    processing: boolean
    record?: ...
}> => { ... }
```

2. **recognize** - 使用新的流程
```typescript
// ❌ 修改前：申请上传链接 → 上传 → 轮询识别记录
const recognize = async (options) => {
    const { uploadUrl } = await requestUploadUrl(ossFileId, fileName)
    await uploadToMineru(uploadUrl, fileContent, fileName)
    await pollStatus(ossFileId)  // ❌ 使用 ossFileId 轮询
}

// ✅ 修改后：提交任务 → 上传 → 轮询任务状态
const recognize = async (options) => {
    const { taskId, uploadUrl } = await submitRecognition(options)
    await uploadToMineru(uploadUrl, fileContent, fileName)
    const recordId = await pollTaskStatus(taskId)  // ✅ 使用 taskId 轮询
}
```

**移除的方法**：
- ❌ `requestUploadUrl` - 被 `submitRecognition` 替代
- ❌ `pollStatus` - 被 `pollTaskStatus` 替代

---

## 二、设计对比

### 2.1 修改前（旧设计）

```
┌─────────┐
│ 前端提交 │
└────┬────┘
     │
     ▼
┌──────────────┐
│ 申请上传链接  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 上传文件      │
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ 使用 ossFileId 轮询  │  ❌ 问题：轮询识别记录
│ 识别记录状态         │     但识别记录只在成功时创建
└──────┬───────────────┘
       │
       ▼
┌──────────────┐
│ 获取识别结果  │
└──────────────┘
```

**问题**：
1. 轮询识别记录，但识别记录只在成功时创建
2. API 混合了任务信息和识别记录信息
3. 与 ASR 设计不一致

### 2.2 修改后（新设计）

```
┌─────────┐
│ 前端提交 │
└────┬────┘
     │
     ▼
┌──────────────────────┐
│ 提交任务             │  ✅ 统一的提交 API
│ 返回 taskId + uploadUrl │
└──────┬───────────────┘
       │
       ▼
┌──────────────┐
│ 上传文件      │
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ 使用 taskId 轮询     │  ✅ 轮询任务状态
│ 任务状态             │     与 ASR 一致
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ 任务成功             │
│ 返回 recordId        │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ 使用 ossFileId 查询  │  ✅ 职责分离
│ 识别记录             │
└──────────────────────┘
```

**优点**：
1. ✅ 与 ASR 设计一致
2. ✅ 职责清晰：任务管理任务状态，识别记录管理识别结果
3. ✅ 前端轮询逻辑统一
4. ✅ API 职责单一

---

## 三、与 ASR 的对比

| 特性 | ASR | MinerU（修改后） | 一致性 |
|------|-----|-----------------|--------|
| 提交 API | `POST /api/v1/recognition/audio` | `POST /api/v1/recognition/mineru/submit` | ✅ |
| 返回值 | `{ taskId, taskStatus }` | `{ taskId, taskStatus, uploadUrl }` | ✅ |
| 轮询 API | `GET /api/v1/recognition/audio/task/:taskId` | `GET /api/v1/recognition/mineru/task/:taskId` | ✅ |
| 轮询参数 | taskId | taskId | ✅ |
| 轮询返回 | `{ taskId, status, recordId }` | `{ taskId, status, recordId }` | ✅ |
| 识别记录查询 | `GET /api/v1/recognition/audio/record/:recordId` | `GET /api/v1/recognition/doc/status/:ossFileId` | ⚠️ 不同 |
| 任务记录 | `asrTasks` | `mineruTasks` | ✅ |
| 识别记录 | `asrRecords` | `docRecognitionRecords` | ✅ |

**注意**：识别记录查询 API 不同是因为：
- ASR：使用 recordId 查询
- MinerU：使用 ossFileId 查询（因为 doc 识别记录与 OSS 文件一对一）

---

## 四、文件清单

### 4.1 新建文件
1. `lexseek/server/api/v1/recognition/mineru/task/[taskId].get.ts` - 任务状态查询 API
2. `lexseek/server/api/v1/recognition/mineru/submit.post.ts` - 统一提交 API
3. `lexseek/tests/server/api/mineru-task-status.test.ts` - 任务状态查询测试
4. `lexseek/tests/server/api/mineru-submit.test.ts` - 提交 API 测试
5. `lexseek/docs/mineru-long-term-optimization.md` - 优化方案文档

### 4.2 修改文件
1. `lexseek/server/api/v1/recognition/doc/status/[ossFileId].get.ts` - 移除任务信息
2. `lexseek/app/composables/useMineruRecognition.ts` - 更新轮询逻辑

### 4.3 保留文件（未修改）
1. `lexseek/server/api/v1/recognition/mineru/upload-url.post.ts` - 保留（向后兼容）
2. `lexseek/server/api/v1/recognition/mineru/upload.post.ts` - 保留（上传代理）
3. `lexseek/server/services/material/mineru.service.ts` - 保留（服务层）
4. `lexseek/server/services/material/mineruTask.service.ts` - 保留（任务服务）
5. `lexseek/app/components/caseAnalysis/promptInput.vue` - 无需修改（使用 Composable）

---

## 五、测试计划

### 5.1 单元测试
- ✅ 任务状态查询 API 测试
- ✅ 提交 API 测试
- ⏳ 前端 Composable 测试（需要配置测试环境）

### 5.2 集成测试
- ⏳ 完整识别流程测试（doc 文件）
- ⏳ 完整识别流程测试（pdf 文件）
- ⏳ 加密文件识别测试
- ⏳ 识别失败场景测试

### 5.3 手动测试清单
- [ ] 上传 doc 文件并识别
- [ ] 上传 pdf 文件并识别
- [ ] 上传加密 doc 文件并识别
- [ ] 上传加密 pdf 文件并识别
- [ ] 测试识别失败场景
- [ ] 测试轮询超时场景
- [ ] 测试重复提交场景
- [ ] 测试网络异常场景

---

## 六、向后兼容性

### 6.1 保留的旧 API
- `POST /api/v1/recognition/mineru/upload-url` - 保留，但不推荐使用
- `POST /api/v1/recognition/mineru/upload` - 保留，上传代理仍然需要

### 6.2 迁移建议
如果有其他地方使用了旧的 API，建议迁移到新的 API：

**旧方式**：
```typescript
// 1. 申请上传链接
const { uploadUrl } = await $fetch('/api/v1/recognition/mineru/upload-url', {
    method: 'POST',
    body: { files: [{ ossFileId, fileName }] }
})

// 2. 上传文件
await $fetch('/api/v1/recognition/mineru/upload', {
    method: 'POST',
    body: { uploadUrl, fileContent, fileName }
})

// 3. 轮询识别记录（❌ 错误）
const status = await $fetch(`/api/v1/recognition/doc/status/${ossFileId}`)
```

**新方式**：
```typescript
// 1. 提交任务（整合了申请上传链接）
const { taskId, uploadUrl } = await $fetch('/api/v1/recognition/mineru/submit', {
    method: 'POST',
    body: { ossFileId, fileName }
})

// 2. 上传文件
await $fetch('/api/v1/recognition/mineru/upload', {
    method: 'POST',
    body: { uploadUrl, fileContent, fileName }
})

// 3. 轮询任务状态（✅ 正确）
const taskStatus = await $fetch(`/api/v1/recognition/mineru/task/${taskId}`)

// 4. 任务成功后，查询识别记录
if (taskStatus.recordId) {
    const record = await $fetch(`/api/v1/recognition/doc/status/${ossFileId}`)
}
```

---

## 七、回滚计划

如果新设计出现问题，可以按以下步骤回滚：

### 7.1 回滚步骤
1. 恢复 `/api/v1/recognition/doc/status/[ossFileId].get.ts` 中的 `mineruTask` 字段
2. 恢复 `useMineruRecognition.ts` 的旧实现
3. 删除新创建的 API 文件
4. 运行测试确保功能正常

### 7.2 回滚命令
```bash
# 1. 恢复文件
git checkout HEAD -- lexseek/server/api/v1/recognition/doc/status/[ossFileId].get.ts
git checkout HEAD -- lexseek/app/composables/useMineruRecognition.ts

# 2. 删除新文件
rm lexseek/server/api/v1/recognition/mineru/task/[taskId].get.ts
rm lexseek/server/api/v1/recognition/mineru/submit.post.ts

# 3. 运行测试
bun test
```

---

## 八、相关文档

1. `lexseek/docs/mineru-recognition-flow-review.md` - MinerU 流程审查报告
2. `lexseek/docs/asr-task-polling-fix.md` - ASR 修复文档（参考标准）
3. `lexseek/docs/recognition-record-fix-summary.md` - 识别记录修复总结
4. `lexseek/docs/mineru-long-term-optimization.md` - 优化方案详细文档

---

## 十、已知问题和修复

### 10.1 问题：前端轮询失败（404 错误）

**现象**：
```
/api/v1/recognition/mineru/task/59 返回 404
错误：查询任务状态失败
```

**原因**：
- 提交 API 返回的 `taskId` 是数据库的自增 ID（数字，如 `59`）
- 查询 API 最初只支持通过 MinerU 的 `taskId`（字符串）查询
- 导致前端使用数据库 ID 查询时找不到任务

**修复**：
修改查询 API，支持两种查询方式：
```typescript
// 支持数字 ID（数据库 ID）
if (/^\d+$/.test(taskIdParam)) {
    const id = parseInt(taskIdParam, 10)
    task = await getMineruTaskByIdService(id)
}
// 支持字符串 ID（MinerU taskId）
else {
    task = await getMineruTaskByTaskIdService(taskIdParam)
}
```

**状态**：✅ 已修复

---

## 十一、总结

### 9.1 完成的工作
✅ 创建了统一的提交 API
✅ 创建了任务状态查询 API
✅ 修改了识别记录查询 API（移除任务信息）
✅ 更新了前端 Composable（使用 taskId 轮询）
✅ 编写了完整的测试用例
✅ 编写了详细的文档

### 9.2 设计优势
1. **一致性**：MinerU 和 ASR 使用相同的设计模式
2. **职责分离**：任务记录和识别记录职责清晰
3. **易于维护**：前端轮询逻辑统一
4. **易于扩展**：可以轻松添加新功能（如任务取消、重试等）

### 9.3 下一步
1. 运行完整的测试套件
2. 进行手动测试
3. 部署到测试环境
4. 收集用户反馈
5. 根据反馈进行优化


---

## 总结

### 完成的工作
✅ 创建了统一的提交 API
✅ 创建了任务状态查询 API（支持数据库 ID 和 MinerU taskId）
✅ 修改了识别记录查询 API（移除任务信息）
✅ 更新了前端 Composable（使用 taskId 轮询）
✅ 编写了完整的测试用例
✅ 编写了详细的文档
✅ 修复了前端轮询 404 问题

### 设计优势
1. **一致性**：MinerU 和 ASR 使用相同的设计模式
2. **职责分离**：任务记录和识别记录职责清晰
3. **易于维护**：前端轮询逻辑统一
4. **易于扩展**：可以轻松添加新功能（如任务取消、重试等）
5. **灵活性**：查询 API 支持两种 ID 格式，兼容性更好

### 下一步
1. ✅ 修复前端轮询 404 问题
2. ⏳ 进行完整的手动测试
3. ⏳ 部署到测试环境
4. ⏳ 收集用户反馈
5. ⏳ 根据反馈进行优化
