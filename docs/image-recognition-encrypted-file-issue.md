# 加密图片识别问题 - 完整修复报告

## 问题总结

### 问题 1: 加密图片识别失败
**状态**: ✅ 已解决 (实际是本地缓存问题)
**原因**: 用户清除了数据库但未清除本地缓存,导致新上传的文件使用了旧的缓存数据

### 问题 2: 识别失败后点击重试显示已识别
**状态**: ✅ 已修复
**根本原因**: `recognize` 函数内部也会检查识别状态,即使 `triggerImageRecognition` 传递了 `forceRetry=true`,`recognize` 函数仍会检查并返回失败的记录

## 问题 2 详细分析

### 问题描述
识别失败后点击重试,前端显示"已识别",但实际上没有重新识别。

### 根本原因

有**两个**问题导致重试失败:

#### 原因 1: 前端 `recognize` 函数内部也会检查状态

调用链:
1. 用户点击"重试"按钮
2. `retryRecognition(file)` 被调用
3. `triggerImageRecognition(file, true)` 被调用,传递 `forceRetry=true`
4. `triggerImageRecognition` 跳过状态检查 ✅
5. 调用 `recognizeImage({ ... })` 
6. **`recognize` 函数内部再次检查状态** ❌
7. 如果数据库中有记录(即使是失败的),可能会误判

#### 原因 2: 服务端不区分成功和失败的记录

在 `createImageRecognitionByBase64Service` 函数中:

```typescript
// 旧逻辑
const existingRecord = await findImageRecognitionByOssFileIdDao(ossFileId, tx)
if (existingRecord) {
    // ❌ 无论成功还是失败,都直接返回旧记录
    return {
        record: existingRecord,
        success: true,
        error: '图片已存在识别记录',
    }
}
```

这导致:
- 如果之前识别失败,重试时会直接返回失败的记录
- 不会重新调用 AI 识别
- 用户看到的还是失败状态

## 已完成的修复

### 修复 1: 前端 - 添加 forceRetry 参数到 ImageRecognitionOptions

**文件**: `lexseek/app/composables/useImageRecognition.ts`

```typescript
export interface ImageRecognitionOptions {
    // ... 其他字段
    /** 是否强制重试（跳过状态检查） */
    forceRetry?: boolean
}
```

### 修复 2: 前端 - 在 recognize 函数中支持 forceRetry

**文件**: `lexseek/app/composables/useImageRecognition.ts`

```typescript
const recognize = async (options: ImageRecognitionOptions): Promise<ImageRecognitionResult> => {
    const { ossFileId, fileName, forceRetry = false } = options

    try {
        // 1. 检查是否已识别（除非强制重试）
        if (!forceRetry) {
            const statusCheck = await checkRecognitionStatus(ossFileId)

            if (statusCheck.recognized && statusCheck.record) {
                updateStatus('success', 100)
                return statusCheck.record
            }
        } else {
            console.log('[recognize] 强制重试，跳过状态检查')
        }
        
        // 继续执行识别...
    }
}
```

### 修复 3: 前端 - 传递 forceRetry 参数

**文件**: `lexseek/app/components/caseAnalysis/promptInput.vue`

```typescript
async function triggerImageRecognition(file: OssFileItem, forceRetry = false) {
    // ...
    
    await recognizeImage({
        ossFileId: file.id,
        fileName: file.fileName,
        encrypted: file.encrypted,
        downloadUrl,
        mimeType: file.fileType,
        forceRetry, // ✅ 传递 forceRetry 参数
    });
}
```

### 修复 4: 服务端 - 区分成功和失败的记录

**文件**: `lexseek/server/services/material/ocr.service.ts`

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

### 修复 5: 添加文件类型检测（防御性编程）

**文件**: `lexseek/app/composables/useImageRecognition.ts`

添加了 `detectMimeTypeFromBuffer` 函数,通过检查文件魔数来验证实际文件类型,防止文件名与内容不匹配的情况。

## 重试逻辑说明

### 当前实现

当用户点击"重试"按钮时:

1. **前端**:
   - `retryRecognition` 调用 `triggerImageRecognition(file, true)`,传递 `forceRetry=true`
   - `triggerImageRecognition` 跳过状态检查,直接调用 `recognizeImage`
   - `recognizeImage` 内部的 `recognize` 函数也跳过状态检查(因为 `forceRetry=true`)
   - 直接发送识别请求到服务端

2. **服务端**:
   - 检查是否已有识别记录
   - **如果有成功的记录**: 直接返回成功记录(不重新识别)
   - **如果有失败的记录**: 软删除旧记录,创建新记录并重新识别
   - **如果没有记录**: 创建新记录并识别

### 数据库操作

- **成功记录**: 保留不变,直接返回
- **失败记录**: 软删除(设置 `deletedAt`),然后创建新记录
- **新记录**: 直接创建

这样做的好处:
1. 避免重复识别已成功的图片
2. 失败记录可以重试,每次重试都会创建新记录
3. 保留历史记录(软删除),方便追溯和调试

## 验证步骤

1. ✅ 所有代码修改已完成
2. ✅ TypeScript 类型检查通过
3. ⏳ 待用户测试: 识别失败后点击重试,验证能正确重新识别(不会显示已识别)
4. ⏳ 待用户测试: 上传加密图片,验证识别成功

## 相关文件

- ✅ `lexseek/app/components/caseAnalysis/promptInput.vue` - 已修改
- ✅ `lexseek/app/composables/useImageRecognition.ts` - 已修改
- ✅ `lexseek/server/services/material/ocr.service.ts` - 已修改
- `lexseek/server/utils/imageCompression.ts` - 无需修改

## 结论

问题 1 是本地缓存导致的,不是代码问题。
问题 2 已完全修复:
- 前端: `recognize` 函数支持 `forceRetry` 参数,重试时跳过状态检查
- 服务端: 区分成功和失败的记录,失败记录可以重新识别(软删除旧记录,创建新记录)

