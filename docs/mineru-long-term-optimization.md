# MinerU 长期优化方案实施文档

## 实施日期
2026-01-18

## 优化目标
统一 MinerU 和 ASR 的识别流程设计，使用相同的轮询机制（taskId），提高代码一致性和可维护性。

---

## 一、完成的修改

### 1. 测试文件（TDD 第一步）

#### 1.1 创建任务状态查询 API 测试
**文件**：`lexseek/tests/server/api/mineru-task-status.test.ts`

**测试用例**：
- ✅ 应该返回处理中的任务状态
- ✅ 应该返回成功的任务状态和识别记录 ID
- ✅ 应该返回失败的任务状态
- ✅ 应该在任务不存在时返回 404
- ✅ 应该在未登录时返回 401

#### 1.2 创建提交 API 测试
**文件**：`lexseek/tests/server/api/mineru-submit.test.ts`

**测试用例**：
- ✅ 应该成功提交 MinerU 识别任务
- ✅ 应该在文件不存在时返回 404
- ✅ 应该在未登录时返回 401
- ✅ 应该在参数缺失时返回 400

### 2. 后端 API（TDD 第二步）

#### 2.1 创建任务状态查询 API
**文件**：`lexseek/server/api/v1/recognition/mineru/task/[taskId].get.ts`

**功能**：
- 根据 taskId 查询任务状态
- **支持两种查询方式**：
  - 数字 ID：通过数据库 ID 查询（前端提交后返回的 ID）
  - 字符串 ID：通过 MinerU taskId 查询（回调时使用）
- 返回任务状态、识别记录 ID（成功时）、错误信息（失败时）

**返回值**：
```typescript
{
    taskId: string,          // 数据库 ID（字符串格式）
    status: number,
    recordId: number | null,
    errorMsg: string | null
}
```

**修复说明**：
- ⚠️ 初始实现只支持通过 MinerU taskId 查询，导致前端轮询失败
- ✅ 修复后支持通过数据库 ID 查询，解决了前端轮询问题

#### 2.2 创建统一提交 API
**文件**：`lexseek/server/api/v1/recognition/mineru/submit.post.ts`

**功能**：
- 整合上传链接申请和任务创建
- 返回 taskId 和 uploadUrl
- 创建任务记录

**返回值**：
```typescript
{
    taskId: string,
    taskStatus: number,
    uploadUrl: string,
    batchId: string
}
```

#### 2.3 修改识别记录查询 API
**文件**：`lexseek/server/api/v1/recognition/doc/status/[ossFileId].get.ts`

**修改内容**：
- ❌ 移除 `mineruTask` 字段
- ✅ 只返回识别记录信息

---

## 二、待完成的修改

### 3. 前端 Composable

#### 3.1 修改 useMineruRecognition.ts

**需要添加的方法**：

```typescript
/**
 * 查询任务状态
 */
const getTaskStatus = async (taskId: string): Promise<TaskStatusResponse | null> => {
    return await useApiFetch<TaskStatusResponse>(
        `/api/v1/recognition/mineru/task/${taskId}`,
        { showError: false }
    )
}

/**
 * 轮询任务状态
 */
const pollTaskStatus = async (
    taskId: string,
    config: PollingConfig = DEFAULT_POLLING_CONFIG
): Promise<number | null> => {
    // 使用 taskId 轮询任务状态
    // 成功时返回 recordId
    // 失败时返回 null
}

/**
 * 提交识别任务
 */
const submitRecognition = async (
    options: MineruRecognitionOptions
): Promise<{ taskId: string; taskStatus: number; uploadUrl: string } | null> => {
    // 调用新的提交 API
    // 返回 taskId 和 uploadUrl
}
```

**需要修改的方法**：

```typescript
/**
 * recognize 方法
 */
const recognize = async (options: MineruRecognitionOptions) => {
    // 1. 检查是否已识别
    // 2. 提交任务（获取 taskId 和 uploadUrl）
    // 3. 上传文件到 MinerU
    // 4. 使用 taskId 轮询任务状态
    // 5. 任务成功后，使用 ossFileId 查询识别记录
}
```

#### 3.2 修改 promptInput.vue

**需要修改的方法**：

```typescript
/**
 * triggerDocRecognition 方法
 */
async function triggerDocRecognition(file: OssFileItem) {
    // MinerU 识别流程：
    // 1. 检查是否已识别
    // 2. 调用 recognize（内部使用 taskId 轮询）
    // 3. 识别完成后标记成功
}
```

### 4. 类型定义

#### 4.1 添加类型定义到 useMineruRecognition.ts

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

---

## 三、设计对比

### 3.1 修改前（旧设计）

```
前端提交 → 申请上传链接 → 上传文件 → 使用 ossFileId 轮询识别记录
```

**问题**：
- 轮询识别记录，但识别记录只在成功时创建
- API 混合了任务信息和识别记录信息
- 与 ASR 设计不一致

### 3.2 修改后（新设计）

```
前端提交 → 获取 taskId 和 uploadUrl → 上传文件 → 使用 taskId 轮询任务状态 → 任务成功后查询识别记录
```

**优点**：
- 与 ASR 设计一致
- 职责清晰：任务管理任务状态，识别记录管理识别结果
- 前端轮询逻辑统一

---

## 四、测试计划

### 4.1 单元测试
- ✅ 任务状态查询 API 测试
- ✅ 提交 API 测试
- ⏳ 前端 Composable 测试

### 4.2 集成测试
- ⏳ 完整识别流程测试（doc 文件）
- ⏳ 完整识别流程测试（pdf 文件）
- ⏳ 加密文件识别测试
- ⏳ 识别失败场景测试

### 4.3 手动测试
- ⏳ 上传 doc 文件并识别
- ⏳ 上传 pdf 文件并识别
- ⏳ 上传加密文件并识别
- ⏳ 测试识别失败场景
- ⏳ 测试轮询超时场景

---

## 五、回滚计划

如果新设计出现问题，可以按以下步骤回滚：

1. 恢复 `/api/v1/recognition/doc/status/[ossFileId].get.ts` 中的 `mineruTask` 字段
2. 删除新创建的 API 文件
3. 恢复前端 Composable 的旧实现
4. 运行测试确保功能正常

---

## 六、相关文档

- `lexseek/docs/mineru-recognition-flow-review.md` - MinerU 流程审查报告
- `lexseek/docs/asr-task-polling-fix.md` - ASR 修复文档（参考标准）
- `lexseek/docs/recognition-record-fix-summary.md` - 识别记录修复总结
